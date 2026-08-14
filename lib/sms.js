const models = require('./models');
const repo = require('./repo');

// ---------- SMS sending (mNotify) ----------
// mNotify is a Ghanaian bulk-SMS provider, so delivery to MTN/Telecel/AT numbers
// is direct and cheap. Everything provider-specific is confined to sendBatch()
// below — swapping providers later only means rewriting that one function.
//
// Nothing here ever throws into the caller: if SMS isn't configured, or the
// provider is down, the send is logged as skipped/failed and the app carries on.

const MNOTIFY_ENDPOINT = 'https://apps.mnotify.net/smsapi';

function isConfigured() {
  return !!(process.env.MNOTIFY_API_KEY && process.env.SMS_SENDER_ID);
}

// Ghanaian numbers get typed in every possible way — 024..., 0244 123 456,
// +233 24..., 233 24... — so normalise everything to the 233XXXXXXXXX form the
// provider expects before sending, and drop anything that can't be one.
function normalizeGhanaNumber(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `233${digits.slice(1)}`;
  if (digits.length === 9) digits = `233${digits}`; // typed without the leading 0
  if (!/^233\d{9}$/.test(digits)) return '';
  return digits;
}

function uniqueNumbers(list) {
  const seen = new Set();
  (list || []).forEach((raw) => {
    const n = normalizeGhanaNumber(raw);
    if (n) seen.add(n);
  });
  return [...seen];
}

async function logSms(to, body, status, detail, sourceId) {
  try {
    await repo.create('smsLogs', { to, body, status, detail: detail || '', sourceId: sourceId || '' }, 'sms');
  } catch (e) { /* logging must never break a send */ }
}

// Sends one message to many recipients. Returns a plain summary the portal can
// display directly, never a provider-shaped object.
async function sendBatch(recipients, message, sourceId) {
  const numbers = uniqueNumbers(recipients);
  if (!numbers.length) {
    return { sent: 0, failed: 0, skipped: 0, configured: isConfigured(), note: 'No valid phone numbers in this audience.' };
  }
  if (!isConfigured()) {
    // Still log, so publicity can see exactly who *would* have been messaged
    // once credentials are added — the audience work isn't wasted.
    await Promise.all(numbers.map((n) => logSms(n, message, 'skipped', 'SMS is not configured on the server', sourceId)));
    return {
      sent: 0, failed: 0, skipped: numbers.length, configured: false,
      note: 'SMS is not configured yet — set MNOTIFY_API_KEY and SMS_SENDER_ID on the server.'
    };
  }

  const params = new URLSearchParams({
    key: process.env.MNOTIFY_API_KEY,
    to: numbers.join(','),
    msg: message,
    sender_id: process.env.SMS_SENDER_ID
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(`${MNOTIFY_ENDPOINT}?${params.toString()}`, { signal: controller.signal });
    clearTimeout(timeout);
    const text = (await res.text()).trim();

    // mNotify's SMS API answers with a bare status code: 1000 means accepted,
    // anything else is an error code documented on their dashboard.
    const accepted = res.ok && /^1000/.test(text);
    await Promise.all(numbers.map((n) => logSms(n, message, accepted ? 'sent' : 'failed', text.slice(0, 200), sourceId)));

    if (!accepted) {
      return { sent: 0, failed: numbers.length, skipped: 0, configured: true, note: `Provider rejected the batch (${text.slice(0, 60)}).` };
    }
    return { sent: numbers.length, failed: 0, skipped: 0, configured: true, note: '' };
  } catch (e) {
    await Promise.all(numbers.map((n) => logSms(n, message, 'failed', e.message, sourceId)));
    return { sent: 0, failed: numbers.length, skipped: 0, configured: true, note: `Could not reach the SMS provider: ${e.message}` };
  }
}

// ---------- audience resolution ----------
// 'all'                  → every member with a usable phone number
// 'department:<id>'      → members whose department matches
// Visitor records kept by shepherding are included too, since they're often the
// people most worth reaching about an upcoming service.
async function resolveAudience(audience) {
  const members = await models.Member.find({}).lean();
  const key = audience || 'all';

  let selected = members;
  if (key.startsWith('department:')) {
    const deptId = key.slice('department:'.length);
    selected = members.filter((m) => m.department === deptId);
  }

  const numbers = selected.map((m) => m.phone).filter(Boolean);

  if (key === 'all') {
    const visitors = await models.ShepherdingRecord.find({ memberId: '' }).lean();
    visitors.forEach((v) => { if (v.phone) numbers.push(v.phone); });
  }
  return uniqueNumbers(numbers);
}

module.exports = { sendBatch, resolveAudience, isConfigured, normalizeGhanaNumber, uniqueNumbers };
