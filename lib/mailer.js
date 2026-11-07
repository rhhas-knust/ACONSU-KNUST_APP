// Email: password-reset links, onboarding, notices.
//
// Two ways to send, chosen by what is configured:
//  - Brevo's web API (BREVO_API_KEY), over ordinary HTTPS. Use this on
//    Render's free plan: since September 2025 free web services cannot open
//    the email ports (25, 465, 587), so SMTP from there times out every time.
//  - Any SMTP provider (SMTP_HOST, SMTP_USER, SMTP_PASS), on a paid instance
//    or another host.
// Neither set: email is simply not sent, and everything else still works.
// A failure is never thrown at the caller: it is returned, and logged, with
// the reason, so a test email (and the health report) can say what is wrong.
const nodemailer = require('nodemailer');

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
let transporter = null;
let smtpFor = '';

function via(env = process.env) {
  if (String(env.BREVO_API_KEY || '').trim()) return 'brevo';
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) return 'smtp';
  return '';
}

// "ACONSU <noreply@aconsu.org>" or a bare address, as MAIL_FROM is written.
function sender(env = process.env) {
  const raw = String(env.MAIL_FROM || env.SMTP_USER || '').trim();
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || 'ACONSU', email: m[2].trim() };
  return { name: 'ACONSU', email: raw };
}

function smtpTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  const key = [SMTP_HOST, SMTP_PORT, SMTP_USER].join('|');
  if (transporter && smtpFor === key) return transporter;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true' || Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    // Fail in seconds rather than minutes when the port is blocked.
    connectionTimeout: 15000,
    greetingTimeout: 10000
  });
  smtpFor = key;
  return transporter;
}

// What a failure means, in words a chapter admin can act on.
function explain(way, message) {
  const m = String(message || '');
  if (way === 'smtp' && /timeout|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EHOSTUNREACH/i.test(m)) {
    return `Could not reach the email server (${m}). On Render's free plan the email ports are blocked: set BREVO_API_KEY to send through Brevo's web API instead.`;
  }
  if (way === 'smtp' && /auth|535|534|Invalid login|Username and Password/i.test(m)) {
    return `The email server refused the login (${m}). Check SMTP_USER and SMTP_PASS: for Brevo, the SMTP login shown under SMTP & API and an SMTP key, not the API key.`;
  }
  if (way === 'brevo' && /401|unauthor|key not found|invalid api/i.test(m)) {
    return `Brevo refused the API key (${m}). Check BREVO_API_KEY: an API key from Brevo's SMTP & API page, starting xkeysib-.`;
  }
  if (way === 'brevo' && /sender|from/i.test(m)) {
    return `Brevo refused the sender (${m}). The address in MAIL_FROM must be a sender verified in Brevo (Senders, domains & dedicated IPs).`;
  }
  return m || 'Unknown error';
}

async function sendViaBrevo({ to, subject, html }) {
  const from = sender();
  if (!from.email) return { sent: false, error: 'Set MAIL_FROM to the sender address verified in Brevo, like ACONSU <noreply@yourdomain>.' };
  const res = await fetch(BREVO_URL, {
    method: 'POST',
    headers: { 'api-key': String(process.env.BREVO_API_KEY).trim(), 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: from, to: [{ email: to }], subject, htmlContent: html }),
    signal: AbortSignal.timeout(15000)
  });
  if (res.ok) return { sent: true };
  const body = await res.json().catch(() => ({}));
  throw new Error(`${res.status} ${body.code || ''} ${body.message || ''}`.replace(/\s+/g, ' ').trim());
}

async function sendMail({ to, subject, html }) {
  const way = via();
  if (!way || !to) return { sent: false, skipped: true };
  try {
    if (way === 'brevo') return await sendViaBrevo({ to, subject, html });
    const from = sender();
    await smtpTransport().sendMail({ from: from.name ? `${from.name} <${from.email}>` : from.email, to, subject, html });
    return { sent: true };
  } catch (e) {
    const error = explain(way, e && e.message);
    console.error(`Email send failed (${way}): ${error}`);
    return { sent: false, error, via: way };
  }
}

function isConfigured() {
  return !!via();
}

module.exports = { sendMail, isConfigured, via, sender, explain };
