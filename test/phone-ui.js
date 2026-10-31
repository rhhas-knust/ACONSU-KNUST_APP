// Every leader's portal and the admin on a phone (390px wide), signed in, every
// panel opened: nothing slides sideways, a wide table is a stack of cards with
// each value beside its column's name, every button and field is big enough
// for a thumb, and the admin's menu button has something on it to see.
//
//   node test/phone-ui.js
//
// Needs Playwright and a Chromium (see test/ux.js). Not part of `npm test`.
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
const check = (label, ok, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || detail === undefined ? '' : ' - ' + JSON.stringify(detail).slice(0, 600))); if (!ok) failures++; };

(async () => {
  const { fakeModels } = require(path.join(ROOT, 'test', 'harness.js'));
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/phone-ui', PORT: '4486', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 't', LOGIN_RATE_LIMIT_MAX: '900' });
  delete process.env.SHEPHERD_USERNAME;
  require(path.join(ROOT, 'server.js'));
  await new Promise(r => setTimeout(r, 1500));
  const BASE = 'http://127.0.0.1:4486';
  let jar = '';
  const api = async (m, p, b) => { const h = {}; if (jar) h.cookie = jar; if (b) h['content-type'] = 'application/json'; const r = await fetch(BASE + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) jar = sc.map(c => c.split(';')[0]).join('; '); return r.json().catch(() => ({})); };
  await api('POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  const C = 'aconsu-knust';
  await api('POST', '/api/national/chapters', { id: C, name: 'ACONSU-KNUST', institution: 'KNUST' });
  let n = 0;
  const member = async (name) => {
    n += 1;
    const fd = new FormData();
    fd.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
    Object.entries({ name, email: `phone${n}@example.com`, password: 'secret123', chapterId: C, consent: 'true', phone: `02400000${String(n).padStart(2, '0')}` }).forEach(([k, v]) => fd.append(k, v));
    return (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd })).json()).member.id;
  };
  for (const name of ['Kwame Asante', 'Abena Mensah', 'Efua Nyarkoa Owusu-Ansah']) await member(name);
  // The Coordinator first, by the main admin; from then the chapter runs
  // itself, and its Coordinator makes the other accounts.
  const logins = {};
  for (const role of ['coordinator', 'finance', 'publicity', 'welfare', 'shepherding', 'executive', 'chapterAdmin']) {
    const r = await api('POST', '/api/admin/staff', { username: `ph${role.toLowerCase()}`, name: `Phone ${role}`, role, password: 'Start-Pass-123', memberId: await member(`Leader ${role}`), chapterId: C, ...(role === 'executive' ? { positionKey: 'president' } : {}) });
    logins[role] = r.issued || { username: `ph${role.toLowerCase()}`, password: 'Start-Pass-123' };
    if (role === 'coordinator') {
      fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; a.mustSetUpSecondStep = false; });
      jar = '';
      await api('POST', '/api/portal/login', { username: logins.coordinator.username, password: 'Start-Pass-123', chapterId: C });
    }
  }
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; a.mustSetUpSecondStep = false; });

  const browser = await chromium.launch({ executablePath: CHROME });
  const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
  const errors = [];
  // What a phone would struggle with on the panel now open.
  const measure = (p) => p.evaluate(() => {
    const vw = window.innerWidth;
    const shown = (e) => e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden';
    const main = document.querySelector('.portal-main, .admin-main');
    const sideways = [...main.querySelectorAll('*')].filter(e => shown(e) && /auto|scroll/.test(getComputedStyle(e).overflowX) && e.scrollWidth > e.clientWidth + 4 && !e.querySelector('.imp-preview, [data-keep-table]'))
      .map((e) => {
        const edge = e.getBoundingClientRect().right;
        const culprit = [...e.querySelectorAll('*')].reverse().find(x => x.getBoundingClientRect().right > edge + 1);
        return `${String(e.className).split(' ')[0] || e.tagName} ${e.scrollWidth}/${e.clientWidth}${culprit ? `, pushed by ${culprit.tagName.toLowerCase()}.${String(culprit.className).split(' ')[0]} "${culprit.textContent.trim().slice(0, 30)}"` : ''}`;
      });
    if (/auto|scroll/.test(getComputedStyle(main).overflowX) && main.scrollWidth > main.clientWidth + 4) sideways.push(`main ${main.scrollWidth}/${main.clientWidth}`);
    const small = [...main.querySelectorAll('button, .btn, select, input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]):not([type=range]):not([type=color])')]
      .filter(e => shown(e) && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 43.5)
      .map(e => `${e.tagName.toLowerCase()} "${(e.textContent || e.placeholder || e.id || '').trim().slice(0, 20)}" ${Math.round(e.getBoundingClientRect().height)}px`);
    const tables = [...main.querySelectorAll('table')].filter(shown);
    const wideUnstacked = tables.filter(t => t.tHead && t.tHead.rows[0] && t.tHead.rows[0].cells.length >= 4 && !t.classList.contains('stack-table')
      && !t.matches('.card-table, .hp-table, .bk-sundays, .imp-preview, [data-keep-table]')).length;
    // A column with a heading shows it beside each value; one without (the
    // buttons at the end of a row) needs none.
    const unlabelled = tables.filter(t => t.classList.contains('stack-table')).flatMap((t) => {
      const heads = [...t.tHead.rows[0].cells].map(c => c.textContent.trim());
      return [...t.querySelectorAll('tbody td:not([colspan])')].filter(td => td.cellIndex > 0 && heads[td.cellIndex] && td.dataset.label !== heads[td.cellIndex])
        .map(td => `${heads[td.cellIndex]}: "${td.textContent.trim().slice(0, 30)}"`);
    });
    return { page: document.documentElement.scrollWidth - vw, sideways, small, wideUnstacked, unlabelled };
  });
  const problems = [];
  const note = (where, m) => {
    if (m.page > 1) problems.push(`${where}: the page is ${m.page}px wider than the phone`);
    m.sideways.forEach(s => problems.push(`${where}: slides sideways (${s})`));
    m.small.forEach(s => problems.push(`${where}: small to tap, ${s}`));
    if (m.wideUnstacked) problems.push(`${where}: ${m.wideUnstacked} wide table(s) not stacked`);
    if (m.unlabelled.length) problems.push(`${where}: ${m.unlabelled.length} card value(s) without their column's name, e.g. ${m.unlabelled[0]}`);
  };
  let panels = 0;

  async function portal(file, who) {
    const ctx = await browser.newContext(phone);
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(`${file}: ${e.message}`));
    await p.goto(`${BASE}/${file}`, { waitUntil: 'networkidle' });
    await p.fill('#portalUsername', who.username); await p.fill('#portalPassword', who.password);
    await p.click('#portalLoginBtn');
    await p.waitForSelector('#portalShell', { state: 'visible' });
    await p.waitForTimeout(500);
    for (const key of await p.evaluate(() => [...document.querySelectorAll('#portalNav button[data-panel]')].map(b => b.dataset.panel))) {
      await p.evaluate((k) => window.openPanel(k), key);
      await p.waitForTimeout(500);
      note(`${file} ${key}`, await measure(p));
      panels += 1;
    }
    await ctx.close();
  }
  async function admin(file, user, pass) {
    const ctx = await browser.newContext(phone);
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(`${file}: ${e.message}`));
    await p.goto(`${BASE}/${file}`, { waitUntil: 'networkidle' });
    await p.fill('#username', user); await p.fill('#password', pass);
    await p.click('#loginForm button[type="submit"]');
    await p.waitForSelector('#adminShell', { state: 'visible' });
    await p.waitForTimeout(500);
    const menu = await p.$eval('#mobileNavBtn', b => ({ icon: !!b.querySelector('svg'), h: Math.round(b.getBoundingClientRect().height), w: Math.round(b.getBoundingClientRect().width) }));
    check(`${file}: the menu button shows its three lines and is big enough to tap`, menu.icon && menu.h >= 44 && menu.w >= 44, menu);
    check(`${file}: the shortcuts button says what it is`, (await p.textContent('#mobileQuickActionsBtn')).trim() === 'Shortcuts');
    await p.click('#mobileNavBtn');
    await p.waitForTimeout(300);
    const open = await p.$eval('#adminNav', nav => nav.getBoundingClientRect().left >= -1 && nav.getBoundingClientRect().right > 100);
    check(`${file}: it opens the menu, and says so to a screen reader`, open && await p.getAttribute('#mobileNavBtn', 'aria-expanded') === 'true');
    await p.click('#adminSideBackdrop', { position: { x: 370, y: 400 } });
    for (const key of [...new Set(await p.evaluate(() => [...document.querySelectorAll('#adminNav button[data-panel]')].filter(b => getComputedStyle(b).display !== 'none').map(b => b.dataset.panel)))]) {
      await p.evaluate((k) => window.openAdminPanel(k), key);
      await p.waitForTimeout(500);
      note(`${file} ${key}`, await measure(p));
      panels += 1;
    }
    if (file === 'chapter.html') {
      await p.evaluate(() => window.openAdminPanel('members'));
      await p.waitForTimeout(500);
      const card = await p.evaluate(() => {
        const t = document.querySelector('#panel-members table');
        const td = t.querySelector('tbody tr td:nth-child(2)');
        return { stacked: t.classList.contains('stack-table'), head: getComputedStyle(t.tHead).display, label: td.dataset.label, shown: getComputedStyle(td, '::before').content };
      });
      check('a chapter\'s members are cards on a phone, each value beside its column\'s name', card.stacked && card.head === 'none' && card.label === 'Email' && card.shown === '"Email"', card);
      check('and the header names the chapter once', await p.textContent('#adminBrandName') === 'ACONSU-KNUST', await p.textContent('#adminBrandName'));
    }
    await ctx.close();
  }

  console.log('\n== the admin pages ==');
  await admin('admin.html', 'admin', 'admin123');
  await admin('chapter.html', logins.chapterAdmin.username, 'Start-Pass-123');
  console.log('\n== the offices\' portals ==');
  await portal('national.html', { username: 'admin', password: 'admin123' });
  await portal('coordinator.html', logins.coordinator);
  await portal('finance.html', logins.finance);
  await portal('publicity.html', logins.publicity);
  await portal('welfare-portal.html', logins.welfare);
  await portal('shepherding.html', logins.shepherding);
  await portal('executive.html', logins.executive);
  check(`every panel opened (${panels}), and on a phone nothing slides sideways, every wide table is cards, and every button and field is at least 44px`, problems.length === 0 && panels > 100, problems.slice(0, 12));

  console.log('\n== a laptop keeps its tables ==');
  const lap = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const l = await lap.newPage();
  await l.goto(`${BASE}/shepherding.html`, { waitUntil: 'networkidle' });
  await l.fill('#portalUsername', logins.shepherding.username); await l.fill('#portalPassword', 'Start-Pass-123');
  await l.click('#portalLoginBtn');
  await l.waitForSelector('#portalShell', { state: 'visible' });
  await l.evaluate(() => window.openPanel('members'));
  await l.waitForTimeout(500);
  const desk = await l.$eval('#panel-members table', t => ({ head: getComputedStyle(t.tHead).display, row: getComputedStyle(t.tBodies[0].rows[0]).display }));
  check('on a laptop the Members list is still a table with its column headings', desk.head === 'table-header-group' && desk.row === 'table-row', desk);
  await lap.close();

  check('no script errors', errors.length === 0, errors);
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall phone layout checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
