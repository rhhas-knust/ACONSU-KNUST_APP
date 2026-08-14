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
const BIBLE_BOOKS = require('./lib/bibleBooks');
const push = require('./lib/push');
const sms = require('./lib/sms');
const mailer = require('./lib/mailer');
const { compressIfImage } = require('./lib/imageProcess');
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
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
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

// ---------- leadership portal auth (coordinator / finance / shepherding / publicity) ----------
// Every union leader gets their own account, created by the admin, so access can
// be handed to a person rather than to a shared password. Three ways in are
// accepted, in this order:
//   1. a StaffUser account with the matching role  (the normal case)
//   2. the main admin session                       (admin can always get in)
//   3. the legacy SHEPHERD_* env login              (kept so nothing breaks mid-term)
// The coordinator role deliberately satisfies *read* checks for every area —
// that's the whole point of the role — but never the write ones.
const PORTAL_ROLES = ['coordinator', 'finance', 'shepherding', 'publicity'];

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
  if (role === 'shepherding' && req.session.isShepherd) return true;
  const staff = currentStaff(req);
  return !!(staff && staff.role === role);
}

// Read access: the role itself, or the coordinator who oversees all of them.
function canView(req, role) {
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

app.post('/api/portal/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  try {
    // The shepherding portal shipped with an env-file login before leadership
    // accounts existed. Honour it here so whoever is using it today keeps
    // getting in while the admin creates their proper account.
    if (process.env.SHEPHERD_USERNAME
        && username === process.env.SHEPHERD_USERNAME
        && password === process.env.SHEPHERD_PASSWORD) {
      req.session.isShepherd = true;
      req.session.staff = { id: '', username, name: 'Shepherding Head', role: 'shepherding' };
      return res.json({ success: true, staff: req.session.staff });
    }

    const user = await models.StaffUser.findOne({ username: String(username).toLowerCase().trim() });
    if (!user || !user.active) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    req.session.staff = { id: user.id, username: user.username, name: user.name || user.username, role: user.role };
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
app.get('/api/portal/me', (req, res) => {
  const staff = currentStaff(req);
  const isAdmin = !!(req.session && req.session.isAdmin);
  res.json({
    staff,
    isAdmin,
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

// ---------- notifications helper ----------
// Saves a notification for the in-app feed AND fires a real push to every
// subscribed device. Used both by the manual admin route and automatic
// triggers (new event, new sermon, birthdays).
async function createNotification(title, body, url, source) {
  const notif = await repo.create('notifications', {
    title, body, url: url || '/index.html', source: source || 'admin'
  }, 'notif');
  push.sendPushToAll({ title, body, url: url || '/index.html' }).catch(() => {});
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
app.post('/api/auth/register', loginLimiter, async (req, res) => {
  const { name, email, password, phone, level, department, birthdayMonth, birthdayDay } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const month = birthdayMonth ? Number(birthdayMonth) : null;
  const day = birthdayDay ? Number(birthdayDay) : null;
  if ((month && !day) || (day && !month)) {
    return res.status(400).json({ error: 'Please provide both a birthday month and day, or leave both blank' });
  }
  if (month && (month < 1 || month > 12)) return res.status(400).json({ error: 'Invalid birthday month' });
  if (day && (day < 1 || day > 31)) return res.status(400).json({ error: 'Invalid birthday day' });
  try {
    const existing = await models.Member.findOne({ email: email.toLowerCase().trim() });
    if (existing) return res.status(400).json({ error: 'An account with this email already exists' });
    const passwordHash = await bcrypt.hash(password, 10);
    const member = await repo.create('members', {
      name, email: email.toLowerCase().trim(), passwordHash,
      phone: phone || '', level: level || '', department: department || '',
      birthdayMonth: month, birthdayDay: day
    }, 'mem');
    req.session.memberId = member.id;
    res.json({ success: true, member: { id: member.id, name: member.name, email: member.email } });
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

app.put('/api/member/profile', requireMember, upload.single('profileImage'), async (req, res) => {
  try {
    const existing = await repo.getById('members', req.session.memberId);
    if (!existing) return res.status(404).json({ error: 'Account not found' });
    let profileImageFileId = existing.profileImageFileId || '';
    if (req.file) {
      const compressed = await compressIfImage(req.file.buffer, req.file.mimetype);
      profileImageFileId = String(await gridfs.uploadBuffer(compressed.buffer, req.file.originalname, {
        category: 'member-profile', contentType: compressed.contentType, title: req.body.name || existing.name
      }));
      if (existing.profileImageFileId) gridfs.deleteFile(existing.profileImageFileId).catch(() => {});
    }
    const month = req.body.birthdayMonth ? Number(req.body.birthdayMonth) : null;
    const day = req.body.birthdayDay ? Number(req.body.birthdayDay) : null;
    if ((month && !day) || (day && !month)) {
      return res.status(400).json({ error: 'Please provide both a birthday month and day, or leave both blank' });
    }
    const updates = {
      name: req.body.name || existing.name,
      phone: req.body.phone || '',
      level: req.body.level || '',
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

app.get('/api/birthdays/today', async (req, res) => {
  try {
    const now = new Date();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const members = await models.Member.find({ birthdayMonth: month, birthdayDay: day }).lean();
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
    const items = await repo.getAll('notifications');
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
    await repo.create('pushSubscriptions', {
      endpoint: subscription.endpoint,
      keys: subscription.keys || {},
      memberId: (req.session && req.session.memberId) || ''
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


['departments', 'sermons', 'testimonies'].forEach((resource) => {
  app.get(`/api/${resource}`, async (req, res) => {
    try {
      const items = await repo.getAll(resource);
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

// events need per-event registration counts attached, so they get their own route
app.get('/api/events', async (req, res) => {
  try {
    const events = await repo.getAll('events');
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
    const pages = await repo.getAll('pages');
    res.json(pages.sort((a, b) => (a.order || 0) - (b.order || 0)));
  } catch (e) {
    res.status(500).json({ error: 'Could not load pages' });
  }
});

app.get('/api/pages/:slug', async (req, res) => {
  try {
    const pages = await repo.getAll('pages');
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
    const execs = await repo.getAll('executives');
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
    await repo.create('joinRequests', {
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

app.post('/api/prayer-requests', formLimiter, async (req, res) => {
  const { name, email, request, isPrivate } = req.body;
  if (!request) return res.status(400).json({ error: 'Request details are required' });
  try {
    await repo.create('prayerRequests', {
      name: name || 'Anonymous', email: email || '', request, isPrivate: !!isPrivate, status: 'new'
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

app.post('/api/testimonies', formLimiter, async (req, res) => {
  const { name, testimony } = req.body;
  if (!testimony) return res.status(400).json({ error: 'Testimony is required' });
  try {
    await repo.create('testimonies', {
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
    await repo.create('contactMessages', { name, email, message, status: 'new' }, 'msg');
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
      eventId: event.id, name, email, phone: phone || ''
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
    const [members, records] = await Promise.all([
      repo.getAll('members'),
      repo.getAll('shepherdingRecords')
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
        department: m.department,
        birthdayMonth: m.birthdayMonth,
        birthdayDay: m.birthdayDay,
        imageFileId: (record && record.imageFileId) || m.profileImageFileId || '',
        address: record ? record.address : '',
        emergencyContact: record ? record.emergencyContact : '',
        attendanceStatus: record ? record.attendanceStatus : 'new',
        lastContactDate: record ? record.lastContactDate : '',
        pastoralNotes: record ? record.pastoralNotes : ''
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
    let existing = null;
    if (recordId) {
      existing = await repo.getById('shepherdingRecords', recordId);
    } else if (memberId) {
      existing = (await repo.getAll('shepherdingRecords')).find(r => r.memberId === memberId) || null;
    }

    const fields = {
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
    const existing = await repo.getById('shepherdingRecords', req.params.id);
    if (existing && existing.imageFileId) gridfs.deleteFile(existing.imageFileId).catch(() => {});
    await repo.removeById('shepherdingRecords', req.params.id);
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
    let records = await repo.getAll('attendanceRecords');
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
    const records = await repo.getAll('attendanceRecords');
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

    const existing = (await repo.getAll('attendanceRecords')).find(r => r.date === date && r.serviceType === service);
    const fields = {
      date, serviceType: service, title: title || '',
      marks: cleanMarks,
      visitorCount: Number(visitorCount || 0),
      notes: notes || '',
      recordedBy: actorName(req)
    };
    const record = existing
      ? await repo.updateById('attendanceRecords', existing.id, fields)
      : await repo.create('attendanceRecords', fields, 'att');
    res.json({ success: true, item: record });
  } catch (e) {
    res.status(500).json({ error: 'Could not save this register' });
  }
});

app.delete('/api/shepherd/attendance/:id', requireShepherd, async (req, res) => {
  try {
    await repo.removeById('attendanceRecords', req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete this register' });
  }
});

// Attendance history for one person — how many of the last services they made.
app.get('/api/shepherd/attendance-history/:memberId', requireViewRole('shepherding'), async (req, res) => {
  try {
    const records = await repo.getAll('attendanceRecords');
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

// ---------- Shepherding portal: member details ----------
// Shepherding keeps the pastoral picture of each person up to date, so they can
// correct the account details a member typed in a hurry at registration. Email
// and password stay off-limits here — changing an email from another person's
// screen is how people get locked out of their own account.
app.put('/api/shepherd/members/:id', requireShepherd, async (req, res) => {
  try {
    const existing = await repo.getById('members', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Member not found' });
    const { name, phone, level, department, birthdayMonth, birthdayDay } = req.body;
    const updated = await repo.updateById('members', req.params.id, {
      ...existing,
      name: name !== undefined ? name : existing.name,
      phone: phone !== undefined ? phone : existing.phone,
      level: level !== undefined ? level : existing.level,
      department: department !== undefined ? department : existing.department,
      birthdayMonth: birthdayMonth !== undefined ? (birthdayMonth ? Number(birthdayMonth) : null) : existing.birthdayMonth,
      birthdayDay: birthdayDay !== undefined ? (birthdayDay ? Number(birthdayDay) : null) : existing.birthdayDay
    });
    const { passwordHash, ...safe } = updated;
    res.json({ success: true, item: safe });
  } catch (e) {
    res.status(500).json({ error: 'Could not update this member' });
  }
});

// ---------- Shepherding portal: contact messages ----------
// Messages sent through the public contact form land here as well as with the
// admin — following up with the person who reached out is pastoral work.
app.get('/api/shepherd/contact-messages', requireViewRole('shepherding'), async (req, res) => {
  try {
    const items = await repo.getAll('contactMessages');
    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: 'Could not load messages' });
  }
});

app.patch('/api/shepherd/contact-messages/:id', requireShepherd, async (req, res) => {
  try {
    const status = req.body.status === 'replied' ? 'replied' : 'new';
    const item = await repo.patchById('contactMessages', req.params.id, { status });
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
    const entries = filterEntries(await repo.getAll('financeEntries'), req.query);
    entries.sort((a, b) => (a.date === b.date ? new Date(b.createdAt) - new Date(a.createdAt) : (a.date < b.date ? 1 : -1)));
    res.json(entries);
  } catch (e) {
    res.status(500).json({ error: 'Could not load finance records' });
  }
});

app.get('/api/finance/summary', requireViewRole('finance'), async (req, res) => {
  try {
    const all = await repo.getAll('financeEntries');
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
    const existing = await repo.getById('financeEntries', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (Number(req.body.amount) <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });
    const entry = await repo.updateById('financeEntries', req.params.id, {
      ...existing, ...financeEntryFromBody(req.body, req), recordedBy: existing.recordedBy || actorName(req)
    });
    res.json({ success: true, item: entry });
  } catch (e) {
    res.status(500).json({ error: 'Could not update this entry' });
  }
});

app.patch('/api/finance/entries/:id/approval', requireFinance, async (req, res) => {
  try {
    const status = req.body.approvalStatus;
    if (!['pending', 'approved', 'rejected', 'recorded'].includes(status)) {
      return res.status(400).json({ error: 'Invalid approval status' });
    }
    const item = await repo.patchById('financeEntries', req.params.id, {
      approvalStatus: status,
      approvedBy: status === 'approved' ? actorName(req) : ''
    });
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ error: 'Could not update this entry' });
  }
});

app.delete('/api/finance/entries/:id', requireFinance, async (req, res) => {
  try {
    const existing = await repo.getById('financeEntries', req.params.id);
    if (existing && existing.receiptFileId) gridfs.deleteFile(existing.receiptFileId).catch(() => {});
    await repo.removeById('financeEntries', req.params.id);
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
    const [budgets, entries] = await Promise.all([repo.getAll('budgets'), repo.getAll('financeEntries')]);
    budgets.sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
    const withPerformance = await Promise.all(budgets.map(b => budgetPerformance(b, entries)));
    res.json(withPerformance);
  } catch (e) {
    res.status(500).json({ error: 'Could not load budgets' });
  }
});

app.get('/api/finance/budgets/:id', requireViewRole('finance'), async (req, res) => {
  try {
    const budget = await repo.getById('budgets', req.params.id);
    if (!budget) return res.status(404).json({ error: 'Budget not found' });
    res.json(await budgetPerformance(budget, await repo.getAll('financeEntries')));
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
    const existing = await repo.getById('budgets', req.params.id);
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
    });
    res.json({ success: true, item: budget });
  } catch (e) {
    res.status(500).json({ error: 'Could not update this budget' });
  }
});

app.delete('/api/finance/budgets/:id', requireFinance, async (req, res) => {
  try {
    // Ledger entries survive their budget — the money still moved. They simply
    // stop pointing at a plan that no longer exists.
    await models.FinanceEntry.updateMany({ budgetId: req.params.id }, { $set: { budgetId: '', budgetLineId: '' } });
    await repo.removeById('budgets', req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete this budget' });
  }
});

// Spreadsheet-ready export of whatever the finance office is currently looking at.
app.get('/api/finance/export.csv', requireViewRole('finance'), async (req, res) => {
  try {
    const entries = filterEntries(await repo.getAll('financeEntries'), req.query);
    entries.sort((a, b) => (a.date < b.date ? -1 : 1));
    const budgets = await repo.getAll('budgets');
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

// ---------- Publicity office ----------
// Publicity owns everything that goes out to people: in-app announcements, push
// alerts, SMS, event updates, and the testimonies members send in.

// Does the actual sending for both "send now" and anything the scheduler picks
// up later, so a scheduled announcement behaves exactly like an immediate one.
async function dispatchAnnouncement({ title, body, url, channels, audience, sourceId }) {
  const useApp = !channels || channels.includes('app');
  const useSms = channels && channels.includes('sms');
  const parts = [];

  if (useApp) {
    await createNotification(title, body, url, 'admin');
    parts.push('posted to the app');
  }
  if (useSms) {
    const numbers = await sms.resolveAudience(audience);
    const text = `${title}\n${body}`.slice(0, 320); // ~2 SMS segments, keeps costs predictable
    const result = await sms.sendBatch(numbers, text, sourceId);
    parts.push(result.configured
      ? `SMS: ${result.sent} sent${result.failed ? `, ${result.failed} failed` : ''}${result.note ? ` — ${result.note}` : ''}`
      : `SMS skipped — ${result.note}`);
  }
  return parts.join(' · ') || 'Nothing to send — no channel was selected.';
}

app.get('/api/publicity/overview', requireViewRole('publicity'), async (req, res) => {
  try {
    const [notifications, scheduled, testimonies, smsLogs, events] = await Promise.all([
      repo.getAll('notifications'), repo.getAll('scheduledNotifications'),
      repo.getAll('testimonies'), repo.getAll('smsLogs'), repo.getAll('events')
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
    const departments = await repo.getAll('departments');
    const options = [{ value: 'all', label: 'Everyone (members + visitors)' }];
    departments.forEach(d => options.push({ value: `department:${d.id}`, label: `${d.name} department` }));
    const withCounts = await Promise.all(options.map(async (o) => ({
      ...o, reachable: (await sms.resolveAudience(o.value)).length
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
      title, body, url: url || '/index.html', channels: picked, audience: audience || 'all'
    });
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: 'Could not send this announcement' });
  }
});

app.get('/api/publicity/scheduled', requireViewRole('publicity'), async (req, res) => {
  try {
    const items = await repo.getAll('scheduledNotifications');
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
    const existing = await repo.getById('scheduledNotifications', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (existing.status !== 'scheduled') {
      return res.status(400).json({ error: 'This announcement has already gone out.' });
    }
    const item = await repo.patchById('scheduledNotifications', req.params.id, { status: 'cancelled' });
    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ error: 'Could not cancel this announcement' });
  }
});

app.delete('/api/publicity/scheduled/:id', requirePublicity, async (req, res) => {
  try {
    await repo.removeById('scheduledNotifications', req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not remove this announcement' });
  }
});

// Testimonies come in from the public form; publicity reviews them and decides
// what appears on the wall.
app.get('/api/publicity/testimonies', requireViewRole('publicity'), async (req, res) => {
  try {
    const items = await repo.getAll('testimonies');
    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: 'Could not load testimonies' });
  }
});

app.patch('/api/publicity/testimonies/:id', requirePublicity, async (req, res) => {
  try {
    const item = await repo.patchById('testimonies', req.params.id, { published: !!req.body.published });
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ error: 'Could not update this testimony' });
  }
});

app.delete('/api/publicity/testimonies/:id', requirePublicity, async (req, res) => {
  try {
    await repo.removeById('testimonies', req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete this testimony' });
  }
});

// Event updates: publicity keeps the calendar current and tells people when
// something changes, which is the part that actually matters to members.
app.post('/api/publicity/events', requirePublicity, async (req, res) => {
  try {
    const item = await repo.create('events', req.body, 'even');
    res.json({ success: true, item });
    createNotification(
      'New Event: ' + (item.title || 'Untitled'),
      `${item.title || 'A new event'} — ${item.date || ''} ${item.time || ''}${item.location ? ' at ' + item.location : ''}`.trim(),
      '/events.html', 'system'
    ).catch(() => {});
  } catch (e) {
    res.status(500).json({ error: 'Could not save this event' });
  }
});

app.put('/api/publicity/events/:id', requirePublicity, async (req, res) => {
  try {
    const { announceUpdate, ...fields } = req.body;
    const item = await repo.updateById('events', req.params.id, fields);
    if (!item) return res.status(404).json({ error: 'Event not found' });
    res.json({ success: true, item });
    if (announceUpdate) {
      createNotification(
        'Event Update: ' + (item.title || 'Untitled'),
        `${item.title || 'An event'} has been updated — ${item.date || ''} ${item.time || ''}${item.location ? ' at ' + item.location : ''}`.trim(),
        '/events.html', 'system'
      ).catch(() => {});
    }
  } catch (e) {
    res.status(500).json({ error: 'Could not update this event' });
  }
});

app.get('/api/publicity/sms-logs', requireViewRole('publicity'), async (req, res) => {
  try {
    const logs = await repo.getAll('smsLogs');
    logs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(logs.slice(0, 200));
  } catch (e) {
    res.status(500).json({ error: 'Could not load the SMS log' });
  }
});

// ---------- Coordinator ----------
// One screen showing the state of every office. Read-only by design: the
// coordinator oversees the work, the office that owns the data still does it.
app.get('/api/coordinator/overview', requireViewRole('coordinator'), async (req, res) => {
  try {
    const [
      members, departments, events, finance, budgets, attendance,
      joinRequests, prayerRequests, testimonies, contactMessages,
      notifications, scheduled, smsLogs, shepherdingRecords, staff
    ] = await Promise.all([
      repo.getAll('members'), repo.getAll('departments'), repo.getAll('events'),
      repo.getAll('financeEntries'), repo.getAll('budgets'), repo.getAll('attendanceRecords'),
      repo.getAll('joinRequests'), repo.getAll('prayerRequests'), repo.getAll('testimonies'),
      repo.getAll('contactMessages'), repo.getAll('notifications'), repo.getAll('scheduledNotifications'),
      repo.getAll('smsLogs'), repo.getAll('shepherdingRecords'), repo.getAll('staffUsers')
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
      finance: {
        ...financeTotals(finance),
        thisMonth: financeTotals(thisMonth),
        entryCount: finance.length,
        activeBudget: activeBudget ? await budgetPerformance(activeBudget, finance) : null,
        budgetCount: budgets.length
      },
      shepherding: {
        memberCount: members.length,
        visitorCount: shepherdingRecords.filter(r => !r.memberId).length,
        servicesRecorded: attendance.length,
        lastService: recentServices[0] || null,
        averageAttendance: avgAttendance,
        attendanceTrend,
        followUpNeeded: shepherdingRecords.filter(r => ['irregular', 'inactive'].includes(r.attendanceStatus)).length
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

// ---------- admin protected routes ----------
// Leadership accounts. The admin creates one account per leader and assigns the
// office it belongs to; passwords are hashed and never readable afterwards.
app.get('/api/admin/staff', requireAdmin, async (req, res) => {
  try {
    const users = await repo.getAll('staffUsers');
    res.json(users.map(({ passwordHash, ...safe }) => safe));
  } catch (e) {
    res.status(500).json({ error: 'Could not load leadership accounts' });
  }
});

app.post('/api/admin/staff', requireAdmin, async (req, res) => {
  const { username, name, role, password } = req.body;
  if (!username || !role || !password) {
    return res.status(400).json({ error: 'Username, role and password are required' });
  }
  if (!PORTAL_ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const clean = String(username).toLowerCase().trim();
    const existing = await models.StaffUser.findOne({ username: clean });
    if (existing) return res.status(400).json({ error: 'That username is already taken' });
    const user = await repo.create('staffUsers', {
      username: clean, name: name || clean, role,
      passwordHash: await bcrypt.hash(password, 10), active: true
    }, 'staff');
    const { passwordHash, ...safe } = user;
    res.json({ success: true, item: safe });
  } catch (e) {
    res.status(500).json({ error: 'Could not create this account' });
  }
});

app.put('/api/admin/staff/:id', requireAdmin, async (req, res) => {
  const { name, role, password, active } = req.body;
  if (role && !PORTAL_ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role' });
  if (password && password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const existing = await repo.getById('staffUsers', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Account not found' });
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

app.delete('/api/admin/staff/:id', requireAdmin, async (req, res) => {
  try {
    await repo.removeById('staffUsers', req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete this account' });
  }
});

app.get('/api/admin/members', requireAdmin, async (req, res) => {
  try {
    const members = await repo.getAll('members');
    res.json(members.map(({ passwordHash, ...safe }) => safe));
  } catch (e) {
    res.status(500).json({ error: 'Could not load members' });
  }
});

app.put('/api/admin/members/:id', requireAdmin, async (req, res) => {
  try {
    const existing = await repo.getById('members', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Member not found' });
    // Deliberately whitelist editable fields — never allow admin to touch
    // passwordHash or email through this route (email changes go through the
    // member's own account flow to avoid silently locking someone out).
    const { name, phone, level, department, birthdayMonth, birthdayDay } = req.body;
    const updated = await repo.updateById('members', req.params.id, {
      ...existing,
      name: name !== undefined ? name : existing.name,
      phone: phone !== undefined ? phone : existing.phone,
      level: level !== undefined ? level : existing.level,
      department: department !== undefined ? department : existing.department,
      birthdayMonth: birthdayMonth !== undefined ? (birthdayMonth ? Number(birthdayMonth) : null) : existing.birthdayMonth,
      birthdayDay: birthdayDay !== undefined ? (birthdayDay ? Number(birthdayDay) : null) : existing.birthdayDay
    });
    const { passwordHash, ...safe } = updated;
    res.json({ success: true, item: safe });
  } catch (e) {
    res.status(500).json({ error: 'Could not update member' });
  }
});

app.delete('/api/admin/members/:id', requireAdmin, async (req, res) => {
  try {
    const existing = await repo.getById('members', req.params.id);
    if (existing && existing.profileImageFileId) {
      gridfs.deleteFile(existing.profileImageFileId).catch(() => {});
    }
    await repo.removeById('members', req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete member' });
  }
});


app.get('/api/admin/join-requests', requireAdmin, async (req, res) => {
  res.json(await repo.getAll('joinRequests'));
});
app.get('/api/admin/prayer-requests', requireAdmin, async (req, res) => {
  res.json(await repo.getAll('prayerRequests'));
});
app.get('/api/admin/testimonies', requireAdmin, async (req, res) => {
  res.json(await repo.getAll('testimonies'));
});
app.get('/api/admin/contact-messages', requireAdmin, async (req, res) => {
  res.json(await repo.getAll('contactMessages'));
});

app.put('/api/admin/settings', requireAdmin, async (req, res) => {
  await repo.setSettings(req.body);
  res.json({ success: true });
});

app.patch('/api/admin/join-requests/:id', requireAdmin, async (req, res) => {
  const item = await repo.patchById('joinRequests', req.params.id, req.body);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

app.patch('/api/admin/prayer-requests/:id', requireAdmin, async (req, res) => {
  const item = await repo.patchById('prayerRequests', req.params.id, req.body);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

app.patch('/api/admin/testimonies/:id', requireAdmin, async (req, res) => {
  const item = await repo.patchById('testimonies', req.params.id, req.body);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

app.get('/api/admin/events/:id/registrations', requireAdmin, async (req, res) => {
  try {
    const regs = await models.EventRegistration.find({ eventId: req.params.id }).sort({ createdAt: -1 }).lean();
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
  'library': {
    label: 'Library only (not shown anywhere yet)',
    needsTarget: '',
    describe: () => 'Stored in the media library only. Nothing on the public site changes until you place it somewhere.'
  }
};

// The front-end asks for this so the placement picker and its explanations are
// defined in exactly one place.
app.get('/api/admin/image-placements', requireAdmin, async (req, res) => {
  try {
    const [departments, pages] = await Promise.all([repo.getAll('departments'), repo.getAll('pages')]);
    res.json({
      placements: Object.entries(IMAGE_PLACEMENTS).map(([value, p]) => ({
        value, label: p.label, needsTarget: p.needsTarget, description: p.describe('')
      })),
      departments: departments.map(d => ({ id: d.id, name: d.name, hasHeader: !!d.headerImageFileId })),
      pages: pages.filter(p => p.type === 'gallery' || p.type === 'bookshelf').map(p => ({ id: p.slug, name: p.title }))
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not load placement options' });
  }
});

app.post('/api/admin/uploads', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const { category, pageSlug, title, description, targetId } = req.body;
    const placement = IMAGE_PLACEMENTS[req.body.placement] ? req.body.placement : 'library';
    const spec = IMAGE_PLACEMENTS[placement];
    if (spec.needsTarget && !targetId) {
      return res.status(400).json({ error: `Choose which ${spec.needsTarget} this image belongs to.` });
    }

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
      contentType: compressed.contentType
    });

    // A department header is only useful once the department points at it, so
    // do that here rather than making the admin remember a second step.
    let placedOn = '';
    if (placement === 'department-header' && targetId) {
      const dept = await repo.getById('departments', targetId);
      if (dept) {
        if (dept.headerImageFileId) gridfs.deleteFile(dept.headerImageFileId).catch(() => {});
        await repo.patchById('departments', targetId, { headerImageFileId: String(fileId) });
        placedOn = dept.name;
      }
    }
    res.json({ success: true, id: fileId, placement, placedOn, message: spec.describe(placedOn) });
  } catch (e) {
    res.status(500).json({ error: 'Upload failed. The file may be too large (30MB max).' });
  }
});

// Point a department at an image that is already in the library, without
// re-uploading it.
app.put('/api/admin/departments/:id/header-image', requireAdmin, async (req, res) => {
  try {
    const dept = await repo.getById('departments', req.params.id);
    if (!dept) return res.status(404).json({ error: 'Department not found' });
    const fileId = req.body.headerImageFileId || '';
    await repo.patchById('departments', req.params.id, { headerImageFileId: fileId });
    res.json({ success: true, headerImageFileId: fileId });
  } catch (e) {
    res.status(500).json({ error: 'Could not set the header image' });
  }
});

app.delete('/api/admin/files/:id', requireAdmin, async (req, res) => {
  try {
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

app.post('/api/admin/executives', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    let imageFileId = '';
    if (req.file) {
      const compressed = await compressIfImage(req.file.buffer, req.file.mimetype);
      imageFileId = String(await gridfs.uploadBuffer(compressed.buffer, req.file.originalname, {
        category: 'executive', contentType: compressed.contentType, title: req.body.name || req.file.originalname
      }));
    }
    const exec = await repo.create('executives', {
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

app.put('/api/admin/executives/:id', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const existing = await repo.getById('executives', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    let imageFileId = existing.imageFileId || '';
    if (req.file) {
      const compressed = await compressIfImage(req.file.buffer, req.file.mimetype);
      imageFileId = String(await gridfs.uploadBuffer(compressed.buffer, req.file.originalname, {
        category: 'executive', contentType: compressed.contentType, title: req.body.name || req.file.originalname
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
    });
    res.json({ success: true, item: updated });
  } catch (e) {
    res.status(500).json({ error: 'Could not update executive' });
  }
});

app.delete('/api/admin/executives/:id', requireAdmin, async (req, res) => {
  try {
    const existing = await repo.getById('executives', req.params.id);
    if (existing && existing.imageFileId) {
      gridfs.deleteFile(existing.imageFileId).catch(() => {});
    }
    await repo.removeById('executives', req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete executive' });
  }
});

// generic CRUD for departments / events / sermons / pages (admin only)
['departments', 'events', 'sermons', 'pages'].forEach((resource) => {
  const prefix = resource.slice(0, 4);

  app.post(`/api/admin/${resource}`, requireAdmin, async (req, res) => {
    try {
      const item = await repo.create(resource, req.body, prefix);
      res.json({ success: true, item });
      // Automatic announcement — fires after responding, so it never slows down or breaks the save itself.
      if (resource === 'events') {
        createNotification(
          'New Event: ' + (item.title || 'Untitled'),
          `${item.title || 'A new event'} — ${item.date || ''} ${item.time || ''}${item.location ? ' at ' + item.location : ''}`.trim(),
          '/events.html', 'system'
        ).catch(() => {});
      } else if (resource === 'sermons') {
        createNotification(
          'New Sermon: ' + (item.title || 'Untitled'),
          `${item.speaker ? item.speaker + ' — ' : ''}${item.title || 'A new sermon'} is now available.`,
          '/media.html', 'system'
        ).catch(() => {});
      }
    } catch (e) {
      res.status(500).json({ error: 'Could not save' });
    }
  });

  app.put(`/api/admin/${resource}/:id`, requireAdmin, async (req, res) => {
    const item = await repo.updateById(resource, req.params.id, req.body);
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, item });
  });

  app.delete(`/api/admin/${resource}/:id`, requireAdmin, async (req, res) => {
    await repo.removeById(resource, req.params.id);
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

    if (members.length) {
      const firstNames = members.map((m) => (m.name || '').trim().split(/\s+/)[0]).filter(Boolean);
      const names = firstNames.length <= 3
        ? firstNames.join(', ')
        : `${firstNames.slice(0, 3).join(', ')} and ${firstNames.length - 3} more`;
      await createNotification(
        '🎉 Happy Birthday!',
        `Join us in celebrating ${names} today!`,
        '/index.html', 'system'
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
          channels: item.channels, audience: item.audience, sourceId: item.id
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
