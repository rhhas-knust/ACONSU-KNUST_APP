// The first-time visitor's path, in a real browser: the home page says when and
// where without a click, and Plan your visit answers the rest from the
// chapter's own settings.
//
//   node test/visit-ui.js
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
const SHOTS = process.env.VISIT_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'visit-shots-'));
let failures = 0;
const check = (ok, label, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || detail === undefined ? '' : ' - ' + JSON.stringify(detail).slice(0, 300))); if (!ok) failures++; };

(async () => {
  require(path.join(ROOT, 'test', 'harness.js'));
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/visit-ui', PORT: '4475', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 't' });
  require(path.join(ROOT, 'server.js'));
  await new Promise(r => setTimeout(r, 1500));
  const BASE = 'http://127.0.0.1:4475';
  let jar = '';
  const api = async (m, p, b) => { const h = {}; if (jar) h.cookie = jar; if (b) h['content-type'] = 'application/json'; const r = await fetch(BASE + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.getSetCookie(); if (sc.length) jar = sc.map(c => c.split(';')[0]).join('; '); return r.json().catch(() => ({})); };
  await api('POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  await api('POST', '/api/national/chapters', { id: 'aconsu-knust', name: 'ACONSU-KNUST', institution: 'KNUST' });

  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];
  const open = async (url, opts) => { const c = await browser.newContext(opts || { viewport: { width: 390, height: 844 } }); const p = await c.newPage(); p.on('pageerror', e => errors.push(`${url}: ${e.message}`)); await p.goto(BASE + url, { waitUntil: 'networkidle' }); await p.waitForTimeout(400); return p; };

  console.log('\n== before the chapter has said when and where ==');
  let p = await open('/index.html');
  check(await p.locator('#joinUsCard .join-card').count() === 0, 'the home page shows no empty "Join us" card');
  check(await p.locator('#homeHero .btn-primary').first().textContent() === 'Plan your visit', 'its first button is Plan your visit');
  p = await open('/visit.html');
  check(/will be posted here soon/.test(await p.textContent('#visitTimes')), 'the visit page says the times are coming, rather than guessing');
  check(await p.isHidden('#whereCard'), 'and leaves out a place it does not know');
  check(/Acts 2:42/.test(await p.textContent('#visitExpect')), 'what to expect falls back to what every chapter gathers for');

  console.log('\n== once it has ==');
  await api('PUT', '/api/admin/chapter-settings', {
    location: 'Great Hall', address: 'KNUST Campus, Kumasi', serviceTimes: ['Sundays 8:00 AM - 11:00 AM', 'Wednesdays 6:30 PM'],
    contact: { whatsapp: '233240000000', phone: '0240000000', email: 'hello@example.org' },
    about: { firstVisit: 'Services last about three hours.\n\nUshers at the door will help you find a seat.' }
  });
  await api('POST', '/api/admin/events', { title: 'Freshers Welcome Service', date: '2099-11-01', time: '18:00', location: 'Great Hall', chapterId: 'aconsu-knust' });
  p = await open('/index.html');
  const card = await p.textContent('#joinUsCard');
  check(/Sundays 8:00 AM/.test(card) && /Wednesdays 6:30 PM/.test(card) && /Great Hall/.test(card), 'the home page says when and where, in the hero, without a click');
  const heroBox = await p.locator('#joinUsCard .join-card').boundingBox();
  check(heroBox && heroBox.y + heroBox.height < 900, 'within the first screen and a bit on a phone', heroBox);
  check(await p.locator('#dashboardTiles .tile').count() === 6, 'quick access has six tiles, not eleven');
  await p.screenshot({ path: path.join(SHOTS, 'home-phone.png'), fullPage: true });
  p = await open('/visit.html');
  check(/Sundays 8:00 AM - 11:00 AM/.test(await p.textContent('#visitTimes')), 'the visit page lists the meeting times');
  check(await p.textContent('#visitPlace') === 'Great Hall' && /KNUST Campus/.test(await p.textContent('#visitAddress')), 'where, and the address that finds it');
  check(/maps\/search/.test(await p.getAttribute('#visitDirections', 'href')) && await p.getAttribute('#visitDirections', 'rel') === 'noopener', 'with directions that open the map');
  check(/three hours/.test(await p.textContent('#visitExpect')) && await p.locator('#visitExpect p').count() === 2, 'what to expect is the chapter\'s own words, in its paragraphs');
  check(/wa\.me\/233240000000/.test(await p.getAttribute('#visitContact a.btn-primary', 'href')), 'and asking a question is one tap away on WhatsApp');
  check(/Freshers Welcome Service/.test(await p.textContent('#visitNext')), 'with what is coming up next');
  check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'it fits a phone without sideways scroll');
  const small = await p.$$eval('main a.btn, main button', els => els.filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [e.textContent.trim(), Math.round(r.height)]; }).filter(([, h]) => h < 44));
  check(small.length === 0, 'every button is at least 44px to press', small);
  const order = await p.$$eval('main h1, main h2', els => els.map(e => e.tagName));
  check(order[0] === 'H1' && order.slice(1).every(t => t === 'H2'), 'one heading, then a heading for each part', order);
  await p.screenshot({ path: path.join(SHOTS, 'visit-phone.png'), fullPage: true });
  const narrow = await open('/visit.html', { viewport: { width: 320, height: 640 } });
  check(await narrow.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'and a 320px one');

  const dark = await open('/index.html', { viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  const contrast = await dark.evaluate(() => {
    const lum = (c) => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const bg = getComputedStyle(document.querySelector('.join-card')).backgroundColor;
    return [...document.querySelectorAll('.join-card li, .join-card .join-place span, .join-card .join-link, .join-card .join-eyebrow')].map(el => {
      const a = lum(getComputedStyle(el).color), b = lum(bg);
      return [el.textContent.trim().slice(0, 20), Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 10) / 10];
    }).filter(([, r]) => r < 4.5);
  });
  check(contrast.length === 0, 'the Join us card reads at 4.5:1 or better in dark mode', contrast);
  await dark.screenshot({ path: path.join(SHOTS, 'home-dark.png') });

  check(errors.length === 0, 'no script errors', errors);
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall visit checks passed');
  console.log('screenshots: ' + SHOTS);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
