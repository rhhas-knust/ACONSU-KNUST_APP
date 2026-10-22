// The Show / Hide button on every password box, and the My Account page, in a real
// browser.
//
//   node test/account-ui.js
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
const SHOTS = process.env.ACCOUNT_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'account-shots-'));
let failures = 0;
const check = (ok, label, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || detail === undefined ? '' : ' - ' + JSON.stringify(detail).slice(0, 300))); if (!ok) failures++; };

(async () => {
  const { fakeModels } = require(path.join(ROOT, 'test', 'harness.js'));
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/account-ui', PORT: '4473', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 't', LOGIN_RATE_LIMIT_MAX: '900' });
  require(path.join(ROOT, 'server.js'));
  await new Promise(r => setTimeout(r, 1500));
  const BASE = 'http://127.0.0.1:4473';
  let jar = '';
  const api = async (m, p, b) => { const h = {}; if (jar) h.cookie = jar; if (b) h['content-type'] = 'application/json'; const r = await fetch(BASE + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) jar = sc.map(c => c.split(';')[0]).join('; '); return r.json().catch(() => ({})); };
  await api('POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  const C = 'aconsu-knust';
  await api('POST', '/api/national/chapters', { id: C, name: 'ACONSU KNUST', institution: 'KNUST' });
  const dept = (await api('POST', '/api/admin/departments', { name: 'Choir', tagline: 'x', chapterId: C })).item.id;
  let n = 0;
  const member = async (name) => {
    n += 1;
    const fd = new FormData();
    fd.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
    Object.entries({ name, email: `acui${n}@example.com`, password: 'secret123', chapterId: C, consent: 'true' }).forEach(([k, v]) => fd.append(k, v));
    return (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd })).json()).member.id;
  };
  const staff = async (username, name, role, extra) => api('POST', '/api/admin/staff', { username, name, role, password: 'Start-Pass-1', memberId: await member(name), chapterId: C, ...(extra || {}) });
  // The main admin sets the chapter up while it has nobody of its own; the
  // Coordinator comes last, and from then on its accounts are the chapter's.
  await staff('pres', 'Yaw President', 'executive', { positionKey: 'president' });
  await staff('choir', 'Ama Choir', 'executive', { positionKey: 'music_director', department: dept });
  // These two are past their first sign-in; the first sign-in is tested on its own below.
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; });
  const treasurerMember = await member('Kwame Treasurer');
  const issued = (await api('POST', '/api/admin/staff', { role: 'executive', positionKey: 'treasurer', memberId: treasurerMember, chapterId: C })).issued;
  await staff('coord', 'Chapter Coordinator', 'coordinator');
  fakeModels.StaffUser._docs.find(a => a.username === 'coord').mustChangePassword = false;

  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  const context = async (opts) => { const c = await browser.newContext(opts || { viewport: { width: 1280, height: 900 } }); return c; };
  const pageOf = async (ctx, url) => { const p = await ctx.newPage(); p.on('pageerror', e => errors.push(`${url}: ${e.message}`)); await p.goto(BASE + url, { waitUntil: 'networkidle' }); return p; };

  // ------------------------------------------------ every page with a password box --
  console.log('\n== the eye on every page that asks for a password ==');
  const pages = ['login', 'register', 'reset-password', 'profile', 'admin', 'chapter', 'national', 'council', 'coordinator', 'executive', 'finance', 'publicity', 'shepherding', 'welfare-portal'];
  const ctx = await context();
  for (const name of pages) {
    const p = await pageOf(ctx, `/${name}.html${name === 'reset-password' ? '?token=t&email=a%40b.com' : ''}`); // without a link's token the page shows an error instead of the form
    const info = await p.$$eval('input[type="password"], input[data-pw-toggle]', els => els.map(e => {
      const wrap = e.closest('.pw-wrap'); const btn = wrap && wrap.querySelector('.pw-toggle');
      return { id: e.id, wrapped: !!wrap, icon: !!(btn && btn.querySelector('svg')), text: btn && btn.textContent.trim(), label: btn && btn.getAttribute('aria-label'), type: e.type };
    }));
    check(info.length > 0 && info.every(i => i.wrapped && i.icon && i.text === '' && i.label === 'Show password' && i.type === 'password'),
      `${name}.html: every password box (${info.map(i => i.id).join(', ')}) has the eye button`, info);
    await p.close();
  }

  // ------------------------------------------------ how it behaves, on the sign-in page --
  console.log('\n== how it behaves ==');
  const login = await pageOf(ctx, '/executive.html');
  await login.fill('#portalPassword', 'my secret phrase');
  const toggle = login.locator('#portalLoginForm .pw-toggle');
  await toggle.click();
  check(await login.getAttribute('#portalPassword', 'type') === 'text', 'pressing Show reveals what was typed');
  check(await toggle.getAttribute('aria-label') === 'Hide password' && await toggle.getAttribute('title') === 'Hide password' && await toggle.getAttribute('data-shown') === 'true', 'and the eye now offers to hide it: its label and tooltip say Hide password');
  check(await login.inputValue('#portalPassword') === 'my secret phrase', 'the text itself is untouched');
  await toggle.click();
  check(await login.getAttribute('#portalPassword', 'type') === 'password', 'pressing Hide covers it again');
  await toggle.focus();
  await login.keyboard.press('Enter');
  check(await login.getAttribute('#portalPassword', 'type') === 'text', 'it works from the keyboard');
  await login.keyboard.press('Space');
  check(await login.getAttribute('#portalPassword', 'type') === 'password', 'Space as well');
  const box = await toggle.boundingBox();
  check(box.width >= 44 && box.height >= 44, 'the button is at least 44px to press', box);
  await toggle.click();
  await login.fill('#portalUsername', 'pres');
  await login.fill('#portalPassword', 'wrong password');
  await login.click('#portalLoginBtn');
  await login.waitForFunction(() => /Invalid|incorrect|not/i.test(document.getElementById('portalLoginMsg').textContent));
  check(await login.getAttribute('#portalPassword', 'type') === 'password', 'sending the form hides the password again');
  await toggle.click();
  await login.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  check(await login.getAttribute('#portalPassword', 'type') === 'password', 'and so does putting the page in the background');
  // The toggle must not break signing in.
  await login.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); });
  await login.fill('#portalPassword', 'Start-Pass-1');
  await toggle.click();
  await login.click('#portalLoginBtn');
  await login.waitForSelector('#portalNav button', { state: 'attached', timeout: 8000 });
  check(true, 'signing in works with the password showing');

  // Boxes that appear later (a portal's pop-up forms) get one too.
  const coord = await pageOf(await context(), '/coordinator.html');
  await coord.fill('#portalUsername', 'coord'); await coord.fill('#portalPassword', 'Start-Pass-1'); await coord.click('#portalLoginBtn');
  await coord.waitForSelector('#portalNav button', { state: 'attached' });
  await coord.click('#portalNav button:text-is("Leadership Accounts")');
  await coord.waitForSelector('.portal-panel.active button:has-text("Appoint"), .portal-panel.active button:has-text("Add")');
  await coord.locator('.portal-panel.active button:has-text("Appoint"), .portal-panel.active button:has-text("Add")').first().click();
  await coord.waitForSelector('#sfPassword');
  check(await coord.locator('#sfPassword').evaluate(e => !!e.closest('.pw-wrap') && !!e.closest('.pw-wrap').querySelector('.pw-toggle')), 'a password box in a pop-up form that was built after the page loaded gets one as well');
  await coord.keyboard.press('Escape');

  // ------------------------------------------------ phone, dark ---------------------
  const phone = await context({ viewport: { width: 320, height: 640 } });
  const pl = await pageOf(phone, '/login.html');
  check(await pl.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'the member sign-in still fits a 320px phone');
  await pl.screenshot({ path: path.join(SHOTS, 'login-320.png') });
  const darkCtx = await context({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
  const dl = await pageOf(darkCtx, '/login.html');
  const ratio = await dl.evaluate(() => {
    const lum = (c) => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const b = document.querySelector('.pw-toggle'); const cs = getComputedStyle(b);
    const a = lum(cs.color), c = lum(getComputedStyle(b.parentElement.querySelector('input')).backgroundColor); // the eye sits on the box itself
    return (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05);
  });
  check(ratio >= 3, 'the eye stands out at 3:1 or better against its box in dark mode, as an icon must', ratio);
  await dl.screenshot({ path: path.join(SHOTS, 'login-dark.png') });

  // ------------------------------------------------ the My Account page ---------------
  console.log('\n== the My Account page ==');
  const ex = await (await context()).newPage();
  ex.on('pageerror', e => errors.push('exec: ' + e.message));
  ex.on('dialog', d => d.accept(''));
  await ex.goto(`${BASE}/executive.html`, { waitUntil: 'networkidle' });
  const signIn = async (page, user, pass) => {
    await page.fill('#portalUsername', user); await page.fill('#portalPassword', pass); await page.click('#portalLoginBtn');
    await page.waitForSelector('#portalNav button', { state: 'attached', timeout: 8000 });
  };
  await signIn(ex, 'pres', 'Start-Pass-1');
  const labels = await ex.$$eval('#portalNav button', b => b.map(x => x.textContent.trim()));
  check(labels[0] === 'My Profile' && labels[1] === 'My Account', 'the executive\'s menu has My Account next to My Profile: ' + labels.slice(0, 3).join(' | '));
  await ex.waitForSelector('.portal-panel.active .of-notice.warn');
  check(/starting password/.test(await ex.locator('.portal-panel.active .of-notice.warn').textContent()), 'the first page reminds them they are on the starting password');
  await ex.click('.portal-panel.active .of-notice.warn button');
  await ex.waitForSelector('#pwForm');
  const text = await ex.locator('.portal-panel.active').textContent();
  check(/Yaw President/.test(text) && /pres/.test(text) && /President/.test(text) && /ACONSU KNUST/.test(text) && /days left/.test(text), 'the page shows who they are, their office, chapter and term');
  check(/Still the starting password/.test(text), 'and that the password has not been changed');
  const unlabelled = await ex.$$eval('.portal-panel.active input, .portal-panel.active button', els => els.filter(e => e.offsetParent && e.tagName === 'INPUT' && !(e.labels && e.labels.length)).map(e => e.id));
  check(unlabelled.length === 0, 'every field has a label', unlabelled);
  const tiny = await ex.$$eval('.portal-panel.active button, .portal-panel.active input', els => els.filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [e.textContent.trim().slice(0, 20) || e.id, Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => h < 44 || w < 24));
  check(tiny.length === 0, 'and every button and field is at least 44px', tiny);
  check(await ex.locator('#pwForm .pw-toggle').count() === 3, 'each of the three password boxes has the eye button');
  check((await ex.locator('#pwRules').textContent()).includes('Still needed'), 'the rules list says what is still needed');
  await ex.fill('#pwCurrent', 'Start-Pass-1');
  await ex.fill('#pwNew', 'Rooted In Him 77');
  await ex.fill('#pwAgain', 'Rooted In Him 7');
  await ex.click('#pwForm button[type=submit]');
  check(/do not match/.test(await ex.locator('#pwMsg').textContent()), 'two boxes that differ are caught before anything is sent');
  await ex.fill('#pwAgain', 'Rooted In Him 77');
  check((await ex.locator('#pwRules .of-todo').count()) === 0, 'once everything is right every rule shows Done');
  await ex.screenshot({ path: path.join(SHOTS, 'my-account.png'), fullPage: true });
  await ex.click('#pwForm button[type=submit]');
  await ex.waitForFunction(() => /Last changed/.test(document.querySelector('.portal-panel.active').textContent));
  check(await ex.locator('.portal-panel.active .of-notice.warn').count() === 0, 'changed: the starting-password warning is gone');
  await ex.click('#portalNav button:text-is("My Profile")');
  await ex.waitForSelector('#execForm');
  check(await ex.locator('.portal-panel.active .of-notice.warn').count() === 0, 'and so is the reminder on the first page');
  await ex.fill('#pwNew', 'x').catch(() => {});
  await ex.click('#portalNav button:text-is("My Account")');
  await ex.waitForSelector('#pwForm');
  await ex.fill('#pwCurrent', 'Rooted In Him 77');
  await ex.fill('#pwNew', 'password123');
  await ex.fill('#pwAgain', 'password123');
  await ex.click('#pwForm button[type=submit]');
  await ex.waitForFunction(() => /first that anyone would try/.test(document.getElementById('pwMsg').textContent));
  check(true, 'a very common password is turned away, with the reason in words');
  await ex.fill('#pwCurrent', 'wrong one');
  await ex.fill('#pwNew', 'Another Good Phrase 5');
  await ex.fill('#pwAgain', 'Another Good Phrase 5');
  await ex.click('#pwForm button[type=submit]');
  await ex.waitForFunction(() => /not right/.test(document.getElementById('pwMsg').textContent));
  check(true, 'and a wrong current password says so');
  await ex.click('#signOutOthers');
  await ex.waitForFunction(() => /every other device/i.test(document.getElementById('othersMsg').textContent));
  check(true, 'signing out of the other devices works');
  await ex.screenshot({ path: path.join(SHOTS, 'my-account-after.png'), fullPage: true });

  // The old password is gone; the new one signs in.
  const again = await (await context()).newPage();
  again.on('pageerror', e => errors.push('again: ' + e.message));
  await again.goto(`${BASE}/executive.html`, { waitUntil: 'networkidle' });
  await again.fill('#portalUsername', 'pres'); await again.fill('#portalPassword', 'Start-Pass-1'); await again.click('#portalLoginBtn');
  await again.waitForFunction(() => /Invalid/.test(document.getElementById('portalLoginMsg').textContent));
  check(true, 'the starting password no longer signs in');
  await again.fill('#portalPassword', 'Rooted In Him 77');
  await again.click('#portalLoginBtn');
  await again.waitForSelector('#portalNav button', { state: 'attached' });
  check(true, 'the new one does');

  // Another kind of leader has the same page.
  const co = await (await context()).newPage();
  co.on('pageerror', e => errors.push('coord: ' + e.message));
  await co.goto(`${BASE}/coordinator.html`, { waitUntil: 'networkidle' });
  await signIn(co, 'coord', 'Start-Pass-1');
  const coLabels = await co.$$eval('#portalNav button', b => b.map(x => x.textContent.trim()));
  check(coLabels.includes('My Account'), 'the Chapter Coordinator\'s portal has My Account too');
  await co.click('#portalNav button:text-is("My Account")');
  await co.waitForSelector('#pwForm');
  check(/Chapter Coordinator/.test(await co.locator('.portal-panel.active').textContent()), 'showing their own role');

  // ------------------------------------------------ the first sign-in ---------------
  console.log('\n== the first sign-in with the office\'s starting password ==');
  check(issued && issued.username === 'treasurer.knust' && issued.password === 'treasurer123', 'the Treasurer\'s office login is treasurer.knust / treasurer123', issued);
  const tr = await (await context({ viewport: { width: 390, height: 844 } })).newPage();
  tr.on('pageerror', e => errors.push('treasurer: ' + e.message));
  tr.on('dialog', d => d.accept(''));
  await tr.goto(`${BASE}/executive.html`, { waitUntil: 'networkidle' });
  await tr.fill('#portalUsername', issued.username); await tr.fill('#portalPassword', issued.password); await tr.click('#portalLoginBtn');
  await tr.waitForSelector('#firstPwForm');
  check(!(await tr.isVisible('#portalShell')) && !(await tr.isVisible('#portalLoginForm')), 'signing in with it opens only the "choose your own password" screen');
  check(/Treasurer/.test(await tr.textContent('#firstPwForm')), 'which greets them by their office');
  check(await tr.locator('#firstPwForm .pw-toggle').count() === 2, 'with the eye on both password boxes');
  const trUnlabelled = await tr.$$eval('#firstPwForm input', els => els.filter(e => !(e.labels && e.labels.length)).map(e => e.id));
  check(trUnlabelled.length === 0, 'every field labelled', trUnlabelled);
  check(await tr.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'it fits a phone');
  await tr.screenshot({ path: path.join(SHOTS, 'first-sign-in.png'), fullPage: true });
  await tr.fill('#fpEmail', 'not.mine@example.com');
  await tr.fill('#fpNew', 'Counting The Cost 9'); await tr.fill('#fpAgain', 'Counting The Cost 9');
  await tr.click('#firstPwForm button[type=submit]');
  await tr.waitForFunction(() => /not the email/.test(document.getElementById('fpMsg').textContent));
  check(true, 'the wrong email is refused, with the reason');
  const trEmail = fakeModels.Member._docs.find(m => m.id === treasurerMember).email;
  await tr.fill('#fpEmail', trEmail);
  await tr.click('#firstPwForm button[type=submit]');
  await tr.waitForSelector('#portalShell', { state: 'visible', timeout: 8000 });
  check(true, 'with the right email and a good password, the portal opens');
  await tr.waitForSelector('#portalNav button', { state: 'attached' });
  check((await tr.$$eval('#portalNav button', b => b.map(x => x.textContent.trim()))).includes('Account for Money'), 'as the Treasurer\'s own portal');

  check(errors.length === 0, 'no script errors on any page', errors);
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall account screen checks passed');
  console.log('screenshots: ' + SHOTS);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
