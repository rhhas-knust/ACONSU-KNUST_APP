// Fingerprint and face sign-in in a real Chromium, with its virtual
// authenticator standing in for the phone's fingerprint reader: set it up on
// the profile, sign in to the app with it, then sign in to the Executive Portal
// with it, all on a phone-sized screen.
//
//   node test/passkey-ui.js
const path = require('path');
const { fakeModels } = require('./harness.js');
const { chromium } = require('playwright');
const CHROME = process.env.PLAYWRIGHT_CHROMIUM;

(async () => {
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/aconsu_passkey_ui', PORT: '4375', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 'test', LOGIN_RATE_LIMIT_MAX: '500' });
  ['SHEPHERD_USERNAME', 'PUBLIC_BASE_URL', 'RENDER_EXTERNAL_URL'].forEach(k => delete process.env[k]);
  let failures = 0;
  function check(cond, label, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 400)}` : ''}`); }
  }
  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  // A passkey needs a name, not a number: localhost, never 127.0.0.1.
  const BASE = 'http://localhost:4375';
  let jar = '';
  const api = async (m, p, b) => { const h = {}; if (jar) h.cookie = jar; if (b) h['content-type'] = 'application/json'; const r = await fetch(BASE + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) jar = sc.map(c => c.split(';')[0]).join('; '); return r.json().catch(() => ({})); };
  const C = 'aconsu-knust';
  await api('POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  await api('POST', '/api/national/chapters', { id: C, name: 'ACONSU-KNUST', institution: 'KNUST' });
  const f = new FormData();
  f.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
  Object.entries({ name: 'Kwame Asante', email: 'kwame@example.com', phone: '0244800100', password: 'a-good-long-password', chapterId: C, consent: 'true' }).forEach(([k, v]) => f.append(k, v));
  const memberId = (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: f })).json()).member.id;
  await api('POST', '/api/admin/staff', { username: 'pres.knust', name: 'Kwame Asante', role: 'executive', positionKey: 'president', password: 'Office-Pass-12345', memberId, chapterId: C });
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; a.mustSetUpSecondStep = false; });

  const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });

  console.log('\n== set it up on the profile ==');
  await page.goto(`${BASE}/login.html`, { waitUntil: 'networkidle' });
  check(await page.isVisible('#passkeyLoginBtn'), 'the app\'s login page offers "Sign in with fingerprint or face"');
  await page.fill('#email', 'kwame@example.com');
  await page.fill('#password', 'a-good-long-password');
  await page.click('#loginBtn');
  await page.waitForURL(/profile\.html/);
  await page.waitForSelector('#addPasskeyBtn');
  await page.click('#addPasskeyBtn');
  await page.waitForSelector('.passkey-list li', { timeout: 8000 }).catch(() => {});
  const listed = await page.$$eval('.passkey-list li', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  check(listed.length === 1 && /Android phone|Device|Chrome/.test(listed[0]), 'the profile sets it up and lists this phone', listed);
  check(fakeModels.Passkey._docs.length === 1 && fakeModels.Passkey._docs[0].memberId === memberId, '(saved for the member)');

  console.log('\n== sign in to the app with it ==');
  await ctx.clearCookies();
  await page.goto(`${BASE}/login.html`, { waitUntil: 'networkidle' });
  await page.click('#passkeyLoginBtn');
  await page.waitForURL(/profile\.html/, { timeout: 8000 }).catch(() => {});
  check(/profile\.html/.test(page.url()), 'one tap, the fingerprint, and they are in the app', page.url());

  console.log('\n== sign in to the Executive Portal with it ==');
  await ctx.clearCookies();
  await page.goto(`${BASE}/executive.html`, { waitUntil: 'networkidle' });
  check(await page.isVisible('#portalPasskeyBtn'), 'the portal\'s sign-in offers it too');
  const tall = await page.$eval('#portalPasskeyBtn', b => b.getBoundingClientRect().height);
  check(tall >= 44, 'the button is big enough to tap', tall);
  await page.screenshot({ path: path.join(require('os').tmpdir(), 'passkey-portal.png') });
  await page.click('#portalPasskeyBtn');
  await page.waitForSelector('#portalShell', { state: 'visible', timeout: 8000 }).catch(() => {});
  check(await page.isVisible('#portalShell'), 'and opens the Executive Portal', await page.textContent('#portalLoginMsg').catch(() => ''));
  check(errors.length === 0, 'no page errors', errors);

  await browser.close();
  console.log(failures ? `\n${failures} FAILURES` : '\nall passkey screen checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
