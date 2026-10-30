// Codes by text in a real browser, on a phone: signing in with one, choosing
// a new password with one, and signing up without a password where the
// chapter has its own SMS account; and none of it offered where the chapter
// cannot send texts. The SMS provider is answered here.
//
//   node test/sms-ui.js
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
const SHOTS = process.env.SMS_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'sms-shots-'));
let failures = 0;
const check = (label, ok, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || detail === undefined ? '' : ' - ' + JSON.stringify(detail).slice(0, 300))); if (!ok) failures++; };

(async () => {
  const { fakeModels } = require(path.join(ROOT, 'test', 'harness.js'));
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/sms-ui', PORT: '4481', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 't', LOGIN_RATE_LIMIT_MAX: '900', SMS_CODE_LIMIT_MAX: '100' });
  ['MNOTIFY_API_KEY', 'SMS_SENDER_ID'].forEach(k => delete process.env[k]);
  const texts = [];
  const passOn = global.fetch;
  global.fetch = (url, opts) => {
    if (String(url).startsWith('https://apps.mnotify.net/')) {
      const q = new URL(String(url)).searchParams;
      texts.push({ to: q.get('to'), msg: q.get('msg') });
      return Promise.resolve(new Response('1000', { status: 200 }));
    }
    return passOn(url, opts);
  };
  const lastCode = async () => { await new Promise(r => setTimeout(r, 150)); const t = texts[texts.length - 1]; return t && (t.msg.match(/\b(\d{6})\b/) || [])[1]; };

  require(path.join(ROOT, 'server.js'));
  await new Promise(r => setTimeout(r, 1500));
  const BASE = 'http://127.0.0.1:4481';
  let jar = '';
  const api = async (m, p, b) => { const h = {}; if (jar) h.cookie = jar; if (b) h['content-type'] = 'application/json'; const r = await fetch(BASE + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) jar = sc.map(c => c.split(';')[0]).join('; '); return r.json().catch(() => ({})); };
  await api('POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  for (const [id, name] of [['aconsu-knust', 'KNUST'], ['aconsu-ucc', 'UCC']]) await api('POST', '/api/national/chapters', { id, name: `ACONSU ${name}`, institution: name });
  fakeModels.Chapter._docs.find(c => c.id === 'aconsu-knust').sms = { apiKey: 'knust-key', senderId: 'ACONSU' };
  jar = '';
  await api('POST', '/api/auth/register', { name: 'Ama Owusu', phone: '0244123456', chapterId: 'aconsu-knust', password: 'secret123', consent: 'true' });
  fakeModels.Member._docs.find(m => m.name === 'Ama Owusu').profileImageFileId = 'f1';

  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  async function open(chapterId, url) {
    const ctx = await browser.newContext(phone);
    await ctx.addInitScript((c) => { try { localStorage.setItem('aconsu_chapter_id', c); } catch (e) { /* fine */ } }, chapterId);
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(BASE + url, { waitUntil: 'networkidle' });
    return p;
  }

  console.log('\n== signing in with a code ==');
  let p = await open('aconsu-ucc', '/login.html');
  check('where the chapter cannot send texts, only the password is offered', await p.isHidden('#codeSwitchWrap'));
  await p.context().close();
  p = await open('aconsu-knust', '/login.html');
  await p.waitForSelector('#codeSwitchWrap:not([hidden])');
  await p.click('#codeSwitch');
  check('where it can, a code by text instead of the password', await p.isHidden('#passwordField') && /phone number/i.test(await p.textContent('label[for="email"]')));
  await p.fill('#email', '024 412 3456');
  await p.click('#loginBtn');
  await p.waitForSelector('#codeField:not([hidden])');
  check('asking says a code is on its way, the same for anyone', /code is on its way/.test(await p.textContent('#loginMsg')));
  await p.fill('#smsCodeInput', await lastCode());
  await p.screenshot({ path: path.join(SHOTS, 'login-code.png'), fullPage: true });
  await p.click('#loginBtn');
  await p.waitForURL(/\/profile\.html$/);
  check('the code from the text signs them in', true);
  await p.context().close();

  console.log('\n== a new password by code ==');
  p = await open('aconsu-knust', '/forgot-password.html');
  await p.fill('#email', '0244123456');
  await p.click('#forgotBtn');
  await p.waitForSelector('#resetByCode:not([hidden])');
  await p.fill('#resetCode', await lastCode());
  await p.fill('#newPassword', 'brand-new-pass');
  await p.click('#forgotBtn');
  await p.waitForSelector('a[href="/login.html"].btn');
  check('the code and a new password change it', /password is changed/i.test(await p.textContent('#forgotMsg')));
  const ok = await (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: '0244123456', password: 'brand-new-pass' }) })).status;
  check('and the new password signs in', ok === 200);
  await p.context().close();
  p = await open('aconsu-ucc', '/forgot-password.html');
  await p.fill('#email', '0551234567');
  await p.click('#forgotBtn');
  await p.waitForFunction(() => document.getElementById('forgotMsg').textContent.length > 0);
  check('where the chapter cannot send texts, it says so plainly and points to email', /not set up for your chapter/.test(await p.textContent('#forgotMsg')));
  await p.context().close();

  console.log('\n== signing up without a password ==');
  p = await open('aconsu-knust', '/register.html');
  await p.selectOption('#chapterId', 'aconsu-knust');
  await p.waitForSelector('#codeSignup:not([hidden])');
  await p.click('#codeSignupSwitch');
  check('where the chapter has its own SMS account, a code can replace the password', await p.isHidden('#passwordWrap') && await p.isVisible('#sendSignupCode'));
  await p.fill('#name', 'Efua Code');
  await p.fill('#phone', '020 111 2222');
  await p.click('#sendSignupCode');
  await p.waitForFunction(() => /on its way/.test(document.getElementById('registerMsg').textContent));
  await p.fill('#signupCode', await lastCode());
  await p.check('#agree');
  await p.click('#registerBtn');
  await p.waitForURL(/\/photo\.html/);
  const efua = fakeModels.Member._docs.find(m => m.name === 'Efua Code');
  check('the account is made with no password, and on to the photo', efua && efua.passwordHash === '');
  efua.profileImageFileId = 'f2';
  await p.goto(`${BASE}/profile.html`, { waitUntil: 'networkidle' });
  await p.click('.profile-tabs [data-tab="password"]');
  check('the profile offers to set a first password, with no old one to type', await p.isHidden('#currentPasswordWrap') && /Set my password/.test(await p.textContent('#passwordSubmitBtn')));
  check('and confirms by code before downloading or deleting their data', await p.isVisible('#myDataSendCode') && await p.isHidden('#myDataPasswordWrap'));
  await p.screenshot({ path: path.join(SHOTS, 'profile-no-password.png'), fullPage: true });
  await p.context().close();
  p = await open('aconsu-ucc', '/register.html');
  await p.selectOption('#chapterId', 'aconsu-ucc');
  await p.waitForTimeout(400);
  check('where it has not, the password stays', await p.isHidden('#codeSignup') && await p.isVisible('#password'));
  await p.context().close();

  check('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall SMS screen checks passed');
  console.log(`screenshots: ${SHOTS}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
