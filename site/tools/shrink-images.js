#!/usr/bin/env node
/* ---------------------------------------------------------------------------
   Shrinks anything oversized in site/images/, in place.

   A photo straight off a phone is 4-12MB and several thousand pixels wide.
   Nothing on this page is shown wider than about 1600px, so all that weight
   buys nothing and costs a visitor on campus data real money and real seconds
   - and the header photo is the first thing on the page, so nothing else
   appears until it has loaded.

   Nobody should have to remember to resize before uploading, so this runs on
   every push that touches site/images/ and commits the smaller file back.

   It only ever makes things smaller. If re-encoding would not save anything,
   the original is left exactly as it was.
--------------------------------------------------------------------------- */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Defaults to the site's own images, but takes a directory so the test suite
// can run it over a throwaway copy rather than the real folder.
const DIR = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'images');
const MAX_WIDTH = 1600;       // nothing is displayed wider than this
const LEAVE_ALONE_UNDER = 200 * 1024;  // already small enough to not be worth it

async function shrink(dir, file) {
  const full = path.join(dir, file);
  const before = fs.statSync(full).size;
  const meta = await sharp(full).metadata();

  // Small and narrow already: nothing to gain.
  if (before < LEAVE_ALONE_UNDER && (meta.width || 0) <= MAX_WIDTH) return null;

  let pipeline = sharp(full).rotate();   // honour the phone's orientation tag
  if ((meta.width || 0) > MAX_WIDTH) pipeline = pipeline.resize({ width: MAX_WIDTH });

  // Keep the format. Converting a PNG with transparency to JPEG would put a
  // black box behind a logo.
  if (meta.format === 'png') pipeline = pipeline.png({ compressionLevel: 9, palette: true });
  else if (meta.format === 'webp') pipeline = pipeline.webp({ quality: 82 });
  else pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true });

  const out = await pipeline.toBuffer();

  // Only write if it actually helped. Re-encoding an already-optimised file
  // can make it bigger, and a pointless commit is still a commit.
  if (out.length >= before) return null;
  fs.writeFileSync(full, out);
  return { file, before, after: out.length, width: meta.width, to: Math.min(meta.width || MAX_WIDTH, MAX_WIDTH) };
}

async function run(dir) {
  if (!fs.existsSync(dir)) { console.log('no images folder — nothing to do'); return []; }
  const files = fs.readdirSync(dir).filter(f => /\.(jpe?g|png|webp)$/i.test(f));
  const kb = (n) => Math.round(n / 1024) + 'KB';
  const done = [];
  let saved = 0;
  for (const f of files) {
    try {
      const r = await shrink(dir, f);
      if (r) {
        done.push(r);
        saved += r.before - r.after;
        console.log(`${r.file}: ${kb(r.before)} -> ${kb(r.after)}  (${r.width}px -> ${r.to}px)`);
      }
    } catch (e) {
      // A corrupt or unreadable file should not fail the whole run.
      console.log(`${f}: left alone (${e.message})`);
    }
  }
  console.log(saved ? `saved ${kb(saved)} in total` : 'everything was already small enough');
  return done;
}

module.exports = { run, MAX_WIDTH };

if (require.main === module) run(DIR);
