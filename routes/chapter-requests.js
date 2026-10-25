// A chapter is its own.
//
// A chapter's look (its site settings, artwork, media, custom pages and
// department pages), its events, its members and its leadership accounts
// belong to that chapter. The main admin (the break-glass login behind the
// admin dashboard) can change them only while the chapter has asked it to: its
// Chapter Admin or Chapter Coordinator sends a request saying what they need,
// and for as long as that request is open - until it is marked done, withdrawn,
// or its days run out - the main admin may change that chapter, and only that
// chapter. It can always look.
//
// A chapter with no admin of its own yet has nobody to ask, so the main admin
// can still set it up. That is the only exception. Appointing a chapter's
// Coordinator from the National portal (/api/national/...) is national's own
// duty and stays open, which is also how a chapter locked out of every account
// is given a way back in.
//
// The main admin owns the deployment, so this is a rule of conduct that every
// normal route keeps, not a wall against someone holding the server's keys.

// What each part is called when the main admin is told why it was refused.
const AREAS = {
  look: 'look (its site settings, artwork, media, pages and department pages)',
  events: 'events',
  members: 'members',
  accounts: 'leadership accounts and executive offices'
};

// The writes that are a chapter's own. A rule with a `resource` also catches
// the id of the one record a write is aimed at, so the chapter checked is that
// record's own, whatever chapter the request names. `national` says when a
// write is the union's rather than a chapter's: a national event, a national
// executive, a National Coordinator's account. Those are the main admin's.
const isEventNational = (req, record) => (record
  ? record.isNational === true && (req.body || {}).isNational !== false
  : (req.body || {}).isNational === true);
const isExecutiveNational = (req, record, rolesLib) => (record
  ? !record.chapterId
  : String((req.body || {}).chapterId || '') === rolesLib.NATIONAL_SCOPE);
const isStaffNational = (req, record) => (record
  ? record.role === 'nationalCoordinator'
  : (req.body || {}).role === 'nationalCoordinator');

const CHAPTER_OWN_WRITES = [
  { area: 'look', re: /^\/api\/admin\/chapter-settings\b/ },
  { area: 'look', re: /^\/api\/admin\/hero-art\b/ },
  { area: 'look', re: /^\/api\/admin\/uploads\b/ },
  { area: 'look', re: /^\/api\/admin\/files\b/ },
  { area: 'look', re: /^\/api\/admin\/departments(?:\/([^/]+))?/, resource: 'departments' },
  { area: 'look', re: /^\/api\/admin\/pages(?:\/([^/]+))?/, resource: 'pages' },
  { area: 'look', re: /^\/api\/admin\/content(?:\/([^/]+))?/, resource: 'contentItems' },
  { area: 'events', re: /^\/api\/admin\/events(?:\/([^/]+))?/, resource: 'events', national: isEventNational },
  { area: 'events', re: /^\/api\/publicity\/events(?:\/([^/]+))?/, resource: 'events', national: isEventNational },
  { area: 'events', re: /^\/api\/executive\/events\b/ },
  { area: 'events', re: /^\/api\/events\/([^/]+)\/volunteers\b/, resource: 'events' },
  { area: 'members', re: /^\/api\/admin\/members\/([^/]+)/, resource: 'members' },
  { area: 'members', re: /^\/api\/admin\/join-requests\/([^/]+)/, resource: 'joinRequests' },
  { area: 'members', re: /^\/api\/admin\/alumni\/([^/]+)/, resource: 'alumniProfiles' },
  { area: 'members', re: /^\/api\/admin\/executive-applications\/([^/]+)/, resource: 'members' },
  { area: 'members', re: /^\/api\/shepherd\/members\/([^/]+)/, resource: 'members' },
  { area: 'members', re: /^\/api\/shepherd\/team(?:\/([^/]+))?/, resource: 'members' },
  { area: 'members', re: /^\/api\/shepherd\/import\b/ },
  { area: 'members', re: /^\/api\/shepherd\/records\/([^/]+)\/(?:link|unlink)$/, resource: 'shepherdingRecords' },
  { area: 'accounts', re: /^\/api\/admin\/staff(?:\/([^/]+))?/, resource: 'staffUsers', national: isStaffNational },
  { area: 'accounts', re: /^\/api\/admin\/executives(?:\/([^/]+))?/, resource: 'executives', national: isExecutiveNational },
  { area: 'accounts', re: /^\/api\/coordinator\/offices\b/ }
];
// The look's writes alone, as the first version of this rule had them.
const CHAPTER_LOOK_WRITES = CHAPTER_OWN_WRITES.filter((r) => r.area === 'look').map((r) => r.re);

// Writes sent with a file. Their fields (the chapter they name among them) are
// read only once the file is, so they are checked then, behind the upload
// (see `upload` in server.js), and not before. Every one of these must go
// through that upload step: test/chapter-look.js sends each one.
const UPLOAD_WRITES = [
  ['POST', /^\/api\/admin\/uploads$/],
  ['POST', /^\/api\/admin\/chapter-settings\/banner$/],
  ['POST', /^\/api\/admin\/executives$/],
  ['PUT', /^\/api\/admin\/executives\/[^/]+$/],
  ['POST', /^\/api\/admin\/content$/],
  ['PUT', /^\/api\/admin\/content\/[^/]+$/]
];

const ruleFor = (req) => (['GET', 'HEAD', 'OPTIONS'].includes(req.method)
  ? null
  : CHAPTER_OWN_WRITES.find((r) => r.re.test(req.path)) || null);
const isMultipart = (req) => /^multipart\/form-data/i.test(String((req.headers && req.headers['content-type']) || ''));
const checkedAfterUpload = (req) => isMultipart(req) && UPLOAD_WRITES.some(([m, re]) => m === req.method && re.test(req.path));

const MAX_OPEN = 3;
const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;

function registerChapterRequestRoutes(app, deps) {
  const { repo, models, rolesLib, currentStaff, actorName } = deps;

  const isMainAdmin = (req) => !!(req.session && req.session.isAdmin);
  const isNationalStaff = (req) => { const s = currentStaff(req); return !!(s && s.role === 'nationalCoordinator'); };
  // The chapter's own leadership: who may ask.
  const chapterLead = (req) => {
    const s = currentStaff(req);
    return s && ['chapterAdmin', 'coordinator'].includes(s.role) && s.chapterId ? s : null;
  };

  async function openRequestFor(chapterId) {
    const open = await repo.getAll('chapterRequests', { chapterId, status: 'open' });
    const now = Date.now();
    return open
      .filter((r) => !r.expiresAt || new Date(r.expiresAt).getTime() > now)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
  }

  async function hasOwnAdmin(chapterId) {
    const n = await models.StaffUser.countDocuments({ chapterId, role: { $in: ['chapterAdmin', 'coordinator'] }, active: true });
    return n > 0;
  }

  // Which chapter the dashboard is looking at: the one a write names, the one
  // chosen in the dashboard, or the only chapter there is. Blank is national.
  function targetChapter(req) {
    const body = req.body || {};
    const named = typeof body.chapterId === 'string' && body.chapterId && body.chapterId !== rolesLib.NATIONAL_SCOPE ? body.chapterId : '';
    return named || rolesLib.selectedChapterId(req) || rolesLib.getSoleActiveChapterId() || '';
  }

  // Which chapters a main-admin write could touch: the one it names, the one
  // chosen in the dashboard (or the only chapter there is), and the chapter of
  // the record it is aimed at. Every one has to allow it, so naming a chapter
  // that allows it while working on one that does not gets nowhere. None at
  // all means the write is national (the public app itself), the main admin's
  // own.
  async function chaptersTouched(req, rule) {
    const body = req.body || {};
    const id = rule.resource ? (rule.re.exec(req.path) || [])[1] : '';
    let record = null;
    if (id) { try { record = await repo.getById(rule.resource, decodeURIComponent(id)); } catch (e) { record = null; } }
    if (rule.national && rule.national(req, record, rolesLib)) return [];
    const named = typeof body.chapterId === 'string' && body.chapterId && body.chapterId !== rolesLib.NATIONAL_SCOPE ? body.chapterId : '';
    const chosen = rolesLib.selectedChapterId(req) || rolesLib.getSoleActiveChapterId() || '';
    return [...new Set([record && record.chapterId, named, chosen].filter(Boolean))];
  }

  async function lookStatus(chapterId) {
    const chapter = chapterId ? await repo.getById('chapters', chapterId) : null;
    if (!chapter) return { chapterId: '', canChange: true, canChangeLook: true, reason: 'national' };
    const request = await openRequestFor(chapterId);
    if (request) return { chapterId, chapterName: chapter.name, canChange: true, canChangeLook: true, reason: 'asked', request };
    if (!(await hasOwnAdmin(chapterId))) return { chapterId, chapterName: chapter.name, canChange: true, canChangeLook: true, reason: 'setup' };
    return { chapterId, chapterName: chapter.name, canChange: false, canChangeLook: false, reason: 'not_asked' };
  }

  // ---------- the rule ----------
  async function guard(req, res, next) {
    const rule = ruleFor(req);
    if (!rule || !isMainAdmin(req)) return next();
    try {
      for (const chapterId of await chaptersTouched(req, rule)) {
        const status = await lookStatus(chapterId);
        if (status.canChange) continue;
        const name = status.chapterName;
        return res.status(403).json({
          error: `${name}'s ${AREAS[rule.area]} belong to ${name}. The main admin can change them only when the chapter asks: their Chapter Admin or Coordinator sends a request from their dashboard (Ask National).`,
          needsChapterRequest: true, chapterId: status.chapterId, area: rule.area
        });
      }
      return next();
    } catch (e) {
      return res.status(500).json({ error: 'Could not check whether this chapter asked for help.' });
    }
  }
  app.use((req, res, next) => (checkedAfterUpload(req) ? next() : guard(req, res, next)));

  // ---------- reading ----------
  // The dashboard asks before it draws a look panel, so it can say why the
  // buttons are missing instead of letting every one of them be refused.
  app.get('/api/chapter-requests/status', async (req, res) => {
    try {
      if (!isMainAdmin(req) && !isNationalStaff(req) && !chapterLead(req)) return res.status(401).json({ error: 'Not authenticated' });
      const lead = chapterLead(req);
      const chapterId = lead ? lead.chapterId : String(req.query.chapterId || '') || targetChapter(req);
      res.json(await lookStatus(chapterId));
    } catch (e) {
      res.status(500).json({ error: 'Could not load this.' });
    }
  });

  app.get('/api/chapter-requests', async (req, res) => {
    try {
      const lead = chapterLead(req);
      if (!lead && !isMainAdmin(req) && !isNationalStaff(req)) return res.status(401).json({ error: 'Not authenticated' });
      const filter = lead ? { chapterId: lead.chapterId } : {};
      const [items, chapters] = await Promise.all([repo.getAll('chapterRequests', filter), repo.getAll('chapters', {})]);
      const names = new Map(chapters.map((c) => [c.id, c.name]));
      const now = Date.now();
      const shaped = items.map((r) => {
        const expired = r.status === 'open' && r.expiresAt && new Date(r.expiresAt).getTime() <= now;
        return { ...r, chapterName: names.get(r.chapterId) || r.chapterId, status: expired ? 'expired' : r.status };
      }).sort((a, b) => ((a.status === 'open') === (b.status === 'open') ? new Date(b.createdAt) - new Date(a.createdAt) : a.status === 'open' ? -1 : 1));
      res.json({ items: shaped, open: shaped.filter((r) => r.status === 'open').length, mayAsk: !!lead });
    } catch (e) {
      res.status(500).json({ error: 'Could not load the requests.' });
    }
  });

  // ---------- asking ----------
  app.post('/api/chapter-requests', async (req, res) => {
    try {
      const lead = chapterLead(req);
      if (!lead) return res.status(403).json({ error: 'Only a Chapter Admin or Chapter Coordinator can ask National for help with the chapter\'s look.' });
      const message = String((req.body && req.body.message) || '').replace(/\r\n?/g, '\n').trim().slice(0, 1000);
      if (message.length < 5) return res.status(400).json({ error: 'Say what you need changed, so National knows what to do.' });
      const days = Math.max(1, Math.min(MAX_DAYS, parseInt(req.body && req.body.days, 10) || DEFAULT_DAYS));
      const open = (await repo.getAll('chapterRequests', { chapterId: lead.chapterId, status: 'open' }))
        .filter((r) => !r.expiresAt || new Date(r.expiresAt) > new Date());
      if (open.length >= MAX_OPEN) return res.status(409).json({ error: `You already have ${MAX_OPEN} requests open. Close one before asking again.` });
      const item = await repo.create('chapterRequests', {
        chapterId: lead.chapterId, message, status: 'open',
        requestedBy: lead.id, requestedByName: actorName(req), requestedByRole: rolesLib.roleLabel(lead.role),
        expiresAt: new Date(Date.now() + days * 86400000)
      }, 'creq');
      res.json({ success: true, item });
    } catch (e) {
      res.status(500).json({ error: 'Could not send the request.' });
    }
  });

  // The chapter withdraws it (it no longer wants help), or the main admin marks
  // it done. Either way, the door closes at once.
  app.post('/api/chapter-requests/:id/close', async (req, res) => {
    try {
      const lead = chapterLead(req);
      const main = isMainAdmin(req);
      if (!lead && !main) return res.status(403).json({ error: 'Only the chapter that asked, or the main admin, can close a request.' });
      const filter = lead ? { chapterId: lead.chapterId, status: 'open' } : { status: 'open' };
      const item = await repo.patchById('chapterRequests', req.params.id, {
        status: lead ? 'withdrawn' : 'done', closedAt: new Date(), closedBy: actorName(req) || 'Main admin',
        closedNote: String((req.body && req.body.note) || '').trim().slice(0, 500)
      }, filter);
      if (!item) return res.status(404).json({ error: 'That request is not open.' });
      res.json({ success: true, item });
    } catch (e) {
      res.status(500).json({ error: 'Could not close the request.' });
    }
  });

  // For server.js's upload step: the same rule, once a file's fields are read.
  return { guardAfterUpload: (req, res, next) => (checkedAfterUpload(req) ? guard(req, res, next) : next()) };
}

module.exports = { registerChapterRequestRoutes, CHAPTER_LOOK_WRITES, CHAPTER_OWN_WRITES, UPLOAD_WRITES };
