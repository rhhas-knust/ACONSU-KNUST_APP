// A member's own privacy controls: download everything held about them, and
// delete their account for good. Both ask for their password again first,
// because a phone left signed in on a table should not be enough for either.
//
// The work itself is lib/eraseMember.js, which the chapter admin's "delete
// member" button uses too.

const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const eraseMember = require('../lib/eraseMember');
const smsCode = require('../lib/smsCode');

function registerPrivacyRoutes(app, deps) {
  const { models, requireMember, eraseHooks } = deps;

  // Asking for everything is not something anyone needs to do often; a few
  // tries an hour leaves room for a mistyped password and nothing more.
  // Counted per account, not per address: students on campus Wi-Fi share one,
  // and one person's tries must not lock out everyone else on it.
  const privacyLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: Number(process.env.PRIVACY_RATE_LIMIT_MAX) || 5,
    keyGenerator: (req) => `member:${req.session.memberId}`,
    message: { error: 'Too many tries. Please wait an hour and try again.' },
    standardHeaders: true,
    legacyHeaders: false
  });

  // Their password, or for an account that has none (signed up with a code)
  // the code just texted to their number (POST /api/member/confirm-code).
  async function confirmPassword(req, res) {
    const password = String((req.body && req.body.password) || '');
    const code = String((req.body && req.body.smsCode) || '');
    const member = await models.Member.findOne({ id: req.session.memberId }).lean();
    if (!member) { res.status(404).json({ error: 'Account not found' }); return null; }
    if (code && member.phoneKey) {
      const out = await smsCode.verify(member.phoneKey, 'confirm', code);
      if (!out.ok) { res.status(401).json({ error: smsCode.MESSAGES[out.reason] }); return null; }
      return member;
    }
    if (!password) { res.status(400).json({ error: member.passwordHash ? 'Type your password to confirm it is you.' : 'Ask for a code by text to confirm it is you.' }); return null; }
    if (!await bcrypt.compare(password, member.passwordHash || '')) {
      res.status(401).json({ error: 'That password is not right.' });
      return null;
    }
    return member;
  }

  // Everything held about them, as one file to keep.
  app.post('/api/member/export', requireMember, privacyLimiter, async (req, res) => {
    try {
      const member = await confirmPassword(req, res);
      if (!member) return;
      const data = await eraseMember.exportData(member.id);
      const day = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Disposition', `attachment; filename="aconsu-my-data-${day}.json"`);
      res.setHeader('Cache-Control', 'no-store');
      res.type('application/json').send(JSON.stringify(data, null, 2));
    } catch (e) {
      res.status(500).json({ error: 'Could not put your data together. Please try again.' });
    }
  });

  // Their account and what belongs to it, gone. What has to stay (money in
  // the books, a count on a Sunday) stays without their name.
  app.post('/api/member/delete-account', requireMember, privacyLimiter, async (req, res) => {
    try {
      const member = await confirmPassword(req, res);
      if (!member) return;
      if (String((req.body && req.body.confirm) || '').trim().toUpperCase() !== 'DELETE') {
        return res.status(400).json({ error: 'Type DELETE to confirm.' });
      }
      await eraseMember.erase(member.id, eraseHooks(req));
      req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.json({ success: true });
      });
    } catch (e) {
      res.status(500).json({ error: 'Could not finish deleting your account. Please try again: whatever is left will be removed.' });
    }
  });
}

module.exports = { registerPrivacyRoutes };
