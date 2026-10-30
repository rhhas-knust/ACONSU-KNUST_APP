// Six-digit codes sent by SMS: to sign in, to reset a password, to sign up
// without one (only where the chapter has its own SMS account), or to confirm
// it is you before downloading or deleting your data.
//
// Only a keyed hash of a code is kept (HMAC with SESSION_SECRET, so a copy of
// the database alone cannot be used to try all million codes). A code works
// for 10 minutes, once, and 5 wrong tries end it. No more than 3 codes go to
// one number in 15 minutes, or 10 in a day, whoever asks; the caller adds a
// limit per network on top (routes/phone-signin.js).

const crypto = require('crypto');
const models = require('./models');

const TTL_MS = 10 * 60 * 1000;
const MAX_TRIES = 5;
const PER_15_MIN = 3;
const PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const hash = (purpose, phoneKey, code) => crypto
  .createHmac('sha256', process.env.SESSION_SECRET || 'aconsu-dev-secret')
  .update(`${purpose}:${phoneKey}:${code}`).digest('hex');

// A new code for this number and purpose, replacing any earlier one. Returns
// { code } or { limited: minutes to wait }.
async function issue(phoneKey, purpose, now = Date.now()) {
  const doc = await models.PhoneCode.findOne({ phoneKey, purpose }).lean();
  const day = ((doc && doc.sends) || []).map((d) => new Date(d).getTime()).filter((t) => now - t < DAY_MS);
  const recent = day.filter((t) => now - t < 15 * 60 * 1000);
  if (recent.length >= PER_15_MIN) return { limited: Math.max(1, Math.ceil((Math.min(...recent) + 15 * 60 * 1000 - now) / 60000)) };
  if (day.length >= PER_DAY) return { limited: Math.max(1, Math.ceil((Math.min(...day) + DAY_MS - now) / 60000)) };
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await models.PhoneCode.findOneAndUpdate({ phoneKey, purpose }, {
    $set: {
      codeHash: hash(purpose, phoneKey, code), expiresAt: new Date(now + TTL_MS), attempts: 0,
      sends: [...day.map((t) => new Date(t)), new Date(now)], purgeAt: new Date(now + DAY_MS)
    }
  }, { upsert: true, new: true });
  return { code };
}

// Whether `code` is the live code for this number and purpose. A right code is
// used up there and then; a wrong one counts against the 5 tries.
// { ok: true } or { ok: false, reason: 'wrong' | 'tooMany' }.
async function verify(phoneKey, purpose, code, now = Date.now()) {
  const typed = String(code || '').replace(/\D/g, '');
  const doc = await models.PhoneCode.findOne({ phoneKey, purpose }).lean();
  if (!doc || !doc.codeHash || !doc.expiresAt || new Date(doc.expiresAt).getTime() < now) return { ok: false, reason: 'wrong' };
  if ((doc.attempts || 0) >= MAX_TRIES) return { ok: false, reason: 'tooMany' };
  const want = Buffer.from(doc.codeHash, 'hex');
  const got = Buffer.from(hash(purpose, phoneKey, typed), 'hex');
  if (typed.length === 6 && want.length === got.length && crypto.timingSafeEqual(want, got)) {
    // Used once: only the request that clears it gets in.
    const used = await models.PhoneCode.findOneAndUpdate({ phoneKey, purpose, codeHash: doc.codeHash }, { $set: { codeHash: '', expiresAt: null } });
    return used ? { ok: true } : { ok: false, reason: 'wrong' };
  }
  const after = await models.PhoneCode.findOneAndUpdate({ phoneKey, purpose }, { $inc: { attempts: 1 } }, { new: true });
  if (after && after.attempts >= MAX_TRIES) {
    await models.PhoneCode.findOneAndUpdate({ phoneKey, purpose }, { $set: { codeHash: '', expiresAt: null } });
    return { ok: false, reason: 'tooMany' };
  }
  return { ok: false, reason: 'wrong' };
}

const MESSAGES = {
  wrong: 'That code is not right, or it has expired. Check the text message, or ask for a new code.',
  tooMany: 'Too many wrong codes. Ask for a new one.'
};

// What the text message says. Short, so it is one SMS.
const text = (purpose, code) => ({
  signin: `ACONSU: your sign-in code is ${code}. It works for 10 minutes. Never share it.`,
  reset: `ACONSU: your code to choose a new password is ${code}. It works for 10 minutes. Never share it.`,
  signup: `ACONSU: your code to finish signing up is ${code}. It works for 10 minutes.`,
  confirm: `ACONSU: your code to confirm it is you is ${code}. It works for 10 minutes. Never share it.`
}[purpose]);

module.exports = { issue, verify, text, MESSAGES, TTL_MS, MAX_TRIES, PER_15_MIN, PER_DAY };
