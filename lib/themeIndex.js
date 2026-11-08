// One live theme per month, and only that.
//
// The first version of the monthly theme (October 2026) made the month itself
// unique: one theme record per month, whatever its state. Every version since
// allows several records for a month (a chapter's proposal waiting, one that
// was declined, National's own) and keeps only one of them LIVE. But MongoDB
// keeps an index until it is told to drop it, and Mongoose never drops one, so
// a database made by that first version still has the old rule. There a month
// that already holds any record - a chapter's proposal, a declined one - takes
// no other: National's own theme for it is refused as a duplicate, and the
// portal can only say "Could not save the theme".
//
// This puts the right rule in place and takes the old one away. It deletes no
// record. Safe to run on every start: when it is already done, it changes
// nothing.

const models = require('./models');

const onMonthAlone = (i) => i.key && Object.keys(i.key).length === 1 && i.key.month === 1;
// The right rule, whatever it was named: a build that ran before it had a name
// of its own made it as plain month_1.
const isOneLivePerMonth = (i) => onMonthAlone(i) && i.unique && i.partialFilterExpression
  && i.partialFilterExpression.status === 'approved' && Object.keys(i.partialFilterExpression).length === 1;
const isOldRule = (i) => onMonthAlone(i) && i.unique && !i.partialFilterExpression;

async function oneLiveThemePerMonth({ dryRun = false, log = console.log } = {}) {
  const collection = models.MonthlyTheme.collection;
  if (!collection || typeof collection.indexes !== 'function') return 'skipped';
  const indexes = await collection.indexes().catch((e) => (e && e.codeName === 'NamespaceNotFound' ? [] : Promise.reject(e)));
  const old = indexes.filter(isOldRule);
  const ready = indexes.some(isOneLivePerMonth);
  if (!old.length && ready) return 'ready';
  if (dryRun) {
    log(`Monthly theme: would replace ${old.map((i) => i.name).join(', ') || 'nothing'} with ${models.THEME_MONTH_INDEX}.`);
    return 'would change';
  }
  // The new rule first where the server allows two on the same field, so there
  // is no moment with neither; otherwise the old one goes first, briefly.
  const make = () => collection.createIndex({ month: 1 }, {
    unique: true, name: models.THEME_MONTH_INDEX, partialFilterExpression: { status: 'approved' }
  });
  if (!ready) {
    try { await make(); } catch (e) {
      if (!old.length) throw e;
      for (const i of old) await collection.dropIndex(i.name);
      await make();
      log(`Monthly theme: replaced ${old.map((i) => i.name).join(', ')} with ${models.THEME_MONTH_INDEX}.`);
      return 'changed';
    }
  }
  for (const i of old) await collection.dropIndex(i.name);
  log(`Monthly theme: one live theme per month${old.length ? `; the old one-record-per-month rule (${old.map((i) => i.name).join(', ')}) removed` : ' in place'}.`);
  return 'changed';
}

module.exports = { oneLiveThemePerMonth };
