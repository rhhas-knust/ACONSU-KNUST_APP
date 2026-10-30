// Phone numbers, as people type them. Ghanaian numbers arrive in every form -
// 024..., 0244 123 456, +233 24..., 233 24... - and are all one number: the
// 233XXXXXXXXX form, which is what SMS is sent to (lib/sms.js) and what a
// member signs in with. Anything that cannot be a Ghanaian mobile number gives
// '' here: it is kept as typed on the profile, but nobody signs in with it.
//
// No other requires, so the schemas (lib/models.js) can use it too.

function ghanaKey(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `233${digits.slice(1)}`;
  if (digits.length === 9) digits = `233${digits}`; // typed without the leading 0
  if (!/^233\d{9}$/.test(digits)) return '';
  return digits;
}

// Something that looks like a phone number rather than an email address:
// what the sign-in box decides by.
const looksLikePhone = (raw) => !String(raw || '').includes('@') && /\d{6,}/.test(String(raw || '').replace(/[\s()+-]/g, ''));

module.exports = { ghanaKey, looksLikePhone };
