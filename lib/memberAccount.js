// Start-up work for members signing up with a phone number instead of an
// email address (Phase 5). Both steps only add; neither deletes a record.
//
//   1. The email index. It used to make an email address compulsory: every
//      account needed one, and a second account without one was refused as a
//      duplicate. It becomes "one account per email address, among accounts
//      that have one". The old index is replaced by the new one; nothing else
//      changes, and putting the old one back would undo it.
//   2. phoneKey on accounts made before it existed, so they can sign in with
//      their phone number too.
//
// Safe to run on every start: when both are already done, it changes nothing.
// scripts/member-accounts.js runs the same, with a dry run, by hand.

const models = require('./models');
const phone = require('./phone');

async function optionalEmailIndex({ dryRun = false, log = console.log } = {}) {
  const collection = models.Member.collection;
  if (!collection || typeof collection.indexes !== 'function') return 'skipped';
  const indexes = await collection.indexes().catch((e) => (e && e.codeName === 'NamespaceNotFound' ? [] : Promise.reject(e)));
  const old = indexes.filter((i) => i.key && i.key.email === 1 && i.unique && !i.partialFilterExpression);
  const ready = indexes.some((i) => i.name === models.MEMBER_EMAIL_INDEX);
  if (!old.length && ready) return 'ready';
  if (dryRun) {
    log(`Would replace ${old.map((i) => i.name).join(', ') || 'nothing'} with ${models.MEMBER_EMAIL_INDEX}.`);
    return 'would change';
  }
  // The new one first where the server allows two on the same field, so there
  // is no moment without one; otherwise the old one goes first, briefly.
  const make = () => collection.createIndex({ email: 1 }, {
    unique: true, name: models.MEMBER_EMAIL_INDEX, partialFilterExpression: { email: { $gt: '' } }
  });
  if (!ready) {
    try { await make(); } catch (e) {
      for (const i of old) await collection.dropIndex(i.name);
      await make();
      log(`Member email: replaced ${old.map((i) => i.name).join(', ')} with ${models.MEMBER_EMAIL_INDEX}.`);
      return 'changed';
    }
  }
  for (const i of old) await collection.dropIndex(i.name);
  log(`Member email: ${models.MEMBER_EMAIL_INDEX} in place${old.length ? `, ${old.map((i) => i.name).join(', ')} removed` : ''}.`);
  return 'changed';
}

async function backfillPhoneKeys({ dryRun = false, log = console.log } = {}) {
  const missing = await models.Member.find({ phone: { $nin: ['', null] }, $or: [{ phoneKey: { $exists: false } }, { phoneKey: null }] }).lean();
  const todo = missing.map((m) => ({ id: m.id, phoneKey: phone.ghanaKey(m.phone) }));
  if (dryRun) { log(`Would set the phone key on ${todo.length} account(s).`); return todo.length; }
  for (const t of todo) await models.Member.updateOne({ id: t.id }, { $set: { phoneKey: t.phoneKey } });
  if (todo.length) log(`Member phone keys set on ${todo.length} account(s).`);
  return todo.length;
}

async function prepare(opts) {
  const index = await optionalEmailIndex(opts);
  const phones = await backfillPhoneKeys(opts);
  return { index, phones };
}

module.exports = { prepare, optionalEmailIndex, backfillPhoneKeys };
