// The app's colour: one colour an admin picks becomes the whole palette, safely.
// Covers the palette maths (lib/brand.js), that no old purple is left in what
// people see, and the real app: the national colour, a chapter's own, and what
// each visitor is sent.
//
//   node test/brand.js     (also run by `npm test`)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
require('./harness.js');
const brand = require('../lib/brand');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`  ok   ${label}`);
  else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 300)}` : ''}`); }
}

(async () => {
  console.log('\n== one colour in, a readable palette out ==');
  const def = brand.paletteFor(brand.DEFAULT_BRAND);
  check('the default is the union\'s navy, #0B1A43', brand.DEFAULT_BRAND === '#0B1A43' && def.brand === '#0B1A43' && !def.adjusted, def.brand);
  check('every text and background pair it draws passes WCAG AA (4.5:1), light and dark', def.ok && def.pairs.length >= 12, def.pairs.filter(p => !p.ok));
  check('white button text on it reads at better than 14:1', brand.contrast('#FFFFFF', def.brand) > 14, brand.contrast('#FFFFFF', def.brand));
  let bad = 0, count = 0;
  for (let h = 0; h < 360; h += 4) for (const s of [0, 0.1, 0.3, 0.6, 0.9, 1]) for (const l of [0.03, 0.12, 0.25, 0.4, 0.55, 0.7, 0.85, 0.97]) {
    count += 1;
    if (!brand.paletteFor(brand.hslToHex(h, s, l)).ok) bad += 1;
  }
  check(`whatever colour is chosen, the palette still passes (${count} colours tried across every hue)`, bad === 0, bad);
  const yellow = brand.paletteFor('#FFEB3B');
  check('a colour too light for white text is darkened, and says so', yellow.adjusted && yellow.brand !== '#FFEB3B' && brand.contrast('#FFFFFF', yellow.brand) >= 5 && yellow.requested === '#FFEB3B', yellow.brand);
  check('a chosen colour that already works is used exactly', brand.paletteFor('#166534').brand === '#166534' && !brand.paletteFor('#166534').adjusted);
  check('anything that is not #RRGGBB falls back to the default', ['', 'red', '#12', '#GGGGGG', 'javascript:1', null, undefined, 42, '#0B1A43; x'].every(v => brand.paletteFor(v).brand === '#0B1A43'));
  check('a grey stays a neutral grey rather than gaining a tint', (() => { const p = brand.paletteFor('#27272A'); return p.ok; })());
  const css = brand.themeCss('#1D4ED8');
  check('the stylesheet has a light block and a dark block', /:root \{/.test(css) && /:root\[data-theme="dark"\] \{/.test(css));
  const tokens = new Set([...read('public/css/style.css').matchAll(/(--[a-z0-9-]+):/g)].map(m => m[1]));
  const emitted = [...css.matchAll(/(--[a-z0-9-]+):/g)].map(m => m[1]);
  check('and sets only variables style.css already defines, so it can recolour but never restyle', emitted.every(t => tokens.has(t)), emitted.filter(t => !tokens.has(t)));
  check('a colour for a chapter beats the national one, which beats the default',
    brand.resolveBrand({ chapter: { brandColor: '#166534' }, global: { brandColor: '#1D4ED8' } }) === '#166534'
    && brand.resolveBrand({ chapter: { brandColor: '' }, global: { brandColor: '#1D4ED8' } }) === '#1D4ED8'
    && brand.resolveBrand({ chapter: { brandColor: 'nope' }, global: {} }) === '#0B1A43');

  console.log('\n== no purple left in what people see ==');
  const hsl = (r, g, b) => { r /= 255; g /= 255; b /= 255; const M = Math.max(r, g, b), m = Math.min(r, g, b), l = (M + m) / 2; let h = 0, s = 0; if (M !== m) { const d = M - m; s = l > 0.5 ? d / (2 - M - m) : d / (M + m); h = M === r ? (g - b) / d + (g < b ? 6 : 0) : M === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; } return [h, s, l]; };
  const purple = (r, g, b) => { const [h, s] = hsl(r, g, b); return h >= 255 && h <= 330 && s > 0.12; };
  const listing = (dir, ext) => fs.readdirSync(path.join(ROOT, dir)).filter(f => f.endsWith(ext)).map(f => path.join(dir, f));
  const checked = [...listing('public', '.html'), ...listing('public/css', '.css'), ...listing('public/js', '.js'), 'site/styles.css', ...listing('site', '.html'), 'public/manifest.json', 'lib/pdf.js'];
  const found = [];
  for (const f of checked) {
    read(f).split('\n').forEach((line, i) => {
      if (/instagram/i.test(line)) return; // Instagram's own pink
      for (const m of line.matchAll(/#([0-9a-f]{6})\b/gi)) { const v = parseInt(m[1], 16); if (purple(v >> 16, (v >> 8) & 255, v & 255)) found.push(`${f}:${i + 1} ${m[0]}`); }
      for (const m of line.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) if (purple(+m[1], +m[2], +m[3])) found.push(`${f}:${i + 1} ${m[0]}`);
    });
  }
  check('no purple or lilac colour in any page, stylesheet, script, manifest or report', found.length === 0, found.slice(0, 6));
  const oldNames = checked.filter(f => /--(purple|lilac)-/.test(read(f)));
  check('and no variable is still named after the old colour', oldNames.length === 0, oldNames);
  check('style.css carries the default palette as its own fallback (run node scripts/sync-brand-css.js if not)',
    (() => { try { execFileSync('node', [path.join(ROOT, 'scripts', 'sync-brand-css.js'), '--check']); return true; } catch (e) { return false; } })());
  const pages = listing('public', '.html').filter(f => !/offline\.html$/.test(f));
  const unthemed = pages.filter(f => { const t = read(f); const a = t.search(/href="\/css\/style\.css/); const b = t.indexOf('href="/theme.css"'); return !(a >= 0 && b > a && /src="\/js\/brand\.js"/.test(t) && /name="theme-color" content="#0B1A43"/.test(t)); });
  check(`every page (${pages.length}) loads /theme.css after style.css, loads brand.js, and has the navy browser-bar colour`, unthemed.length === 0, unthemed);
  const manifest = JSON.parse(read('public/manifest.json'));
  check('the installed app\'s splash and bar are the navy too', manifest.theme_color === '#0B1A43' && manifest.background_color === '#0B1A43');

  console.log('\n== the real app ==');
  process.env.MONGODB_URI = 'mongodb://stub/aconsu_brand';
  process.env.PORT = '4352';
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'admin123';
  process.env.SESSION_SECRET = 'test';
  process.env.LOGIN_RATE_LIMIT_MAX = '300';
  delete process.env.SHEPHERD_USERNAME;
  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4352';
  const jars = {};
  async function call(jar, method, p, body, headers) {
    const h = { ...(headers || {}) };
    if (jars[jar]) h.cookie = jars[jar];
    let payload;
    if (body) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + p, { method, headers: h, body: payload });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (sc.length) jars[jar] = sc.map(c => c.split(';')[0]).join('; ');
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  for (const [id, name] of [['knust', 'ACONSU-KNUST'], ['ucc', 'ACONSU-UCC']]) await call('admin', 'POST', '/api/national/chapters', { id, name, institution: name });
  const fd = new FormData();
  fd.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
  Object.entries({ name: 'Ucc Admin', email: 'brand1@test.com', password: 'secret123', chapterId: 'ucc', consent: 'true' }).forEach(([k, v]) => fd.append(k, v));
  const memberId = (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd })).json()).member.id;
  let r = await call('admin', 'POST', '/api/admin/staff', { username: 'admin.u', name: 'Ucc Admin', role: 'chapterAdmin', password: 'password1234', memberId, chapterId: 'ucc' });
  check('a chapter admin exists for ACONSU-UCC', r.status === 200, r.data);
  await call('admin.u', 'POST', '/api/portal/login', { username: 'admin.u', password: 'password1234' });

  r = await call('anon', 'GET', '/theme.css');
  check('with nothing chosen, /theme.css is the default navy, as a stylesheet anyone can fetch',
    r.status === 200 && /text\/css/.test(r.headers.get('content-type')) && /--brand-deep: #0B1A43;/.test(r.data), r.status);
  check('and is checked with the server every time, so a new colour shows at once', /no-cache/.test(r.headers.get('cache-control') || ''), r.headers.get('cache-control'));
  r = await call('anon', 'GET', '/api/settings');
  check('the settings every page loads say which colour applies', r.data.brandColor === '#0B1A43', r.data.brandColor);

  console.log('\n== the national admin chooses the union\'s colour ==');
  r = await call('admin', 'PUT', '/api/admin/settings', { brandColor: '#1D4ED8' });
  check('they save #1D4ED8', r.status === 200, r.data);
  r = await call('anon', 'GET', '/theme.css');
  check('/theme.css now carries it', /--brand-deep: #1D4ED8;/.test(r.data) && /--action: #1D4ED8;/.test(r.data), r.data.slice(0, 120));
  r = await call('anon', 'GET', '/api/settings');
  check('and so do the settings', r.data.brandColor === '#1D4ED8', r.data.brandColor);
  r = await call('admin', 'PUT', '/api/admin/settings', { brandColor: 'blue' });
  check('something that is not a colour is refused with a plain message', r.status === 400 && /#0B1A43/.test(r.data.error), r.data);
  r = await call('anon', 'GET', '/theme.css');
  check('and the saved colour is untouched', /--brand-deep: #1D4ED8;/.test(r.data));
  r = await call('admin', 'PUT', '/api/admin/settings', { brandColor: '1d4ed8' });
  check('a colour without the # is refused rather than guessed at', r.status === 400, r.status);
  r = await call('admin', 'PUT', '/api/admin/settings', { brandColor: '#abcdef' });
  r = await call('anon', 'GET', '/theme.css');
  check('lower case is accepted and stored upper case', /--brand-deep: #[0-9A-F]{6};/.test(r.data) && !/#abcdef/.test(r.data));
  await call('admin', 'PUT', '/api/admin/settings', { brandColor: '#1D4ED8' });

  console.log('\n== a chapter chooses its own ==');
  r = await call('admin.u', 'PUT', '/api/admin/chapter-settings', { brandColor: '#166534' });
  check('ACONSU-UCC\'s own admin saves green', r.status === 200 && r.data.item.brandColor === '#166534', r.data);
  r = await call('anon', 'GET', '/theme.css?chapter=ucc');
  check('/theme.css for that chapter is green', /--brand-deep: #166534;/.test(r.data));
  r = await call('anon', 'GET', '/theme.css', null, { 'X-Chapter-Id': 'ucc' });
  check('and the chapter header asks for the same thing', /--brand-deep: #166534;/.test(r.data));
  r = await call('anon', 'GET', '/theme.css?chapter=knust');
  check('another chapter that has chosen nothing still gets the national colour', /--brand-deep: #1D4ED8;/.test(r.data));
  r = await call('anon', 'GET', '/api/settings', null, { 'X-Chapter-Id': 'ucc' });
  check('the settings for that chapter say green', r.data.brandColor === '#166534', r.data.brandColor);
  r = await call('admin.u', 'GET', '/api/admin/chapter-settings');
  check('the chapter admin\'s page can say what "use the national colour" would give', r.data.nationalBrandColor === '#1D4ED8' && r.data.brandColor === '#166534', r.data);
  r = await call('admin.u', 'PUT', '/api/admin/chapter-settings', { brandColor: 'not a colour' });
  check('a chapter cannot save something that is not a colour either', r.status === 400, r.data);
  r = await call('admin.u', 'PUT', '/api/admin/chapter-settings', { brandColor: '' });
  r = await call('anon', 'GET', '/theme.css?chapter=ucc');
  check('clearing it hands the chapter back to the national colour', r.status === 200 && /--brand-deep: #1D4ED8;/.test(r.data));
  await call('admin.u', 'PUT', '/api/admin/chapter-settings', { brandColor: '#166534' });
  for (const odd of ['../etc/passwd', 'x'.repeat(500), 'no-such-chapter', '%00']) {
    r = await call('anon', 'GET', '/theme.css?chapter=' + encodeURIComponent(odd));
    if (!(r.status === 200 && /--brand-deep: #1D4ED8;/.test(r.data))) { check('a strange chapter name is answered with the national colour, never an error', false, { odd: odd.slice(0, 20), status: r.status }); break; }
  }
  check('a strange chapter name is answered with the national colour, never an error', true);

  console.log('\n== the picker\'s preview ==');
  r = await call('anon', 'GET', '/api/brand/preview?color=%23166534');
  check('only someone who runs a chapter can use it', r.status === 401 || r.status === 403, r.status);
  r = await call('admin.u', 'GET', '/api/brand/preview?color=%23FFEB3B');
  check('a too-light colour is reported as adjusted, with the colour it becomes', r.status === 200 && r.data.adjusted === true && r.data.brand !== '#FFEB3B' && r.data.requested === '#FFEB3B', r.data.brand);
  check('and gives the stylesheet to preview, the checks it passed, and the suggestions to offer',
    /--brand-deep:/.test(r.data.css) && r.data.ok === true && r.data.pairs.length >= 12 && r.data.presets[0].hex === '#0B1A43' && r.data.presets.every(p => /^#[0-9A-F]{6}$/.test(p.hex)), r.data.presets);
  r = await call('admin.u', 'GET', '/api/brand/preview?color=nope');
  check('a bad colour is refused', r.status === 400, r.data);
  r = await call('admin.u', 'GET', '/api/brand/preview');
  check('with none given it describes the default', r.status === 200 && r.data.brand === '#0B1A43' && r.data.adjusted === false, r.data.brand);

  console.log('\n== what the colour reaches ==');
  r = await call('anon', 'GET', '/api/verse-styles', null, { 'X-Chapter-Id': 'ucc' });
  const brandStyle = (r.data.styles || []).find(s => s.value === 'brand');
  check('the verse card\'s first background is the chapter\'s own colour', r.data.defaultStyle === 'brand' && brandStyle && /#166534/.test(brandStyle.swatch), brandStyle);
  const verse = 'verse=' + encodeURIComponent('The Lord is my shepherd') + '&reference=' + encodeURIComponent('Psalm 23:1');
  const card = async (extra, headers) => Buffer.from(await (await fetch(BASE + '/api/verse-image?' + verse + extra, { headers })).arrayBuffer());
  const greenCard = await card('&style=brand', { 'X-Chapter-Id': 'ucc' });
  const blueCard = await card('&style=brand', { 'X-Chapter-Id': 'knust' });
  check('the card is drawn in the chapter\'s colour: a different chapter\'s card differs', !greenCard.equals(blueCard));
  const oldName = await card('&style=purple', { 'X-Chapter-Id': 'ucc' });
  check('a link that still says "purple" gets the app-colour card rather than an error', oldName.equals(greenCard));

  console.log(failures ? `\n${failures} FAILURES` : '\nall brand checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
