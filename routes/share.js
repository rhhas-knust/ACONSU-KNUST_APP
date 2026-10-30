// Sharing ACONSU on WhatsApp (and anything else the phone offers): the count
// of shares, the address share links are built on, and the preview a link
// shows when it is pasted into a chat.
//
// The share button itself is public/js/share.js. No tracking parameter is
// ever added to a shared link, and nothing about who shared is kept: a tap is
// one more on a day's count (lib/metrics.js).

const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const metrics = require('../lib/metrics');
const baseUrl = require('../lib/baseUrl');

const SHARE_KINDS = new Set(['event', 'sermon', 'prayer', 'verse', 'invite']);

// What a link to each page looks like in a chat. Kept short: WhatsApp shows
// about two lines of the description.
const DESCRIPTION = 'The Apostles\' Continuation Students Union: Sunday services, prayer, the Bible and fellowship on campus. Everyone is welcome.';
const PAGES = {
  '/': { title: 'ACONSU', description: DESCRIPTION },
  '/index.html': { title: 'ACONSU', description: DESCRIPTION },
  '/events.html': { title: 'Events | ACONSU', description: 'What is coming up at ACONSU, and how to join in.' },
  '/media.html': { title: 'Sermons | ACONSU', description: 'Sermons and teaching from ACONSU, to listen to or watch.' },
  '/prayer.html': { title: 'Prayer wall | ACONSU', description: 'Prayer requests people have chosen to share. Pray with them, or ask for prayer.' },
  '/bible.html': { title: 'The Bible | ACONSU', description: 'Read the Bible, with the verse of the day.' },
  '/about.html': { title: 'About ACONSU', description: DESCRIPTION },
  '/visit.html': { title: 'Plan your visit | ACONSU', description: 'When and where we meet, and what to expect the first time.' },
  '/give.html': { title: 'Give | ACONSU', description: 'Giving to ACONSU by Mobile Money or at a service.' }
};

const attr = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clip = (v, n) => { const s = String(v || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

function registerShareRoutes(app) {
  // A share is counted once the person has chosen to share. Generous, since a
  // whole room might share the same event at once, but not endless.
  const shareLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many at once. Please try again later.' }
  });

  app.post('/api/share', shareLimiter, async (req, res) => {
    const kind = String((req.body && req.body.kind) || '');
    if (!SHARE_KINDS.has(kind)) return res.status(400).json({ error: 'Unknown kind of share' });
    try { await metrics.count(`share:${kind}`); } catch (e) { /* a lost count is not worth an error */ }
    res.status(204).end();
  });

  // Someone has started filling in the sign-up form. Counted once per visit
  // by the page, to set beside sign-ups completed. Nothing about them is kept.
  app.post('/api/metrics/signup-started', shareLimiter, async (req, res) => {
    try { await metrics.count('signup:started'); } catch (e) { /* as above */ }
    res.status(204).end();
  });

  // The address share links are built on: the app's chosen address once there
  // is one, otherwise the page uses its own (lib/baseUrl.js).
  app.get('/api/public/address', (req, res) => {
    res.json({ base: baseUrl.chosen() });
  });

}

// ---------- the preview a shared link shows ----------
// Installed before the static files (server.js), so these pages are sent with
// their preview filled in rather than as the plain file.
function sharePreviews({ repo, publicDir }) {
  // The shareable pages are sent with Open Graph tags filled in: the page's
  // own title and a line about it, or, for a link to one event or sermon,
  // that event or sermon. The picture is the event's flyer, or the logo. The
  // link's own canonical address (og:url) is given only once the app has a
  // chosen address, so a preview never names a stand-in that will change.
  const html = new Map();
  const readPage = (file) => {
    if (!html.has(file)) html.set(file, fs.readFileSync(file, 'utf8'));
    return html.get(file);
  };

  async function previewFor(req, page) {
    const out = { ...page, image: '/images/logo.jpg' };
    try {
      if (req.path === '/events.html' && req.query.event) {
        const e = await repo.getById('events', String(req.query.event));
        if (e && (e.status || 'published') === 'published') {
          out.title = `${e.title} | ACONSU`;
          out.description = clip([e.date, e.time, e.location].filter(Boolean).join(', ') + (e.description ? `. ${e.description}` : ''), 200);
          if (e.flyerFileId) out.image = `/api/files/${encodeURIComponent(e.flyerFileId)}`;
        }
      } else if (req.path === '/media.html' && req.query.sermon) {
        const s = await repo.getById('sermons', String(req.query.sermon));
        if (s) {
          out.title = `${s.title} | ACONSU`;
          out.description = clip([s.speaker, s.description].filter(Boolean).join(': '), 200);
        }
      }
    } catch (e) { /* the page's own preview is fine */ }
    return out;
  }

  return async function sharePreviews(req, res, next) {
    const page = req.method === 'GET' ? PAGES[req.path] : null;
    if (!page) return next();
    try {
      const file = path.join(publicDir, req.path === '/' ? 'index.html' : req.path.slice(1));
      const p = await previewFor(req, page);
      const site = baseUrl.forLinks(req);
      const chosen = baseUrl.chosen();
      const tags = [
        `<meta property="og:type" content="website">`,
        `<meta property="og:site_name" content="ACONSU">`,
        `<meta property="og:title" content="${attr(p.title)}">`,
        `<meta property="og:description" content="${attr(p.description)}">`,
        site ? `<meta property="og:image" content="${attr(site + p.image)}">` : '',
        chosen ? `<meta property="og:url" content="${attr(chosen + req.originalUrl)}">` : '',
        chosen ? `<link rel="canonical" href="${attr(chosen + req.path)}">` : '',
        `<meta name="twitter:card" content="summary">`
      ].filter(Boolean).join('\n');
      const body = readPage(file).replace('</head>', `${tags}\n</head>`);
      res.type('html').set('Cache-Control', 'no-cache').send(body);
    } catch (e) {
      next();
    }
  };
}

module.exports = { registerShareRoutes, sharePreviews, SHARE_KINDS, PAGES };
