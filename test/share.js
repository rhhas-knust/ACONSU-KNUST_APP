// Sharing ACONSU: a tap is counted and nothing else is kept, the link carries
// no tracking, and a link pasted into WhatsApp shows the event or sermon it is
// for, with the address the owner chose and never a stand-in.
//
//   node test/share.js     (also run by `npm test`)
const fs = require('fs');
const path = require('path');
const { fakeModels } = require('./harness.js');
const metrics = require('../lib/metrics');

(async () => {
  process.env.MONGODB_URI = 'mongodb://stub/aconsu_share';
  process.env.PORT = '4343';
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'admin123';
  process.env.SESSION_SECRET = 'test';
  ['PUBLIC_BASE_URL', 'RENDER_EXTERNAL_URL', 'SHEPHERD_USERNAME'].forEach((k) => delete process.env[k]);

  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 400)}` : ''}`); }
  }

  console.log('\n== the counter ==');
  check('only the kinds it knows are counted', await metrics.count('share:event', '2026-11-01') && !await metrics.count('share:whatever', '2026-11-01') && !await metrics.count('member:m1', '2026-11-01'));
  await metrics.count('share:event', '2026-11-01');
  await metrics.count('share:event', '2026-11-03');
  await metrics.count('signup:started', '2026-11-02');
  const t = await metrics.totals('2026-11-01', '2026-11-02');
  check('totals add a key\'s days up, inside the days asked for only', t['share:event'] === 2 && t['signup:started'] === 1 && Object.keys(t).length === 2, t);
  fakeModels.Metric._docs.length = 0;

  // ------------------------------------------------------------------ the app --
  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4343';
  const post = (p, body, headers) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(headers || {}) }, body: JSON.stringify(body || {}) });
  const page = async (p) => { const r = await fetch(BASE + p); return { status: r.status, html: await r.text(), cache: r.headers.get('cache-control') || '' }; };
  const meta = (html, prop) => { const m = html.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)">`)); return m ? m[1] : null; };

  console.log('\n== counting a share ==');
  let r = await post('/api/share', { kind: 'event' });
  await post('/api/share', { kind: 'event' });
  await post('/api/share', { kind: 'invite' }, { cookie: 'connect.sid=someone' });
  check('a share is answered with nothing', r.status === 204);
  r = await post('/api/share', { kind: 'nosy' });
  check('a kind it does not know is refused, and not stored', r.status === 400 && !fakeModels.Metric._docs.some(d => /nosy/.test(d.key)));
  r = await post('/api/metrics/signup-started');
  check('starting the sign-up form is counted too', r.status === 204 && fakeModels.Metric._docs.some(d => d.key === 'signup:started' && d.count === 1));
  const day = metrics.today();
  const ev = fakeModels.Metric._docs.find(d => d.key === 'share:event');
  check('two shares of events today are one row saying 2', ev && ev.day === day && ev.count === 2, ev);
  const fields = [...new Set(fakeModels.Metric._docs.flatMap(d => Object.keys(d)))].filter(k => !['_id', 'id', '__v', 'createdAt', 'updatedAt'].includes(k)).sort();
  check('and a row holds the kind, the day and the count, nothing about who', JSON.stringify(fields) === '["count","day","key"]', fields);

  console.log('\n== the address a shared link uses ==');
  r = await (await fetch(BASE + '/api/public/address')).json();
  check('with no address chosen, none is given (the page uses its own)', r.base === '', r);
  process.env.PUBLIC_BASE_URL = 'https://app.aconsu.org/';
  r = await (await fetch(BASE + '/api/public/address')).json();
  check('once one is chosen, that one', r.base === 'https://app.aconsu.org', r);
  process.env.RENDER_EXTERNAL_URL = 'https://aconsu-knust-app.onrender.com';
  delete process.env.PUBLIC_BASE_URL;
  r = await (await fetch(BASE + '/api/public/address')).json();
  check('Render\'s stand-in is never given out as the address to share', r.base === '', r);
  delete process.env.RENDER_EXTERNAL_URL;

  console.log('\n== the preview a link shows ==');
  const live = await fakeModels.Event.create({ id: 'ev-live', title: 'Freshers "Welcome" Night <b>', date: '2026-11-14', time: '6pm', location: 'Great Hall', description: 'Food and worship', flyerFileId: 'flyer123', status: 'published' });
  const draft = await fakeModels.Event.create({ id: 'ev-draft', title: 'Secret Retreat Plans', date: '2026-12-01', status: 'draft' });
  const sermon = await fakeModels.Sermon.create({ id: 'sermon-1', title: 'Faith at Exam Time', speaker: 'Pastor Kwame', description: 'Romans 8' });
  let p = await page(`/events.html?event=${live.id}`);
  check('a link to one event shows that event\'s title, made safe', p.status === 200 && meta(p.html, 'og:title') === 'Freshers &quot;Welcome&quot; Night &lt;b&gt; | ACONSU', meta(p.html, 'og:title'));
  check('when and where, as the line under it', /2026-11-14, 6pm, Great Hall\. Food and worship/.test(meta(p.html, 'og:description') || ''), meta(p.html, 'og:description'));
  check('its flyer as the picture, at a full address', meta(p.html, 'og:image') === `${BASE}/api/files/flyer123`, meta(p.html, 'og:image'));
  check('no canonical address while none is chosen', !/og:url|rel="canonical"/.test(p.html));
  check('and is sent fresh each time, so a changed event is not stuck in a cache', /no-cache/.test(p.cache), p.cache);
  check('the page itself is still the page', /<\/footer>/.test(p.html) && (p.html.match(/<meta property="og:title"/g) || []).length === 1);
  p = await page(`/events.html?event=${draft.id}`);
  check('a draft event is never previewed: the events page\'s own preview instead', meta(p.html, 'og:title') === 'Events | ACONSU' && !/Secret Retreat/.test(p.html));
  p = await page('/events.html?event=nope');
  check('as for an event that is not there', p.status === 200 && meta(p.html, 'og:title') === 'Events | ACONSU');
  p = await page(`/media.html?sermon=${sermon.id}`);
  check('a link to a sermon shows the sermon and who preached it', meta(p.html, 'og:title') === 'Faith at Exam Time | ACONSU' && meta(p.html, 'og:description') === 'Pastor Kwame: Romans 8', [meta(p.html, 'og:title'), meta(p.html, 'og:description')]);
  p = await page('/');
  check('the home page shows ACONSU with the logo', meta(p.html, 'og:title') === 'ACONSU' && meta(p.html, 'og:image') === `${BASE}/images/logo.jpg` && meta(p.html, 'twitter:card') === 'summary');
  p = await page('/login.html');
  check('pages nobody shares (sign-in) are sent as they are', p.status === 200 && !/og:title/.test(p.html));
  process.env.PUBLIC_BASE_URL = 'https://app.aconsu.org';
  p = await page(`/events.html?event=${live.id}`);
  check('once an address is chosen, the picture and the canonical link use it', meta(p.html, 'og:image') === 'https://app.aconsu.org/api/files/flyer123'
    && meta(p.html, 'og:url') === `https://app.aconsu.org/events.html?event=${live.id}` && p.html.includes('<link rel="canonical" href="https://app.aconsu.org/events.html">'), [meta(p.html, 'og:image'), meta(p.html, 'og:url')]);
  delete process.env.PUBLIC_BASE_URL;

  console.log('\n== National\'s Health panel ==');
  {
    const ago = (d) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);
    const dayAgo = (d) => ago(d).toISOString().slice(0, 10);
    await fakeModels.Chapter.create({ id: 'aconsu-knust', name: 'ACONSU KNUST' });
    await fakeModels.Chapter.create({ id: 'aconsu-ucc', name: 'ACONSU UCC' });
    await fakeModels.Member.create({ id: 'h1', chapterId: 'aconsu-knust', name: 'New and here', createdAt: ago(2), lastActiveDate: dayAgo(1) });
    await fakeModels.Member.create({ id: 'h2', chapterId: 'aconsu-knust', name: 'Old and here', createdAt: ago(60), lastActiveDate: dayAgo(0) });
    await fakeModels.Member.create({ id: 'h3', chapterId: 'aconsu-ucc', name: 'New, gone quiet', createdAt: ago(10), lastActiveDate: dayAgo(9) });
    for (const [id, status, d] of [['p1', 'pending', 1], ['p2', 'confirmed', 3], ['p3', 'confirmed', 5], ['p4', 'rejected', 40]]) {
      await fakeModels.GivingIntent.create({ id, chapterId: 'aconsu-ucc', status, purpose: 'offertory', amount: 10, createdAt: ago(d) });
    }
    // The stand-in database stamps its own creation date; put the real ones back.
    const when = { h1: 2, h2: 60, h3: 10, p1: 1, p2: 3, p3: 5, p4: 40 };
    [...fakeModels.Member._docs, ...fakeModels.GivingIntent._docs].forEach(doc => { if (when[doc.id] !== undefined) doc.createdAt = ago(when[doc.id]); });
    let h = await fetch(BASE + '/api/national/health');
    check('nobody signed in is shown it', h.status === 401);
    const login = await post('/api/admin/login', { username: 'admin', password: 'admin123' });
    const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    h = await (await fetch(BASE + '/api/national/health', { headers: { cookie } })).json();
    check('the last 28 days by default', h.days === 28 && h.to === metrics.today(), [h.days, h.from, h.to]);
    check('sign-ups started (counted) beside sign-ups finished (accounts made in the period)', h.signUps.started === 1 && h.signUps.completed === 2, h.signUps);
    check('members active in the last 7 days, of all members', h.members.activeThisWeek === 2 && h.members.total === 3, h.members);
    check('shares by kind', h.shares.event === 2 && h.shares.invite === 1 && h.shares.total === 3, h.shares);
    check('giving claims by where they stand, in the period', h.payments.pending === 1 && h.payments.confirmed === 2 && h.payments.rejected === 0 && h.payments.total === 3, h.payments);
    check('week by week, four of them, ending today', h.weeks.length === 4 && h.weeks[3].to === h.to && h.weeks[3].shares === 3 && h.weeks[3].started === 1 && h.weeks[3].completed === 1 && h.weeks[2].completed === 1, h.weeks);
    const knust = h.chapters.find(c => c.id === 'aconsu-knust');
    check('and chapter by chapter: members, active, joined', knust && knust.members === 2 && knust.activeThisWeek === 2 && knust.joined === 1, h.chapters);
    const all = JSON.stringify(h);
    check('with no name, id or address of anyone in it', !/New and here|Old and here|"h1"|"h2"|"p1"|@/.test(all));
    h = await (await fetch(BASE + '/api/national/health?days=90', { headers: { cookie } })).json();
    check('90 days reaches the older sign-up and the older claim', h.signUps.completed === 3 && h.payments.rejected === 1 && h.weeks.length === 13, [h.signUps, h.payments, h.weeks.length]);
    h = await (await fetch(BASE + '/api/national/health?days=5000', { headers: { cookie } })).json();
    check('a period it does not offer falls back to 28 days', h.days === 28);
  }

  console.log('\n== the button ==');
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'share.js'), 'utf8');
  check('it adds no tracking to a link (no utm_, no ref=, no id of who shared)', !/utm_|[?&]ref=|memberId|fbclid/i.test(js));
  check('and is in the offline shell, on every page that has a share button', fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8').includes("'/js/share.js'")
    && ['index', 'events', 'media', 'prayer', 'profile'].every(f => fs.readFileSync(path.join(__dirname, '..', 'public', `${f}.html`), 'utf8').includes('/js/share.js')));

  console.log(failures ? `\n${failures} FAILURES` : '\nall share checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
