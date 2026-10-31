// The app's brand colour, and everything the stylesheet derives from it.
//
// An admin picks ONE colour (the national admin for the whole union, a chapter
// admin for their own chapter). paletteFor() turns it into the full set of
// colour tokens public/css/style.css reads, for the light and the dark theme,
// and checks every text-on-background pair on the way: a colour that is too
// light to carry white button text is darkened until it can, and the answer
// says so (`adjusted`), so the picker can tell the admin instead of silently
// shipping something unreadable.
//
// style.css carries the default palette as its own fallback; test/brand.js
// fails if the two ever drift apart.

const DEFAULT_BRAND = '#0B1A43';

// Colours offered as one-tap choices in the picker. The first is the default.
const PRESETS = [
  { name: 'Midnight navy', hex: '#0B1A43' },
  { name: 'Royal blue', hex: '#1D4ED8' },
  { name: 'Teal', hex: '#0F766E' },
  { name: 'Forest green', hex: '#166534' },
  { name: 'Burgundy', hex: '#7F1D1D' },
  { name: 'Violet', hex: '#5B2C82' },
  { name: 'Charcoal', hex: '#27272A' }
];

const HEX = /^#[0-9a-fA-F]{6}$/;
const isHex = (v) => typeof v === 'string' && HEX.test(v.trim());
const normalise = (v) => (isHex(v) ? v.trim().toUpperCase() : null);

// ---------- colour maths ----------
function toRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0; let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0; let g = 0; let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const la = luminance(a); const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Moves `hex` lighter (dir +1) or darker (-1) until it reaches `min` contrast
// against every colour in `against`. Same hue and saturation throughout.
function reach(hex, against, min, dir) {
  const list = Array.isArray(against) ? against : [against];
  const [h, s, l0] = rgbToHsl(...toRgb(hex));
  let l = l0;
  let out = hex;
  for (let i = 0; i < 120; i += 1) {
    if (list.every((bg) => contrast(out, bg) >= min)) return out;
    l += dir * 0.01;
    if (l < 0 || l > 1) break;
    out = hslToHex(h, s, l);
  }
  return list.every((bg) => contrast(out, bg) >= min) ? out : (dir > 0 ? '#FFFFFF' : '#000000');
}

// ---------- the palette ----------
// Text on a surface needs 4.5:1 (WCAG 2.2 AA). Buttons and the header carry
// white text, so the brand colour itself must reach that against white.
const MIN_TEXT = 4.5;

function paletteFor(input) {
  const requested = normalise(input) || DEFAULT_BRAND;
  const [h0, s0] = rgbToHsl(...toRgb(requested));
  // A grey or a black has no hue of its own: keep the tints neutral rather
  // than inventing one.
  const neutral = s0 < 0.06;
  const h = h0;
  const tint = (s) => (neutral ? 0 : Math.min(s, s0 || s));

  // The deep brand colour: white text must be readable on it.
  const deep = reach(requested, '#FFFFFF', 5, -1);
  const adjusted = deep !== requested;
  const [, ds, dl] = rgbToHsl(...toRgb(deep));
  const rich = hslToHex(h, ds, Math.max(0.04, dl * 0.62));
  const ink = hslToHex(h, neutral ? 0 : ds * 0.55, Math.max(0.035, Math.min(dl * 0.4, 0.09)));

  // ----- light -----
  const surface = '#FFFFFF';
  const bg = hslToHex(h, tint(0.6), 0.985);
  const surface2 = hslToHex(h, tint(0.5), 0.958);
  const surface3 = hslToHex(h, tint(0.42), 0.93);
  const tintMid = hslToHex(h, tint(0.45), 0.87);
  const rowHover = hslToHex(h, tint(0.55), 0.975);
  const muteBg = hslToHex(h, tint(0.35), 0.925);
  const lightBgs = [surface, bg, surface2, surface3, muteBg, rowHover];
  const inkLight = reach(hslToHex(h, tint(0.45), 0.1), lightBgs, 12, -1);
  const inkSoft = reach(hslToHex(h, tint(0.3), 0.27), lightBgs, 7, -1);
  const inkFaint = reach(hslToHex(h, tint(0.2), 0.38), lightBgs, MIN_TEXT, -1);
  const heading = reach(hslToHex(h, tint(0.4), 0.09), lightBgs, 12, -1);
  const brand = reach(deep, lightBgs, 7, -1);
  const brandStrong = reach(rich, lightBgs, 7, -1);
  const muteInk = reach(hslToHex(h, tint(0.3), 0.33), [muteBg], MIN_TEXT, -1);
  const actionHover = dl < 0.22 ? hslToHex(h, ds, dl + 0.07) : hslToHex(h, ds, dl - 0.06);

  // ----- dark -----
  const dBg = hslToHex(h, tint(0.45), 0.07);
  const dSurface = hslToHex(h, tint(0.4), 0.115);
  const dSurface2 = hslToHex(h, tint(0.38), 0.155);
  const dSurface3 = hslToHex(h, tint(0.36), 0.2);
  const dTintMid = hslToHex(h, tint(0.35), 0.25);
  const dRowHover = hslToHex(h, tint(0.38), 0.135);
  const darkBgs = [dBg, dSurface, dSurface2, dSurface3, dRowHover];
  const dInk = reach(hslToHex(h, tint(0.5), 0.94), darkBgs, 12, 1);
  const dInkSoft = reach(hslToHex(h, tint(0.35), 0.8), darkBgs, 7, 1);
  const dInkFaint = reach(hslToHex(h, tint(0.25), 0.7), darkBgs, MIN_TEXT, 1);
  const dHeading = reach(hslToHex(h, tint(0.55), 0.93), darkBgs, 12, 1);
  const dBrand = reach(hslToHex(h, neutral ? 0 : Math.min(Math.max(ds, 0.5), 0.8), 0.74), darkBgs, 7, 1);
  const dBrandStrong = reach(hslToHex(h, neutral ? 0 : Math.min(Math.max(ds, 0.5), 0.85), 0.85), darkBgs, 9, 1);
  const dAction = hslToHex(h, neutral ? 0 : Math.min(Math.max(ds, 0.5), 0.8), 0.8);
  const dActionInk = reach(hslToHex(h, neutral ? 0 : 0.5, 0.1), [dAction], 7, -1);
  const dActionHover = hslToHex(h, neutral ? 0 : Math.min(Math.max(ds, 0.5), 0.85), 0.88);
  const dMuteInk = reach(hslToHex(h, tint(0.3), 0.78), [dSurface3], MIN_TEXT, 1);

  const [r, g, b] = toRgb(deep);
  const light = {
    '--brand-deep': deep, '--brand-rich': rich, '--brand-ink': ink,
    '--brand-rgb': `${r}, ${g}, ${b}`,
    '--brand-ink-rgb': toRgb(ink).join(', '),
    '--tint-light': surface2, '--tint-mid': tintMid, '--paper': bg,
    '--bg': bg, '--surface': surface, '--surface-2': surface2, '--surface-3': surface3,
    '--ink': inkLight, '--ink-soft': inkSoft, '--ink-faint': inkFaint, '--heading': heading,
    '--brand': brand, '--brand-strong': brandStrong,
    '--header-bg': '#FFFFFF',
    '--art-veil': `rgba(${toRgb(bg).join(',')},0.82)`,
    '--action': deep, '--action-ink': '#FFFFFF', '--action-hover': actionHover,
    '--mute-bg': muteBg, '--mute-ink': muteInk, '--row-hover': rowHover
  };
  const dark = {
    '--bg': dBg, '--surface': dSurface, '--surface-2': dSurface2, '--surface-3': dSurface3,
    '--ink': dInk, '--ink-soft': dInkSoft, '--ink-faint': dInkFaint, '--heading': dHeading,
    '--brand': dBrand, '--brand-strong': dBrandStrong,
    '--header-bg': dBg,
    '--art-veil': `rgba(${toRgb(dBg).join(',')},0.78)`,
    '--action': dAction, '--action-ink': dActionInk, '--action-hover': dActionHover,
    '--mute-bg': dSurface3, '--mute-ink': dMuteInk, '--row-hover': dRowHover,
    '--tint-light': dSurface2, '--tint-mid': dTintMid, '--paper': dBg
  };

  // The pairs the stylesheet actually draws, each with the ratio it must reach.
  const pairs = [
    ['white text on the brand colour (buttons, header)', '#FFFFFF', deep, 4.5],
    ['body text on the page', inkLight, bg, 4.5],
    ['body text on a card', inkLight, surface, 4.5],
    ['secondary text on a card', inkSoft, surface, 4.5],
    ['hint text on an inset panel', inkFaint, surface3, 4.5],
    ['links on a card', brand, surface, 4.5],
    ['links on the page', brand, bg, 4.5],
    ['muted chip text', muteInk, muteBg, 4.5],
    ['dark: body text on the page', dInk, dBg, 4.5],
    ['dark: secondary text on a card', dInkSoft, dSurface, 4.5],
    ['dark: hint text on an inset panel', dInkFaint, dSurface3, 4.5],
    ['dark: links on a card', dBrand, dSurface, 4.5],
    ['dark: button text', dActionInk, dAction, 4.5]
  ].map(([label, fg, back, min]) => ({ label, fg, bg: back, ratio: Math.round(contrast(fg, back) * 100) / 100, min, ok: contrast(fg, back) >= min }));

  return { requested, brand: deep, adjusted, neutral, light, dark, pairs, ok: pairs.every((p) => p.ok) };
}

const block = (selector, tokens) => `${selector} {\n${Object.entries(tokens).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}`;

// The stylesheet an admin's colour becomes. It only ever contains tokens the
// stylesheet already defines, so it can only recolour, never restyle.
function themeCss(input) {
  const p = paletteFor(input);
  return `/* Generated from the brand colour ${p.brand}. See lib/brand.js. */\n${block(':root', p.light)}\n${block(':root[data-theme="dark"]', p.dark)}\n`;
}

// Which brand colour applies: a chapter's own, else the national one, else the
// built-in default. Anything that is not a plain #RRGGBB is ignored.
function resolveBrand({ chapter, global } = {}) {
  return normalise(chapter && chapter.brandColor) || normalise(global && global.brandColor) || DEFAULT_BRAND;
}

module.exports = { DEFAULT_BRAND, PRESETS, isHex, normalise, paletteFor, themeCss, resolveBrand, contrast, luminance, hslToHex, rgbToHsl, toRgb };
