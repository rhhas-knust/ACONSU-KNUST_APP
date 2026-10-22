// A chapter's look is its own.
//
// A chapter's site settings, artwork, media, custom pages and department pages
// belong to that chapter. The main admin (the break-glass login behind the
// admin dashboard) can change them only while the chapter has asked it to: its
// Chapter Admin or Chapter Coordinator sends a request saying what they need,
// and for as long as that request is open - until it is marked done, withdrawn,
// or its days run out - the main admin may change that chapter's look, and only
// that chapter's.
//
// A chapter with no admin of its own yet has nobody to ask, so the main admin
// can still set it up. That is the only exception.
//
// The main admin owns the deployment, so this is a rule of conduct that every
// normal route keeps, not a wall against someone holding the server's keys.

// The writes that change how a chapter looks to the people who visit it.
const CHAPTER_LOOK_WRITES = [
  /^\/api\/admin\/chapter-settings\b/,   // name, about, contact, banner
  /^\/api\/admin\/hero-art\b/,           // the artwork on each page
  /^\/api\/admin\/uploads\b/,            // the media library and image placements
  /^\/api\/admin\/files\b/,
  /^\/api\/admin\/departments\b/,        // department pages and their headers
  /^\/api\/admin\/pages\b/,              // custom pages
  /^\/api\/admin\/content\b/             // the content hub: live service, seminars, highlights
];
const isLookWrite = (req) => !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
  && CHAPTER_LOOK_WRITES.some((re) => re.test(req.path));

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

  // Which chapter a main-admin write is aimed at: the one it names, the one
  // chosen in the dashboard, or the only chapter there is. Blank means the
  // write is national (the public app itself), which is the main admin's own.
  function targetChapter(req) {
    const body = req.body || {};
    const named = typeof body.chapterId === 'string' && body.chapterId && body.chapterId !== rolesLib.NATIONAL_SCOPE ? body.chapterId : '';
    return named || rolesLib.selectedChapterId(req) || rolesLib.getSoleActiveChapterId() || '';
  }

  async function lookStatus(chapterId) {
    const chapter = chapterId ? await repo.getById('chapters', chapterId) : null;
    if (!chapter) return { chapterId: '', canChangeLook: true, reason: 'national' };
    const request = await openRequestFor(chapterId);
    if (request) return { chapterId, chapterName: chapter.name, canChangeLook: true, reason: 'asked', request };
    if (!(await hasOwnAdmin(chapterId))) return { chapterId, chapterName: chapter.name, canChangeLook: true, reason: 'setup' };
    return { chapterId, chapterName: chapter.name, canChangeLook: false, reason: 'not_asked' };
  }

  // ---------- the rule ----------
  app.use(async (req, res, next) => {
    if (!isLookWrite(req) || !isMainAdmin(req)) return next();
    try {
      const status = await lookStatus(targetChapter(req));
      if (status.canChangeLook) return next();
      return res.status(403).json({
        error: `${status.chapterName}'s look belongs to ${status.chapterName}. The main admin can change it only when the chapter asks: their Chapter Admin or Coordinator sends a request from their dashboard (Ask National).`,
        needsChapterRequest: true, chapterId: status.chapterId
      });
    } catch (e) {
      return res.status(500).json({ error: 'Could not check whether this chapter asked for help.' });
    }
  });

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
}

module.exports = { registerChapterRequestRoutes, CHAPTER_LOOK_WRITES };
