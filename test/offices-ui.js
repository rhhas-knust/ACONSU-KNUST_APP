// The offices' screens in a real browser: the semester outline, budget requests,
// minutes, Sunday announcements and handing an office over, driven the way the
// people in those offices would drive them, on the in-memory data layer.
//
//   node test/offices-ui.js
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
const SHOTS = process.env.OFFICE_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'office-shots-'));
let failures = 0;
const check = (ok, label, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || detail === undefined ? '' : ' - ' + JSON.stringify(detail).slice(0, 300))); if (!ok) failures++; };

(async () => {
  const { fakeModels } = require(path.join(ROOT, 'test', 'harness.js'));
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/offices-ui', PORT: '4472', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 't', LOGIN_RATE_LIMIT_MAX: '900' });
  require(path.join(ROOT, 'server.js'));
  await new Promise(r => setTimeout(r, 1500));
  const BASE = 'http://127.0.0.1:4472';
  let jar = '';
  const api = async (m, p, b) => { const h = {}; if (jar) h.cookie = jar; if (b) h['content-type'] = 'application/json'; const r = await fetch(BASE + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) jar = sc.map(c => c.split(';')[0]).join('; '); return r.json().catch(() => ({})); };
  await api('POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  const C = 'aconsu-knust';
  await api('POST', '/api/national/chapters', { id: C, name: 'ACONSU KNUST', institution: 'KNUST' });
  const dept = {};
  for (const name of ['Choir', 'Welfare', 'Media']) dept[name] = (await api('POST', '/api/admin/departments', { name, tagline: 'x', chapterId: C })).item.id;
  let n = 0;
  const member = async (name) => {
    n += 1;
    const fd = new FormData();
    fd.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
    Object.entries({ name, email: `ui${n}@example.com`, password: 'secret123', chapterId: C, consent: 'true' }).forEach(([k, v]) => fd.append(k, v));
    return (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd })).json()).member.id;
  };
  const staff = async (username, name, role, extra) => api('POST', '/api/admin/staff', { username, name, role, password: 'password1234', memberId: await member(name), chapterId: C, ...(extra || {}) });
  // The main admin sets the chapter up while it has nobody of its own; the
  // Coordinator comes last, and from then on its accounts are the chapter's.
  await staff('pres', 'Yaw President', 'executive', { positionKey: 'president' });
  await staff('vp', 'Efua Vice', 'executive', { positionKey: 'vice_president' });
  await staff('gs', 'Abena Secretary', 'executive', { positionKey: 'general_secretary' });
  await staff('ags', 'Akosua Assistant', 'executive', { positionKey: 'assistant_general_secretary' });
  await staff('fs', 'Kojo FinSec', 'executive', { positionKey: 'financial_secretary' });
  await staff('choir', 'Ama Choir', 'executive', { positionKey: 'music_director', department: dept.Choir });
  await staff('coord', 'Chapter Coordinator', 'coordinator');
  const successor = await member('Kwesi Successor');
  // These accounts are past their first sign-in; that screen has its own test in account-ui.js.
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; });

  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  const sessions = {};
  async function open(who, page, viewport) {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(`${who}: ${e.message}`));
    p.on('dialog', d => d.accept(''));
    await p.goto(`${BASE}/${page}.html`, { waitUntil: 'networkidle' });
    await p.fill('#portalUsername', who);
    await p.fill('#portalPassword', 'password1234');
    await p.click('#portalLoginBtn');
    await p.waitForSelector('#portalNav button', { state: 'attached', timeout: 8000 });
    sessions[who] = { ctx, page: p };
    return p;
  }
  const nav = async (p, label) => { if (await p.isVisible('#portalMenuToggle')) await p.click('#portalMenuToggle'); await p.click(`#portalNav button:text-is("${label}")`); await p.waitForTimeout(250); };
  const panel = (p) => p.locator('.portal-panel.active');
  const labels = (p) => p.$$eval('#portalNav button', b => b.map(x => x.textContent.trim()));
  const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const unlabelled = (p) => p.$$eval('.portal-panel.active input:not([type=hidden]), .portal-panel.active select, .portal-panel.active textarea', els =>
    els.filter(e => e.offsetParent && !(e.labels && e.labels.length) && !e.getAttribute('aria-label') && !e.closest('label')).map(e => e.id || e.dataset.k || e.name));
  const small = (p) => p.$$eval('.portal-panel.active button, .portal-panel.active input[type=checkbox], .portal-panel.active input[type=radio], .portal-panel.active select, .portal-panel.active a', els =>
    els.filter(e => e.offsetParent).map(e => { const lab = e.closest('label'); const r = (lab && (e.type === 'checkbox' || e.type === 'radio') ? lab : e).getBoundingClientRect(); return [e.textContent.trim().slice(0, 24) || e.id || e.type, Math.round(r.width), Math.round(r.height)]; })
      .filter(([, w, h]) => h < 44 || w < 24));

  // ----------------------------------------------------------- the President --
  console.log('\n== the President writes the semester outline ==');
  const pres = await open('pres', 'executive');
  const navPres = await labels(pres);
  check(navPres.includes('Semester Outline') && !navPres.includes('Minutes') === false, 'the President\'s menu has the outline and the minutes: ' + navPres.join(' | '));
  check(!navPres.includes('Budget Requests') && !navPres.includes('Committees'), 'and not the Financial Secretary\'s or the Vice President\'s screens');
  await nav(pres, 'Semester Outline');
  await pres.waitForSelector('#startOutline');
  check(/first|second/.test(await pres.inputValue('#oTitle')), 'a new outline starts with a suggested title');
  await pres.click('#startOutline button[type=submit]');
  await pres.waitForSelector('#outlineForm');
  check(await pres.locator('.of-section').count() === 6, 'the form has six numbered sections');
  check((await pres.textContent('#oChecklist')).includes('Still needed'), 'and says what is still needed before it can be sent');
  await pres.fill('#oLabel', '2026/2027 first semester');
  await pres.fill('#oStart', '2026-09-01'); await pres.fill('#oEnd', '2026-12-20');
  await pres.fill('#oTheme', 'Rooted');
  await pres.fill('#oGoals [data-k="v"]', 'Grow Sunday attendance');
  await pres.click('[data-add-for="oProgrammes"]');
  const row = pres.locator('#oProgrammes [data-row]').first();
  await row.locator('[data-k="date"]').fill('2026-10-10');
  await row.locator('[data-k="title"]').fill('Choir concert');
  await row.locator('[data-k="departmentId"]').selectOption(dept.Choir);
  await row.locator('[data-k="estimatedCost"]').fill('1500');
  check(/GH₵\s?1,500\.00/.test(await pres.textContent('#oTotal')), 'the total cost of the programmes adds up as they are typed');
  check((await pres.textContent('#oChecklist')).includes('Ready'), 'and the checklist turns to ready');
  check((await unlabelled(pres)).length === 0, 'every field on the form has a label', await unlabelled(pres));
  const smallPres = await small(pres);
  check(smallPres.length === 0, 'every button and field on the form is at least 44px to press', smallPres);
  await pres.click('#saveOutline');
  await pres.waitForFunction(() => /Saved/.test(document.getElementById('outlineMsg').textContent));
  await pres.screenshot({ path: path.join(SHOTS, 'outline-form.png'), fullPage: true });
  await pres.click('#sendOutline');
  await pres.waitForSelector('#withdrawOutline');
  check(/Waiting for the Chapter Coordinator/.test(await panel(pres).textContent()), 'sent: it now says it is with the Chapter Coordinator');
  check(await pres.locator('.of-steps li.now').textContent().then(t => /Chapter Coordinator approves/.test(t)), 'and the steps show where it stands');

  // ----------------------------------------------------------- the Coordinator --
  console.log('\n== the Chapter Coordinator approves it ==');
  const coord = await open('coord', 'coordinator');
  await coord.waitForSelector('[data-today-open="outlines"] .today-count:not(:empty)');
  check(/^1\s*Semester outlines\s*waiting for you$/.test((await coord.textContent('[data-today-open="outlines"]')).replace(/\s+/g, ' ').trim()), 'Today says one outline is waiting for them', await coord.textContent('[data-today-open="outlines"]'));
  await nav(coord, 'Dashboard');
  await coord.waitForSelector('.of-waiting');
  check(/1 semester outline is waiting/.test(await coord.textContent('.of-waiting')), 'the dashboard says an outline is waiting');
  await coord.screenshot({ path: path.join(SHOTS, 'coordinator-waiting.png') });
  await coord.click('[data-go="outlines"]');
  await coord.waitForSelector('[data-approve]');
  check(/Choir concert/.test(await panel(coord).textContent()), 'the Coordinator reads the whole outline');
  await coord.click('[data-return]');
  await coord.fill('#rNote', 'Please add the mentoring launch.');
  await coord.click('#returnForm button[type=submit]');
  await coord.waitForFunction(() => !document.querySelector('[data-approve]'));
  await pres.click('#portalNav button:text-is("Semester Outline")');
  await pres.waitForSelector('#outlineForm', { timeout: 5000 }).catch(async () => { console.log('DEBUG panel:', (await pres.locator('.portal-panel.active').textContent()).slice(0, 400)); throw new Error('no form'); });
  check(/mentoring launch/.test(await pres.textContent('.portal-panel.active .of-notice.warn')), 'sent back with the reason, which the President sees at the top of the form');
  await pres.click('#sendOutline');
  await pres.waitForSelector('#withdrawOutline');
  await coord.click('#portalNav button:text-is("Semester Outlines")');
  await coord.waitForSelector('[data-approve]');
  await coord.click('[data-approve]');
  await coord.waitForFunction(() => /Nothing is waiting/.test(document.querySelector('.portal-panel.active').textContent));
  check(true, 'approved');
  const choir = await open('choir', 'executive');
  const navChoir = await labels(choir);
  check(navChoir.includes('Semester Outline') && navChoir.includes('Budget Requests') && navChoir.includes('Minutes') && navChoir.includes('My Announcement'), 'a department head\'s menu: ' + navChoir.join(' | '));
  await nav(choir, 'Semester Outline');
  await choir.waitForSelector('.of-doc');
  check(/Choir concert/.test(await panel(choir).textContent()) && /Rooted/.test(await panel(choir).textContent()), 'every executive now reads the approved outline');
  check(await noSideways(choir), 'with no sideways scroll');

  // ---------------------------------------------------------------- budgets --
  console.log('\n== budgets: Finance asks, the head answers, Finance reviews, the Vice President decides ==');
  const fs_ = await open('fs', 'executive');
  await nav(fs_, 'Budget Requests');
  await fs_.click('#newCallBtn');
  await fs_.waitForSelector('#callForm');
  await fs_.check('#cAll');
  await fs_.fill('#cDue', '2026-12-30');
  await fs_.click('#callForm button[type=submit]');
  await fs_.waitForSelector('[data-open]');
  check(/0 of 3 departments have started/.test(await panel(fs_).textContent()), 'Finance asks all three departments');
  await nav(choir, 'Budget Requests');
  await choir.waitForSelector('.portal-panel.active [data-call] form');
  await choir.fill('.portal-panel.active .of-rows [data-k="item"]', 'Keyboard stands');
  await choir.fill('.portal-panel.active .of-rows [data-k="quantity"]', '3');
  await choir.fill('.portal-panel.active .of-rows [data-k="unitCost"]', '150.50');
  check(/GH₵\s?451\.50/.test(await choir.locator('.portal-panel.active [data-total]').textContent()), 'the head types a line and the amount works itself out');
  await choir.fill('.portal-panel.active [data-call] textarea', 'The choir has grown.');
  const smallBudget = await small(choir);
  check(smallBudget.length === 0, 'the budget form has no small targets', smallBudget);
  check((await unlabelled(choir)).length === 0, 'and no unlabelled fields', await unlabelled(choir));
  await choir.screenshot({ path: path.join(SHOTS, 'budget-form.png'), fullPage: true });
  await choir.click('.portal-panel.active [data-call] button[type=submit]');
  await choir.waitForFunction(() => /Waiting for Finance/.test(document.querySelector('.portal-panel.active').textContent));
  check(true, 'sent to Finance');
  await fs_.click('[data-open]');
  await fs_.waitForSelector('[data-view]');
  await fs_.click('[data-view]');
  await fs_.waitForSelector('#subForm');
  await fs_.click('[data-act="recommend"]');
  await fs_.waitForFunction(() => !document.getElementById('modalBackdrop').classList.contains('open'));
  const vp = await open('vp', 'executive');
  const navVp = await labels(vp);
  check(navVp.includes('Budget Decisions') && navVp.includes('Keep the Ledger') && navVp.includes('Committees') && navVp.includes('Follow-up'), 'the Vice President\'s menu: ' + navVp.join(' | '));
  await nav(vp, 'Budget Decisions');
  await vp.click('[data-open]');
  await vp.waitForSelector('[data-view]');
  check(/Decide/.test(await vp.textContent('[data-view]')), 'the Vice President sees a budget waiting for a decision');
  await vp.click('[data-view]');
  await vp.waitForSelector('#subForm');
  check(await vp.locator('[data-act="approve"]').count() === 1 && await vp.locator('[data-act="recommend"]').count() === 0, 'with approve, decline and send back, but not Finance\'s recommend');
  await vp.click('[data-act="approve"]');
  await vp.waitForFunction(() => !document.getElementById('modalBackdrop').classList.contains('open'));
  await vp.waitForSelector('[data-view]');
  check(/GH₵\s?451\.50/.test(await panel(vp).textContent()), 'approved at the amount asked');
  await fs_.click('#portalNav button:text-is("Budget Requests")');
  await fs_.click('[data-open]');
  await fs_.waitForSelector('#postBudget:not([disabled])');
  await fs_.click('#postBudget');
  await fs_.waitForFunction(() => /Added 1/.test(document.getElementById('toast') ? document.getElementById('toast').textContent : document.body.textContent));
  check(true, 'Finance adds the approved amount to the chapter budget');

  // ---------------------------------------------------------------- minutes --
  console.log('\n== minutes: written by one secretary, agreed by both ==');
  const gs = await open('gs', 'executive');
  const navGs = await labels(gs);
  check(navGs.includes('Minutes') && navGs.includes('Sunday Announcements') && navGs.includes('My Announcement') && navGs.includes('Follow-up'), 'the General Secretary\'s menu: ' + navGs.join(' | '));
  await nav(gs, 'Minutes');
  await gs.click('#newMinutes');
  await gs.waitForSelector('#minutesForm');
  check(await gs.locator('.of-section').count() === 6, 'the minutes form follows the order of a meeting in six sections');
  await gs.fill('#mTitle', 'October executive meeting');
  await gs.fill('#mStart', '16:30');
  await gs.check('#mAll');
  await gs.click('#usualOrder');
  check(await gs.locator('#mItems [data-row]').count() === 7, 'one click fills in the usual order of business');
  await gs.locator('#mItems [data-row]').nth(4).locator('[data-k="decision"]').fill('Retreat approved for November.');
  await gs.locator('#mActions [data-k="task"]').first().fill('Book the hall');
  await gs.locator('#mActions [data-k="owner"]').first().fill('Organising Secretary');
  const smallMin = await small(gs);
  check(smallMin.length === 0, 'the minutes form has no small targets', smallMin);
  check((await unlabelled(gs)).length === 0, 'and no unlabelled fields', await unlabelled(gs));
  await gs.screenshot({ path: path.join(SHOTS, 'minutes-form.png'), fullPage: true });
  await gs.click('#saveAndSend');
  await gs.waitForSelector('#backToList');
  check(/With the other secretary/.test(await panel(gs).textContent()), 'saved and sent to the other secretary');
  const ags = await open('ags', 'executive');
  await nav(ags, 'Minutes');
  await ags.waitForSelector('.portal-panel.active .of-notice.warn');
  check(/waiting for you/.test(await panel(ags).textContent()), 'the Assistant is told minutes are waiting for her');
  await ags.click('[data-open]');
  await ags.waitForSelector('#agree');
  await ags.fill('#mComment', 'Please add who proposed the retreat.');
  await ags.click('#commentForm button');
  await ags.waitForSelector('.of-comment');
  await ags.click('#agree');
  await ags.waitForFunction(() => /Agreed/.test(document.querySelector('.portal-panel.active').textContent) || document.querySelector('#agree') === null);
  await gs.click('#portalNav button:text-is("Minutes")');
  await gs.click('[data-open]');
  await gs.waitForSelector('#agree');
  check(/Please add who proposed/.test(await panel(gs).textContent()), 'the General Secretary reads her comment');
  await gs.click('#agree');
  await gs.waitForFunction(() => /Shared/.test(document.querySelector('.portal-panel.active').textContent));
  check(true, 'both agree, and the minutes are shared');
  await nav(vp, 'Minutes');
  await vp.waitForSelector('.of-doc');
  check(/Retreat approved for November/.test(await panel(vp).textContent()) && !/Please add who proposed/.test(await panel(vp).textContent()), 'the Vice President reads the minutes, without the secretaries\' comments');
  await nav(vp, 'Follow-up');
  await vp.waitForSelector('[data-done]');
  check(/Book the hall/.test(await panel(vp).textContent()), 'and the job given out is in the follow-up list');
  check(await noSideways(vp), 'with no sideways scroll');

  // ---------------------------------------------------------- announcements --
  console.log('\n== Sunday announcements ==');
  await nav(gs, 'Sunday Announcements');
  await gs.click('#askBtn');
  await gs.click('#askForm button[type=submit]');
  await gs.waitForSelector('[data-open]');
  await nav(choir, 'My Announcement');
  await choir.waitForSelector('.portal-panel.active form[data-call]');
  await choir.fill('.portal-panel.active form[data-call] textarea', 'Choir rehearsal moves to Friday 6pm.');
  await choir.click('.portal-panel.active form[data-call] button[type=submit]');
  await choir.waitForFunction(() => /You have answered/.test(document.querySelector('.portal-panel.active').textContent));
  await gs.click('#portalNav button:text-is("Sunday Announcements")');
  await gs.click('[data-open]');
  await gs.waitForSelector('#compileAll');
  await gs.click('#compileAll');
  await gs.waitForFunction(() => /Choir rehearsal moves/.test(document.getElementById('finalText').value));
  check(/Announcements for Sunday/.test(await gs.inputValue('#finalText')), 'the secretary puts the Sunday text together from what came in');
  const smallAnn = await small(gs);
  check(smallAnn.length === 0, 'with no small targets', smallAnn);

  // ----------------------------------------------------------- hand-over --
  console.log('\n== handing an office over ==');
  await coord.click('#portalNav button:text-is("Key Offices")');
  await coord.waitForSelector('[data-handover]');
  check(/Vice President/.test(await panel(coord).textContent()) && /Alumni President/.test(await panel(coord).textContent()), 'the Coordinator sees the key offices, including the Alumni President');
  check(/Nobody/.test(await panel(coord).textContent()), 'and which are empty');
  await coord.screenshot({ path: path.join(SHOTS, 'key-offices.png'), fullPage: true });
  await coord.locator('[data-handover^="president|"]').click();
  await coord.waitForSelector('#hoForm');
  await coord.fill('#hoFind', 'Kwesi');
  await coord.selectOption('#hoMember', successor);
  check(await coord.locator('#hoForm input[type=password]').count() === 0, 'the Coordinator does not make up a username or password: the office has its own');
  await coord.click('#hoForm button[type=submit]');
  await coord.waitForSelector('#hoDone');
  const issuedText = await coord.textContent('#modalContent');
  check(/president\.knust/.test(issuedText) && /president123/.test(issuedText), 'the office login (president.knust, president123) is shown once, to pass on');
  await coord.click('#hoDone');
  const stopped = await pres.evaluate(async () => (await fetch('/api/executive/outline')).status);
  check(stopped === 401, 'the old President\'s login stops at once', stopped);

  // ---------------------------------------------------------- phone, dark --
  console.log('\n== on a phone, and in the dark ==');
  const phone = await open('gs', 'executive', { width: 320, height: 700 });
  await nav(phone, 'Minutes');
  await phone.click('#newMinutes');
  await phone.waitForSelector('#minutesForm');
  check(await noSideways(phone), 'the minutes form fits a 320px phone without sideways scroll');
  await phone.screenshot({ path: path.join(SHOTS, 'minutes-form-320.png'), fullPage: true });
  const darkCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  const dark = await darkCtx.newPage();
  dark.on('pageerror', e => errors.push('dark: ' + e.message));
  await dark.goto(`${BASE}/executive.html`, { waitUntil: 'networkidle' });
  await dark.fill('#portalUsername', 'vp'); await dark.fill('#portalPassword', 'password1234'); await dark.click('#portalLoginBtn');
  await dark.waitForSelector('#portalNav button');
  await dark.click('#portalNav button:text-is("Semester Outline")');
  await dark.waitForSelector('.of-doc');
  await dark.screenshot({ path: path.join(SHOTS, 'outline-dark.png'), fullPage: true });
  const contrast = await dark.evaluate(() => {
    const lum = (c) => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const bg = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; } return 'rgb(255,255,255)'; };
    const bad = [];
    document.querySelectorAll('.portal-panel.active p, .portal-panel.active h3, .portal-panel.active h4, .portal-panel.active td, .portal-panel.active th, .portal-panel.active li').forEach(el => {
      if (!el.offsetParent || !el.textContent.trim()) return;
      const a = lum(getComputedStyle(el).color), b = lum(bg(el));
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (ratio < 4.5) bad.push([el.tagName, el.textContent.trim().slice(0, 30), Math.round(ratio * 10) / 10]);
    });
    return bad;
  });
  check(contrast.length === 0, 'text on the outline reads at 4.5:1 or better in dark mode', contrast.slice(0, 5));

  check(errors.length === 0, 'no script errors in any page', errors);
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall office screen checks passed');
  console.log('screenshots: ' + SHOTS);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
