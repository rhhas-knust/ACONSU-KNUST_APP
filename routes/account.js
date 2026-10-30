// A signed-in leader's own account: who they are in the system, and changing their
// own password.
//
// Every leader (executive, coordinator, finance, shepherding, publicity, welfare,
// patron) has an account of their own, opened by the Chapter Coordinator with a
// starting password the Coordinator knows. This is where the person takes that
// password into their own hands.
//
// Two sign-ins are NOT accounts and cannot be changed here: the administrator
// login and the legacy shepherding login both live in the server's settings.
const rateLimit = require('express-rate-limit');
const { passwordProblem, LEADER_MIN_LENGTH } = require('../lib/passwords');

function registerAccountRoutes(app, deps) {
  const { repo, models, bcrypt, rolesLib, positions, currentStaff, rememberRevocation } = deps;

  // Changing a password needs the current one, so a borrowed or stolen session
  // cannot be turned into a permanent takeover; and guessing the current one is
  // slowed the same way signing in is.
  const passwordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 10,
    message: { error: 'Too many attempts. Please try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false
  });

  // The session holds only a copy of who signed in. A real account is one the
  // database knows; the settings-based sign-ins carry no account id.
  async function ownAccount(req) {
    const staff = currentStaff(req);
    if (!staff) return { status: 401, error: 'Not authenticated' };
    if (!staff.id) {
      return { status: 400, error: 'This sign-in is set in the server\'s settings, not in an account here, so its password cannot be changed from the portal.' };
    }
    const account = await models.StaffUser.findOne({ id: staff.id }).lean();
    if (!account || account.active === false) return { status: 401, error: 'Not authenticated' };
    return { staff, account };
  }

  // Every other device is signed out; this one stays in. The revocation time is
  // remembered in this process and saved, so it survives a restart.
  async function signOutOthers(req, staffId) {
    const at = Date.now();
    rememberRevocation(staffId, at);
    await repo.patchById('staffUsers', staffId, { sessionsRevokedAt: new Date(at) }).catch(() => { /* held in memory for this process */ });
    req.session.staff.issuedAt = at + 1;
  }

  app.get('/api/portal/account', async (req, res) => {
    try {
      const staff = currentStaff(req);
      if (staff && !staff.id) {
        // The settings-based sign-ins: shown, but with nothing to change.
        return res.json({ editable: false, name: staff.name || staff.username, username: staff.username, roleLabel: rolesLib.roleLabel(staff.role) });
      }
      const own = await ownAccount(req);
      if (own.error) return res.status(own.status).json({ error: own.error });
      const { account } = own;
      let office = '';
      let department = '';
      if (account.role === 'executive') {
        const card = await models.Executive.findOne({ staffId: account.id, chapterId: account.chapterId }).lean();
        if (card) {
          office = positions.resolvePosition(card.positionKey, card.role, !!card.department).label || card.role || '';
          if (card.department) {
            const dept = await models.Department.findOne({ id: card.department, chapterId: account.chapterId }).lean();
            department = dept ? dept.name : '';
          }
        }
      }
      const chapter = account.chapterId ? await models.Chapter.findOne({ id: account.chapterId }).lean() : null;
      const member = account.memberId ? await models.Member.findOne({ id: account.memberId }).lean() : null;
      const ends = account.termEndsAt ? new Date(account.termEndsAt) : null;
      res.json({
        editable: true,
        name: account.name, username: account.username,
        role: account.role, roleLabel: rolesLib.roleLabel(account.role),
        office, department,
        chapter: chapter ? { id: chapter.id, name: chapter.name } : null,
        termYear: account.termYear || '',
        termEndsAt: ends,
        daysLeft: ends ? Math.ceil((ends.getTime() - Date.now()) / 86400000) : null,
        passwordChangedAt: account.passwordChangedAt || null,
        // Still on the password the Coordinator chose. Worth saying out loud.
        usingStartingPassword: !account.passwordChangedAt,
        mustChangePassword: !!account.mustChangePassword,
        // The first-sign-in screen asks for this email only when there is one to match.
        hasMemberEmail: !!(member && member.email)
      });
    } catch (e) {
      res.status(500).json({ error: 'Could not load your account.' });
    }
  });

  app.post('/api/portal/password', passwordLimiter, async (req, res) => {
    try {
      const own = await ownAccount(req);
      if (own.error) return res.status(own.status).json({ error: own.error });
      const { account } = own;
      const { currentPassword, newPassword } = req.body || {};
      if (typeof currentPassword !== 'string' || !currentPassword) return res.status(400).json({ error: 'Type your current password first.' });
      if (typeof newPassword !== 'string' || !newPassword) return res.status(400).json({ error: 'Choose a new password.' });
      // The current password is checked before the new one is judged, so the
      // reasons a new one is refused are only ever shown to its owner.
      if (!await bcrypt.compare(currentPassword, account.passwordHash || '')) {
        return res.status(401).json({ error: 'Your current password is not right.' });
      }
      const problem = passwordProblem(newPassword, { username: account.username, current: currentPassword, minLength: LEADER_MIN_LENGTH });
      if (problem) return res.status(400).json({ error: problem });
      await repo.patchById('staffUsers', account.id, {
        passwordHash: await bcrypt.hash(newPassword, 10), passwordChangedAt: new Date()
      });
      await signOutOthers(req, account.id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Could not change your password right now.' });
    }
  });

  // The first sign-in after being appointed (or after a reset): the password
  // used was the office's starting one, which follows a pattern anyone could
  // guess. Choosing a new one also asks for the email on the holder's member
  // profile, so that knowing the pattern is not enough to take the office over.
  app.post('/api/portal/first-password', passwordLimiter, async (req, res) => {
    try {
      const staff = currentStaff(req);
      if (!staff || !staff.id) return res.status(401).json({ error: 'Not authenticated' });
      if (!staff.mustChangePassword) return res.status(400).json({ error: 'Your password is already your own. To change it, use My Account.' });
      const account = await models.StaffUser.findOne({ id: staff.id }).lean();
      if (!account || account.active === false) return res.status(401).json({ error: 'Not authenticated' });
      const { email, newPassword } = req.body || {};
      const member = account.memberId ? await models.Member.findOne({ id: account.memberId }).lean() : null;
      if (member && member.email) {
        const given = String(email || '').trim().toLowerCase();
        if (!given) return res.status(400).json({ error: 'Type the email address on your member profile.' });
        if (given !== String(member.email).trim().toLowerCase()) {
          return res.status(400).json({ error: 'That is not the email on your member profile. Use the one you registered with, or ask your Chapter Coordinator.' });
        }
      }
      if (typeof newPassword !== 'string' || !newPassword) return res.status(400).json({ error: 'Choose a new password.' });
      const problem = passwordProblem(newPassword, { username: account.username, minLength: LEADER_MIN_LENGTH });
      if (problem) return res.status(400).json({ error: problem });
      if (await bcrypt.compare(newPassword, account.passwordHash || '')) {
        return res.status(400).json({ error: 'That is the starting password. Choose one of your own.' });
      }
      await repo.patchById('staffUsers', account.id, {
        passwordHash: await bcrypt.hash(newPassword, 10), passwordChangedAt: new Date(),
        mustChangePassword: false, startingPasswordExpiresAt: null
      });
      req.session.staff.mustChangePassword = false;
      await signOutOthers(req, account.id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Could not save your password right now.' });
    }
  });

  // Lost a phone, or left a sign-in open on a shared computer.
  app.post('/api/portal/sign-out-others', async (req, res) => {
    try {
      const own = await ownAccount(req);
      if (own.error) return res.status(own.status).json({ error: own.error });
      await signOutOthers(req, own.account.id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Could not sign the other devices out right now.' });
    }
  });
}

module.exports = { registerAccountRoutes };
