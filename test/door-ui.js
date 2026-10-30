// The visitor QR code in real browsers, on phones: Shepherding makes today's
// code on the Sunday Check-In screen and shows it large; a visitor opens it on
// their own phone, checks in, and lands on a thank-you with links to the
// website; the door's list shows them.
//
//   node test/door-ui.js
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
const SHOTS = process.env.DOOR_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'door-shots-'));
let failures = 0;
const check = (label, ok, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || detail === undefined ? '' : ' - ' + JSON.stringify(detail).slice(0, 300))); if (!ok) failures++; };

(async () => {
  const { fakeModels } = require(path.join(ROOT, 'test', 'harness.js'));
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/door-ui', PORT: '4479', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 't', LOGIN_RATE_LIMIT_MAX: '900' });
  delete process.env.SHEPHERD_USERNAME;
  delete process.env.PUBLIC_BASE_URL;
  require(path.join(ROOT, 'server.js'));
  await new Promise(r => setTimeout(r, 1500));
  const BASE = 'http://127.0.0.1:4479';
  let jar = '';
  const api = async (m, p, b) => { const h = {}; if (jar) h.cookie = jar; if (b) h['content-type'] = 'application/json'; const r = await fetch(BASE + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) jar = sc.map(c => c.split(';')[0]).join('; '); return r.json().catch(() => ({})); };
  await api('POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  const C = 'aconsu-knust';
  await api('POST', '/api/national/chapters', { id: C, name: 'ACONSU KNUST', institution: 'KNUST' });
  const fd = new FormData();
  fd.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
  Object.entries({ name: 'Shepherding Head', email: 'doorui@example.com', password: 'secret123', chapterId: C, consent: 'true' }).forEach(([k, v]) => fd.append(k, v));
  const memberId = (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd })).json()).member.id;
  await api('POST', '/api/admin/staff', { username: 'shep', name: 'Shepherding Head', role: 'shepherding', password: 'Start-Pass-1234', memberId, chapterId: C });
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; });

  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  const noSideways = (p) => p.evaluate((w) => document.documentElement.scrollWidth <= w + 1, p.viewportSize().width);
  const small = (p, scope) => p.$$eval(`${scope} button, ${scope} input, ${scope} select, ${scope} a.btn`, els => els
    .filter(e => e.offsetParent && e.type !== 'checkbox' && !e.closest('.welcome-trap'))
    .map(e => [e.id || e.textContent.trim().slice(0, 30), Math.round(e.getBoundingClientRect().height)])
    .filter(([, h]) => h < 44));

  console.log('\n== Shepherding makes today\'s code ==');
  const sc = await browser.newContext(phone);
  const s = await sc.newPage();
  s.on('pageerror', e => errors.push(`shepherd: ${e.message}`));
  await s.goto(`${BASE}/shepherding.html#checkin`, { waitUntil: 'networkidle' });
  await s.fill('#portalUsername', 'shep'); await s.fill('#portalPassword', 'Start-Pass-1234'); await s.click('#portalLoginBtn');
  await s.waitForSelector('#doorCodeCard #doorMake');
  check('the check-in screen offers to make the visitor code for today', /Make the visitor code for Sunday/.test(await s.textContent('#doorMake')));
  await s.click('#doorMake');
  await s.waitForSelector('#doorQr');
  const url = (await s.textContent('.door-url')).trim();
  check('it shows the QR code and the link it opens', (await s.getAttribute('#doorQr', 'src')).startsWith('data:image/png') && /\/welcome\.html\?c=/.test(url), url);
  check('and says it works today only', /only\./.test(await s.textContent('#doorCodeCard')));
  await s.click('#doorPrint');
  await s.waitForSelector('.door-print img');
  check('Show large or print opens a sheet with the code and "New here?"', /New here\?/.test(await s.textContent('.door-print')));
  await s.screenshot({ path: path.join(SHOTS, 'door-sheet.png') });
  await s.click('#doorPrintClose');
  check('the card fits the phone', await noSideways(s));

  console.log('\n== a visitor scans it on their phone ==');
  const vc = await browser.newContext(phone);
  const v = await vc.newPage();
  v.on('pageerror', e => errors.push(`visitor: ${e.message}`));
  const requests = [];
  v.on('request', r => requests.push(r.url()));
  await v.goto(url, { waitUntil: 'networkidle' });
  await v.waitForSelector('#wcForm:not([hidden])');
  check('it opens the welcome form, with the chapter\'s name', (await v.textContent('#wcChapter')).trim() === 'ACONSU KNUST');
  check('it loads nothing from anywhere else, and not the app\'s own scripts', requests.every(u => u.startsWith(BASE)) && !requests.some(u => /main\.js|manifest\.json|sw\.js/.test(u)), requests);
  const unlabelled = await v.$$eval('#wcForm input:not([type=hidden]), #wcForm select', els => els.filter(e => e.offsetParent && !(e.labels && e.labels.length)).map(e => e.id));
  check('every field has a label', unlabelled.length === 0, unlabelled);
  check('everything is big enough to tap', (await small(v, '#wcForm')).length === 0, await small(v, '#wcForm'));
  await v.click('#wcSend');
  check('sending it empty says what is missing', /Type your name/.test(await v.textContent('#wcMsg')));
  await v.fill('#wcName', 'Efua Asante');
  await v.fill('#wcPhone', '020 765 4321');
  await v.fill('#wcProgramme', 'BSc Nursing');
  await v.selectOption('#wcHeard', 'friend');
  await v.click('#wcSend');
  check('the box to agree is needed', /Tick the box/.test(await v.textContent('#wcMsg')));
  await v.check('#wcConsent');
  await v.screenshot({ path: path.join(SHOTS, 'welcome-form.png'), fullPage: true });
  await v.click('#wcSend');
  await v.waitForSelector('#wcDone:not([hidden])');
  check('thanked by name, checked in', (await v.textContent('#wcThanks')).trim() === 'Thank you, Efua. You are checked in.');
  const links = await v.$$eval('#wcDone a', as => as.map(a => a.getAttribute('href')));
  check('with links to the website: when and where, what is coming up, the home page, and a full account', ['/visit.html', '/events.html', '/index.html', '/register.html'].every(h => links.includes(h)), links);
  check('and nothing asking them to install an app', !/install|play store|download the app/i.test(await v.textContent('body')));
  check('the thank-you fits the phone', await noSideways(v));
  await v.screenshot({ path: path.join(SHOTS, 'welcome-done.png'), fullPage: true });
  await v.click('#wcDone a[href="/visit.html"]');
  await v.waitForLoadState('networkidle');
  check('the website then opens on their chapter', await v.evaluate(() => localStorage.getItem('aconsu_chapter_id')) === C);

  console.log('\n== at the door ==');
  await s.click('#portalMenuToggle');
  await s.click('#portalNav button[data-panel="checkin"]');
  await s.waitForSelector('#doorUses');
  const names = await s.$$eval('#ciList .ci-name', els => els.map(e => e.textContent.trim()));
  check('the visitor is on the door\'s list', names.includes('Efua Asante'), names);
  check('and the card counts one check-in with the code', /^1 checked in/.test((await s.textContent('#doorUses')).trim()));
  s.once('dialog', d => d.accept());
  await s.click('#doorOff');
  await s.waitForSelector('#doorMake');
  await v.goto(url, { waitUntil: 'networkidle' });
  await v.waitForSelector('#wcClosed:not([hidden])');
  check('turned off, the link says to ask at the door', /ask someone at the door/i.test(await v.textContent('#wcClosedText')));

  check('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall door checks passed');
  console.log(`screenshots: ${SHOTS}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
