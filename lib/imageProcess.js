const sharp = require('sharp');

const MAX_DIMENSION = 1600; // px, on the longest side — plenty for phone screens and web display
const JPEG_QUALITY = 80;

// Compresses/resizes an image buffer if it looks like an image; returns the
// original buffer untouched for anything else (PDFs, docs, etc.) so this is
// always safe to call regardless of what was uploaded.
async function compressIfImage(buffer, mimetype) {
  if (!mimetype || !mimetype.startsWith('image/')) {
    return { buffer, contentType: mimetype };
  }
  // Skip already-tiny files — not worth the CPU cost of re-encoding.
  if (buffer.length < 80 * 1024) {
    return { buffer, contentType: mimetype };
  }
  try {
    // A logo is usually a PNG with a transparent background, and JPEG has no
    // transparency to give it: converting one flattens the alpha away and the
    // mark arrives with a solid box behind it, on whatever colour the page
    // happens to be. So anything carrying transparency stays in a format that
    // can hold it, and only flat photographs become JPEG.
    const meta = await sharp(buffer).metadata();
    const pipeline = sharp(buffer)
      .rotate() // respect EXIF orientation before resizing
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true });

    if (meta.hasAlpha) {
      const output = await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer();
      return { buffer: output, contentType: 'image/png' };
    }

    const output = await pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer();
    return { buffer: output, contentType: 'image/jpeg' };
  } catch (e) {
    // If sharp can't process it for any reason, fall back to the original file
    // rather than failing the whole upload.
    return { buffer, contentType: mimetype };
  }
}

// For a photo handed in by somebody we do not know, from a public form.
// compressIfImage deliberately falls back to "keep the original" whenever it
// cannot make sense of a file, which is right for a member's own upload and
// wrong here: this must be a picture, or it is refused. It also always
// re-encodes, because the original carries the phone's EXIF block - including
// where the photo was taken - and none of that belongs on a public wall.
async function processPortrait(buffer) {
  const image = sharp(buffer, { failOn: 'none', limitInputPixels: 50_000_000 });
  const meta = await image.metadata(); // throws if this is not an image at all
  if (!meta.width || !meta.height) throw new Error('not an image');
  const out = await image
    .rotate() // honour EXIF orientation, then drop the EXIF
    .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }) // a PNG with transparency becomes a plain photo
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  return { buffer: out, contentType: 'image/jpeg' };
}

module.exports = { compressIfImage, processPortrait };
