// The words over a header picture: whatever the picture, they can be read, an
// admin can choose their colour, and the preview says what visitors will see.
//
//   node test/hero-look.js     (also run by `npm test`)
const fs = require('fs');
const path = require('path');
require('./harness.js');
const HT = require('../public/js/hero-tone.js');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`  ok   ${label}`);
  else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 300)}` : ''}`); }
}

(async () => {
  console.log('\n== automatic: any picture, readable words ==');
  let worst = 99; let allOk = true;
  for (let luma = 0; luma <= 255; luma += 5) {
    const p = HT.plan({ luma });
    worst = Math.min(worst, p.ratio);
    if (!p.ok) allOk = false;
  }
  check('from black to white pictures, the automatic choice always reaches 4.5:1', allOk && worst >= 4.5, worst);
  const dark = HT.plan({ luma: 40 });
  const bright = HT.plan({ luma: 235 });
  check('a dark picture gets white words', dark.ink === '#FFFFFF', dark.ink);
  check('a bright picture gets dark words, or a heavy veil under white ones, and either way reads', bright.ok, bright);
  check('a picture that is already easy to read is barely veiled', dark.veilPercent <= 25, dark.veilPercent);
  check('with nothing known about the picture, it plans for a middling one and still reads', HT.plan({}).ok && HT.plan({ luma: null }).ok);

  console.log('\n== an admin\'s own choices ==');
  const gold = HT.plan({ luma: 60, textColor: '#F4C430' });
  check('a chosen colour is used exactly', gold.ink === '#F4C430' && !gold.auto, gold.ink);
  const badInk = HT.plan({ luma: 60, textColor: '#0B1220', veil: 0 });
  check('dark words on a dark picture with no veil are reported as hard to read, with the ratio', !badInk.ok && badInk.ratio < 4.5, badInk.ratio);
  check('and a fix is offered: a light veil that makes them read', badInk.canFix && badInk.veilKind === 'light' && HT.plan({ luma: 60, textColor: '#0B1220', veil: badInk.fixVeil }).ok, badInk);
  const grey = HT.plan({ luma: 128, textColor: '#808080', veil: 0 });
  check('a colour no veil can rescue says so, and suggests white or dark instead', !grey.ok && !grey.canFix && /^#/.test(grey.suggestedInk), grey);
  check('the veil is clamped to 0 to 85', HT.plan({ luma: 100, veil: 500 }).veilPercent === 85 && HT.plan({ luma: 100, veil: -5 }).veilPercent === 0);
  check('anything that is not #RRGGBB is treated as automatic', ['red', '#12', 'javascript:1', '#GGGGGG', 42].every(c => HT.plan({ luma: 90, textColor: c }).auto));
  check('a button filled with the text colour gets a label that reads on it', HT.contrast(gold.ink, gold.on) >= 4.5, [gold.ink, gold.on]);

  console.log('\n== in the pages ==');
  const home = read('public/index.html');
  check('the home banner is no longer dimmed by a fixed filter that left the dark heading on it', !/filter:\s*brightness\(0\.45\)/.test(home));
  const css = read('public/css/style.css');
  check('the header\'s words, veil and buttons follow the chosen colour', /\[data-hero-look\] \.hero-content > h1/.test(css) && /--hero-veil/.test(css) && /btn-primary \{ background: var\(--hero-ink\)/.test(css));
  check('and only the header\'s own words: nothing inside the cards in it is recoloured', !/\[data-hero-look\] \.hero-content (h1|p|\.lede)\b/.test(css.replace(/\.hero-content > /g, '')) || /\.hero-content > p/.test(css));
  const adminJs = read('public/js/admin.js');
  check('the Media Library previews every picture before it is sent', /uploadPreviewImg/.test(adminJs) && /syncUploadPreview/.test(adminJs));
  check('a header upload waits for its preview, and asks before sending words that would be hard to read', /preview is still measuring/.test(adminJs) && /hard to read/.test(adminJs));
  check('the Admin and Chapter Admin pages both load the control', /hero-look\.js/.test(read('public/admin.html')) && /hero-look\.js/.test(read('public/chapter.html')));

  console.log('\n== the real app ==');
  process.env.MONGODB_URI = 'mongodb://stub/aconsu_herolook';
  process.env.PORT = '4353';
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'admin123';
  process.env.SESSION_SECRET = 'test';
  process.env.LOGIN_RATE_LIMIT_MAX = '300';
  delete process.env.SHEPHERD_USERNAME;
  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4353';
  const jars = {};
  async function call(jar, method, p, body, headers, isForm) {
    const h = { ...(headers || {}) };
    if (jars[jar]) h.cookie = jars[jar];
    let payload;
    if (body && !isForm) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); } else if (body) payload = body;
    const res = await fetch(BASE + p, { method, headers: h, body: payload });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (sc.length) jars[jar] = sc.map(c => c.split(';')[0]).join('; ');
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: res.status, data };
  }
  const sharp = require('sharp');
  const png = await sharp({ create: { width: 64, height: 40, channels: 3, background: { r: 20, g: 30, b: 60 } } }).png().toBuffer();
  const upload = (placement, extra) => {
    const fd = new FormData();
    fd.append('file', new Blob([png], { type: 'image/png' }), 'h.png');
    fd.append('placement', placement); fd.append('category', 'photo');
    Object.entries(extra || {}).forEach(([k, v]) => fd.append(k, v));
    return call('admin', 'POST', '/api/admin/uploads', fd, null, true);
  };
  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  await call('admin', 'POST', '/api/national/chapters', { id: 'knust', name: 'ACONSU-KNUST', institution: 'KNUST' });

  let r = await upload('home-header', { textColor: '#f4c430', veil: '35', chapterId: 'knust' });
  check('a home banner uploads with the colour and the veil chosen', r.status === 200 && r.data.success, r.data);
  r = await call('anon', 'GET', '/api/settings', null, { 'X-Chapter-Id': 'knust' });
  check('visitors are told the colour (upper case) and the veil', r.data.homeHeader && r.data.homeHeader.textColor === '#F4C430' && r.data.homeHeader.veil === 35, r.data.homeHeader);

  r = await call('admin', 'PUT', '/api/admin/hero-look', { target: 'home-header', textColor: '#FFFFFF', veil: null, chapterId: 'knust' });
  check('the look can be changed later without uploading again', r.status === 200 && r.data.look.textColor === '#FFFFFF' && r.data.look.veil === null, r.data);
  r = await call('anon', 'GET', '/api/settings', null, { 'X-Chapter-Id': 'knust' });
  check('and automatic (no colour, no veil) is what is stored when nothing is chosen', r.data.homeHeader.textColor === '#FFFFFF' && r.data.homeHeader.veil === null);
  r = await call('admin', 'PUT', '/api/admin/hero-look', { target: 'home-header', textColor: 'not a colour', chapterId: 'knust' });
  check('something that is not a colour is refused', r.status === 400, r.data);
  r = await call('admin', 'PUT', '/api/admin/hero-look', { target: 'home-header', textColor: '', veil: 900, chapterId: 'knust' });
  check('a veil above 85 is held at 85', r.status === 200 && r.data.look.veil === 85 && r.data.look.textColor === '', r.data);
  r = await call('admin', 'PUT', '/api/admin/hero-look', { target: 'nonsense', chapterId: 'knust' });
  check('an unknown header is refused', r.status === 400, r.data);
  r = await call('anon', 'PUT', '/api/admin/hero-look', { target: 'home-header' });
  check('and only someone who manages content can change it', r.status === 401 || r.status === 403, r.status);

  r = await upload('page-hero', { targetId: 'bible', textColor: '#0b1220', veil: '', tone: 'light', chapterId: 'knust' });
  check('a page\'s own artwork uploads with its look', r.status === 200, r.data);
  r = await call('anon', 'GET', '/api/settings', null, { 'X-Chapter-Id': 'knust' });
  check('and the page\'s settings carry it', r.data.heroArt.bible && r.data.heroArt.bible.textColor === '#0B1220' && r.data.heroArt.bible.veil === null, r.data.heroArt);
  r = await call('admin', 'PUT', '/api/admin/hero-look', { target: 'bible', textColor: '#FFFFFF', veil: 20, tone: 'dark', chapterId: 'knust' });
  r = await call('anon', 'GET', '/api/settings', null, { 'X-Chapter-Id': 'knust' });
  check('a page\'s artwork can be restyled without replacing the picture', r.data.heroArt.bible.textColor === '#FFFFFF' && r.data.heroArt.bible.veil === 20 && r.data.heroArt.bible.tone === 'dark', r.data.heroArt.bible);
  r = await call('admin', 'GET', '/api/admin/image-placements?chapterId=knust');
  check('the Media Library is told each header\'s current look', r.data.homeHeader && r.data.homeHeader.fileId && (r.data.heroPages.find(p => p.id === 'bible') || {}).textColor === '#FFFFFF', r.data.homeHeader);

  console.log('\n== the banner in Chapter Settings ==');
  const banner = (extra) => {
    const fd = new FormData();
    fd.append('image', new Blob([png], { type: 'image/png' }), 'b.png');
    Object.entries(extra || {}).forEach(([k, v]) => fd.append(k, v));
    return call('admin', 'POST', '/api/admin/chapter-settings/banner?chapterId=knust', fd, null, true);
  };
  r = await banner({ textColor: '#ffd700', veil: '50' });
  check('the Chapter Settings banner upload keeps the colour and veil chosen with it', r.status === 200 && r.data.item.homeHeader && r.data.item.homeHeader.textColor === '#FFD700' && r.data.item.homeHeader.veil === 50, r.data);
  r = await banner({});
  check('an upload that says nothing about colour leaves the chosen look as it was', r.status === 200 && r.data.item.homeHeader.textColor === '#FFD700', r.data.item && r.data.item.homeHeader);
  const adminSrc = read('public/js/admin.js');
  check('Chapter Settings previews the banner with the words over it, and can save the colour on its own',
    /chapterBannerLook/.test(adminSrc) && /saveChapterBannerLookBtn/.test(adminSrc) && /Nothing is uploaded until you press Upload New Banner/.test(adminSrc));

  console.log(failures ? `\n${failures} FAILURES` : '\nall hero-look checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
