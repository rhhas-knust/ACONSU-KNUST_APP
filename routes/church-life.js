// The church's shared life: the Alumni wall, the weekly spotlight and the
// monthly theme.
//
// Three audiences read from this file and they want different things:
//   - anyone, with no account (the website and the app's public pages), who
//     sees only what has been approved and only the fields in publicAlumnus();
//   - an alumnus, who can ask to be listed from either door;
//   - National, who approves, corrects, pins and sets the theme.
//
// Nothing here carries a chapter filter on READ, on purpose: the wall and the
// theme belong to the whole union. A chapter's own site asks for its own
// alumni by naming the chapter (?chapter=), which is a display choice and not
// an access rule.
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const life = require('../lib/churchLife');
const { processPortrait } = require('../lib/imageProcess');
const { rejectOperatorKeys, csvSafe } = require('../lib/requestGuard');

const PHOTO_LIMIT_BYTES = 8 * 1024 * 1024;   // a phone photo; it is shrunk to ~100KB on arrival
const MAX_PENDING = 200;                     // a full queue refuses more rather than growing without bound
const MAX_FLYERS = 6;
const LIMITS = { name: 80, about: 400, currentWork: 120, contact: 120 };
const ABOUT_MIN = 15;
const MAX_DETAILS = 3000;
const DETAILS_VERSION = '2026-10-08';   // the wording of the agreement on the form
const LINK_RE = /(https?:\/\/|www\.)/i;

// Browsers on the chapter website (GitHub Pages) may send the request form to
// this server. Only those origins, and no cookies: the form is anonymous.
const SITE_ORIGINS = (process.env.SITE_ORIGINS || 'https://rhhas-knust.github.io')
  .split(',').map(s => s.trim()).filter(Boolean);

function registerChurchLifeRoutes(app, deps) {
  const { repo, rolesLib, gridfs, actorName, notifyAdminByEmail, escapeHtmlForEmail, compressIfImage, isChapterAdminOrAbove } = deps;
  const requireNational = rolesLib.requireNational;

  // ---------- small helpers ----------
  const oneLine = (value, max) => String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

  const photoUpload = (field) => {
    const uploader = multer({ storage: multer.memoryStorage(), limits: { fileSize: PHOTO_LIMIT_BYTES, files: 1 } }).single(field);
    return (req, res, next) => uploader(req, res, (err) => {
      if (!err) return rejectOperatorKeys(req, res, next);
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooBig ? 413 : 400).json({
        error: tooBig ? 'That photo is too large. Please send one under 8MB.' : 'We could not read that upload.'
      });
    });
  };

  const siteCors = (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && SITE_ORIGINS.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      res.set('Access-Control-Max-Age', '86400');
      return res.status(204).end();
    }
    return next();
  };

  const requestLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: Number(process.env.ALUMNI_REQUEST_LIMIT_MAX) || 5,
    message: { error: 'Too many requests from this device. Please try again in an hour.' },
    standardHeaders: true,
    legacyHeaders: false
  });

  async function chapterNames() {
    const chapters = await repo.getAll('chapters', {});
    return new Map(chapters.map(c => [c.id, c.name || c.id]));
  }

  // An active chapter the request is about. Named, or the only one there is.
  async function resolveChapter(raw) {
    const chapters = await repo.getAll('chapters', { status: 'active' });
    const id = oneLine(raw, 80);
    if (id) return chapters.find(c => c.id === id) || null;
    return chapters.length === 1 ? chapters[0] : null;
  }

  // Reads and checks the fields every route accepts. Returns { error } or { fields }.
  function readFields(body) {
    const name = oneLine(body.name, LIMITS.name);
    const about = oneLine(body.about, LIMITS.about);
    const currentWork = oneLine(body.currentWork, LIMITS.currentWork);
    const classOf = String(body.classOf || '').replace(/[^0-9]/g, '').slice(0, 4);
    if (name.length < 2) return { error: 'Please tell us your name.' };
    if (about.length < ABOUT_MIN) return { error: 'Please add a few words about yourself (at least a sentence).' };
    if (LINK_RE.test(name + ' ' + about + ' ' + currentWork)) return { error: 'Please leave web links out - just a few words about you.' };
    if (classOf && (Number(classOf) < 1950 || Number(classOf) > life.now().getUTCFullYear() + 1)) {
      return { error: 'That year does not look right. Leave it blank if you are not sure.' };
    }
    return { fields: { name, about, currentWork, classOf: classOf.length === 4 ? classOf : '' } };
  }

  async function storePortrait(file, title) {
    const processed = await processPortrait(file.buffer);
    return String(await gridfs.uploadBuffer(processed.buffer, `alumni-${Date.now()}.jpg`, {
      category: 'alumni', contentType: processed.contentType, title,
      chapterId: rolesLib.NATIONAL_CHAPTER_ID
    }));
  }
  const dropFile = (id) => { if (id) gridfs.deleteFile(id).catch(() => {}); };

  // ---------- the weekly spotlight ----------
  // Written the first time anyone asks about a week, then fixed for that week.
  async function releaseWeek(entryId, weekKey) {
    const e = await repo.getById('alumniEntries', entryId);
    if (e && e.lastSpotlightWeek === weekKey) {
      await repo.patchById('alumniEntries', e.id, { lastSpotlightWeek: e.prevSpotlightWeek || '', prevSpotlightWeek: '' });
    }
  }
  async function claimWeek(entry, weekKey) {
    await repo.patchById('alumniEntries', entry.id, {
      prevSpotlightWeek: entry.lastSpotlightWeek === weekKey ? (entry.prevSpotlightWeek || '') : (entry.lastSpotlightWeek || ''),
      lastSpotlightWeek: weekKey
    });
  }

  async function currentSpotlight() {
    const weekKey = life.isoWeekKey();
    const existing = (await repo.getAll('alumniSpotlights', { weekKey }))[0];
    if (existing) {
      const entry = await repo.getById('alumniEntries', existing.entryId);
      if (entry && entry.status === 'approved') return { weekKey, entry, pinned: !!existing.pinned };
      // Taken down mid-week: choose again rather than celebrate an empty slot.
      await repo.removeById('alumniSpotlights', existing.id);
    }
    const pick = life.pickSpotlight(await repo.getAll('alumniEntries', { status: 'approved' }));
    if (!pick) return { weekKey, entry: null, pinned: false };
    try {
      await repo.create('alumniSpotlights', { weekKey, entryId: pick.id, pinned: false }, 'spot');
    } catch (e) {
      // Another request chose a moment ago, and the unique weekKey made this one
      // lose. Theirs stands.
      const won = (await repo.getAll('alumniSpotlights', { weekKey }))[0];
      const entry = won && await repo.getById('alumniEntries', won.entryId);
      if (entry && entry.status === 'approved') return { weekKey, entry, pinned: !!won.pinned };
      return { weekKey, entry: pick, pinned: false };
    }
    await claimWeek(pick, weekKey);
    return { weekKey, entry: pick, pinned: false };
  }

  async function currentTheme() {
    return (await repo.getAll('monthlyThemes', { month: life.monthKey(), status: 'approved' }))[0] || null;
  }

  // ---------- public reads ----------
  app.get('/api/public/theme', async (req, res) => {
    try {
      res.set('Cache-Control', 'public, max-age=60');
      res.json({ month: life.monthKey(), theme: life.publicTheme(await currentTheme()) });
    } catch (e) { res.status(500).json({ error: 'Could not load this month\'s theme' }); }
  });

  app.get('/api/public/alumni', async (req, res) => {
    try {
      const chapter = oneLine(req.query.chapter, 80);
      const names = await chapterNames();
      const entries = await repo.getAll('alumniEntries', { status: 'approved', ...(chapter ? { chapterId: chapter } : {}) });
      entries.sort((a, b) => new Date(b.approvedAt || 0) - new Date(a.approvedAt || 0));
      res.set('Cache-Control', 'public, max-age=60');
      res.json({ count: entries.length, items: entries.map(e => life.publicAlumnus(e, names.get(e.chapterId))) });
    } catch (e) { res.status(500).json({ error: 'Could not load the alumni' }); }
  });

  app.get('/api/public/alumni/spotlight', async (req, res) => {
    try {
      const { weekKey, entry, pinned } = await currentSpotlight();
      const names = await chapterNames();
      res.set('Cache-Control', 'public, max-age=60');
      res.json({ weekKey, pinned, alumnus: entry ? life.publicAlumnus(entry, names.get(entry.chapterId)) : null });
    } catch (e) { res.status(500).json({ error: 'Could not load this week\'s spotlight' }); }
  });

  // Everything a chapter website needs, in one document. The site is built
  // from this by a scheduled job (site/tools/sync-feed.js) and never calls it
  // from a visitor's browser, which is what keeps the site up while this
  // server sleeps.
  app.get('/api/public/site-feed', async (req, res) => {
    try {
      const chapter = oneLine(req.query.chapter, 80);
      const names = await chapterNames();
      const entries = await repo.getAll('alumniEntries', { status: 'approved', ...(chapter ? { chapterId: chapter } : {}) });
      entries.sort((a, b) => new Date(b.approvedAt || 0) - new Date(a.approvedAt || 0) || String(a.id).localeCompare(String(b.id)));
      const { weekKey, entry } = await currentSpotlight();
      res.set('Cache-Control', 'no-store');
      res.json({
        version: 1,
        chapter,
        weekKey,
        month: life.monthKey(),
        theme: life.publicTheme(await currentTheme()),
        spotlight: entry ? life.publicAlumnus(entry, names.get(entry.chapterId)) : null,
        alumni: entries.map(e => life.publicAlumnus(e, names.get(e.chapterId)))
      });
    } catch (e) { res.status(500).json({ error: 'Could not build the site feed' }); }
  });

  // ---------- an alumnus asks to be listed ----------
  app.options('/api/public/alumni-requests', siteCors);
  app.post('/api/public/alumni-requests', siteCors, requestLimiter, photoUpload('photo'), async (req, res) => {
    const thanks = (name) => ({
      success: true,
      message: `Thank you${name ? ', ' + name.split(' ')[0] : ''}. Your request has gone to the admins for review. Once it is approved you will appear on the Alumni wall.`
    });
    try {
      // A hidden field no person ever sees or fills. A bot fills every field it
      // finds; it is told "thank you" and nothing is stored.
      if (oneLine(req.body.company, 100)) return res.json(thanks(''));

      if (String(req.body.consent) !== 'true') {
        return res.status(400).json({ error: 'Please tick the box to say you are happy for this to be shown publicly.' });
      }
      const { fields, error } = readFields(req.body);
      if (error) return res.status(400).json({ error });
      if (!req.file) return res.status(400).json({ error: 'Please add a photo of yourself.' });

      const chapter = await resolveChapter(req.body.chapterId);
      if (!chapter) return res.status(400).json({ error: 'Please choose the chapter you were part of.' });

      const pending = await repo.getAll('alumniEntries', { status: 'pending' });
      if (pending.length >= MAX_PENDING) {
        return res.status(503).json({ error: 'We have a lot of requests waiting at the moment. Please try again in a few days.' });
      }
      const dupe = pending.find(p => p.chapterId === chapter.id && p.name.toLowerCase() === fields.name.toLowerCase());
      if (dupe) return res.status(409).json({ error: 'We already have a request from you waiting for review. There is no need to send it again.' });

      let imageFileId;
      try { imageFileId = await storePortrait(req.file, fields.name); }
      catch (e) { return res.status(400).json({ error: 'We could not read that photo. Please send a JPG or PNG picture.' }); }

      const entry = await repo.create('alumniEntries', {
        ...fields,
        chapterId: chapter.id,
        imageFileId,
        contact: oneLine(req.body.contact, LIMITS.contact),
        status: 'pending',
        via: String(req.body.via) === 'site' ? 'site' : 'app'
      }, 'alum');
      res.json(thanks(fields.name));
      notifyAdminByEmail(
        'New Alumni request | ACONSU',
        `<p><strong>${escapeHtmlForEmail(entry.name)}</strong> (${escapeHtmlForEmail(chapter.name || chapter.id)}) asked to join the Alumni wall.</p>`
        + `<p>${escapeHtmlForEmail(entry.about)}</p><p>Open the National portal, Alumni, to approve or decline.</p>`
      );
    } catch (e) {
      res.status(500).json({ error: 'Could not send your request. Please try again.' });
    }
  });

  // ---------- an alumnus shares their details, to help build Alumni Connect ----------
  // The link that is passed around. No photo, nothing public: a record that National
  // or the chapter's admin can read and export, and use to invite the person into
  // Alumni Connect. Asking costs the sender one form and no account.
  const detailsLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: Number(process.env.ALUMNI_DETAILS_LIMIT_MAX) || 10,
    message: { error: 'Too many submissions from this device. Please try again in an hour.' },
    standardHeaders: true,
    legacyHeaders: false
  });
  const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
  const flag = (v) => String(v) === 'true';

  function readDetails(body) {
    const d = {
      name: oneLine(body.name, 80),
      classOf: String(body.classOf || '').replace(/[^0-9]/g, '').slice(0, 4),
      programme: oneLine(body.programme, 120),
      profession: oneLine(body.profession, 100),
      organisation: oneLine(body.organisation, 120),
      industry: oneLine(body.industry, 80),
      city: oneLine(body.city, 80),
      country: oneLine(body.country, 60) || 'Ghana',
      email: oneLine(body.email, 120).toLowerCase(),
      phone: oneLine(body.phone, 30).replace(/[^0-9+() -]/g, ''),
      openToMentoring: flag(body.openToMentoring),
      shareWithMembers: flag(body.shareWithMembers),
      showContact: flag(body.showContact)
    };
    if (d.name.length < 2) return { error: 'Please tell us your name.' };
    if (LINK_RE.test([d.name, d.programme, d.profession, d.organisation, d.industry, d.city, d.country].join(' '))) return { error: 'Please leave web links out.' };
    if (d.classOf && (Number(d.classOf) < 1950 || Number(d.classOf) > life.now().getUTCFullYear() + 1)) return { error: 'That year does not look right. Leave it blank if you are not sure.' };
    if (d.classOf.length !== 4) d.classOf = '';
    if (d.email && !EMAIL_RE.test(d.email)) return { error: 'That email address does not look right.' };
    if (d.phone && d.phone.replace(/[^0-9]/g, '').length < 7) return { error: 'That phone number does not look right.' };
    // Without a way to reach them the record cannot be used to invite anyone.
    if (!d.email && !d.phone) return { error: 'Please leave an email address or a phone number so we can reach you.' };
    if (d.showContact && !d.shareWithMembers) d.showContact = false;   // contact is only ever shown as part of a listing
    return { fields: d };
  }

  app.options('/api/public/alumni-details', siteCors);
  app.post('/api/public/alumni-details', siteCors, detailsLimiter, photoUpload('photo'), async (req, res) => {
    const thanks = (name) => ({
      success: true,
      message: `Thank you${name ? ', ' + name.split(' ')[0] : ''}. Your details have reached the ACONSU alumni team.`
    });
    try {
      if (oneLine(req.body.company, 100)) return res.json(thanks(''));   // a bot filled the hidden field
      if (!flag(req.body.consent)) {
        return res.status(400).json({ error: 'Please tick the box to agree that ACONSU may keep these details and use them to contact you.' });
      }
      const { fields, error } = readDetails(req.body);
      if (error) return res.status(400).json({ error });
      const chapter = await resolveChapter(req.body.chapterId);
      if (!chapter) return res.status(400).json({ error: 'Please choose the chapter you were part of.' });

      const all = await repo.getAll('alumniDetails', {});
      if (all.length >= MAX_DETAILS) return res.status(503).json({ error: 'We have a lot of submissions waiting at the moment. Please try again in a few days.' });

      // The same person sending twice (the link is passed around) updates their
      // record instead of making a second one. The answer is the same either way.
      const same = all.find(d => d.chapterId === chapter.id && d.status !== 'dismissed'
        && ((fields.email && d.email === fields.email) || (fields.phone && d.phone === fields.phone)
          || d.name.toLowerCase() === fields.name.toLowerCase()));
      const record = { ...fields, chapterId: chapter.id, consentedAt: new Date(), consentVersion: DETAILS_VERSION, via: String(req.body.via) === 'app' ? 'app' : 'site' };
      if (same) await repo.patchById('alumniDetails', same.id, record);
      else {
        await repo.create('alumniDetails', { ...record, status: 'new' }, 'adet');
        notifyAdminByEmail(
          'New alumni details | ACONSU',
          `<p><strong>${escapeHtmlForEmail(fields.name)}</strong> (${escapeHtmlForEmail(chapter.name || chapter.id)}) shared their details for Alumni Connect.</p>`
          + '<p>Open the National portal, Alumni, to see them and invite them in.</p>'
        );
      }
      res.json(thanks(fields.name));
    } catch (e) {
      res.status(500).json({ error: 'Could not send your details. Please try again.' });
    }
  });

  // ---------- reviewing the queue: National, and a chapter's own admin ----------
  // One set of handlers behind two doors. National reaches every chapter's
  // requests. A chapter's admin or coordinator reaches only their own chapter's,
  // and every lookup below carries that filter, so an id guessed from another
  // chapter is simply "not found". Choosing this week's spotlight is not here: it
  // is the whole church's celebration, so it stays with National.
  const chapterReviewerScope = (req) => {
    const s = rolesLib.getActingScope(req);
    if (s.isNational) return { chapterId: s.chapterId || '' };   // oversight: whatever they chose to look at
    return { chapterId: s.chapterId && s.chapterId !== '__none__' ? s.chapterId : null };
  };
  const requireChapterReviewer = (req, res, next) => {
    if (!isChapterAdminOrAbove(req) || chapterReviewerScope(req).chapterId === null) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return next();
  };
  const nationalScope = () => ({ chapterId: '' });

  function mountAlumniReview(base, guard, scopeOf) {
    const filterOf = (req) => { const c = scopeOf(req).chapterId; return c ? { chapterId: c } : {}; };
    const mine = (req) => scopeOf(req).chapterId || '';   // '' = every chapter (National)

    app.get(base, guard, async (req, res) => {
      try {
        const names = await chapterNames();
        const entries = (await repo.getAll('alumniEntries', filterOf(req))).map(e => ({ ...e, chapterName: names.get(e.chapterId) || '' }));
        const order = { pending: 0, approved: 1, unlisted: 2, declined: 3 };
        entries.sort((a, b) => (order[a.status] - order[b.status]) || (new Date(b.createdAt) - new Date(a.createdAt)));
        const spotlight = await currentSpotlight();
        res.json({
          counts: ['pending', 'approved', 'unlisted', 'declined'].reduce((o, s) => ({ ...o, [s]: entries.filter(e => e.status === s).length }), {}),
          spotlight: { weekKey: spotlight.weekKey, pinned: spotlight.pinned, entryId: spotlight.entry ? spotlight.entry.id : '' },
          items: entries
        });
      } catch (e) { res.status(500).json({ error: 'Could not load the alumni' }); }
    });

    // Add someone straight onto the wall - an alumnus who will never fill in a
    // form. A chapter's admin adds to their own chapter, whatever the request says.
    app.post(base, guard, photoUpload('photo'), async (req, res) => {
      try {
        const { fields, error } = readFields(req.body);
        if (error) return res.status(400).json({ error });
        const chapter = await resolveChapter(mine(req) || req.body.chapterId);
        if (!chapter) return res.status(400).json({ error: 'Choose the chapter this alumnus came through.' });
        let imageFileId = '';
        if (req.file) {
          try { imageFileId = await storePortrait(req.file, fields.name); }
          catch (e) { return res.status(400).json({ error: 'That does not look like a photo. Please use a JPG or PNG.' }); }
        }
        const item = await repo.create('alumniEntries', {
          ...fields, chapterId: chapter.id, imageFileId, status: 'approved', via: 'national',
          approvedAt: new Date(), approvedBy: actorName(req)
        }, 'alum');
        res.json({ success: true, item });
      } catch (e) { res.status(500).json({ error: 'Could not add the alumnus' }); }
    });

    // Fix a spelling before approving, or swap the photo.
    app.put(`${base}/:id`, guard, photoUpload('photo'), async (req, res) => {
      try {
        const existing = await repo.getById('alumniEntries', req.params.id, filterOf(req));
        if (!existing) return res.status(404).json({ error: 'Not found' });
        const { fields, error } = readFields({ ...existing, ...req.body });
        if (error) return res.status(400).json({ error });
        let chapterId = existing.chapterId;
        // Only National moves someone between chapters.
        if (!mine(req) && req.body.chapterId && req.body.chapterId !== existing.chapterId) {
          const chapter = await resolveChapter(req.body.chapterId);
          if (!chapter) return res.status(400).json({ error: 'That chapter does not exist.' });
          chapterId = chapter.id;
        }
        let imageFileId = existing.imageFileId || '';
        if (req.file) {
          try { imageFileId = await storePortrait(req.file, fields.name); }
          catch (e) { return res.status(400).json({ error: 'That does not look like a photo. Please use a JPG or PNG.' }); }
          dropFile(existing.imageFileId);
        }
        const item = await repo.patchById('alumniEntries', existing.id, { ...fields, chapterId, imageFileId });
        res.json({ success: true, item });
      } catch (e) { res.status(500).json({ error: 'Could not update the alumnus' }); }
    });

    app.post(`${base}/:id/decision`, guard, async (req, res) => {
      try {
        const entry = await repo.getById('alumniEntries', req.params.id, filterOf(req));
        if (!entry) return res.status(404).json({ error: 'Not found' });
        const decision = String(req.body.decision || '');
        let patch;
        if (decision === 'approve') {
          if (!['pending', 'unlisted'].includes(entry.status)) return res.status(400).json({ error: 'Only a waiting or unlisted request can be approved.' });
          if (!entry.imageFileId) return res.status(400).json({ error: 'This request has no photo. Add one first (Edit), then approve.' });
          patch = { status: 'approved', approvedAt: new Date(), approvedBy: actorName(req), declineReason: '' };
        } else if (decision === 'decline') {
          if (entry.status !== 'pending') return res.status(400).json({ error: 'Only a waiting request can be declined. Use Unlist to take someone down.' });
          // A declined stranger's photo is not kept.
          dropFile(entry.imageFileId);
          patch = { status: 'declined', declineReason: oneLine(req.body.reason, 200), imageFileId: '' };
        } else if (decision === 'unlist') {
          if (entry.status !== 'approved') return res.status(400).json({ error: 'Only someone on the wall can be unlisted.' });
          patch = { status: 'unlisted' };
        } else {
          return res.status(400).json({ error: 'Unknown decision' });
        }
        const item = await repo.patchById('alumniEntries', entry.id, patch);
        if (decision === 'unlist') {
          // If they were this week's celebrated alumnus, the week chooses again.
          const slot = (await repo.getAll('alumniSpotlights', { entryId: entry.id, weekKey: life.isoWeekKey() }))[0];
          if (slot) { await repo.removeById('alumniSpotlights', slot.id); await releaseWeek(entry.id, slot.weekKey); }
        }
        res.json({ success: true, item });
      } catch (e) { res.status(500).json({ error: 'Could not record that decision' }); }
    });

    app.delete(`${base}/:id`, guard, async (req, res) => {
      try {
        const entry = await repo.getById('alumniEntries', req.params.id, filterOf(req));
        if (!entry) return res.status(404).json({ error: 'Not found' });
        const slots = await repo.getAll('alumniSpotlights', { entryId: entry.id });
        for (const slot of slots) await repo.removeById('alumniSpotlights', slot.id);
        dropFile(entry.imageFileId);
        await repo.removeById('alumniEntries', entry.id);
        res.json({ success: true });
      } catch (e) { res.status(500).json({ error: 'Could not remove the alumnus' }); }
    });

    // ---- what alumni sent through the shared link ----
    // Same two doors as the wall: National sees every chapter, a chapter's admin
    // sees their own, and a guessed id from another chapter is simply not found.
    app.get(`${base}/details`, guard, async (req, res) => {
      try {
        const names = await chapterNames();
        const items = (await repo.getAll('alumniDetails', filterOf(req))).map(d => ({ ...d, chapterName: names.get(d.chapterId) || '' }));
        const order = { new: 0, invited: 1, added: 2, dismissed: 3 };
        items.sort((a, b) => (order[a.status] - order[b.status]) || (new Date(b.createdAt) - new Date(a.createdAt)));
        res.json({ counts: ['new', 'invited', 'added', 'dismissed'].reduce((o, st) => ({ ...o, [st]: items.filter(d => d.status === st).length }), {}), items });
      } catch (e) { res.status(500).json({ error: 'Could not load the details' }); }
    });

    app.post(`${base}/details/:id/status`, guard, async (req, res) => {
      try {
        const status = String(req.body.status || '');
        if (!['new', 'invited', 'added', 'dismissed'].includes(status)) return res.status(400).json({ error: 'Unknown status' });
        const d = await repo.getById('alumniDetails', req.params.id, filterOf(req));
        if (!d) return res.status(404).json({ error: 'Not found' });
        res.json({ success: true, item: await repo.patchById('alumniDetails', d.id, { status }) });
      } catch (e) { res.status(500).json({ error: 'Could not update that' }); }
    });

    app.delete(`${base}/details/:id`, guard, async (req, res) => {
      try {
        const d = await repo.getById('alumniDetails', req.params.id, filterOf(req));
        if (!d) return res.status(404).json({ error: 'Not found' });
        await repo.removeById('alumniDetails', d.id);
        res.json({ success: true });
      } catch (e) { res.status(500).json({ error: 'Could not remove that' }); }
    });

    // A spreadsheet to build Alumni Connect from. Every cell goes through csvSafe so
    // a name typed as =HYPERLINK(...) is text on the treasurer's laptop, not a formula.
    app.get(`${base}/details.csv`, guard, async (req, res) => {
      try {
        const names = await chapterNames();
        const items = (await repo.getAll('alumniDetails', filterOf(req))).filter(d => d.status !== 'dismissed');
        const cols = [
          ['Name', d => d.name], ['Chapter', d => names.get(d.chapterId) || d.chapterId], ['Class of', d => d.classOf], ['Programme', d => d.programme],
          ['Profession', d => d.profession], ['Organisation', d => d.organisation], ['Industry', d => d.industry], ['City', d => d.city], ['Country', d => d.country],
          ['Open to mentoring', d => d.openToMentoring ? 'yes' : 'no'], ['Email', d => d.email], ['Phone', d => d.phone],
          ['Agreed to be shown to members', d => d.shareWithMembers ? 'yes' : 'no'], ['Agreed to show contact', d => d.showContact ? 'yes' : 'no'],
          ['Status', d => d.status], ['Sent', d => d.createdAt ? new Date(d.createdAt).toISOString().slice(0, 10) : '']
        ];
        const cell = (v) => '"' + csvSafe(v).replace(/"/g, '""') + '"';
        const csv = '\ufeff' + [cols.map(c => cell(c[0])).join(',')].concat(items.map(d => cols.map(c => cell(c[1](d))).join(','))).join('\r\n');
        res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="alumni-details.csv"', 'Cache-Control': 'no-store' });
        res.send(csv);
      } catch (e) { res.status(500).json({ error: 'Could not build the spreadsheet' }); }
    });
  }
  mountAlumniReview('/api/national/alumni', requireNational, nationalScope);
  mountAlumniReview('/api/admin/alumni', requireChapterReviewer, chapterReviewerScope);

  // ---------- National: this week's spotlight ----------
  app.post('/api/national/alumni/spotlight/pin', requireNational, async (req, res) => {
    try {
      const entry = await repo.getById('alumniEntries', String(req.body.entryId || ''));
      if (!entry || entry.status !== 'approved') return res.status(400).json({ error: 'Only someone on the wall can be celebrated.' });
      const weekKey = life.isoWeekKey();
      const existing = (await repo.getAll('alumniSpotlights', { weekKey }))[0];
      if (existing && existing.entryId !== entry.id) {
        await releaseWeek(existing.entryId, weekKey); // the rotation's pick gets its turn back
        await repo.updateById('alumniSpotlights', existing.id, { ...existing, entryId: entry.id, pinned: true });
      } else if (existing) {
        await repo.updateById('alumniSpotlights', existing.id, { ...existing, pinned: true });
      } else {
        await repo.create('alumniSpotlights', { weekKey, entryId: entry.id, pinned: true }, 'spot');
      }
      await claimWeek(await repo.getById('alumniEntries', entry.id), weekKey);
      res.json({ success: true, weekKey });
    } catch (e) { res.status(500).json({ error: 'Could not pin the spotlight' }); }
  });

  // Hand the week back to the rotation.
  app.delete('/api/national/alumni/spotlight/pin', requireNational, async (req, res) => {
    try {
      const weekKey = life.isoWeekKey();
      const existing = (await repo.getAll('alumniSpotlights', { weekKey }))[0];
      if (existing) {
        await repo.removeById('alumniSpotlights', existing.id);
        await releaseWeek(existing.entryId, weekKey);
      }
      const next = await currentSpotlight();
      res.json({ success: true, entryId: next.entry ? next.entry.id : '' });
    } catch (e) { res.status(500).json({ error: 'Could not release the spotlight' }); }
  });


  // ---------- the monthly theme ----------
  // One theme for the whole church per month. National can write it directly. A
  // chapter's admin can only PROPOSE one: it waits, and shows nowhere, until
  // National approves it. Once approved a chapter can no longer change it - the
  // church's theme must not move under a chapter's hand after it has gone live.
  const flyerUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: PHOTO_LIMIT_BYTES * 2, files: MAX_FLYERS } }).array('flyers', MAX_FLYERS);
  const flyers = (req, res, next) => flyerUpload(req, res, (err) => err
    ? res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'A flyer is too large (16MB at most).' : `Up to ${MAX_FLYERS} flyers, images only.` })
    : rejectOperatorKeys(req, res, next));

  // Reads the form, stores the new flyers and drops the ones taken off. Returns
  // { data } for the record, or { error }.
  async function themeFromRequest(req, existing, month) {
    const title = oneLine(req.body.title, 120);
    if (!title) return { error: 'The theme needs a title.' };
    // Flyers the form still shows are kept; the rest are removed. Anything not
    // in the existing record cannot be "kept" - the ids are checked.
    let keep = [];
    try { keep = JSON.parse(req.body.keepFlyers || '[]'); } catch (e) { keep = []; }
    const have = (existing && existing.flyerFileIds) || [];
    keep = (Array.isArray(keep) ? keep : []).filter(id => have.includes(id));
    const incoming = (req.files || []).filter(f => String(f.mimetype).startsWith('image/'));
    if (keep.length + incoming.length > MAX_FLYERS) return { error: `At most ${MAX_FLYERS} flyers for a month.` };
    const added = [];
    for (const f of incoming) {
      const c = await compressIfImage(f.buffer, f.mimetype);
      added.push(String(await gridfs.uploadBuffer(c.buffer, f.originalname, {
        category: 'monthlyTheme', contentType: c.contentType, title, chapterId: rolesLib.NATIONAL_CHAPTER_ID
      })));
    }
    have.filter(id => !keep.includes(id)).forEach(dropFile);
    return {
      data: {
        month, title,
        scripture: oneLine(req.body.scripture, 200),
        blurb: String(req.body.blurb || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 1200),
        flyerFileIds: [...keep, ...added]
      }
    };
  }
  const approvedFor = async (month) => (await repo.getAll('monthlyThemes', { month, status: 'approved' }))[0] || null;
  const dropTheme = async (theme) => {
    (theme.flyerFileIds || []).forEach(dropFile);
    await repo.removeById('monthlyThemes', theme.id);
  };

  app.get('/api/national/themes', requireNational, async (req, res) => {
    try {
      const names = await chapterNames();
      const themes = (await repo.getAll('monthlyThemes', {})).map(t => ({ ...t, chapterName: names.get(t.proposedByChapterId) || '' }));
      const order = { pending: 0, approved: 1, declined: 2 };
      themes.sort((a, b) => String(b.month).localeCompare(String(a.month)) || (order[a.status] - order[b.status]));
      const month = life.monthKey();
      const d = life.now();
      const nextMonth = life.monthKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
      const live = themes.filter(t => t.status === 'approved');
      res.json({
        month, nextMonth,
        hasCurrent: live.some(t => t.month === month),
        hasNext: live.some(t => t.month === nextMonth),
        pending: themes.filter(t => t.status === 'pending').length,
        items: themes
      });
    } catch (e) { res.status(500).json({ error: 'Could not load the themes' }); }
  });

  // National writes the church's theme for a month directly: it is live as soon
  // as it is saved.
  app.put('/api/national/themes/:month', requireNational, flyers, async (req, res) => {
    try {
      const month = req.params.month;
      if (!life.isMonthKey(month)) return res.status(400).json({ error: 'The month must look like 2026-11.' });
      const existing = await approvedFor(month);
      const out = await themeFromRequest(req, existing, month);
      if (out.error) return res.status(400).json({ error: out.error });
      const data = { ...out.data, status: 'approved', declineReason: '', decidedAt: new Date(), decidedBy: actorName(req) };
      const item = existing
        ? await repo.updateById('monthlyThemes', existing.id, { ...existing, ...data })
        : await repo.create('monthlyThemes', { ...data, proposedByChapterId: '', proposedByName: actorName(req) }, 'theme');
      res.json({ success: true, item });
    } catch (e) { res.status(500).json({ error: 'Could not save the theme' }); }
  });

  // Approve or decline a chapter's proposal.
  app.post('/api/national/themes/:id/decision', requireNational, async (req, res) => {
    try {
      const theme = await repo.getById('monthlyThemes', req.params.id);
      if (!theme) return res.status(404).json({ error: 'Not found' });
      const decision = String(req.body.decision || '');
      if (decision === 'approve') {
        if (theme.status === 'approved') return res.status(400).json({ error: 'That theme is already live.' });
        // One live theme per month: approving this one replaces the one that was.
        const live = await approvedFor(theme.month);
        if (live) await dropTheme(live);
        const item = await repo.patchById('monthlyThemes', theme.id, { status: 'approved', declineReason: '', decidedAt: new Date(), decidedBy: actorName(req) });
        return res.json({ success: true, item, replaced: !!live });
      }
      if (decision === 'decline') {
        if (theme.status !== 'pending') return res.status(400).json({ error: 'Only a waiting proposal can be declined.' });
        const item = await repo.patchById('monthlyThemes', theme.id, { status: 'declined', declineReason: oneLine(req.body.reason, 200), decidedAt: new Date(), decidedBy: actorName(req) });
        return res.json({ success: true, item });
      }
      return res.status(400).json({ error: 'Unknown decision' });
    } catch (e) { res.status(500).json({ error: 'Could not record that decision' }); }
  });

  app.delete('/api/national/themes/:id', requireNational, async (req, res) => {
    try {
      const theme = await repo.getById('monthlyThemes', req.params.id);
      if (!theme) return res.status(404).json({ error: 'Not found' });
      await dropTheme(theme);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Could not remove the theme' }); }
  });

  // A chapter's admin: their own proposals, and which months already have a
  // theme so they are not proposing for nothing.
  app.get('/api/admin/themes', requireChapterReviewer, async (req, res) => {
    try {
      const chapterId = chapterReviewerScope(req).chapterId;
      const month = life.monthKey();
      const d = life.now();
      const nextMonth = life.monthKey(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
      const all = await repo.getAll('monthlyThemes', {});
      const mineOnly = chapterId ? all.filter(t => t.proposedByChapterId === chapterId) : [];
      mineOnly.sort((a, b) => String(b.month).localeCompare(String(a.month)));
      res.json({
        month, nextMonth,
        live: all.filter(t => t.status === 'approved' && t.month >= month).map(t => ({ month: t.month, title: t.title }))
          .sort((a, b) => a.month.localeCompare(b.month)),
        items: mineOnly
      });
    } catch (e) { res.status(500).json({ error: 'Could not load the themes' }); }
  });

  app.put('/api/admin/themes/:month', requireChapterReviewer, flyers, async (req, res) => {
    try {
      const chapterId = chapterReviewerScope(req).chapterId;
      if (!chapterId) return res.status(400).json({ error: 'Propose a theme from your own chapter\'s admin account.' });
      const month = req.params.month;
      if (!life.isMonthKey(month)) return res.status(400).json({ error: 'The month must look like 2026-11.' });
      if (month < life.monthKey()) return res.status(400).json({ error: 'That month has already passed.' });
      const existing = (await repo.getAll('monthlyThemes', { month, proposedByChapterId: chapterId }))[0] || null;
      if (existing && existing.status === 'approved') {
        return res.status(403).json({ error: 'That theme is already approved and live. Ask National if it needs to change.' });
      }
      const out = await themeFromRequest(req, existing, month);
      if (out.error) return res.status(400).json({ error: out.error });
      // Whatever it was before - new, waiting or declined - it is now waiting.
      const data = { ...out.data, status: 'pending', declineReason: '', decidedAt: null, decidedBy: '' };
      const item = existing
        ? await repo.updateById('monthlyThemes', existing.id, { ...existing, ...data })
        : await repo.create('monthlyThemes', { ...data, proposedByChapterId: chapterId, proposedByName: actorName(req) }, 'theme');
      res.json({ success: true, item });
      const names = await chapterNames();
      notifyAdminByEmail(
        'Monthly theme waiting for approval | ACONSU',
        `<p><strong>${escapeHtmlForEmail(names.get(chapterId) || chapterId)}</strong> proposed a theme for ${escapeHtmlForEmail(month)}: `
        + `<strong>${escapeHtmlForEmail(item.title)}</strong>.</p><p>Open the National portal, Monthly Theme, to approve or decline.</p>`
      );
    } catch (e) { res.status(500).json({ error: 'Could not send the theme' }); }
  });

  // Withdraw a proposal that has not gone live.
  app.delete('/api/admin/themes/:id', requireChapterReviewer, async (req, res) => {
    try {
      const chapterId = chapterReviewerScope(req).chapterId;
      const theme = chapterId ? await repo.getById('monthlyThemes', req.params.id, { proposedByChapterId: chapterId }) : null;
      if (!theme) return res.status(404).json({ error: 'Not found' });
      if (theme.status === 'approved') return res.status(403).json({ error: 'That theme is already live. Ask National to remove it.' });
      await dropTheme(theme);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Could not withdraw the theme' }); }
  });

  return { currentSpotlight, currentTheme };
}

module.exports = { registerChurchLifeRoutes };
