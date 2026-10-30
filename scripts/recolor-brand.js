// Recolours the union's picture files from the old purple to the app's navy
// (lib/brand.js DEFAULT_BRAND), leaving the flame, the torch and everything that
// is not purple or magenta as it was.
//
//   node scripts/recolor-brand.js            list what would change
//   node scripts/recolor-brand.js --write    recolour them, keeping each original in design/brand-original/ (except the large launch splashes)
//
// Each pixel is moved by how purple it is, so the edges of the lettering stay
// smooth. Dark purple becomes dark navy, light lilac becomes light blue, and
// the light-to-dark order is kept, so the emblem reads exactly as it did.
// Originals are kept so the change can be undone: copy one back over its file (the large launch
// splash pictures are not copied; see design/brand-original/README.md).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const KEEP = path.join(ROOT, 'design', 'brand-original');
const SKIP = /node_modules|[\\/]\.git[\\/]|[\\/]\.idea[\\/]|docs[\\/]design-system[\\/]screens|design[\\/]brand-original/;
// The old purple #5B2C82 (hue 273, saturation .49, lightness .34) must land exactly on the
// navy #0B1A43 (hue 224, saturation .72, lightness .15): the icon's flat background has to
// match the manifest's colour, and test/smoke.js checks that it does.
const OLD_H = 272.79, TARGET_HUE = 223.93;
const OLD_L = 0.34118, NEW_L = 0.15294;
const SAT_GAIN = 1.4526;

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const l = (max + min) / 2;
  let h = 0; let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0); else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s; const x = c * (1 - Math.abs(((h / 60) % 2) - 1)); const m = l - c / 2;
  let r = 0; let g = 0; let b = 0; h = ((h % 360) + 360) % 360;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// How purple a colour is, 0 to 1.
function purpleness(h, s) {
  const hue = smooth(238, 256, h) * (1 - smooth(334, 346, h));
  return hue * smooth(0.08, 0.2, s);
}
function recolourPixel(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b);
  const w = purpleness(h, s);
  if (w <= 0) return [r, g, b];
  const nl = l <= OLD_L ? l * (NEW_L / OLD_L) : NEW_L + (l - OLD_L) * ((1 - NEW_L) / (1 - OLD_L));
  const nh = TARGET_HUE + (h - OLD_H) * 0.25;
  const ns = Math.min(0.9, s * SAT_GAIN);
  const [nr, ng, nb] = hslToRgb(nh, ns, nl);
  return [r + (nr - r) * w, g + (ng - g) * w, b + (nb - b) * w];
}

async function purpleShare(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let seen = 0; let hit = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] < 40) continue;
    seen += 1;
    const [h, s] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (purpleness(h, s) > 0.5) hit += 1;
  }
  return seen ? hit / seen : 0;
}

async function recolour(file) {
  const img = sharp(file);
  const meta = await img.metadata();
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b] = recolourPixel(data[i], data[i + 1], data[i + 2]);
    data[i] = Math.round(r); data[i + 1] = Math.round(g); data[i + 2] = Math.round(b);
  }
  let out = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
  // A picture that had no transparency keeps none (the Play Store insists on it).
  if (!meta.hasAlpha) out = out.removeAlpha();
  if (meta.format === 'jpeg') return out.flatten({ background: '#ffffff' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  return out.png({ compressionLevel: 9, palette: !!meta.paletteBitDepth, quality: 95 }).toBuffer();
}

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (SKIP.test(p + path.sep) || SKIP.test(p)) continue;
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out); else if (/\.(png|jpe?g)$/i.test(f)) out.push(p);
  }
  return out;
}

(async () => {
  const write = process.argv.includes('--write');
  const threshold = 0.15; // pictures of the emblem and its artwork; a photograph with a purple shirt in it stays as it is
  const rows = [];
  for (const file of walk(ROOT)) {
    // A file done before is judged, and redone, from the original kept for it.
    const backup = path.join(KEEP, path.relative(ROOT, file));
    const share = await purpleShare(fs.existsSync(backup) ? backup : file).catch(() => 0);
    if (share >= threshold) rows.push([file, share]);
  }
  rows.sort((a, b) => b[1] - a[1]);
  for (const [file, share] of rows) {
    const rel = path.relative(ROOT, file);
    if (!write) { console.log(`${(share * 100).toFixed(1).padStart(5)}%  ${rel}`); continue; }
    const backup = path.join(KEEP, rel);
    if (!fs.existsSync(backup)) { fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.copyFileSync(file, backup); }
    fs.writeFileSync(file, await recolour(backup));
    console.log(`recoloured ${rel}`);
  }
  console.log(`${rows.length} file${rows.length === 1 ? '' : 's'} ${write ? 'recoloured' : 'would change'}.`);
})();
