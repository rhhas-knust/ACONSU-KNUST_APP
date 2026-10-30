// Signing in, and choosing a new password, with a code sent by SMS to the
// member's phone number (lib/smsCode.js). The code goes out through the
// member's own chapter's SMS account (lib/sms.js), or the shared one where a
// chapter has none; where neither is set up, the pages say so and offer the
// password instead.
//
// Asking for a code answers the same whether or not anyone has the number, so
// it cannot be used to find out who has an account. Nothing is sent unless
// someone does; a number from another country is never texted.

const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const phoneLib = require('../lib/phone');
const smsCode = require('../lib/smsCode');
const sms = require('../lib/sms');

const PURPOSES = ['signin', 'reset'];
const SENT = 'If an account has this number, a code is on its way. It works for 10 minutes.';

function registerPhoneSigninRoutes(app, deps) {
  const { models, rolesLib, freshSession, revokeMemberSessions, requireMember } = deps;
  const devConsole = () => process.env.NODE_ENV !== 'production';

  // Per network, on top of the per-number limits in lib/smsCode.js.
  const askLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: Number(process.env.SMS_CODE_LIMIT_MAX) || 10,
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many codes asked for from this network. Please wait a few minutes.' }
  });
  const tryLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: Number(process.env.SMS_CODE_TRY_LIMIT_MAX) || 30,
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many tries from this network. Please wait a few minutes.' }
  });

  // Sends the text, or (on a development machine) shows the code in the
  // console. Never the code in the SMS log.
  async function deliver(phoneKey, purpose, code, chapterId) {
    if (devConsole()) console.log(`[development only] ACONSU ${purpose} code for ${phoneKey}: ${code}`);
    return sms.sendBatch([phoneKey], smsCode.text(purpose, code), `code:${purpose}`, chapterId, { logAs: `ACONSU ${purpose} code (not kept)` });
  }

  // Whether this chapter's people can get codes, and whether they can sign up
  // with one instead of a password (only on the chapter's own SMS account).
  app.get('/api/auth/sms-status', async (req, res) => {
    try {
      const chapterId = String(req.query.chapterId || '') || rolesLib.getSoleActiveChapterId() || '';
      const config = await sms.resolveConfig(chapterId);
      res.json({ codes: !!config, phoneOnlySignup: !!(config && config.source === 'chapter') });
    } catch (e) { res.json({ codes: false, phoneOnlySignup: false }); }
  });

  app.post('/api/auth/sms/request', askLimiter, async (req, res) => {
    try {
      const purpose = String((req.body && req.body.purpose) || '');
      if (!PURPOSES.includes(purpose)) return res.status(400).json({ error: 'Unknown kind of code' });
      const phoneKey = phoneLib.ghanaKey(req.body.phone);
      if (!phoneKey) return res.status(400).json({ error: 'Type your Ghanaian phone number, like 024 412 3456.' });
      // Counted whoever has the number, so the limit says nothing about accounts.
      const issued = await smsCode.issue(phoneKey, purpose);
      if (issued.limited) return res.status(429).json({ error: `Too many codes for this number. Try again in ${issued.limited} minute${issued.limited === 1 ? '' : 's'}.` });
      const member = await models.Member.findOne({ phoneKey }).lean();
      // Sent after answering, so how long the answer takes says nothing either.
      if (member) setImmediate(() => deliver(phoneKey, purpose, issued.code, member.chapterId).catch(() => {}));
      res.json({ success: true, message: SENT });
    } catch (e) { res.status(500).json({ error: 'Could not send a code. Please try again, or use your password.' }); }
  });

  // The one account a number opens. Older accounts can share a number; a
  // code cannot choose between them.
  async function onlyAccount(phoneKey, res) {
    const members = await models.Member.find({ phoneKey }).lean();
    if (!members.length) { res.status(400).json({ error: smsCode.MESSAGES.wrong }); return null; }
    if (members.length > 1) { res.status(409).json({ error: 'More than one account has this number. Sign in with your email address and password instead, or ask your chapter admin to sort it out.' }); return null; }
    return members[0];
  }
  async function checked(req, res, purpose) {
    const phoneKey = phoneLib.ghanaKey(req.body && req.body.phone);
    if (!phoneKey) { res.status(400).json({ error: 'Type your Ghanaian phone number, like 024 412 3456.' }); return null; }
    const out = await smsCode.verify(phoneKey, purpose, req.body.code);
    if (!out.ok) { res.status(out.reason === 'tooMany' ? 429 : 400).json({ error: smsCode.MESSAGES[out.reason] }); return null; }
    return onlyAccount(phoneKey, res);
  }

  app.post('/api/auth/sms/signin', tryLimiter, async (req, res) => {
    try {
      const member = await checked(req, res, 'signin');
      if (!member) return;
      await freshSession(req);
      req.session.memberId = member.id;
      req.session.issuedAt = Date.now();
      res.json({ success: true, needsPhoto: !member.profileImageFileId, member: { id: member.id, name: member.name } });
    } catch (e) { res.status(500).json({ error: 'Could not sign you in. Please try again.' }); }
  });

  app.post('/api/auth/sms/reset', tryLimiter, async (req, res) => {
    try {
      const password = req.body && req.body.newPassword;
      // Checked before the code is used up, so a too-short password costs nothing.
      if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'Choose a password of at least 8 characters.' });
      const member = await checked(req, res, 'reset');
      if (!member) return;
      await models.Member.updateOne({ id: member.id }, { $set: { passwordHash: await bcrypt.hash(password, 10), resetTokenHash: '', resetTokenExpires: null } });
      // Every device signed in before is signed out.
      revokeMemberSessions(member.id);
      res.json({ success: true, message: 'Your password is changed. Sign in with it now.' });
    } catch (e) { res.status(500).json({ error: 'Could not change your password. Please try again.' }); }
  });

  // Signing up without a password, where the chapter has its own SMS account:
  // a code to the number proves it is theirs, and the sign-up form sends the
  // code instead of a password (server.js, /api/auth/register).
  app.post('/api/auth/sms/signup-code', askLimiter, async (req, res) => {
    try {
      const phoneKey = phoneLib.ghanaKey(req.body && req.body.phone);
      if (!phoneKey) return res.status(400).json({ error: 'Type your Ghanaian phone number, like 024 412 3456.' });
      const chapterId = String((req.body && req.body.chapterId) || '');
      const config = chapterId ? await sms.resolveConfig(chapterId) : null;
      if (!config || config.source !== 'chapter') return res.status(400).json({ error: 'This chapter signs up with a password for now. Choose one above.' });
      if (await models.Member.findOne({ phoneKey })) return res.status(400).json({ error: 'An account with this phone number already exists. Sign in instead.' });
      const issued = await smsCode.issue(phoneKey, 'signup');
      if (issued.limited) return res.status(429).json({ error: `Too many codes for this number. Try again in ${issued.limited} minutes.` });
      const sent = await deliver(phoneKey, 'signup', issued.code, chapterId);
      if (!sent.sent && !devConsole()) return res.status(502).json({ error: 'The text could not be sent. Choose a password instead, or try again in a moment.' });
      res.json({ success: true, message: 'A code is on its way. Type it below.' });
    } catch (e) { res.status(500).json({ error: 'Could not send a code. Choose a password instead.' }); }
  });

  // Confirming it is you (before downloading or deleting your data) when the
  // account has no password: a code to the number it signs in with.
  app.post('/api/member/confirm-code', requireMember, askLimiter, async (req, res) => {
    try {
      const member = await models.Member.findOne({ id: req.session.memberId }).lean();
      if (!member || !member.phoneKey) return res.status(400).json({ error: 'Your account has no phone number to send a code to. Use your password.' });
      const issued = await smsCode.issue(member.phoneKey, 'confirm');
      if (issued.limited) return res.status(429).json({ error: `Too many codes. Try again in ${issued.limited} minutes.` });
      const sent = await deliver(member.phoneKey, 'confirm', issued.code, member.chapterId);
      if (!sent.sent && !devConsole()) return res.status(502).json({ error: 'The text could not be sent. Please try again in a moment.' });
      res.json({ success: true, message: `A code is on its way to your number ending ${member.phoneKey.slice(-2)}.` });
    } catch (e) { res.status(500).json({ error: 'Could not send a code.' }); }
  });

  return { deliver };
}

module.exports = { registerPhoneSigninRoutes };
