// What a stored file is, and what may be done with it on the way out.
//
// Files go into one shared store and come back out of one public address
// (/api/files/:id) on the same origin as the app itself. Two things follow:
//
//  1. A file served with a type that a browser runs (text/html, SVG, XML)
//     runs AS the app, with the signed-in person's rights. Anyone who could
//     upload one - and the public registration form takes a photo - could send an
//     administrator a link that acts as the administrator.
//  2. Some files are confidential: finance receipts, pastoral records, members'
//     own photos. They cannot be served to whoever asks.

// Only these are shown in the browser. Everything else downloads.
const INLINE_TYPE = /^(image\/(jpeg|png|gif|webp|avif)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|application\/pdf)$/i;

// The first bytes of a file say what it is, whatever the uploader called it.
function sniff(buffer) {
  if (!buffer || buffer.length < 12) return '';
  const b = buffer;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b.slice(1, 4).toString() === 'PNG') return 'image/png';
  if (b.slice(0, 3).toString() === 'GIF') return 'image/gif';
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (b.slice(0, 5).toString() === '%PDF-') return 'application/pdf';
  return '';
}

const baseType = (t) => String(t || '').split(';')[0].trim().toLowerCase();

// What to record as a file's type when it is stored: what it provably is when
// that can be told, and otherwise what it was said to be.
function storedType(buffer, claimed) {
  return sniff(buffer) || baseType(claimed) || 'application/octet-stream';
}

// How to send a stored file: its own type and inline when that is safe, and as
// an opaque download when it is not.
function servingFor(claimed) {
  const type = baseType(claimed);
  if (INLINE_TYPE.test(type)) return { contentType: type, inline: true };
  return { contentType: 'application/octet-stream', inline: false };
}

// Files only certain people may open. Anything not named here is a picture or
// document the public pages themselves display.
const PRIVATE_CATEGORIES = ['receipt', 'shepherding', 'member-profile'];
const isPrivateCategory = (c) => PRIVATE_CATEGORIES.includes(String(c || ''));

module.exports = { INLINE_TYPE, sniff, storedType, servingFor, PRIVATE_CATEGORIES, isPrivateCategory, baseType };
