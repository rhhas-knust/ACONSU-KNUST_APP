// The Today screens in a real browser, on a phone: every leaders' portal (and
// the chapter admin) opens on at most five big buttons, with the number
// waiting where there is one, and everything else folded away under
// "All tools". The first-steps list ticks itself off and stays hidden once
// hidden, on the account rather than the phone.
//
//   node test/today-ui.js
//
// Needs Playwright and a Chromium (see test/ux.js). Not part of `npm test`.
const fs = require('fs');
const os = require('os');
const path = require('path');
let chromium;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { ({ chromium } = require(p)); break; } catch (e) { /* next */ } }
if (!chromium) { console.error('Playwright is not installed.'); process.exit(2); }
const CHROME = process.env.PLAYWRIGHT_CHROMIUM
  || (fs.existsSync('/opt/pw-browsers')
    ? fs.readdirSync('/opt/pw-browsers').filter(d => /^chromium-\d+$/.test(d)).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`)[0]
    : undefined);
const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.TODAY_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'today-shots-'));
let failures = 0;
const check = (ok, label, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || detail === undefined ? '' : ' - ' + JSON.stringify(detail).slice(0, 300))); if (!ok) failures++; };

(async () => {
  const { fakeModels } = require(path.join(ROOT, 'test', 'harness.js'));
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/today-ui', PORT: '4478', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 't', LOGIN_RATE_LIMIT_MAX: '900' });
  require(path.join(ROOT, 'server.js'));
  await new Promise(r => setTimeout(r, 1500));
  const BASE = 'http://127.0.0.1:4478';
  let jar = '';
  const api = async (m, p, b) => { const h = {}; if (jar) h.cookie = jar; if (b) h['content-type'] = 'application/json'; const r = await fetch(BASE + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) jar = sc.map(c => c.split(';')[0]).join('; '); return r.json().catch(() => ({})); };
  await api('POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  const C = 'aconsu-knust';
  await api('POST', '/api/national/chapters', { id: C, name: 'ACONSU KNUST', institution: 'KNUST' });
  let n = 0;
  const member = async (name) => {
    n += 1;
    const fd = new FormData();
    fd.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
    Object.entries({ name, email: `today${n}@example.com`, password: 'secret123', chapterId: C, consent: 'true' }).forEach(([k, v]) => fd.append(k, v));
    return (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd })).json()).member.id;
  };
  const staff = async (username, role, extra) => api('POST', '/api/admin/staff', { username, name: `Leader ${username}`, role, password: 'password1234', memberId: await member(username), chapterId: C, ...(extra || {}) });
  await staff('pres', 'executive', { positionKey: 'president' });
  // The main admin sets the chapter up while it has nobody of its own; once it
  // has a Coordinator or admin, its accounts are the chapter's to make.
  for (const [u, role] of [['fin', 'finance'], ['shep', 'shepherding'], ['pub', 'publicity'], ['wel', 'welfare'], ['chadmin', 'chapterAdmin']]) await staff(u, role);
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; });
  // A chapter with an admin of its own makes its own accounts, and only
  // National appoints a Coordinator: put one straight in, with the same password.
  const like = fakeModels.StaffUser._docs.find(a => a.username === 'wel');
  await fakeModels.StaffUser.create({ ...like, _id: undefined, id: 'coord-1', username: 'coord', name: 'Leader coord', role: 'coordinator', memberId: await member('coord') });
  check(fakeModels.StaffUser._docs.length === 7, '(seven leaders, one in each portal)', fakeModels.StaffUser._docs.map(a => a.username));
  // One giving claim for Finance to confirm (an offering: tithes go to Welfare's purse).
  await fakeModels.GivingIntent.create({ id: 'g1', chapterId: C, status: 'pending', purpose: 'offertory', amount: 50, name: 'Ama', createdAt: new Date() });

  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  async function signIn(page, username, viewport) {
    const ctx = await browser.newContext({ viewport: viewport || { width: 390, height: 844 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(`${username}: ${e.message}`));
    await p.goto(`${BASE}/${page}.html`, { waitUntil: 'networkidle' });
    if (page === 'admin') {
      await p.fill('#username', username); await p.fill('#password', 'password1234'); await p.click('#loginForm button[type="submit"]');
      await p.waitForSelector('#adminToday .today-action', { timeout: 10000 });
    } else {
      await p.fill('#portalUsername', username); await p.fill('#portalPassword', 'password1234'); await p.click('#portalLoginBtn');
      await p.waitForSelector('.portal-panel.active .today-action', { timeout: 10000 }).catch(async (e) => { console.log(await p.evaluate(() => document.body.innerText.slice(0, 600))); throw e; });
    }
    await p.waitForTimeout(500);
    return p;
  }

  console.log('\n== every portal opens on Today ==');
  const portals = [['coordinator', 'coord'], ['finance', 'fin'], ['shepherding', 'shep'], ['publicity', 'pub'], ['welfare-portal', 'wel'], ['executive', 'pres'], ['admin', 'chadmin']];
  for (const [page, who] of portals) {
    const p = await signIn(page, who);
    const actions = await p.$$eval('.today-action', els => els.map(e => { const r = e.getBoundingClientRect(); return { text: e.textContent.replace(/\s+/g, ' ').trim(), h: Math.round(r.height), w: Math.round(r.width) }; }));
    // The admin's menu slides in from the side; the portals' unfolds in place.
    const menuOpen = () => (page === 'admin'
      ? p.evaluate(() => document.getElementById('adminNav').getBoundingClientRect().right > 10)
      : p.isVisible('#portalNav button[data-panel]:not([data-panel="today"])'));
    const navShown = await menuOpen();
    check(actions.length >= 2 && actions.length <= 5, `${page}: ${actions.length} buttons for the week (${actions.map(a => a.text).join(' / ')})`, actions);
    check(actions.every(a => a.h >= 44 && a.w >= 200), `${page}: each one big enough to tap`, actions);
    check(!navShown, `${page}: everything else folded away under All tools`);
    await p.click('[data-today-all]');
    await p.waitForTimeout(300);
    check(await menuOpen(), `${page}: All tools opens it`);
    check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${page}: nothing runs off the side`);
    if (page === 'finance' || page === 'admin') await p.screenshot({ path: path.join(SHOTS, `today-${page}.png`), fullPage: true });
    await p.context().close();
  }

  console.log('\n== the numbers ==');
  let f = await signIn('finance', 'fin');
  const giving = (await f.textContent('[data-today-open="giving"]')).replace(/\s+/g, ' ').trim();
  check(giving === '1 Confirm giving claim waiting', 'Finance sees the one giving claim waiting', giving);
  await f.click('[data-today-open="giving"]');
  await f.waitForTimeout(500);
  check(await f.evaluate(() => document.querySelector('.portal-panel.active').id) === 'panel-giving', 'and the button opens the giving claims');

  console.log('\n== first steps ==');
  await f.click('#portalMenuToggle');
  await f.click('#portalNav button[data-panel="today"]');
  await f.waitForSelector('#todayStart');
  const ticked = await f.$$eval('.today-steps li', lis => lis.map(li => [li.textContent.trim(), li.classList.contains('done')]));
  check(ticked.length >= 3 && ticked.length <= 6, `${ticked.length} first steps, the video last`, ticked);
  check(ticked.find(([t]) => /giving claim/.test(t))[1] === true, 'opening the giving claims ticked "Confirm a giving claim" off', ticked);
  check(await f.getAttribute('.today-steps a[data-today-step="video"]', 'href') === '/video/how-to-aconsu.mp4', 'the video step plays the how-to video');
  await f.click('[data-today-step="ledger"]');
  await f.waitForTimeout(500);
  check(await f.evaluate(() => document.querySelector('.portal-panel.active').id) === 'panel-ledger', 'a step opens its screen');
  await f.reload({ waitUntil: 'networkidle' });
  await f.waitForSelector('#todayStart');
  const after = await f.$$eval('.today-steps li.done', lis => lis.length);
  check(after === 2, 'both stay ticked after the page is opened again', after);
  await f.click('[data-today-hide]');
  await f.waitForTimeout(400);
  check(await f.locator('#todayStart').count() === 0, 'Hide this list hides it');
  await f.context().close();
  f = await signIn('finance', 'fin', { width: 1280, height: 900 });
  check(await f.locator('#todayStart').count() === 0, 'and it stays hidden on another device');
  check(!await f.isVisible('[data-today-all]') && await f.isVisible('#portalNav button[data-panel="ledger"]'), 'on a computer the menu is open beside Today, with no All tools button');
  const side = await f.$$eval('#portalNav > *', els => els.slice(0, 3).map(e => (e.tagName === 'P' ? `[${e.textContent.trim()}]` : e.textContent.trim())));
  check(side[0] === 'Today' && side[1] === '[All tools]', 'Today first in the menu, then All tools', side);
  await f.context().close();

  check(errors.length === 0, 'no page errors', errors);
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall today checks passed');
  console.log(`screenshots: ${SHOTS}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
