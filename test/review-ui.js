// Reviewing many at once, on a phone-sized screen: Shepherding ticks everyone
// waiting and accepts and activates them in one go; the Coordinator gives two
// waiting executives their offices from one table and gets one sheet of logins.
//
//   node test/review-ui.js
const path = require('path');
const os = require('os');
const { fakeModels } = require('./harness.js');
const { chromium } = require('playwright');

(async () => {
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/aconsu_review_ui', PORT: '4378', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 'test', LOGIN_RATE_LIMIT_MAX: '500' });
  delete process.env.SHEPHERD_USERNAME;
  let failures = 0;
  function check(cond, label, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 400)}` : ''}`); }
  }
  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4378';
  let jar = '';
  const api = async (m, p, b) => { const h = {}; if (jar) h.cookie = jar; if (b) h['content-type'] = 'application/json'; const r = await fetch(BASE + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) jar = sc.map(c => c.split(';')[0]).join('; '); return r.json().catch(() => ({})); };
  const C = 'aconsu-knust';
  await api('POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  await api('POST', '/api/national/chapters', { id: C, name: 'ACONSU-KNUST', institution: 'KNUST' });
  let n = 0;
  const member = async (name) => {
    n += 1;
    const f = new FormData();
    f.append('profileImage', new Blob([Buffer.from(name)], { type: 'image/png' }), 'p.png');
    Object.entries({ name, email: `u${n}@example.com`, phone: `02448000${String(n).padStart(2, '0')}`, password: 'secret123', chapterId: C, consent: 'true' }).forEach(([k, v]) => f.append(k, v));
    return (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: f })).json()).member.id;
  };
  const shepId = await member('Shepherd Lead');
  const coordId = await member('Coordinator Abena');
  await api('POST', '/api/admin/staff', { username: 'shep.knust', name: 'Shepherd Lead', role: 'shepherding', password: 'Office-Pass-12345', memberId: shepId, chapterId: C });
  await api('POST', '/api/admin/staff', { username: 'coord.knust', name: 'Coordinator Abena', role: 'coordinator', password: 'Office-Pass-12345', memberId: coordId, chapterId: C });
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; a.mustSetUpSecondStep = false; });
  const team = await member('Team Ama');
  const doc = (id) => fakeModels.Member._docs.find(m => m.id === id);
  doc(team).membershipStage = 'active'; doc(team).onShepherdTeam = true;
  const intake = [];
  for (let i = 1; i <= 5; i++) intake.push(await member(`Newcomer ${i}`));
  const waitingA = await member('Waiting Kwame');
  const waitingB = await member('Waiting Esi');
  doc(waitingA).membershipStage = 'executive';
  doc(waitingB).membershipStage = 'executive';

  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
  const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
  const errors = [];
  const signIn = async (page, username) => {
    page.on('pageerror', e => errors.push(e.message));
    await page.fill('#portalUsername', username);
    await page.fill('#portalPassword', 'Office-Pass-12345');
    await page.click('#portalLoginBtn');
    await page.waitForSelector('#portalShell', { state: 'visible' });
    await page.waitForTimeout(500);
  };

  console.log('\n== Shepherding accepts everyone waiting, in one go ==');
  const s = await (await browser.newContext(phone)).newPage();
  await s.goto(`${BASE}/shepherding.html`, { waitUntil: 'networkidle' });
  await signIn(s, 'shep.knust');
  await s.evaluate(() => window.openPanel('visitors'));
  await s.waitForSelector('#pipelineAll');
  await s.tap('#pipelineAll');
  check((await s.textContent('#pipelineCount')).includes(`${intake.length + 3}`) || (await s.textContent('#pipelineCount')).includes('selected'), 'select all ticks everyone waiting', await s.textContent('#pipelineCount'));
  await s.tap('#pipelineAccept');
  await s.waitForSelector('#acceptForm');
  check(await s.$eval('#acceptShepherd', el => el.value) === 'share', 'shepherds are shared out among the team unless one is chosen');
  await s.screenshot({ path: path.join(os.tmpdir(), 'review-accept.png') });
  await s.click('#acceptForm button[type="submit"]');
  await s.waitForTimeout(1500);
  // The check-up team is Team Ama, and the Coordinator by virtue of the office.
  const shepherds = intake.map(id => doc(id).shepherdMemberId);
  check(intake.every(id => doc(id).membershipStage === 'active' && doc(id).membershipNumber) && shepherds.every(x => [team, coordId].includes(x)), 'all five newcomers are active members, numbered, with a shepherd from the team', intake.map(id => [doc(id).membershipStage, doc(id).membershipNumber, doc(id).shepherdName]));
  const counts = [team, coordId].map(t => shepherds.filter(x => x === t).length);
  check(Math.abs(counts[0] - counts[1]) <= 1, 'shared evenly between them', counts);
  const wide = await s.evaluate(() => document.documentElement.scrollWidth);
  check(wide <= 391, 'nothing slides sideways on a phone', wide);

  console.log('\n== the Coordinator appoints both waiting executives at once ==');
  const c = await (await browser.newContext(phone)).newPage();
  await c.goto(`${BASE}/coordinator.html`, { waitUntil: 'networkidle' });
  await signIn(c, 'coord.knust');
  await c.evaluate(() => window.openPanel('accounts'));
  await c.waitForSelector('[data-wait-row]');
  check((await c.$$('[data-wait-row]')).length === 2, 'both waiting executives are in one table');
  await c.selectOption(`[data-wait-row="${waitingA}"] .wait-position`, 'president');
  await c.selectOption(`[data-wait-row="${waitingB}"] .wait-position`, 'general_secretary');
  check((await c.textContent('#waitCount')).includes('2 selected'), 'choosing an office ticks the row', await c.textContent('#waitCount'));
  await c.tap('#waitAppoint');
  await c.waitForSelector('#appointedDone', { timeout: 10000 });
  const sheet = await c.$$eval('#modalContent tbody tr', rows => rows.map(r => r.textContent.replace(/\s+/g, ' ').trim()));
  check(sheet.length === 2 && sheet.some(t => /President/.test(t) && /president\./.test(t)) && sheet.some(t => /General Secretary/.test(t)), 'one sheet with both logins', sheet);
  await c.screenshot({ path: path.join(os.tmpdir(), 'review-appointed.png') });
  check(fakeModels.StaffUser._docs.filter(a => [waitingA, waitingB].includes(a.memberId)).length === 2, 'both have their office accounts');
  check(errors.length === 0, 'no page errors', errors);

  await browser.close();
  console.log(failures ? `\n${failures} FAILURES` : '\nall review screen checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
