// The Treasurer and the Financial Secretary on a phone, in a real browser:
// landing on their money, filing a Sunday's offering with a photo, the Sundays
// side by side, and bringing the old books in. And Shepherding linking someone
// on the list to the app account they opened.
//
//   node test/books-ui.js
//
// Needs Playwright and a Chromium (see test/ux.js). Not part of `npm test`.
// Screenshots go to BOOKS_SHOTS (or a temporary folder, printed at the end).
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
const SHOTS = process.env.BOOKS_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'books-shots-'));
let failures = 0;
const check = (label, ok, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || detail === undefined ? '' : ' - ' + JSON.stringify(detail).slice(0, 300))); if (!ok) failures++; };
// A real 1x1 PNG, so the photo of the count goes through the image shrinker as a phone's would.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const BOOKS = [
  'Date,Particulars,Receipts (GHS),Payments (GHS),Balance',
  '06/09/2026,Sunday offering,"1,250.00",,1250',
  '08/09/2026,Transport for evangelism,,200.00,1050',
  '07/09/2026,Tithe,300,,1350',
  '13/09/2026,Harvest,500,,1850'
].join('\n');

(async () => {
  const { fakeModels } = require(path.join(ROOT, 'test', 'harness.js'));
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/books-ui', PORT: '4475', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 't', LOGIN_RATE_LIMIT_MAX: '900' });
  delete process.env.SHEPHERD_USERNAME;
  require(path.join(ROOT, 'server.js'));
  await new Promise(r => setTimeout(r, 1500));
  const BASE = 'http://127.0.0.1:4475';
  let jar = '';
  const api = async (m, p, b) => { const h = {}; if (jar) h.cookie = jar; if (b) h['content-type'] = 'application/json'; const r = await fetch(BASE + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) jar = sc.map(c => c.split(';')[0]).join('; '); return r.json().catch(() => ({})); };
  await api('POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  const C = 'aconsu-knust';
  await api('POST', '/api/national/chapters', { id: C, name: 'ACONSU KNUST', institution: 'KNUST' });
  let n = 0;
  const member = async (name, phone) => {
    n += 1;
    const fd = new FormData();
    fd.append('profileImage', new Blob([PNG], { type: 'image/png' }), 'p.png');
    Object.entries({ name, email: `bkui${n}@example.com`, password: 'secret123', chapterId: C, consent: 'true', phone: phone || '' }).forEach(([k, v]) => fd.append(k, v));
    return (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd })).json()).member.id;
  };
  const tr = (await api('POST', '/api/admin/staff', { role: 'executive', positionKey: 'treasurer', memberId: await member('Kwame Treasurer'), chapterId: C })).issued;
  const fsec = (await api('POST', '/api/admin/staff', { role: 'executive', positionKey: 'financial_secretary', memberId: await member('Abena FinSec'), chapterId: C })).issued;
  await api('POST', '/api/admin/staff', { username: 'shep', name: 'Shepherding Head', role: 'shepherding', password: 'Start-Pass-1', memberId: await member('Shep Head'), chapterId: C });
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; });
  // Someone on the list, and (later) the app account they open with a different phone.
  fakeModels.ShepherdingRecord._docs.push({ _id: 'x1', id: 'shep_list_1', chapterId: C, memberId: '', name: 'Yaw Boateng', phone: '0277777777', email: '', origin: 'import', attendanceStatus: 'regular', linkedAt: null, linkedHow: '', createdAt: new Date().toISOString() });
  await member('Yaw Boateng', '0200000077');

  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  async function signIn(page, username, password, hash, opts) {
    const ctx = await browser.newContext(opts || phone);
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message));
    p.on('console', m => { if (m.type() === 'error' && !/favicon|401/.test(m.text())) errors.push(m.text()); });
    await p.goto(`${BASE}/${page}.html${hash || ''}`, { waitUntil: 'networkidle' });
    await p.fill('#portalUsername', username);
    await p.fill('#portalPassword', password);
    await p.click('#portalLoginBtn');
    await p.waitForSelector('#portalShell', { state: 'visible' });
    await p.waitForTimeout(500);
    return p;
  }
  // Against the phone's own width: a page too wide for a phone makes the phone
  // zoom out, and then the page's idea of the window grows with it.
  const noSideways = (p) => p.evaluate((w) => document.documentElement.scrollWidth <= w + 1, p.viewportSize().width);
  // Tables and lists that would make someone scroll sideways inside their box.
  const inBoxes = (p, list) => p.evaluate((showList) => {
    const wide = [...document.querySelectorAll('.portal-panel.active .table-wrap')].filter(t => t.scrollWidth > t.clientWidth + 1);
    return showList ? wide.map(t => [...t.querySelectorAll('th')].map(x => x.textContent.trim()).join('|')) : wide.length === 0;
  }, !!list);
  const activePanel = (p) => p.evaluate(() => (document.querySelector('#portalNav button.active') || {}).dataset.panel);

  console.log('\n== the Treasurer ==');
  const t = await signIn('executive', tr.username, tr.password);
  check('lands on Account for Money, not their profile', await activePanel(t) === 'treasury', await activePanel(t));
  const menu = await t.$$eval('#portalNav > *', els => els.map(e => e.tagName === 'P' ? `[${e.textContent.trim()}]` : e.dataset.panel));
  check('their money first in the menu, then everything else under its own heading', menu[0] === 'treasury' && menu[1] === 'finance' && menu[2] === '[Everything else]', menu);
  check('the offering form is the first thing on the screen', await t.isVisible('#offeringForm'));
  await t.fill('#offAmount', '640.50');
  await t.fill('#offCounted', 'Abena');
  await t.click('#offeringForm [type="submit"]');
  check('filing without a photo says why', /photo/.test(await t.textContent('#offMsg')));
  await t.setInputFiles('#offPhoto', { name: 'count.png', mimeType: 'image/png', buffer: PNG });
  await t.click('#offeringForm [type="submit"]');
  await t.waitForSelector('.bk-sundays');
  const sundays = await t.textContent('.bk-sundays');
  check('filed: the Sunday shows the offering waiting for the Financial Secretary', /640\.50/.test(sundays) && /waiting to be recorded/.test(sundays), sundays);
  check('the Sundays fit a phone without scrolling sideways', await t.$eval('.bk-sundays', el => el.scrollWidth <= el.parentElement.clientWidth + 1));
  check('no sideways scrolling', await noSideways(t));
  check('and no list on it needs scrolling sideways either', await inBoxes(t), await inBoxes(t, true));
  await t.screenshot({ path: path.join(SHOTS, 'treasurer-phone.png'), fullPage: true });

  console.log('\n== the Financial Secretary ==');
  const f = await signIn('executive', fsec.username, fsec.password);
  check('lands on the books', await activePanel(f) === 'ledger', await activePanel(f));
  check('with the Treasurer\'s offering waiting to be recorded', /offertory/.test(await f.textContent('#panel-ledger')));
  await f.click('#importBooksBtn');
  await f.setInputFiles('#impFile', { name: 'cashbook.csv', mimeType: 'text/csv', buffer: Buffer.from(BOOKS) });
  await f.waitForSelector('.imp-cols');
  const guessed = await f.$$eval('.imp-cols select', s => s.map(x => x.value));
  check('a cash book\'s columns are recognised', JSON.stringify(guessed) === JSON.stringify(['date', 'description', 'amountIn', 'amountOut', 'skip']), guessed);
  await f.click('#impCheck');
  await f.waitForSelector('.imp-summary');
  const summary = await f.textContent('.imp-summary');
  check('the check gives the totals to compare with the book', /3 entries will be added/.test(summary) && /1,750\.00|1750\.00/.test(summary) && /200\.00/.test(summary), summary);
  check('and says tithe is left out for Welfare\'s book', /Welfare/.test(await f.textContent('#modalContent')));
  await f.screenshot({ path: path.join(SHOTS, 'books-check-phone.png'), fullPage: true });
  await f.click('#impGo');
  await f.waitForFunction(() => !document.getElementById('modalBackdrop').classList.contains('open'));
  await f.waitForFunction(() => /books kept before/.test(document.getElementById('panel-ledger').textContent));
  check('the old books are in the ledger', true);
  check('no sideways scrolling', await noSideways(f));
  check('the waiting list and the ledger are cards that fit the phone', await inBoxes(f), await inBoxes(f, true));
  const tap = await f.$$eval('[data-record], [data-reject]', bs => bs.map(b => Math.round(b.getBoundingClientRect().height)));
  check('Record and Send back are big enough to tap', tap.length && tap.every(h => h >= 44), tap);
  await f.screenshot({ path: path.join(SHOTS, 'finsec-phone.png'), fullPage: true });
  const dark = await signIn('executive', fsec.username, fsec.password, '#ledger', { ...phone, colorScheme: 'dark' });
  check('executive.html#ledger opens the books too', await activePanel(dark) === 'ledger');
  await dark.screenshot({ path: path.join(SHOTS, 'finsec-dark.png'), fullPage: true });

  console.log('\n== Shepherding links someone on the list to their account ==');
  const s = await signIn('shepherding', 'shep', 'Start-Pass-1', '', { viewport: { width: 1280, height: 900 } });
  await s.click('#portalNav button[data-panel="members"]');
  await s.waitForSelector('[data-link]');
  check('the likely account is suggested beside them', /Possible app account: Yaw Boateng \(same name\)/.test(await s.textContent('#panel-members')));
  await s.click('[data-link="shep_list_1"]');
  await s.waitForSelector('#linkChoices input[type="radio"]');
  check('the suggested account comes first, chosen', await s.$eval('#linkChoices input[type="radio"]', r => r.checked));
  await s.screenshot({ path: path.join(SHOTS, 'link-account.png') });
  await s.click('#linkGo');
  await s.waitForFunction(() => /linked by hand/.test(document.getElementById('panel-members').textContent));
  check('linked: they are one person, saying how it was linked', (await s.$$eval('#panel-members tr', rows => rows.filter(r => /Yaw Boateng/.test(r.textContent)).length)) === 1);
  check('and it can be undone', await s.isVisible('[data-unlink]'));

  check('no script errors', errors.length === 0, errors);
  await browser.close();
  console.log(`\nScreenshots: ${SHOTS}`);
  console.log(failures ? `\n${failures} FAILURES` : '\nall books browser checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
