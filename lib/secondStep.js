// Who must take a second step at sign-in, and how strictly, and what happens
// to an account that keeps getting its password wrong.
//
// The second step is a six-digit code from an authenticator app (lib/totp.js).
// It is asked of every leadership account that can reach money, welfare,
// shepherding, coordinator or national records: the accounts worth stealing.
// Anyone else may turn it on for themselves.
//
// Rolled out gently. Until ENFORCE_LEADER_2FA is switched on, nobody is made
// to: the portal only asks. Once it is on, each leader who must have it gets
// 14 days (from the day it was switched on, or from when their account was
// made, whichever is later), with a banner counting down. After that, signing
// in still works, but opens only the screen where they set it up. Nobody is
// locked out on the day it is switched on, and sessions already open carry on.

const positions = require('./positions');

const GRACE_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;
const ALWAYS = new Set(['nationalCoordinator', 'coordinator', 'chapterAdmin', 'finance', 'shepherding', 'welfare']);
const C = positions.CAPABILITIES;
const MONEY = [C.FINANCE_SUMMARY, C.FINANCE_LEDGER, C.TREASURY_REPORT];

function requiredFor(account) {
  if (!account) return false;
  if (ALWAYS.has(account.role)) return true;
  if (account.role === 'executive') {
    const position = positions.positionByKey(account.positionKey);
    return !!position && MONEY.some((cap) => positions.hasCapability(position, cap));
  }
  return false;
}

const enforced = (env = process.env) => /^(1|true|on|yes)$/i.test(String(env.ENFORCE_LEADER_2FA || '').trim());

// Where an account stands. `since` is when enforcement was switched on.
function standing(account, { since = null, now = Date.now(), env = process.env } = {}) {
  const required = requiredFor(account);
  const enrolled = !!(account && account.totpEnabledAt);
  const on = enforced(env) && !!since;
  let deadline = null;
  if (required && on && !enrolled) {
    const start = Math.max(new Date(since).getTime(), new Date((account && account.createdAt) || since).getTime());
    deadline = new Date(start + GRACE_DAYS * DAY);
  }
  const daysLeft = deadline ? Math.max(0, Math.ceil((deadline.getTime() - now) / DAY)) : null;
  return {
    required, enrolled, enforced: on,
    deadline, daysLeft,
    mustSetUpNow: !!deadline && deadline.getTime() <= now,
    recoveryCodesLeft: enrolled ? ((account && account.totpRecoveryHashes) || []).length : 0
  };
}

// ---------------------------------------------------------- lockout --
// Five wrong tries in a row and the account rests: a minute, then two, four,
// eight... up to an hour, doubling with each wrong try after the fifth. This is
// on top of the per-address limit, so a guesser moving between addresses is
// still slowed. A right password (and second step) clears it.
const FREE_TRIES = 5;
const MAX_LOCK_MS = 60 * 60 * 1000;

function afterWrongTry(account, now = Date.now()) {
  const failed = ((account && account.failedSignIns) || 0) + 1;
  const over = failed - FREE_TRIES;
  const lockedUntil = over >= 0 ? new Date(now + Math.min(MAX_LOCK_MS, 60 * 1000 * 2 ** over)) : null;
  return { failedSignIns: failed, lockedUntil };
}

function lockedFor(account, now = Date.now()) {
  const until = account && account.lockedUntil ? new Date(account.lockedUntil).getTime() : 0;
  return until > now ? Math.ceil((until - now) / 60000) : 0;
}

// A leader account as it may be shown to anyone, the holder included: never
// the password hash, the sealed secret or the recovery hashes; instead, whether
// the second step is on and whether the account is resting after wrong tries.
const SECRET_FIELDS = ['passwordHash', 'totpSecretEnc', 'totpPendingEnc', 'totpRecoveryHashes', 'totpLastStep'];
function safeAccount(account) {
  if (!account) return account;
  const out = { ...account };
  SECRET_FIELDS.forEach((k) => delete out[k]);
  out.secondStepOn = !!account.totpEnabledAt;
  out.lockedMinutes = lockedFor(account);
  return out;
}

module.exports = { GRACE_DAYS, requiredFor, enforced, standing, afterWrongTry, lockedFor, FREE_TRIES, SECRET_FIELDS, safeAccount };
