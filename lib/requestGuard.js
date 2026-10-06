// Small, pure guards for what arrives in a request. Kept here, away from the
// routes, so each one can be tested on its own and then relied on everywhere.

// MongoDB treats an object whose keys start with "$" as an operator. A login
// that does findOne({ email }) and is sent {"email": {"$ne": null}} is no longer
// asking for one address, it is asking for "anyone", and the same goes for any
// query-string value (?category[$ne]=x is parsed into exactly that shape) and
// for multipart field names like name[$ne]. A key with a "." in it is a path
// into a nested field, which does the same kind of damage to an update.
//
// No honest form in this app sends either, so the rule is blunt on purpose:
// a request carrying one is refused outright rather than cleaned and passed on.
function hasOperatorKey(value, depth = 0) {
  if (value === null || typeof value !== 'object' || depth > 8) return false;
  if (Array.isArray(value)) return value.some((v) => hasOperatorKey(v, depth + 1));
  return Object.keys(value).some((key) => key.startsWith('$') || key.includes('.') || hasOperatorKey(value[key], depth + 1));
}

function rejectOperatorKeys(req, res, next) {
  if (hasOperatorKey(req.body) || hasOperatorKey(req.query) || hasOperatorKey(req.params)) {
    return res.status(400).json({ error: 'That request could not be understood.' });
  }
  return next();
}

// A base URL for links that are sent OUT of the app, in emails. It must never
// be built from the Host header: that is whatever the sender of the request
// typed, so asking for a password reset for somebody else with "Host: evil.example"
// would mail them a reset link to evil.example and hand over the account when they
// click it. The address comes from configuration; only a developer's machine,
// where there is nothing to protect, falls back to the request.
function publicBaseUrl(req, env = process.env) {
  const configured = String(env.PUBLIC_BASE_URL || env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
  if (/^https?:\/\/[^\s/]+$/i.test(configured)) return configured;
  if (env.NODE_ENV === 'production') return '';   // refuse to guess; the caller says so
  return `${req.protocol}://${req.get('host')}`;
}

// Comparing a secret with === stops at the first byte that differs, and how long
// that takes can be measured. Comparing two fixed-length digests takes the same
// time whatever was typed.
const crypto = require('crypto');
function safeEqual(a, b) {
  const da = crypto.createHash('sha256').update(String(a == null ? '' : a)).digest();
  const db = crypto.createHash('sha256').update(String(b == null ? '' : b)).digest();
  return crypto.timingSafeEqual(da, db);
}

// A spreadsheet runs a cell that begins with = + - @ (or a tab or return) as a
// formula. A "payee" of =HYPERLINK(...) in an exported ledger would run on the
// treasurer's computer when they open it. A leading apostrophe makes it text.
function csvSafe(value) {
  const s = value === undefined || value === null ? '' : String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

// Browsers deliver a push to an address the BROWSER VENDOR runs, and the server
// then POSTs to whatever address was stored. Accepting any URL here would let
// anyone make this server send requests to any host it can reach - including its
// own internal network. So only the push services browsers actually use.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/i,
  /^android\.googleapis\.com$/i,
  /^updates\.push\.services\.mozilla\.com$/i,
  /^[a-z0-9-]+\.push\.services\.mozilla\.com$/i,
  /^[a-z0-9.-]+\.notify\.windows\.com$/i,
  /^web\.push\.apple\.com$/i,
  /^[a-z0-9-]+\.push\.apple\.com$/i
];
function isPushEndpoint(value) {
  if (typeof value !== 'string' || value.length > 1000) return false;
  let url;
  try { url = new URL(value); } catch (e) { return false; }
  return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
    && PUSH_HOSTS.some((re) => re.test(url.hostname));
}

module.exports = { hasOperatorKey, rejectOperatorKeys, publicBaseUrl, safeEqual, csvSafe, isPushEndpoint };
