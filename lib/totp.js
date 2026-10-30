// Six-digit codes from an authenticator app (Google Authenticator, Microsoft
// Authenticator, Authy, 2FAS...): the second step a leader takes after their
// password. This is the standard (RFC 6238, the time-based one-time password,
// on RFC 4226), written here in a few lines on Node's own crypto rather than
// pulled in as a package, and checked against the RFC's own test values in
// test/second-step.js.
//
// The shared secret has to be readable again to check a code, so it is kept
// encrypted (AES-256-GCM) with a key derived from SESSION_SECRET: a copy of the
// database alone does not give anyone the leaders' codes. Changing
// SESSION_SECRET therefore means every leader sets their second step up again.
//
// Recovery codes, for a lost phone, are only ever kept hashed.

const crypto = require('crypto');

const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text) {
  const clean = String(text || '').toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0; let value = 0; const out = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('not base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

// RFC 4226: the code for one counter value.
function hotp(key, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = mac[mac.length - 1] & 15;
  const bin = ((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

const stepAt = (ms) => Math.floor(ms / 1000 / STEP_SECONDS);

function codeAt(secret, ms = Date.now()) {
  return hotp(base32Decode(secret), stepAt(ms));
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

// A code is accepted for the 30 seconds it is shown, and one step either side
// (a phone's clock a little out, or a slow tap). A step already used is never
// accepted again, so a code seen over someone's shoulder is worth nothing.
// Returns the step it matched, or 0.
function verify(secret, code, { lastStep = 0, now = Date.now() } = {}) {
  const given = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(given)) return 0;
  let key;
  try { key = base32Decode(secret); } catch (e) { return 0; }
  const here = stepAt(now);
  for (const step of [here - 1, here, here + 1]) {
    if (step <= lastStep) continue;
    const want = Buffer.from(hotp(key, step));
    if (crypto.timingSafeEqual(want, Buffer.from(given))) return step;
  }
  return 0;
}

// What the authenticator app reads from the QR code.
function otpauthUrl(secret, accountName, issuer = 'ACONSU') {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

// ---------------------------------------------------------- at rest --
function keyFrom(env = process.env) {
  return crypto.createHash('sha256').update(`aconsu-second-step:${env.SESSION_SECRET || 'dev_secret_change_me'}`).digest();
}

function seal(secret, env = process.env) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFrom(env), iv);
  const body = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64')).join('.');
}

function open(sealed, env = process.env) {
  try {
    const [iv, tag, body] = String(sealed || '').split('.').map((p) => Buffer.from(p, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFrom(env), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch (e) {
    return '';
  }
}

// ----------------------------------------------------- recovery codes --
// Ten, each good once: "7KQ2-MX4P". Kept as hashes; shown once, when made.
const hashRecovery = (code) => crypto.createHash('sha256').update(String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');

function makeRecoveryCodes(n = 10) {
  return Array.from({ length: n }, () => {
    const raw = base32Encode(crypto.randomBytes(5)).slice(0, 8);
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  });
}

module.exports = {
  STEP_SECONDS, base32Encode, base32Decode, hotp, codeAt, stepAt, generateSecret, verify, otpauthUrl,
  seal, open, hashRecovery, makeRecoveryCodes
};
