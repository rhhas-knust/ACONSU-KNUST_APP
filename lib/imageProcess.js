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

module.exports = { compressIfImage };
