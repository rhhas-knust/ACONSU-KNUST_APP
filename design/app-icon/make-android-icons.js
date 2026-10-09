/* Makes the Android launcher icons from the ACONSU logo.

   Run it again whenever the logo changes:
       node design/app-icon/make-android-icons.js

   Reads  public/images/logo.jpg
   Writes the launcher icons into android/app/src/main/res/mipmap-* and the
          Play Store icon to design/play-store/icon-512.png

   Android 8 and newer draw an "adaptive" icon: a 108dp picture of which only
   the middle 72dp ever shows, cut to whatever shape the phone uses (circle,
   rounded square, squircle). So the logo is not stretched across the whole
   picture: it is sized so that its furthest corner still lands inside the
   circle. Anything bigger would have the bottom corners of the book cut off on
   a phone with round icons.
   Android 7 and older draw the legacy icon files as they are. */
'use strict';
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..', '..');
const LOGO = path.join(ROOT, 'public', 'images', 'logo.jpg');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const PLAY = path.join(ROOT, 'design', 'play-store', 'icon-512.png');

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
// pixels per dp at each density
const DENSITY = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

// How far from the centre of the logo picture its furthest ink reaches, as a
// fraction of half the picture's width. Measured, not guessed: it is about 1.24
// for this logo, because the book's base runs out to the bottom corners.
async function reach() {
  const { data, info } = await sharp(LOGO).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  let far = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * c;
      if (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235) far = Math.max(far, Math.hypot(x - w / 2, y - h / 2));
    }
  }
  return far / (w / 2);
}

// The logo, square, at a given pixel size, on its own white.
const logoAt = (px) => sharp(LOGO).resize(px, px, { fit: 'cover' }).flatten({ background: WHITE }).png().toBuffer();

// A logo picture centred on a square canvas of `canvas` pixels.
async function centred(canvas, logoPx, background) {
  return sharp({ create: { width: canvas, height: canvas, channels: 4, background } })
    .composite([{ input: await logoAt(logoPx), gravity: 'centre' }])
    .png().toBuffer();
}

(async () => {
  const k = await reach();   // furthest ink / half the logo width
  // Furthest ink may reach this far from the middle of the visible circle (dp).
  // The circle is 36dp in radius; 1dp is left for a launcher that nudges things.
  const inkRadiusDp = 35;
  const adaptiveLogoDp = (inkRadiusDp / k) * 2;           // width of the logo picture on the 108dp canvas
  const legacyRoundLogoDp = (21.5 / k) * 2;               // 48dp round icon: radius 24, a little margin
  const legacySquareLogoDp = 41;                          // 48dp rounded square

  for (const [name, d] of Object.entries(DENSITY)) {
    const dir = path.join(RES, 'mipmap-' + name);
    const canvas = Math.round(108 * d);

    // adaptive foreground: the logo in the middle of a transparent 108dp canvas.
    // The picture's own white matches the adaptive background (white) exactly.
    await sharp(await centred(canvas, Math.round(adaptiveLogoDp * d), { r: 0, g: 0, b: 0, alpha: 0 }))
      .toFile(path.join(dir, 'ic_launcher_foreground.png'));

    // legacy square: white rounded square with the logo
    const sq = Math.round(48 * d);
    const radius = Math.round(9 * d);
    const mask = Buffer.from(`<svg width="${sq}" height="${sq}"><rect width="${sq}" height="${sq}" rx="${radius}" fill="#fff"/></svg>`);
    await sharp(await centred(sq, Math.round(legacySquareLogoDp * d), WHITE))
      .composite([{ input: mask, blend: 'dest-in' }]).png()
      .toFile(path.join(dir, 'ic_launcher.png'));

    // legacy round: white disc with the logo
    const disc = Buffer.from(`<svg width="${sq}" height="${sq}"><circle cx="${sq / 2}" cy="${sq / 2}" r="${sq / 2}" fill="#fff"/></svg>`);
    await sharp(await centred(sq, Math.round(legacyRoundLogoDp * d), WHITE))
      .composite([{ input: disc, blend: 'dest-in' }]).png()
      .toFile(path.join(dir, 'ic_launcher_round.png'));
  }

  // Play Store: 512 x 512, 32-bit, no transparent pixels.
  await sharp(await centred(512, 460, WHITE)).flatten({ background: WHITE }).png().toFile(PLAY);

  console.log(`logo reaches ${k.toFixed(3)} x half its width; adaptive logo is ${adaptiveLogoDp.toFixed(1)}dp of 108dp`);
})().catch((e) => { console.error(e); process.exit(1); });
