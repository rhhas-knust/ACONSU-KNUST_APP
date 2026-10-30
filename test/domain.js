// No domain name yet: everything that needs one works on Render's address or
// a developer's machine today, waits quietly for its setting, and says what it
// is waiting for. The day a domain is bought, setting PUBLIC_BASE_URL (and the
// rest of docs/when-you-have-a-domain.md) switches each part on.
//
//   node test/domain.js     (also run by `npm test`)
const fs = require('fs');
const os = require('os');
const path = require('path');
require('./harness.js');
const baseUrl = require('../lib/baseUrl');
const push = require('../lib/push');
const appAddress = require('../site/tools/app-address');

(async () => {
  process.env.MONGODB_URI = 'mongodb://stub/aconsu_domain';
  process.env.PORT = '4338';
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'admin123';
  process.env.SESSION_SECRET = 'test';
  // Exactly what a fresh deploy without a domain looks like.
  ['PUBLIC_BASE_URL', 'RENDER_EXTERNAL_URL', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MNOTIFY_API_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'ANDROID_ASSET_LINKS', 'COOKIE_DOMAIN'].forEach((k) => delete process.env[k]);

  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 400)}` : ''}`); }
  }
  const req = (host, protocol = 'https') => ({ protocol, get: (h) => (h === 'host' ? host : '') });

  console.log('\n== the app\'s address, in one place ==');
  check('the chosen address wins over Render\'s', baseUrl.forLinks(req('evil.example'), { PUBLIC_BASE_URL: 'https://app.aconsu.org', RENDER_EXTERNAL_URL: 'https://aconsu-knust-app.onrender.com' }) === 'https://app.aconsu.org');
  check('with none chosen, links use Render\'s own address', baseUrl.forLinks(req('evil.example'), { RENDER_EXTERNAL_URL: 'https://aconsu-knust-app.onrender.com/', NODE_ENV: 'production' }) === 'https://aconsu-knust-app.onrender.com');
  check('in production with neither, it refuses rather than trust the Host header', baseUrl.forLinks(req('evil.example'), { NODE_ENV: 'production' }) === '');
  check('a developer machine uses the request, then localhost', baseUrl.forLinks(req('localhost:7000', 'http'), {}) === 'http://localhost:7000' && baseUrl.forLinks(null, { PORT: '7000' }) === 'http://localhost:7000');
  check('search engines get only an address the owner chose, never Render\'s stand-in', baseUrl.chosen({ RENDER_EXTERNAL_URL: 'https://aconsu-knust-app.onrender.com' }) === '' && baseUrl.chosen({ PUBLIC_BASE_URL: 'https://app.aconsu.org/' }) === 'https://app.aconsu.org');
  check('an address with a path, no scheme, or odd characters is not accepted',
    ['aconsu.org', 'https://aconsu.org/app', 'https://a<b>.org', 'https://aconsu.org?x=1', 'javascript:alert(1)', 'https://user@aconsu.org'].every(v => baseUrl.chosen({ PUBLIC_BASE_URL: v }) === ''));
  check('a sign-in cookie stays on the app\'s own address unless COOKIE_DOMAIN is a real domain',
    baseUrl.cookieDomain({}) === '' && baseUrl.cookieDomain({ COOKIE_DOMAIN: 'aconsu.org' }) === 'aconsu.org' && baseUrl.cookieDomain({ COOKIE_DOMAIN: 'not a domain' }) === '');
  check('the Android link file is read only from a JSON list',
    baseUrl.assetLinks({}) === null && baseUrl.assetLinks({ ANDROID_ASSET_LINKS: '{not json' }) === null && baseUrl.assetLinks({ ANDROID_ASSET_LINKS: '{"a":1}' }) === null
    && baseUrl.assetLinks({ ANDROID_ASSET_LINKS: '[{"relation":["delegate_permission/common.handle_all_urls"]}]' }).length === 1);

  console.log('\n== push needs a contact, not a domain ==');
  check('a mailto: or https: contact is used as it is', push.vapidSubject({ VAPID_SUBJECT: 'mailto:a@b.org' }) === 'mailto:a@b.org' && push.vapidSubject({ VAPID_SUBJECT: 'https://x.onrender.com' }) === 'https://x.onrender.com');
  check('a bare email address is taken as mailto:', push.vapidSubject({ VAPID_SUBJECT: 'me@gmail.com' }) === 'mailto:me@gmail.com');
  check('with none set, the mail sender, then the app\'s https address', push.vapidSubject({ MAIL_FROM: 'ACONSU <noreply@aconsu.org>' }) === 'mailto:noreply@aconsu.org' && push.vapidSubject({ RENDER_EXTERNAL_URL: 'https://x.onrender.com' }) === 'https://x.onrender.com');
  check('nonsense is never passed on to the push library', /^mailto:/.test(push.vapidSubject({ VAPID_SUBJECT: 'nonsense' })) && /^mailto:/.test(push.vapidSubject({ VAPID_SUBJECT: 'http://insecure.example' })));

  console.log('\n== the public website has one setting for the app\'s address ==');
  {
    const siteDir = path.join(__dirname, '..', 'site');
    // Every place the site names the app: a request target or an allowed
    // outside address. All of them must be the one the publish swaps.
    const mentions = fs.readdirSync(siteDir).filter(f => /\.(html|js)$/.test(f)).flatMap((f) => {
      const text = fs.readFileSync(path.join(siteDir, f), 'utf8');
      return [...text.matchAll(/https:\/\/[a-z0-9.-]+\.onrender\.com/gi)].map(m => ({ f, url: m[0] }))
        .concat([...text.matchAll(/connect-src 'self' ([^;"]+)/g)].map(m => ({ f, url: m[1].trim() })));
    });
    check('the site names the app only by the address the publish swaps', mentions.length >= 4 && mentions.every(m => m.url === appAddress.IN_THE_FILES), mentions);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aconsu-site-'));
    appAddress.FILES.forEach(f => fs.copyFileSync(path.join(siteDir, f), path.join(tmp, f)));
    const done = appAddress.swap(tmp, 'https://app.aconsu.org/');
    const after = appAddress.FILES.map(f => fs.readFileSync(path.join(tmp, f), 'utf8')).join('\n');
    check('and the publish writes the new address into all three files', done.changed.length === 3 && !after.includes(appAddress.IN_THE_FILES) && after.includes("connect-src 'self' https://app.aconsu.org;") && after.includes("requestUrl: 'https://app.aconsu.org'"), done);
    let refused = '';
    try { appAddress.swap(tmp, 'http://plain.example'); } catch (e) { refused = e.message; }
    check('an address that is not https, or not just an address, is refused', /APP_URL must be/.test(refused));
    check('with no APP_URL, nothing changes', appAddress.swap(tmp, '').changed.length === 0);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('\n== no hostname written into the app ==');
  {
    const root = path.join(__dirname, '..');
    const files = ['server.js', ...['lib', 'routes'].flatMap(d => fs.readdirSync(path.join(root, d)).filter(f => f.endsWith('.js')).map(f => `${d}/${f}`)),
      ...fs.readdirSync(path.join(root, 'public')).filter(f => f.endsWith('.html')).map(f => `public/${f}`),
      ...fs.readdirSync(path.join(root, 'public/js')).filter(f => f.endsWith('.js')).map(f => `public/js/${f}`), 'public/sw.js', 'public/manifest.json'];
    const found = files.filter(f => /onrender\.com|aconsu\.org|github\.io/i.test(fs.readFileSync(path.join(root, f), 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '')));
    // routes/church-life.js names the public website's GitHub Pages address as
    // the default for SITE_ORIGINS; that is the website, not the app, and it
    // can be changed by setting SITE_ORIGINS.
    check('the app\'s own code names no hostname (only SITE_ORIGINS\' default)', found.length === 1 && found[0] === 'routes/church-life.js', found);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/manifest.json'), 'utf8'));
    check('the installed app\'s identity stays relative, so it survives a move', manifest.id === '/index.html' && manifest.start_url === '/index.html' && manifest.scope === '/', manifest);
  }

  // ------------------------------------------------------------------ the app --
  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4338';
  const get = async (p) => { const r = await fetch(BASE + p); return { status: r.status, type: r.headers.get('content-type') || '', text: await r.text() }; };

  console.log('\n== with no domain, no email, no SMS and no push keys ==');
  let r = await get('/api/health');
  let h = JSON.parse(r.text);
  check('the app starts and the health check answers', r.status === 200 && h.ok === true, h);
  check('it lists what is waiting for configuration', ['publicAddress', 'email', 'pushNotifications', 'searchEngines', 'androidAppLinks', 'linksInMessages'].every(n => h.waitingForConfiguration.includes(n)), h.waitingForConfiguration);
  check('and what each one needs, by setting name only', h.features.publicAddress.needs === 'PUBLIC_BASE_URL' && h.features.androidAppLinks.needs === 'ANDROID_ASSET_LINKS', h.features);
  check('a shared cookie domain is off on purpose, not waiting', !h.waitingForConfiguration.includes('sharedCookieDomain') && h.features.sharedCookieDomain.on === false, h);
  check('no value or address is shown', !/mongodb|admin123|onrender|localhost/i.test(r.text), r.text);
  r = await get('/robots.txt');
  check('robots.txt keeps crawlers out of the API and names no sitemap yet', r.status === 200 && /Disallow: \/api\//.test(r.text) && !/Sitemap/.test(r.text), r.text);
  r = await get('/sitemap.xml');
  check('there is no sitemap yet, rather than one full of a stand-in address', r.status === 404, r);
  r = await get('/.well-known/assetlinks.json');
  check('the Android link file is not there until it is set', r.status === 404, r);
  r = await fetch(BASE + '/api/auth/forgot-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nobody@example.com' }) });
  check('asking for a password reset still answers, without email set up', r.status === 200 && /If an account exists/.test((await r.json()).message));

  console.log('\n== the day the domain is set ==');
  process.env.PUBLIC_BASE_URL = 'https://app.aconsu.org';
  process.env.ANDROID_ASSET_LINKS = JSON.stringify([{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'com.aconsu.app', sha256_cert_fingerprints: ['AA:BB'] } }]);
  h = JSON.parse((await get('/api/health')).text);
  check('the health check says the address and app links are on', h.features.publicAddress.on && h.features.searchEngines.on && h.features.androidAppLinks.on && !h.waitingForConfiguration.includes('publicAddress'), h);
  r = await get('/robots.txt');
  check('robots.txt points at the sitemap on the domain', /Sitemap: https:\/\/app\.aconsu\.org\/sitemap\.xml/.test(r.text), r.text);
  r = await get('/sitemap.xml');
  check('the sitemap lists the public pages on the domain', r.status === 200 && /xml/.test(r.type) && /<loc>https:\/\/app\.aconsu\.org\/events\.html<\/loc>/.test(r.text) && !/admin|executive|finance/.test(r.text), r.text);
  r = await get('/.well-known/assetlinks.json');
  check('the Android link file is served as JSON', r.status === 200 && /json/.test(r.type) && JSON.parse(r.text)[0].target.package_name === 'com.aconsu.app', r);

  console.log(failures ? `\n${failures} FAILURES` : '\nall domain checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
