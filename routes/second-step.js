// A leader's second step at sign-in: setting it up, renewing recovery codes,
// turning it off where it is not required, and the Coordinator's reset for a
// lost phone. Signing in with it is in server.js (/api/portal/login and
// /api/portal/login/second-step); the rules are lib/secondStep.js and
// lib/totp.js.
//
// Everything that changes it asks for the password again, and is written to
// the account's own security log with who did it.

const QRCode = require('qrcode');
const totp = require('../lib/totp');
const secondStep = require('../lib/secondStep');

function registerSecondStepRoutes(app, deps) {
  const { models, bcrypt, currentStaff, requireChapterAdmin, rolesLib, actorName, revokeStaffSessions, logSecurity, leaderSecondStepSince, passwordLimiter } = deps;

  async function ownAccount(req, res) {
    const staff = currentStaff(req);
    if (!staff) { res.status(401).json({ error: 'Not authenticated' }); return null; }
    if (!staff.id) { res.status(400).json({ error: 'This sign-in is set in the server\'s settings, not in an account here, so it has no second step to set up.' }); return null; }
    const account = await models.StaffUser.findOne({ id: staff.id }).lean();
    if (!account || account.active === false) { res.status(401).json({ error: 'Not authenticated' }); return null; }
    return { staff, account: { ...account, positionKey: staff.positionKey || account.positionKey } };
  }

  async function passwordAgain(req, res, account) {
    const password = String((req.body && req.body.password) || '');
    if (!password) { res.status(400).json({ error: 'Type your password to confirm it is you.' }); return false; }
    if (!await bcrypt.compare(password, account.passwordHash || '')) { res.status(401).json({ error: 'That password is not right.' }); return false; }
    return true;
  }

  function codeAgain(res, account, code) {
    const step = totp.verify(totp.open(account.totpSecretEnc), code, { lastStep: account.totpLastStep || 0 });
    if (!step) { res.status(401).json({ error: 'That code is not right. Use the newest one your app shows.' }); return 0; }
    return step;
  }

  // Where the account stands.
  app.get('/api/portal/second-step', async (req, res) => {
    const own = await ownAccount(req, res);
    if (!own) return;
    const s = secondStep.standing(own.account, { since: await leaderSecondStepSince() });
    res.json({ ...s, log: (own.account.securityLog || []).slice(-10).reverse() });
  });

  // 1. A new secret, shown as a QR code for the app to scan and as text to type.
  // It is kept "pending" until a code from it proves the app has it.
  app.post('/api/portal/second-step/begin', passwordLimiter, async (req, res) => {
    try {
      const own = await ownAccount(req, res);
      if (!own) return;
      if (!await passwordAgain(req, res, own.account)) return;
      const secret = totp.generateSecret();
      await models.StaffUser.updateOne({ id: own.account.id }, { $set: { totpPendingEnc: totp.seal(secret) } });
      const url = totp.otpauthUrl(secret, own.account.username);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ qr: await QRCode.toDataURL(url, { margin: 1, width: 240 }), secret: secret.match(/.{1,4}/g).join(' '), url });
    } catch (e) {
      res.status(500).json({ error: 'Could not start setting it up. Please try again.' });
    }
  });

  // 2. The first code from the app turns it on, and the recovery codes are
  // shown, this once.
  app.post('/api/portal/second-step/confirm', passwordLimiter, async (req, res) => {
    try {
      const own = await ownAccount(req, res);
      if (!own) return;
      const secret = totp.open(own.account.totpPendingEnc);
      if (!secret) return res.status(400).json({ error: 'Start again: scan the code first.' });
      const step = totp.verify(secret, req.body && req.body.code);
      if (!step) return res.status(401).json({ error: 'That code is not right. Type the six digits your app shows now.' });
      const codes = totp.makeRecoveryCodes();
      await models.StaffUser.updateOne({ id: own.account.id }, { $set: {
        totpSecretEnc: totp.seal(secret), totpPendingEnc: '', totpEnabledAt: new Date(), totpLastStep: step,
        totpRecoveryHashes: codes.map(totp.hashRecovery)
      } });
      await logSecurity(own.account.id, 'second step set up', own.account.name || own.account.username);
      if (req.session.staff) req.session.staff.mustSetUpSecondStep = false;
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, recoveryCodes: codes });
    } catch (e) {
      res.status(500).json({ error: 'Could not turn it on. Please try again.' });
    }
  });

  // New recovery codes, replacing the old ones (all of them, used or not).
  app.post('/api/portal/second-step/recovery-codes', passwordLimiter, async (req, res) => {
    try {
      const own = await ownAccount(req, res);
      if (!own) return;
      if (!own.account.totpEnabledAt) return res.status(400).json({ error: 'Set up the second step first.' });
      if (!await passwordAgain(req, res, own.account)) return;
      const step = codeAgain(res, own.account, req.body && req.body.code);
      if (!step) return;
      const codes = totp.makeRecoveryCodes();
      await models.StaffUser.updateOne({ id: own.account.id }, { $set: { totpRecoveryHashes: codes.map(totp.hashRecovery), totpLastStep: step } });
      await logSecurity(own.account.id, 'new recovery codes made', own.account.name || own.account.username);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, recoveryCodes: codes });
    } catch (e) {
      res.status(500).json({ error: 'Could not make new codes. Please try again.' });
    }
  });

  // Off, for an account that does not need it. One that does cannot turn it
  // off; a lost phone is the Coordinator's reset below.
  app.post('/api/portal/second-step/off', passwordLimiter, async (req, res) => {
    try {
      const own = await ownAccount(req, res);
      if (!own) return;
      if (!own.account.totpEnabledAt) return res.json({ success: true });
      if (secondStep.requiredFor(own.account)) {
        return res.status(400).json({ error: 'Your account needs the second step, so it cannot be turned off. If you have lost your phone, ask your Chapter Coordinator to reset it.' });
      }
      if (!await passwordAgain(req, res, own.account)) return;
      if (!codeAgain(res, own.account, req.body && req.body.code)) return;
      await models.StaffUser.updateOne({ id: own.account.id }, { $set: { totpSecretEnc: '', totpPendingEnc: '', totpEnabledAt: null, totpLastStep: 0, totpRecoveryHashes: [] } });
      await logSecurity(own.account.id, 'second step turned off', own.account.name || own.account.username);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Could not turn it off. Please try again.' });
    }
  });

  // A lost phone, or an account resting after wrong tries: the Coordinator
  // (or whoever manages the chapter's leadership accounts) clears the second
  // step and the rest, and the holder sets it up again at their next sign-in.
  // Recorded on the account with who did it, and the holder is signed out.
  app.post('/api/admin/staff/:id/second-step/reset', requireChapterAdmin, async (req, res) => {
    try {
      const scope = rolesLib.getActingScope(req);
      const account = await models.StaffUser.findOne({ id: req.params.id }).lean();
      if (!account) return res.status(404).json({ error: 'Account not found' });
      if (!scope.isNational && account.chapterId !== scope.chapterId) return res.status(403).json({ error: 'That account is not in your chapter.' });
      const me = currentStaff(req);
      if (me && me.id && me.id === account.id) return res.status(400).json({ error: 'Ask another leader who manages accounts to reset your own.' });
      await models.StaffUser.updateOne({ id: account.id }, { $set: {
        totpSecretEnc: '', totpPendingEnc: '', totpEnabledAt: null, totpLastStep: 0, totpRecoveryHashes: [],
        failedSignIns: 0, lockedUntil: null
      } });
      await logSecurity(account.id, 'second step reset and account unlocked', actorName(req) || 'an administrator');
      await revokeStaffSessions(account.id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Could not reset it. Please try again.' });
    }
  });
}

module.exports = { registerSecondStepRoutes };
