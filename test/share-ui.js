// The share button in a real browser, at phone width: big enough to tap,
// opening WhatsApp with the event's own link and nothing added to it, and
// counted as one share. WhatsApp itself is never reached.
//
//   node test/share-ui.js
//
// Needs Playwright and a Chromium (see test/ux.js). Not part of `npm test`.
const fs = require('fs');
const path = require('path');
let chromium;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { ({ chromium } = require(p)); break; } catch (e) { /* next */ } }
if (!chromium) { console.error('Playwright is not installed.'); process.exit(2); }
const CHROME = process.env.PLAYWRIGHT_CHROMIUM
  || (fs.existsSync('/opt/pw-browsers')
    ? fs.readdirSync('/opt/pw-browsers').filter(d => /^chromium-\d+$/.test(d)).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`)[0]
    : undefined);
const ROOT = path.join(__dirname, '..');
let failures = 0;
const check = (ok, label, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || detail === undefined ? '' : ' - ' + JSON.stringify(detail).slice(0, 300))); if (!ok) failures++; };

(async () => {
  const { fakeModels } = require(path.join(ROOT, 'test', 'harness.js'));
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/share-ui', PORT: '4477', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 't' });
  delete process.env.PUBLIC_BASE_URL;
  require(path.join(ROOT, 'server.js'));
  await new Promise(r => setTimeout(r, 1500));
  const BASE = 'http://127.0.0.1:4477';
  await fakeModels.Event.create({ id: 'ev-1', title: 'Freshers Night', date: '2099-11-14', time: '6pm', location: 'Great Hall', status: 'published' });

  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const opened = [];
  await c.route(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//, (r) => { opened.push(r.request().url()); r.fulfill({ status: 200, contentType: 'text/html', body: '<p>whatsapp</p>' }); });
  // The phone's own share sheet is not there in a test browser, so the button
  // goes straight to WhatsApp, as it does on a computer.
  await c.addInitScript(() => { try { delete Navigator.prototype.share; } catch (e) { /* not there anyway */ } });
  const p = await c.newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(BASE + '/events.html', { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);

  console.log('\n== the share button on an event ==');
  const btn = p.locator('[data-event-id="ev-1"] .share-btn');
  const box = await btn.boundingBox();
  check(box && box.height >= 44 && box.width >= 44, 'it is at least 44 pixels each way', box);
  check(/Share/.test(await btn.textContent()), 'and says what it does');
  const popup = c.waitForEvent('page');
  await btn.click();
  const wa = await popup;
  await wa.waitForLoadState().catch(() => {});
  const url = new URL(opened[0] || wa.url());
  const text = url.searchParams.get('text') || '';
  check(url.hostname === 'wa.me', 'WhatsApp opens', url.href);
  check(text.includes('Freshers Night') && text.includes('Great Hall'), 'with what the event is', text);
  check(text.endsWith(`${BASE}/events.html?event=ev-1`), 'and the event\'s own link, with nothing added to it', text);
  await p.waitForTimeout(300);
  const row = fakeModels.Metric._docs.find(d => d.key === 'share:event');
  check(row && row.count === 1, 'one share is counted', fakeModels.Metric._docs);

  console.log('\n== the link opens on the event ==');
  await p.goto(BASE + '/events.html?event=ev-1', { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  check(await p.locator('[data-event-id="ev-1"].search-focus-card').count() === 1, 'the shared event is the one picked out');

  console.log('\n== Invite a friend ==');
  await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  const invite = p.locator('.invite-strip .share-btn');
  check(await invite.isVisible() && (await invite.boundingBox()).height >= 44, 'the home page has it, big enough to tap');
  const pop2 = c.waitForEvent('page');
  await invite.click();
  await pop2;
  const t2 = new URL(opened[opened.length - 1]).searchParams.get('text') || '';
  check(t2.endsWith(`${BASE}/`), 'and sends the app\'s own address', t2);

  check(errors.length === 0, 'no page errors', errors);
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall share checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
