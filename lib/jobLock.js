// One instance at a time for a scheduled job.
//
// Render can run two copies of the app for a moment (a deploy overlapping the
// old one), and could run more one day. A job that deletes old records must
// not run in both at once, so it takes a lock in the database first: a
// SystemState row per job, with a time the lock lapses by itself, so a copy
// that crashes mid-job never holds it for ever.
//
// Taking it is one atomic update ("set lockedUntil, but only if it has
// lapsed"), so of two copies asking together exactly one gets it.

const crypto = require('crypto');
const models = require('./models');

// This process, as the lock records it.
const HOLDER = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;

async function withLock(name, ttlMs, fn) {
  const singleton = `lock:${name}`;
  // The row exists before anyone takes it; a second copy creating it at the
  // same moment is refused by the unique index, which is fine.
  if (!await models.SystemState.findOne({ singleton }).lean()) {
    await models.SystemState.create({ singleton, lockedUntil: null, lockHolder: '' }).catch(() => {});
  }
  const now = new Date();
  const got = await models.SystemState.findOneAndUpdate(
    { singleton, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] },
    { $set: { lockedUntil: new Date(now.getTime() + ttlMs), lockHolder: HOLDER } },
    { new: true }
  ).lean();
  if (!got || got.lockHolder !== HOLDER) return { ran: false };
  try {
    return { ran: true, result: await fn() };
  } finally {
    await models.SystemState.updateOne({ singleton, lockHolder: HOLDER }, { $set: { lockedUntil: null, lockHolder: '' } }).catch(() => {});
  }
}

module.exports = { withLock, HOLDER };
