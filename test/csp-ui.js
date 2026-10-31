// The stricter script policy in a real browser (Phase 7): every page opens
// and runs, and the browser refuses nothing, now that no script written into
// a page may run (lib/securityHeaders.js). Opens every page as a visitor, and
// the admin's own pages signed in.
//
//   node test/csp-ui.js
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
const check = (label, ok, detail) => { console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || detail === undefined ? '' : ' - ' + JSON.stringify(detail).slice(0, 600))); if (!ok) failures++; };

(async () => {
  require(path.join(ROOT, 'test', 'harness.js'));
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/csp-ui', PORT: '4484', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 't', LOGIN_RATE_LIMIT_MAX: '900' });
  require(path.join(ROOT, 'server.js'));
  await new Promise(r => setTimeout(r, 1500));
  const BASE = 'http://127.0.0.1:4484';
  await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) })
    .then(async (r) => {
      const cookie = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
      await fetch(`${BASE}/api/national/chapters`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ id: 'aconsu-knust', name: 'ACONSU KNUST', institution: 'KNUST' }) });
    });

  const browser = await chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // Every refusal the browser makes, as the page sees it.
  await ctx.addInitScript(() => {
    window.__refused = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__refused.push(`${e.violatedDirective}: ${e.blockedURI || 'inline'} ${e.sourceFile || ''}:${e.lineNumber || ''}`));
  });
  const pages = fs.readdirSync(path.join(ROOT, 'public')).filter(f => f.endsWith('.html'));
  const refused = [];
  const errors = [];
  let ran = 0;
  // A page that shows one thing needs to be told which, or it says so and
  // stops before drawing its frame (as it always has).
  const QUERY = { 'group.html': '?id=missing' };

  console.log(`\n== ${pages.length} pages, as a visitor ==`);
  for (const f of pages) {
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(`${f}: ${e.message}`));
    p.on('console', m => { if (/Content Security Policy|Refused to (execute|load)/i.test(m.text())) refused.push(`${f}: ${m.text().slice(0, 160)}`); });
    await p.goto(`${BASE}/${f}${QUERY[f] || ''}`, { waitUntil: 'networkidle' }).catch(() => {});
    await p.waitForTimeout(250);
    const r = await p.evaluate(() => window.__refused || []).catch(() => []);
    r.forEach(x => refused.push(`${f}: ${x}`));
    // The page's own script ran: the theme is set, and a page that draws the
    // app's frame has drawn it.
    const ok = await p.evaluate(() => !!document.documentElement.getAttribute('data-theme')
      && (!document.getElementById('site-header') || document.getElementById('site-header').children.length > 0)).catch(() => false);
    if (ok) ran += 1; else errors.push(`${f}: its script did not run`);
    await p.close();
  }
  check('the browser refused nothing on any page', refused.length === 0, refused);
  check(`every page's script ran (${ran} of ${pages.length})`, ran === pages.length, errors.filter(e => /did not run/.test(e)));

  console.log('\n== the admin\'s pages, signed in ==');
  const a = await ctx.newPage();
  a.on('pageerror', e => errors.push(`admin: ${e.message}`));
  a.on('console', m => { if (/Content Security Policy|Refused to (execute|load)/i.test(m.text())) refused.push(`admin: ${m.text().slice(0, 160)}`); });
  await a.goto(`${BASE}/admin.html`, { waitUntil: 'networkidle' });
  await a.fill('#username', 'admin'); await a.fill('#password', 'admin123'); await a.click('#loginForm button[type="submit"]');
  await a.waitForSelector('#adminShell', { state: 'visible' });
  for (const panel of ['members', 'events', 'chapterSettings', 'notifications']) {
    await a.evaluate((n) => window.openAdminPanel(n), panel);
    await a.waitForTimeout(400);
  }
  // On a phone the admin's menu is a drawer: open it first, as a person would.
  const drawer = a.locator('#mobileNavBtn');
  if (await drawer.isVisible().catch(() => false)) { await drawer.click(); await a.waitForTimeout(300); }
  const navBtn = a.locator('#navContentHubBtn');
  if (await navBtn.isVisible().catch(() => false)) {
    await Promise.all([a.waitForURL(/content-manager\.html/), navBtn.click()]);
    check('a menu button that goes to another page still goes there (no onclick= now)', /content-manager\.html/.test(a.url()));
  } else {
    await a.goto(`${BASE}/content-manager.html`, { waitUntil: 'networkidle' });
  }
  await a.waitForTimeout(500);
  const r = await a.evaluate(() => window.__refused || []).catch(() => []);
  r.forEach(x => refused.push(`content-manager: ${x}`));
  check('signed in, still nothing refused', refused.length === 0, refused);
  check('no page errors', errors.length === 0, errors);

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nall policy screen checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
