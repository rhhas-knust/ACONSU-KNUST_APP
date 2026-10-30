// The short sign-up in a real browser, on a phone: five things to fill in, the
// photo straight after (and nothing else opens until there is one), signing
// in again with the phone number, and the profile asking gently for the rest.
//
//   node test/signup-ui.js
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
const SHOTS = process.env.SIGNUP_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'signup-shots-'));
let failures = 0;
const check = (label, ok, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || detail === undefined ? '' : ' - ' + JSON.stringify(detail).slice(0, 300))); if (!ok) failures++; };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const { fakeModels } = require(path.join(ROOT, 'test', 'harness.js'));
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/signup-ui', PORT: '4480', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 't', LOGIN_RATE_LIMIT_MAX: '900' });
  require(path.join(ROOT, 'server.js'));
  await new Promise(r => setTimeout(r, 1500));
  const BASE = 'http://127.0.0.1:4480';
  let jar = '';
  const api = async (m, p, b) => { const h = {}; if (jar) h.cookie = jar; if (b) h['content-type'] = 'application/json'; const r = await fetch(BASE + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) jar = sc.map(c => c.split(';')[0]).join('; '); return r.json().catch(() => ({})); };
  await api('POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  await api('POST', '/api/national/chapters', { id: 'aconsu-knust', name: 'ACONSU KNUST', institution: 'KNUST' });

  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  const ctx = await browser.newContext(phone);
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  const noSideways = () => p.evaluate((w) => document.documentElement.scrollWidth <= w + 1, 390);

  console.log('\n== signing up ==');
  await p.goto(`${BASE}/register.html`, { waitUntil: 'networkidle' });
  const fields = await p.$$eval('#registerForm input:not([type=hidden]), #registerForm select', els => els.filter(e => e.offsetParent).map(e => e.id));
  check('five things to fill in, and the box to agree', JSON.stringify(fields) === JSON.stringify(['name', 'phone', 'chapterId', 'password', 'email', 'agree']), fields);
  check('the email address says it is optional', /optional/i.test(await p.textContent('label[for="email"]')));
  check('no photo, programme, level, hall or birthday on the form', await p.locator('#profileImage, #programme, #level, #hostel, #birthdayMonth').count() === 0);
  check('the only chapter is chosen already', await p.inputValue('#chapterId') === 'aconsu-knust');
  await p.click('#registerBtn');
  check('sent empty, it says what is missing first', /full name/.test(await p.textContent('#registerMsg')));
  await p.fill('#name', 'Efua Asante');
  await p.fill('#phone', '020 765 4321');
  await p.fill('#password', 'secret123');
  await p.check('#agree');
  await p.screenshot({ path: path.join(SHOTS, 'register.png'), fullPage: true });
  check('it fits the phone', await noSideways());
  await p.click('#registerBtn');
  await p.waitForURL(/\/photo\.html/);
  await p.waitForSelector('#photoForm');
  check('then straight to the photo', /your photo/i.test(await p.textContent('#photoTitle')));

  console.log('\n== the photo comes first ==');
  await p.goto(`${BASE}/events.html`, { waitUntil: 'networkidle' });
  await p.waitForURL(/\/photo\.html\?next=%2Fevents\.html/);
  check('any other page sends them back to it, remembering where they were going', true);
  await p.goto(`${BASE}/privacy.html`, { waitUntil: 'networkidle' });
  check('the privacy page still opens', /\/privacy\.html$/.test(p.url()));
  await p.goto(`${BASE}/photo.html?next=%2Fevents.html`, { waitUntil: 'networkidle' });
  const small = await p.$$eval('.photo-pick .btn, #photoSave', els => els.map(e => Math.round(e.getBoundingClientRect().height)).filter(h => h < 44));
  check('take or choose a photo, both big enough to tap', small.length === 0 && await p.locator('#photoCamera[capture="user"]').count() === 1, small);
  check('saving waits for a photo', await p.isDisabled('#photoSave'));
  await p.setInputFiles('#photoFile', { name: 'me.png', mimeType: 'image/png', buffer: PNG });
  check('the chosen photo is shown', await p.isVisible('#photoPreview'));
  await p.screenshot({ path: path.join(SHOTS, 'photo.png'), fullPage: true });
  await p.click('#photoSave');
  await p.waitForURL(/\/events\.html$/);
  check('saved, they go on to where they were going', true);
  const efua = fakeModels.Member._docs.find(m => m.name === 'Efua Asante');
  check('the account has the number, the photo, and no email field', efua && efua.phoneKey === '233207654321' && efua.profileImageFileId && !('email' in efua), efua);

  console.log('\n== signing in with the phone number ==');
  await p.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }));
  await p.goto(`${BASE}/login.html`, { waitUntil: 'networkidle' });
  check('the sign-in box asks for a phone number or email', /phone number or email/i.test(await p.textContent('label[for="email"]')));
  await p.fill('#email', '+233 20 765 4321');
  await p.fill('#password', 'secret123');
  await p.click('#loginBtn');
  await p.waitForURL(/\/profile\.html$/);
  check('the number typed another way signs them in', true);

  console.log('\n== the profile asks for the rest, gently ==');
  await p.waitForSelector('#completeProfile:not([hidden])');
  const asked = await p.$$eval('#completeList li', els => els.map(e => e.textContent));
  check('it lists what is missing', asked.includes('What you study') && asked.some(t => /birthday/i.test(t)), asked);
  check('nothing about it is required', await p.$$eval('#detailsForm [required]', els => els.map(e => e.id)).then(ids => JSON.stringify(ids) === '["name"]'));
  await p.check('input[name="memberKind"][value="alumni"]');
  check('"finished" asks for the year instead of the level and hall', await p.isVisible('#graduationYear') && !await p.isVisible('#hostel'));
  await p.check('input[name="memberKind"][value="student"]');
  await p.fill('#programme', 'BSc Nursing');
  await p.click('#detailsSubmitBtn');
  await p.waitForFunction(() => /updated/i.test(document.getElementById('detailsMsg').textContent));
  check('what they add is saved', fakeModels.Member._docs.find(m => m.id === efua.id).programme === 'BSc Nursing');
  await p.click('#completeLater');
  check('"Not now" puts it away', await p.isHidden('#completeProfile'));
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  check('and it stays away', await p.isHidden('#completeProfile'));
  check('the profile fits the phone', await noSideways());

  check('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall sign-up screen checks passed');
  console.log(`screenshots: ${SHOTS}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
