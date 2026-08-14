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
  if (req.session && req.session.isShepherd) return next();
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
  res.json({ isShepherd: !!(req.session && req.session.isShepherd) });
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
    const files = await gridfs.listFiles(query);
    res.json(files.map((f) => ({
      id: f._id,
      filename: f.filename,
      length: f.length,
      uploadDate: f.uploadDate,
      contentType: f.metadata?.contentType || '',
      category: f.metadata?.category || '',
      pageSlug: f.metadata?.pageSlug || '',
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
    notifyAdminByEmail(
      'New Testimony Submitted — ACONSU',
      `<p><strong>${escapeHtmlForEmail(name || 'Anonymous')}</strong> shared a testimony awaiting your review.</p><p>Log in to the admin dashboard to publish or review it.</p>`
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
    notifyAdminByEmail(
      'New Contact Message — ACONSU',
      `<p><strong>${escapeHtmlForEmail(name)}</strong> (${escapeHtmlForEmail(email)}) sent a message:</p><p>${escapeHtmlForEmail(message)}</p>`
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

// ---------- Shepherding portal: finance ----------
const INCOME_CATEGORIES = ['momo', 'tithe', 'harvest', 'offertory', 'other'];

app.get('/api/shepherd/finance', requireShepherd, async (req, res) => {
  try {
    let entries = await repo.getAll('financeEntries');
    const { from, to, entryType } = req.query;
    if (from) entries = entries.filter(e => e.date >= from);
    if (to) entries = entries.filter(e => e.date <= to);
    if (entryType) entries = entries.filter(e => e.entryType === entryType);
    entries.sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(entries);
  } catch (e) {
    res.status(500).json({ error: 'Could not load finance records' });
  }
});

app.get('/api/shepherd/finance/summary', requireShepherd, async (req, res) => {
  try {
    const entries = await repo.getAll('financeEntries');
    const totalIncome = entries.filter(e => e.entryType === 'income').reduce((sum, e) => sum + e.amount, 0);
    const totalExpense = entries.filter(e => e.entryType === 'expense').reduce((sum, e) => sum + e.amount, 0);
    const byIncomeCategory = {};
    INCOME_CATEGORIES.forEach((c) => { byIncomeCategory[c] = 0; });
    entries.filter(e => e.entryType === 'income').forEach((e) => {
      byIncomeCategory[e.category] = (byIncomeCategory[e.category] || 0) + e.amount;
    });
    res.json({ totalIncome, totalExpense, balance: totalIncome - totalExpense, byIncomeCategory, entryCount: entries.length });
  } catch (e) {
    res.status(500).json({ error: 'Could not load finance summary' });
  }
});

app.post('/api/shepherd/finance', requireShepherd, async (req, res) => {
  try {
    const { entryType, category, amount, date, description } = req.body;
    if (!entryType || !category || !amount || !date) {
      return res.status(400).json({ error: 'Type, category, amount, and date are required' });
    }
    if (entryType === 'income' && !INCOME_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Invalid income category' });
    }
    const entry = await repo.create('financeEntries', {
      entryType, category, amount: Number(amount), date, description: description || ''
    }, 'fin');
    res.json({ success: true, item: entry });
  } catch (e) {
    res.status(500).json({ error: 'Could not save this entry' });
  }
});

app.put('/api/shepherd/finance/:id', requireShepherd, async (req, res) => {
  try {
    const { entryType, category, amount, date, description } = req.body;
    const entry = await repo.updateById('financeEntries', req.params.id, {
      entryType, category, amount: Number(amount), date, description: description || ''
    });
    if (!entry) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, item: entry });
  } catch (e) {
    res.status(500).json({ error: 'Could not update this entry' });
  }
});

app.delete('/api/shepherd/finance/:id', requireShepherd, async (req, res) => {
  try {
    await repo.removeById('financeEntries', req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete this entry' });
  }
});

// ---------- admin protected routes ----------
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

app.post('/api/admin/uploads', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const { category, pageSlug, title, description } = req.body;
    const compressed = await compressIfImage(req.file.buffer, req.file.mimetype);
    const fileId = await gridfs.uploadBuffer(compressed.buffer, req.file.originalname, {
      category: category || 'file',
      pageSlug: pageSlug || '',
      title: title || req.file.originalname,
      description: description || '',
      contentType: compressed.contentType
    });
    res.json({ success: true, id: fileId });
  } catch (e) {
    res.status(500).json({ error: 'Upload failed. The file may be too large (30MB max).' });
  }
});

app.delete('/api/admin/files/:id', requireAdmin, async (req, res) => {
  try {
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

// ---------- startup ----------
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`ACONSU app running on http://localhost:${PORT}`);
    });
    checkBirthdaysAndNotify();
    setInterval(checkBirthdaysAndNotify, 60 * 60 * 1000); // re-check hourly in case the server started mid-day
  })
  .catch((err) => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });
