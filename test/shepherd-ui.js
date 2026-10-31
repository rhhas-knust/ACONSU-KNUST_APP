// Shepherding on a phone, in a real browser: bringing the chapter's list in
// from a CSV file, and Sunday check-in at the door with two phones at once.
//
//   node test/shepherd-ui.js
//
// Needs Playwright and a Chromium (see test/ux.js). Not part of `npm test`.
// Screenshots go to SHEPHERD_SHOTS (or a temporary folder, printed at the end).
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
const SHOTS = process.env.SHEPHERD_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'shepherd-shots-'));
let failures = 0;
const check = (label, ok, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || detail === undefined ? '' : ' - ' + JSON.stringify(detail).slice(0, 300))); if (!ok) failures++; };

const LIST = [
  'Full Name,Phone Number,Level,Hall/Hostel,Gender,Programme',
  'KOFI MENSAH,244000001,Level 200,Unity Hall,Male,BSC Biomedical Engineering and Applied Sciences',
  'Ama Owusu,0201112222,300,Hall 7,Female,',
  'Yaw Boateng,0277777777,100,Africa Hall,Male,',
  ',0200000000,,,,',
  'Akua Sarpong,0209999999,,,,'
].join('\n');

(async () => {
  const { fakeModels } = require(path.join(ROOT, 'test', 'harness.js'));
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/shepherd-ui', PORT: '4474', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 't', LOGIN_RATE_LIMIT_MAX: '900' });
  delete process.env.SHEPHERD_USERNAME;
  require(path.join(ROOT, 'server.js'));
  await new Promise(r => setTimeout(r, 1500));
  const BASE = 'http://127.0.0.1:4474';
  let jar = '';
  const api = async (m, p, b) => { const h = {}; if (jar) h.cookie = jar; if (b) h['content-type'] = 'application/json'; const r = await fetch(BASE + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) jar = sc.map(c => c.split(';')[0]).join('; '); return r.json().catch(() => ({})); };
  await api('POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  const C = 'aconsu-knust';
  await api('POST', '/api/national/chapters', { id: C, name: 'ACONSU KNUST', institution: 'KNUST' });
  let n = 0;
  const member = async (name, phone) => {
    n += 1;
    const fd = new FormData();
    fd.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
    Object.entries({ name, email: `shui${n}@example.com`, password: 'secret123', chapterId: C, consent: 'true', phone: phone || '' }).forEach(([k, v]) => fd.append(k, v));
    return (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd })).json()).member.id;
  };
  await member('Akua Sarpong', '0209999999');
  await api('POST', '/api/admin/staff', { username: 'shep', name: 'Shepherding Head', role: 'shepherding', password: 'Start-Pass-1', memberId: await member('Shepherding Head'), chapterId: C });
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; });

  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  async function signIn(opts, hash) {
    const ctx = await browser.newContext(opts);
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    // 409 is the stale register, refused on purpose below; the browser logs every refusal.
    p.on('console', m => { if (m.type() === 'error' && !/favicon|401|409/.test(m.text())) errors.push(m.text()); });
    await p.goto(`${BASE}/shepherding.html${hash || ''}`, { waitUntil: 'networkidle' });
    await p.fill('#portalUsername', 'shep');
    await p.fill('#portalPassword', 'Start-Pass-1');
    await p.click('#portalLoginBtn');
    await p.waitForSelector('#portalShell', { state: 'visible' });
    await p.waitForTimeout(400);
    return p;
  }
  // Against the phone's own width: a page too wide for a phone makes the phone
  // zoom out, and then the page's idea of the window grows with it.
  const noSideways = (p) => p.evaluate((w) => document.documentElement.scrollWidth <= w + 1, p.viewportSize().width);

  // ------------------------------------------------------------ the list --
  console.log('\n== bringing the list in ==');
  const a = await signIn(phone);
  await a.click('#portalMenuToggle');
  await a.click('#portalNav button[data-panel="members"]');
  await a.waitForSelector('#importListBtn');
  await a.click('#importListBtn');
  check('the import starts by saying how to save the list as CSV', /CSV UTF-8/.test(await a.textContent('#modalContent')));
  await a.setInputFiles('#impFile', { name: 'members.csv', mimeType: 'text/csv', buffer: Buffer.from(LIST) });
  await a.waitForSelector('.imp-cols');
  const guessed = await a.$$eval('.imp-cols select', s => s.map(x => x.value));
  check('each column is matched to what it holds', JSON.stringify(guessed) === JSON.stringify(['name', 'phone', 'level', 'address', 'note', 'programme']), guessed);
  check('with examples from the file beside it', /KOFI MENSAH/.test(await a.textContent('.imp-cols')));
  await a.screenshot({ path: path.join(SHOTS, 'import-columns.png'), fullPage: true });
  await a.click('#impCheck');
  await a.waitForSelector('.imp-summary');
  const summary = await a.textContent('.imp-summary');
  check('checking says who will be added, and who will not', /3 people will be added/.test(summary) && /1 person has an app account/.test(summary) && /1 row is left out/.test(summary), summary);
  check('and why a row is left out', /Row 5: No name in this row/.test(await a.textContent('#modalContent')));
  await a.screenshot({ path: path.join(SHOTS, 'import-check.png'), fullPage: true });
  await a.click('#impGo');
  await a.waitForFunction(() => !document.getElementById('modalBackdrop').classList.contains('open'));
  await a.waitForSelector('text=Kofi Mensah');
  const table = await a.textContent('#panel-members');
  check('they are on the Members list, tidied, and marked as from the chapter list', /Kofi Mensah/.test(table) && /On the chapter list/.test(table) && !/KOFI/.test(table), table.slice(0, 300));
  check('no sideways scrolling on the Members list', await noSideways(a));

  console.log('\n== changing what the list says about someone ==');
  const amaRow = () => a.locator('#panel-members tr', { hasText: 'Ama Owusu' });
  check('someone from the list has a Details button, as someone with an app account does', await amaRow().locator('button', { hasText: 'Details' }).count() === 1);
  await amaRow().locator('button', { hasText: 'Details' }).click();
  await a.waitForSelector('#listDetailsForm');
  check('it opens with what the list says, ready to correct', await a.inputValue('#cName') === 'Ama Owusu' && await a.inputValue('#cPhone') === '0201112222' && await a.inputValue('#cLevel') === '300');
  await a.fill('#cPhone', '0201113333');
  await a.fill('#cLevel', '400');
  await a.click('#listDetailsForm button[type="submit"]');
  await a.waitForFunction(() => !document.getElementById('modalBackdrop').classList.contains('open'));
  await a.waitForSelector('#panel-members >> text=0201113333');
  const amaRec = () => fakeModels.ShepherdingRecord._docs.find(d => d.name === 'Ama Owusu');
  check('saving changes the phone and level, and the list shows the new number', amaRec().phone === '0201113333' && amaRec().level === '400', amaRec());
  await amaRow().locator('button', { hasText: 'Care Notes' }).click();
  await a.waitForSelector('#careForm');
  check('Care Notes asks only how they are doing, and says where the details are', !(await a.$('#careForm #cName')) && /under .Details./.test(await a.textContent('#careForm')));
  await a.fill('#cNotes', 'Wants to join the choir.');
  await a.click('#careForm button[type="submit"]');
  await a.waitForFunction(() => !document.getElementById('modalBackdrop').classList.contains('open'));
  await a.waitForTimeout(300);
  check('and saving it keeps the details just changed', amaRec().phone === '0201113333' && amaRec().level === '400' && amaRec().pastoralNotes === 'Wants to join the choir.', amaRec());

  console.log('\n== the menu on a phone ==');
  check('the header names the chapter once ("ACONSU KNUST", not "ACONSU: ACONSU KNUST")', await a.textContent('#portalBrandName') === 'ACONSU KNUST', await a.textContent('#portalBrandName'));
  const logout = await a.$eval('#portalLogoutBtn', el => el.getBoundingClientRect().height);
  check('and Log Out fits on one line', logout <= 48, logout);
  await a.evaluate(() => window.scrollTo(0, 600));
  await a.click('#portalMenuToggle');
  await a.waitForTimeout(150);
  const placed = await a.evaluate(() => {
    const bar = document.querySelector('.portal-topbar').getBoundingClientRect();
    const first = document.querySelector('#portalNav button').getBoundingClientRect();
    return { first: Math.round(first.top), bar: Math.round(bar.bottom), y: Math.round(window.scrollY) };
  });
  check('opened after scrolling down, its first item is just under the header, not hidden behind it', placed.y > 0 && placed.first >= placed.bar - 1 && placed.first < placed.bar + 60, placed);
  check('and a screen reader is told it is open', await a.getAttribute('#portalMenuToggle', 'aria-expanded') === 'true');
  await a.keyboard.press('Escape');
  check('Escape closes it, back on the menu button', !(await a.isVisible('#portalNav')) && await a.evaluate(() => document.activeElement.id === 'portalMenuToggle'));
  await a.click('#portalMenuToggle');
  await a.evaluate(() => document.getElementById('portalMain').click());
  check('and so does a tap on the page beside it', !(await a.isVisible('#portalNav')) && await a.getAttribute('#portalMenuToggle', 'aria-expanded') === 'false');
  await a.click('#portalMenuToggle');
  await a.click('#portalNav button[data-panel="today"]');
  const todayPad = await a.$eval('section.today', el => getComputedStyle(el).paddingTop);
  check('Today starts at the top of the page, without the public pages\' 72px of section padding', todayPad === '0px', todayPad);

  // ------------------------------------------------------------ the door --
  console.log('\n== Sunday check-in ==');
  const b = await signIn(phone, '#checkin');
  check('shepherding.html#checkin opens straight on the check-in', await b.isVisible('#ciSearch'));
  check('with the search box ready to type in', await b.evaluate(() => document.activeElement && document.activeElement.id === 'ciSearch'));
  await b.type('#ciSearch', 'kof');
  await b.waitForSelector('.ci-person');
  check('typing the start of a name finds them', (await b.textContent('#ciResults')).includes('Kofi Mensah'));
  check('each name shows only their phone, not every detail on the list', !/Biomedical|Level/.test(await b.textContent('#ciResults')) && /0244000001/.test(await b.textContent('#ciResults')));
  check('and a long line on the list never pushes the page wider than the phone', await noSideways(b));
  const tap = await b.$eval('.ci-person', el => { const r = el.getBoundingClientRect(); return [r.width, r.height]; });
  check('a name is a big thing to tap', tap[0] >= 300 && tap[1] >= 56, tap);
  await b.tap('.ci-person');
  await b.waitForFunction(() => document.getElementById('ciCount').textContent === '1');
  check('one tap checks them in, and the count goes up', true);
  check('the box is cleared and ready for the next person', await b.evaluate(() => document.getElementById('ciSearch').value === '' && document.activeElement.id === 'ciSearch'));
  await b.waitForFunction(() => /checked in/.test(document.getElementById('ciMsg').textContent));
  await b.type('#ciSearch', 'ama ow');
  await b.keyboard.press('Enter');
  await b.waitForFunction(() => document.getElementById('ciCount').textContent === '2');
  check('Enter checks in the only match', /Ama Owusu/.test(await b.textContent('#ciList')));
  await b.type('#ciSearch', '0277');
  await b.waitForSelector('.ci-person');
  check('a few digits of a phone number find them too', (await b.textContent('#ciResults')).includes('Yaw Boateng'));
  await b.fill('#ciSearch', '');
  await b.type('#ciSearch', 'kofi');
  await b.waitForSelector('.ci-person.is-in');
  check('someone already in shows as in, and is not checked in twice', /Checked in/.test(await b.textContent('#ciResults')));
  await b.fill('#ciSearch', '');
  await b.click('[data-undo^="r:"] >> nth=0');
  await b.waitForFunction(() => document.getElementById('ciCount').textContent === '1');
  check('Undo takes a check-in back', true);
  await b.type('#ciSearch', 'Efua Nyarko');
  await b.waitForSelector('#ciNewBtn');
  await b.click('#ciNewBtn');
  check('someone not on the list can be added there and then, with the name already typed', await b.inputValue('#ciNewName') === 'Efua Nyarko');
  await b.fill('#ciNewPhone', '024 555 0000');
  await b.screenshot({ path: path.join(SHOTS, 'checkin-newcomer.png'), fullPage: true });
  await b.click('#ciNewForm [type="submit"]');
  await b.waitForFunction(() => document.getElementById('ciCount').textContent === '2');
  check('added and checked in, with a reminder to welcome them', /Welcome them/.test(await b.textContent('#ciMsg')));
  check('no sideways scrolling at the door', await noSideways(b));
  const small = await b.$$eval('#panel-checkin button, #panel-checkin input, #panel-checkin select', els => els.filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return { id: e.id || e.className, h: Math.round(r.height) }; }).filter(x => x.h < 40));
  check('everything to press at the door is at least 40px tall', small.length === 0, small);
  await b.screenshot({ path: path.join(SHOTS, 'checkin-phone.png'), fullPage: true });

  console.log('\n== two phones at the door ==');
  // The first phone, which did the import, opens the check-in too.
  await a.click('#portalMenuToggle');
  await a.click('#portalNav button[data-panel="checkin"]');
  await a.waitForSelector('#ciCount');
  check('a second phone shows the same count', await a.textContent('#ciCount') === '2', await a.textContent('#ciCount'));
  await a.type('#ciSearch', 'yaw');
  await a.waitForSelector('.ci-person');
  await a.tap('.ci-person');
  await a.waitForFunction(() => document.getElementById('ciCount').textContent === '3');
  await b.waitForFunction(() => document.getElementById('ciCount').textContent === '3', null, { timeout: 20000 });
  check('and each sees what the other did, within seconds', /Yaw Boateng/.test(await b.textContent('#ciList')));
  await b.waitForFunction(() => /Efua Nyarko/.test(document.getElementById('ciList').textContent));
  await a.waitForFunction(() => /Efua Nyarko/.test(document.getElementById('ciList').textContent), null, { timeout: 20000 });
  await a.fill('#ciSearch', '');
  await a.type('#ciSearch', 'efua');
  await a.waitForSelector('.ci-person');
  check('someone added on the other phone can be found on this one', /Efua Nyarko/.test(await a.textContent('#ciResults')));
  await a.fill('#ciSearch', '');

  console.log('\n== the register afterwards ==');
  await a.click('#portalMenuToggle');
  await a.click('#portalNav button[data-panel="attendance"]');
  await a.waitForSelector('#saveRegisterBtn');
  check('the register points to the check-in for Sundays', /Sunday Check-In/.test(await a.textContent('#panel-attendance')));
  // The register opens on last Sunday and the check-in on today; they are the
  // same day only on a Sunday. Open the register on the check-in's own day, as
  // somebody at the door would, so this does not depend on the day it is run.
  const ciDay = await b.inputValue('#ciDate');
  await a.fill('#regDate', ciDay);
  await a.click('#loadRegisterBtn');
  await a.waitForFunction((d) => document.getElementById('regDate') && document.getElementById('regDate').value === d && document.getElementById('saveRegisterBtn'), ciDay);
  // Someone checked in at the door while the register is open here.
  await b.type('#ciSearch', 'akua');
  await b.waitForSelector('.ci-person');
  await b.tap('.ci-person');
  await b.waitForFunction(() => document.getElementById('ciCount').textContent === '4');
  await a.click('#saveRegisterBtn');
  await a.waitForFunction(() => /checked in since/.test(document.getElementById('registerMsg').textContent));
  check('saving the register opened before that is refused, so nobody is marked absent by mistake', true);
  await a.click('#registerMsg .link-btn');
  await a.waitForSelector('#saveRegisterBtn');
  await a.click('#saveRegisterBtn');
  await a.waitForFunction(() => /saved/i.test(document.body.textContent));
  const reg = fakeModels.AttendanceRecord._docs.find(r => r.chapterId === C);
  check('opened again it saves, with all four still present', reg && reg.marks.filter(m => m.status === 'present').length === 4, reg && reg.marks);

  console.log('\n== night mode ==');
  const dark = await signIn({ ...phone, colorScheme: 'dark' }, '#checkin');
  await dark.type('#ciSearch', 'k');
  await dark.waitForSelector('.ci-person');
  const contrast = await dark.$eval('.ci-person:not(.is-in) .ci-action, .ci-person .ci-action', el => {
    const rgb = (s) => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    const lum = (c) => { const [r, g, bl] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
    const s = getComputedStyle(el);
    const L1 = lum(rgb(s.color)); let bg = s.backgroundColor; let node = el;
    while (/rgba\(0, 0, 0, 0\)|transparent/.test(bg) && node.parentElement) { node = node.parentElement; bg = getComputedStyle(node).backgroundColor; }
    const L2 = lum(rgb(bg));
    return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
  });
  check(`the Check in label can be read in night mode (contrast ${contrast.toFixed(1)} to 1)`, contrast >= 4.5, contrast);
  await dark.screenshot({ path: path.join(SHOTS, 'checkin-dark.png'), fullPage: true });

  const narrow = await signIn({ ...phone, viewport: { width: 320, height: 640 } }, '#checkin');
  await narrow.type('#ciSearch', 'kofi');
  await narrow.waitForSelector('.ci-person');
  check('no sideways scrolling on the smallest phones, with a name showing', await noSideways(narrow));
  const side = await narrow.$$eval('.ci-when .field', els => els.map(e => Math.round(e.getBoundingClientRect().top)));
  check('the date and the service sit side by side', side.length === 2 && side[0] === side[1], side);
  await narrow.screenshot({ path: path.join(SHOTS, 'checkin-320.png'), fullPage: true });

  const desk = await signIn({ viewport: { width: 1280, height: 900 } }, '#checkin');
  await desk.type('#ciSearch', 'a');
  await desk.waitForSelector('.ci-person');
  check('on a laptop too, without sideways scrolling', await noSideways(desk));
  await desk.screenshot({ path: path.join(SHOTS, 'checkin-desktop.png'), fullPage: true });
  await desk.click('#portalNav button[data-panel="members"]');
  await desk.waitForSelector('#importListBtn');
  await desk.click('#importListBtn');
  await desk.setInputFiles('#impFile', { name: 'members.csv', mimeType: 'text/csv', buffer: Buffer.from(LIST) });
  await desk.waitForSelector('.imp-cols');
  await desk.screenshot({ path: path.join(SHOTS, 'import-columns-desktop.png') });

  check('no script errors', errors.length === 0, errors);
  await browser.close();
  console.log(`\nScreenshots: ${SHOTS}`);
  console.log(failures ? `\n${failures} FAILURES` : '\nall shepherding browser checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
