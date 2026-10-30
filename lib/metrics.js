// Counting, never watching. How many times something happened on a day: a
// share tapped, a sign-up started. A count is all that is kept. No member id,
// no address, no device, no cookie: a row says "share:event, 2026-11-02, 14"
// and nothing more, so it cannot be traced back to anyone.
//
// The National Health panel (routes/health-panel.js) reads these beside
// totals worked out from the records themselves.

const models = require('./models');

// What may be counted. Anything else is ignored rather than stored, so the
// table can never be filled with keys somebody made up.
const KEYS = new Set([
  'share:event', 'share:sermon', 'share:prayer', 'share:verse', 'share:invite',
  'signup:started'
]);

const today = (d = new Date()) => d.toISOString().slice(0, 10);

async function count(key, day = today()) {
  if (!KEYS.has(key)) return false;
  await models.Metric.findOneAndUpdate({ key, day }, { $inc: { count: 1 } }, { upsert: true, new: true });
  return true;
}

// The day rows from `from` to `to` (YYYY-MM-DD, inclusive): { key, day, count }.
async function rows(from, to) {
  const found = await models.Metric.find({ day: { $gte: from, $lte: to } }).lean();
  return found.filter((r) => r.day >= from && r.day <= to).map((r) => ({ key: r.key, day: r.day, count: r.count || 0 }));
}

// Totals per key over the same days.
async function totals(from, to) {
  const out = {};
  (await rows(from, to)).forEach((r) => { out[r.key] = (out[r.key] || 0) + r.count; });
  return out;
}

module.exports = { KEYS, count, rows, totals, today };
