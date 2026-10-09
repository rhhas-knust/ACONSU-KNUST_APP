// UX checks in a real browser, and the screenshots for docs/design-system.
//
//   node test/ux.js
//
// Needs Playwright and a Chromium (PLAYWRIGHT_CHROMIUM=/path/to/chrome if it is not in the
// usual place). It is not part of `npm test`, which has to run anywhere with no browser.
//
// Website: serves a copy of site/ with a sample feed, with the app's one endpoint stubbed.
// App: boots the real server on the in-memory harness for the alumni request and approval.
//
// What it checks: keyboard order and the skip link, a visible focus ring on everything,
// target size, no sideways scroll down to 320px, the form's error and success paths by
// keyboard, that focus moves to the field an error is about, reduced motion, dark mode.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

let chromium;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { ({ chromium } = require(p)); break; } catch (e) { /* try the next */ } }
if (!chromium) { console.error('Playwright is not installed.'); process.exit(2); }
const CHROME = process.env.PLAYWRIGHT_CHROMIUM
  || (fs.readdirSync('/opt/pw-browsers').filter(d => /^chromium-\d+$/.test(d)).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`)[0]);

const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, 'docs', 'design-system', 'screens');
fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0;

// The screenshots are committed, so no real person's photograph is used as a stand-in for
// somebody else. Sample people have no picture (the page shows their initials), and the
// photo uploaded in the forms is a plain generated tile.
let placeholder;
async function placeholderPhoto() {
  if (placeholder) return placeholder;
  const sharp = require('sharp');
  placeholder = path.join(os.tmpdir(), 'ux-placeholder-photo.jpg');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#E4D8EE"/><circle cx="300" cy="240" r="100" fill="#8F6FAE"/><rect x="130" y="380" width="340" height="220" rx="110" fill="#8F6FAE"/></svg>';
  fs.writeFileSync(placeholder, await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer());
  return placeholder;
}
const check = (ok, label, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || detail === undefined ? '' : ' - ' + JSON.stringify(detail))); if (!ok) failures++; };

// ---------- the website ----------
function siteCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-ux-'));
  fs.cpSync(path.join(ROOT, 'site'), dir, { recursive: true });
  const people = [
    ['Efua Mensah', 'Pharmacist at Korle Bu', 'Read Pharmacy at KNUST and never missed a Sunday service. ACONSU taught me to serve quietly.', '', '2019'],
    ['Kojo Asante-Boateng', 'Site engineer, Ashanti Region', 'Civil engineer building roads, and still the first to arrive for set-up on Sundays.', '', '2021'],
    ['Yaw Boadu', 'Mathematics teacher', 'Teaches senior high school maths and leads a Bible study for his colleagues.', '', '2020']
  ].map(([name, currentWork, about, photo, classOf]) => ({ name, currentWork, about, photo, classOf }));
  fs.writeFileSync(path.join(dir, 'data', 'feed.json'), JSON.stringify({
    version: 1,
    theme: { month: '2026-10', title: 'Walking in Newness', scripture: 'Romans 6:4', blurb: 'A month of renewal of mind, habit and fellowship.', flyers: ['images/prayer.jpg', 'images/worship.jpg'] },
    spotlight: people[0], alumni: people
  }));
  return dir;
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
function serve(dir, port) {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      let f = path.join(dir, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith('/')) f += 'index.html';
      fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); r.end(d); });
    }).listen(port, () => res(s));
  });
}

async function website(browser) {
  console.log('\n== website ==');
  const dir = siteCopy();
  const srv = await serve(dir, 4470);
  const BASE = 'http://127.0.0.1:4470/';
  const APP = 'https://aconsu-knust-app.onrender.com';
  const PHOTO = await placeholderPhoto();

  // ---- phone ----
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const pg = await phone.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
  const submitted = [];
  await pg.route(APP + '/api/public/alumni-*', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
    submitted.push({ url: route.request().url().replace(APP, ''), body: route.request().postData() || '' });
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ success: true }) });
  });
  await pg.goto(BASE, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(700);
  await pg.screenshot({ path: path.join(SHOTS, 'site-home-mobile.png') });

  // the opening needs no script and nothing is stuck invisible after scrolling the whole page
  const h = await pg.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 350) { await pg.evaluate(y => window.scrollTo(0, y), y); await pg.waitForTimeout(80); }
  await pg.waitForTimeout(1000);
  const stuck = await pg.evaluate(() => [...document.querySelectorAll('main *')].filter(e => getComputedStyle(e).opacity === '0' && e.getBoundingClientRect().height > 0).map(e => e.className || e.tagName));
  check(stuck.length === 0, 'after scrolling the whole page nothing is left invisible', stuck.slice(0, 4));

  // the wall and the spotlight
  await pg.evaluate(() => document.getElementById('alumni').scrollIntoView());
  await pg.waitForTimeout(700);
  check(await pg.$eval('#spotlight', e => !e.hidden && /Efua Mensah/.test(e.textContent)), 'the spotlight shows this week\'s alumnus');
  check(await pg.$$eval('#alumniGrid .alumnus', a => a.length === 3), 'and the wall shows everyone');
  await (await pg.$('#alumni')).screenshot({ path: path.join(SHOTS, 'site-alumni-wall.png') });

  // the home page offers a link, not a form
  check(await pg.$eval('#alumniAsk', e => !e.hidden && !!e.querySelector('a[href="alumni-request.html"]')) && !(await pg.$('#alumniForm')), 'the home page shows a link to the alumni form and no form');
  await pg.click('#alumniAsk a');
  await pg.waitForURL('**/alumni-request.html');
  await pg.waitForTimeout(400);
  check(await pg.$eval('#wallFields', e => e.hidden), 'on the form the public wall fields are out of the way until asked for');

  // ---- the form by keyboard alone ----
  await pg.focus('#alSubmit');
  await pg.keyboard.press('Enter');
  await pg.waitForTimeout(200);
  check(await pg.evaluate(() => document.activeElement.id === 'alName'), 'an empty form sends focus to the first field that needs filling');
  check(await pg.$eval('#alName', e => e.getAttribute('aria-invalid') === 'true'), 'and marks it invalid');
  check(/Enter your name/.test(await pg.textContent('#alMsg')), 'in words that say what to do');
  await pg.type('#alName', 'Efua Mensah');
  await pg.focus('#alSubmit'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(150);
  check(await pg.evaluate(() => document.activeElement.id === 'alEmail'), 'then to the way to reach them');
  await pg.type('#alEmail', 'efua@example.com');
  await pg.type('#alProfession', 'Pharmacist'); await pg.type('#alOrg', 'Korle Bu Teaching Hospital'); await pg.type('#alCity', 'Accra');
  await pg.focus('#alSubmit'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(150);
  check(await pg.evaluate(() => document.activeElement.id === 'alConsent'), 'then to the agreement box');
  await (await pg.$('#askBox')).screenshot({ path: path.join(SHOTS, 'site-alumni-form-error.png') });
  await pg.keyboard.press('Space');
  check(await pg.$eval('#alConsent', e => e.checked), 'the box can be ticked with the space bar');
  check(await pg.$eval('#alShowContact', e => e.disabled), 'showing contact details is switched off until being shown is agreed to');
  await pg.check('#alShare');
  check(await pg.$eval('#alShowContact', e => !e.disabled), 'and becomes available once it is');

  // the wall is a choice, and when chosen it asks for what it needs
  await pg.check('#alWall');
  check(await pg.$eval('#wallFields', e => !e.hidden) && await pg.$eval('#alWall', e => e.getAttribute('aria-expanded') === 'true'), 'ticking the wall box reveals the photo and words, and says so to a screen reader');
  await pg.focus('#alSubmit'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(150);
  check(await pg.evaluate(() => document.activeElement.id === 'alPhoto'), 'and then asks for the photo');
  await pg.setInputFiles('#alPhoto', PHOTO);
  await pg.type('#alAbout', 'Read Pharmacy at KNUST and never missed a Sunday service.');
  await pg.focus('#alSubmit'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(150);
  check(await pg.evaluate(() => document.activeElement.id === 'alWallConsent'), 'and for the public agreement');
  await pg.check('#alWallConsent');
  await pg.focus('#alSubmit'); await pg.keyboard.press('Enter');
  await pg.waitForSelector('#alDone:not([hidden])', { timeout: 8000 });
  check(/Efua/.test(await pg.textContent('#alDoneText')) && /Alumni wall/.test(await pg.textContent('#alDoneText')), 'a confirmation replaces the form and says what was sent');
  const urls = submitted.map(x => x.url);
  check(urls.length === 2 && urls[0] === '/api/public/alumni-details' && urls[1] === '/api/public/alumni-requests', 'details first, then the wall request', urls);
  check(/name="consent"/.test(submitted[1].body) && /name="photo"/.test(submitted[1].body) && /name="shareWithMembers"/.test(submitted[0].body), 'with the photo and agreements in the right requests');
  await (await pg.$('#askBox')).screenshot({ path: path.join(SHOTS, 'site-alumni-form-done.png') });

  // a shared link that is for the wall opens with it chosen; the plain one does not
  const wallLink = await phone.newPage(); await wallLink.goto(BASE + 'alumni-request.html?for=wall', { waitUntil: 'networkidle' });
  check(await wallLink.$eval('#alWall', e => e.checked) && await wallLink.$eval('#wallFields', e => !e.hidden), '?for=wall opens the form with the wall already chosen');
  await wallLink.close();
  check(errs.length === 0, 'no script errors on a phone', errs);

  // ---- sizes and reflow ----
  for (const w of [320, 390, 768, 1280]) {
    const c = await browser.newContext({ viewport: { width: w, height: 800 } });
    const p = await c.newPage(); await p.goto(BASE, { waitUntil: 'networkidle' });
    check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no sideways scroll at ${w}px wide`);
    if (w === 390) {
      const small = await p.evaluate(() => [...document.querySelectorAll('.btn, .top nav a, .socials a, button, input:not([type=checkbox]), select, textarea')]
        .filter(e => e.getClientRects().length && !e.closest('.trap') && getComputedStyle(e).visibility !== 'hidden')
        .map(e => { const r = e.getBoundingClientRect(); return { t: (e.textContent || e.id || e.className).trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; })
        .filter(x => x.h < 40 || x.w < 40));
      check(small.length === 0, 'every button, link and field is at least 40px each way', small.slice(0, 5));
    }
    await c.close();
  }

  // ---- keyboard: skip link, order, visible focus ----
  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const dp = await desk.newPage(); await dp.goto(BASE, { waitUntil: 'networkidle' }); await dp.waitForTimeout(500);
  await dp.keyboard.press('Tab');
  check(await dp.evaluate(() => document.activeElement.classList.contains('skip-link') && document.activeElement.getBoundingClientRect().top >= 0), 'the first Tab lands on a visible skip link');
  await dp.keyboard.press('Enter'); await dp.keyboard.press('Tab');
  check(await dp.evaluate(() => !!document.activeElement.closest('main')), 'after the skip link the next Tab is inside the content, not back in the navigation');
  const bad = []; const seen = new Set();
  for (let i = 0; i < 120; i++) {
    await dp.keyboard.press('Tab');
    const r = await dp.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const s = getComputedStyle(e); return { id: e.id || e.textContent.trim().slice(0, 20) || e.tagName, outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2, tag: e.tagName }; });
    if (!r) break; if (seen.has(r.id + r.tag)) continue; seen.add(r.id + r.tag);
    if (!r.outline) bad.push(r.id);
  }
  check(bad.length === 0, `all ${seen.size} things reachable by keyboard show a focus ring`, bad.slice(0, 5));
  await dp.screenshot({ path: path.join(SHOTS, 'site-home-desktop.png') });

  // ---- reduced motion ----
  const red = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const rp = await red.newPage(); await rp.goto(BASE, { waitUntil: 'networkidle' });
  const names = await rp.evaluate(() => ({ h1: getComputedStyle(document.querySelector('.hero h1')).animationName, reveal: [...document.querySelectorAll('.reveal')].every(e => getComputedStyle(e).transform === 'none') }));
  check(names.h1 === 'fade' && names.reveal, 'with reduced motion the opening fades and nothing slides', names);

  // ---- dark ----
  const dark = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const kp = await dark.newPage(); await kp.goto(BASE, { waitUntil: 'networkidle' }); await kp.waitForTimeout(700);
  await kp.screenshot({ path: path.join(SHOTS, 'site-dark-mobile.png') });
  const dc = await kp.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(dc !== 'rgb(255, 255, 255)', 'dark mode follows the device', dc);

  for (const c of [phone, desk, red, dark]) await c.close();
  srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------- the app ----------
async function app(browser) {
  console.log('\n== app ==');
  const H = require(path.join(ROOT, 'test', 'harness.js'));
  const bytes = new Map();
  const up = H.fakeGridfs.uploadBuffer.bind(H.fakeGridfs);
  H.fakeGridfs.uploadBuffer = async (buf, name, meta) => { const id = await up(buf, name, meta); bytes.set(id, buf); return id; };
  H.fakeGridfs.openDownloadStream = (id) => Readable.from([bytes.get(id) || Buffer.from('x')]);
  H.fakeGridfs.findFile = async (id) => (bytes.has(id) ? { _id: id, filename: id + '.jpg', metadata: { contentType: 'image/jpeg' } } : null);
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/ux', PORT: '4471', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 't', LOGIN_RATE_LIMIT_MAX: '900' });
  require(path.join(ROOT, 'server.js'));
  await new Promise(r => setTimeout(r, 1500));
  const BASE = 'http://127.0.0.1:4471';
  let jar = '';
  const api = async (m, p, b) => { const h = {}; if (jar) h.cookie = jar; if (b) h['content-type'] = 'application/json'; const r = await fetch(BASE + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) jar = sc.map(c => c.split(';')[0]).join('; '); return r.json().catch(() => ({})); };
  await api('POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  await api('POST', '/api/national/chapters', { id: 'aconsu-knust', name: 'ACONSU KNUST', institution: 'KNUST' });
  await api('POST', '/api/admin/staff', { username: 'nat', name: 'National Coord', role: 'nationalCoordinator', password: 'password123' });
  const PHOTO = await placeholderPhoto();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const p1 = await phone.newPage(); const errs = []; p1.on('pageerror', e => errs.push(e.message));
  await p1.goto(BASE + '/alumni.html', { waitUntil: 'networkidle' });
  await p1.waitForFunction(() => document.querySelectorAll('#alChapter option').length > 0);
  await p1.fill('#alName', 'Efua Mensah');
  await p1.setInputFiles('#alPhoto', PHOTO);
  await p1.fill('#alAbout', 'Read Pharmacy at KNUST and never missed a Sunday service. ACONSU taught me to serve quietly.');
  await p1.fill('#alWork', 'Pharmacist at Korle Bu'); await p1.fill('#alClass', '2019'); await p1.fill('#alContact', 'efua@example.com');
  await p1.click('#alSubmit');
  check(/agree|tick|happy/i.test(await p1.textContent('#alMsg')), 'the app form says why it did not send when the box is not ticked');
  await (await p1.$('main')).screenshot({ path: path.join(SHOTS, 'app-alumni-form-mobile.png') });
  await p1.check('#alConsent'); await p1.click('#alSubmit');
  await p1.waitForSelector('#alDone:not([hidden])', { timeout: 8000 });
  check(true, 'and sends once it is');

  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p2 = await desk.newPage(); p2.on('pageerror', e => errs.push(e.message));
  await p2.goto(BASE + '/national.html', { waitUntil: 'networkidle' });
  await p2.fill('#portalUsername', 'nat'); await p2.fill('#portalPassword', 'password123'); await p2.click('#portalLoginBtn');
  await p2.waitForSelector('#portalNav button');
  await p2.click('#portalNav button:has-text("Alumni")');
  await p2.waitForSelector('.al-request');
  check(/efua@example.com/.test(await p2.textContent('.al-request')), 'National sees the waiting request with its private contact line');
  await p2.screenshot({ path: path.join(SHOTS, 'app-approvals-queue.png') });
  await p2.click('[data-approve]');
  await p2.waitForSelector('.portal-table td:has-text("Efua Mensah")');
  check(await p2.$('.al-request') === null, 'approving moves her to the wall');
  // what came through the shared link, for building Alumni Connect
  const sent = await fetch(BASE + '/api/public/alumni-details', { method: 'POST', body: (() => { const fd = new FormData(); Object.entries({ name: 'Kojo Asante-Boateng', chapterId: 'aconsu-knust', classOf: '2021', programme: 'BSc Civil Engineering', profession: 'Site engineer', organisation: 'Ashanti Roads Ltd', industry: 'Construction', city: 'Kumasi', country: 'Ghana', openToMentoring: 'true', email: 'kojo@example.com', shareWithMembers: 'true', consent: 'true' }).forEach(([k, v]) => fd.append(k, v)); return fd; })() });
  check(sent.status === 200, 'details sent through the shared link are accepted');
  await p2.click('#portalNav button:has-text("Alumni")');
  await p2.waitForSelector('[data-detail-status]');
  check(/Kojo Asante-Boateng/.test(await p2.evaluate(() => [...document.querySelectorAll('.portal-table')].pop().textContent)), 'National sees them under the wall, ready to invite');
  check(await p2.$eval('a[href$="/details.csv"]', a => /spreadsheet/.test(a.textContent)), 'with a link to download them as a spreadsheet');
  await p2.selectOption('[data-detail-status]', 'invited');
  await p2.waitForTimeout(400);
  check(await p2.$eval('[data-detail-status]', e => e.value === 'invited'), 'and each can be marked as it is invited');
  await (await p2.$('[data-detail-status]')).scrollIntoViewIfNeeded();
  await p2.screenshot({ path: path.join(SHOTS, 'app-alumni-details.png') });
  // ---- the admin Media Library: the page the artwork is for stays chosen ----
  for (const name of ['Choir', 'Ushering', 'Media']) await api('POST', '/api/admin/departments', { name, tagline: 'x', meetingDay: 'Sundays', meetingTime: '9:00 AM', meetingLocation: 'Hall', chapterId: 'aconsu-knust' });
  const admCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });   // its own sign-in, apart from National's
  const adm = await admCtx.newPage(); adm.on('pageerror', e => errs.push(e.message));
  await adm.goto(BASE + '/admin.html', { waitUntil: 'networkidle' });
  await adm.fill('#username', 'admin'); await adm.fill('#password', 'admin123'); await adm.click('#loginForm button[type="submit"]');
  await adm.click('[data-panel="media"]');
  await adm.waitForSelector('#uploadPlacement');
  await adm.selectOption('#uploadPlacement', 'page-hero');
  await adm.selectOption('#uploadTarget', 'about');
  check(await adm.inputValue('#uploadTarget') === 'about', 'in the Media Library, the page chosen for a piece of artwork stays chosen');
  check(/About/.test(await adm.textContent('#placementExplain')), 'and the explanation names that page');
  await adm.selectOption('#uploadPlacement', 'department-header');
  const deptIds = await adm.$$eval('#uploadTarget option', o => o.map(x => x.value));
  await adm.selectOption('#uploadTarget', deptIds[2]);
  check(deptIds.length === 3 && await adm.inputValue('#uploadTarget') === deptIds[2], 'and so does the department chosen for a header');
  check(/Media/.test(await adm.textContent('#placementExplain')) && !/replaces what is there/.test(await adm.textContent('#placementExplain')), 'and the sentence says its name without the list\'s own wording');
  await adm.selectOption('#uploadPlacement', 'page-hero');
  check(await adm.inputValue('#uploadTarget') === 'home', 'changing what the image is for starts the list again from its first entry');
  await adm.selectOption('#uploadTarget', 'about');
  await adm.setInputFiles('#uploadFile', PHOTO);
  await adm.click('#uploadSubmitBtn');
  let hero = [];
  for (let i = 0; i < 25; i++) { hero = (await api('GET', '/api/admin/image-placements')).heroPages || []; if (hero.some(h => h.fileId)) break; await new Promise(r => setTimeout(r, 200)); }
  const placedOn = hero.filter(h => h.fileId).map(h => h.id);
  check(placedOn.length === 1 && placedOn[0] === 'about', 'and the artwork lands on that page and not on Home', placedOn);
  // ---- a leader chooses their chapter when signing in ----
  const lead = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pl = await lead.newPage(); pl.on('pageerror', e => errs.push(e.message));
  await pl.goto(BASE + '/finance.html', { waitUntil: 'networkidle' });
  await pl.waitForSelector('#portalLoginForm');
  await pl.waitForTimeout(400);
  check(await pl.$('#leaderChapter') === null, 'with one chapter, a leader signing in is not asked which');
  await api('POST', '/api/national/chapters', { id: 'aconsu-ucc', name: 'ACONSU UCC', institution: 'Cape Coast' });
  const fdLead = new FormData();
  fdLead.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
  Object.entries({ name: 'Finance Officer', email: 'fin.ux@example.com', password: 'secret123', chapterId: 'aconsu-knust', consent: 'true' }).forEach(([k, v]) => fdLead.append(k, v));
  const regLead = await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fdLead })).json();
  await api('POST', '/api/admin/staff', { username: 'fin.ux', name: 'Finance Officer', role: 'finance', password: 'password123', memberId: regLead.member.id, chapterId: 'aconsu-knust' });
  await pl.reload({ waitUntil: 'networkidle' });
  await pl.waitForSelector('#leaderChapter');
  const labels = await pl.$$eval('#leaderChapter option', o => o.map(x => x.textContent.trim()));
  check(labels.join(' | ') === 'Choose your chapter | ACONSU KNUST: KNUST | ACONSU UCC: Cape Coast | National office', 'with two, the list is the chapters that exist, then National office: ' + labels.join(' | '));
  check(await pl.$eval('#leaderChapter', e => e.labels[0].textContent === 'Your chapter'), 'and it has a label a screen reader reads');
  await pl.fill('#portalUsername', 'fin.ux'); await pl.fill('#portalPassword', 'password123');
  await pl.click('#portalLoginBtn');
  check(await pl.$eval('#leaderChapter', e => !e.validity.valid) && await pl.isVisible('#portalLoginWrap'), 'signing in without choosing a chapter is not allowed');
  await pl.selectOption('#leaderChapter', 'aconsu-ucc');
  await pl.click('#portalLoginBtn');
  await pl.waitForFunction(() => /not part of the chapter you chose/.test(document.getElementById('portalLoginMsg').textContent));
  check(await pl.isVisible('#portalLoginWrap') && !(await pl.isVisible('#portalShell')), 'choosing another chapter says so and stays on the sign-in');
  await pl.selectOption('#leaderChapter', 'aconsu-knust');
  await pl.click('#portalLoginBtn');
  await pl.waitForSelector('#portalShell', { state: 'visible', timeout: 8000 });
  check(true, 'choosing their own chapter signs in');
  await lead.clearCookies();
  await pl.reload({ waitUntil: 'networkidle' });
  await pl.waitForSelector('#leaderChapter');
  check(await pl.inputValue('#leaderChapter') === 'aconsu-knust', 'next time, the chapter they chose last is already chosen');
  await lead.close();

  check(errs.length === 0, 'no script errors in the app', errs);
  await phone.close(); await desk.close(); await admCtx.close();
}

// Screenshots are kept in the repository, so they are made small: 800px wide at most, palette PNG.
async function shrinkShots() {
  const sharp = require('sharp');
  for (const f of fs.readdirSync(SHOTS).filter(n => n.endsWith('.png'))) {
    const file = path.join(SHOTS, f);
    const buf = await sharp(file).resize({ width: 800, withoutEnlargement: true }).png({ palette: true, quality: 90, compressionLevel: 9 }).toBuffer();
    fs.writeFileSync(file, buf);
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  try { await website(browser); await app(browser); } finally { await browser.close(); }
  await shrinkShots();
  console.log(`\n${failures ? failures + ' FAILURES' : 'all UX checks passed'}`);
  process.exit(failures ? 1 : 0);
})();
