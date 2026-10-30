// The visitor QR code at the door. Shepherding makes a code for one service
// on one day and shows it, on a phone or printed. A visitor scans it with
// their own phone, which opens a short form in the browser (public/welcome.html):
// their name and number, a few optional details, and agreement to keep them.
// They are then checked in to that service, exactly as if the door had added
// them: someone already on the chapter's list, by phone number and a name that
// agrees, is checked in as themselves; anyone else is added to the list as new,
// for Shepherding to follow up.
//
// The code carries a random token, never an id. It works only on its own day,
// Shepherding can turn it off or replace it at any time, and the form answers
// the same whether or not the number was already known, so it cannot be used
// to find out who is on the list.

const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const peopleImport = require('../lib/peopleImport');
const attendance = require('../lib/attendance');
const baseUrl = require('../lib/baseUrl');

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const DAYS_AHEAD = 14; // a code can be made (and printed) up to two weeks before
const MAX_USES = 500;  // more check-ins than this on one code is not a congregation
const HEARD = { friend: 'a friend', whatsapp: 'WhatsApp or social media', poster: 'a poster or flyer', passing: 'walking past', other: 'somewhere else' };

const today = () => new Date().toISOString().slice(0, 10); // Ghana keeps UTC all year
const plusDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const oneLine = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function registerDoorCheckinRoutes(app, deps) {
  const { repo, models, rolesLib, requireShepherd, requireAttendanceTaker, actorName } = deps;

  const chapterOf = (req) => {
    const scope = rolesLib.chapterFilter(req);
    return scope.chapterId && scope.chapterId !== '__no_access__' ? scope.chapterId : null;
  };
  const serviceOf = (raw) => (attendance.SERVICE_TYPES.includes(raw) ? raw : 'sunday');

  // What Shepherding sees of a code: the link it opens and the picture of it.
  async function view(req, code) {
    const site = baseUrl.forLinks(req);
    if (!site) return { ...code, url: '', qr: '', error: 'The app\'s web address is not set, so a code cannot point anywhere yet (PUBLIC_BASE_URL).' };
    const url = `${site}/welcome.html?c=${encodeURIComponent(code.token)}`;
    return {
      id: code.id, date: code.date, serviceType: code.serviceType, active: code.active, uses: code.uses || 0,
      url, qr: await QRCode.toDataURL(url, { margin: 2, width: 480, errorCorrectionLevel: 'M' })
    };
  }

  const current = async (chapterId, date, serviceType) =>
    (await repo.getAll('doorCodes', { chapterId, date, serviceType, active: true }))[0] || null;

  // ---------- Shepherding's side ----------
  // The code for a service, if one has been made. Anyone working the door may
  // show it; only Shepherding makes, replaces or turns one off.
  app.get('/api/shepherd/door-code', requireAttendanceTaker, async (req, res) => {
    try {
      const chapterId = chapterOf(req);
      if (!chapterId) return res.status(403).json({ error: 'Open your chapter first.' });
      const date = DATE.test(String(req.query.date || '')) ? String(req.query.date) : today();
      const code = await current(chapterId, date, serviceOf(req.query.serviceType));
      res.json({ code: code ? await view(req, code) : null, today: today() });
    } catch (e) { res.status(500).json({ error: 'Could not load the visitor code' }); }
  });

  app.post('/api/shepherd/door-code', requireShepherd, async (req, res) => {
    try {
      const chapterId = chapterOf(req);
      if (!chapterId) return res.status(403).json({ error: 'Open your chapter first.' });
      const body = req.body || {};
      const date = DATE.test(String(body.date || '')) ? String(body.date) : today();
      if (date < today()) return res.status(400).json({ error: 'That day has passed. A code works only on its own day.' });
      if (date > plusDays(today(), DAYS_AHEAD)) return res.status(400).json({ error: `Make the code within ${DAYS_AHEAD} days of the service.` });
      const serviceType = serviceOf(body.serviceType);
      const existing = await current(chapterId, date, serviceType);
      // Asked for again, the same code: two phones at the door show one code.
      if (existing && !body.replace) return res.json({ code: await view(req, existing) });
      // A new one, when a picture of the old one has gone where it should not:
      // the old one stops working at once.
      if (existing) await repo.patchById('doorCodes', existing.id, { active: false, closedAt: new Date(), closedBy: actorName(req) }, { chapterId });
      const code = await repo.create('doorCodes', {
        chapterId, date, serviceType, token: crypto.randomBytes(18).toString('base64url'),
        active: true, uses: 0, createdBy: actorName(req)
      }, 'door');
      res.json({ code: await view(req, code) });
    } catch (e) { res.status(500).json({ error: 'Could not make the visitor code' }); }
  });

  app.post('/api/shepherd/door-code/:id/close', requireShepherd, async (req, res) => {
    try {
      const chapterId = chapterOf(req);
      const code = chapterId ? await repo.patchById('doorCodes', req.params.id, { active: false, closedAt: new Date(), closedBy: actorName(req) }, { chapterId, active: true }) : null;
      if (!code) return res.status(404).json({ error: 'That code is not in use.' });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Could not turn the code off' }); }
  });

  // ---------- the visitor's side ----------
  // Counted per device (address), generous enough for a congregation on one
  // campus Wi-Fi, small enough that nobody fills the list from a script.
  const doorLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: Number(process.env.DOOR_CHECKIN_LIMIT_MAX) || 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many check-ins from this network. Please ask someone at the door.' }
  });

  // The code a token names, if it can be used right now. One lookup across
  // chapters on purpose: the token is what says which chapter it is.
  async function usable(token) {
    if (!TOKEN.test(String(token || ''))) return { status: 404, error: 'This code is not in use. Please ask someone at the door.' };
    const code = (await repo.getAll('doorCodes', repo.allChapters({ token: String(token) })))[0];
    if (!code || !code.active) return { status: 404, error: 'This code is not in use any more. Please ask someone at the door.' };
    if (code.date !== today()) {
      return { status: 410, expired: true, error: code.date < today()
        ? 'This code was for an earlier service. Please ask at the door for today\'s.'
        : 'This code is for a service that has not happened yet.' };
    }
    return { code };
  }

  app.get('/api/door/:token', doorLimiter, async (req, res) => {
    try {
      const found = await usable(req.params.token);
      if (!found.code) return res.status(found.status).json({ error: found.error, expired: !!found.expired });
      const chapter = await repo.getById('chapters', found.code.chapterId);
      res.set('Cache-Control', 'no-store');
      res.json({ chapter: { id: found.code.chapterId, name: (chapter && chapter.name) || 'ACONSU' }, date: found.code.date, serviceType: found.code.serviceType, heard: HEARD });
    } catch (e) { res.status(500).json({ error: 'Could not open this code' }); }
  });

  app.post('/api/door/:token', doorLimiter, async (req, res) => {
    try {
      const found = await usable(req.params.token);
      if (!found.code) return res.status(found.status).json({ error: found.error, expired: !!found.expired });
      const code = found.code;
      const body = req.body || {};
      const name = peopleImport.tidyName(oneLine(body.name, 80));
      const firstName = name.split(' ')[0] || '';
      // A form filled in by a script: thanked, and nothing kept.
      if (oneLine(body.website, 200)) return res.json({ success: true, firstName });
      if (name.length < 2) return res.status(400).json({ error: 'Type your name.' });
      const phone = peopleImport.tidyPhone(oneLine(body.phone, 40)).value;
      if (!peopleImport.phoneKey(phone)) return res.status(400).json({ error: 'Type your phone number, so we can welcome you properly.' });
      if (body.consent !== true && body.consent !== 'true') return res.status(400).json({ error: 'Tick the box to say we may keep your details.' });
      if ((code.uses || 0) >= MAX_USES) return res.status(429).json({ error: 'Please see someone at the door to check in.' });

      const chapterId = code.chapterId;
      let person = await attendance.findOnList({ chapterId, name, phone });
      if (!person) {
        const heard = HEARD[body.heard] ? ` Heard about us from ${HEARD[body.heard]}.` : '';
        const record = await repo.create('shepherdingRecords', {
          chapterId, memberId: '', name, phone,
          programme: oneLine(body.programme, 120), address: oneLine(body.hall, 120),
          origin: 'qr', attendanceStatus: 'new', consentedAt: new Date(),
          pastoralNotes: `Checked themselves in with the visitor QR code on ${code.date}.${heard}`
        }, 'shep');
        person = { memberId: '', recordId: record.id, name: record.name };
      }
      await attendance.setMark({
        scope: { chapterId }, chapterId, date: code.date, serviceType: code.serviceType,
        person, present: true, recordedBy: 'Visitor QR code'
      });
      await models.DoorCode.findOneAndUpdate({ id: code.id, chapterId }, { $inc: { uses: 1 } });
      // The same answer whoever they turned out to be.
      res.json({ success: true, firstName });
    } catch (e) { res.status(500).json({ error: 'Could not check you in. Please see someone at the door.' }); }
  });
}

module.exports = { registerDoorCheckinRoutes, HEARD };
