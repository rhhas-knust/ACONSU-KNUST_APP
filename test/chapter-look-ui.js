// The main admin and a chapter's own things, in a real browser: its look, events,
// members and accounts panels are locked until the chapter asks, open while it
// has, and close again when done.
//
//   node test/chapter-look-ui.js
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
const SHOTS = process.env.LOOK_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'look-shots-'));
let failures = 0;
const check = (ok, label, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || detail === undefined ? '' : ' - ' + JSON.stringify(detail).slice(0, 300))); if (!ok) failures++; };

(async () => {
  require(path.join(ROOT, 'test', 'harness.js'));
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/look-ui', PORT: '4474', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 't', LOGIN_RATE_LIMIT_MAX: '900' });
  require(path.join(ROOT, 'server.js'));
  await new Promise(r => setTimeout(r, 1500));
  const BASE = 'http://127.0.0.1:4474';
  let jar = '';
  const api = async (m, p, b) => { const h = {}; if (jar) h.cookie = jar; if (b) h['content-type'] = 'application/json'; const r = await fetch(BASE + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) jar = sc.map(c => c.split(';')[0]).join('; '); return r.json().catch(() => ({})); };
  await api('POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  await api('POST', '/api/national/chapters', { id: 'aconsu-knust', name: 'ACONSU KNUST', institution: 'KNUST' });
  let n = 0;
  const member = async (name, chapterId) => {
    n += 1;
    const fd = new FormData();
    fd.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
    Object.entries({ name, email: `lk${n}@example.com`, password: 'secret123', chapterId, consent: 'true' }).forEach(([k, v]) => fd.append(k, v));
    return (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd })).json()).member.id;
  };
  await api('POST', '/api/admin/staff', { username: 'coord', name: 'Chapter Coordinator', role: 'coordinator', password: 'password1234', memberId: await member('Coord', 'aconsu-knust'), chapterId: 'aconsu-knust' });

  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  const newPage = async () => { const c = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p = await c.newPage(); p.on('pageerror', e => errors.push(e.message)); p.on('dialog', d => d.accept('Banner replaced.')); return p; };
  const adminSignIn = async (p, page) => {
    await p.goto(`${BASE}/${page || 'admin'}.html`, { waitUntil: 'networkidle' });
    await p.fill('#username', 'admin'); await p.fill('#password', 'admin123'); await p.click('#loginForm button[type="submit"]');
    await p.waitForSelector('#adminShell', { state: 'visible' });
  };

  console.log('\n== before the chapter asks ==');
  const adm = await newPage();
  await adminSignIn(adm);
  await adm.click('[data-panel="chapterSettings"]');
  await adm.waitForSelector('#panel-chapterSettings .oversight-note');
  check(/belongs to ACONSU KNUST/.test(await adm.textContent('#panel-chapterSettings .oversight-note')), 'the chapter settings say whose look this is, and how the chapter can ask');
  const editable = await adm.$$eval('#panel-chapterSettings input, #panel-chapterSettings textarea', els => els.filter(e => !e.disabled && e.offsetParent).length);
  check(editable === 0, 'and nothing on them can be changed', editable);
  await adm.screenshot({ path: path.join(SHOTS, 'look-locked.png'), fullPage: true });
  await adm.click('[data-panel="media"]');
  await adm.waitForSelector('#panel-media .oversight-note');
  check(true, 'the media library is locked the same way');
  await adm.click('[data-panel="events"]');
  await adm.waitForSelector('#panel-events .oversight-note');
  check(/events belong to ACONSU KNUST/.test(await adm.textContent('#panel-events .oversight-note')) && !(await adm.isVisible('#addBtn-events')), 'so are its events, with no way to add one');
  await adm.click('[data-panel="members"]');
  await adm.waitForSelector('#panel-members .oversight-note');
  check(/members belong to ACONSU KNUST/.test(await adm.textContent('#panel-members .oversight-note')), 'and its members');
  await adm.click('[data-panel="staff"]');
  await adm.waitForSelector('#panel-staff .oversight-note');
  const staffText = await adm.textContent('#panel-staff');
  check(/leadership accounts belong to ACONSU KNUST/.test(staffText) && /View only/.test(staffText) && await adm.locator('#panel-staff [data-edit-staff]').count() === 0,
    'its leadership accounts are view only');
  await adm.click('#addStaffBtn');
  await adm.waitForSelector('#stRole');
  const roles = await adm.$$eval('#stRole option', os => os.map(o => o.value));
  check(roles.length === 1 && roles[0] === 'nationalCoordinator' && /Add National Coordinator/.test(staffText), 'while a National Coordinator\'s account, the main admin\'s own, can still be made', roles);
  await adm.click('#cancelModalBtn');
  check(await adm.isVisible('#navChapterRequestsBtn') && !(await adm.isVisible('#navAskNationalBtn')), 'the main admin has Chapter Requests, not Ask National');
  await adm.click('[data-panel="chapterRequests"]');
  await adm.waitForSelector('#panel-chapterRequests .cr-card');
  check(/No chapter has asked/.test(await adm.textContent('#panel-chapterRequests')), 'and no chapter has asked yet');

  console.log('\n== the chapter asks ==');
  const co = await newPage();
  await co.goto(`${BASE}/coordinator.html`, { waitUntil: 'networkidle' });
  await co.fill('#portalUsername', 'coord'); await co.fill('#portalPassword', 'password1234'); await co.click('#portalLoginBtn');
  await co.waitForSelector('#portalNav button', { state: 'attached' });
  await co.click('#portalNav button:text-is("Ask National for Help")');
  await co.waitForSelector('#crForm');
  const unlabelled = await co.$$eval('#crForm textarea, #crForm select', els => els.filter(e => !(e.labels && e.labels.length)).map(e => e.id));
  check(unlabelled.length === 0, 'the request form is labelled', unlabelled);
  await co.fill('#crMessage', 'Please replace our home banner with the retreat photo.');
  await co.click('#crForm button[type=submit]');
  await co.waitForSelector('[data-withdraw]');
  check(/retreat photo/.test(await co.textContent('.portal-panel.active')), 'the Coordinator sends it and sees it open');
  await co.screenshot({ path: path.join(SHOTS, 'ask-national.png'), fullPage: true });

  console.log('\n== while the request is open ==');
  await adm.reload({ waitUntil: 'domcontentloaded' });
  await adm.waitForSelector('#adminShell', { state: 'visible' });
  await adm.click('[data-panel="chapterSettings"]');
  await adm.waitForSelector('#panel-chapterSettings .cr-notice');
  check(/asked for help/.test(await adm.textContent('#panel-chapterSettings .cr-notice')) && await adm.locator('#panel-chapterSettings .oversight-note').count() === 0, 'the settings open, with the chapter\'s request at the top');
  const nowEditable = await adm.$$eval('#panel-chapterSettings input, #panel-chapterSettings textarea', els => els.filter(e => !e.disabled && e.offsetParent).length);
  check(nowEditable > 0, 'and can be changed', nowEditable);
  await adm.click('[data-panel="events"]');
  await adm.waitForSelector('#addBtn-events');
  check(await adm.isVisible('#addBtn-events') && await adm.locator('#panel-events .oversight-note').count() === 0, 'its events open too');
  await adm.click('[data-panel="staff"]');
  await adm.waitForSelector('#panel-staff [data-edit-staff]');
  check(await adm.locator('#panel-staff .oversight-note').count() === 0 && /\+ Add Account/.test(await adm.textContent('#addStaffBtn')), 'and its accounts');
  await adm.click('[data-panel="chapterRequests"]');
  await adm.waitForSelector('[data-done]');
  check(/ACONSU KNUST/.test(await adm.textContent('#panel-chapterRequests')) && /retreat photo/.test(await adm.textContent('#panel-chapterRequests')), 'the main admin sees which chapter asked and what for');
  await adm.screenshot({ path: path.join(SHOTS, 'chapter-requests.png'), fullPage: true });
  await adm.click('[data-done]');
  await adm.waitForFunction(() => /No chapter has asked/.test(document.getElementById('panel-chapterRequests').textContent));
  check(true, 'and marks it done when the work is finished');
  await adm.reload({ waitUntil: 'domcontentloaded' });
  await adm.waitForSelector('#adminShell', { state: 'visible' });
  await adm.click('[data-panel="chapterSettings"]');
  await adm.waitForSelector('#panel-chapterSettings .oversight-note');
  check(true, 'after which the chapter\'s look is locked again');
  await co.click('#portalNav button:text-is("Ask National for Help")');
  await co.waitForFunction(() => /Banner replaced/.test(document.querySelector('.portal-panel.active').textContent));
  check(true, 'and the chapter sees it marked done, with National\'s note');

  console.log('\n== several chapters: working on the one that asked ==');
  await api('POST', '/api/national/chapters', { id: 'aconsu-ucc', name: 'ACONSU UCC', institution: 'UCC' });
  await api('POST', '/api/admin/staff', { username: 'admin.ucc', name: 'UCC Admin', role: 'chapterAdmin', password: 'password1234', memberId: await member('UCC Admin', 'aconsu-ucc'), chapterId: 'aconsu-ucc' });
  const ch = await newPage();
  await ch.goto(`${BASE}/chapter.html`, { waitUntil: 'networkidle' });
  await ch.waitForSelector('#loginForm');
  const pick = await ch.$('#leaderChapter');
  if (pick) await ch.selectOption('#leaderChapter', 'aconsu-ucc');
  await ch.fill('#username', 'admin.ucc'); await ch.fill('#password', 'password1234'); await ch.click('#loginForm button[type="submit"]');
  await ch.waitForSelector('#adminShell', { state: 'visible' });
  check(await ch.isVisible('#navAskNationalBtn'), 'a Chapter Admin has Ask National for Help');
  await ch.click('[data-panel="askNational"]');
  await ch.waitForSelector('#crForm');
  await ch.fill('#crMessage', 'Please add our new logo to the about page.');
  await ch.click('#crForm button[type=submit]');
  await ch.waitForSelector('[data-withdraw]');
  await adm.reload({ waitUntil: 'domcontentloaded' });
  await adm.waitForSelector('#adminShell', { state: 'visible' });
  check(!(await adm.isVisible('[data-panel="chapterSettings"]')), 'with several chapters, the main admin\'s dashboard shows no chapter panels by default');
  await adm.click('[data-panel="chapterRequests"]');
  await adm.waitForSelector('[data-work]');
  await adm.click('[data-work]');
  await adm.waitForSelector('#stopHelpingBtn');
  check(/ACONSU UCC/.test(await adm.textContent('.cr-notice')), 'working on the chapter that asked says whose look it is');
  check(await adm.isVisible('[data-panel="chapterSettings"]') && await adm.isVisible('[data-panel="events"]') && await adm.isVisible('[data-panel="members"]') && await adm.isVisible('[data-panel="staff"]')
    && !(await adm.isVisible('[data-panel="prayerRequests"]')) && !(await adm.isVisible('[data-panel="contactMessages"]')),
    'and opens only what a chapter can ask for: its look, events, members and accounts, not its prayer requests or messages');
  await adm.click('[data-panel="chapterSettings"]');
  await adm.waitForSelector('#panel-chapterSettings .cr-notice');
  check(/ACONSU UCC asked for help/.test(await adm.textContent('#panel-chapterSettings .cr-notice')), 'the settings shown are that chapter\'s, open at its request');
  await adm.click('#stopHelpingBtn');
  await adm.waitForSelector('#adminShell', { state: 'visible' });
  await adm.waitForTimeout(400);
  check(!(await adm.isVisible('[data-panel="chapterSettings"]')), 'Stop returns to the national dashboard');

  check(errors.length === 0, 'no script errors', errors);
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall chapter-look screen checks passed');
  console.log('screenshots: ' + SHOTS);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
