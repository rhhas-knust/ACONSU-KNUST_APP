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

// ---------- member auth middleware ----------
function requireMember(req, res, next) {
  if (req.session && req.session.memberId) return next();
  return res.status(401).json({ error: 'Please log in to continue' });
}

// ---------- member auth routes ----------
app.post('/api/auth/register', loginLimiter, async (req, res) => {
  const { name, email, password, phone, level, department } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  try {
    const existing = await models.Member.findOne({ email: email.toLowerCase().trim() });
    if (existing) return res.status(400).json({ error: 'An account with this email already exists' });
    const passwordHash = await bcrypt.hash(password, 10);
    const member = await repo.create('members', {
      name, email: email.toLowerCase().trim(), passwordHash,
      phone: phone || '', level: level || '', department: department || ''
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
      profileImageFileId = String(await gridfs.uploadBuffer(req.file.buffer, req.file.originalname, {
        category: 'member-profile', contentType: req.file.mimetype, title: req.body.name || existing.name
      }));
      if (existing.profileImageFileId) gridfs.deleteFile(existing.profileImageFileId).catch(() => {});
    }
    const updates = {
      name: req.body.name || existing.name,
      phone: req.body.phone || '',
      level: req.body.level || '',
      department: req.body.department || '',
      profileImageFileId
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


// ---------- admin protected routes ----------
app.get('/api/admin/members', requireAdmin, async (req, res) => {
  try {
    const members = await repo.getAll('members');
    res.json(members.map(({ passwordHash, ...safe }) => safe));
  } catch (e) {
    res.status(500).json({ error: 'Could not load members' });
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
    const fileId = await gridfs.uploadBuffer(req.file.buffer, req.file.originalname, {
      category: category || 'file',
      pageSlug: pageSlug || '',
      title: title || req.file.originalname,
      description: description || '',
      contentType: req.file.mimetype
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
      imageFileId = String(await gridfs.uploadBuffer(req.file.buffer, req.file.originalname, {
        category: 'executive', contentType: req.file.mimetype, title: req.body.name || req.file.originalname
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
      imageFileId = String(await gridfs.uploadBuffer(req.file.buffer, req.file.originalname, {
        category: 'executive', contentType: req.file.mimetype, title: req.body.name || req.file.originalname
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

// ---------- startup ----------
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`ACONSU app running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });
