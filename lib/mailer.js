const nodemailer = require('nodemailer');

let transporter = null;
let configured = false;

function ensureConfigured() {
  if (configured) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null; // email just won't send — everything else still works

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true' || Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  configured = true;
  return transporter;
}

async function sendMail({ to, subject, html }) {
  const t = ensureConfigured();
  if (!t || !to) return { sent: false, skipped: true };
  try {
    await t.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to, subject, html
    });
    return { sent: true };
  } catch (e) {
    console.error('Email send failed:', e.message);
    return { sent: false, error: e.message };
  }
}

function isConfigured() {
  return !!ensureConfigured();
}

module.exports = { sendMail, isConfigured };
