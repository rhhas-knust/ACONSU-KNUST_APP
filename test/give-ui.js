// Giving in a real browser, on a phone, without an account: the chapter's
// account on screen (Welfare's for tithe), saying what was sent, the receipt
// at once and by its own link, and Finance confirming what arrived in their
// portal. The SMS provider is answered here.
//
//   node test/give-ui.js
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
const SHOTS = process.env.GIVE_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'give-shots-'));
let failures = 0;
const check = (label, ok, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || detail === undefined ? '' : ' - ' + JSON.stringify(detail).slice(0, 300))); if (!ok) failures++; };

(async () => {
  const { fakeModels } = require(path.join(ROOT, 'test', 'harness.js'));
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/give-ui', PORT: '4482', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 't', LOGIN_RATE_LIMIT_MAX: '900' });
  ['MNOTIFY_API_KEY', 'SMS_SENDER_ID', 'PAYMENT_PROVIDER'].forEach(k => delete process.env[k]);
  const texts = [];
  const passOn = global.fetch;
  global.fetch = (url, opts) => {
    if (String(url).startsWith('https://apps.mnotify.net/')) { texts.push(new URL(String(url)).searchParams.get('msg')); return Promise.resolve(new Response('1000')); }
    return passOn(url, opts);
  };
  require(path.join(ROOT, 'server.js'));
  await new Promise(r => setTimeout(r, 1500));
  const BASE = 'http://127.0.0.1:4482';
  let jar = '';
  const api = async (m, p, b) => { const h = {}; if (jar) h.cookie = jar; if (b) h['content-type'] = 'application/json'; const r = await fetch(BASE + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) jar = sc.map(c => c.split(';')[0]).join('; '); return r.json().catch(() => ({})); };
  await api('POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  await api('POST', '/api/national/chapters', { id: 'aconsu-knust', name: 'ACONSU KNUST', institution: 'KNUST' });
  const ch = fakeModels.Chapter._docs.find(c => c.id === 'aconsu-knust');
  ch.payment = { provider: 'MoMo', momoNumber: '0240000001', momoName: 'ACONSU KNUST', welfareMomoNumber: '0240000002', welfareMomoName: 'ACONSU Welfare' };
  ch.sms = { apiKey: 'k', senderId: 'ACONSU' };
  const fd = new FormData();
  Object.entries({ name: 'Fin Lead', email: 'fin@example.com', password: 'secret123', chapterId: 'aconsu-knust', consent: 'true' }).forEach(([k, v]) => fd.append(k, v));
  const memberId = (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd })).json()).member.id;
  await api('POST', '/api/admin/staff', { username: 'fin', name: 'Fin Lead', role: 'finance', password: 'Start-Pass-1234', memberId, chapterId: 'aconsu-knust' });
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; });

  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
  const ctx = await browser.newContext(phone);
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(e.message));
  const noSideways = () => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

  console.log('\n== giving without an account ==');
  await p.goto(`${BASE}/give.html`, { waitUntil: 'networkidle' });
  await p.waitForSelector('#giveForm:not([hidden])');
  check('the chapter\'s Mobile Money number is on screen, with no sign-in asked for', /0240000001/.test(await p.textContent('#payInfo')) && !/log in to give/i.test(await p.textContent('main')));
  await p.selectOption('#purpose', 'tithe');
  check('choosing tithe shows Welfare\'s account instead', /0240000002/.test(await p.textContent('#payInfo')) && /Welfare account/.test(await p.textContent('#payInfo')));
  await p.selectOption('#purpose', 'offertory');
  check('a guest is asked their name and agreement; a member would not be', await p.isVisible('#giverName') && await p.isVisible('#giveConsent'));
  const unlabelled = await p.$$eval('#giveForm input:not([type=hidden]), #giveForm select', els => els.filter(e => e.offsetParent && !e.closest('.give-trap') && !(e.labels && e.labels.length) && !e.closest('label')).map(e => e.id));
  check('every field has a label', unlabelled.length === 0, unlabelled);
  await p.click('#giveSubmitBtn');
  check('sent empty, it says what is missing', /amount/.test(await p.textContent('#giveMsg')));
  await p.fill('#amount', '50');
  await p.fill('#giverName', 'Kwame Visitor');
  await p.fill('#payerNumber', '024 555 1234');
  await p.selectOption('#payerNetwork', 'mtn');
  await p.check('#giveConsent');
  await p.screenshot({ path: path.join(SHOTS, 'give-form.png'), fullPage: true });
  check('it fits the phone', await noSideways());
  await p.click('#giveSubmitBtn');
  await p.waitForSelector('#receiptCard:not([hidden])');
  const card = await p.textContent('#receiptCard');
  check('the receipt comes at once: waiting to be confirmed, with what they said', /Waiting to be confirmed/.test(card) && /Thank you, Kwame/.test(card) && /GH₵ 50\.00/.test(card), card);
  const link = (await p.textContent('.receipt-url')).trim();
  check('with a link of its own to keep', /\/give\.html\?receipt=[A-Za-z0-9_-]{20,}$/.test(link), link);
  await p.screenshot({ path: path.join(SHOTS, 'give-receipt.png'), fullPage: true });

  console.log('\n== Finance confirms what arrived ==');
  const f = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  f.on('pageerror', e => errors.push(e.message));
  await f.goto(`${BASE}/finance.html#giving`, { waitUntil: 'networkidle' });
  await f.fill('#portalUsername', 'fin'); await f.fill('#portalPassword', 'Start-Pass-1234'); await f.click('#portalLoginBtn');
  await f.waitForSelector('[data-confirm]');
  check('the guest\'s gift is in the queue, marked as having no account, with the number', /Kwame Visitor[\s\S]*No account[\s\S]*From 024 555 1234/.test(await f.textContent('#panel-giving tbody')));
  await f.click('[data-confirm]');
  await f.waitForSelector('#cgAmount');
  check('confirming asks for the amount the account received, filled in with what they said', await f.inputValue('#cgAmount') === '50');
  await f.fill('#cgAmount', '45');
  await f.click('#confirmGiveForm button[type=submit]');
  await f.waitForTimeout(600);
  check('the books hold what arrived', fakeModels.FinanceEntry._docs.some(e => e.amount === 45 && /Kwame Visitor/.test(e.description)));
  check('and the guest is texted a receipt', texts.some(t => /received your GH₵ 45\.00 offering/.test(t)), texts);

  console.log('\n== the receipt link, later ==');
  await p.goto(link, { waitUntil: 'networkidle' });
  await p.waitForSelector('#receiptCard:not([hidden])');
  const later = await p.textContent('#receiptCard');
  check('opened later, it says received, and how much arrived', /Received/.test(later) && /GH₵ 45\.00/.test(later), later);

  console.log('\n== giving cards ==');
  // Two harvest gifts from the same number: the offering above is on no card.
  for (const amount of ['30', '20']) {
    await fetch(`${BASE}/api/giving/guest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chapterId: 'aconsu-knust', name: 'Kwame Visitor', payerNumber: '0245551234', payerNetwork: 'mtn', amount, purpose: 'harvest', consent: true }) });
  }
  await p.goto(link, { waitUntil: 'networkidle' });
  await p.waitForSelector('#receiptCard .giver-card');
  const guestCard = await p.textContent('#receiptCard .giver-card');
  check('the receipt link also opens their giving card: both harvest gifts from that number, the offering not on it', /GH₵ 50\.00 waiting/.test(guestCard) && /Every gift \(2\)/.test(guestCard) && !/Offering/.test(guestCard), guestCard);
  check('with no phone number on it', !/555 ?1234/.test(guestCard));
  check('and it fits the phone', await noSideways());
  await f.evaluate(() => window.openPanel('givers'));
  await f.waitForSelector('#panel-givers .giver-card');
  const finCards = await f.textContent('#panel-givers');
  check('Finance has a card for the guest, by name and number, with what is waiting', /Kwame Visitor/.test(finCards) && /No account · 0245551234/.test(finCards) && /GH₵ 50\.00 waiting/.test(finCards), finCards.slice(0, 400));
  await f.fill('#giverSearch', '999');
  check('a search that matches nobody says so', /Nobody by that name or number/.test(await f.textContent('#giverGrid')));
  await f.fill('#giverSearch', '5551');
  check('and searching a few digits of the number finds them', /Kwame Visitor/.test(await f.textContent('#giverGrid')));
  check('the cards can be downloaded for the records', await f.isVisible('#giverCsv'));

  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  // With a photo: a new account is asked for one before anything else.
  const reg = await mctx.request.post(`${BASE}/api/auth/register`, { multipart: { name: 'Abena Member', phone: '0201234567', chapterId: 'aconsu-knust', password: 'secret123', consent: 'true', profileImage: { name: 'me.png', mimeType: 'image/png', buffer: Buffer.from('p') } } });
  check('a member signs up', reg.ok(), await reg.text());
  await mctx.request.post(`${BASE}/api/giving/intents`, { data: { amount: '60', purpose: 'tithe', payerNumber: '0201234567', payerNetwork: 'mtn' } });
  await mctx.request.post(`${BASE}/api/giving/intents`, { data: { amount: '10', purpose: 'offertory', payerNumber: '0201234567', payerNetwork: 'mtn' } });
  const m = await mctx.newPage();
  m.on('pageerror', e => errors.push(e.message));
  await m.goto(`${BASE}/give.html#givingCard`, { waitUntil: 'networkidle' });
  await m.waitForSelector('#giveHistory .giver-card');
  const own = await m.textContent('#giveHistory .giver-card');
  check('a member sees their own giving card on the Give page: the tithe waiting, the offering not on it', /Abena Member/.test(own) && /GH₵ 60\.00 waiting/.test(own) && !/Offering/.test(own), own);
  check('the offering is still listed among everything they told us about', /Offering: GH₵ 10\.00/.test(await m.textContent('#giveHistory')));
  await m.goto(`${BASE}/profile.html`, { waitUntil: 'networkidle' });
  check('Profile links to it', await m.locator('a[href="/give.html#givingCard"]').count() === 1);
  await mctx.close();

  console.log('\n== payments setup ==');
  const a = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  a.on('pageerror', e => errors.push(e.message));
  await a.goto(`${BASE}/admin.html`, { waitUntil: 'networkidle' });
  await a.fill('#username', 'admin'); await a.fill('#password', 'admin123'); await a.click('#loginForm button[type="submit"]');
  await a.waitForSelector('#adminShell', { state: 'visible' });
  await a.evaluate(() => window.openAdminPanel('chapterSettings'));
  await a.waitForSelector('#paymentsSetup strong', { timeout: 8000 }).catch(() => {});
  const setup = await a.textContent('#paymentsSetup').catch(() => '');
  check('the chapter settings say giving is manual, with nothing to connect', /Manual\./.test(setup) && /nothing to connect/.test(setup), setup);

  check('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall giving screen checks passed');
  console.log(`screenshots: ${SHOTS}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
