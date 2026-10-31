// A member's own account: signing up, signing in (by phone number or email),
// signing out, a new password by email, who is signed in, the profile, the
// photo and the password. Moved out of server.js (Phase 7) unchanged; the
// codes by text are routes/phone-signin.js, the privacy controls
// routes/privacy.js.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const repo = require('../lib/repo');
const gridfs = require('../lib/gridfs');
const models = require('../lib/models');
const sms = require('../lib/sms');
const smsCode = require('../lib/smsCode');
const mailer = require('../lib/mailer');
const phoneLib = require('../lib/phone');
const listLink = require('../lib/listLink');

function registerMemberAccountRoutes(app, deps) {
  const {
    DUMMY_HASH, POLICY_VERSION, compressIfImage, currentAcademicYearLabel, endSession, escapeHtmlForEmail,
    freshSession, loginLimiter, publicBaseUrl, requireMember, revokeMemberSessions, scheduleOnboardingTasks, upload
  } = deps;

  // ---------- member auth routes ----------
  // Registration is multipart now - a profile photo is compulsory for member
  // registration (section 6), same upload pipeline as the profile-photo update
  // route below. Every new account starts life as a 'visitor': the Shepherding
  // workflow (section 7) is what moves someone from here to an active member.
  // Signing up asks for little: a name, a phone number, the chapter, a password
  // and agreement to the Terms. An email address is optional. Everything else
  // (programme, level, hall, birthday, whether they have finished their studies)
  // is on the profile, asked for gently and never required. The photo is not on
  // this form but is still required: the app asks for it straight after
  // (photo.html), before anything else opens.
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const cleanEmail = (raw) => String(raw || '').toLowerCase().trim();

  app.post('/api/auth/register', loginLimiter, upload.single('profileImage'), async (req, res) => {
    const { password, phone, level, programme, hostel, department, chapterId, birthdayMonth, birthdayDay, memberKind, graduationYear } = req.body;
    const name = String(req.body.name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const email = cleanEmail(req.body.email);
    const phoneKey = phoneLib.ghanaKey(phone);
    if (name.length < 2) return res.status(400).json({ error: 'Type your full name.' });
    if (!String(phone || '').trim()) return res.status(400).json({ error: 'Type your phone number.' });
    if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'That email address does not look right. Check it, or leave it empty.' });
    // Signing in is by phone number or email, so one of them must be usable.
    if (!phoneKey && !email) {
      return res.status(400).json({ error: 'Type a Ghanaian phone number, like 024 412 3456. Using a number from another country? Add your email address too, and sign in with that.' });
    }
    // A password, or (only where the chapter has its own SMS account) the code
    // texted to the number instead (routes/phone-signin.js).
    const byCode = !password && !!req.body.smsCode;
    if (!byCode && (typeof password !== 'string' || password.length < 8)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!chapterId) {
      return res.status(400).json({ error: 'Please select your ACONSU chapter' });
    }
    // Agreeing to the Terms and the privacy policy is a step the person takes, not
    // something assumed from the account existing. It is also recorded: when, and
    // which wording they agreed to, so a later change to the policy can be shown
    // to people who agreed to an earlier one.
    if (String(req.body.consent || '') !== 'true') {
      return res.status(400).json({ error: 'Please tick the box to agree to the Terms of use and the Privacy policy.' });
    }
    const month = birthdayMonth ? Number(birthdayMonth) : null;
    const day = birthdayDay ? Number(birthdayDay) : null;
    if ((month && !day) || (day && !month)) {
      return res.status(400).json({ error: 'Please provide both a birthday month and day, or leave both blank' });
    }
    if (month && (month < 1 || month > 12)) return res.status(400).json({ error: 'Invalid birthday month' });
    if (day && (day < 1 || day > 31)) return res.status(400).json({ error: 'Invalid birthday day' });
    try {
      const chapter = await repo.getById('chapters', chapterId);
      if (!chapter || chapter.status !== 'active') {
        return res.status(400).json({ error: 'Please choose a valid, active chapter' });
      }
      if (email && await models.Member.findOne({ email })) return res.status(400).json({ error: 'An account with this email already exists. Sign in instead.' });
      if (phoneKey && await models.Member.findOne({ phoneKey })) return res.status(400).json({ error: 'An account with this phone number already exists. Sign in instead, or reset your password.' });
      if (byCode) {
        const config = await sms.resolveConfig(chapter.id);
        if (!config || config.source !== 'chapter' || !phoneKey) return res.status(400).json({ error: 'Choose a password: this chapter signs up with one for now.' });
        const ok = await smsCode.verify(phoneKey, 'signup', req.body.smsCode);
        if (!ok.ok) return res.status(400).json({ error: smsCode.MESSAGES[ok.reason] });
      }

      // An app still sending the photo with the form (an older version): kept.
      let profileImageFileId = '';
      if (req.file) {
        const compressed = await compressIfImage(req.file.buffer, req.file.mimetype);
        profileImageFileId = String(await gridfs.uploadBuffer(compressed.buffer, req.file.originalname, {
          category: 'member-profile', contentType: compressed.contentType, title: name, chapterId: chapter.id
        }));
      }

      // No password at all when they proved the number with a code instead; they
      // sign in with a code, and can choose a password on their profile later.
      const passwordHash = byCode ? '' : await bcrypt.hash(password, 10);
      const member = await repo.create('members', {
        chapterId: chapter.id,
        name, ...(email ? { email } : {}), passwordHash,
        phone: String(phone).trim().slice(0, 40), phoneKey, level: level || '', programme: programme || '', hostel: hostel || '',
        department: department || '',
        // Someone who has finished their studies says so when they sign up, and
        // the form asks them for a graduation year instead of a hostel. The
        // CLAIM is recorded; the stage is not granted here. Stage is
        // Shepherding's to set everywhere else in this system, and letting it be
        // self-declared would make Alumni Connect - which is union-wide - a
        // directory anyone could write themselves into.
        registeredAsAlumni: String(memberKind || '') === 'alumni',
        graduationYear: String(graduationYear || '').replace(/[^0-9]/g, '').slice(0, 4),
        profileImageFileId,
        membershipStage: 'visitor',
        qrToken: crypto.randomBytes(16).toString('hex'),
        birthdayMonth: month, birthdayDay: day,
        consentedAt: new Date(), consentVersion: POLICY_VERSION
      }, 'mem');
      // Already on Shepherding's list (the chapter's own list, or checked in at
      // the door)? Then they are one person from now on - see lib/listLink.js.
      await listLink.linkOnRegister(member);
      scheduleOnboardingTasks(member).catch(() => {});
      req.session.memberId = member.id;
      req.session.issuedAt = Date.now();
      res.json({ success: true, needsPhoto: !profileImageFileId, member: { id: member.id, name: member.name, email: member.email || '', chapterId: member.chapterId } });
    } catch (e) {
      res.status(500).json({ error: 'Could not create account. Please try again.' });
    }
  });

  // Signing in with a phone number (any way it is typed) or an email address.
  // `email` is what older pages send; it may hold either.
  app.post('/api/auth/login', loginLimiter, async (req, res) => {
    const who = String(req.body.identifier || req.body.email || '').trim();
    const { password } = req.body;
    if (!who || !password) return res.status(400).json({ error: 'Type your phone number (or email) and your password.' });
    try {
      let member = null;
      let match = false;
      if (phoneLib.looksLikePhone(who)) {
        // Older accounts can share a number: whichever of them this password opens.
        const key = phoneLib.ghanaKey(who);
        const candidates = key ? await models.Member.find({ phoneKey: key }) : [];
        for (const m of candidates) {
          if (await bcrypt.compare(String(password), m.passwordHash || DUMMY_HASH)) { member = m; match = true; break; }
        }
        if (!candidates.length) await bcrypt.compare(String(password), DUMMY_HASH);
      } else {
        member = await models.Member.findOne({ email: cleanEmail(who) });
        match = await bcrypt.compare(String(password), (member && member.passwordHash) || DUMMY_HASH);
      }
      if (!member || !match) return res.status(401).json({ error: 'That phone number (or email) and password do not match.' });
      await freshSession(req);
      req.session.memberId = member.id;
      req.session.issuedAt = Date.now();
      res.json({ success: true, needsPhoto: !member.profileImageFileId, member: { id: member.id, name: member.name, email: member.email || '' } });
    } catch (e) {
      res.status(500).json({ error: 'Could not log in. Please try again.' });
    }
  });

  app.post('/api/auth/logout', (req, res) => endSession(req, res));

  // ---------- password reset ----------
  app.post('/api/auth/forgot-password', loginLimiter, async (req, res) => {
    const { email } = req.body;
    // Always respond with the same generic message whether or not the email exists -
    // this prevents anyone from using this endpoint to discover who has an account.
    const genericMsg = { success: true, message: 'If an account exists for that email, a reset link has been sent.' };
    if (!email) return res.json(genericMsg);
    try {
      const member = await models.Member.findOne({ email: email.toLowerCase().trim() });
      if (!member) return res.json(genericMsg);

      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      member.resetTokenHash = tokenHash;
      member.resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await member.save();

      // From configuration, never from the Host header (see publicBaseUrl).
      const baseUrl = publicBaseUrl(req);
      if (!baseUrl) {
        console.error('Password reset requested but no PUBLIC_BASE_URL or RENDER_EXTERNAL_URL is set; refusing to build a link from the Host header.');
        return res.json(genericMsg);
      }
      const resetLink = `${baseUrl}/reset-password.html?token=${rawToken}&email=${encodeURIComponent(member.email)}`;
      mailer.sendMail({
        to: member.email,
        subject: 'Reset your ACONSU password',
        html: `<p>Hi ${escapeHtmlForEmail(member.name)},</p><p>Tap the link below to reset your ACONSU password. This link expires in 1 hour.</p><p><a href="${resetLink}">${resetLink}</a></p><p>If you didn't request this, you can safely ignore this email.</p>`
      }).catch(() => {});

      res.json(genericMsg);
    } catch (e) {
      res.json(genericMsg); // still generic, even on internal error - never leak account existence
    }
  });

  app.post('/api/auth/reset-password', loginLimiter, async (req, res) => {
    const { token, email, newPassword } = req.body;
    if (!token || !email || !newPassword) return res.status(400).json({ error: 'Missing reset details' });
    if (typeof newPassword !== 'string' || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const member = await models.Member.findOne({
        email: email.toLowerCase().trim(),
        resetTokenHash: tokenHash,
        resetTokenExpires: { $gt: new Date() }
      });
      if (!member) return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });

      member.passwordHash = await bcrypt.hash(newPassword, 10);
      member.resetTokenHash = '';
      member.resetTokenExpires = null;
      await member.save();
      // Whoever knew the old password, or held a session opened with it, is out.
      revokeMemberSessions(member.id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Could not reset password. Please try again.' });
    }
  });

  app.get('/api/auth/me', async (req, res) => {
    if (!req.session || !req.session.memberId) return res.json({ member: null });
    try {
      const member = await repo.getById('members', req.session.memberId, repo.ownRecord());
      if (!member) return res.json({ member: null });
      // Only passwordHash was being stripped, so every page load also shipped the
      // member's password-reset token hash and their QR token to the browser.
      // None of it is needed here: the digital card has its own endpoint, and the
      // reset token is credential material that should never leave the server.
      const { passwordHash, resetTokenHash, resetTokenExpires, qrToken, ...safe } = member;
      // Signed up without a photo: the app asks for it before anything else.
      res.json({ member: { ...safe, needsPhoto: !member.profileImageFileId, hasPassword: !!passwordHash } });
    } catch (e) {
      res.json({ member: null });
    }
  });


  app.put('/api/member/profile', requireMember, upload.single('profileImage'), async (req, res) => {
    try {
      const existing = await repo.getById('members', req.session.memberId, repo.ownRecord());
      if (!existing) return res.status(404).json({ error: 'Account not found' });
      let profileImageFileId = existing.profileImageFileId || '';
      if (req.file) {
        const compressed = await compressIfImage(req.file.buffer, req.file.mimetype);
        profileImageFileId = String(await gridfs.uploadBuffer(compressed.buffer, req.file.originalname, {
          category: 'member-profile', contentType: compressed.contentType, title: req.body.name || existing.name, chapterId: existing.chapterId
        }));
        if (existing.profileImageFileId) gridfs.deleteFile(existing.profileImageFileId).catch(() => {});
      }
      const month = req.body.birthdayMonth ? Number(req.body.birthdayMonth) : null;
      const day = req.body.birthdayDay ? Number(req.body.birthdayDay) : null;
      if ((month && !day) || (day && !month)) {
        return res.status(400).json({ error: 'Please provide both a birthday month and day, or leave both blank' });
      }
      // The phone number signs them in: never blanked by a form that did not send
      // it, and never one another account already has.
      let phone = existing.phone || '';
      let email = existing.email || '';
      if (req.body.email !== undefined && cleanEmail(req.body.email) && cleanEmail(req.body.email) !== email) {
        const next = cleanEmail(req.body.email);
        if (!EMAIL_RE.test(next)) return res.status(400).json({ error: 'That email address does not look right.' });
        if (await models.Member.findOne({ email: next, id: { $ne: existing.id } })) return res.status(400).json({ error: 'Another account already uses that email address.' });
        email = next;
      }
      if (req.body.phone !== undefined) {
        const typed = String(req.body.phone).trim().slice(0, 40);
        const key = phoneLib.ghanaKey(typed);
        if (!key && !email) {
          return res.status(400).json({ error: typed
            ? 'Type a Ghanaian phone number, like 024 412 3456, or add an email address to sign in with.'
            : 'Your phone number is how you sign in. Keep one, or add an email address first.' });
        }
        if (key && key !== existing.phoneKey && await models.Member.findOne({ phoneKey: key, id: { $ne: existing.id } })) {
          return res.status(400).json({ error: 'Another account already has this phone number.' });
        }
        phone = typed;
      }
      const level = req.body.level !== undefined ? req.body.level : existing.level;
      const hostel = req.body.hostel !== undefined ? req.body.hostel : existing.hostel;
      // A real academic-year change (not just a typo fix) - snapshot where they
      // were before overwriting, so "2025/2026: Level 200, Hostel A" is never lost.
      let academicHistory = existing.academicHistory || [];
      if ((level && level !== existing.level) || (hostel && hostel !== existing.hostel)) {
        academicHistory = [
          ...academicHistory,
          { year: currentAcademicYearLabel(), level: existing.level || '', hostel: existing.hostel || '', updatedAt: new Date() }
        ];
      }
      const updates = {
        name: req.body.name || existing.name,
        phone,
        phoneKey: phoneLib.ghanaKey(phone),
        ...(email ? { email } : {}),
        // Finished their studies? A claim, as at sign-up; the stage itself is
        // Shepherding's to set.
        ...(req.body.memberKind !== undefined ? { registeredAsAlumni: String(req.body.memberKind) === 'alumni' } : {}),
        ...(req.body.graduationYear !== undefined ? { graduationYear: String(req.body.graduationYear).replace(/[^0-9]/g, '').slice(0, 4) } : {}),
        level,
        programme: req.body.programme !== undefined ? req.body.programme : existing.programme,
        hostel,
        academicHistory,
        // Deliberately NOT taken from the request. This form sends no department
        // field, so `req.body.department || ''` silently blanked a member's
        // department every time they edited their phone number. Belonging to a
        // department is also not a thing to grant yourself in passing - it is
        // decided by the people who lead it, so it changes through its own route
        // and never as a side effect of saving a profile.
        department: existing.department || '',
        profileImageFileId,
        birthdayMonth: month,
        birthdayDay: day
      };
      const updated = await repo.updateById('members', req.session.memberId, { ...existing, ...updates }, repo.ownRecord());
      const { passwordHash, ...safe } = updated;
      res.json({ success: true, member: safe });
    } catch (e) {
      res.status(500).json({ error: 'Could not update profile' });
    }
  });

  // The photo, asked for straight after signing up (photo.html), and changed
  // later from the profile.
  app.post('/api/member/photo', requireMember, upload.single('photo'), async (req, res) => {
    try {
      if (!req.file || !/^image\//.test(req.file.mimetype || '')) return res.status(400).json({ error: 'Choose a photo of yourself.' });
      const existing = await repo.getById('members', req.session.memberId, repo.ownRecord());
      if (!existing) return res.status(404).json({ error: 'Account not found' });
      const compressed = await compressIfImage(req.file.buffer, req.file.mimetype);
      const profileImageFileId = String(await gridfs.uploadBuffer(compressed.buffer, req.file.originalname, {
        category: 'member-profile', contentType: compressed.contentType, title: existing.name, chapterId: existing.chapterId
      }));
      await repo.patchById('members', existing.id, { profileImageFileId }, repo.ownRecord());
      if (existing.profileImageFileId) gridfs.deleteFile(existing.profileImageFileId).catch(() => {});
      res.json({ success: true, profileImageFileId });
    } catch (e) {
      res.status(500).json({ error: 'Could not save your photo. Please try again.' });
    }
  });

  app.put('/api/member/password', requireMember, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (typeof newPassword !== 'string' || newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
    try {
      const member = await models.Member.findOne({ id: req.session.memberId });
      if (!member) return res.status(404).json({ error: 'Account not found' });
      // An account that signed up with a code has no password yet: it chooses
      // its first one without being asked for the old one.
      if (member.passwordHash) {
        if (!currentPassword) return res.status(400).json({ error: 'Both current and new password are required' });
        const match = await bcrypt.compare(currentPassword, member.passwordHash);
        if (!match) return res.status(401).json({ error: 'Current password is incorrect' });
      }
      member.passwordHash = await bcrypt.hash(newPassword, 10);
      await member.save();
      // Every other device is signed out; this one, which has just proved it
      // knows the password, stays in.
      const at = revokeMemberSessions(member.id);
      req.session.issuedAt = at + 1;
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Could not update password' });
    }
  });
}

module.exports = { registerMemberAccountRoutes };
