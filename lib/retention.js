// How long the app keeps things nobody needs for ever, and the daily job that
// clears what is older. The privacy page states these same numbers.
//
// Each can be changed in the environment (in days); 0 keeps that kind for
// ever. The defaults are long enough to look back over a full academic year.
//
// What is NOT here is kept until somebody deletes it, or the person erases
// their account: money (the books must add up), Sunday registers, care
// records, prayer requests and the rest of a member's own records.

const models = require('./models');
const { withLock } = require('./jobLock');

const DAY = 24 * 60 * 60 * 1000;

const RULES = [
  { model: 'Notification', env: 'RETAIN_NOTIFICATIONS_DAYS', days: 365, what: 'notifications in the app' },
  { model: 'SmsLog', env: 'RETAIN_SMS_LOG_DAYS', days: 365, what: 'the record of texts sent' },
  { model: 'ChatMessage', env: 'RETAIN_CHAT_DAYS', days: 730, what: 'chat messages' },
  { model: 'ContactMessage', env: 'RETAIN_CONTACT_MESSAGES_DAYS', days: 365, what: 'messages sent through the contact form' }
];

// The number of days for one rule: the environment's whole number if it has
// one (0 = keep for ever), otherwise the default.
function daysFor(rule, env = process.env) {
  const raw = String(env[rule.env] == null ? '' : env[rule.env]).trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  return rule.days;
}

function policy(env = process.env) {
  return RULES.map((r) => ({ what: r.what, days: daysFor(r, env), setting: r.env }));
}

// Deletes what is older than its rule allows. Returns how many of each.
async function sweep(env = process.env, now = new Date()) {
  const removed = {};
  for (const rule of RULES) {
    const days = daysFor(rule, env);
    if (!days) continue;
    const before = new Date(now.getTime() - days * DAY);
    const r = await models[rule.model].deleteMany({ createdAt: { $lte: before } });
    removed[rule.model] = r.deletedCount || 0;
  }
  return removed;
}

// The scheduled run: once a day is plenty, and only one copy of the app does it.
async function runDaily(env = process.env) {
  const out = await withLock('retention', 30 * 60 * 1000, () => sweep(env));
  if (out.ran) {
    const total = Object.values(out.result).reduce((a, b) => a + b, 0);
    if (total) console.log(`Retention: removed ${Object.entries(out.result).filter(([, n]) => n).map(([m, n]) => `${n} ${m}`).join(', ')}`);
  }
  return out;
}

module.exports = { RULES, policy, sweep, runDaily, daysFor };
