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

   It only ever makes things smaller, and it only ever looks at one thing:
   whether the photo is wider than the page displays it. Anything already
   narrow enough is left exactly as it was, however many times this runs.
--------------------------------------------------------------------------- */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Defaults to the site's own images, but takes a directory so the test suite
// can run it over a throwaway copy rather than the real folder.
const DIR = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'images');
const MAX_WIDTH = 1600;       // nothing is displayed wider than this

async function shrink(dir, file) {
  const full = path.join(dir, file);
  const before = fs.statSync(full).size;
  const meta = await sharp(full).metadata();

  // The only question this tool asks is whether the photo is wider than the
  // page ever displays it. Nothing else.
  //
  // That is what makes it safe to run on every push: one pass brings a file
  // to exactly MAX_WIDTH, so every pass after it finds nothing to do, and the
  // file is never re-encoded a second time. Deciding on FILE SIZE instead
  // looks more thorough and is not idempotent - a photo that stays above
  // whatever size threshold you pick comes back every single run, gives up
  // another slice of quality, and is committed again. That is not a thought
  // experiment: the first real photographs went 202KB -> 200KB and
  // 259KB -> 255KB on a run that should have found nothing to do, and a
  // deliberately incompressible test file kept losing 13% a pass.
  if ((meta.width || 0) <= MAX_WIDTH) return null;

  let pipeline = sharp(full).rotate();   // honour the phone's orientation tag
  if ((meta.width || 0) > MAX_WIDTH) pipeline = pipeline.resize({ width: MAX_WIDTH });

  // Keep the format. Converting a PNG with transparency to JPEG would put a
  // black box behind a logo.
  if (meta.format === 'png') pipeline = pipeline.png({ compressionLevel: 9, palette: true });
  else if (meta.format === 'webp') pipeline = pipeline.webp({ quality: 82 });
  else pipeline = pipeline.jpeg({ quality: 82, mozjpeg: true });

  const out = await pipeline.toBuffer();

  // Only write if it actually helped. A wide file that was already squeezed
  // very hard can come back bigger, and a pointless commit is still a commit.
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
