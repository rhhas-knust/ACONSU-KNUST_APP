// The offline outbox in a real browser, on a phone: a prayer request and
// check-ins at the door made with no signal are kept, shown as waiting to
// send, and sent by themselves, in order, when the phone is back online. One
// that reached the server but whose answer was lost is sent again and still
// counts once.
//
//   node test/outbox-ui.js
//
// Needs Playwright and a Chromium (see test/ux.js). Not part of `npm test`.
// The service worker is blocked here so the page's own requests can be cut
// off; the worker's part (sending after the page is closed) needs a real phone.
const fs = require('fs');
const path = require('path');
let chromium;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { ({ chromium } = require(p)); break; } catch (e) { /* next */ } }
if (!chromium) { console.error('Playwright is not installed.'); process.exit(2); }
const CHROME = process.env.PLAYWRIGHT_CHROMIUM
  || (fs.existsSync('/opt/pw-browsers')
    ? fs.readdirSync('/opt/pw-browsers').filter(d => /^chromium-\d+$/.test(d)).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`)[0]
    : undefined);
const ROOT = path.join(__dirname, '..');
let failures = 0;
const check = (label, ok, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || detail === undefined ? '' : ' - ' + JSON.stringify(detail).slice(0, 300))); if (!ok) failures++; };

(async () => {
  const { fakeModels } = require(path.join(ROOT, 'test', 'harness.js'));
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/outbox-ui', PORT: '4483', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 't', LOGIN_RATE_LIMIT_MAX: '900' });
  delete process.env.SHEPHERD_USERNAME;
  require(path.join(ROOT, 'server.js'));
  await new Promise(r => setTimeout(r, 1500));
  const BASE = 'http://127.0.0.1:4483';
  let jar = '';
  const api = async (m, p, b) => { const h = {}; if (jar) h.cookie = jar; if (b) h['content-type'] = 'application/json'; const r = await fetch(BASE + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) jar = sc.map(c => c.split(';')[0]).join('; '); return r.json().catch(() => ({})); };
  await api('POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  const C = 'aconsu-knust';
  await api('POST', '/api/national/chapters', { id: C, name: 'ACONSU KNUST', institution: 'KNUST' });
  const fd = new FormData();
  Object.entries({ name: 'Shep Head', email: 'shep@example.com', password: 'secret123', chapterId: C, consent: 'true' }).forEach(([k, v]) => fd.append(k, v));
  const memberId = (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd })).json()).member.id;
  await api('POST', '/api/admin/staff', { username: 'shep', name: 'Shep Head', role: 'shepherding', password: 'Start-Pass-1234', memberId, chapterId: C });
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; });
  await fakeModels.ShepherdingRecord.create({ id: 'rec-ama', chapterId: C, memberId: '', name: 'Ama Owusu', phone: '0244123456', origin: 'import' });
  await fakeModels.ShepherdingRecord.create({ id: 'rec-kofi', chapterId: C, memberId: '', name: 'Kofi Mensah', phone: '0551234567', origin: 'import' });

  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' };
  const waitFor = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 150)); } return false; };

  console.log('\n== a prayer request with no signal ==');
  const ctx = await browser.newContext(phone);
  await ctx.addInitScript((c) => { try { localStorage.setItem('aconsu_chapter_id', c); } catch (e) { /* fine */ } }, C);
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(`${BASE}/prayer.html`, { waitUntil: 'networkidle' });
  await ctx.setOffline(true);
  await p.fill('#name', 'Ama');
  await p.fill('#request', 'Exams next week');
  await p.selectOption('#visibility', 'private');
  await p.click('#prayerSubmitBtn');
  await p.waitForSelector('#outboxLine:not([hidden])');
  check('it is kept on the phone, and the page says so', /saved on this phone/.test(await p.textContent('#prayerMsg')) && /1 waiting to send/.test(await p.textContent('#outboxLine')));
  check('nothing has reached the server', !fakeModels.PrayerRequest._docs.some(x => x.request === 'Exams next week'));
  await ctx.setOffline(false);
  const arrived = await waitFor(() => fakeModels.PrayerRequest._docs.some(x => x.request === 'Exams next week'));
  check('back online, it is sent by itself', arrived && fakeModels.PrayerRequest._docs.find(x => x.request === 'Exams next week').chapterId === C);
  check('and the line goes', await waitFor(() => p.isHidden('#outboxLine')));

  console.log('\n== the answer lost on the way back ==');
  let cut = true;
  await p.route('**/api/prayer-requests', async (route) => {
    if (!cut) return route.continue();
    await route.fetch();   // it reaches the server...
    return route.abort();  // ...and the phone never hears back
  });
  await p.fill('#request', 'Travel mercies');
  await p.click('#prayerSubmitBtn');
  await p.waitForSelector('#outboxLine:not([hidden])');
  check('the phone thinks it did not go, and keeps it', fakeModels.PrayerRequest._docs.filter(x => x.request === 'Travel mercies').length === 1);
  cut = false;
  await p.evaluate(() => window.AconsuOutbox.flush());
  await waitFor(() => p.isHidden('#outboxLine'));
  check('sent again, with the same key, it still counts once', fakeModels.PrayerRequest._docs.filter(x => x.request === 'Travel mercies').length === 1);
  await ctx.close();

  console.log('\n== check-ins at the door with no signal ==');
  const sctx = await browser.newContext(phone);
  const s = await sctx.newPage();
  s.on('pageerror', e => errors.push(e.message));
  await s.goto(`${BASE}/shepherding.html#checkin`, { waitUntil: 'networkidle' });
  await s.fill('#portalUsername', 'shep'); await s.fill('#portalPassword', 'Start-Pass-1234'); await s.click('#portalLoginBtn');
  await s.waitForSelector('#ciSearch');
  await sctx.setOffline(true);
  const tap = async (name) => { await s.fill('#ciSearch', name); await s.click(`.ci-person:has-text("${name}")`); };
  await tap('Ama Owusu');
  await tap('Kofi Mensah');
  await waitFor(async () => (await s.locator('.ci-waiting').count()) === 2);
  check('each is checked in on the phone, shown as waiting to send', await s.locator('#ciList li:has-text("Ama Owusu") .ci-waiting').count() === 1 && await s.locator('#ciList li:has-text("Kofi Mensah") .ci-waiting').count() === 1);
  check('and the count says 2', (await s.textContent('#ciCount')).trim() === '2');
  check('with no undo until it is sent', await s.locator('#ciList li:has-text("Ama Owusu") .ci-undo').count() === 0);
  await s.fill('#ciSearch', 'Yaw New');
  await s.click('#ciNewBtn');
  await s.fill('#ciNewPhone', '0201112222');
  await s.click('#ciNewForm button[type=submit]');
  await waitFor(async () => (await s.locator('.ci-waiting').count()) === 3);
  check('someone new, too', await s.locator('#ciList li:has-text("Yaw New") .ci-waiting').count() === 1);
  const today = new Date().toISOString().slice(0, 10);
  const reg = () => fakeModels.AttendanceRecord._docs.find(x => x.chapterId === C && x.date === today);
  check('nothing has reached the register', !reg());
  await sctx.setOffline(false);
  const sentAll = await waitFor(() => { const r = reg(); return r && r.marks.filter(m => m.status === 'present').length === 3; }, 10000);
  check('back online, all three are sent and checked in', sentAll, reg());
  check('someone new is on the list once', fakeModels.ShepherdingRecord._docs.filter(x => x.name === 'Yaw New').length === 1);
  check('and the screen catches up: none still waiting', await waitFor(async () => (await s.locator('.ci-waiting').count()) === 0, 8000));

  check('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall outbox screen checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
