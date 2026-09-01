require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { connectDB } = require('./lib/db');
const repo = require('./lib/repo');
const gridfs = require('./lib/gridfs');
const models = require('./lib/models');
const rolesLib = require('./lib/roles');
const BIBLE_BOOKS = require('./lib/bibleBooks');
const push = require('./lib/push');
const sms = require('./lib/sms');
const mailer = require('./lib/mailer');
const { compressIfImage } = require('./lib/imageProcess');
const { renderTableReport } = require('./lib/pdf');
const { registerGroupRoutes } = require('./routes/groups');
const { registerChatRoutes } = require('./routes/chat');
const { registerMemberServiceRoutes } = require('./routes/member-services');
const QRCode = require('qrcode');
const crypto = require('crypto');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 } // 30MB per file (covers most ebook PDFs and photos)
});

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Trust the first proxy hop (Render/Railway sit behind a load balancer).
// Needed for secure cookies and correct client IPs for rate limiting.
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false // keep simple for now; the app has no user-supplied scripts
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev_secret_change_me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8, // 8 hours
    httpOnly: true,
    secure: isProd, // only require HTTPS-only cookies once deployed behind HTTPS
    sameSite: 'lax'
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- rate limiting ----------
// Login: slow down brute-force password guessing.
// Configurable so the automated test suite (which legitimately signs many
// more accounts in and out per run than any real IP would in 15 minutes,
// especially now that it also exercises a second chapter's worth of
// accounts) can raise it — production keeps the same strict default of 10.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 10,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});
// Public forms: slow down spam/flooding of join, prayer, testimony, contact forms.
const formLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: { error: 'Too many submissions from this device. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// ---------- auth middleware ----------
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

// ---------- auth routes ----------
app.post('/api/admin/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'changeme';
  if (username === adminUser && password === adminPass) {
    req.session.isAdmin = true;
    return res.json({ success: true });
  }
  return res.status(401).json({ error: 'Invalid credentials' });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/admin/check', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// ---------- Shepherding Head auth ----------
// A separate, dedicated login from both admin and member accounts — only the
// Shepherding Head should ever have these credentials. Deliberately its own
// portal (not a role flag on the admin account) so admin and shepherding
// access can be handed to different people without sharing a password.
function requireShepherd(req, res, next) {
  if (hasRole(req, 'shepherding')) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

app.post('/api/shepherd/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  const shepherdUser = process.env.SHEPHERD_USERNAME || '';
  const shepherdPass = process.env.SHEPHERD_PASSWORD || '';
  if (!shepherdUser || !shepherdPass) {
    return res.status(500).json({ error: 'Shepherding portal is not configured yet. Set SHEPHERD_USERNAME and SHEPHERD_PASSWORD in .env.' });
  }
  if (username === shepherdUser && password === shepherdPass) {
    req.session.isShepherd = true;
    return res.json({ success: true });
  }
  return res.status(401).json({ error: 'Invalid credentials' });
});

app.post('/api/shepherd/logout', (req, res) => {
  delete req.session.isShepherd;
  res.json({ success: true });
});

app.get('/api/shepherd/check', (req, res) => {
  res.json({ isShepherd: hasRole(req, 'shepherding') });
});

// ---------- leadership portal auth (coordinator / finance / shepherding / publicity / ...) ----------
// Every union leader gets their own account, created by an authorised admin,
// so access can be handed to a person rather than to a shared password.
// Three ways in are accepted, in this order:
//   1. a StaffUser account with the matching role  (the normal case)
//   2. the main admin session                       (admin can always get in — treated as the
//                                                      bootstrap National Coordinator, see lib/roles.js)
//   3. the legacy SHEPHERD_* env login              (kept so nothing breaks mid-term)
// The coordinator role — the Chapter Coordinator — deliberately satisfies
// *read* checks for every office in its own chapter, that's the whole point
// of the role, but only some of the write ones (see requireChapterCoordinator
// below for the powers that are genuinely coordinator-and-above).
//
// Multi-chapter note: every role below except nationalCoordinator requires a
// chapterId (enforced when the account is created — see /api/admin/staff).
// lib/roles.js is what actually turns "which role" into "which chapter's
// data this session may touch" — these helpers only answer "which role".
const PORTAL_ROLES = [
  'nationalCoordinator', 'coordinator', 'chapterAdmin', 'executive',
  'finance', 'shepherding', 'publicity', 'welfare', 'departmentLeader'
];

function currentStaff(req) {
  return (req.session && req.session.staff) || null;
}

// Who to stamp on a record they just created. Records outlive sessions, so this
// is stored as a readable name rather than an account id.
function actorName(req) {
  const staff = currentStaff(req);
  if (staff) return staff.name || staff.username;
  if (req.session && req.session.isAdmin) return 'Admin';
  if (req.session && req.session.isShepherd) return 'Shepherding';
  return '';
}

function hasRole(req, role) {
  if (!req.session) return false;
  if (req.session.isAdmin) return true;
  const staff = currentStaff(req);
  if (staff && staff.role === 'nationalCoordinator') return true; // national outranks every office
  if (role === 'shepherding' && req.session.isShepherd) return true;
  return !!(staff && staff.role === role);
}

// Read access: the role itself, or the coordinator who oversees all of them
// (within their own chapter — chapterFilter() is what actually confines it).
// National is deliberately excluded from that blanket bypass — a Chapter
// Coordinator outranks every office in their own chapter, but not National.
function canView(req, role) {
  if (role === 'nationalCoordinator') return hasRole(req, 'nationalCoordinator');
  return hasRole(req, role) || hasRole(req, 'coordinator');
}

function requireRole(role) {
  return (req, res, next) => {
    if (hasRole(req, role)) return next();
    return res.status(401).json({ error: 'Not authenticated' });
  };
}

function requireViewRole(role) {
  return (req, res, next) => {
    if (canView(req, role)) return next();
    return res.status(401).json({ error: 'Not authenticated' });
  };
}

const requireFinance = requireRole('finance');
const requirePublicity = requireRole('publicity');
const requireCoordinator = requireRole('coordinator');

// ---------- chapter hierarchy helpers ----------
// Chapter Admin (or above): the operational tier from section 5 — manages
// users/content/events/forms/attendance/reports for their own chapter.
function isChapterAdminOrAbove(req) {
  if (req.session && req.session.isAdmin) return true;
  const staff = currentStaff(req);
  if (staff && staff.role === 'nationalCoordinator') return true;
  return !!(staff && staff.chapterId && ['coordinator', 'chapterAdmin'].includes(staff.role));
}
function requireChapterAdmin(req, res, next) {
  if (isChapterAdminOrAbove(req)) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}
// Chapter Coordinator (or above): the top chapter authority — approvals,
// chapter-wide announcements, assigning who runs the chapter's offices.
function isChapterCoordinatorOrAbove(req) {
  if (req.session && req.session.isAdmin) return true;
  const staff = currentStaff(req);
  if (staff && staff.role === 'nationalCoordinator') return true;
  return !!(staff && staff.chapterId && staff.role === 'coordinator');
}
function requireChapterCoordinator(req, res, next) {
  if (isChapterCoordinatorOrAbove(req)) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

app.post('/api/portal/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  try {
    // The main env-configured admin login doubles as the bootstrap National Coordinator.
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'changeme';
    if (username === adminUser && password === adminPass) {
      req.session.isAdmin = true;
      req.session.staff = { id: '', username: adminUser, name: 'National Administrator', role: 'nationalCoordinator', chapterId: '' };
      return res.json({ success: true, staff: req.session.staff });
    }

    // The shepherding portal shipped with an env-file login before leadership
    // accounts existed. Honour it here so whoever is using it today keeps
    // getting in while the admin creates their proper account.
    if (process.env.SHEPHERD_USERNAME
        && username === process.env.SHEPHERD_USERNAME
        && password === process.env.SHEPHERD_PASSWORD) {
      req.session.isShepherd = true;
      // Pinned to the seed chapter — this credential predates chapters existing at all.
      req.session.staff = { id: '', username, name: 'Shepherding Head', role: 'shepherding', chapterId: rolesLib.LEGACY_CHAPTER_ID };
      return res.json({ success: true, staff: req.session.staff });
    }

    const user = await models.StaffUser.findOne({ username: String(username).toLowerCase().trim() });
    if (!user || !user.active) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    req.session.staff = {
      id: user.id, username: user.username, name: user.name || user.username,
      role: user.role, chapterId: user.chapterId || ''
    };
    models.StaffUser.updateOne({ id: user.id }, { $set: { lastLoginAt: new Date() } }).catch(() => {});
    res.json({ success: true, staff: req.session.staff });
  } catch (e) {
    res.status(500).json({ error: 'Could not sign you in right now. Please try again.' });
  }
});

app.post('/api/portal/logout', (req, res) => {
  if (req.session) {
    delete req.session.staff;
    delete req.session.isShepherd;
  }
  res.json({ success: true });
});

// Tells a portal page who is signed in and which areas they may open.
app.get('/api/portal/me', async (req, res) => {
  const staff = currentStaff(req);
  const isAdmin = !!(req.session && req.session.isAdmin);
  const scope = rolesLib.getActingScope(req);
  let chapter = null;
  if (scope.chapterId && scope.chapterId !== '__none__') {
    chapter = await repo.getById('chapters', scope.chapterId).catch(() => null);
  }
  res.json({
    staff: staff ? { ...staff, roleLabel: rolesLib.roleLabel(staff.role) } : null,
    isAdmin,
    isNational: scope.isNational,
    chapter: chapter ? { id: chapter.id, name: chapter.name } : null,
    access: PORTAL_ROLES.reduce((acc, role) => {
      acc[role] = { view: canView(req, role), edit: hasRole(req, role) };
      return acc;
    }, {})
  });
});

// ---------- member auth middleware ----------
function requireMember(req, res, next) {
  if (req.session && req.session.memberId) return next();
  return res.status(401).json({ error: 'Please log in to continue' });
}

// ---------- public chapter context ----------
// Anonymous/public pages send which chapter they're browsing via this header
// (see main.js: fetchJSON attaches it automatically once a chapter is
// selected). Chapter-scoped public GET routes use it to show only that
// chapter's content. Absent (old cached client, or nobody has picked yet) ->
// '' -> those routes fall back to showing everything, i.e. exactly today's
// single-chapter behaviour, so a rollout in progress never looks broken.
function publicChapterId(req) {
  const id = req.headers['x-chapter-id'];
  return typeof id === 'string' && id.trim() ? id.trim() : '';
}

// For anonymous public *submissions* (join request / prayer request /
// testimony / contact message): the X-Chapter-Id header is normally present
// (main.js sends it once a chapter is selected), but this is the safety net.
// With exactly one active chapter there's no ambiguity to ask about, so this
// defaults to it — the same "single chapter, zero friction" rule used
// elsewhere — rather than ever letting someone's message silently vanish
// into an unscoped void no chapter's inbox looks at. With more than one
// active chapter and no header, the caller must reject rather than guess
// which chapter's inbox should see it.
async function resolvePublicChapterId(req) {
  const explicit = publicChapterId(req);
  if (explicit) return explicit;
  const chapters = await repo.getAll('chapters', { status: 'active' });
  return chapters.length === 1 ? chapters[0].id : '';
}

// A handful of read routes (departments/events/sermons/pages/executives/
// testimonies) serve both the public site and the admin/leadership
// dashboards. An authenticated chapter-scoped session always wins — so a
// Chapter Admin's dashboard shows their own chapter regardless of whatever
// the public chapter-picker last selected on that browser. A national/admin
// session with no chapter chosen sees everything, matching today's
// behaviour. A genuinely anonymous visitor falls back to the public header.
function contentChapterFilter(req) {
  const scope = rolesLib.getActingScope(req);
  if (scope.kind === 'anonymous') {
    const chapterId = publicChapterId(req);
    return chapterId ? { chapterId } : {};
  }
  return rolesLib.chapterFilter(req, { required: false });
}

// ---------- notifications helper ----------
// Saves a notification for the in-app feed AND fires a real push to every
// subscribed device. Used both by the manual admin route and automatic
// triggers (new event, new sermon, birthdays).
// `chapterId` blank = national broadcast, visible in every chapter's feed —
// pass a real chapter id to keep an announcement inside one chapter.
async function createNotification(title, body, url, source, chapterId) {
  const notif = await repo.create('notifications', {
    chapterId: chapterId || '', title, body, url: url || '/index.html', source: source || 'admin'
  }, 'notif');
  push.sendPushToAll({ title, body, url: url || '/index.html' }, chapterId).catch(() => {});
  return notif;
}

// ---------- admin email helper ----------
function escapeHtmlForEmail(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
// Fire-and-forget email to whatever address is set in Site Settings, used for
// things the admin should know about quickly (a new join request, a contact
// message). Never blocks or fails the request that triggered it.
async function notifyAdminByEmail(subject, html) {
  try {
    const settings = await repo.getSettings();
    if (!settings.email) return; // no admin email configured — nothing to send to
    mailer.sendMail({ to: settings.email, subject, html }).catch(() => {});
  } catch (e) { /* non-critical — never let this break the original request */ }
}

// Same idea, but for mail that belongs to one particular office (shepherding,
// finance, publicity). Falls back to the main contact address when that office
// hasn't set its own, and de-duplicates so nobody gets the same mail twice.
async function notifyOfficeByEmail(officeKey, subject, html) {
  try {
    const settings = await repo.getSettings();
    const recipients = [...new Set([settings[officeKey], settings.email].filter(Boolean))];
    if (!recipients.length) return;
    mailer.sendMail({ to: recipients.join(','), subject, html }).catch(() => {});
  } catch (e) { /* non-critical */ }
}

// ---------- member auth routes ----------
// Registration is multipart now — a profile photo is compulsory for member
// registration (section 6), same upload pipeline as the profile-photo update
// route below. Every new account starts life as a 'visitor': the Shepherding
// workflow (section 7) is what moves someone from here to an active member.
app.post('/api/auth/register', loginLimiter, upload.single('profileImage'), async (req, res) => {
  const { name, email, password, phone, level, programme, hostel, department, chapterId, birthdayMonth, birthdayDay } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (!chapterId) {
    return res.status(400).json({ error: 'Please select your ACONSU chapter' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'A profile photo is required to register' });
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
    const existing = await models.Member.findOne({ email: email.toLowerCase().trim() });
    if (existing) return res.status(400).json({ error: 'An account with this email already exists' });

    const compressed = await compressIfImage(req.file.buffer, req.file.mimetype);
    const profileImageFileId = String(await gridfs.uploadBuffer(compressed.buffer, req.file.originalname, {
      category: 'member-profile', contentType: compressed.contentType, title: name, chapterId: chapter.id
    }));

    const passwordHash = await bcrypt.hash(password, 10);
    const member = await repo.create('members', {
      chapterId: chapter.id,
      name, email: email.toLowerCase().trim(), passwordHash,
      phone: phone || '', level: level || '', programme: programme || '', hostel: hostel || '',
      department: department || '',
      profileImageFileId,
      membershipStage: 'visitor',
      qrToken: crypto.randomBytes(16).toString('hex'),
      birthdayMonth: month, birthdayDay: day
    }, 'mem');
    req.session.memberId = member.id;
    res.json({ success: true, member: { id: member.id, name: member.name, email: member.email, chapterId: member.chapterId } });
  } catch (e) {
    res.status(500).json({ error: 'Could not create account. Please try again.' });
  }
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  try {
    const member = await models.Member.findOne({ email: email.toLowerCase().trim() });
    if (!member) return res.status(401).json({ error: 'Invalid email or password' });
    const match = await bcrypt.compare(password, member.passwordHash || '');
    if (!match) return res.status(401).json({ error: 'Invalid email or password' });
    req.session.memberId = member.id;
    res.json({ success: true, member: { id: member.id, name: member.name, email: member.email } });
  } catch (e) {
    res.status(500).json({ error: 'Could not log in. Please try again.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  delete req.session.memberId;
  res.json({ success: true });
});

// ---------- password reset ----------
app.post('/api/auth/forgot-password', loginLimiter, async (req, res) => {
  const { email } = req.body;
  // Always respond with the same generic message whether or not the email exists —
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

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const resetLink = `${baseUrl}/reset-password.html?token=${rawToken}&email=${encodeURIComponent(member.email)}`;
    mailer.sendMail({
      to: member.email,
      subject: 'Reset your ACONSU password',
      html: `<p>Hi ${escapeHtmlForEmail(member.name)},</p><p>Tap the link below to reset your ACONSU password. This link expires in 1 hour.</p><p><a href="${resetLink}">${resetLink}</a></p><p>If you didn't request this, you can safely ignore this email.</p>`
    }).catch(() => {});

    res.json(genericMsg);
  } catch (e) {
    res.json(genericMsg); // still generic, even on internal error — never leak account existence
  }
});

app.post('/api/auth/reset-password', loginLimiter, async (req, res) => {
  const { token, email, newPassword } = req.body;
  if (!token || !email || !newPassword) return res.status(400).json({ error: 'Missing reset details' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
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
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not reset password. Please try again.' });
  }
});

app.get('/api/auth/me', async (req, res) => {
  if (!req.session || !req.session.memberId) return res.json({ member: null });
  try {
    const member = await repo.getById('members', req.session.memberId);
    if (!member) return res.json({ member: null });
    const { passwordHash, ...safe } = member;
    res.json({ member: safe });
  } catch (e) {
    res.json({ member: null });
  }
});

// Ghanaian academic years run roughly August-to-July, so "which year is this"
// is computed rather than asked for — used only to label an academic-history
// snapshot (section 8), never anything security- or access-relevant.
function currentAcademicYearLabel() {
  const now = new Date();
  const y = now.getFullYear();
  return now.getMonth() + 1 >= 8 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
}

app.put('/api/member/profile', requireMember, upload.single('profileImage'), async (req, res) => {
  try {
    const existing = await repo.getById('members', req.session.memberId);
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
    const level = req.body.level !== undefined ? req.body.level : existing.level;
    const hostel = req.body.hostel !== undefined ? req.body.hostel : existing.hostel;
    // A real academic-year change (not just a typo fix) — snapshot where they
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
      phone: req.body.phone || '',
      level,
      programme: req.body.programme !== undefined ? req.body.programme : existing.programme,
      hostel,
      academicHistory,
      department: req.body.department || '',
      profileImageFileId,
      birthdayMonth: month,
      birthdayDay: day
    };
    const updated = await repo.updateById('members', req.session.memberId, { ...existing, ...updates });
    const { passwordHash, ...safe } = updated;
    res.json({ success: true, member: safe });
  } catch (e) {
    res.status(500).json({ error: 'Could not update profile' });
  }
});

app.put('/api/member/password', requireMember, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both current and new password are required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  try {
    const member = await models.Member.findOne({ id: req.session.memberId });
    if (!member) return res.status(404).json({ error: 'Account not found' });
    const match = await bcrypt.compare(currentPassword, member.passwordHash || '');
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });
    member.passwordHash = await bcrypt.hash(newPassword, 10);
    await member.save();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not update password' });
  }
});

// ---------- engagement: streak check-in ----------
// Called once per day (client throttles via localStorage) whenever a logged-in
// member opens the app. Consecutive-day visits build a streak; a missed day resets it.
app.post('/api/member/checkin', requireMember, async (req, res) => {
  try {
    const member = await models.Member.findOne({ id: req.session.memberId });
    if (!member) return res.status(404).json({ error: 'Account not found' });

    const today = new Date();
    const todayKey = today.toISOString().slice(0, 10);
    if (member.lastActiveDate === todayKey) {
      return res.json({ currentStreak: member.currentStreak, longestStreak: member.longestStreak });
    }
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = yesterday.toISOString().slice(0, 10);

    member.currentStreak = member.lastActiveDate === yesterdayKey ? member.currentStreak + 1 : 1;
    member.longestStreak = Math.max(member.longestStreak || 0, member.currentStreak);
    member.lastActiveDate = todayKey;
    await member.save();
    res.json({ currentStreak: member.currentStreak, longestStreak: member.longestStreak });
  } catch (e) {
    res.status(500).json({ error: 'Could not update streak' });
  }
});

// ---------- engagement: Bible reading count ----------
app.post('/api/member/bible-read', requireMember, async (req, res) => {
  try {
    await models.Member.updateOne({ id: req.session.memberId }, { $inc: { bibleChaptersRead: 1 } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not record reading' });
  }
});

// ---------- engagement: badges ----------
// Computed live from real activity rather than stored as a separate ledger —
// always accurate, and there's nothing to keep in sync if data changes later.
app.get('/api/member/badges', requireMember, async (req, res) => {
  try {
    const member = await models.Member.findOne({ id: req.session.memberId }).lean();
    if (!member) return res.status(404).json({ error: 'Account not found' });

    const email = (member.email || '').toLowerCase();
    const [joinRequests, prayerRequests, eventRegs] = await Promise.all([
      models.JoinRequest.countDocuments({ email: new RegExp(`^${email}$`, 'i') }),
      models.PrayerRequest.countDocuments({ email: new RegExp(`^${email}$`, 'i') }),
      models.EventRegistration.countDocuments({ email: new RegExp(`^${email}$`, 'i') })
    ]);

    const badges = [
      { id: 'welcome', label: 'Welcome to ACONSU', icon: '👋', earned: true },
      { id: 'streak7', label: '7-Day Streak', icon: '🔥', earned: (member.longestStreak || 0) >= 7 },
      { id: 'streak30', label: '30-Day Streak', icon: '⚡', earned: (member.longestStreak || 0) >= 30 },
      { id: 'reader10', label: 'Scripture Reader', icon: '📖', earned: (member.bibleChaptersRead || 0) >= 10 },
      { id: 'reader50', label: 'Deeply Rooted', icon: '🌳', earned: (member.bibleChaptersRead || 0) >= 50 },
      { id: 'prayer', label: 'Prayer Warrior', icon: '🙏', earned: prayerRequests >= 1 },
      { id: 'serving', label: 'Serving Heart', icon: '❤️', earned: joinRequests >= 1 },
      { id: 'events', label: 'Event Goer', icon: '🎉', earned: eventRegs >= 1 }
    ];
    res.json({
      badges,
      earnedCount: badges.filter(b => b.earned).length,
      currentStreak: member.currentStreak || 0,
      longestStreak: member.longestStreak || 0,
      bibleChaptersRead: member.bibleChaptersRead || 0
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not load badges' });
  }
});

// ---------- Sermon Notes (section 17) ----------
// Personal and private — a member only ever sees their own; there is
// deliberately no admin/shepherding view of these, unlike everything else
// in the app that's chapter-visible to some staff role.
app.get('/api/member/sermon-notes', requireMember, async (req, res) => {
  try {
    const notes = await repo.getAll('sermonNotes', { memberId: req.session.memberId });
    res.json(notes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  } catch (e) {
    res.status(500).json({ error: 'Could not load your sermon notes' });
  }
});

app.post('/api/member/sermon-notes', requireMember, async (req, res) => {
  try {
    const member = await repo.getById('members', req.session.memberId);
    const { sermonTitle, preacher, date, scripture, notes, summary, keyLessons, reflections } = req.body;
    const note = await repo.create('sermonNotes', {
      memberId: req.session.memberId, chapterId: member ? member.chapterId : '',
      sermonTitle: sermonTitle || '', preacher: preacher || '', date: date || '',
      scripture: scripture || '', notes: notes || '', summary: summary || '',
      keyLessons: keyLessons || '', reflections: reflections || ''
    }, 'note');
    res.json({ success: true, item: note });
  } catch (e) {
    res.status(500).json({ error: 'Could not save this sermon note' });
  }
});

app.put('/api/member/sermon-notes/:id', requireMember, async (req, res) => {
  try {
    const filter = { memberId: req.session.memberId };
    const existing = await repo.getById('sermonNotes', req.params.id, filter);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { sermonTitle, preacher, date, scripture, notes, summary, keyLessons, reflections } = req.body;
    const note = await repo.updateById('sermonNotes', req.params.id, {
      ...existing,
      sermonTitle: sermonTitle !== undefined ? sermonTitle : existing.sermonTitle,
      preacher: preacher !== undefined ? preacher : existing.preacher,
      date: date !== undefined ? date : existing.date,
      scripture: scripture !== undefined ? scripture : existing.scripture,
      notes: notes !== undefined ? notes : existing.notes,
      summary: summary !== undefined ? summary : existing.summary,
      keyLessons: keyLessons !== undefined ? keyLessons : existing.keyLessons,
      reflections: reflections !== undefined ? reflections : existing.reflections
    }, filter);
    res.json({ success: true, item: note });
  } catch (e) {
    res.status(500).json({ error: 'Could not update this sermon note' });
  }
});

app.delete('/api/member/sermon-notes/:id', requireMember, async (req, res) => {
  try {
    await repo.removeById('sermonNotes', req.params.id, { memberId: req.session.memberId });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete this sermon note' });
  }
});

app.get('/api/birthdays/today', async (req, res) => {
  try {
    const now = new Date();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const members = await models.Member.find({ birthdayMonth: month, birthdayDay: day, ...contentChapterFilter(req) }).lean();
    // Privacy: only first name + last initial, and a profile photo if they have one.
    // No email, phone, level, or any other identifying detail is exposed publicly.
    const celebrants = members.map((m) => {
      const parts = (m.name || '').trim().split(/\s+/);
      const first = parts[0] || 'A member';
      const lastInitial = parts.length > 1 ? `${parts[parts.length - 1].charAt(0)}.` : '';
      return { displayName: lastInitial ? `${first} ${lastInitial}` : first, profileImageFileId: m.profileImageFileId || '' };
    });
    res.json(celebrants);
  } catch (e) {
    res.status(500).json({ error: 'Could not load birthdays' });
  }
});

// ---------- notifications & push ----------
app.get('/api/notifications', async (req, res) => {
  try {
    const base = contentChapterFilter(req);
    // Always include national broadcasts (blank chapterId) alongside this
    // chapter's own — a national announcement should reach every chapter.
    const filter = base.chapterId ? { $or: [{ chapterId: base.chapterId }, { chapterId: '' }] } : base;
    const items = await repo.getAll('notifications', filter);
    res.json(items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 40));
  } catch (e) {
    res.status(500).json({ error: 'Could not load notifications' });
  }
});

app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});

app.post('/api/push/subscribe', async (req, res) => {
  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
  try {
    const existing = await models.PushSubscription.findOne({ endpoint: subscription.endpoint });
    if (existing) return res.json({ success: true }); // already subscribed on this device
    const memberId = (req.session && req.session.memberId) || '';
    // Denormalized so a chapter-scoped push send doesn't need to join through
    // Member every time — see lib/push.js.
    const owner = memberId ? await repo.getById('members', memberId) : null;
    await repo.create('pushSubscriptions', {
      endpoint: subscription.endpoint,
      keys: subscription.keys || {},
      memberId,
      chapterId: (owner && owner.chapterId) || ''
    }, 'push');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not save subscription' });
  }
});

app.post('/api/push/unsubscribe', async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Endpoint required' });
  try {
    await models.PushSubscription.deleteOne({ endpoint });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not remove subscription' });
  }
});

app.post('/api/admin/notifications', requireAdmin, async (req, res) => {
  const { title, body, url } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Title and message are required' });
  try {
    const notif = await createNotification(title, body, url, 'admin');
    res.json({ success: true, item: notif });
  } catch (e) {
    res.status(500).json({ error: 'Could not send notification' });
  }
});


const BIBLE_TRANSLATIONS = [
  { code: 'kjv', label: 'King James Version (KJV)' },
  { code: 'web', label: 'World English Bible (WEB)' },
  { code: 'webbe', label: 'World English Bible, British Edition' },
  { code: 'oeb-us', label: 'Open English Bible, US Edition' },
  { code: 'clementine', label: 'Clementine Latin Vulgate' }
];
const bibleCache = new Map(); // key -> { data, expiresAt }
const BIBLE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — scripture text doesn't change

app.get('/api/bible/books', (req, res) => {
  res.json({ books: BIBLE_BOOKS, translations: BIBLE_TRANSLATIONS });
});

app.get('/api/bible/passage', async (req, res) => {
  const { book, chapter, translation } = req.query;
  if (!book || !chapter) return res.status(400).json({ error: 'Book and chapter are required' });
  const trans = translation || 'kjv';
  const cacheKey = `${book}|${chapter}|${trans}`.toLowerCase();

  const cached = bibleCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json(cached.data);
  }

  try {
    const reference = encodeURIComponent(`${book} ${chapter}`);
    const url = `https://bible-api.com/${reference}?translation=${encodeURIComponent(trans)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const apiRes = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!apiRes.ok) throw new Error('Bible service unavailable');
    const data = await apiRes.json();
    if (data.error) return res.status(404).json({ error: 'Passage not found' });

    const payload = {
      reference: data.reference,
      translation: trans,
      verses: (data.verses || []).map((v) => ({ verse: v.verse, text: v.text.trim() }))
    };
    bibleCache.set(cacheKey, { data: payload, expiresAt: Date.now() + BIBLE_CACHE_TTL_MS });
    res.json(payload);
  } catch (e) {
    res.status(502).json({ error: 'Could not reach the Bible service right now. Please try again in a moment.' });
  }
});


// ---------- Bible Study (section 16) ----------
// Always tied to a real passage — studyReference is meant to be handed
// straight to /api/bible/passage above, so a study never repeats scripture
// text that's already available in the reader.
app.get('/api/bible-studies', async (req, res) => {
  try {
    const studies = await repo.getAll('bibleStudies', contentChapterFilter(req));
    res.json(studies.sort((a, b) => (a.date < b.date ? 1 : -1)));
  } catch (e) {
    res.status(500).json({ error: 'Could not load Bible studies' });
  }
});

app.get('/api/bible-studies/:id', async (req, res) => {
  try {
    const study = await repo.getById('bibleStudies', req.params.id, contentChapterFilter(req));
    if (!study) return res.status(404).json({ error: 'Bible study not found' });
    res.json(study);
  } catch (e) {
    res.status(500).json({ error: 'Could not load this Bible study' });
  }
});

app.post('/api/admin/bible-studies', requireBibleStudyManager, async (req, res) => {
  try {
    const chapterId = await resolveChapterIdForWrite(req, req.body.chapterId);
    if (!chapterId) return res.status(400).json({ error: 'A chapter is required.' });
    const { topic, date, scriptureReference, studyMaterial, questions, notes, resources } = req.body;
    if (!topic) return res.status(400).json({ error: 'A topic is required' });
    const study = await repo.create('bibleStudies', {
      chapterId, topic, date: date || '', scriptureReference: scriptureReference || '',
      studyMaterial: studyMaterial || '',
      questions: Array.isArray(questions) ? questions.filter(Boolean) : [],
      notes: notes || '',
      resources: Array.isArray(resources) ? resources.filter(Boolean) : [],
      createdBy: actorName(req)
    }, 'stud');
    res.json({ success: true, item: study });
  } catch (e) {
    res.status(500).json({ error: 'Could not save this Bible study' });
  }
});

app.put('/api/admin/bible-studies/:id', requireBibleStudyManager, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req, { required: false });
    const existing = await repo.getById('bibleStudies', req.params.id, filter);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { chapterId, ...body } = req.body;
    const study = await repo.updateById('bibleStudies', req.params.id, {
      ...existing, ...body,
      questions: Array.isArray(body.questions) ? body.questions.filter(Boolean) : existing.questions,
      resources: Array.isArray(body.resources) ? body.resources.filter(Boolean) : existing.resources
    }, filter);
    res.json({ success: true, item: study });
  } catch (e) {
    res.status(500).json({ error: 'Could not update this Bible study' });
  }
});

app.delete('/api/admin/bible-studies/:id', requireBibleStudyManager, async (req, res) => {
  try {
    await repo.removeById('bibleStudies', req.params.id, rolesLib.chapterFilter(req, { required: false }));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete this Bible study' });
  }
});

// ---------- Form Builder (section 11) ----------
// One generic engine (fields + submissions) reused for event registration,
// travelling-event sign-ups, executive info, department activities and
// welfare — a new "kind" of form never needs a new schema or a new route.
const FORM_FIELD_TYPES = ['short_text', 'long_text', 'multiple_choice', 'checkboxes', 'dropdown', 'date', 'time', 'phone', 'email', 'file'];

function cleanFormFields(fields) {
  return (Array.isArray(fields) ? fields : [])
    .filter((f) => f && f.label && FORM_FIELD_TYPES.includes(f.type))
    .map((f, i) => ({
      id: f.id || repo.genId('fld'),
      label: String(f.label).trim(),
      type: f.type,
      required: !!f.required,
      options: Array.isArray(f.options) ? f.options.filter(Boolean) : [],
      order: f.order !== undefined ? Number(f.order) : i
    }));
}

// Chapter Admin/Coordinator or Publicity — the set of roles that already
// manage chapter content (forms, uploads, flyers) elsewhere in the app.
function requireContentManager(req, res, next) {
  if (isChapterAdminOrAbove(req) || hasRole(req, 'publicity')) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

function requireBibleStudyManager(req, res, next) {
  if (isChapterAdminOrAbove(req) || hasRole(req, 'executive')) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

app.get('/api/forms', async (req, res) => {
  try {
    const forms = await repo.getAll('forms', { ...contentChapterFilter(req), isOpen: true });
    res.json(forms.map(({ fields, ...f }) => ({ ...f, fieldCount: fields.length })));
  } catch (e) {
    res.status(500).json({ error: 'Could not load forms' });
  }
});

app.get('/api/forms/:id', async (req, res) => {
  try {
    const form = await repo.getById('forms', req.params.id, contentChapterFilter(req));
    if (!form) return res.status(404).json({ error: 'Form not found' });
    res.json(form);
  } catch (e) {
    res.status(500).json({ error: 'Could not load this form' });
  }
});

app.post('/api/forms/:id/submit', formLimiter, async (req, res) => {
  try {
    const form = await repo.getById('forms', req.params.id);
    if (!form) return res.status(404).json({ error: 'Form not found' });
    if (!form.isOpen) return res.status(400).json({ error: 'This form is closed and no longer accepting responses.' });
    if (form.closesAt && new Date(form.closesAt) < new Date()) {
      return res.status(400).json({ error: 'This form is closed and no longer accepting responses.' });
    }
    const answers = req.body.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
    const missing = form.fields.filter((f) => f.required && !String(answers[f.id] ?? '').trim());
    if (missing.length) {
      return res.status(400).json({ error: `Please fill in: ${missing.map((f) => f.label).join(', ')}` });
    }
    const memberId = (req.session && req.session.memberId) || '';
    const member = memberId ? await repo.getById('members', memberId) : null;
    const submission = await repo.create('formSubmissions', {
      chapterId: form.chapterId,
      formId: form.id,
      memberId,
      submitterName: req.body.submitterName || (member ? member.name : ''),
      submitterEmail: req.body.submitterEmail || (member ? member.email : ''),
      answers
    }, 'sub');
    res.json({ success: true, item: submission });
  } catch (e) {
    res.status(500).json({ error: 'Could not submit this form. Please try again.' });
  }
});

app.get('/api/admin/forms', requireContentManager, async (req, res) => {
  try {
    const forms = await repo.getAll('forms', rolesLib.chapterFilter(req, { required: false }));
    res.json(forms.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  } catch (e) {
    res.status(500).json({ error: 'Could not load forms' });
  }
});

app.post('/api/admin/forms', requireContentManager, async (req, res) => {
  try {
    const chapterId = await resolveChapterIdForWrite(req, req.body.chapterId);
    if (!chapterId) return res.status(400).json({ error: 'A chapter is required.' });
    const { title, description, category, linkedEventId, fields, closesAt } = req.body;
    if (!title) return res.status(400).json({ error: 'A title is required' });
    const form = await repo.create('forms', {
      chapterId, title, description: description || '',
      category: ['event_registration', 'travelling_event', 'executive', 'department', 'welfare', 'custom'].includes(category) ? category : 'custom',
      linkedEventId: linkedEventId || '',
      fields: cleanFormFields(fields),
      isOpen: true, closesAt: closesAt || '',
      createdBy: actorName(req)
    }, 'form');
    res.json({ success: true, item: form });
  } catch (e) {
    res.status(500).json({ error: 'Could not create this form' });
  }
});

app.put('/api/admin/forms/:id', requireContentManager, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req, { required: false });
    const existing = await repo.getById('forms', req.params.id, filter);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { chapterId, fields, ...body } = req.body;
    const form = await repo.updateById('forms', req.params.id, {
      ...existing, ...body,
      fields: fields !== undefined ? cleanFormFields(fields) : existing.fields
    }, filter);
    res.json({ success: true, item: form });
  } catch (e) {
    res.status(500).json({ error: 'Could not update this form' });
  }
});

app.patch('/api/admin/forms/:id/toggle', requireContentManager, async (req, res) => {
  try {
    const form = await repo.patchById('forms', req.params.id, { isOpen: !!req.body.isOpen }, rolesLib.chapterFilter(req, { required: false }));
    if (!form) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, item: form });
  } catch (e) {
    res.status(500).json({ error: 'Could not update this form' });
  }
});

app.delete('/api/admin/forms/:id', requireContentManager, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req, { required: false });
    await repo.removeById('forms', req.params.id, filter);
    await models.FormSubmission.deleteMany({ formId: req.params.id, ...filter });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete this form' });
  }
});

app.get('/api/admin/forms/:id/submissions', requireContentManager, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req, { required: false });
    const form = await repo.getById('forms', req.params.id, filter);
    if (!form) return res.status(404).json({ error: 'Form not found' });
    const submissions = await repo.getAll('formSubmissions', { formId: req.params.id, ...filter });
    submissions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ form, submissions });
  } catch (e) {
    res.status(500).json({ error: 'Could not load submissions' });
  }
});

// Resolves "which chapter" for a request that might be a member session, a
// staff session, or anonymous — the community features below (Groups, Chat,
// Volunteer scheduling, Welfare, Giving) are read/written by both members
// and staff, unlike most Phase 2 routes which were one or the other.
async function resolveViewerChapterId(req) {
  if (req.session && req.session.memberId) {
    const member = await repo.getById('members', req.session.memberId);
    return member ? member.chapterId : '';
  }
  const scope = rolesLib.getActingScope(req);
  if (scope.chapterId && scope.chapterId !== '__none__') return scope.chapterId;
  return publicChapterId(req);
}

// Community routes live in focused modules. Dependencies are injected rather
// than imported there so authentication and chapter scoping remain the single
// source of truth in this application entry point.
const communityRouteDeps = {
  repo, models, rolesLib, requireMember, requireContentManager, requireShepherd,
  requireViewRole, requireFinance, requireChapterAdmin, isChapterAdminOrAbove,
  hasRole, resolveViewerChapterId, resolveChapterIdForWrite, actorName,
  createNotification, notifyAdminByEmail
};
registerGroupRoutes(app, communityRouteDeps);
registerChatRoutes(app, communityRouteDeps);
const { logMilestone } = registerMemberServiceRoutes(app, communityRouteDeps);

/* Legacy in-place versions of the community routes moved to routes/.
 * Kept temporarily in this comment only to make the extraction reviewable;
 * the live registrations above are the sole active implementations.
// ============================================================
// Groups (section 20) — Bible Study / Prayer / Fellowship / Department /
// Cell / other. A group's leader is very often just a member, not a portal
// account holder, so leader permission checks compare against the member
// session directly rather than going through the staff-only chapterFilter.
// ============================================================
function isGroupLeaderOrAbove(req, group) {
  if (isChapterAdminOrAbove(req)) return true;
  return !!(req.session && req.session.memberId && group.leaderMemberId === req.session.memberId);
}
function isGroupMember(req, group) {
  return !!(req.session && req.session.memberId && group.memberIds.includes(req.session.memberId));
}

app.get('/api/groups', async (req, res) => {
  try {
    const chapterId = await resolveViewerChapterId(req);
    const groups = await repo.getAll('groups', chapterId ? { chapterId } : {});
    res.json(groups.map(({ memberIds, ...g }) => ({ ...g, memberCount: memberIds.length })));
  } catch (e) {
    res.status(500).json({ error: 'Could not load groups' });
  }
});

app.get('/api/groups/:id', async (req, res) => {
  try {
    const group = await repo.getById('groups', req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    const canSeeRoster = isGroupMember(req, group) || isGroupLeaderOrAbove(req, group);
    let members = [];
    if (canSeeRoster && group.memberIds.length) {
      const all = await repo.getAll('members', { id: { $in: group.memberIds } });
      members = all.map((m) => ({ id: m.id, name: m.name, profileImageFileId: m.profileImageFileId }));
    }
    const { memberIds, ...safe } = group;
    res.json({ ...safe, memberCount: memberIds.length, members, isMember: isGroupMember(req, group), isLeader: isGroupLeaderOrAbove(req, group) });
  } catch (e) {
    res.status(500).json({ error: 'Could not load this group' });
  }
});

app.post('/api/admin/groups', requireContentManager, async (req, res) => {
  try {
    const chapterId = await resolveChapterIdForWrite(req, req.body.chapterId);
    if (!chapterId) return res.status(400).json({ error: 'A chapter is required.' });
    const { name, type, description, linkedDepartmentId, leaderMemberId, meetingDay, meetingTime, meetingLocation } = req.body;
    if (!name) return res.status(400).json({ error: 'A name is required' });
    let leaderName = '';
    if (leaderMemberId) {
      const leader = await repo.getById('members', leaderMemberId, { chapterId });
      leaderName = leader ? leader.name : '';
    }
    const group = await repo.create('groups', {
      chapterId,
      name,
      type: ['bible_study', 'prayer', 'fellowship', 'department', 'cell', 'other'].includes(type) ? type : 'other',
      description: description || '', linkedDepartmentId: linkedDepartmentId || '',
      leaderMemberId: leaderMemberId || '', leaderName,
      meetingDay: meetingDay || '', meetingTime: meetingTime || '', meetingLocation: meetingLocation || '',
      memberIds: leaderMemberId ? [leaderMemberId] : [],
      createdBy: actorName(req)
    }, 'grp');
    res.json({ success: true, item: group });
  } catch (e) {
    res.status(500).json({ error: 'Could not create this group' });
  }
});

app.put('/api/admin/groups/:id', requireContentManager, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req, { required: false });
    const existing = await repo.getById('groups', req.params.id, filter);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { chapterId, memberIds, ...body } = req.body;
    let leaderName = existing.leaderName;
    if (body.leaderMemberId !== undefined && body.leaderMemberId !== existing.leaderMemberId) {
      const leader = body.leaderMemberId ? await repo.getById('members', body.leaderMemberId, filter) : null;
      leaderName = leader ? leader.name : '';
    }
    const group = await repo.updateById('groups', req.params.id, { ...existing, ...body, leaderName }, filter);
    res.json({ success: true, item: group });
  } catch (e) {
    res.status(500).json({ error: 'Could not update this group' });
  }
});

app.delete('/api/admin/groups/:id', requireContentManager, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req, { required: false });
    await repo.removeById('groups', req.params.id, filter);
    await models.GroupPost.deleteMany({ groupId: req.params.id });
    await models.GroupMeeting.deleteMany({ groupId: req.params.id });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete this group' });
  }
});

// A group's own leader (who may just be a member, no portal account) can
// keep the practical details current without needing Chapter Admin access.
app.put('/api/groups/:id', requireMember, async (req, res) => {
  try {
    const existing = await repo.getById('groups', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Group not found' });
    if (!isGroupLeaderOrAbove(req, existing)) return res.status(403).json({ error: 'Only the group leader can edit this group.' });
    const { description, meetingDay, meetingTime, meetingLocation, resources } = req.body;
    const updated = await repo.updateById('groups', req.params.id, {
      ...existing,
      description: description !== undefined ? description : existing.description,
      meetingDay: meetingDay !== undefined ? meetingDay : existing.meetingDay,
      meetingTime: meetingTime !== undefined ? meetingTime : existing.meetingTime,
      meetingLocation: meetingLocation !== undefined ? meetingLocation : existing.meetingLocation,
      resources: Array.isArray(resources) ? resources.filter((r) => r && r.title) : existing.resources
    });
    res.json({ success: true, item: updated });
  } catch (e) {
    res.status(500).json({ error: 'Could not update this group' });
  }
});

app.post('/api/groups/:id/join', requireMember, async (req, res) => {
  try {
    const group = await repo.getById('groups', req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    await models.Group.updateOne({ id: req.params.id }, { $addToSet: { memberIds: req.session.memberId } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not join this group' });
  }
});

app.post('/api/groups/:id/leave', requireMember, async (req, res) => {
  try {
    await models.Group.updateOne({ id: req.params.id }, { $pull: { memberIds: req.session.memberId } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not leave this group' });
  }
});

app.get('/api/groups/:id/posts', requireMember, async (req, res) => {
  try {
    const group = await repo.getById('groups', req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!isGroupMember(req, group) && !isGroupLeaderOrAbove(req, group)) {
      return res.status(403).json({ error: 'Join this group to see its posts.' });
    }
    const posts = await repo.getAll('groupPosts', { groupId: req.params.id });
    posts.sort((a, b) => (b.isAnnouncement - a.isAnnouncement) || (new Date(b.createdAt) - new Date(a.createdAt)));
    res.json(posts);
  } catch (e) {
    res.status(500).json({ error: 'Could not load posts' });
  }
});

app.post('/api/groups/:id/posts', requireMember, async (req, res) => {
  try {
    const group = await repo.getById('groups', req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!isGroupMember(req, group) && !isGroupLeaderOrAbove(req, group)) {
      return res.status(403).json({ error: 'Join this group to post.' });
    }
    if (!req.body.body || !req.body.body.trim()) return res.status(400).json({ error: 'A message is required' });
    const member = await repo.getById('members', req.session.memberId);
    const post = await repo.create('groupPosts', {
      chapterId: group.chapterId, groupId: group.id,
      authorMemberId: req.session.memberId, authorName: member ? member.name : '',
      body: req.body.body.trim(), isAnnouncement: !!req.body.isAnnouncement && isGroupLeaderOrAbove(req, group)
    }, 'gpost');
    res.json({ success: true, item: post });
  } catch (e) {
    res.status(500).json({ error: 'Could not post this' });
  }
});

app.get('/api/groups/:id/meetings', requireMember, async (req, res) => {
  try {
    const group = await repo.getById('groups', req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!isGroupMember(req, group) && !isGroupLeaderOrAbove(req, group)) {
      return res.status(403).json({ error: 'Join this group to see its meetings.' });
    }
    const meetings = await repo.getAll('groupMeetings', { groupId: req.params.id });
    res.json(meetings.sort((a, b) => (a.date < b.date ? 1 : -1)));
  } catch (e) {
    res.status(500).json({ error: 'Could not load meetings' });
  }
});

app.post('/api/groups/:id/meetings', requireMember, async (req, res) => {
  try {
    const group = await repo.getById('groups', req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    if (!isGroupLeaderOrAbove(req, group)) return res.status(403).json({ error: 'Only the group leader can log a meeting.' });
    const { date, topic, location, attendeeMemberIds, notes } = req.body;
    if (!date) return res.status(400).json({ error: 'A date is required' });
    const meeting = await repo.create('groupMeetings', {
      chapterId: group.chapterId, groupId: group.id, date, topic: topic || '', location: location || '',
      attendeeMemberIds: Array.isArray(attendeeMemberIds) ? attendeeMemberIds.filter((id) => group.memberIds.includes(id)) : [],
      notes: notes || '', recordedBy: actorName(req)
    }, 'gmeet');
    res.json({ success: true, item: meeting });
  } catch (e) {
    res.status(500).json({ error: 'Could not log this meeting' });
  }
});

// ============================================================
// Community Chat (section 19) — chapter-wide discussion, separate from a
// group's own feed. Moderation stays simple on purpose: hide (soft-delete —
// nothing is destroyed outright, just stops showing), report, and restrict
// a member from posting further.
// ============================================================
function requireChatModerator(req, res, next) {
  if (isChapterAdminOrAbove(req)) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

app.get('/api/chat/topics', requireMember, async (req, res) => {
  try {
    const chapterId = await resolveViewerChapterId(req);
    const topics = await repo.getAll('chatTopics', chapterId ? { chapterId } : {});
    const withMeta = await Promise.all(topics.map(async (t) => {
      const msgs = await repo.getAll('chatMessages', { topicId: t.id, hidden: false });
      const last = [...msgs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
      return { ...t, messageCount: msgs.length, lastActivity: last ? last.createdAt : t.createdAt };
    }));
    res.json(withMeta.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity)));
  } catch (e) {
    res.status(500).json({ error: 'Could not load discussions' });
  }
});

app.post('/api/chat/topics', requireMember, async (req, res) => {
  try {
    if (!req.body.title || !req.body.title.trim()) return res.status(400).json({ error: 'A title is required' });
    const chapterId = await resolveViewerChapterId(req);
    if (!chapterId) return res.status(400).json({ error: 'Could not determine your chapter.' });
    const member = await repo.getById('members', req.session.memberId);
    if (member && member.chatRestricted) return res.status(403).json({ error: 'Your posting privileges have been restricted. Contact your Chapter Admin.' });
    const topic = await repo.create('chatTopics', {
      chapterId, title: req.body.title.trim(), createdByMemberId: req.session.memberId, createdByName: member ? member.name : ''
    }, 'topic');
    res.json({ success: true, item: topic });
  } catch (e) {
    res.status(500).json({ error: 'Could not start this discussion' });
  }
});

app.get('/api/chat/topics/:id/messages', requireMember, async (req, res) => {
  try {
    const messages = await repo.getAll('chatMessages', { topicId: req.params.id, hidden: false });
    res.json(messages.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
  } catch (e) {
    res.status(500).json({ error: 'Could not load messages' });
  }
});

app.post('/api/chat/topics/:id/messages', requireMember, async (req, res) => {
  try {
    const topic = await repo.getById('chatTopics', req.params.id);
    if (!topic) return res.status(404).json({ error: 'Discussion not found' });
    if (topic.locked) return res.status(400).json({ error: 'This discussion has been locked.' });
    if (!req.body.body || !req.body.body.trim()) return res.status(400).json({ error: 'A message is required' });
    const member = await repo.getById('members', req.session.memberId);
    if (member && member.chatRestricted) return res.status(403).json({ error: 'Your posting privileges have been restricted. Contact your Chapter Admin.' });
    const message = await repo.create('chatMessages', {
      chapterId: topic.chapterId, topicId: topic.id, authorMemberId: req.session.memberId,
      authorName: member ? member.name : '', body: req.body.body.trim()
    }, 'msg');
    res.json({ success: true, item: message });
  } catch (e) {
    res.status(500).json({ error: 'Could not send this message' });
  }
});

app.post('/api/chat/messages/:id/report', requireMember, async (req, res) => {
  try {
    await models.ChatMessage.updateOne({ id: req.params.id }, { $inc: { reportCount: 1 } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not report this message' });
  }
});

app.patch('/api/chat/messages/:id/moderate', requireChatModerator, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req, { required: false });
    const hidden = req.body.hidden !== false;
    const item = await repo.patchById('chatMessages', req.params.id, { hidden, hiddenBy: hidden ? actorName(req) : '' }, filter);
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ error: 'Could not moderate this message' });
  }
});

app.patch('/api/chat/topics/:id/lock', requireChatModerator, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req, { required: false });
    const item = await repo.patchById('chatTopics', req.params.id, { locked: req.body.locked !== false }, filter);
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ error: 'Could not update this discussion' });
  }
});

// Restrict a member from posting further, without touching anything they've
// already said (section 19: "Restrict users").
app.patch('/api/admin/members/:id/chat-restriction', requireChapterAdmin, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req, { required: false });
    const item = await repo.patchById('members', req.params.id, { chatRestricted: !!req.body.chatRestricted }, filter);
    if (!item) return res.status(404).json({ error: 'Member not found' });
    const { passwordHash, ...safe } = item;
    res.json({ success: true, item: safe });
  } catch (e) {
    res.status(500).json({ error: 'Could not update this member' });
  }
});

// ============================================================
// Volunteer / Service Scheduling (section 23)
// ============================================================
const VOLUNTEER_ROLES = ['usher', 'prayer_team', 'media', 'musician', 'protocol', 'publicity', 'transport', 'other'];

app.get('/api/events/:id/volunteers', requireMember, async (req, res) => {
  try {
    const items = await repo.getAll('volunteerAssignments', { eventId: req.params.id });
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: 'Could not load volunteer assignments' });
  }
});

app.post('/api/events/:id/volunteers', requireContentManager, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req, { required: false });
    const event = await repo.getById('events', req.params.id, filter);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const { role, memberId } = req.body;
    if (!VOLUNTEER_ROLES.includes(role) || !memberId) return res.status(400).json({ error: 'A role and a member are required' });
    const member = await repo.getById('members', memberId, filter);
    if (!member) return res.status(400).json({ error: 'That member is not in this chapter' });
    const assignment = await repo.create('volunteerAssignments', {
      chapterId: event.chapterId, eventId: event.id, role, memberId, memberName: member.name,
      status: 'assigned', assignedBy: actorName(req)
    }, 'vol');
    res.json({ success: true, item: assignment });
  } catch (e) {
    res.status(500).json({ error: 'Could not create this assignment' });
  }
});

app.delete('/api/events/:eventId/volunteers/:assignmentId', requireContentManager, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req, { required: false });
    await repo.removeById('volunteerAssignments', req.params.assignmentId, filter);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not remove this assignment' });
  }
});

app.get('/api/member/volunteer-assignments', requireMember, async (req, res) => {
  try {
    const items = await repo.getAll('volunteerAssignments', { memberId: req.session.memberId });
    const events = await repo.getAll('events', { id: { $in: items.map((i) => i.eventId) } });
    const withEvent = items.map((i) => ({ ...i, event: events.find((e) => e.id === i.eventId) || null }));
    res.json(withEvent.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  } catch (e) {
    res.status(500).json({ error: 'Could not load your assignments' });
  }
});

app.patch('/api/member/volunteer-assignments/:id', requireMember, async (req, res) => {
  try {
    const existing = await repo.getById('volunteerAssignments', req.params.id);
    if (!existing || existing.memberId !== req.session.memberId) return res.status(404).json({ error: 'Not found' });
    const status = req.body.status === 'confirmed' ? 'confirmed' : req.body.status === 'declined' ? 'declined' : null;
    if (!status) return res.status(400).json({ error: 'status must be "confirmed" or "declined"' });
    const updated = await repo.updateById('volunteerAssignments', req.params.id, { ...existing, status });
    res.json({ success: true, item: updated });
  } catch (e) {
    res.status(500).json({ error: 'Could not update this' });
  }
});

// ============================================================
// Member Milestones (section 36) — birthdays already run their own daily
// check (see checkBirthdaysAndNotify); this is for the ones a human has to
// notice: graduation, a new executive appointment, membership anniversaries.
// ============================================================
const MILESTONE_TYPES = ['graduation', 'executive_appointment', 'membership_anniversary', 'other'];
const MILESTONE_LABELS = {
  graduation: 'graduated! 🎓', executive_appointment: 'was appointed to a new executive position! 🎉',
  membership_anniversary: 'is celebrating a membership milestone! 🎉', other: 'has something to celebrate! 🎉'
};

async function logMilestone({ chapterId, memberId, memberName, type, note, loggedBy }) {
  const milestone = await repo.create('milestones', {
    chapterId, memberId, memberName,
    type: MILESTONE_TYPES.includes(type) ? type : 'other',
    note: note || '', loggedBy: loggedBy || ''
  }, 'mstone');
  createNotification(
    `Congratulations, ${memberName}!`,
    `${memberName} ${MILESTONE_LABELS[milestone.type]}${note ? ' — ' + note : ''}`,
    '/index.html', 'system', chapterId
  ).catch(() => {});
  return milestone;
}

app.get('/api/shepherd/milestones', requireViewRole('shepherding'), async (req, res) => {
  try {
    const items = await repo.getAll('milestones', rolesLib.chapterFilter(req));
    res.json(items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  } catch (e) {
    res.status(500).json({ error: 'Could not load milestones' });
  }
});

app.post('/api/shepherd/milestones', requireShepherd, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req);
    const { memberId, type, note } = req.body;
    if (!memberId || !type) return res.status(400).json({ error: 'A member and a type are required' });
    const member = await repo.getById('members', memberId, filter);
    if (!member) return res.status(404).json({ error: 'Member not found in this chapter' });
    const milestone = await logMilestone({ chapterId: filter.chapterId, memberId, memberName: member.name, type, note, loggedBy: actorName(req) });
    res.json({ success: true, item: milestone });
  } catch (e) {
    res.status(500).json({ error: 'Could not log this milestone' });
  }
});

// ============================================================
// Welfare (section 33) — a member's own request, or a referral Shepherding
// raises during pastoral care (sections 7, 22). Deliberately strict: only
// welfare officers and Chapter Admin/Coordinator ever see the full request
// queue and case notes — Shepherding can refer, but the welfare office owns
// case management, the same confidentiality boundary a real welfare team keeps.
// ============================================================
const WELFARE_CATEGORIES = ['financial', 'medical', 'bereavement', 'academic', 'other'];
const WELFARE_STATUSES = ['submitted', 'under_review', 'approved', 'declined', 'fulfilled'];

function requireWelfareAccess(req, res, next) {
  if (isChapterAdminOrAbove(req) || hasRole(req, 'welfare')) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

app.post('/api/welfare/requests', requireMember, async (req, res) => {
  try {
    const member = await repo.getById('members', req.session.memberId);
    if (!member) return res.status(404).json({ error: 'Account not found' });
    const { category, description, amountRequested } = req.body;
    if (!description) return res.status(400).json({ error: 'Please describe your request' });
    const request = await repo.create('welfareRequests', {
      chapterId: member.chapterId, memberId: member.id, memberName: member.name,
      category: WELFARE_CATEGORIES.includes(category) ? category : 'other',
      description, amountRequested: Number(amountRequested) || 0, status: 'submitted'
    }, 'welf');
    res.json({ success: true, item: request });
    notifyAdminByEmail(
      'New Welfare Request — ACONSU',
      '<p>A new welfare request has been submitted. Log in to the Welfare portal to review it.</p>'
    );
  } catch (e) {
    res.status(500).json({ error: 'Could not submit your request' });
  }
});

app.get('/api/welfare/requests/mine', requireMember, async (req, res) => {
  try {
    const items = await repo.getAll('welfareRequests', { memberId: req.session.memberId });
    res.json(items.map(({ notes, ...safe }) => safe).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  } catch (e) {
    res.status(500).json({ error: 'Could not load your requests' });
  }
});

app.post('/api/shepherd/welfare-referrals', requireShepherd, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req);
    const { memberId, category, description } = req.body;
    if (!memberId || !description) return res.status(400).json({ error: 'A member and description are required' });
    const member = await repo.getById('members', memberId, filter);
    if (!member) return res.status(404).json({ error: 'Member not found in this chapter' });
    const request = await repo.create('welfareRequests', {
      chapterId: filter.chapterId, memberId: member.id, memberName: member.name,
      category: WELFARE_CATEGORIES.includes(category) ? category : 'other',
      description, status: 'submitted', referredBy: actorName(req)
    }, 'welf');
    res.json({ success: true, item: request });
  } catch (e) {
    res.status(500).json({ error: 'Could not submit this referral' });
  }
});

app.get('/api/welfare/requests', requireWelfareAccess, async (req, res) => {
  try {
    const items = await repo.getAll('welfareRequests', rolesLib.chapterFilter(req));
    res.json(items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  } catch (e) {
    res.status(500).json({ error: 'Could not load welfare requests' });
  }
});

app.patch('/api/welfare/requests/:id', requireWelfareAccess, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req);
    const existing = await repo.getById('welfareRequests', req.params.id, filter);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const { status, notes } = req.body;
    const updated = await repo.updateById('welfareRequests', req.params.id, {
      ...existing,
      status: WELFARE_STATUSES.includes(status) ? status : existing.status,
      notes: notes !== undefined ? notes : existing.notes,
      handledBy: actorName(req)
    }, filter);
    res.json({ success: true, item: updated });
  } catch (e) {
    res.status(500).json({ error: 'Could not update this request' });
  }
});

// ============================================================
// Giving (section 32) — deliberately NOT a live payment gateway; see the
// note on the GivingIntent schema. A member is shown their chapter's real
// MoMo/bank details and logs what they sent; Finance reconciles each claim
// into a real ledger entry or rejects it.
// ============================================================
app.get('/api/giving/chapter-info', requireMember, async (req, res) => {
  try {
    const member = await repo.getById('members', req.session.memberId);
    if (!member || !member.chapterId) return res.json({ configured: false });
    const chapter = await repo.getById('chapters', member.chapterId);
    if (!chapter || !chapter.payment || !(chapter.payment.momoNumber || chapter.payment.bankAccountNumber)) {
      return res.json({ configured: false });
    }
    res.json({ configured: true, payment: chapter.payment, chapterName: chapter.name });
  } catch (e) {
    res.status(500).json({ error: 'Could not load giving details' });
  }
});

app.post('/api/giving/intents', requireMember, async (req, res) => {
  try {
    const member = await repo.getById('members', req.session.memberId);
    if (!member) return res.status(404).json({ error: 'Account not found' });
    const { amount, purpose, method, reference } = req.body;
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'A valid amount is required' });
    const intent = await repo.create('givingIntents', {
      chapterId: member.chapterId, memberId: member.id, memberName: member.name,
      amount: Number(amount),
      purpose: ['momo', 'tithe', 'harvest', 'offertory', 'other'].includes(purpose) ? purpose : 'other',
      method: ['momo', 'bank', 'cash', 'other'].includes(method) ? method : 'momo',
      reference: reference || '', status: 'pending'
    }, 'give');
    res.json({ success: true, item: intent });
  } catch (e) {
    res.status(500).json({ error: 'Could not record this' });
  }
});

app.get('/api/giving/mine', requireMember, async (req, res) => {
  try {
    const items = await repo.getAll('givingIntents', { memberId: req.session.memberId });
    res.json(items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  } catch (e) {
    res.status(500).json({ error: 'Could not load your giving history' });
  }
});

app.get('/api/finance/giving-queue', requireViewRole('finance'), async (req, res) => {
  try {
    const items = await repo.getAll('givingIntents', { ...rolesLib.chapterFilter(req), status: 'pending' });
    res.json(items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
  } catch (e) {
    res.status(500).json({ error: 'Could not load the giving queue' });
  }
});

app.patch('/api/finance/giving/:id/confirm', requireFinance, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req);
    const intent = await repo.getById('givingIntents', req.params.id, filter);
    if (!intent) return res.status(404).json({ error: 'Not found' });
    if (intent.status !== 'pending') return res.status(400).json({ error: 'This has already been reviewed.' });
    // The moment a claimed gift actually becomes part of the books — never before.
    const entry = await repo.create('financeEntries', {
      chapterId: intent.chapterId, entryType: 'income', category: intent.purpose, amount: intent.amount,
      date: new Date().toISOString().slice(0, 10), description: `Giving confirmed — ${intent.memberName}`,
      method: intent.method, reference: intent.reference, payee: intent.memberName,
      approvalStatus: 'approved', approvedBy: actorName(req), recordedBy: actorName(req)
    }, 'fin');
    const updated = await repo.updateById('givingIntents', req.params.id, {
      ...intent, status: 'confirmed', matchedFinanceEntryId: entry.id, reviewedBy: actorName(req)
    }, filter);
    res.json({ success: true, item: updated, entry });
  } catch (e) {
    res.status(500).json({ error: 'Could not confirm this' });
  }
});

app.patch('/api/finance/giving/:id/reject', requireFinance, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req);
    const intent = await repo.getById('givingIntents', req.params.id, filter);
    if (!intent) return res.status(404).json({ error: 'Not found' });
    const updated = await repo.updateById('givingIntents', req.params.id, {
      ...intent, status: 'rejected', reviewNotes: req.body.notes || '', reviewedBy: actorName(req)
    }, filter);
    res.json({ success: true, item: updated });
  } catch (e) {
    res.status(500).json({ error: 'Could not reject this' });
  }
});
*/

['departments', 'sermons', 'testimonies'].forEach((resource) => {
  app.get(`/api/${resource}`, async (req, res) => {
    try {
      const items = await repo.getAll(resource, contentChapterFilter(req));
      // Only publish testimonies that have been approved by an admin.
      if (resource === 'testimonies') {
        return res.json(items.filter((t) => t.published));
      }
      res.json(items);
    } catch (e) {
      res.status(500).json({ error: 'Could not load data' });
    }
  });
});

// events need per-event registration counts attached, so they get their own route.
// A chapter sees its own events plus any national event, never another chapter's.
app.get('/api/events', async (req, res) => {
  try {
    const base = contentChapterFilter(req);
    const chapterPart = base.chapterId ? { $or: [{ chapterId: base.chapterId }, { isNational: true }] } : base;
    // Anonymous visitors only ever see published events — a submitted or
    // rejected event isn't public yet (section 9). Signed-in staff browsing
    // their own chapter's dashboard see everything, drafts included.
    const scope = rolesLib.getActingScope(req);
    const filter = scope.kind === 'anonymous' ? { ...chapterPart, status: 'published' } : chapterPart;
    const events = await repo.getAll('events', filter);
    const withCounts = await Promise.all(events.map(async (e) => {
      const registrationCount = e.registrationEnabled
        ? await models.EventRegistration.countDocuments({ eventId: e.id })
        : 0;
      const spotsLeft = e.registrationEnabled && e.capacity > 0
        ? Math.max(0, e.capacity - registrationCount)
        : null; // null = unlimited or registration not enabled
      const deadlinePassed = e.registrationEnabled && e.registrationDeadline
        ? new Date(e.registrationDeadline) < new Date()
        : false;
      return { ...e, registrationCount, spotsLeft, deadlinePassed };
    }));
    res.json(withCounts);
  } catch (e) {
    res.status(500).json({ error: 'Could not load events' });
  }
});

// custom admin-created pages (bookshelf / gallery / text tabs)
app.get('/api/pages', async (req, res) => {
  try {
    const pages = await repo.getAll('pages', contentChapterFilter(req));
    res.json(pages.sort((a, b) => (a.order || 0) - (b.order || 0)));
  } catch (e) {
    res.status(500).json({ error: 'Could not load pages' });
  }
});

app.get('/api/pages/:slug', async (req, res) => {
  try {
    const pages = await repo.getAll('pages', contentChapterFilter(req));
    const page = pages.find((p) => p.slug === req.params.slug);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    res.json(page);
  } catch (e) {
    res.status(500).json({ error: 'Could not load page' });
  }
});

// uploaded files (photos, ebooks, etc.) — list metadata only
app.get('/api/files', async (req, res) => {
  try {
    const query = {};
    if (req.query.category) query['metadata.category'] = req.query.category;
    if (req.query.pageSlug) query['metadata.pageSlug'] = req.query.pageSlug;
    if (req.query.placement) query['metadata.placement'] = req.query.placement;
    const files = await gridfs.listFiles(query);
    res.json(files.map((f) => ({
      id: f._id,
      filename: f.filename,
      length: f.length,
      uploadDate: f.uploadDate,
      contentType: f.metadata?.contentType || '',
      category: f.metadata?.category || '',
      pageSlug: f.metadata?.pageSlug || '',
      // Files uploaded before placements existed have none — treat them as
      // library items so they still list cleanly.
      placement: f.metadata?.placement || 'library',
      targetId: f.metadata?.targetId || '',
      title: f.metadata?.title || f.filename,
      description: f.metadata?.description || ''
    })));
  } catch (e) {
    res.status(500).json({ error: 'Could not load files' });
  }
});

// stream a single file's actual content (image preview, book download, etc.)
app.get('/api/files/:id', async (req, res) => {
  try {
    const file = await gridfs.findFile(req.params.id);
    if (!file) return res.status(404).json({ error: 'File not found' });
    res.set('Content-Type', file.metadata?.contentType || 'application/octet-stream');
    res.set('Content-Disposition', `inline; filename="${file.filename}"`);
    gridfs.openDownloadStream(req.params.id).pipe(res);
  } catch (e) {
    res.status(404).json({ error: 'File not found' });
  }
});

app.get('/api/settings', async (req, res) => {
  try {
    res.json(await repo.getSettings());
  } catch (e) {
    res.status(500).json({ error: 'Could not load settings' });
  }
});

// Generate verse-of-the-day as a shareable image (PNG)
app.get('/api/verse-image', async (req, res) => {
  try {
    let verseText = req.query.verse || '';
    if (!verseText) {
      const settings = await repo.getSettings();
      if (!settings.verseOfTheWeek) return res.status(400).json({ error: 'No verse configured' });
      verseText = settings.verseOfTheWeek;
    }

    // Limit verse length for image generation
    const shortVerse = verseText.length > 200 ? verseText.substring(0, 197) + '...' : verseText;
    
    // Create SVG with the verse text
    const width = 1080;
    const height = 1350;
    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <!-- Background gradient -->
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#5B2C82;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#3A1B54;stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="${width}" height="${height}" fill="url(#grad)"/>
        
        <!-- Logo/brand -->
        <text x="${width / 2}" y="100" font-size="36" font-weight="700" fill="#E8971E" text-anchor="middle" font-family="serif">ACONSU</text>
        
        <!-- Verse text -->
        <foreignObject x="60" y="200" width="${width - 120}" height="900">
          <div xmlns="http://www.w3.org/1999/xhtml" style="
            font-family: Georgia, serif;
            font-size: 32px;
            color: #FFFFFF;
            line-height: 1.6;
            text-align: center;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            padding: 40px;
          ">
            <p style="margin: 0;">"${shortVerse.replace(/"/g, '&quot;')}"</p>
          </div>
        </foreignObject>
        
        <!-- Footer -->
        <text x="${width / 2}" y="${height - 40}" font-size="20" fill="rgba(255,255,255,0.7)" text-anchor="middle" font-family="sans-serif">Verse of the Day</text>
      </svg>
    `;

    // Convert SVG to PNG using sharp
    const buffer = await require('sharp')(Buffer.from(svg)).png().toBuffer();
    res.type('image/png').send(buffer);
  } catch (e) {
    console.error('Verse image generation error:', e);
    res.status(500).json({ error: 'Could not generate verse image' });
  }
});

// Public feature configuration. The defaults preserve every existing module
// until the National Coordinator deliberately turns it off.
const FEATURE_DEFAULTS = {
  bible: true, bibleStudy: true, events: true, donations: true, welfare: true,
  communityChat: true, ebooks: true, liveStreaming: true, attendance: true,
  seminars: true, prayerWall: true, groups: true, departments: true
};
async function featureModules() {
  const doc = await models.FeatureFlags.findOne({ singleton: 'main' }).lean();
  return { ...FEATURE_DEFAULTS, ...(doc?.modules || {}) };
}
app.get('/api/features', async (req, res) => {
  try { res.json({ modules: await featureModules() }); }
  catch (e) { res.status(500).json({ error: 'Could not load feature configuration' }); }
});

const CONTENT_KINDS = ['live_service', 'seminar', 'weekly_highlight', 'ebook', 'founder', 'church_info', 'aconsu_info'];
const CONTENT_FEATURES = { live_service: 'liveStreaming', seminar: 'seminars', ebook: 'ebooks' };
app.get('/api/content/:kind', async (req, res) => {
  try {
    const { kind } = req.params;
    if (!CONTENT_KINDS.includes(kind)) return res.status(404).json({ error: 'Unknown content type' });
    const modules = await featureModules();
    if (CONTENT_FEATURES[kind] && !modules[CONTENT_FEATURES[kind]]) return res.json([]);
    const scope = contentChapterFilter(req);
    const chapterPart = scope.chapterId ? { $or: [{ chapterId: scope.chapterId }, { chapterId: '' }] } : {};
    const items = await repo.getAll('contentItems', { ...chapterPart, kind, published: true });
    res.json(items.sort((a, b) => (b.featured - a.featured) || (b.sortOrder - a.sortOrder) || (new Date(b.eventDate || b.createdAt) - new Date(a.eventDate || a.createdAt))));
  } catch (e) { res.status(500).json({ error: 'Could not load content' }); }
});

app.get('/api/content/item/:id', async (req, res) => {
  try {
    const scope = contentChapterFilter(req);
    const chapterPart = scope.chapterId ? { $or: [{ chapterId: scope.chapterId }, { chapterId: '' }] } : {};
    const items = await repo.getAll('contentItems', { ...chapterPart, id: req.params.id, published: true });
    const item = items[0];
    if (!item) return res.status(404).json({ error: 'Content item not found' });
    res.json(item);
  } catch (e) { res.status(500).json({ error: 'Could not load content item' }); }
});

// Public chapter directory — powers the registration chapter dropdown and
// the "choose your chapter" picker on the public site (see main.js). Only
// active chapters are offered; payment/contact/about detail isn't needed
// here so it's deliberately left off this response.
app.get('/api/chapters', async (req, res) => {
  try {
    const chapters = await repo.getAll('chapters', { status: 'active' });
    res.json(chapters
      .map(c => ({ id: c.id, name: c.name, fullName: c.fullName, institution: c.institution, location: c.location }))
      .sort((a, b) => a.name.localeCompare(b.name)));
  } catch (e) {
    res.status(500).json({ error: 'Could not load chapters' });
  }
});

// Public chapter profile (About page use) — deliberately excludes `payment`,
// which stays visible only to that chapter's own leadership and National.
app.get('/api/chapters/:id', async (req, res) => {
  try {
    const chapter = await repo.getById('chapters', req.params.id);
    if (!chapter || chapter.status !== 'active') return res.status(404).json({ error: 'Chapter not found' });
    const { payment, ...safe } = chapter;
    res.json(safe);
  } catch (e) {
    res.status(500).json({ error: 'Could not load chapter' });
  }
});

app.get('/api/departments/:id', async (req, res) => {
  try {
    const dept = await repo.getById('departments', req.params.id);
    if (!dept) return res.status(404).json({ error: 'Department not found' });
    res.json(dept);
  } catch (e) {
    res.status(500).json({ error: 'Could not load department' });
  }
});

app.get('/api/executives', async (req, res) => {
  try {
    const execs = await repo.getAll('executives', contentChapterFilter(req));
    res.json(execs.sort((a, b) => (a.order || 0) - (b.order || 0)));
  } catch (e) {
    res.status(500).json({ error: 'Could not load executives' });
  }
});


app.post('/api/join-requests', formLimiter, async (req, res) => {
  const { departmentId, name, email, phone, level, message } = req.body;
  if (!departmentId || !name || !email) {
    return res.status(400).json({ error: 'Name, email and department are required' });
  }
  try {
    const chapterId = await resolvePublicChapterId(req);
    if (!chapterId) return res.status(400).json({ error: 'Please select your chapter and try again.' });
    await repo.create('joinRequests', {
      chapterId,
      departmentId, name, email, phone: phone || '', level: level || '', message: message || '',
      status: 'new'
    }, 'join');
    res.json({ success: true });
    notifyAdminByEmail(
      'New Join Request — ACONSU',
      `<p><strong>${escapeHtmlForEmail(name)}</strong> wants to join a department.</p><p>Email: ${escapeHtmlForEmail(email)}${phone ? '<br>Phone: ' + escapeHtmlForEmail(phone) : ''}</p><p>Log in to the admin dashboard to see full details.</p>`
    );
  } catch (e) {
    res.status(500).json({ error: 'Could not save your request. Please try again.' });
  }
});

const PRAYER_VISIBILITIES = ['public', 'private', 'shepherd_only', 'anonymous'];

app.post('/api/prayer-requests', formLimiter, async (req, res) => {
  const { name, email, request, isPrivate, visibility } = req.body;
  if (!request) return res.status(400).json({ error: 'Request details are required' });
  try {
    const chapterId = await resolvePublicChapterId(req);
    if (!chapterId) return res.status(400).json({ error: 'Please select your chapter and try again.' });
    // visibility is the source of truth going forward; isPrivate (older
    // clients) still maps onto it so nothing that submits the old shape breaks.
    const resolvedVisibility = PRAYER_VISIBILITIES.includes(visibility) ? visibility : (isPrivate ? 'private' : 'public');
    const memberId = (req.session && req.session.memberId) || '';
    await repo.create('prayerRequests', {
      chapterId,
      name: resolvedVisibility === 'anonymous' ? 'Anonymous' : (name || 'Anonymous'),
      email: email || '', request,
      isPrivate: resolvedVisibility !== 'public' && resolvedVisibility !== 'anonymous',
      visibility: resolvedVisibility,
      memberId,
      status: 'new'
    }, 'prayer');
    res.json({ success: true });
    notifyAdminByEmail(
      'New Prayer Request — ACONSU',
      `<p><strong>${escapeHtmlForEmail(name || 'Anonymous')}</strong> submitted a prayer request.</p><p>Log in to the admin dashboard to see it.</p>`
    );
  } catch (e) {
    res.status(500).json({ error: 'Could not save your request. Please try again.' });
  }
});

// ---------- Prayer Wall (section 18) ----------
// The public feed — only requests marked public/anonymous ever appear here;
// private and shepherd_only stay in the shepherding/admin inbox only. Names
// are stripped for anonymous requests server-side, never just hidden by the
// frontend, and the id list of who's praying is never exposed — only a count.
app.get('/api/prayer-wall', async (req, res) => {
  try {
    const filter = { ...contentChapterFilter(req), visibility: { $in: ['public', 'anonymous'] } };
    const items = await repo.getAll('prayerRequests', filter);
    res.json(items
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((p) => ({
        id: p.id,
        name: p.visibility === 'anonymous' ? 'Anonymous' : p.name,
        request: p.request,
        answered: !!p.answered,
        testimony: p.testimony || '',
        prayingCount: (p.prayingMemberIds || []).length,
        isMine: !!(req.session && req.session.memberId && p.memberId === req.session.memberId),
        createdAt: p.createdAt
      })));
  } catch (e) {
    res.status(500).json({ error: 'Could not load the prayer wall' });
  }
});

app.post('/api/prayer-requests/:id/pray', requireMember, async (req, res) => {
  try {
    const request = await models.PrayerRequest.findOne({ id: req.params.id });
    if (!request || !['public', 'anonymous'].includes(request.visibility)) {
      return res.status(404).json({ error: 'Not found' });
    }
    await models.PrayerRequest.updateOne(
      { id: req.params.id },
      { $addToSet: { prayingMemberIds: req.session.memberId } }
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not record this' });
  }
});

// A member can mark their own request answered (and share a testimony);
// chapter staff can also do it on behalf of someone who submitted signed out.
// Deliberately not gated by requireMember alone — Shepherding/Chapter Admin
// may also close this out on behalf of someone who submitted signed out, so
// the "who's allowed" check has to happen inside, not in the route guard.
app.patch('/api/prayer-requests/:id/answered', async (req, res) => {
  try {
    const request = await repo.getById('prayerRequests', req.params.id);
    if (!request) return res.status(404).json({ error: 'Not found' });
    const isOwner = !!(req.session && req.session.memberId && request.memberId === req.session.memberId);
    if (!isOwner && !isChapterAdminOrAbove(req) && !hasRole(req, 'shepherding')) {
      return res.status(403).json({ error: 'Only the person who submitted this request (or Shepherding) can mark it answered.' });
    }
    const updated = await repo.updateById('prayerRequests', req.params.id, {
      ...request,
      answered: true,
      answeredAt: new Date(),
      testimony: req.body.testimony ? String(req.body.testimony).slice(0, 2000) : request.testimony
    });
    res.json({ success: true, item: updated });
  } catch (e) {
    res.status(500).json({ error: 'Could not update this request' });
  }
});

app.post('/api/testimonies', formLimiter, async (req, res) => {
  const { name, testimony } = req.body;
  if (!testimony) return res.status(400).json({ error: 'Testimony is required' });
  try {
    const chapterId = await resolvePublicChapterId(req);
    if (!chapterId) return res.status(400).json({ error: 'Please select your chapter and try again.' });
    await repo.create('testimonies', {
      chapterId,
      name: name || 'Anonymous', testimony, published: false
    }, 'test');
    res.json({ success: true });
    // Testimonies are publicity's to review and publish.
    notifyOfficeByEmail(
      'publicityEmail',
      'New Testimony Submitted — ACONSU',
      `<p><strong>${escapeHtmlForEmail(name || 'Anonymous')}</strong> shared a testimony awaiting review.</p><p>Open the Publicity portal to publish it.</p>`
    );
  } catch (e) {
    res.status(500).json({ error: 'Could not save your testimony. Please try again.' });
  }
});

app.post('/api/contact', formLimiter, async (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) return res.status(400).json({ error: 'All fields are required' });
  try {
    const chapterId = await resolvePublicChapterId(req);
    if (!chapterId) return res.status(400).json({ error: 'Please select your chapter and try again.' });
    await repo.create('contactMessages', { chapterId, name, email, message, status: 'new' }, 'msg');
    res.json({ success: true });
    // Contact messages are shepherding's to answer, so they get the mail too —
    // alongside the admin, who keeps oversight of everything.
    notifyOfficeByEmail(
      'shepherdingEmail',
      'New Contact Message — ACONSU',
      `<p><strong>${escapeHtmlForEmail(name)}</strong> (${escapeHtmlForEmail(email)}) sent a message:</p><p>${escapeHtmlForEmail(message)}</p><p>Open the Shepherding portal to reply and mark it handled.</p>`
    );
  } catch (e) {
    res.status(500).json({ error: 'Could not send your message. Please try again.' });
  }
});

app.post('/api/events/:id/register', formLimiter, async (req, res) => {
  const { name, email, phone } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
  try {
    const event = await repo.getById('events', req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (!event.registrationEnabled) return res.status(400).json({ error: 'Registration is not open for this event' });
    if (event.registrationDeadline && new Date(event.registrationDeadline) < new Date()) {
      return res.status(400).json({ error: 'Registration for this event has closed' });
    }
    if (event.capacity > 0) {
      const count = await models.EventRegistration.countDocuments({ eventId: event.id });
      if (count >= event.capacity) {
        return res.status(400).json({ error: 'This event is fully booked' });
      }
    }
    await repo.create('eventRegistrations', {
      chapterId: event.chapterId || '', eventId: event.id, name, email, phone: phone || ''
    }, 'reg');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not complete registration. Please try again.' });
  }
});


// ---------- Shepherding portal data routes ----------
// All routes below require the Shepherding Head login (requireShepherd), never
// the main admin login or a member login — this is a deliberately separate,
// narrow-access area for pastoral care and finance records.

// Merged member view: auto-imports name/email/phone/department/birthday/photo
// live from the existing Member accounts, and attaches each person's
// shepherding record (pastoral notes, address, attendance, etc.) if one exists.
// This is what makes "auto-import" work — nothing about a member is duplicated
// or re-entered, it's joined at read time from data the church already has.
app.get('/api/shepherd/members', requireShepherd, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req);
    const [members, records] = await Promise.all([
      repo.getAll('members', filter),
      repo.getAll('shepherdingRecords', filter)
    ]);
    const recordByMemberId = new Map(records.filter(r => r.memberId).map(r => [r.memberId, r]));
    const standaloneRecords = records.filter(r => !r.memberId); // manually-added visitors, no account

    const merged = members.map((m) => {
      const record = recordByMemberId.get(m.id);
      return {
        source: 'member',
        memberId: m.id,
        recordId: record ? record.id : '',
        name: m.name,
        email: m.email,
        phone: m.phone,
        level: m.level,
        programme: m.programme || '',
        hostel: m.hostel || '',
        department: m.department,
        birthdayMonth: m.birthdayMonth,
        birthdayDay: m.birthdayDay,
        imageFileId: (record && record.imageFileId) || m.profileImageFileId || '',
        address: record ? record.address : '',
        emergencyContact: record ? record.emergencyContact : '',
        attendanceStatus: record ? record.attendanceStatus : 'new',
        lastContactDate: record ? record.lastContactDate : '',
        pastoralNotes: record ? record.pastoralNotes : '',
        // Membership workflow (section 7).
        membershipStage: m.membershipStage || 'visitor',
        membershipNumber: m.membershipNumber || '',
        shepherdStaffId: m.shepherdStaffId || '',
        shepherdName: m.shepherdName || ''
      };
    });

    const visitors = standaloneRecords.map((r) => ({
      source: 'visitor',
      memberId: '',
      recordId: r.id,
      name: r.name,
      email: '',
      phone: r.phone,
      level: '',
      department: '',
      birthdayMonth: null,
      birthdayDay: null,
      imageFileId: r.imageFileId || '',
      address: r.address,
      emergencyContact: r.emergencyContact,
      attendanceStatus: r.attendanceStatus,
      lastContactDate: r.lastContactDate,
      pastoralNotes: r.pastoralNotes
    }));

    res.json([...merged, ...visitors]);
  } catch (e) {
    res.status(500).json({ error: 'Could not load member records' });
  }
});

// Create or update the shepherding-specific fields for a member (upsert by memberId),
// or create a standalone record for a visitor who has no account (memberId left blank).
app.post('/api/shepherd/records', requireShepherd, upload.single('image'), async (req, res) => {
  try {
    const { recordId, memberId, name, phone, address, emergencyContact, attendanceStatus, lastContactDate, pastoralNotes } = req.body;
    if (!memberId && !name) {
      return res.status(400).json({ error: 'A name is required for a visitor record with no linked account' });
    }

    let imageFileId;
    if (req.file) {
      const compressed = await compressIfImage(req.file.buffer, req.file.mimetype);
      imageFileId = String(await gridfs.uploadBuffer(compressed.buffer, req.file.originalname, {
        category: 'shepherding', contentType: compressed.contentType, title: name || memberId
      }));
    }

    // Find the record to update: by its own id if given (visitor edits), otherwise
    // by memberId (linked-member edits), otherwise this is a brand new record.
    // Scoped to this shepherd's own chapter throughout, so an id from another
    // chapter can never be edited even if it were guessed.
    const scopeFilter = rolesLib.chapterFilter(req);
    let existing = null;
    if (recordId) {
      existing = await repo.getById('shepherdingRecords', recordId, scopeFilter);
    } else if (memberId) {
      existing = (await repo.getAll('shepherdingRecords', scopeFilter)).find(r => r.memberId === memberId) || null;
    }

    const fields = {
      chapterId: rolesLib.chapterIdForWrite(req),
      memberId: memberId || '',
      name: name || '',
      phone: phone || '',
      address: address || '',
      emergencyContact: emergencyContact || '',
      attendanceStatus: attendanceStatus || 'new',
      lastContactDate: lastContactDate || '',
      pastoralNotes: pastoralNotes || ''
    };
    if (imageFileId) fields.imageFileId = imageFileId;

    let record;
    if (existing) {
      if (imageFileId && existing.imageFileId) gridfs.deleteFile(existing.imageFileId).catch(() => {});
      record = await repo.updateById('shepherdingRecords', existing.id, { ...existing, ...fields });
    } else {
      record = await repo.create('shepherdingRecords', fields, 'shep');
    }
    res.json({ success: true, item: record });
  } catch (e) {
    res.status(500).json({ error: 'Could not save this record' });
  }
});

app.delete('/api/shepherd/records/:id', requireShepherd, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req);
    const existing = await repo.getById('shepherdingRecords', req.params.id, filter);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (existing.imageFileId) gridfs.deleteFile(existing.imageFileId).catch(() => {});
    await repo.removeById('shepherdingRecords', req.params.id, filter);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete this record' });
  }
});

// ---------- Shepherding portal: attendance register ----------
// One register per date + service. Saving the same date twice updates the
// existing register rather than creating a second one, so a Sunday can be
// corrected during the week without ending up with duplicate records.
app.get('/api/shepherd/attendance', requireViewRole('shepherding'), async (req, res) => {
  try {
    let records = await repo.getAll('attendanceRecords', rolesLib.chapterFilter(req));
    const { from, to } = req.query;
    if (from) records = records.filter(r => r.date >= from);
    if (to) records = records.filter(r => r.date <= to);
    records.sort((a, b) => (a.date < b.date ? 1 : -1));
    // The list view only needs the totals — sending every person's mark for
    // every service would balloon the response for no reason.
    res.json(records.map((r) => ({
      id: r.id, date: r.date, serviceType: r.serviceType, title: r.title,
      present: r.marks.filter(m => m.status === 'present').length,
      absent: r.marks.filter(m => m.status === 'absent').length,
      excused: r.marks.filter(m => m.status === 'excused').length,
      visitorCount: r.visitorCount || 0,
      total: r.marks.filter(m => m.status === 'present').length + (r.visitorCount || 0),
      notes: r.notes, recordedBy: r.recordedBy, updatedAt: r.updatedAt
    })));
  } catch (e) {
    res.status(500).json({ error: 'Could not load attendance records' });
  }
});

// The register for one specific service, with every person's mark — this is what
// the "take attendance" screen loads before it renders the checklist.
app.get('/api/shepherd/attendance/:date', requireViewRole('shepherding'), async (req, res) => {
  try {
    const serviceType = req.query.serviceType || 'sunday';
    const records = await repo.getAll('attendanceRecords', rolesLib.chapterFilter(req));
    const record = records.find(r => r.date === req.params.date && r.serviceType === serviceType) || null;
    res.json({ record });
  } catch (e) {
    res.status(500).json({ error: 'Could not load this register' });
  }
});

app.post('/api/shepherd/attendance', requireShepherd, async (req, res) => {
  try {
    const { date, serviceType, title, marks, visitorCount, notes } = req.body;
    if (!date) return res.status(400).json({ error: 'A service date is required' });
    const service = serviceType || 'sunday';
    const cleanMarks = (Array.isArray(marks) ? marks : []).map((m) => ({
      memberId: m.memberId || '',
      recordId: m.recordId || '',
      name: m.name || '',
      status: ['present', 'absent', 'excused'].includes(m.status) ? m.status : 'absent'
    }));

    const scopeFilter = rolesLib.chapterFilter(req);
    const existing = (await repo.getAll('attendanceRecords', scopeFilter)).find(r => r.date === date && r.serviceType === service);
    const fields = {
      chapterId: rolesLib.chapterIdForWrite(req),
      date, serviceType: service, title: title || '',
      marks: cleanMarks,
      visitorCount: Number(visitorCount || 0),
      notes: notes || '',
      recordedBy: actorName(req)
    };
    const record = existing
      ? await repo.updateById('attendanceRecords', existing.id, fields, scopeFilter)
      : await repo.create('attendanceRecords', fields, 'att');
    res.json({ success: true, item: record });
  } catch (e) {
    res.status(500).json({ error: 'Could not save this register' });
  }
});

app.delete('/api/shepherd/attendance/:id', requireShepherd, async (req, res) => {
  try {
    await repo.removeById('attendanceRecords', req.params.id, rolesLib.chapterFilter(req));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete this register' });
  }
});

// Attendance history for one person — how many of the last services they made.
app.get('/api/shepherd/attendance-history/:memberId', requireViewRole('shepherding'), async (req, res) => {
  try {
    const records = await repo.getAll('attendanceRecords', rolesLib.chapterFilter(req));
    const key = req.params.memberId;
    const history = records
      .map((r) => {
        const mark = r.marks.find(m => m.memberId === key || m.recordId === key);
        return mark ? { date: r.date, serviceType: r.serviceType, status: mark.status } : null;
      })
      .filter(Boolean)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const attended = history.filter(h => h.status === 'present').length;
    res.json({
      history: history.slice(0, 20),
      servicesRecorded: history.length,
      attended,
      rate: history.length ? Math.round((attended / history.length) * 100) : null
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not load attendance history' });
  }
});

// ---------- Digital Membership Card (section 14) ----------
// The QR encodes the member's qrToken, never their raw id/email — the
// scanning side (below) resolves it back to a member server-side and checks
// chapter membership before recording anything, so the code itself carries
// no directly identifying information if seen out of context.
app.get('/api/member/card', requireMember, async (req, res) => {
  try {
    const member = await repo.getById('members', req.session.memberId);
    if (!member) return res.status(404).json({ error: 'Account not found' });
    if (member.membershipStage !== 'active') {
      return res.json({
        ready: false,
        membershipStage: member.membershipStage,
        message: 'Your digital membership card will be available once Shepherding completes your membership review.'
      });
    }
    const chapter = member.chapterId ? await repo.getById('chapters', member.chapterId) : null;
    const qrDataUrl = await QRCode.toDataURL(member.qrToken, { margin: 1, width: 320 });
    res.json({
      ready: true,
      name: member.name,
      profileImageFileId: member.profileImageFileId || '',
      chapterName: chapter ? chapter.name : '',
      membershipStatus: member.membershipStage,
      membershipNumber: member.membershipNumber,
      qrDataUrl
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not load your membership card' });
  }
});

// ---------- QR / manual attendance recording (section 13) ----------
// Ushers/Shepherding/Publicity can take attendance at the door — same set of
// roles allowed to manage chapter content, since "who's on the door" isn't
// its own role in the hierarchy yet.
function requireAttendanceTaker(req, res, next) {
  if (isChapterAdminOrAbove(req) || hasRole(req, 'shepherding') || hasRole(req, 'publicity')) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

// Shared by both the scan and the manual-search fallback — SCAN QR ->
// IDENTIFY MEMBER -> VERIFY CHAPTER -> RECORD ATTENDANCE (section 13). The
// chapter check happens by construction: `member` is only ever found within
// the scanner's own chapterFilter, so a mismatch surfaces as "not found"
// rather than ever crossing into another chapter's register.
async function markMemberPresent(req, member, date, serviceType) {
  const chapterId = rolesLib.chapterIdForWrite(req) || member.chapterId;
  const day = date || todayISODate();
  const service = ['sunday', 'midweek', 'special'].includes(serviceType) ? serviceType : 'sunday';
  const existing = (await repo.getAll('attendanceRecords', { date: day, serviceType: service, chapterId }))[0] || null;
  const marks = existing ? [...existing.marks] : [];
  const idx = marks.findIndex((m) => m.memberId === member.id);
  const already = idx >= 0 && marks[idx].status === 'present';
  if (idx >= 0) marks[idx] = { ...marks[idx], status: 'present' };
  else marks.push({ memberId: member.id, recordId: '', name: member.name, status: 'present' });

  const record = existing
    ? await repo.updateById('attendanceRecords', existing.id, { ...existing, marks })
    : await repo.create('attendanceRecords', {
        chapterId, date: day, serviceType: service, marks,
        visitorCount: 0, notes: '', recordedBy: actorName(req)
      }, 'att');
  return { already, recordId: record.id };
}

app.post('/api/attendance/scan', requireAttendanceTaker, async (req, res) => {
  try {
    const { qrToken, date, serviceType } = req.body;
    if (!qrToken) return res.status(400).json({ error: 'A QR code is required' });
    const filter = rolesLib.chapterFilter(req);
    const member = await models.Member.findOne({ qrToken, ...filter }).lean();
    if (!member) return res.status(404).json({ error: 'That code does not match anyone in this chapter.' });
    const result = await markMemberPresent(req, member, date, serviceType);
    res.json({
      success: true, alreadyMarked: result.already,
      member: { id: member.id, name: member.name, profileImageFileId: member.profileImageFileId, membershipStage: member.membershipStage }
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not record attendance' });
  }
});

// Manual search fallback (section 13) — when scanning isn't available.
// Reuses the same member list Shepherding already sees; this just adds the
// one-tap "mark present" action on top of it.
app.post('/api/attendance/mark', requireAttendanceTaker, async (req, res) => {
  try {
    const { memberId, date, serviceType } = req.body;
    if (!memberId) return res.status(400).json({ error: 'A member is required' });
    const filter = rolesLib.chapterFilter(req);
    const member = await models.Member.findOne({ id: memberId, ...filter }).lean();
    if (!member) return res.status(404).json({ error: 'Member not found in this chapter.' });
    const result = await markMemberPresent(req, member, date, serviceType);
    res.json({ success: true, alreadyMarked: result.already, member: { id: member.id, name: member.name } });
  } catch (e) {
    res.status(500).json({ error: 'Could not record attendance' });
  }
});

// ---------- Attendance / membership reports (section 13, 37) ----------
// Generate -> Preview (the existing register screens) -> Download PDF.
app.get('/api/shepherd/attendance/:date/report.pdf', requireViewRole('shepherding'), async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req);
    const serviceType = req.query.serviceType || 'sunday';
    const records = await repo.getAll('attendanceRecords', filter);
    const record = records.find(r => r.date === req.params.date && r.serviceType === serviceType);
    if (!record) return res.status(404).json({ error: 'No register found for that date' });
    const chapter = filter.chapterId ? await repo.getById('chapters', filter.chapterId) : null;
    const present = record.marks.filter(m => m.status === 'present').length;
    renderTableReport(res, {
      title: 'Attendance Report',
      subtitle: `${chapter ? chapter.name + ' — ' : ''}${record.title || record.serviceType} — ${record.date}`,
      generatedBy: actorName(req),
      filename: `aconsu-attendance-${record.date}.pdf`,
      columns: [
        { key: 'name', label: 'Member', width: 2.2 },
        { key: 'status', label: 'Status', width: 1 }
      ],
      rows: [...record.marks].sort((a, b) => a.name.localeCompare(b.name)),
      summary: [
        { label: 'Present', value: present },
        { label: 'Absent', value: record.marks.filter(m => m.status === 'absent').length },
        { label: 'Excused', value: record.marks.filter(m => m.status === 'excused').length },
        { label: 'Walk-in visitors', value: record.visitorCount || 0 },
        { label: 'Total in the room', value: present + (record.visitorCount || 0) }
      ]
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not build the PDF report' });
  }
});

// Attendance PERCENTAGE per member across a date range — the figure a
// shepherd actually needs when deciding who to follow up with.
app.get('/api/shepherd/attendance-summary.pdf', requireViewRole('shepherding'), async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req);
    let [records, members] = await Promise.all([repo.getAll('attendanceRecords', filter), repo.getAll('members', filter)]);
    if (req.query.from) records = records.filter(r => r.date >= req.query.from);
    if (req.query.to) records = records.filter(r => r.date <= req.query.to);
    const chapter = filter.chapterId ? await repo.getById('chapters', filter.chapterId) : null;

    const rows = members
      .filter(m => m.membershipStage === 'active')
      .map((m) => {
        const marked = records.filter(r => r.marks.some(mk => mk.memberId === m.id));
        const present = records.filter(r => r.marks.some(mk => mk.memberId === m.id && mk.status === 'present')).length;
        return {
          name: m.name, department: m.department || '—',
          servicesRecorded: marked.length, present,
          rate: marked.length ? `${Math.round((present / marked.length) * 100)}%` : '—'
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    renderTableReport(res, {
      title: 'Attendance Percentage Report',
      subtitle: `${chapter ? chapter.name + ' — ' : ''}${req.query.from || 'all time'} to ${req.query.to || 'present'} — ${records.length} service(s)`,
      generatedBy: actorName(req),
      filename: `aconsu-attendance-summary-${new Date().toISOString().slice(0, 10)}.pdf`,
      columns: [
        { key: 'name', label: 'Member', width: 2 },
        { key: 'department', label: 'Department', width: 1.3 },
        { key: 'servicesRecorded', label: 'Services', width: 0.8, align: 'right' },
        { key: 'present', label: 'Present', width: 0.8, align: 'right' },
        { key: 'rate', label: 'Rate', width: 0.8, align: 'right' }
      ],
      rows
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not build the PDF report' });
  }
});

app.get('/api/shepherd/members/report.pdf', requireViewRole('shepherding'), async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req);
    const [members, chapter] = await Promise.all([
      repo.getAll('members', filter),
      filter.chapterId ? repo.getById('chapters', filter.chapterId) : null
    ]);
    renderTableReport(res, {
      title: 'Membership Report',
      subtitle: chapter ? chapter.name : 'ACONSU',
      generatedBy: actorName(req),
      filename: `aconsu-membership-${new Date().toISOString().slice(0, 10)}.pdf`,
      columns: [
        { key: 'name', label: 'Name', width: 1.8 },
        { key: 'phone', label: 'Phone', width: 1.1 },
        { key: 'level', label: 'Level', width: 0.7 },
        { key: 'department', label: 'Department', width: 1.1 },
        { key: 'membershipStage', label: 'Status', width: 1 }
      ],
      rows: [...members].sort((a, b) => a.name.localeCompare(b.name)),
      summary: [
        { label: 'Total', value: members.length },
        { label: 'Active members', value: members.filter(m => m.membershipStage === 'active').length },
        { label: 'Visitors / in review', value: members.filter(m => ['visitor', 'under_review', 'accepted'].includes(m.membershipStage)).length }
      ]
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not build the PDF report' });
  }
});

// ---------- Shepherding portal: member details ----------
// Shepherding keeps the pastoral picture of each person up to date, so they can
// correct the account details a member typed in a hurry at registration. Email
// and password stay off-limits here — changing an email from another person's
// screen is how people get locked out of their own account.
app.put('/api/shepherd/members/:id', requireShepherd, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req);
    const existing = await repo.getById('members', req.params.id, filter);
    if (!existing) return res.status(404).json({ error: 'Member not found' });
    const { name, phone, level, programme, hostel, department, birthdayMonth, birthdayDay } = req.body;
    const updated = await repo.updateById('members', req.params.id, {
      ...existing,
      name: name !== undefined ? name : existing.name,
      phone: phone !== undefined ? phone : existing.phone,
      level: level !== undefined ? level : existing.level,
      programme: programme !== undefined ? programme : existing.programme,
      hostel: hostel !== undefined ? hostel : existing.hostel,
      department: department !== undefined ? department : existing.department,
      birthdayMonth: birthdayMonth !== undefined ? (birthdayMonth ? Number(birthdayMonth) : null) : existing.birthdayMonth,
      birthdayDay: birthdayDay !== undefined ? (birthdayDay ? Number(birthdayDay) : null) : existing.birthdayDay
    }, filter);
    const { passwordHash, ...safe } = updated;
    res.json({ success: true, item: safe });
  } catch (e) {
    res.status(500).json({ error: 'Could not update this member' });
  }
});

// ---------- Shepherding portal: membership workflow ----------
// REGISTERED -> VISITOR -> SHEPHERDING REVIEW -> ACCEPTED -> ASSIGNED SHEPHERD
// -> ACTIVE (section 7). Every registration already starts as 'visitor';
// everything from here on is Shepherding moving someone forward (or, in
// principle, back — e.g. correcting a mistaken acceptance).
const MEMBERSHIP_STAGES = ['visitor', 'under_review', 'accepted', 'active'];

app.patch('/api/shepherd/members/:id/stage', requireShepherd, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req);
    const existing = await repo.getById('members', req.params.id, filter);
    if (!existing) return res.status(404).json({ error: 'Member not found' });
    const stage = req.body.stage;
    if (!MEMBERSHIP_STAGES.includes(stage)) return res.status(400).json({ error: 'Unknown membership stage' });

    const updates = { membershipStage: stage };
    if (!existing.qrToken) updates.qrToken = crypto.randomBytes(16).toString('hex');

    // Assigning a shepherd is allowed alongside any stage change, or on its own.
    if (req.body.shepherdStaffId !== undefined || req.body.shepherdName !== undefined) {
      const shepherdStaffId = req.body.shepherdStaffId || '';
      let shepherdName = req.body.shepherdName || '';
      if (shepherdStaffId) {
        // A portal account holder — pull their name from the account rather
        // than trust free text, so it can never drift out of sync.
        const shepherdStaff = await repo.getById('staffUsers', shepherdStaffId, filter);
        if (!shepherdStaff) return res.status(400).json({ error: 'Unknown shepherd' });
        shepherdName = shepherdStaff.name;
      }
      // Otherwise a lay shepherd with no portal login of their own — the
      // name typed in is all that's recorded, same as `recordedBy` elsewhere.
      updates.shepherdStaffId = shepherdStaffId;
      updates.shepherdName = shepherdName;
    }

    // First time reaching 'active' — issue the membership number the digital
    // card (section 14) will show. Never reassigned once set.
    if (stage === 'active' && !existing.membershipNumber) {
      const activeCount = await models.Member.countDocuments({ chapterId: existing.chapterId, membershipStage: 'active' });
      updates.membershipNumber = `${String(existing.chapterId).toUpperCase()}-${String(activeCount + 1).padStart(4, '0')}`;
    }

    const updated = await repo.updateById('members', req.params.id, { ...existing, ...updates }, filter);
    const { passwordHash, ...safe } = updated;
    res.json({ success: true, item: safe });
  } catch (e) {
    res.status(500).json({ error: 'Could not update membership status' });
  }
});

// ---------- Shepherding portal: contact messages ----------
// Messages sent through the public contact form land here as well as with the
// admin — following up with the person who reached out is pastoral work.
app.get('/api/shepherd/contact-messages', requireViewRole('shepherding'), async (req, res) => {
  try {
    const items = await repo.getAll('contactMessages', rolesLib.chapterFilter(req));
    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: 'Could not load messages' });
  }
});

app.patch('/api/shepherd/contact-messages/:id', requireShepherd, async (req, res) => {
  try {
    const status = req.body.status === 'replied' ? 'replied' : 'new';
    const item = await repo.patchById('contactMessages', req.params.id, { status }, rolesLib.chapterFilter(req));
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ error: 'Could not update this message' });
  }
});

// ---------- Finance office ----------
// Finance is its own department with its own portal: budgets, a ledger, and
// reporting that ties the two together. The coordinator can read all of it;
// only the finance role can record or change money.
const INCOME_CATEGORIES = ['momo', 'tithe', 'harvest', 'offertory', 'other'];

function financeTotals(entries) {
  const totalIncome = entries.filter(e => e.entryType === 'income').reduce((s, e) => s + e.amount, 0);
  const totalExpense = entries.filter(e => e.entryType === 'expense').reduce((s, e) => s + e.amount, 0);
  return { totalIncome, totalExpense, balance: totalIncome - totalExpense };
}

function filterEntries(entries, { from, to, entryType, category, budgetId }) {
  let out = entries;
  if (from) out = out.filter(e => e.date >= from);
  if (to) out = out.filter(e => e.date <= to);
  if (entryType) out = out.filter(e => e.entryType === entryType);
  if (category) out = out.filter(e => e.category === category);
  if (budgetId) out = out.filter(e => e.budgetId === budgetId);
  return out;
}

app.get('/api/finance/entries', requireViewRole('finance'), async (req, res) => {
  try {
    const entries = filterEntries(await repo.getAll('financeEntries', rolesLib.chapterFilter(req)), req.query);
    entries.sort((a, b) => (a.date === b.date ? new Date(b.createdAt) - new Date(a.createdAt) : (a.date < b.date ? 1 : -1)));
    res.json(entries);
  } catch (e) {
    res.status(500).json({ error: 'Could not load finance records' });
  }
});

app.get('/api/finance/summary', requireViewRole('finance'), async (req, res) => {
  try {
    const all = await repo.getAll('financeEntries', rolesLib.chapterFilter(req));
    const entries = filterEntries(all, req.query);
    const { totalIncome, totalExpense, balance } = financeTotals(entries);

    const byIncomeCategory = {};
    INCOME_CATEGORIES.forEach((c) => { byIncomeCategory[c] = 0; });
    const byExpenseCategory = {};
    entries.forEach((e) => {
      if (e.entryType === 'income') byIncomeCategory[e.category] = (byIncomeCategory[e.category] || 0) + e.amount;
      else byExpenseCategory[e.category] = (byExpenseCategory[e.category] || 0) + e.amount;
    });

    // Month-by-month movement, oldest first — this is what the trend chart draws.
    const monthly = {};
    entries.forEach((e) => {
      const month = (e.date || '').slice(0, 7);
      if (!month) return;
      if (!monthly[month]) monthly[month] = { month, income: 0, expense: 0 };
      monthly[month][e.entryType === 'income' ? 'income' : 'expense'] += e.amount;
    });

    res.json({
      totalIncome, totalExpense, balance,
      byIncomeCategory, byExpenseCategory,
      monthly: Object.values(monthly).sort((a, b) => (a.month < b.month ? -1 : 1)),
      entryCount: entries.length,
      // The running balance of everything ever recorded, regardless of the filter —
      // what's actually in hand today.
      overallBalance: financeTotals(all).balance,
      pendingApprovals: all.filter(e => e.approvalStatus === 'pending').length
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not load the finance summary' });
  }
});

function financeEntryFromBody(body, req) {
  return {
    chapterId: rolesLib.chapterIdForWrite(req),
    entryType: body.entryType,
    category: body.category,
    amount: Number(body.amount),
    date: body.date,
    description: body.description || '',
    method: ['cash', 'momo', 'bank', 'cheque', 'other'].includes(body.method) ? body.method : 'cash',
    reference: body.reference || '',
    payee: body.payee || '',
    budgetId: body.budgetId || '',
    budgetLineId: body.budgetLineId || '',
    approvalStatus: ['recorded', 'pending', 'approved', 'rejected'].includes(body.approvalStatus) ? body.approvalStatus : 'recorded',
    recordedBy: actorName(req)
  };
}

app.post('/api/finance/entries', requireFinance, async (req, res) => {
  try {
    const { entryType, category, amount, date } = req.body;
    if (!entryType || !category || !amount || !date) {
      return res.status(400).json({ error: 'Type, category, amount, and date are required' });
    }
    if (Number(amount) <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });
    if (entryType === 'income' && !INCOME_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Invalid income category' });
    }
    const entry = await repo.create('financeEntries', financeEntryFromBody(req.body, req), 'fin');
    res.json({ success: true, item: entry });
  } catch (e) {
    res.status(500).json({ error: 'Could not save this entry' });
  }
});

app.put('/api/finance/entries/:id', requireFinance, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req);
    const existing = await repo.getById('financeEntries', req.params.id, filter);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (Number(req.body.amount) <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });
    const entry = await repo.updateById('financeEntries', req.params.id, {
      ...existing, ...financeEntryFromBody(req.body, req), recordedBy: existing.recordedBy || actorName(req)
    }, filter);
    res.json({ success: true, item: entry });
  } catch (e) {
    res.status(500).json({ error: 'Could not update this entry' });
  }
});

// Approving money above a certain size is exactly the kind of "sensitive
// chapter operation" the Chapter Coordinator is meant to sign off on
// (section 4), so this is one of the few finance actions open to coordinator
// as well as finance itself.
function requireFinanceApprover(req, res, next) {
  if (hasRole(req, 'finance') || isChapterCoordinatorOrAbove(req)) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

app.patch('/api/finance/entries/:id/approval', requireFinanceApprover, async (req, res) => {
  try {
    const status = req.body.approvalStatus;
    if (!['pending', 'approved', 'rejected', 'recorded'].includes(status)) {
      return res.status(400).json({ error: 'Invalid approval status' });
    }
    const item = await repo.patchById('financeEntries', req.params.id, {
      approvalStatus: status,
      approvedBy: status === 'approved' ? actorName(req) : ''
    }, rolesLib.chapterFilter(req));
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ error: 'Could not update this entry' });
  }
});

app.delete('/api/finance/entries/:id', requireFinance, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req);
    const existing = await repo.getById('financeEntries', req.params.id, filter);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (existing.receiptFileId) gridfs.deleteFile(existing.receiptFileId).catch(() => {});
    await repo.removeById('financeEntries', req.params.id, filter);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete this entry' });
  }
});

// ---------- Finance office: budgets ----------
// Planned amounts live on the budget; actuals are summed from the ledger every
// time this is read, so a budget can never quietly disagree with the books.
async function budgetPerformance(budget, allEntries) {
  const entries = allEntries.filter(e => e.budgetId === budget.id);
  const lines = budget.lines.map((line) => {
    const actual = entries
      .filter(e => e.budgetLineId === line.lineId)
      .reduce((sum, e) => sum + e.amount, 0);
    const variance = line.lineType === 'income'
      ? actual - line.plannedAmount          // income: over plan is good
      : line.plannedAmount - actual;         // expense: under plan is good
    return {
      ...line,
      actual,
      variance,
      usedPercent: line.plannedAmount > 0 ? Math.round((actual / line.plannedAmount) * 100) : null
    };
  });
  const plannedIncome = lines.filter(l => l.lineType === 'income').reduce((s, l) => s + l.plannedAmount, 0);
  const plannedExpense = lines.filter(l => l.lineType === 'expense').reduce((s, l) => s + l.plannedAmount, 0);
  const actualIncome = lines.filter(l => l.lineType === 'income').reduce((s, l) => s + l.actual, 0);
  const actualExpense = lines.filter(l => l.lineType === 'expense').reduce((s, l) => s + l.actual, 0);
  return {
    ...budget,
    lines,
    plannedIncome, plannedExpense, plannedBalance: plannedIncome - plannedExpense,
    actualIncome, actualExpense, actualBalance: actualIncome - actualExpense,
    // Entries booked against this budget but not against any of its lines.
    unallocated: entries.filter(e => !e.budgetLineId).reduce((s, e) => s + e.amount, 0)
  };
}

app.get('/api/finance/budgets', requireViewRole('finance'), async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req);
    const [budgets, entries] = await Promise.all([repo.getAll('budgets', filter), repo.getAll('financeEntries', filter)]);
    budgets.sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
    const withPerformance = await Promise.all(budgets.map(b => budgetPerformance(b, entries)));
    res.json(withPerformance);
  } catch (e) {
    res.status(500).json({ error: 'Could not load budgets' });
  }
});

app.get('/api/finance/budgets/:id', requireViewRole('finance'), async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req);
    const budget = await repo.getById('budgets', req.params.id, filter);
    if (!budget) return res.status(404).json({ error: 'Budget not found' });
    res.json(await budgetPerformance(budget, await repo.getAll('financeEntries', filter)));
  } catch (e) {
    res.status(500).json({ error: 'Could not load this budget' });
  }
});

function budgetLinesFromBody(lines) {
  return (Array.isArray(lines) ? lines : [])
    .filter(l => l && l.category)
    .map((l, i) => ({
      lineId: l.lineId || `line_${Date.now()}_${i}`,
      lineType: l.lineType === 'income' ? 'income' : 'expense',
      category: String(l.category).trim(),
      plannedAmount: Number(l.plannedAmount || 0),
      notes: l.notes || ''
    }));
}

app.post('/api/finance/budgets', requireFinance, async (req, res) => {
  try {
    const { name, startDate, endDate, status, notes, lines } = req.body;
    if (!name || !startDate || !endDate) {
      return res.status(400).json({ error: 'Name, start date and end date are required' });
    }
    if (endDate < startDate) return res.status(400).json({ error: 'The end date cannot be before the start date' });
    const budget = await repo.create('budgets', {
      chapterId: rolesLib.chapterIdForWrite(req),
      name, startDate, endDate,
      status: ['draft', 'active', 'closed'].includes(status) ? status : 'draft',
      notes: notes || '',
      lines: budgetLinesFromBody(lines),
      createdBy: actorName(req)
    }, 'bud');
    res.json({ success: true, item: budget });
  } catch (e) {
    res.status(500).json({ error: 'Could not save this budget' });
  }
});

app.put('/api/finance/budgets/:id', requireFinance, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req);
    const existing = await repo.getById('budgets', req.params.id, filter);
    if (!existing) return res.status(404).json({ error: 'Budget not found' });
    const { name, startDate, endDate, status, notes, lines } = req.body;
    if (endDate && startDate && endDate < startDate) {
      return res.status(400).json({ error: 'The end date cannot be before the start date' });
    }
    const budget = await repo.updateById('budgets', req.params.id, {
      ...existing,
      name: name || existing.name,
      startDate: startDate || existing.startDate,
      endDate: endDate || existing.endDate,
      status: ['draft', 'active', 'closed'].includes(status) ? status : existing.status,
      notes: notes !== undefined ? notes : existing.notes,
      lines: lines !== undefined ? budgetLinesFromBody(lines) : existing.lines
    }, filter);
    res.json({ success: true, item: budget });
  } catch (e) {
    res.status(500).json({ error: 'Could not update this budget' });
  }
});

app.delete('/api/finance/budgets/:id', requireFinance, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req);
    const existing = await repo.getById('budgets', req.params.id, filter);
    if (!existing) return res.status(404).json({ error: 'Budget not found' });
    // Ledger entries survive their budget — the money still moved. They simply
    // stop pointing at a plan that no longer exists.
    await models.FinanceEntry.updateMany({ budgetId: req.params.id, ...filter }, { $set: { budgetId: '', budgetLineId: '' } });
    await repo.removeById('budgets', req.params.id, filter);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete this budget' });
  }
});

// Spreadsheet-ready export of whatever the finance office is currently looking at.
app.get('/api/finance/export.csv', requireViewRole('finance'), async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req);
    const entries = filterEntries(await repo.getAll('financeEntries', filter), req.query);
    entries.sort((a, b) => (a.date < b.date ? -1 : 1));
    const budgets = await repo.getAll('budgets', filter);
    const budgetName = (id) => (budgets.find(b => b.id === id) || {}).name || '';

    const cell = (v) => {
      const s = v === undefined || v === null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['Date', 'Type', 'Category', 'Amount (GHS)', 'Method', 'Reference', 'Payee', 'Description', 'Budget', 'Approval', 'Recorded By'];
    const rows = entries.map(e => [
      e.date, e.entryType, e.category, e.amount.toFixed(2), e.method || '', e.reference || '',
      e.payee || '', e.description || '', budgetName(e.budgetId), e.approvalStatus || '', e.recordedBy || ''
    ].map(cell).join(','));
    const { totalIncome, totalExpense, balance } = financeTotals(entries);
    rows.push('', ['', 'TOTAL INCOME', '', totalIncome.toFixed(2)].join(','));
    rows.push(['', 'TOTAL EXPENSE', '', totalExpense.toFixed(2)].join(','));
    rows.push(['', 'BALANCE', '', balance.toFixed(2)].join(','));

    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="aconsu-finance-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send([header.map(cell).join(','), ...rows].join('\n'));
  } catch (e) {
    res.status(500).json({ error: 'Could not build the export' });
  }
});

// PDF sibling to the CSV export — same filtering, laid out to be read at a
// meeting rather than opened in a spreadsheet (section 37: Generate -> Preview
// (the existing on-screen ledger) -> Download PDF).
app.get('/api/finance/export.pdf', requireViewRole('finance'), async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req);
    const [entries, chapter] = await Promise.all([
      filterEntries(await repo.getAll('financeEntries', filter), req.query),
      filter.chapterId ? repo.getById('chapters', filter.chapterId) : null
    ]);
    entries.sort((a, b) => (a.date < b.date ? -1 : 1));
    const { totalIncome, totalExpense, balance } = financeTotals(entries);
    renderTableReport(res, {
      title: 'Finance Report',
      subtitle: chapter ? chapter.name : 'ACONSU',
      generatedBy: actorName(req),
      filename: `aconsu-finance-${new Date().toISOString().slice(0, 10)}.pdf`,
      columns: [
        { key: 'date', label: 'Date', width: 1 },
        { key: 'entryType', label: 'Type', width: 1 },
        { key: 'category', label: 'Category', width: 1.4 },
        { key: 'amount', label: 'Amount (GHS)', width: 1, align: 'right' },
        { key: 'method', label: 'Method', width: 1 },
        { key: 'recordedBy', label: 'Recorded By', width: 1.2 }
      ],
      rows: entries.map(e => ({ ...e, amount: e.amount.toFixed(2) })),
      summary: [
        { label: 'Total income', value: `GHS ${totalIncome.toFixed(2)}` },
        { label: 'Total expense', value: `GHS ${totalExpense.toFixed(2)}` },
        { label: 'Balance', value: `GHS ${balance.toFixed(2)}` }
      ]
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not build the PDF report' });
  }
});

// ---------- Publicity office ----------
// Publicity owns everything that goes out to people: in-app announcements, push
// alerts, SMS, event updates, and the testimonies members send in.

// Does the actual sending for both "send now" and anything the scheduler picks
// up later, so a scheduled announcement behaves exactly like an immediate one.
// `chapterId` blank means a genuine national broadcast (National Coordinator
// only — see the scheduled-send loop and the national announcements route);
// every chapter-level publicity send passes its own chapter through here.
async function dispatchAnnouncement({ title, body, url, channels, audience, sourceId, chapterId }) {
  const useApp = !channels || channels.includes('app');
  const useSms = channels && channels.includes('sms');
  const parts = [];

  if (useApp) {
    await createNotification(title, body, url, 'admin', chapterId);
    parts.push('posted to the app');
  }
  if (useSms) {
    const numbers = await sms.resolveAudience(audience, chapterId);
    const text = `${title}\n${body}`.slice(0, 320); // ~2 SMS segments, keeps costs predictable
    const result = await sms.sendBatch(numbers, text, sourceId, chapterId);
    parts.push(result.configured
      ? `SMS: ${result.sent} sent${result.failed ? `, ${result.failed} failed` : ''}${result.note ? ` — ${result.note}` : ''}`
      : `SMS skipped — ${result.note}`);
  }
  return parts.join(' · ') || 'Nothing to send — no channel was selected.';
}

app.get('/api/publicity/overview', requireViewRole('publicity'), async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req);
    const [notifications, scheduled, testimonies, smsLogs, events] = await Promise.all([
      repo.getAll('notifications', filter), repo.getAll('scheduledNotifications', filter),
      repo.getAll('testimonies', filter), repo.getAll('smsLogs', filter), repo.getAll('events', filter)
    ]);
    const now = new Date();
    res.json({
      notificationsSent: notifications.length,
      scheduledPending: scheduled.filter(s => s.status === 'scheduled').length,
      testimoniesPending: testimonies.filter(t => !t.published).length,
      testimoniesPublished: testimonies.filter(t => t.published).length,
      smsSent: smsLogs.filter(s => s.status === 'sent').length,
      smsFailed: smsLogs.filter(s => s.status === 'failed').length,
      smsConfigured: sms.isConfigured(),
      pushConfigured: push.ensureConfigured(),
      upcomingEvents: events.filter(e => new Date(`${e.date}T${e.time || '00:00'}:00`) >= now).length,
      recent: notifications
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5)
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not load the publicity overview' });
  }
});

// Who an announcement can be aimed at, with a live count of reachable phone
// numbers so publicity knows what an SMS blast will actually cost before sending.
app.get('/api/publicity/audiences', requireViewRole('publicity'), async (req, res) => {
  try {
    const chapterId = rolesLib.getActingScope(req).chapterId || '';
    const departments = await repo.getAll('departments', chapterId ? { chapterId } : {});
    const options = [{ value: 'all', label: 'Everyone (members + visitors)' }];
    departments.forEach(d => options.push({ value: `department:${d.id}`, label: `${d.name} department` }));
    const withCounts = await Promise.all(options.map(async (o) => ({
      ...o, reachable: (await sms.resolveAudience(o.value, chapterId)).length
    })));
    res.json({ audiences: withCounts, smsConfigured: sms.isConfigured() });
  } catch (e) {
    res.status(500).json({ error: 'Could not load audiences' });
  }
});

app.post('/api/publicity/notifications', requirePublicity, async (req, res) => {
  const { title, body, url, channels, audience } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Title and message are required' });
  const picked = Array.isArray(channels) && channels.length ? channels : ['app'];
  try {
    const result = await dispatchAnnouncement({
      title, body, url: url || '/index.html', channels: picked, audience: audience || 'all',
      chapterId: rolesLib.chapterIdForWrite(req)
    });
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: 'Could not send this announcement' });
  }
});

app.get('/api/publicity/scheduled', requireViewRole('publicity'), async (req, res) => {
  try {
    const items = await repo.getAll('scheduledNotifications', rolesLib.chapterFilter(req));
    items.sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor));
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: 'Could not load scheduled announcements' });
  }
});

app.post('/api/publicity/scheduled', requirePublicity, async (req, res) => {
  const { title, body, url, channels, audience, scheduledFor } = req.body;
  if (!title || !body || !scheduledFor) {
    return res.status(400).json({ error: 'Title, message and a send time are required' });
  }
  const when = new Date(scheduledFor);
  if (isNaN(when.getTime())) return res.status(400).json({ error: 'That send time is not a valid date and time' });
  if (when.getTime() < Date.now() - 60 * 1000) {
    return res.status(400).json({ error: 'That send time is in the past — pick a time from now onwards' });
  }
  try {
    const item = await repo.create('scheduledNotifications', {
      chapterId: rolesLib.chapterIdForWrite(req),
      title, body, url: url || '/index.html',
      channels: Array.isArray(channels) && channels.length ? channels : ['app'],
      audience: audience || 'all',
      scheduledFor: when,
      status: 'scheduled',
      createdBy: actorName(req)
    }, 'sched');
    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ error: 'Could not schedule this announcement' });
  }
});

app.patch('/api/publicity/scheduled/:id/cancel', requirePublicity, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req);
    const existing = await repo.getById('scheduledNotifications', req.params.id, filter);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (existing.status !== 'scheduled') {
      return res.status(400).json({ error: 'This announcement has already gone out.' });
    }
    const item = await repo.patchById('scheduledNotifications', req.params.id, { status: 'cancelled' }, filter);
    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ error: 'Could not cancel this announcement' });
  }
});

app.delete('/api/publicity/scheduled/:id', requirePublicity, async (req, res) => {
  try {
    await repo.removeById('scheduledNotifications', req.params.id, rolesLib.chapterFilter(req));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not remove this announcement' });
  }
});

// Testimonies come in from the public form; publicity reviews them and decides
// what appears on the wall.
app.get('/api/publicity/testimonies', requireViewRole('publicity'), async (req, res) => {
  try {
    const items = await repo.getAll('testimonies', rolesLib.chapterFilter(req));
    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: 'Could not load testimonies' });
  }
});

app.patch('/api/publicity/testimonies/:id', requirePublicity, async (req, res) => {
  try {
    const item = await repo.patchById('testimonies', req.params.id, { published: !!req.body.published }, rolesLib.chapterFilter(req));
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ error: 'Could not update this testimony' });
  }
});

app.delete('/api/publicity/testimonies/:id', requirePublicity, async (req, res) => {
  try {
    await repo.removeById('testimonies', req.params.id, rolesLib.chapterFilter(req));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete this testimony' });
  }
});

// Event updates: publicity keeps the calendar current and tells people when
// something changes, which is the part that actually matters to members.
app.post('/api/publicity/events', requirePublicity, async (req, res) => {
  try {
    const chapterId = await resolveChapterIdForWrite(req, req.body.chapterId);
    const item = await repo.create('events', { ...req.body, chapterId }, 'even');
    res.json({ success: true, item });
    createNotification(
      'New Event: ' + (item.title || 'Untitled'),
      `${item.title || 'A new event'} — ${item.date || ''} ${item.time || ''}${item.location ? ' at ' + item.location : ''}`.trim(),
      '/events.html', 'system', item.isNational ? '' : chapterId
    ).catch(() => {});
  } catch (e) {
    res.status(500).json({ error: 'Could not save this event' });
  }
});

app.put('/api/publicity/events/:id', requirePublicity, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req);
    const { announceUpdate, chapterId, ...fields } = req.body;
    const item = await repo.updateById('events', req.params.id, fields, filter);
    if (!item) return res.status(404).json({ error: 'Event not found' });
    res.json({ success: true, item });
    if (announceUpdate) {
      createNotification(
        'Event Update: ' + (item.title || 'Untitled'),
        `${item.title || 'An event'} has been updated — ${item.date || ''} ${item.time || ''}${item.location ? ' at ' + item.location : ''}`.trim(),
        '/events.html', 'system', item.isNational ? '' : item.chapterId
      ).catch(() => {});
    }
  } catch (e) {
    res.status(500).json({ error: 'Could not update this event' });
  }
});

// ---------- Executive Portal (section 9) ----------
// Self-service: an executive can only ever read/edit the one Executive
// record tied to their own StaffUser id (staffId) — never anyone else's,
// and never by guessing another executive's record id.
async function findOwnExecutiveRecord(req) {
  const staff = currentStaff(req);
  if (!staff) return null;
  return models.Executive.findOne({ staffId: staff.id, chapterId: staff.chapterId }).lean();
}

app.get('/api/executive/me', requireRole('executive'), async (req, res) => {
  try {
    const record = await findOwnExecutiveRecord(req);
    res.json({ item: record });
  } catch (e) {
    res.status(500).json({ error: 'Could not load your executive profile' });
  }
});

app.put('/api/executive/me', requireRole('executive'), upload.single('image'), async (req, res) => {
  try {
    const staff = currentStaff(req);
    let existing = await findOwnExecutiveRecord(req);
    let imageFileId = existing ? existing.imageFileId : '';
    if (req.file) {
      const compressed = await compressIfImage(req.file.buffer, req.file.mimetype);
      imageFileId = String(await gridfs.uploadBuffer(compressed.buffer, req.file.originalname, {
        category: 'executive', contentType: compressed.contentType, title: req.body.name || staff.name, chapterId: staff.chapterId
      }));
      if (existing && existing.imageFileId) gridfs.deleteFile(existing.imageFileId).catch(() => {});
    }
    const { name, role, department, bio, phone, email } = req.body;
    // A real position/department change gets snapshotted into history first
    // (section 9: "updated every academic year"), same pattern as a
    // member's academicHistory.
    let history = existing ? existing.history || [] : [];
    if (existing && ((role && role !== existing.role) || (department && department !== existing.department))) {
      history = [...history, { year: currentAcademicYearLabel(), role: existing.role || '', department: existing.department || '', updatedAt: new Date() }];
    }
    const fields = {
      chapterId: staff.chapterId,
      staffId: staff.id,
      name: name || (existing ? existing.name : staff.name),
      role: role !== undefined ? role : (existing ? existing.role : ''),
      department: department !== undefined ? department : (existing ? existing.department : ''),
      bio: bio !== undefined ? bio : (existing ? existing.bio : ''),
      contact: {
        phone: phone !== undefined ? phone : (existing ? existing.contact.phone : ''),
        email: email !== undefined ? email : (existing ? existing.contact.email : '')
      },
      imageFileId,
      history
    };
    const record = existing
      ? await repo.updateById('executives', existing.id, { ...existing, ...fields })
      : await repo.create('executives', fields, 'exec');
    res.json({ success: true, item: record });
    // First time this executive has set up their profile — a genuine new
    // appointment worth celebrating (section 36), not just a form save.
    // memberId is left blank unless this StaffUser is linked to a Member
    // profile — the celebration still posts either way.
    if (!existing) {
      logMilestone({ chapterId: staff.chapterId, memberId: staff.memberId || '', memberName: fields.name, type: 'executive_appointment', note: fields.role, loggedBy: 'System' }).catch(() => {});
    }
  } catch (e) {
    res.status(500).json({ error: 'Could not save your executive profile' });
  }
});

// Event submission (section 9): EXECUTIVE -> SUBMITTED -> PUBLICITY REVIEW ->
// APPROVED -> PUBLISHED. Never published directly — that's the whole point
// of the workflow, and it's enforced here (status is always 'submitted'),
// not left to whatever the client sends.
app.post('/api/executive/events', requireRole('executive'), async (req, res) => {
  try {
    const staff = currentStaff(req);
    const { title, date, time, location, description, category, videoUrl } = req.body;
    if (!title || !date) return res.status(400).json({ error: 'Title and date are required' });
    const item = await repo.create('events', {
      chapterId: staff.chapterId,
      title, date, time: time || '', location: location || '', description: description || '',
      category: category || '', videoUrl: videoUrl || '',
      status: 'submitted', submittedBy: staff.name, submittedByStaffId: staff.id
    }, 'even');
    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ error: 'Could not submit this event' });
  }
});

app.get('/api/executive/events', requireRole('executive'), async (req, res) => {
  try {
    const staff = currentStaff(req);
    const items = await repo.getAll('events', { submittedByStaffId: staff.id });
    res.json(items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  } catch (e) {
    res.status(500).json({ error: 'Could not load your submitted events' });
  }
});

// ---------- Publicity: event review queue (section 9, continued) ----------
app.get('/api/publicity/events/queue', requireViewRole('publicity'), async (req, res) => {
  try {
    const items = await repo.getAll('events', { ...rolesLib.chapterFilter(req), status: 'submitted' });
    res.json(items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
  } catch (e) {
    res.status(500).json({ error: 'Could not load the review queue' });
  }
});

app.patch('/api/publicity/events/:id/review', requirePublicity, async (req, res) => {
  try {
    const decision = req.body.decision === 'approved' ? 'approved' : (req.body.decision === 'rejected' ? 'rejected' : null);
    if (!decision) return res.status(400).json({ error: 'decision must be "approved" or "rejected"' });
    const filter = rolesLib.chapterFilter(req);
    const item = await repo.patchById('events', req.params.id, {
      status: decision, reviewedBy: actorName(req), reviewNotes: req.body.notes || ''
    }, filter);
    if (!item) return res.status(404).json({ error: 'Event not found' });
    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ error: 'Could not review this event' });
  }
});

app.patch('/api/publicity/events/:id/publish', requirePublicity, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req);
    const existing = await repo.getById('events', req.params.id, filter);
    if (!existing) return res.status(404).json({ error: 'Event not found' });
    if (existing.status !== 'approved') return res.status(400).json({ error: 'Only an approved event can be published.' });
    const item = await repo.patchById('events', req.params.id, { status: 'published' }, filter);
    res.json({ success: true, item });
    createNotification(
      'New Event: ' + (item.title || 'Untitled'),
      `${item.title || 'A new event'} — ${item.date || ''} ${item.time || ''}${item.location ? ' at ' + item.location : ''}`.trim(),
      '/events.html', 'system', item.isNational ? '' : item.chapterId
    ).catch(() => {});
  } catch (e) {
    res.status(500).json({ error: 'Could not publish this event' });
  }
});

app.get('/api/publicity/sms-logs', requireViewRole('publicity'), async (req, res) => {
  try {
    const logs = await repo.getAll('smsLogs', rolesLib.chapterFilter(req));
    logs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(logs.slice(0, 200));
  } catch (e) {
    res.status(500).json({ error: 'Could not load the SMS log' });
  }
});

// ---------- Chapter Coordinator ----------
// One screen showing the state of every office in ONE chapter. Mostly
// read-only by design — the office that owns the work still does it — but
// the Chapter Coordinator additionally gets approval and chapter-wide
// announcement powers below (section 4), which is what separates this role
// from a plain read-only rollup.
app.get('/api/coordinator/overview', requireViewRole('coordinator'), async (req, res) => {
  try {
    const scope = rolesLib.getActingScope(req);
    if (scope.isNational && !scope.chapterId) {
      return res.status(400).json({ error: 'Pick a chapter to view (?chapterId=...).' });
    }
    const filter = { chapterId: scope.chapterId };
    const [
      members, departments, events, finance, budgets, attendance,
      joinRequests, prayerRequests, testimonies, contactMessages,
      notifications, scheduled, smsLogs, shepherdingRecords, staff, chapter
    ] = await Promise.all([
      repo.getAll('members', filter), repo.getAll('departments', filter), repo.getAll('events', filter),
      repo.getAll('financeEntries', filter), repo.getAll('budgets', filter), repo.getAll('attendanceRecords', filter),
      repo.getAll('joinRequests', filter), repo.getAll('prayerRequests', filter), repo.getAll('testimonies', filter),
      repo.getAll('contactMessages', filter), repo.getAll('notifications', filter), repo.getAll('scheduledNotifications', filter),
      repo.getAll('smsLogs', filter), repo.getAll('shepherdingRecords', filter), repo.getAll('staffUsers', filter),
      repo.getById('chapters', scope.chapterId)
    ]);

    const now = new Date();
    const monthKey = now.toISOString().slice(0, 7);
    const thisMonth = finance.filter(e => (e.date || '').startsWith(monthKey));
    const recentServices = [...attendance].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8);
    const attendanceTrend = recentServices.map(r => ({
      date: r.date,
      serviceType: r.serviceType,
      present: r.marks.filter(m => m.status === 'present').length + (r.visitorCount || 0)
    })).reverse();
    const avgAttendance = attendanceTrend.length
      ? Math.round(attendanceTrend.reduce((s, a) => s + a.present, 0) / attendanceTrend.length)
      : 0;

    const activeBudget = budgets.find(b => b.status === 'active') || null;

    res.json({
      chapter: chapter ? { id: chapter.id, name: chapter.name, status: chapter.status } : null,
      finance: {
        ...financeTotals(finance),
        thisMonth: financeTotals(thisMonth),
        entryCount: finance.length,
        activeBudget: activeBudget ? await budgetPerformance(activeBudget, finance) : null,
        budgetCount: budgets.length,
        // Sensitive-operation approvals a Chapter Coordinator can act on directly.
        pendingApprovals: finance.filter(e => e.approvalStatus === 'pending').length
      },
      shepherding: {
        memberCount: members.length,
        visitorCount: shepherdingRecords.filter(r => !r.memberId).length,
        servicesRecorded: attendance.length,
        lastService: recentServices[0] || null,
        averageAttendance: avgAttendance,
        attendanceTrend,
        followUpNeeded: shepherdingRecords.filter(r => ['irregular', 'inactive'].includes(r.attendanceStatus)).length,
        // Membership pipeline (section 7): how many are still working their
        // way from visitor to active member.
        awaitingReview: members.filter(m => ['visitor', 'under_review'].includes(m.membershipStage)).length,
        acceptedNotYetActive: members.filter(m => m.membershipStage === 'accepted').length,
        activeMembers: members.filter(m => m.membershipStage === 'active').length
      },
      publicity: {
        notificationsSent: notifications.length,
        scheduledPending: scheduled.filter(s => s.status === 'scheduled').length,
        nextScheduled: scheduled
          .filter(s => s.status === 'scheduled')
          .sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor))[0] || null,
        smsSent: smsLogs.filter(s => s.status === 'sent').length,
        testimoniesPending: testimonies.filter(t => !t.published).length
      },
      engagement: {
        departments: departments.length,
        upcomingEvents: events.filter(e => new Date(`${e.date}T${e.time || '00:00'}:00`) >= now).length,
        newJoinRequests: joinRequests.filter(r => r.status === 'new').length,
        newPrayerRequests: prayerRequests.filter(r => r.status === 'new').length,
        unreadMessages: contactMessages.filter(m => m.status !== 'replied').length
      },
      team: staff.map(({ passwordHash, ...s }) => s),
      generatedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not load the coordinator dashboard' });
  }
});

// Chapter-wide announcements (section 4) — a separate, explicit Chapter
// Coordinator action from Publicity's own composer, even though both end up
// calling the same dispatch logic underneath.
app.post('/api/coordinator/announcements', requireChapterCoordinator, async (req, res) => {
  const { title, body, url, channels } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Title and message are required' });
  const chapterId = rolesLib.chapterIdForWrite(req);
  if (!chapterId) return res.status(400).json({ error: 'Pick a chapter to announce to.' });
  try {
    const result = await dispatchAnnouncement({
      title, body, url: url || '/index.html',
      channels: Array.isArray(channels) && channels.length ? channels : ['app'],
      audience: 'all',
      chapterId
    });
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: 'Could not send this announcement' });
  }
});

// ---------- National Coordinator ----------
// Oversight across every chapter (section 3). requireNational accepts the
// legacy global admin session too, so this works the moment the app is
// deployed — no separate national account has to exist first.
app.get('/api/national/chapters', rolesLib.requireNational, async (req, res) => {
  try {
    const chapters = await repo.getAll('chapters');
    res.json(chapters.sort((a, b) => a.name.localeCompare(b.name)));
  } catch (e) {
    res.status(500).json({ error: 'Could not load chapters' });
  }
});

app.post('/api/national/chapters', rolesLib.requireNational, async (req, res) => {
  const { id, name, institution, location, address } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'A chapter id and name are required' });
  const slug = String(id).toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug) return res.status(400).json({ error: 'That chapter id is not usable — try letters, numbers and hyphens.' });
  try {
    const existing = await repo.getById('chapters', slug);
    if (existing) return res.status(400).json({ error: 'A chapter with that id already exists' });
    const chapter = await repo.create('chapters', {
      id: slug, name, fullName: req.body.fullName || '', institution: institution || '',
      location: location || '', address: address || '', status: 'active',
      createdBy: actorName(req)
    }, slug);
    res.json({ success: true, item: chapter });
  } catch (e) {
    res.status(500).json({ error: 'Could not create this chapter' });
  }
});

app.put('/api/national/chapters/:id', rolesLib.requireNational, async (req, res) => {
  try {
    const existing = await repo.getById('chapters', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Chapter not found' });
    const { id, status, coordinatorStaffId, coordinatorName, ...editable } = req.body;
    const updated = await repo.updateById('chapters', req.params.id, { ...existing, ...editable });
    res.json({ success: true, item: updated });
  } catch (e) {
    res.status(500).json({ error: 'Could not update this chapter' });
  }
});

app.patch('/api/national/chapters/:id/status', rolesLib.requireNational, async (req, res) => {
  const status = req.body.status === 'inactive' ? 'inactive' : 'active';
  try {
    const item = await repo.patchById('chapters', req.params.id, { status });
    if (!item) return res.status(404).json({ error: 'Chapter not found' });
    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ error: 'Could not update this chapter' });
  }
});

// Assign or change a chapter's Coordinator (section 3) — either promote an
// existing staff account in that chapter, or create a brand new one. Any
// current coordinator steps down to Chapter Admin rather than being deleted,
// so their account and history stay intact.
app.post('/api/national/chapters/:id/assign-coordinator', rolesLib.requireNational, async (req, res) => {
  try {
    const chapter = await repo.getById('chapters', req.params.id);
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

    await models.StaffUser.updateMany(
      { chapterId: chapter.id, role: 'coordinator' },
      { $set: { role: 'chapterAdmin' } }
    );

    let account;
    if (req.body.staffId) {
      const staff = await repo.getById('staffUsers', req.body.staffId);
      if (!staff || staff.chapterId !== chapter.id) {
        return res.status(400).json({ error: 'That account does not belong to this chapter' });
      }
      account = await repo.updateById('staffUsers', staff.id, { ...staff, role: 'coordinator' });
    } else {
      const { username, name, password } = req.body;
      if (!username || !password) return res.status(400).json({ error: 'Username and password are required for a new account' });
      if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
      const clean = String(username).toLowerCase().trim();
      const dupe = await models.StaffUser.findOne({ username: clean });
      if (dupe) return res.status(400).json({ error: 'That username is already taken' });
      account = await repo.create('staffUsers', {
        username: clean, name: name || clean, role: 'coordinator', chapterId: chapter.id,
        passwordHash: await bcrypt.hash(password, 10), active: true
      }, 'staff');
    }

    const updatedChapter = await repo.updateById('chapters', chapter.id, {
      ...chapter, coordinatorStaffId: account.id, coordinatorName: account.name
    });
    const { passwordHash, ...safeAccount } = account;
    res.json({ success: true, chapter: updatedChapter, coordinator: safeAccount });
  } catch (e) {
    res.status(500).json({ error: 'Could not assign a coordinator' });
  }
});

// National dashboard: chapter counts, aggregated (never individually
// identifying) membership/attendance/finance/welfare figures across every
// chapter, plus a per-chapter breakdown for comparison (section 3, 38).
app.get('/api/national/dashboard', rolesLib.requireNational, async (req, res) => {
  try {
    const [chapters, members, events, financeEntries, attendance, shepherdingRecords, executives] = await Promise.all([
      repo.getAll('chapters'), repo.getAll('members'), repo.getAll('events'),
      repo.getAll('financeEntries'), repo.getAll('attendanceRecords'),
      repo.getAll('shepherdingRecords'), repo.getAll('executives')
    ]);
    const now = new Date();
    const byChapter = chapters.map((c) => {
      const chMembers = members.filter(m => m.chapterId === c.id);
      const chFinance = financeEntries.filter(f => f.chapterId === c.id);
      const chAttendance = attendance.filter(a => a.chapterId === c.id);
      const recent = [...chAttendance].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      return {
        id: c.id, name: c.name, status: c.status,
        memberCount: chMembers.filter(m => m.membershipStage === 'active').length,
        visitorCount: chMembers.filter(m => ['visitor', 'under_review'].includes(m.membershipStage)).length
          + shepherdingRecords.filter(r => r.chapterId === c.id && !r.memberId).length,
        executiveCount: executives.filter(e => e.chapterId === c.id).length,
        upcomingEvents: events.filter(e => e.chapterId === c.id && new Date(`${e.date}T${e.time || '00:00'}:00`) >= now).length,
        lastServiceAttendance: recent ? recent.marks.filter(m => m.status === 'present').length + (recent.visitorCount || 0) : null,
        balance: financeTotals(chFinance).balance
      };
    });
    res.json({
      totalChapters: chapters.length,
      activeChapters: chapters.filter(c => c.status === 'active').length,
      totalVisitors: byChapter.reduce((s, c) => s + c.visitorCount, 0),
      totalMembers: byChapter.reduce((s, c) => s + c.memberCount, 0),
      totalExecutives: byChapter.reduce((s, c) => s + c.executiveCount, 0),
      upcomingEvents: events.filter(e => new Date(`${e.date}T${e.time || '00:00'}:00`) >= now).length,
      financialOverview: financeTotals(financeEntries),
      chapters: byChapter,
      generatedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not load the national dashboard' });
  }
});

// National feature management (section 39). Only recognised boolean keys are
// accepted, so a crafted request cannot add arbitrary configuration fields.
app.get('/api/national/features', rolesLib.requireNational, async (req, res) => {
  try { res.json({ modules: await featureModules() }); }
  catch (e) { res.status(500).json({ error: 'Could not load feature configuration' }); }
});
app.put('/api/national/features', rolesLib.requireNational, async (req, res) => {
  try {
    const current = await featureModules();
    const requested = req.body.modules || {};
    const modules = { ...current };
    Object.keys(FEATURE_DEFAULTS).forEach((key) => {
      if (typeof requested[key] === 'boolean') modules[key] = requested[key];
    });
    const doc = await models.FeatureFlags.findOneAndUpdate(
      { singleton: 'main' }, { $set: { modules } }, { new: true, upsert: true }
    ).lean();
    res.json({ success: true, modules: { ...FEATURE_DEFAULTS, ...(doc.modules || {}) } });
  } catch (e) { res.status(500).json({ error: 'Could not update feature configuration' }); }
});

// Export-safe national comparison report: chapter aggregates only, never a
// list of individual members, donations, or welfare cases.
app.get('/api/national/reports/overview', rolesLib.requireNational, async (req, res) => {
  try {
    const [chapters, members, events, attendance, welfare] = await Promise.all([
      repo.getAll('chapters'), repo.getAll('members'), repo.getAll('events'),
      repo.getAll('attendanceRecords'), repo.getAll('welfareRequests')
    ]);
    res.json(chapters.map((chapter) => ({
      chapterId: chapter.id, chapterName: chapter.name, status: chapter.status,
      activeMembers: members.filter(m => m.chapterId === chapter.id && m.membershipStage === 'active').length,
      visitors: members.filter(m => m.chapterId === chapter.id && ['visitor', 'under_review'].includes(m.membershipStage)).length,
      events: events.filter(e => e.chapterId === chapter.id).length,
      servicesRecorded: attendance.filter(a => a.chapterId === chapter.id).length,
      openWelfareRequests: welfare.filter(w => w.chapterId === chapter.id && !['declined', 'fulfilled'].includes(w.status)).length
    })));
  } catch (e) { res.status(500).json({ error: 'Could not generate national report' }); }
});

// National announcement — reaches every chapter (blank chapterId).
app.post('/api/national/announcements', rolesLib.requireNational, async (req, res) => {
  const { title, body, url, channels } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Title and message are required' });
  try {
    const result = await dispatchAnnouncement({
      title, body, url: url || '/index.html',
      channels: Array.isArray(channels) && channels.length ? channels : ['app'],
      audience: 'all', chapterId: ''
    });
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: 'Could not send this announcement' });
  }
});

// National report snapshots — persist a point-in-time snapshot of the live
// national dashboard numbers into a NationalReport document. Useful for
// tracking growth trends over weeks/months without having to reconstruct
// from raw collections every time. The snapshot captures per-chapter
// member/visitor/event/finance counts at the time it's taken.
app.post('/api/national/reports/snapshot', rolesLib.requireNational, async (req, res) => {
  try {
    const [chapters, members, events, financeEntries] = await Promise.all([
      repo.getAll('chapters'), repo.getAll('members'), repo.getAll('events'),
      repo.getAll('financeEntries')
    ]);
    const chapterMetrics = chapters.map((c) => {
      const chMembers = members.filter(m => m.chapterId === c.id);
      const chFinance = financeEntries.filter(f => f.chapterId === c.id);
      return {
        chapterId: c.id, chapterName: c.name, status: c.status,
        activeMembers: chMembers.filter(m => m.membershipStage === 'active').length,
        visitors: chMembers.filter(m => ['visitor', 'under_review'].includes(m.membershipStage)).length,
        events: events.filter(e => e.chapterId === c.id).length,
        balance: financeTotals(chFinance).balance
      };
    });
    const report = await models.NationalReport.create({
      reportDate: new Date(),
      region: req.body.region || '',
      continent: req.body.continent || '',
      metrics: {
        totalChapters: chapters.length,
        activeChapters: chapters.filter(c => c.status === 'active').length,
        totalMembers: chapterMetrics.reduce((s, c) => s + c.activeMembers, 0),
        totalVisitors: chapterMetrics.reduce((s, c) => s + c.visitors, 0),
        nationalBalance: financeTotals(financeEntries).balance,
        chapters: chapterMetrics
      }
    });
    res.json({ success: true, item: report });
  } catch (e) {
    res.status(500).json({ error: 'Could not create report snapshot' });
  }
});

// Retrieve historical national report snapshots — most recent first, capped
// at 100. Use query params ?from=YYYY-MM-DD&to=YYYY-MM-DD to filter by date.
app.get('/api/national/reports/history', rolesLib.requireNational, async (req, res) => {
  try {
    const filter = {};
    if (req.query.from || req.query.to) {
      filter.reportDate = {};
      if (req.query.from) filter.reportDate.$gte = new Date(req.query.from);
      if (req.query.to) filter.reportDate.$lte = new Date(req.query.to);
    }
    const reports = await models.NationalReport.find(filter)
      .sort({ reportDate: -1 }).limit(100).lean();
    res.json(reports);
  } catch (e) {
    res.status(500).json({ error: 'Could not load report history' });
  }
});

// ---------- admin protected routes ----------
// Leadership accounts. The admin creates one account per leader and assigns the
// office it belongs to; passwords are hashed and never readable afterwards.
// Only a National Coordinator may create/edit/hand over these two roles —
// assigning and changing a Chapter Coordinator is explicitly a national
// power (section 3), and nationalCoordinator accounts obviously can't be
// self-service either. Everything else (chapterAdmin and below) can be
// managed by that chapter's own Chapter Coordinator/Admin.
const NATIONAL_ONLY_ROLES = ['nationalCoordinator', 'coordinator'];

app.get('/api/admin/staff', requireChapterAdmin, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req, { required: false });
    const users = await repo.getAll('staffUsers', filter);
    res.json(users.map(({ passwordHash, ...safe }) => safe));
  } catch (e) {
    res.status(500).json({ error: 'Could not load leadership accounts' });
  }
});

app.post('/api/admin/staff', requireChapterAdmin, async (req, res) => {
  const { username, name, role, password } = req.body;
  if (!username || !role || !password) {
    return res.status(400).json({ error: 'Username, role and password are required' });
  }
  if (!PORTAL_ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const scope = rolesLib.getActingScope(req);
  if (NATIONAL_ONLY_ROLES.includes(role) && !scope.isNational) {
    return res.status(403).json({ error: 'Only the National Coordinator can assign this role.' });
  }
  // A chapter-scoped admin can only ever create accounts for their own
  // chapter, regardless of what the request body claims.
  const chapterId = role === 'nationalCoordinator' ? '' : await resolveChapterIdForWrite(req, req.body.chapterId);
  if (role !== 'nationalCoordinator' && !chapterId) {
    return res.status(400).json({ error: 'A chapter is required for this role — this deployment now has more than one, please specify which.' });
  }
  try {
    if (chapterId) {
      const chapter = await repo.getById('chapters', chapterId);
      if (!chapter) return res.status(400).json({ error: 'Unknown chapter' });
    }
    const clean = String(username).toLowerCase().trim();
    const existing = await models.StaffUser.findOne({ username: clean });
    if (existing) return res.status(400).json({ error: 'That username is already taken' });
    const user = await repo.create('staffUsers', {
      username: clean, name: name || clean, role, chapterId,
      passwordHash: await bcrypt.hash(password, 10), active: true
    }, 'staff');
    const { passwordHash, ...safe } = user;
    res.json({ success: true, item: safe });
  } catch (e) {
    res.status(500).json({ error: 'Could not create this account' });
  }
});

app.put('/api/admin/staff/:id', requireChapterAdmin, async (req, res) => {
  const { name, role, password, active } = req.body;
  if (role && !PORTAL_ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role' });
  if (password && password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const scope = rolesLib.getActingScope(req);
  try {
    const existing = await repo.getById('staffUsers', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Account not found' });
    if (!scope.isNational && existing.chapterId !== scope.chapterId) {
      return res.status(403).json({ error: 'That account belongs to a different chapter.' });
    }
    if (!scope.isNational && (NATIONAL_ONLY_ROLES.includes(existing.role) || (role && NATIONAL_ONLY_ROLES.includes(role)))) {
      return res.status(403).json({ error: 'Only the National Coordinator can change this role.' });
    }
    const updated = await repo.updateById('staffUsers', req.params.id, {
      ...existing,
      name: name !== undefined ? name : existing.name,
      role: role || existing.role,
      active: active !== undefined ? !!active : existing.active,
      passwordHash: password ? await bcrypt.hash(password, 10) : existing.passwordHash
    });
    const { passwordHash, ...safe } = updated;
    res.json({ success: true, item: safe });
  } catch (e) {
    res.status(500).json({ error: 'Could not update this account' });
  }
});

app.delete('/api/admin/staff/:id', requireChapterAdmin, async (req, res) => {
  const scope = rolesLib.getActingScope(req);
  try {
    const existing = await repo.getById('staffUsers', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Account not found' });
    if (!scope.isNational && existing.chapterId !== scope.chapterId) {
      return res.status(403).json({ error: 'That account belongs to a different chapter.' });
    }
    if (!scope.isNational && NATIONAL_ONLY_ROLES.includes(existing.role)) {
      return res.status(403).json({ error: 'Only the National Coordinator can remove this role.' });
    }
    await repo.removeById('staffUsers', req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete this account' });
  }
});

app.get('/api/admin/members', requireChapterAdmin, async (req, res) => {
  try {
    const members = await repo.getAll('members', rolesLib.chapterFilter(req, { required: false }));
    res.json(members.map(({ passwordHash, ...safe }) => safe));
  } catch (e) {
    res.status(500).json({ error: 'Could not load members' });
  }
});

app.put('/api/admin/members/:id', requireChapterAdmin, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req, { required: false });
    const existing = await repo.getById('members', req.params.id, filter);
    if (!existing) return res.status(404).json({ error: 'Member not found' });
    // Deliberately whitelist editable fields — never allow admin to touch
    // passwordHash or email through this route (email changes go through the
    // member's own account flow to avoid silently locking someone out).
    const { name, phone, level, programme, hostel, department, birthdayMonth, birthdayDay } = req.body;
    const updated = await repo.updateById('members', req.params.id, {
      ...existing,
      name: name !== undefined ? name : existing.name,
      phone: phone !== undefined ? phone : existing.phone,
      level: level !== undefined ? level : existing.level,
      programme: programme !== undefined ? programme : existing.programme,
      hostel: hostel !== undefined ? hostel : existing.hostel,
      department: department !== undefined ? department : existing.department,
      birthdayMonth: birthdayMonth !== undefined ? (birthdayMonth ? Number(birthdayMonth) : null) : existing.birthdayMonth,
      birthdayDay: birthdayDay !== undefined ? (birthdayDay ? Number(birthdayDay) : null) : existing.birthdayDay
    }, filter);
    const { passwordHash, ...safe } = updated;
    res.json({ success: true, item: safe });
  } catch (e) {
    res.status(500).json({ error: 'Could not update member' });
  }
});

app.delete('/api/admin/members/:id', requireChapterAdmin, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req, { required: false });
    const existing = await repo.getById('members', req.params.id, filter);
    if (!existing) return res.status(404).json({ error: 'Member not found' });
    if (existing.profileImageFileId) {
      gridfs.deleteFile(existing.profileImageFileId).catch(() => {});
    }
    await repo.removeById('members', req.params.id, filter);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete member' });
  }
});


app.get('/api/admin/join-requests', requireChapterAdmin, async (req, res) => {
  res.json(await repo.getAll('joinRequests', rolesLib.chapterFilter(req, { required: false })));
});
app.get('/api/admin/prayer-requests', requireChapterAdmin, async (req, res) => {
  res.json(await repo.getAll('prayerRequests', rolesLib.chapterFilter(req, { required: false })));
});
app.get('/api/admin/testimonies', requireChapterAdmin, async (req, res) => {
  res.json(await repo.getAll('testimonies', rolesLib.chapterFilter(req, { required: false })));
});
app.get('/api/admin/contact-messages', requireChapterAdmin, async (req, res) => {
  res.json(await repo.getAll('contactMessages', rolesLib.chapterFilter(req, { required: false })));
});

// National settings only — a chapter's own About/contact/payment info lives
// on its Chapter record instead (edited via the National/Chapter Coordinator
// portals), so this stays a National Coordinator action.
app.put('/api/admin/settings', requireAdmin, async (req, res) => {
  await repo.setSettings(req.body);
  res.json({ success: true });
});

app.patch('/api/admin/join-requests/:id', requireChapterAdmin, async (req, res) => {
  const { chapterId, ...body } = req.body;
  const item = await repo.patchById('joinRequests', req.params.id, body, rolesLib.chapterFilter(req, { required: false }));
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

app.patch('/api/admin/prayer-requests/:id', requireChapterAdmin, async (req, res) => {
  const { chapterId, ...body } = req.body;
  const item = await repo.patchById('prayerRequests', req.params.id, body, rolesLib.chapterFilter(req, { required: false }));
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

app.patch('/api/admin/testimonies/:id', requireChapterAdmin, async (req, res) => {
  const { chapterId, ...body } = req.body;
  const item = await repo.patchById('testimonies', req.params.id, body, rolesLib.chapterFilter(req, { required: false }));
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

app.get('/api/admin/events/:id/registrations', requireChapterAdmin, async (req, res) => {
  try {
    const filter = { eventId: req.params.id, ...rolesLib.chapterFilter(req, { required: false }) };
    const regs = await models.EventRegistration.find(filter).sort({ createdAt: -1 }).lean();
    res.json(regs.map((r) => { delete r._id; delete r.__v; return r; }));
  } catch (e) {
    res.status(500).json({ error: 'Could not load registrations' });
  }
});

// Every upload says where it is going to be used. This is stored on the file
// itself, so the media library can show "this one is the Choir header" instead
// of a wall of anonymous thumbnails — and so a header can be wired up to its
// department in the same step as the upload.
const IMAGE_PLACEMENTS = {
  'department-header': {
    label: 'Department header',
    needsTarget: 'department',
    describe: (name) => `Shown as the big banner across the top of the ${name || 'selected'} department page, and on its card in the departments list.`
  },
  'page-gallery': {
    label: 'Photo on a custom page',
    needsTarget: 'page',
    describe: (name) => `Added to the ${name || 'selected'} page's gallery or resource shelf.`
  },
  'home-header': {
    label: 'Home page header banner',
    needsTarget: '',
    describe: () => 'Sets the large hero image at the top of the home page for the current week. This is different from the floating decorative photo.'
  },
  'home-floating': {
    label: 'Floating home-page photo',
    needsTarget: '',
    describe: () => 'Drifts around the hero area on the home page and department pages as a decorative photo.'
  },
  'executive-photo': {
    label: 'Executive portrait',
    needsTarget: '',
    describe: () => 'Kept in the library for use as an executive portrait. Assign it from the Executives panel.'
  },
  'event-flyer': {
    label: 'Event flyer',
    needsTarget: 'event',
    describe: (name) => `Shown on the ${name || 'selected'} event's page, and on the homepage once the event is published.`
  },
  'library': {
    label: 'Library only (not shown anywhere yet)',
    needsTarget: '',
    describe: () => 'Stored in the media library only. Nothing on the public site changes until you place it somewhere.'
  }
};

// The front-end asks for this so the placement picker and its explanations are
// defined in exactly one place.
app.get('/api/admin/image-placements', requireContentManager, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req, { required: false });
    const [departments, pages, events] = await Promise.all([repo.getAll('departments', filter), repo.getAll('pages', filter), repo.getAll('events', filter)]);
    res.json({
      placements: Object.entries(IMAGE_PLACEMENTS).map(([value, p]) => ({
        value, label: p.label, needsTarget: p.needsTarget, description: p.describe('')
      })),
      departments: departments.map(d => ({ id: d.id, name: d.name, hasHeader: !!d.headerImageFileId })),
      pages: pages.filter(p => p.type === 'gallery' || p.type === 'bookshelf').map(p => ({ id: p.slug, name: p.title })),
      events: events.map(e => ({ id: e.id, name: e.title, hasFlyer: !!e.flyerFileId }))
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not load placement options' });
  }
});

app.post('/api/admin/uploads', requireContentManager, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const { category, pageSlug, title, description, targetId } = req.body;
    const placement = IMAGE_PLACEMENTS[req.body.placement] ? req.body.placement : 'library';
    const spec = IMAGE_PLACEMENTS[placement];
    if (spec.needsTarget && !targetId) {
      return res.status(400).json({ error: `Choose which ${spec.needsTarget} this image belongs to.` });
    }
    const filter = rolesLib.chapterFilter(req, { required: false });
    const chapterId = rolesLib.chapterIdForWrite(req);

    const compressed = await compressIfImage(req.file.buffer, req.file.mimetype);
    // A gallery placement is really "photo on this page", which the public pages
    // already read through pageSlug — so keep that field in step with it.
    const slug = placement === 'page-gallery' ? targetId : (pageSlug || '');
    const fileId = await gridfs.uploadBuffer(compressed.buffer, req.file.originalname, {
      category: category || 'photo',
      pageSlug: slug,
      placement,
      targetId: targetId || '',
      title: title || req.file.originalname,
      description: description || '',
      contentType: compressed.contentType,
      chapterId
    });

    // A department header / event flyer is only useful once the record
    // points at it, so do that here rather than making the admin remember a
    // second step.
    let placedOn = '';
    if (placement === 'department-header' && targetId) {
      const dept = await repo.getById('departments', targetId, filter);
      if (dept) {
        if (dept.headerImageFileId) gridfs.deleteFile(dept.headerImageFileId).catch(() => {});
        await repo.patchById('departments', targetId, { headerImageFileId: String(fileId) }, filter);
        placedOn = dept.name;
      }
    } else if (placement === 'event-flyer' && targetId) {
      const event = await repo.getById('events', targetId, filter);
      if (event) {
        if (event.flyerFileId) gridfs.deleteFile(event.flyerFileId).catch(() => {});
        await repo.patchById('events', targetId, { flyerFileId: String(fileId) }, filter);
        placedOn = event.title;
      }
    } else if (placement === 'home-header') {
      const current = (await repo.getSettings()).homeHeaderImageFileId || '';
      if (current) gridfs.deleteFile(current).catch(() => {});
      await repo.setSettings({ ...(await repo.getSettings()), homeHeaderImageFileId: String(fileId) });
      placedOn = 'Home page header';
    }
    res.json({ success: true, id: fileId, placement, placedOn, message: spec.describe(placedOn) });
  } catch (e) {
    res.status(500).json({ error: 'Upload failed. The file may be too large (30MB max).' });
  }
});

// Point a department at an image that is already in the library, without
// re-uploading it.
app.put('/api/admin/departments/:id/header-image', requireChapterAdmin, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req, { required: false });
    const dept = await repo.getById('departments', req.params.id, filter);
    if (!dept) return res.status(404).json({ error: 'Department not found' });
    const fileId = req.body.headerImageFileId || '';
    await repo.patchById('departments', req.params.id, { headerImageFileId: fileId }, filter);
    res.json({ success: true, headerImageFileId: fileId });
  } catch (e) {
    res.status(500).json({ error: 'Could not set the header image' });
  }
});

app.delete('/api/admin/files/:id', requireChapterAdmin, async (req, res) => {
  try {
    const scope = rolesLib.getActingScope(req);
    const file = await gridfs.findFile(req.params.id);
    if (!file) return res.status(404).json({ error: 'File not found' });
    // A chapter-scoped admin can only delete files uploaded under their own
    // chapter — files predating this field (chapterId '') are treated as
    // belonging to nobody in particular and left to a national actor.
    if (!scope.isNational && (file.metadata || {}).chapterId !== scope.chapterId) {
      return res.status(403).json({ error: 'That file belongs to a different chapter.' });
    }
    // Don't leave a department pointing at a header that no longer exists.
    await models.Department.updateMany(
      { headerImageFileId: req.params.id }, { $set: { headerImageFileId: '' } }
    );
    await gridfs.deleteFile(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete file' });
  }
});

app.post('/api/admin/executives', requireChapterAdmin, upload.single('image'), async (req, res) => {
  try {
    const chapterId = await resolveChapterIdForWrite(req, req.body.chapterId);
    if (!chapterId) return res.status(400).json({ error: 'A chapter is required — this deployment now has more than one, please specify which.' });
    let imageFileId = '';
    if (req.file) {
      const compressed = await compressIfImage(req.file.buffer, req.file.mimetype);
      imageFileId = String(await gridfs.uploadBuffer(compressed.buffer, req.file.originalname, {
        category: 'executive', contentType: compressed.contentType, title: req.body.name || req.file.originalname, chapterId
      }));
    }
    const exec = await repo.create('executives', {
      chapterId,
      name: req.body.name || '',
      role: req.body.role || '',
      bio: req.body.bio || '',
      order: Number(req.body.order || 0),
      imageFileId
    }, 'exec');
    res.json({ success: true, item: exec });
  } catch (e) {
    res.status(500).json({ error: 'Could not save executive' });
  }
});

app.put('/api/admin/executives/:id', requireChapterAdmin, upload.single('image'), async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req, { required: false });
    const existing = await repo.getById('executives', req.params.id, filter);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    let imageFileId = existing.imageFileId || '';
    if (req.file) {
      const compressed = await compressIfImage(req.file.buffer, req.file.mimetype);
      imageFileId = String(await gridfs.uploadBuffer(compressed.buffer, req.file.originalname, {
        category: 'executive', contentType: compressed.contentType, title: req.body.name || req.file.originalname, chapterId: existing.chapterId
      }));
      if (existing.imageFileId) {
        gridfs.deleteFile(existing.imageFileId).catch(() => {}); // best-effort cleanup of the old photo
      }
    }
    const updated = await repo.updateById('executives', req.params.id, {
      name: req.body.name || '',
      role: req.body.role || '',
      bio: req.body.bio || '',
      order: Number(req.body.order || 0),
      imageFileId
    }, filter);
    res.json({ success: true, item: updated });
  } catch (e) {
    res.status(500).json({ error: 'Could not update executive' });
  }
});

app.delete('/api/admin/executives/:id', requireChapterAdmin, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req, { required: false });
    const existing = await repo.getById('executives', req.params.id, filter);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (existing.imageFileId) {
      gridfs.deleteFile(existing.imageFileId).catch(() => {});
    }
    await repo.removeById('executives', req.params.id, filter);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete executive' });
  }
});

// When a national actor (the bootstrap admin login, or a real National
// Coordinator account) writes chapter-scoped content without saying which
// chapter, and exactly one chapter exists, default to it — keeps today's
// single-chapter flow exactly as frictionless as before this shipped, while
// still requiring an explicit choice the moment a second chapter exists. A
// chapter-scoped admin/coordinator always writes into their own chapter,
// regardless of anything the request body claims.
async function resolveChapterIdForWrite(req, explicitChapterId) {
  const scope = rolesLib.getActingScope(req);
  if (!scope.isNational) return scope.chapterId;
  if (explicitChapterId) return explicitChapterId;
  const chapters = await repo.getAll('chapters', { status: 'active' });
  return chapters.length === 1 ? chapters[0].id : '';
}

// Phase 7 content management. Public-facing pages share this one persisted
// resource; it is still chapter-scoped unless a National Coordinator marks a
// church/ACONSU/founder item national.
const contentUpload = upload.fields([
  { name: 'imageFile', maxCount: 1 },
  { name: 'resourceFile', maxCount: 1 }
]);

app.get('/api/admin/content', requireContentManager, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req, { required: false });
    const items = await repo.getAll('contentItems', filter);
    res.json(items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  } catch (e) { res.status(500).json({ error: 'Could not load content' }); }
});

app.post('/api/admin/content', requireContentManager, contentUpload, async (req, res) => {
  try {
    const { kind, title } = req.body;
    if (!CONTENT_KINDS.includes(kind) || !title) return res.status(400).json({ error: 'A content type and title are required' });
    const national = (req.body.isNational === true || req.body.isNational === 'true') && rolesLib.getActingScope(req).isNational;
    const chapterId = national ? '' : await resolveChapterIdForWrite(req, req.body.chapterId);
    if (!national && !chapterId) return res.status(400).json({ error: 'A chapter is required.' });

    let imageFileId = req.body.imageFileId || '';
    let resourceFileId = req.body.resourceFileId || '';

    if (req.files && req.files.imageFile && req.files.imageFile[0]) {
      const f = req.files.imageFile[0];
      const compressed = await compressIfImage(f.buffer, f.mimetype);
      imageFileId = String(await gridfs.uploadBuffer(compressed.buffer, f.originalname, {
        category: 'content_image', contentType: compressed.contentType, title: title || f.originalname, chapterId
      }));
    }

    if (req.files && req.files.resourceFile && req.files.resourceFile[0]) {
      const f = req.files.resourceFile[0];
      resourceFileId = String(await gridfs.uploadBuffer(f.buffer, f.originalname, {
        category: 'content_resource', contentType: f.mimetype, title: title || f.originalname, chapterId
      }));
    }

    const item = await repo.create('contentItems', {
      chapterId, kind, title: String(title).trim(),
      summary: req.body.summary || '',
      body: req.body.body || '',
      imageFileId,
      previewUrl: req.body.previewUrl || '',
      resourceUrl: req.body.resourceUrl || '',
      resourceFileId,
      category: req.body.category || '',
      eventDate: req.body.eventDate || '',
      published: req.body.published !== false && req.body.published !== 'false',
      featured: req.body.featured === true || req.body.featured === 'true',
      sortOrder: Number(req.body.sortOrder) || 0,
      createdBy: actorName(req)
    }, 'content');
    res.json({ success: true, item });
  } catch (e) { res.status(500).json({ error: 'Could not create content' }); }
});

app.put('/api/admin/content/:id', requireContentManager, contentUpload, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req, { required: false });
    const existing = await repo.getById('contentItems', req.params.id, filter);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    let imageFileId = existing.imageFileId || '';
    let resourceFileId = existing.resourceFileId || '';

    if (req.files && req.files.imageFile && req.files.imageFile[0]) {
      const f = req.files.imageFile[0];
      const compressed = await compressIfImage(f.buffer, f.mimetype);
      const newImgId = String(await gridfs.uploadBuffer(compressed.buffer, f.originalname, {
        category: 'content_image', contentType: compressed.contentType, title: req.body.title || existing.title || f.originalname, chapterId: existing.chapterId
      }));
      if (existing.imageFileId) {
        gridfs.deleteFile(existing.imageFileId).catch(() => {});
      }
      imageFileId = newImgId;
    } else if (req.body.imageFileId !== undefined) {
      imageFileId = req.body.imageFileId;
    }

    if (req.files && req.files.resourceFile && req.files.resourceFile[0]) {
      const f = req.files.resourceFile[0];
      const newResId = String(await gridfs.uploadBuffer(f.buffer, f.originalname, {
        category: 'content_resource', contentType: f.mimetype, title: req.body.title || existing.title || f.originalname, chapterId: existing.chapterId
      }));
      if (existing.resourceFileId) {
        gridfs.deleteFile(existing.resourceFileId).catch(() => {});
      }
      resourceFileId = newResId;
    } else if (req.body.resourceFileId !== undefined) {
      resourceFileId = req.body.resourceFileId;
    }

    const { id, chapterId, kind, createdBy, ...editable } = req.body;
    const updatedFields = {
      ...existing,
      ...editable,
      imageFileId,
      resourceFileId,
      published: req.body.published !== undefined ? (req.body.published === true || req.body.published === 'true') : existing.published,
      featured: req.body.featured !== undefined ? (req.body.featured === true || req.body.featured === 'true') : existing.featured,
      sortOrder: req.body.sortOrder !== undefined ? (Number(req.body.sortOrder) || 0) : existing.sortOrder
    };

    const item = await repo.updateById('contentItems', req.params.id, updatedFields, filter);
    res.json({ success: true, item });
  } catch (e) { res.status(500).json({ error: 'Could not update content' }); }
});

app.delete('/api/admin/content/:id', requireContentManager, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req, { required: false });
    const existing = await repo.getById('contentItems', req.params.id, filter);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    if (existing.imageFileId) {
      gridfs.deleteFile(existing.imageFileId).catch(() => {});
    }
    if (existing.resourceFileId) {
      gridfs.deleteFile(existing.resourceFileId).catch(() => {});
    }

    const removed = await repo.removeById('contentItems', req.params.id, filter);
    if (!removed) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Could not delete content' }); }
});

// generic CRUD for departments / events / sermons / pages (Chapter Admin and above)
['departments', 'events', 'sermons', 'pages'].forEach((resource) => {
  const prefix = resource.slice(0, 4);

  app.post(`/api/admin/${resource}`, requireChapterAdmin, async (req, res) => {
    try {
      const chapterId = await resolveChapterIdForWrite(req, req.body.chapterId);
      if (!chapterId && !(resource === 'events' && req.body.isNational)) {
        return res.status(400).json({ error: 'A chapter is required — this deployment now has more than one, please specify which.' });
      }
      const item = await repo.create(resource, { ...req.body, chapterId }, prefix);
      res.json({ success: true, item });
      // Automatic announcement — fires after responding, so it never slows down or breaks the save itself.
      if (resource === 'events') {
        createNotification(
          'New Event: ' + (item.title || 'Untitled'),
          `${item.title || 'A new event'} — ${item.date || ''} ${item.time || ''}${item.location ? ' at ' + item.location : ''}`.trim(),
          '/events.html', 'system', item.isNational ? '' : chapterId
        ).catch(() => {});
      } else if (resource === 'sermons') {
        createNotification(
          'New Sermon: ' + (item.title || 'Untitled'),
          `${item.speaker ? item.speaker + ' — ' : ''}${item.title || 'A new sermon'} is now available.`,
          '/media.html', 'system', chapterId
        ).catch(() => {});
      }
    } catch (e) {
      res.status(500).json({ error: 'Could not save' });
    }
  });

  app.put(`/api/admin/${resource}/:id`, requireChapterAdmin, async (req, res) => {
    const filter = rolesLib.chapterFilter(req, { required: false });
    // chapterId isn't editable through this route — moving a record between
    // chapters isn't a supported operation, and silently allowing it here
    // would be exactly the kind of body-tampering section 43 rules out.
    const { chapterId, ...body } = req.body;
    const item = await repo.updateById(resource, req.params.id, body, filter);
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, item });
  });

  app.delete(`/api/admin/${resource}/:id`, requireChapterAdmin, async (req, res) => {
    const filter = rolesLib.chapterFilter(req, { required: false });
    await repo.removeById(resource, req.params.id, filter);
    res.json({ success: true });
  });
});

// ---------- fallback ----------
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', '404.html'), (err) => {
    if (err) res.status(404).send('Not found');
  });
});

// ---------- automatic daily birthday check ----------
// Runs once at startup and then every hour. Uses a DB-stored flag (not memory)
// so a server restart never causes a duplicate birthday push on the same day.
async function checkBirthdaysAndNotify() {
  try {
    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10); // 'YYYY-MM-DD'
    const state = await models.SystemState.findOneAndUpdate(
      { singleton: 'main' }, {}, { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (state.lastBirthdayNotifDate === todayKey) return; // already sent today

    const month = now.getMonth() + 1;
    const day = now.getDate();
    const members = await models.Member.find({ birthdayMonth: month, birthdayDay: day }).lean();

    // One notification per chapter, so Chapter A never sees a shout-out for a
    // Chapter B member — grouped rather than sent per-member to keep it to a
    // single friendly push per chapter per day, same tone as before.
    const byChapter = new Map();
    members.forEach((m) => {
      const key = m.chapterId || '';
      if (!byChapter.has(key)) byChapter.set(key, []);
      byChapter.get(key).push(m);
    });
    for (const [chapterId, group] of byChapter) {
      const firstNames = group.map((m) => (m.name || '').trim().split(/\s+/)[0]).filter(Boolean);
      const names = firstNames.length <= 3
        ? firstNames.join(', ')
        : `${firstNames.slice(0, 3).join(', ')} and ${firstNames.length - 3} more`;
      await createNotification(
        '🎉 Happy Birthday!',
        `Join us in celebrating ${names} today!`,
        '/index.html', 'system', chapterId
      );
    }
    await models.SystemState.updateOne({ singleton: 'main' }, { $set: { lastBirthdayNotifDate: todayKey } });
  } catch (e) {
    console.error('Birthday check failed:', e.message);
  }
}

// ---------- scheduled announcements ----------
// Publicity picks a time; this loop is what makes that time mean something.
// Each due announcement is claimed with a single atomic update before it is
// sent, so two server instances (or a restart mid-send) can never double-send.
async function sendDueAnnouncements() {
  try {
    const due = await models.ScheduledNotification.find({
      status: 'scheduled', scheduledFor: { $lte: new Date() }
    }).lean();

    for (const item of due) {
      const claimed = await models.ScheduledNotification.findOneAndUpdate(
        { id: item.id, status: 'scheduled' },
        { $set: { status: 'sent', sentAt: new Date() } },
        { new: true }
      );
      if (!claimed) continue; // another worker got there first

      try {
        const result = await dispatchAnnouncement({
          title: item.title, body: item.body, url: item.url,
          channels: item.channels, audience: item.audience, sourceId: item.id,
          chapterId: item.chapterId
        });
        await models.ScheduledNotification.updateOne({ id: item.id }, { $set: { result } });
      } catch (err) {
        await models.ScheduledNotification.updateOne(
          { id: item.id }, { $set: { status: 'failed', result: err.message } }
        );
      }
    }
  } catch (e) {
    console.error('Scheduled announcement check failed:', e.message);
  }
}

// ---------- startup ----------
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`ACONSU app running on http://localhost:${PORT}`);
    });
    checkBirthdaysAndNotify();
    setInterval(checkBirthdaysAndNotify, 60 * 60 * 1000); // re-check hourly in case the server started mid-day
    sendDueAnnouncements();
    setInterval(sendDueAnnouncements, 60 * 1000); // a minute's precision is plenty for announcements
  })
  .catch((err) => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });
