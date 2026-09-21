require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { connectDB, createSessionStore, dbStatus } = require('./lib/db');
const repo = require('./lib/repo');
const activityBus = require('./lib/activityBus');
const gridfs = require('./lib/gridfs');
const models = require('./lib/models');
const rolesLib = require('./lib/roles');
const positions = require('./lib/positions');
const CAP = positions.CAPABILITIES;
const BIBLE_BOOKS = require('./lib/bibleBooks');
const heroArt = require('./lib/heroArt');
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

// 30MB per file — covers most ebook PDFs and photos. Named rather than inlined
// so the limit and the message a rejected upload gets can never disagree.
const UPLOAD_LIMIT_BYTES = 30 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_LIMIT_BYTES }
});

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Trust the first proxy hop (Render/Railway sit behind a load balancer).
// Needed for secure cookies and correct client IPs for rate limiting.
app.set('trust proxy', 1);

// The fallbacks below this line exist so a developer can clone and run
// without ceremony. In production they are a way in: 'changeme' signs you in
// as the national administrator, and a known session secret lets anyone mint
// a session cookie for any account. So production refuses to start on them
// rather than running quietly wide open — a deploy that fails loudly is a far
// smaller problem than one nobody notices.
if (isProd) {
  const insecure = [
    !process.env.ADMIN_PASSWORD && 'ADMIN_PASSWORD (defaults to "changeme")',
    !process.env.SESSION_SECRET && 'SESSION_SECRET (defaults to a public value, so session cookies could be forged)'
  ].filter(Boolean);
  if (insecure.length) {
    console.error('Refusing to start in production with default credentials still in place:');
    insecure.forEach((item) => console.error(`  - ${item} is not set`));
    console.error('Set these in the environment (Render → Environment) and redeploy.');
    process.exit(1);
  }
}

app.use(helmet({
  contentSecurityPolicy: false // keep simple for now; the app has no user-supplied scripts
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  // Stored in MongoDB (see createSessionStore) so a restart or deploy no
  // longer signs everybody out. Undefined falls back to the in-memory store,
  // which is what the test harness runs on.
  store: typeof createSessionStore === 'function' ? createSessionStore() : undefined,
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
// One session carries every identity this browser holds — the env admin flag,
// a staff record, the shepherd flag, a member id — and the portals' own login
// form can set two of them at once (see /api/portal/login, where the env admin
// credentials set isAdmin *and* staff). So a logout that deletes only its own
// key leaves the person signed in through another door: clearing `staff` while
// `isAdmin` survives is exactly why logging out of a portal appeared to do
// nothing. Logging out means the session ends — every endpoint below shares
// this, which also matters on the shared campus devices this runs on.
function endSession(req, res) {
  if (!req.session) return res.json({ success: true });
  req.session.destroy(() => res.json({ success: true }));
}

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

app.post('/api/admin/logout', (req, res) => endSession(req, res));

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

app.post('/api/shepherd/logout', (req, res) => endSession(req, res));

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
  'finance', 'shepherding', 'publicity', 'welfare',
  // A Patron holds no office portal of their own — their seat is on the
  // national council, and that is the whole of what the account is for.
  'patron'
];

// An executive serves one academic year (section 9). The term deadline rides
// in the session alongside the rest of the staff record, and is compared
// against the clock here — the one place every permission check and every
// require* middleware already funnels through. That means a term lapses
// mid-session the moment the date passes, and a route written years from now
// inherits the rule for free. Deliberately not a nightly sweep that flips
// `active`: a sweep is only correct if it ran, and derived state can't drift.
function isTermExpired(staff) {
  return !!(staff && staff.termEndsAt && new Date(staff.termEndsAt) <= new Date());
}

// Ending someone's term early, disabling or deleting their account, or
// changing their role or password has to take effect NOW, not whenever they
// next happen to sign out. A session carries the authority it was stamped
// with at login, so the way to reach one already in flight is a revocation
// list: the moment an account is changed against its holder, anything issued
// before that moment stops counting.
//
// Held in memory for the check itself, which has to stay synchronous, but
// written to the account too: sessions now live in MongoDB and outlive a
// restart, so a revocation that existed only in this process's memory would
// be forgotten while the session it revoked came back. loadStaffRevocations()
// rebuilds the map from the database before the server accepts a request.
const STAFF_REVOCATIONS = new Map();
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 8;

function rememberRevocation(staffId, at) {
  const now = Date.now();
  STAFF_REVOCATIONS.set(String(staffId), at);
  // No session older than the cookie's own lifetime can still be valid, so
  // the entries guarding them have nothing left to do.
  STAFF_REVOCATIONS.forEach((ts, id) => {
    if (now - ts > SESSION_MAX_AGE_MS) STAFF_REVOCATIONS.delete(id);
  });
}

function revokeStaffSessions(staffId) {
  if (!staffId) return Promise.resolve();
  const at = Date.now();
  rememberRevocation(staffId, at);
  return repo.patchById('staffUsers', String(staffId), { sessionsRevokedAt: new Date(at) })
    .catch(() => { /* the in-memory entry still holds for this process */ });
}

// Rebuilt at boot and refreshed periodically, the same belt-and-braces
// pattern refreshSoleActiveChapter() uses for its own cached answer.
async function loadStaffRevocations() {
  try {
    const cutoff = Date.now() - SESSION_MAX_AGE_MS;
    const staff = await repo.getAll('staffUsers');
    staff.forEach((user) => {
      if (!user.sessionsRevokedAt) return;
      const at = new Date(user.sessionsRevokedAt).getTime();
      if (at > cutoff) STAFF_REVOCATIONS.set(String(user.id), at);
    });
  } catch (e) {
    // Leave whatever is already cached rather than dropping revocations.
  }
}

function isSessionRevoked(staff) {
  if (!staff || !staff.id) return false; // env admin / shepherd logins carry no account id
  const revokedAt = STAFF_REVOCATIONS.get(String(staff.id));
  return !!(revokedAt && (!staff.issuedAt || staff.issuedAt <= revokedAt));
}

function currentStaff(req) {
  const staff = (req.session && req.session.staff) || null;
  if (isTermExpired(staff) || isSessionRevoked(staff)) return null;
  return staff;
}

// The academic year turns over on 1 August, matching
// currentAcademicYearLabel() — so every executive in a chapter serves the
// same year and hands over together, however far into it they were elected.
function academicYearEndsAt() {
  const now = new Date();
  const year = now.getFullYear();
  return new Date(Date.UTC(now.getMonth() + 1 >= 8 ? year + 1 : year, 7, 1));
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

// Some elected offices ARE the office portal. ACONSU's Publicity Head is the
// person who sends the chapter's announcements, so they open the Publicity
// portal directly rather than the chapter having to keep a second, separate
// publicity staff login alongside the elected holder.
const POSITION_OPENS_OFFICE = { publicity_head: 'publicity' };

function hasRole(req, role) {
  if (!req.session) return false;
  if (req.session.isAdmin) return true;
  const staff = currentStaff(req);
  if (staff && staff.role === 'nationalCoordinator') return true; // national outranks every office
  if (role === 'shepherding' && req.session.isShepherd) return true;
  if (staff && staff.role === role) return true;
  // An elected holder who IS that office acts in it, rather than only looking
  // at it — the Publicity Head sends the chapter's announcements, which is the
  // whole reason they hold the office (see POSITION_OPENS_OFFICE).
  return !!(staff && staff.positionKey && POSITION_OPENS_OFFICE[staff.positionKey] === role);
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

// The portals that are one person's own workspace rather than a tier of
// oversight. National and Coordinator are deliberately absent: the admin IS
// the national tier, and a Coordinator running their own chapter's portal is
// the point of it. See the access map in /api/portal/me.
const OFFICE_PORTAL_ROLES = ['finance', 'shepherding', 'publicity', 'welfare', 'executive'];

function holdsOfficePortal(req, role) {
  const staff = currentStaff(req);
  if (!staff) return false;
  if (staff.role === role) return true;                  // the holder themselves
  if (staff.positionKey && POSITION_OPENS_OFFICE[staff.positionKey] === role) return true;
  if (staff.role === 'coordinator') return canView(req, role); // oversees their own chapter's offices
  return false;
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

// ---------- the national council ----------
// The one body where the whole union sits together: the National Coordinator,
// every Chapter Coordinator, every Chapter President, and the Patrons —
// national and chapter alike.
//
// Membership grants exactly two things: reading the council and speaking in
// it. It grants NOTHING about another chapter. A Chapter President on this
// council still cannot see another chapter's members, money or welfare cases,
// because nothing below ever widens chapterFilter — the council's own posts
// are simply not chapter-scoped data in the first place.
const COUNCIL_SEATS = {
  nationalCoordinator: 'National Coordinator',
  coordinator: 'Chapter Coordinator',
  patron: 'Patron'
};

// Which seat this account speaks from, or null if they hold none. A Chapter
// President earns their seat through the position on their roster card, which
// is stamped into the session at sign-in.
function councilSeat(req) {
  if (req.session && req.session.isAdmin) return 'National Coordinator';
  const staff = currentStaff(req);
  if (!staff) return null;
  if (staff.role === 'patron') return staff.chapterId ? 'Chapter Patron' : 'National Patron';
  if (COUNCIL_SEATS[staff.role]) return COUNCIL_SEATS[staff.role];
  if (staff.role === 'executive' && staff.positionKey === 'president') return 'Chapter President';
  return null;
}

function requireCouncil(req, res, next) {
  if (councilSeat(req)) return next();
  return res.status(401).json({ error: 'The council is for the National Coordinator, Chapter Coordinators, Chapter Presidents and the Patrons.' });
}

// Only the National Coordinator convenes the council, so only they set the
// meeting link and the standing notice.
function requireCouncilChair(req, res, next) {
  const scope = rolesLib.getActingScope(req);
  if (scope.isNational) return next();
  return res.status(403).json({ error: 'Only the National Coordinator can set the council meeting.' });
}

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

// Confidentiality boundary (GOVERNANCE_TIER_REVIEW.md, Phase C). Welfare case
// notes and the finance ledger are local pastoral and financial records; the
// national tier is entitled to aggregate figures, never to the case files
// behind them. This refuses in plain words rather than quietly returning an
// empty list, so the boundary reads as a decision instead of a bug.
//
// Deliberately inert while only one chapter exists: there, the national
// account is also that chapter's day-to-day operator (see the legacy admin
// login in lib/roles.js), and there is no second chapter whose privacy is at
// stake. The boundary comes into force alongside the second chapter, matching
// the "single chapter, zero friction" rule used throughout.
function chapterConfidential(what) {
  return (req, res, next) => {
    const scope = rolesLib.getActingScope(req);
    if (scope.isNational && !rolesLib.getSoleActiveChapterId()) {
      return res.status(403).json({
        error: `${what} stay inside the chapter they belong to. National oversight sees aggregate figures, not individual records.`
      });
    }
    return next();
  };
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
    // A lapsed term is not a wrong password — say so, so the outgoing
    // executive knows to ask their Coordinator rather than retyping.
    if (isTermExpired(user)) {
      return res.status(403).json({
        error: `Your ${user.termYear || 'executive'} term of office has ended. Your Chapter Coordinator can renew it or hand the office over.`
      });
    }

    // An executive's position is stamped into the session at sign-in rather
    // than looked up per request: the office-portal guards are synchronous and
    // run on every call, so a database read there would cost a query each
    // time. A position change revokes the holder's sessions (see the reshuffle
    // route), which is what stops a stamped value going stale.
    let positionKey = '';
    if (user.role === 'executive') {
      const card = await models.Executive.findOne({ staffId: user.id, chapterId: user.chapterId || '' }).lean();
      positionKey = positions.resolvePosition(
        card && card.positionKey, card && card.role, !!(card && card.department)
      ).key;
    }

    req.session.staff = {
      id: user.id, username: user.username, name: user.name || user.username,
      role: user.role, chapterId: user.chapterId || '',
      memberId: user.memberId || '',
      positionKey,
      termYear: user.termYear || '', termEndsAt: user.termEndsAt || null,
      issuedAt: Date.now() // what a later revocation is measured against
    };
    models.StaffUser.updateOne({ id: user.id }, { $set: { lastLoginAt: new Date() } }).catch(() => {});
    res.json({ success: true, staff: req.session.staff });
  } catch (e) {
    res.status(500).json({ error: 'Could not sign you in right now. Please try again.' });
  }
});

app.post('/api/portal/logout', (req, res) => endSession(req, res));

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
    // Holding an office is not the same as outranking it. The env admin and a
    // National Coordinator outrank every office — that's why hasRole() lets
    // them through the API guards, and that stays — but an office portal is
    // the holder's own workspace. Seating the admin in it automatically meant
    // every portal opened as "the admin", and the office's own sign-in screen
    // became unreachable without clearing cookies. So entry to those portals
    // asks whether you hold the office (or oversee it as that chapter's
    // Coordinator), not whether you outrank it.
    // The seat this account holds on the national council, or null. Sent here
    // so the council page can admit its members through the same shell every
    // other portal uses.
    councilSeat: councilSeat(req),
    access: (() => {
      const acc = PORTAL_ROLES.reduce((out, role) => {
        const entitled = OFFICE_PORTAL_ROLES.includes(role) ? holdsOfficePortal(req, role) : canView(req, role);
        out[role] = { view: entitled, edit: entitled && hasRole(req, role) };
        return out;
      }, {});
      // The council is not an office, so it is not in PORTAL_ROLES — but the
      // portal shell decides admission from this map, so its seat belongs
      // here alongside them. Everyone who holds a seat may also speak.
      const seat = councilSeat(req);
      acc.council = { view: !!seat, edit: !!seat };
      return acc;
    })()
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

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreSearchField(value, query, terms, weight) {
  const text = normalizeSearchText(value);
  if (!text) return 0;
  let score = 0;
  if (text === query) score += 180 * weight;
  else if (text.startsWith(query)) score += 120 * weight;
  else if (text.includes(query)) score += 75 * weight;

  terms.forEach((term) => {
    if (!term || term === query) return;
    if (text === term) score += 36 * weight;
    else if (text.startsWith(term)) score += 24 * weight;
    else if (text.includes(term)) score += 12 * weight;
  });
  return score;
}

function buildPublicSearchResult({ query, terms, type, typeLabel, title, subtitle, description, href, extraSearch = [], meta = {} }) {
  const titleScore = scoreSearchField(title, query, terms, 6);
  const subtitleScore = scoreSearchField(subtitle, query, terms, 3);
  const descriptionScore = scoreSearchField(description, query, terms, 2);
  const extraScore = extraSearch.reduce((sum, value) => sum + scoreSearchField(value, query, terms, 1), 0);
  const score = titleScore + subtitleScore + descriptionScore + extraScore + (subtitle ? 2 : 0) + (description ? 1 : 0);
  if (!score) return null;
  return {
    type,
    typeLabel,
    title: String(title || ''),
    subtitle: String(subtitle || ''),
    description: String(description || ''),
    href,
    ...meta,
    score
  };
}

const CONTENT_KIND_LABELS = {
  live_service: 'Live Stream',
  seminar: 'Seminar',
  weekly_highlight: 'Weekly Highlight',
  ebook: 'E-Book',
  founder: 'Founder Story',
  church_info: 'Church Info',
  aconsu_info: 'ACONSU Info'
};

const ACTIVATED_MEMBERSHIP_STAGES = new Set(['active', 'worker', 'executive']);
function isActivatedMember(member) {
  return ACTIVATED_MEMBERSHIP_STAGES.has(member && member.membershipStage);
}

// ---------- notifications helper ----------
// Saves a notification for the in-app feed AND fires a real push to every
// subscribed device. Used both by the manual admin route and automatic
// triggers (new event, new sermon, birthdays).
// `chapterId` blank = national broadcast, visible in every chapter's feed —
// pass a real chapter id to keep an announcement inside one chapter.
// `audience` (optional) confines an announcement to one department:
// { departmentId, memberIds }. Without it this is a chapter-wide notice, which
// is what every caller but the department announcement wants.
async function createNotification(title, body, url, source, chapterId, audience) {
  const departmentId = (audience && audience.departmentId) || '';
  const notif = await repo.create('notifications', {
    chapterId: chapterId || '', title, body, url: url || '/index.html',
    source: source || 'admin', departmentId
  }, 'notif');
  push.sendPushToAll(
    { title, body, url: url || '/index.html' },
    chapterId,
    audience ? (audience.memberIds || []) : undefined
  ).catch(() => {});
  return notif;
}

// ---------- the handover from Shepherding to the Coordinator ----------
// Shepherding marks someone an Executive; only the Chapter Coordinator can
// open the account that actually gives them a portal. Those are two people and
// two portals, and nothing used to carry the news between them — so a member
// could sit labelled 'executive' for weeks with no account, no position and no
// page, which is exactly what it looked like from outside.
//
// Derived rather than stored: "marked an executive, no account yet" is a
// question the records already answer, so there is no second copy of it to go
// stale, and appointing them clears it without anything having to remember to.
async function membersAwaitingAppointment(chapterId) {
  const [members, staff] = await Promise.all([
    repo.getAll('members', { chapterId, membershipStage: 'executive' }),
    repo.getAll('staffUsers', { chapterId })
  ]);
  const accounted = new Set(staff.map((u) => u.memberId).filter(Boolean));
  return members
    .filter((m) => !accounted.has(m.id))
    .map((m) => ({
      id: m.id, name: m.name || '', email: m.email || '',
      markedAt: m.updatedAt || m.createdAt || null,
      shepherdName: m.shepherdName || ''
    }));
}

// A chapter's Coordinators, as members — a coordinator account is
// member-backed, which is what makes it possible to reach the person rather
// than the office.
async function coordinatorMemberIds(chapterId) {
  const staff = await repo.getAll('staffUsers', { chapterId, role: 'coordinator' });
  return staff.filter((u) => u.active !== false && u.memberId).map((u) => u.memberId);
}

// Sent straight to the Coordinator's own devices, and deliberately NOT written
// to the notifications feed: that feed is chapter-wide, so a row there would
// announce to every member which of them had just been made an executive.
async function tellCoordinatorSomeoneNeedsAnAccount(member) {
  try {
    const memberIds = await coordinatorMemberIds(member.chapterId);
    if (!memberIds.length) return;
    await push.sendPushToAll({
      title: 'An executive is waiting for an account',
      body: `${member.name || 'A member'} has been marked an Executive. Give them a position and a portal account.`,
      url: '/coordinator.html'
    }, member.chapterId, memberIds);
  } catch (e) { /* non-critical — the Leadership Accounts screen still shows them */ }
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

async function scheduleOnboardingTasks(member) {
  const now = new Date();
  await repo.create('onboardingTasks', {
    chapterId: member.chapterId, memberId: member.id, memberEmail: member.email, memberName: member.name,
    sequence: 'day0_welcome', sendAt: now, status: 'scheduled'
  }, 'onb');
  await repo.create('onboardingTasks', {
    chapterId: member.chapterId, memberId: member.id, memberEmail: member.email, memberName: member.name,
    sequence: 'day3_cell_invite', sendAt: new Date(now.getTime() + (3 * 24 * 60 * 60 * 1000)), status: 'scheduled'
  }, 'onb');
}

// ---------- member auth routes ----------
// Registration is multipart now — a profile photo is compulsory for member
// registration (section 6), same upload pipeline as the profile-photo update
// route below. Every new account starts life as a 'visitor': the Shepherding
// workflow (section 7) is what moves someone from here to an active member.
app.post('/api/auth/register', loginLimiter, upload.single('profileImage'), async (req, res) => {
  const { name, email, password, phone, level, programme, hostel, department, chapterId, birthdayMonth, birthdayDay, memberKind, graduationYear } = req.body;
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
      // Someone who has finished their studies says so when they sign up, and
      // the form asks them for a graduation year instead of a hostel. The
      // CLAIM is recorded; the stage is not granted here. Stage is
      // Shepherding's to set everywhere else in this system, and letting it be
      // self-declared would make Alumni Connect — which is union-wide — a
      // directory anyone could write themselves into.
      registeredAsAlumni: String(memberKind || '') === 'alumni',
      graduationYear: String(graduationYear || '').replace(/[^0-9]/g, '').slice(0, 4),
      profileImageFileId,
      membershipStage: 'visitor',
      qrToken: crypto.randomBytes(16).toString('hex'),
      birthdayMonth: month, birthdayDay: day
    }, 'mem');
    scheduleOnboardingTasks(member).catch(() => {});
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

app.post('/api/auth/logout', (req, res) => endSession(req, res));

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
    // Only passwordHash was being stripped, so every page load also shipped the
    // member's password-reset token hash and their QR token to the browser.
    // None of it is needed here: the digital card has its own endpoint, and the
    // reset token is credential material that should never leave the server.
    const { passwordHash, resetTokenHash, resetTokenExpires, qrToken, ...safe } = member;
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
      // Deliberately NOT taken from the request. This form sends no department
      // field, so `req.body.department || ''` silently blanked a member's
      // department every time they edited their phone number. Belonging to a
      // department is also not a thing to grant yourself in passing — it is
      // decided by the people who lead it, so it changes through its own route
      // and never as a side effect of saving a profile.
      department: existing.department || '',
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
// Where a member stands: the department they belong to, how far along the
// membership journey they are, and who is shepherding them.
//
// All of this already existed server-side — it drives Shepherding's whole
// workflow — but the member themselves could never see any of it. They
// registered, became a 'visitor', and nothing in the app told them what that
// meant or what happened next.
const MEMBERSHIP_JOURNEY = [
  { stage: 'visitor', label: 'Visitor', blurb: 'You have registered, and we are glad you are here. Someone from Shepherding will reach out to welcome you.' },
  { stage: 'under_review', label: 'Being welcomed', blurb: 'Shepherding is getting to know you. They will be in touch about becoming a full member.' },
  { stage: 'accepted', label: 'Accepted', blurb: 'You have been accepted into the chapter. A shepherd will be assigned to walk with you.' },
  { stage: 'active', label: 'Member', blurb: 'You are a full member of the chapter.' },
  { stage: 'worker', label: 'Worker', blurb: 'You serve in a department — thank you for giving your time.' },
  { stage: 'executive', label: 'Executive', blurb: 'You hold office in the chapter.' },
  { stage: 'alumni', label: 'Alumni', blurb: 'You have finished your studies. You are always part of the family.' }
];

// What this member has signed up for. Registering was possible; seeing what
// you had signed up for was not — the profile's "My Events" went to the same
// events page everyone else sees.
app.get('/api/member/events', requireMember, async (req, res) => {
  try {
    const member = await repo.getById('members', req.session.memberId);
    if (!member) return res.status(404).json({ error: 'Member not found' });

    const all = await repo.getAll('eventRegistrations', { chapterId: member.chapterId || '' });
    // Matched on the member id where it was stamped, and on email otherwise,
    // so registrations made before the id existed still show up.
    const email = String(member.email || '').toLowerCase();
    const mine = all.filter(r => (r.memberId && r.memberId === member.id)
      || (!r.memberId && String(r.email || '').toLowerCase() === email));
    if (!mine.length) return res.json([]);

    const events = await repo.getAll('events', { chapterId: member.chapterId || '' });
    const byId = new Map(events.map(e => [e.id, e]));
    const today = new Date().toISOString().slice(0, 10);

    res.json(mine
      .map(r => {
        const event = byId.get(r.eventId);
        if (!event) return null;
        return {
          registrationId: r.id,
          id: event.id,
          title: event.title,
          date: event.date,
          time: event.time || '',
          location: event.location || '',
          status: event.status,
          past: !!(event.date && event.date < today)
        };
      })
      .filter(Boolean)
      .sort((a, b) => String(a.date).localeCompare(String(b.date))));
  } catch (e) {
    res.status(500).json({ error: 'Could not load the events you signed up for.' });
  }
});

// ---------- where a member serves ----------
// A member serves in as many departments as they actually serve in. `departments`
// is the list and is the truth; `department` is the single field this started
// with. Live records written before the list existed still carry only the old
// field, and there is no migration step, so every read goes through here and
// every write sets both. That way nothing has to be converted up front and an
// unmigrated record is never quietly treated as belonging to nothing.
function memberDepartmentIds(member) {
  if (!member) return [];
  const list = Array.isArray(member.departments) ? member.departments.filter(Boolean).map(String) : [];
  if (list.length) return [...new Set(list)];
  return member.department ? [String(member.department)] : [];
}

// Finding the members of a department has to look at both fields for the same
// reason: a member who has not been rewritten since the list was introduced is
// still in that department, and a roster that missed them would be wrong.
function departmentMemberFilter(chapterId, departmentId) {
  return {
    chapterId: chapterId || '',
    $or: [{ departments: departmentId }, { department: departmentId }]
  };
}

async function setMemberDepartments(memberId, ids, filter) {
  const unique = [...new Set((ids || []).filter(Boolean).map(String))];
  return repo.patchById('members', memberId, {
    departments: unique,
    // Kept in step so anything still reading the single field sees the primary
    // one rather than a stale value from before the change.
    department: unique[0] || ''
  }, filter);
}

// The shape the member-facing pages render, with the head derived from whoever
// currently holds the office rather than a name typed in once and left behind.
async function describeDepartmentForMember(found, chapterId) {
  const execs = await repo.getAll('executives', { chapterId: chapterId || '', department: found.id });
  const head = execs
    .map(e => ({ e, position: positions.resolvePosition(e.positionKey, e.role, true) }))
    .filter(x => !x.position.deputyOf)[0] || null;
  return {
    id: found.id,
    name: found.name,
    tagline: found.tagline || '',
    meetingDay: found.meetingDay || '',
    meetingTime: found.meetingTime || '',
    meetingLocation: found.meetingLocation || '',
    headName: head ? head.e.name : '',
    headRole: head ? head.e.role : ''
  };
}

app.get('/api/member/standing', requireMember, async (req, res) => {
  try {
    const member = await repo.getById('members', req.session.memberId);
    if (!member) return res.status(404).json({ error: 'Member not found' });

    const stage = member.membershipStage || 'visitor';
    const index = MEMBERSHIP_JOURNEY.findIndex(s => s.stage === stage);
    const current = MEMBERSHIP_JOURNEY[index] || MEMBERSHIP_JOURNEY[0];
    // Alumni is an ending rather than a rung, so nothing is "next" from there.
    const next = (stage === 'alumni' || index < 0) ? null : MEMBERSHIP_JOURNEY[index + 1] || null;

    const departmentIds = memberDepartmentIds(member);
    const departments = [];
    for (const departmentId of departmentIds) {
      const found = await repo.getById('departments', departmentId, { chapterId: member.chapterId || '' });
      // A department that has since been deleted simply drops out rather than
      // rendering as a blank card the member cannot do anything about.
      if (found) departments.push(await describeDepartmentForMember(found, member.chapterId));
    }
    // The first one is the member's primary placement. `department` stays in
    // the response because the profile page and the membership card still read
    // it; it is the head of the same list, never a separate answer.
    const department = departments[0] || null;

    // Requests they have made that nobody has decided yet, so the page can say
    // "waiting on the head" instead of looking as though the tap did nothing.
    const pendingRequests = (await repo.getAll('departmentRequests', {
      chapterId: member.chapterId || '', memberId: member.id, status: 'pending'
    })).map(reqDoc => ({ id: reqDoc.id, departmentId: reqDoc.departmentId, createdAt: reqDoc.createdAt }));

    // What their department has actually said to them. A department
    // announcement used to exist only as a push notification, so anyone who
    // had notifications turned off, or simply missed it, had no way back to it.
    let departmentNotices = [];
    if (departmentIds.length) {
      const notices = await repo.getAll('notifications', {
        chapterId: member.chapterId || '',
        departmentId: { $in: departmentIds }
      });
      departmentNotices = notices
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5)
        .map(n => ({ id: n.id, title: n.title, body: n.body, createdAt: n.createdAt }));
    }

    res.json({
      departmentNotices,
      stage: { key: current.stage, label: current.label, blurb: current.blurb },
      next: next ? { key: next.stage, label: next.label } : null,
      journey: MEMBERSHIP_JOURNEY.map(s => ({ key: s.stage, label: s.label })),
      membershipNumber: member.membershipNumber || '',
      shepherdName: member.shepherdName || '',
      department,
      departments,
      pendingRequests,
      // Said plainly, because "no department" is a thing to act on rather than
      // an error: it is how someone finds where they fit.
      needsDepartment: departments.length === 0
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not load where you stand right now.' });
  }
});

// ---------- joining a department ----------
// Everything a member needs to decide where to serve: their own chapter's
// departments, which ones they are already in, and which they have asked
// about. The chapter comes from their own account, so nobody is asked to pick
// a chapter they already belong to.
app.get('/api/member/departments', requireMember, async (req, res) => {
  try {
    const member = await repo.getById('members', req.session.memberId);
    if (!member) return res.status(404).json({ error: 'Member not found' });
    const chapterId = member.chapterId || '';
    const [all, myRequests] = await Promise.all([
      repo.getAll('departments', { chapterId }),
      repo.getAll('departmentRequests', { chapterId, memberId: member.id })
    ]);
    const mine = new Set(memberDepartmentIds(member));
    const pendingBy = new Map(myRequests.filter(r => r.status === 'pending').map(r => [r.departmentId, r]));
    const declinedBy = new Map(myRequests.filter(r => r.status === 'declined').map(r => [r.departmentId, r]));

    const items = await Promise.all(all.map(async (d) => {
      const described = await describeDepartmentForMember(d, chapterId);
      const pending = pendingBy.get(d.id);
      return {
        ...described,
        headerImageFileId: d.headerImageFileId || '',
        joined: mine.has(d.id),
        pendingRequestId: pending ? pending.id : '',
        declined: !pendingBy.has(d.id) && declinedBy.has(d.id)
      };
    }));
    items.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    res.json({ chapterId, departments: items });
  } catch (e) {
    res.status(500).json({ error: 'Could not load the departments in your chapter.' });
  }
});

app.post('/api/member/departments/:id/request', requireMember, async (req, res) => {
  try {
    const member = await repo.getById('members', req.session.memberId);
    if (!member) return res.status(404).json({ error: 'Member not found' });
    const chapterId = member.chapterId || '';
    // Scoped to the member's own chapter, so a department id from another
    // chapter cannot be used to get onto its roster.
    const department = await repo.getById('departments', req.params.id, { chapterId });
    if (!department) return res.status(404).json({ error: 'That department is not one of your chapter\'s.' });

    if (memberDepartmentIds(member).includes(department.id)) {
      return res.status(400).json({ error: `You are already serving in ${department.name}.` });
    }
    const existing = await repo.getAll('departmentRequests', {
      chapterId, memberId: member.id, departmentId: department.id, status: 'pending'
    });
    // Asking twice is a double tap or an impatient second try, not a second
    // request — the head should see one row, not a growing pile.
    if (existing.length) return res.json({ success: true, item: existing[0], alreadyPending: true });

    const item = await repo.create('departmentRequests', {
      chapterId, memberId: member.id, departmentId: department.id,
      note: cleanText(String(req.body.note || '')).slice(0, 500),
      status: 'pending'
    }, 'dreq');

    // Deliberately no chapter or department announcement here. A notification
    // carrying departmentId goes to everyone in that department, which would
    // tell the whole of Ushering who had applied and why. The head sees it as
    // a waiting request in their own portal instead, which is where they would
    // act on it anyway.

    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ error: 'Could not send your request.' });
  }
});

app.delete('/api/member/departments/:id/request', requireMember, async (req, res) => {
  try {
    const member = await repo.getById('members', req.session.memberId);
    if (!member) return res.status(404).json({ error: 'Member not found' });
    const chapterId = member.chapterId || '';
    const pending = await repo.getAll('departmentRequests', {
      chapterId, memberId: member.id, departmentId: req.params.id, status: 'pending'
    });
    if (!pending.length) return res.status(404).json({ error: 'You have no request waiting for that department.' });
    await repo.patchById('departmentRequests', pending[0].id, { status: 'withdrawn', decidedAt: new Date() }, { chapterId });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not withdraw your request.' });
  }
});

// Leaving is the member's own to do — being let in needs the head, stepping
// back out does not.
app.delete('/api/member/departments/:id', requireMember, async (req, res) => {
  try {
    const member = await repo.getById('members', req.session.memberId);
    if (!member) return res.status(404).json({ error: 'Member not found' });
    const current = memberDepartmentIds(member);
    if (!current.includes(req.params.id)) {
      return res.status(400).json({ error: 'You are not serving in that department.' });
    }
    await setMemberDepartments(member.id, current.filter(id => id !== req.params.id));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not update your departments.' });
  }
});

// ---------- Alumni Connect ----------
// Fixed list so the directory can be filtered rather than searched by guesswork;
// "Other" exists so nobody is forced into a box that isn't theirs.
const ALUMNI_INDUSTRIES = [
  'Health & Medicine', 'Engineering', 'Technology', 'Education', 'Law',
  'Finance & Banking', 'Business & Entrepreneurship', 'Agriculture',
  'Media & Communications', 'Public Service', 'Ministry', 'Science & Research',
  'Architecture & Built Environment', 'Other'
];

// Browsing is for members who are actually part of the union — active and
// above. A visitor who registered an hour ago cannot pull a list of alumni
// names, professions and employers, which is the obvious way this directory
// would be abused.
function canBrowseAlumni(member) {
  if (!member) return false;
  const at = MEMBERSHIP_STAGES.indexOf(member.membershipStage || 'visitor');
  return at >= MEMBERSHIP_STAGES.indexOf('active');
}

app.get('/api/alumni/industries', requireMember, (req, res) => res.json(ALUMNI_INDUSTRIES));

// The one read in this system that is deliberately NOT chapter-scoped. It is
// safe to be union-wide because every row here was written by the alumnus
// themselves, carries only what they chose to publish, and exists at all only
// because they opted in. No chapter-scoped record is reachable through it.
app.get('/api/alumni', requireMember, async (req, res) => {
  try {
    const me = await repo.getById('members', req.session.memberId);
    if (!canBrowseAlumni(me)) {
      return res.status(403).json({ error: 'Alumni Connect opens once you are a full member of your chapter. Your Shepherd can tell you where you are.' });
    }
    const profiles = await repo.getAll('alumniProfiles', { listed: true });
    const industry = String(req.query.industry || '').trim();
    const q = String(req.query.q || '').trim().toLowerCase();
    const mentoring = String(req.query.mentoring || '') === '1';

    const rows = [];
    for (const p of profiles) {
      const m = await repo.getById('members', p.memberId);
      if (!m) continue; // the account went; the listing goes with it
      if (industry && p.industry !== industry) continue;
      if (mentoring && !p.openToMentoring) continue;
      const hay = [m.name, p.profession, p.organisation, p.industry, p.programme, p.city].join(' ').toLowerCase();
      if (q && hay.indexOf(q) < 0) continue;
      const chapter = await repo.getById('chapters', p.chapterId).catch(() => null);
      rows.push({
        id: p.id,
        name: m.name || 'Alumnus',
        profileImageFileId: m.profileImageFileId || '',
        chapterName: (chapter && chapter.name) || '',
        profession: p.profession, organisation: p.organisation, industry: p.industry,
        programme: p.programme, graduationYear: p.graduationYear,
        city: p.city, country: p.country, bio: p.bio,
        openToMentoring: !!p.openToMentoring,
        linkedin: p.linkedin || '',
        // Only ever what this person ticked. Their member record's contact
        // details are not published just because they have them.
        email: p.showEmail ? (m.email || '') : '',
        phone: p.showPhone ? (m.phone || '') : ''
      });
    }
    rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    res.json({ industries: ALUMNI_INDUSTRIES, count: rows.length, items: rows });
  } catch (e) {
    res.status(500).json({ error: 'Could not load Alumni Connect right now.' });
  }
});

// Your own listing: yours to write, yours to take down.
app.get('/api/member/alumni-profile', requireMember, async (req, res) => {
  try {
    const me = await repo.getById('members', req.session.memberId);
    if (!me) return res.status(404).json({ error: 'Member not found' });
    const mine = (await repo.getAll('alumniProfiles', { memberId: me.id }))[0] || null;
    res.json({
      isAlumni: me.membershipStage === 'alumni',
      canBrowse: canBrowseAlumni(me),
      industries: ALUMNI_INDUSTRIES,
      profile: mine
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not load your alumni listing.' });
  }
});

app.put('/api/member/alumni-profile', requireMember, async (req, res) => {
  try {
    const me = await repo.getById('members', req.session.memberId);
    if (!me) return res.status(404).json({ error: 'Member not found' });
    // Stage is set by Shepherding, never self-declared, so a member cannot put
    // themselves in the alumni directory by claiming to have graduated.
    if (me.membershipStage !== 'alumni') {
      return res.status(403).json({ error: 'Alumni listings are for members Shepherding has marked as alumni. Ask them to update your stage and this will open.' });
    }
    const industry = ALUMNI_INDUSTRIES.includes(req.body.industry) ? req.body.industry : '';
    const fields = {
      chapterId: me.chapterId || '',
      listed: req.body.listed === true || req.body.listed === 'true',
      profession: cleanText(String(req.body.profession || '')).slice(0, 120),
      organisation: cleanText(String(req.body.organisation || '')).slice(0, 120),
      industry,
      programme: cleanText(String(req.body.programme || '')).slice(0, 120),
      graduationYear: String(req.body.graduationYear || '').replace(/[^0-9]/g, '').slice(0, 4),
      city: cleanText(String(req.body.city || '')).slice(0, 80),
      country: cleanText(String(req.body.country || 'Ghana')).slice(0, 80),
      bio: cleanText(String(req.body.bio || '')).slice(0, 600),
      openToMentoring: req.body.openToMentoring === true || req.body.openToMentoring === 'true',
      showEmail: req.body.showEmail === true || req.body.showEmail === 'true',
      showPhone: req.body.showPhone === true || req.body.showPhone === 'true',
      linkedin: cleanText(String(req.body.linkedin || '')).slice(0, 200)
    };
    if (fields.listed && !fields.profession) {
      return res.status(400).json({ error: 'Add what you do before listing yourself — that is what other members will search for.' });
    }
    const existing = (await repo.getAll('alumniProfiles', { memberId: me.id }))[0];
    const item = existing
      ? await repo.updateById('alumniProfiles', existing.id, { ...existing, ...fields })
      : await repo.create('alumniProfiles', { memberId: me.id, ...fields }, 'alum');
    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ error: 'Could not save your alumni listing.' });
  }
});

// Moderation, scoped the ordinary way: a chapter can take down a listing that
// belongs to one of its own alumni, and nobody else's.
app.delete('/api/admin/alumni/:id', requireChapterAdmin, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req, { required: false });
    const profile = await repo.getById('alumniProfiles', req.params.id, filter);
    if (!profile) return res.status(404).json({ error: 'That listing is not one of your chapter\'s.' });
    await repo.patchById('alumniProfiles', profile.id, { listed: false }, filter);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not unlist that profile.' });
  }
});

// ---------- ACONSU Rooms: small-group meetings ----------
//
// Peer-to-peer. The server introduces two browsers to each other and then gets
// out of the way — no audio or video passes through it, which is the only
// reason this can run on the hosting we have.
//
// That choice sets the ceiling. Each participant sends their own video to
// every other participant, so a phone's UPLOAD is what runs out: four people
// means sending three streams at once, which mobile data manages; six does
// not. ROOM_CAPACITY is enforced, not advisory, because a room that lets a
// fifth person in and then falls over is worse than one that says it is full.
const ROOM_CAPACITY = 4;

// Signalling only. Offers, answers and ICE candidates are worthless a second
// after they are read, so they are passed straight between open connections
// and never stored. LIVE is lost on restart, which costs a meeting its
// signalling channel and nothing else.
const LIVE_ROOMS = new Map(); // roomId -> Map(peerId -> { memberId, name, res })

function roomPeers(roomId) {
  if (!LIVE_ROOMS.has(roomId)) LIVE_ROOMS.set(roomId, new Map());
  return LIVE_ROOMS.get(roomId);
}
function sendEvent(res, payload) {
  try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch (e) { /* the connection went */ }
}
function broadcastToRoom(roomId, payload, exceptPeerId) {
  for (const [peerId, peer] of roomPeers(roomId)) {
    if (peerId !== exceptPeerId) sendEvent(peer.res, payload);
  }
}
function peerSummary(peerId, peer) {
  return { peerId, memberId: peer.memberId, name: peer.name };
}

// Who may be in this room. A department room is that department's; a chapter
// room is that chapter's. Nothing here widens chapterFilter — the room itself
// carries the chapter it belongs to, and it is checked against the member's.
async function canEnterRoom(member, room) {
  if (!member || !room || !room.open) return false;
  if ((room.chapterId || '') !== (member.chapterId || '')) return false;
  if (!room.departmentId) return true;
  return memberDepartmentIds(member).includes(room.departmentId);
}

// Rooms this member could walk into right now.
app.get('/api/rooms', requireMember, async (req, res) => {
  try {
    const member = await repo.getById('members', req.session.memberId);
    if (!member) return res.status(404).json({ error: 'Member not found' });
    const rooms = await repo.getAll('meetingRooms', { chapterId: member.chapterId || '', open: true });
    const mine = [];
    for (const room of rooms) {
      if (!(await canEnterRoom(member, room))) continue;
      let departmentName = '';
      if (room.departmentId) {
        const d = await repo.getById('departments', room.departmentId, { chapterId: member.chapterId || '' });
        departmentName = d ? d.name : '';
      }
      mine.push({
        id: room.id, title: room.title, departmentId: room.departmentId, departmentName,
        createdByName: room.createdByName, createdAt: room.createdAt,
        capacity: room.maxParticipants || ROOM_CAPACITY,
        here: roomPeers(room.id).size
      });
    }
    mine.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ capacity: ROOM_CAPACITY, items: mine });
  } catch (e) {
    res.status(500).json({ error: 'Could not load meeting rooms.' });
  }
});

// Opening a room is a leader's act. A Chapter Admin or Coordinator can open one
// for the chapter or for a named department; a department head can open one for
// their own department and nobody else's.
// A Chapter Admin or Coordinator, or an executive who heads a department.
// Anything narrower than this cannot open a room at all.
function requireRoomHost(req, res, next) {
  if (isChapterAdminOrAbove(req)) return next();
  const staff = currentStaff(req);
  if (staff && staff.role === 'executive' && staff.department) return next();
  return res.status(403).json({ error: 'Only a Chapter Admin, or the head of a department, can open a room.' });
}

app.post('/api/rooms', requireRoomHost, async (req, res) => {
  try {
    const staff = currentStaff(req);
    const isAdmin = isChapterAdminOrAbove(req);
    const chapterId = await resolveChapterIdForWrite(req, req.body.chapterId);
    if (!chapterId) return res.status(400).json({ error: 'A chapter is required.' });

    let departmentId = String(req.body.departmentId || '').trim();
    if (!isAdmin) {
      // Not an admin: the only room they may open is their own department's.
      const own = staff && staff.department ? String(staff.department) : '';
      if (!own) return res.status(403).json({ error: 'Only a Chapter Admin, or the head of a department, can open a room.' });
      departmentId = own;
    }
    if (departmentId) {
      const dept = await repo.getById('departments', departmentId, { chapterId });
      if (!dept) return res.status(400).json({ error: 'That department is not one of this chapter\'s.' });
    }
    const item = await repo.create('meetingRooms', {
      chapterId,
      departmentId,
      title: cleanText(String(req.body.title || 'ACONSU Room')).slice(0, 120),
      createdByName: (staff && staff.name) || 'Leadership',
      createdByStaffId: (staff && staff.id) || '',
      maxParticipants: ROOM_CAPACITY,
      open: true
    }, 'room');
    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ error: 'Could not open the room.' });
  }
});

app.post('/api/rooms/:id/close', requireRoomHost, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req, { required: false });
    const room = await repo.getById('meetingRooms', req.params.id, filter);
    if (!room) return res.status(404).json({ error: 'That room is not one of your chapter\'s.' });
    await repo.patchById('meetingRooms', room.id, { open: false, closedAt: new Date() }, filter);
    broadcastToRoom(room.id, { type: 'room-closed' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not close the room.' });
  }
});

// The signalling channel. Held open for as long as the member is in the room:
// the server pushes who else is here, and relays their offers and answers.
app.get('/api/rooms/:id/events', requireMember, async (req, res) => {
  const member = await repo.getById('members', req.session.memberId);
  const room = await repo.getById('meetingRooms', req.params.id);
  if (!(await canEnterRoom(member, room))) {
    return res.status(403).json({ error: 'This room is not open to you.' });
  }
  const peers = roomPeers(room.id);
  if (peers.size >= (room.maxParticipants || ROOM_CAPACITY)) {
    return res.status(409).json({ error: `This room is full — ${room.maxParticipants || ROOM_CAPACITY} people is the most it holds.` });
  }
  // One person, one seat: rejoining from a second tab replaces the first
  // rather than quietly eating a place in a four-seat room.
  for (const [existingId, peer] of peers) {
    if (peer.memberId === member.id) {
      sendEvent(peer.res, { type: 'replaced' });
      try { peer.res.end(); } catch (e) { /* already gone */ }
      peers.delete(existingId);
      broadcastToRoom(room.id, { type: 'peer-left', peerId: existingId }, existingId);
    }
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Proxies that buffer would hold each message until the buffer filled,
    // which for signalling means the call never connects.
    'X-Accel-Buffering': 'no'
  });
  if (res.flushHeaders) res.flushHeaders();

  const peerId = crypto.randomBytes(8).toString('hex');
  const me = { memberId: member.id, name: member.name || 'Member', res };
  const others = [...peers].map(([id, p]) => peerSummary(id, p));
  peers.set(peerId, me);

  sendEvent(res, { type: 'welcome', peerId, peers: others, capacity: room.maxParticipants || ROOM_CAPACITY });
  broadcastToRoom(room.id, { type: 'peer-joined', peer: peerSummary(peerId, me) }, peerId);

  // Idle signalling connections look dead to some proxies, so they are kept
  // visibly alive. A comment line is a no-op to the client.
  const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { /* gone */ } }, 20000);

  req.on('close', () => {
    clearInterval(beat);
    const current = roomPeers(room.id);
    if (current.get(peerId) === me) {
      current.delete(peerId);
      broadcastToRoom(room.id, { type: 'peer-left', peerId }, peerId);
      if (current.size === 0) LIVE_ROOMS.delete(room.id);
    }
  });
});

// One peer's offer, answer or ICE candidate, handed to exactly one other peer
// in the same room. The server does not read it.
app.post('/api/rooms/:id/signal', requireMember, async (req, res) => {
  try {
    const member = await repo.getById('members', req.session.memberId);
    const room = await repo.getById('meetingRooms', req.params.id);
    if (!(await canEnterRoom(member, room))) return res.status(403).json({ error: 'This room is not open to you.' });

    const peers = roomPeers(room.id);
    const from = String(req.body.from || '');
    const to = String(req.body.to || '');
    // Only somebody actually in the room may speak, and only as themselves.
    const sender = peers.get(from);
    if (!sender || sender.memberId !== member.id) {
      return res.status(403).json({ error: 'You are not in this room.' });
    }
    const target = peers.get(to);
    if (!target) return res.status(404).json({ error: 'That person has left the room.' });
    sendEvent(target.res, { type: 'signal', from, data: req.body.data });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not reach them.' });
  }
});

// What the browser should use to find a route between two peers. STUN is free
// and public. TURN relays the media when a direct route cannot be found, which
// on hostel wifi and mobile networks is a real share of the time — it is read
// from the environment so a chapter can add one without a code change, and its
// absence is reported honestly rather than left to look like a bug.
app.get('/api/rooms/ice-servers', requireMember, (req, res) => {
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_PASSWORD) {
    iceServers.push({
      urls: process.env.TURN_URL.split(',').map(u => u.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_PASSWORD
    });
  }
  res.json({ iceServers, hasTurn: !!process.env.TURN_URL });
});

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

    // A department's own announcement belongs to that department. Everyone
    // else in the chapter is simply not its audience, so it is filtered out
    // here rather than shown to people it was never addressed to.
    let ownDepartments = [];
    if (req.session && req.session.memberId) {
      const me = await repo.getById('members', req.session.memberId);
      ownDepartments = memberDepartmentIds(me);
    }
    // Someone serving in Choir and Ushering is the audience for both, so this
    // asks whether the notice belongs to any department they are in — reading
    // a single field here would have shown them only their primary one.
    const forMe = items.filter(n => !n.departmentId || ownDepartments.includes(n.departmentId));

    res.json(forMe.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 40));
  } catch (e) {
    res.status(500).json({ error: 'Could not load notifications' });
  }
});

// Is this thing actually working? Deliberately public and deliberately
// answering 503 when the database is away: the home page returns 200 whether
// or not MongoDB is reachable, so a monitor watching '/' would call a chapter
// healthy while every query behind it failed. This is the URL to point an
// uptime checker at — it also keeps a sleeping free-tier instance awake.
//
// It reveals nothing: no connection string, no host, no credentials.
app.get('/api/health', async (req, res) => {
  let database;
  try {
    database = await dbStatus();
  } catch (e) {
    database = { state: 'unknown', connected: false, error: 'status unavailable' };
  }
  const ok = !!database.connected;
  res.status(ok ? 200 : 503).json({
    ok,
    service: 'aconsu',
    uptimeSeconds: Math.round(process.uptime()),
    database,
    checkedAt: new Date().toISOString()
  });
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


// The reader is served by bible-api.com, which carries public-domain
// translations only. This list is the floor, not the ceiling: the live
// catalogue is fetched from the service below and merged over it, so a
// translation the service adds shows up without a deploy, and the picker is
// still populated when the service (or the network) is down.
const BIBLE_TRANSLATIONS = [
  { code: 'kjv', label: 'King James Version (KJV)', language: 'English' },
  { code: 'web', label: 'World English Bible (WEB)', language: 'English' },
  { code: 'webbe', label: 'World English Bible, British Edition', language: 'English' },
  { code: 'bbe', label: 'Bible in Basic English', language: 'English' },
  { code: 'oeb-us', label: 'Open English Bible, US Edition', language: 'English' },
  { code: 'oeb-cw', label: 'Open English Bible, Commonwealth Edition', language: 'English' },
  { code: 'cherokee', label: 'Cherokee New Testament', language: 'Cherokee' },
  { code: 'clementine', label: 'Clementine Latin Vulgate', language: 'Latin' },
  { code: 'almeida', label: 'João Ferreira de Almeida', language: 'Portuguese' },
  { code: 'rccv', label: 'Romanian Corrected Cornilescu Version', language: 'Romanian' }
];

// Versions the union reads that the app is not free to serve as text.
//
// The church has approved NASB 2020, but the NASB is © The Lockman
// Foundation: reproducing it — including proxying it through this server —
// needs a licence, and bible-api.com does not carry it. So it is offered as a
// version that opens in a licensed reader, honestly labelled, instead of
// quietly missing from the list. If the union obtains a licence (from The
// Lockman Foundation directly, or through a provider that already holds the
// rights), this entry moves into BIBLE_TRANSLATIONS as an ordinary code and
// the rest of the reader needs no change.
const BIBLE_EXTERNAL_VERSIONS = [
  {
    code: 'nasb2020',
    label: 'New American Standard Bible 2020 (NASB)',
    language: 'English',
    external: true,
    publisher: 'The Lockman Foundation',
    note: 'Approved by the church. The NASB is copyrighted, so this version opens in the publisher\u2019s licensed reader rather than inside the app.',
    urlTemplate: 'https://www.biblegateway.com/passage/?search={reference}&version=NASB'
  }
];
const EXTERNAL_VERSION_CODES = new Set(BIBLE_EXTERNAL_VERSIONS.map((v) => v.code));

const bibleCache = new Map(); // key -> { data, expiresAt }
const BIBLE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — scripture text doesn't change
const BIBLE_TRANSLATION_TTL_MS = 12 * 60 * 60 * 1000; // the catalogue changes far more rarely than it is asked for
const BIBLE_TRANSLATION_RETRY_MS = 5 * 60 * 1000;     // how long a failed catalogue fetch is left alone
let bibleTranslationCache = { list: null, expiresAt: 0 };

// Our own label wins for a translation we already name well; everything else
// keeps the service's own name. English first — that is what the chapter
// reads — then alphabetically, with the KJV pinned at the top as the default.
function mergeTranslations(live) {
  const known = new Map(BIBLE_TRANSLATIONS.map((t) => [t.code, t]));
  const merged = new Map();
  for (const t of BIBLE_TRANSLATIONS) merged.set(t.code, t);
  for (const t of live) {
    const ours = known.get(t.code);
    merged.set(t.code, ours ? { ...t, label: ours.label } : t);
  }
  return [...merged.values()].sort((a, b) => {
    if (a.code === 'kjv') return -1;
    if (b.code === 'kjv') return 1;
    const aEn = a.language === 'English' ? 0 : 1;
    const bEn = b.language === 'English' ? 0 : 1;
    if (aEn !== bEn) return aEn - bEn;
    return a.label.localeCompare(b.label);
  });
}

async function loadBibleTranslations() {
  if (bibleTranslationCache.list && bibleTranslationCache.expiresAt > Date.now()) {
    return bibleTranslationCache.list;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const apiRes = await fetch('https://bible-api.com/data', { signal: controller.signal });
    clearTimeout(timeout);
    if (!apiRes.ok) throw new Error('Translation catalogue unavailable');
    const data = await apiRes.json();
    const live = (Array.isArray(data.translations) ? data.translations : [])
      .filter((t) => t && t.identifier)
      .map((t) => ({
        code: String(t.identifier),
        label: String(t.name || t.identifier).trim(),
        language: String(t.language || '').trim()
      }));
    if (!live.length) throw new Error('Translation catalogue was empty');
    const list = mergeTranslations(live);
    bibleTranslationCache = { list, expiresAt: Date.now() + BIBLE_TRANSLATION_TTL_MS };
    return list;
  } catch (e) {
    // Offline, or the service is down. The reader still offers the versions we
    // know it carries rather than an empty picker — and the failure is held
    // briefly, so a service that is down costs one slow request rather than a
    // six-second wait on every page load until it comes back.
    bibleTranslationCache = { list: BIBLE_TRANSLATIONS, expiresAt: Date.now() + BIBLE_TRANSLATION_RETRY_MS };
    return BIBLE_TRANSLATIONS;
  }
}

app.get('/api/bible/books', async (req, res) => {
  const translations = await loadBibleTranslations();
  res.json({ books: BIBLE_BOOKS, translations, externalVersions: BIBLE_EXTERNAL_VERSIONS });
});

app.get('/api/bible/passage', async (req, res) => {
  const { book, chapter, translation } = req.query;
  if (!book || !chapter) return res.status(400).json({ error: 'Book and chapter are required' });
  const trans = translation || 'kjv';

  // A version we are not licensed to reproduce is answered with where to read
  // it, not with an error the reader cannot act on.
  if (EXTERNAL_VERSION_CODES.has(trans)) {
    const version = BIBLE_EXTERNAL_VERSIONS.find((v) => v.code === trans);
    return res.status(409).json({
      error: version.note,
      externalVersion: {
        code: version.code,
        label: version.label,
        publisher: version.publisher,
        url: version.urlTemplate.replace('{reference}', encodeURIComponent(`${book} ${chapter}`))
      }
    });
  }
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
    if (apiRes.status === 404) {
      // bible-api.com answers 404 both for a passage that does not exist and
      // for a translation code it does not carry. Saying which it was is the
      // difference between "try another chapter" and "try another version".
      const known = await loadBibleTranslations();
      if (!known.some((t) => t.code === trans)) {
        return res.status(404).json({ error: 'That version is not available in the reader. Please pick another one.' });
      }
      return res.status(404).json({ error: 'Passage not found' });
    }
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
  createNotification, notifyAdminByEmail, chapterConfidential
};
registerGroupRoutes(app, communityRouteDeps);
registerChatRoutes(app, communityRouteDeps);
const { logMilestone } = registerMemberServiceRoutes(app, communityRouteDeps);

// Who runs a department is the executive holding it — the roster card
// carrying this department — rather than a name typed into the department
// record itself. Those were two separate answers that could disagree, and
// the typed one went stale the moment an office changed hands. Derived on
// read so it is always whoever currently holds the office, with no second
// field to keep in step.
async function attachDepartmentLeaders(departments) {
  const many = Array.isArray(departments);
  const list = many ? departments : [departments];
  if (!list.length || !list[0]) return departments;
  const execs = await repo.getAll('executives');
  const key = (chapterId, departmentId) => `${chapterId || ''}::${departmentId}`;
  const holders = new Map();
  execs.forEach((exec) => {
    if (!exec.department) return;
    const k = key(exec.chapterId, exec.department);
    if (!holders.has(k)) holders.set(k, exec);
  });
  const decorate = (dept) => {
    const holder = holders.get(key(dept.chapterId, dept.id));
    return { ...dept, leaderName: holder ? holder.name || '' : '', leaderRole: holder ? holder.role || '' : '' };
  };
  return many ? list.map(decorate) : decorate(list[0]);
}

['departments', 'sermons', 'testimonies'].forEach((resource) => {
  app.get(`/api/${resource}`, async (req, res) => {
    try {
      const items = await repo.getAll(resource, contentChapterFilter(req));
      // Only publish testimonies that have been approved by an admin.
      if (resource === 'testimonies') {
        return res.json(items.filter((t) => t.published));
      }
      res.json(resource === 'departments' ? await attachDepartmentLeaders(items) : items);
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

app.get('/api/search', async (req, res) => {
  try {
    const rawQuery = String(req.query.q || '').trim();
    const normalizedQuery = normalizeSearchText(rawQuery);
    const limit = Math.min(Math.max(Number(req.query.limit) || 24, 1), 60);
    if (normalizedQuery.length < 2) {
      return res.json({ query: rawQuery, results: [] });
    }

    const querySuffix = `q=${encodeURIComponent(rawQuery)}`;
    const terms = normalizedQuery.split(' ').filter(Boolean);
    const baseScope = contentChapterFilter(req);
    const actingScope = rolesLib.getActingScope(req);
    const eventScope = baseScope.chapterId ? { $or: [{ chapterId: baseScope.chapterId }, { isNational: true }] } : baseScope;
    const contentScope = baseScope.chapterId ? { $or: [{ chapterId: baseScope.chapterId }, { chapterId: '' }] } : {};
    const eventFilter = actingScope.kind === 'anonymous' ? { ...eventScope, status: 'published' } : eventScope;
    const modules = await featureModules();

    const [departments, sermons, events, pages, contentItems] = await Promise.all([
      repo.getAll('departments', baseScope).then(attachDepartmentLeaders),
      repo.getAll('sermons', baseScope),
      repo.getAll('events', eventFilter),
      repo.getAll('pages', baseScope),
      repo.getAll('contentItems', { ...contentScope, published: true })
    ]);

    const enabledKinds = new Set(CONTENT_KINDS.filter((kind) => !CONTENT_FEATURES[kind] || modules[CONTENT_FEATURES[kind]]));
    const results = [
      ...sermons.map((item) => buildPublicSearchResult({
        query: normalizedQuery,
        terms,
        type: 'sermon',
        typeLabel: 'Sermon',
        title: item.title,
        subtitle: item.speaker,
        description: item.description,
        href: `/media.html?sermon=${encodeURIComponent(item.id)}&${querySuffix}`,
        extraSearch: [item.type, item.url],
        meta: { id: item.id }
      })),
      ...departments.map((item) => buildPublicSearchResult({
        query: normalizedQuery,
        terms,
        type: 'department',
        typeLabel: 'Department',
        title: item.name,
        subtitle: item.tagline,
        description: item.description,
        href: `/department.html?id=${encodeURIComponent(item.id)}&${querySuffix}`,
        extraSearch: [item.meetingDay, item.meetingTime, item.meetingLocation, item.leaderName],
        meta: { id: item.id }
      })),
      ...events.map((item) => buildPublicSearchResult({
        query: normalizedQuery,
        terms,
        type: 'event',
        typeLabel: 'Event',
        title: item.title,
        subtitle: [item.date, item.location].filter(Boolean).join(' · '),
        description: item.description,
        href: `/events.html?event=${encodeURIComponent(item.id)}&${querySuffix}`,
        extraSearch: [item.category, item.time, item.videoUrl, item.recurring],
        meta: { id: item.id }
      })),
      ...pages.map((item) => buildPublicSearchResult({
        query: normalizedQuery,
        terms,
        type: 'page',
        typeLabel: 'Page',
        title: item.title,
        subtitle: item.navLabel,
        description: item.description || item.content,
        href: `/page.html?slug=${encodeURIComponent(item.slug)}&${querySuffix}`,
        extraSearch: [item.type, item.content],
        meta: { id: item.id || item.slug, slug: item.slug }
      })),
      ...contentItems
        .filter((item) => enabledKinds.has(item.kind))
        .map((item) => buildPublicSearchResult({
          query: normalizedQuery,
          terms,
          type: 'content',
          typeLabel: CONTENT_KIND_LABELS[item.kind] || 'Content',
          title: item.title,
          subtitle: item.category || item.kind,
          description: item.summary || item.body,
          href: `/content.html?kind=${encodeURIComponent(item.kind)}&item=${encodeURIComponent(item.id)}&${querySuffix}`,
          extraSearch: [item.body, item.category, item.previewUrl, item.resourceUrl],
          meta: { id: item.id, kind: item.kind }
        }))
    ]
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, limit)
      .map(({ score, ...item }) => item);

    res.json({ query: rawQuery, results });
  } catch (e) {
    res.status(500).json({ error: 'Could not search right now' });
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

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanStringList(value) {
  if (Array.isArray(value)) return value.map((item) => cleanText(String(item ?? ''))).filter(Boolean);
  if (typeof value === 'string') return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function mergeTextFields(current, incoming, keys) {
  const merged = { ...(current || {}) };
  keys.forEach((key) => {
    if (hasOwn(incoming, key)) merged[key] = cleanText(incoming[key]);
  });
  return merged;
}

function chapterSettingsResponse(chapter) {
  return chapter ? { ...chapter, chapterId: chapter.id } : null;
}

// Only pages this build actually has, and only the two fields the page needs.
// A key left over from a renamed page, or anything else that found its way
// into the record, is dropped rather than handed to the browser.
function sanitiseHeroArt(stored) {
  const out = {};
  if (!stored || typeof stored !== 'object') return out;
  for (const [key, value] of Object.entries(stored)) {
    if (!heroArt.isHeroPage(key) || !value || !value.fileId) continue;
    out[key] = { fileId: String(value.fileId), tone: value.tone === 'dark' ? 'dark' : 'light' };
  }
  return out;
}

function buildPublicSettings(globalSettings, chapter) {
  // heroArt is always an object, chapter or not, so a page never has to guard
  // against the shape of the answer before looking for its own artwork.
  if (!chapter) return { ...globalSettings, heroArt: {} };
  const contact = chapter.contact || {};
  const payment = chapter.payment || {};
  const globalAbout = globalSettings.about || {};
  const about = chapter.about || {};
  return {
    ...globalSettings,
    chapterId: chapter.id,
    chapterName: chapter.name,
    fellowshipName: chapter.name || globalSettings.fellowshipName,
    fullName: chapter.fullName || globalSettings.fullName,
    tagline: chapter.tagline || globalSettings.tagline,
    verseOfTheWeek: chapter.verseOfTheWeek || globalSettings.verseOfTheWeek,
    address: chapter.address || chapter.location || globalSettings.address,
    homeHeaderImageFileId: chapter.homeHeaderImageFileId || globalSettings.homeHeaderImageFileId,
    // Every page already loads settings to draw its header and footer, so the
    // artwork map rides along with it rather than costing a request of its own.
    heroArt: sanitiseHeroArt(chapter.heroArt),
    serviceTimes: chapter.serviceTimes?.length ? chapter.serviceTimes : (globalSettings.serviceTimes || []),
    email: contact.email || globalSettings.email,
    phone: contact.phone || globalSettings.phone,
    whatsapp: contact.whatsapp || globalSettings.whatsapp,
    facebook: contact.facebook || globalSettings.facebook,
    instagram: contact.instagram || globalSettings.instagram,
    youtube: contact.youtube || globalSettings.youtube,
    tiktok: contact.tiktok || globalSettings.tiktok,
    twitter: contact.twitter || globalSettings.twitter,
    telegram: contact.telegram || globalSettings.telegram,
    momoNumber: payment.momoNumber || globalSettings.momoNumber,
    momoName: payment.momoName || globalSettings.momoName,
    contact: {
      email: contact.email || globalSettings.email || '',
      phone: contact.phone || globalSettings.phone || '',
      whatsapp: contact.whatsapp || globalSettings.whatsapp || '',
      facebook: contact.facebook || globalSettings.facebook || '',
      instagram: contact.instagram || globalSettings.instagram || '',
      youtube: contact.youtube || globalSettings.youtube || '',
      tiktok: contact.tiktok || globalSettings.tiktok || '',
      twitter: contact.twitter || globalSettings.twitter || '',
      telegram: contact.telegram || globalSettings.telegram || ''
    },
    payment: {
      provider: payment.provider || globalSettings.provider || '',
      momoNumber: payment.momoNumber || globalSettings.momoNumber || '',
      momoName: payment.momoName || globalSettings.momoName || '',
      bankName: payment.bankName || globalSettings.bankName || '',
      bankAccountName: payment.bankAccountName || globalSettings.bankAccountName || '',
      bankAccountNumber: payment.bankAccountNumber || globalSettings.bankAccountNumber || '',
      donationDestination: payment.donationDestination || globalSettings.donationDestination || '',
      welfareDestination: payment.welfareDestination || globalSettings.welfareDestination || ''
    },
    about: {
      history: about.history || globalAbout.history || '',
      vision: about.vision || globalAbout.vision || '',
      mission: about.mission || globalAbout.mission || '',
      values: about.values || globalAbout.values || '',
      leadership: about.leadership || globalAbout.leadership || ''
    }
  };
}

app.get('/api/settings', async (req, res) => {
  try {
    const globalSettings = await repo.getSettings();
    if (req.query.global === '1' && rolesLib.getActingScope(req).isNational) {
      return res.json(globalSettings);
    }
    const explicitChapterId = cleanText(req.query.chapterId);
    const chapterId = explicitChapterId || await resolvePublicChapterId(req);
    if (!chapterId) {
      return res.json(globalSettings);
    }
    const chapter = await repo.getById('chapters', chapterId);
    res.json(buildPublicSettings(globalSettings, chapter));
  } catch (e) {
    res.status(500).json({ error: 'Could not load settings' });
  }
});

// Generate verse-of-the-day as a shareable image (PNG)
// Wraps a line of scripture into SVG <tspan> rows.
//
// This exists because the image used to be laid out with <foreignObject>, and
// librsvg — which sharp renders through — does not implement it. The plain
// <text> elements around it appeared, the verse inside it did not, so every
// shared image was a purple gradient with a heading and no scripture on it.
// Real <text> and <tspan> render, so the wrapping has to be done here rather
// than left to a browser that is never involved.
function wrapSvgText(text, maxChars) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? line + ' ' + word : word;
    if (candidate.length > maxChars && line) { lines.push(line); line = word; }
    else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}
function escapeSvg(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]
  ));
}

// "Book 3:16", "1 John 4:8", "Psalm 23" — a book name followed by numbers.
const SCRIPTURE_REF = /^\s*(?:[1-3]\s*)?[A-Za-z][A-Za-z.\s]{1,24}\s*\d{1,3}(?::\d{1,3}(?:\s*[-–]\s*\d{1,3})?)?\s*$/;

// A verse arrives as one string, and the two conventions in this app put the
// reference at opposite ends: the Coordinator's daily verse renders as
// `"text" — Reference`, while the Verse of the Week an admin types into Site
// Settings is prompted as `Acts 2:42 — And they continued...`. Splitting on
// the dash alone got the settings one backwards, printing the scripture where
// the reference belongs. So look at both sides and let the one that is shaped
// like a reference win.
function splitVerseAndReference(raw) {
  const text = String(raw || '').trim();
  const parts = text.split(/\s+[—–]\s+|\s+--?\s+/);
  if (parts.length >= 2) {
    const head = parts[0].trim();
    const tail = parts.slice(1).join(' — ').trim();
    if (SCRIPTURE_REF.test(head)) return { verse: tail, reference: head };
    const last = parts[parts.length - 1].trim();
    if (SCRIPTURE_REF.test(last)) {
      return { verse: parts.slice(0, -1).join(' — ').trim(), reference: last };
    }
  }
  return { verse: text, reference: '' };
}

// The backgrounds a verse card can wear. One purple gradient was the only
// option, which made every verse anybody shared look like every other one.
// Each style carries its own backdrop and the ink that stays readable on it,
// so a light card is a real option rather than dark text on a dark panel.
const VERSE_CARD_STYLES = {
  purple: {
    label: 'Royal purple',
    swatch: 'linear-gradient(135deg,#5B2C82,#3A1B54 55%,#241530)',
    ink: '#FBF8FD', accent: '#E8971E', sub: '#EFE6F6', quote: '#E8971E', quoteOpacity: 0.22,
    backdrop: (w, h) => `
      <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#5B2C82"/><stop offset="55%" stop-color="#3A1B54"/>
        <stop offset="100%" stop-color="#241530"/></linearGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#g)"/>
      <circle cx="${w - 60}" cy="180" r="300" fill="#E8971E" opacity="0.07"/>
      <circle cx="40" cy="${h - 140}" r="240" fill="#E8971E" opacity="0.05"/>`
  },
  dawn: {
    label: 'Sunrise gold',
    swatch: 'linear-gradient(180deg,#F6C56A,#EEA23F 48%,#D97B22)',
    ink: '#2A1708', accent: '#8A3F12', sub: '#4A2A12', quote: '#B4661C', quoteOpacity: 0.3,
    backdrop: (w, h) => `
      <defs><linearGradient id="g" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#F6C56A"/><stop offset="48%" stop-color="#EEA23F"/>
        <stop offset="100%" stop-color="#D97B22"/></linearGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#g)"/>
      <circle cx="${w / 2}" cy="${h + 120}" r="620" fill="#FFF2D4" opacity="0.30"/>
      <circle cx="${w / 2}" cy="${h + 120}" r="420" fill="#FFF8E8" opacity="0.28"/>`
  },
  night: {
    label: 'Midnight',
    swatch: 'radial-gradient(120% 100% at 50% 18%,#2B2144,#161029 62%,#0B0715)',
    ink: '#EDE7F5', accent: '#F0AE43', sub: '#C7BCD8', quote: '#F0AE43', quoteOpacity: 0.26,
    backdrop: (w, h) => `
      <defs><radialGradient id="g" cx="50%" cy="18%" r="92%">
        <stop offset="0%" stop-color="#2B2144"/><stop offset="62%" stop-color="#161029"/>
        <stop offset="100%" stop-color="#0B0715"/></radialGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#g)"/>
      ${[[140, 210, 3], [320, 130, 2], [880, 250, 3], [980, 520, 2], [180, 980, 2],
         [760, 1180, 3], [420, 1260, 2], [620, 96, 2], [1010, 880, 2]]
        .map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#FFF6E2" opacity="0.7"/>`).join('')}`
  },
  olive: {
    label: 'Still waters',
    swatch: 'linear-gradient(150deg,#2F5044,#1E3A31 60%,#132622)',
    ink: '#F2F6F1', accent: '#E8C87A', sub: '#D3DECF', quote: '#E8C87A', quoteOpacity: 0.24,
    backdrop: (w, h) => `
      <defs><linearGradient id="g" x1="0%" y1="0%" x2="60%" y2="100%">
        <stop offset="0%" stop-color="#2F5044"/><stop offset="60%" stop-color="#1E3A31"/>
        <stop offset="100%" stop-color="#132622"/></linearGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#g)"/>
      <circle cx="120" cy="200" r="300" fill="#8FBFA4" opacity="0.08"/>
      <circle cx="${w - 80}" cy="${h - 180}" r="260" fill="#E8C87A" opacity="0.06"/>`
  },
  ember: {
    label: 'Ember',
    swatch: 'radial-gradient(120% 110% at 50% 108%,#C4451F,#7E2318 46%,#3A1010)',
    ink: '#FDF3EF', accent: '#F3B14A', sub: '#EED6CC', quote: '#F3B14A', quoteOpacity: 0.24,
    backdrop: (w, h) => `
      <defs><radialGradient id="g" cx="50%" cy="108%" r="108%">
        <stop offset="0%" stop-color="#C4451F"/><stop offset="46%" stop-color="#7E2318"/>
        <stop offset="100%" stop-color="#3A1010"/></radialGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#g)"/>
      <circle cx="${w / 2}" cy="${h + 60}" r="430" fill="#F3B14A" opacity="0.16"/>`
  },
  parchment: {
    label: 'Parchment',
    swatch: 'linear-gradient(180deg,#FBF3E2,#EFE0C4)',
    ink: '#3B2A18', accent: '#8A5A16', sub: '#6B563C', quote: '#B08A3E', quoteOpacity: 0.34,
    backdrop: (w, h) => `
      <defs><linearGradient id="g" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#FBF3E2"/><stop offset="100%" stop-color="#EFE0C4"/></linearGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#g)"/>
      <rect x="44" y="44" width="${w - 88}" height="${h - 88}" fill="none" stroke="#C7A96B" stroke-width="3" opacity="0.55"/>
      <rect x="60" y="60" width="${w - 120}" height="${h - 120}" fill="none" stroke="#C7A96B" stroke-width="1" opacity="0.4"/>`
  }
};
const DEFAULT_VERSE_STYLE = 'purple';

// Public: the share sheet asks for this so the pickers and the renderer cannot
// drift apart on which cards exist.
app.get('/api/verse-styles', (req, res) => {
  res.json({
    // The swatch is a CSS gradient, not a rendered card: a picker that showed
    // six real cards would download six full-size PNGs to let someone choose one.
    styles: Object.entries(VERSE_CARD_STYLES).map(([value, s]) => ({ value, label: s.label, swatch: s.swatch })),
    defaultStyle: DEFAULT_VERSE_STYLE
  });
});

app.get('/api/verse-image', async (req, res) => {
  try {
    let verseText = req.query.verse || '';
    let reference = cleanText(String(req.query.reference || ''));
    if (!verseText) {
      const settings = await repo.getSettings();
      if (!settings.verseOfTheWeek) return res.status(400).json({ error: 'No verse configured' });
      verseText = settings.verseOfTheWeek;
    }
    // The client passes the reference when it knows it; otherwise split the
    // strip so the reference is set apart rather than run on from the quote.
    if (!reference) {
      const split = splitVerseAndReference(verseText);
      verseText = split.verse;
      reference = split.reference;
    }
    verseText = String(verseText).replace(/^[\s"“]+|[\s"”]+$/g, '');

    // An unknown style is answered with the default rather than an error: a
    // shared link with a stale style in it should still produce a card.
    const style = VERSE_CARD_STYLES[String(req.query.style || '')] || VERSE_CARD_STYLES[DEFAULT_VERSE_STYLE];

    const width = 1080, height = 1350;
    // Sized so a long verse still fits the panel rather than running off it.
    const full = verseText.length > 420 ? verseText.slice(0, 417).trimEnd() + '…' : verseText;
    const fontSize = full.length > 260 ? 38 : full.length > 150 ? 44 : 52;
    const perLine = Math.floor(1560 / fontSize);
    const lines = wrapSvgText(full, perLine);
    const lineHeight = Math.round(fontSize * 1.52);
    const blockHeight = lines.length * lineHeight;
    const startY = Math.round((height - blockHeight) / 2) + fontSize / 2;

    const tspans = lines.map((ln, i) =>
      `<tspan x="${width / 2}" y="${startY + i * lineHeight}">${escapeSvg(ln)}</tspan>`
    ).join('');

    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        ${style.backdrop(width, height)}

        <text x="${width / 2}" y="112" font-size="34" font-weight="700" fill="${style.accent}"
              text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"
              letter-spacing="7">ACONSU</text>
        <line x1="${width / 2 - 60}" y1="140" x2="${width / 2 + 60}" y2="140" stroke="${style.accent}" stroke-width="2" opacity="0.6"/>

        <text x="${width / 2 - 20}" y="${startY - lineHeight}" font-size="150" fill="${style.quote}"
              opacity="${style.quoteOpacity}" text-anchor="middle" font-family="Georgia, serif">&#8220;</text>

        <text font-size="${fontSize}" fill="${style.ink}" text-anchor="middle"
              font-family="Georgia, 'Times New Roman', serif">${tspans}</text>

        ${reference ? `<text x="${width / 2}" y="${startY + blockHeight + 34}" font-size="32" font-weight="700"
              fill="${style.accent}" text-anchor="middle" font-family="Georgia, serif">${escapeSvg(reference)}</text>` : ''}

        <text x="${width / 2}" y="${height - 58}" font-size="22" fill="${style.sub}" opacity="0.62"
              text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
              letter-spacing="2">THE APOSTLES&#8217; CONTINUATION STUDENTS UNION</text>
      </svg>
    `;

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
    res.json(await attachDepartmentLeaders(dept));
  } catch (e) {
    res.status(500).json({ error: 'Could not load department' });
  }
});

app.get('/api/executives', async (req, res) => {
  try {
    const execs = await repo.getAll('executives', contentChapterFilter(req));
    // Rank by the position itself, so the President heads the roster whatever
    // order the cards happened to be created in. A card whose `order` was set
    // by hand keeps it; anything else falls back to its position's rank, and
    // an unplaceable title sorts to the end rather than to the top.
    const rank = (e) => {
      if (e.order) return e.order;
      const position = positions.resolvePosition(e.positionKey, e.role, !!e.department);
      return position.order;
    };
    res.json(execs.sort((a, b) => rank(a) - rank(b) || String(a.name || '').localeCompare(String(b.name || ''))));
  } catch (e) {
    res.status(500).json({ error: 'Could not load executives' });
  }
});

app.post('/api/member/executive-interest', requireMember, async (req, res) => {
  try {
    const role = String(req.body?.role || '').trim();
    const department = String(req.body?.department || '').trim();
    const scope = String(req.body?.scope || '').trim();
    if (!role || !department || !scope) {
      return res.status(400).json({ error: 'Role, department and scope are required' });
    }
    const member = await repo.getById('members', req.session.memberId);
    if (!member) return res.status(404).json({ error: 'Member not found' });
    const updates = {
      executiveStatus: 'pending',
      executiveRole: role,
      executiveDepartment: department,
      executiveScope: scope,
      isExecutive: false
    };
    const updated = await repo.updateById('members', member.id, { ...member, ...updates });
    const item = { id: updated.id, memberId: updated.id, chapterId: updated.chapterId, role: updated.executiveRole, department: updated.executiveDepartment, scope: updated.executiveScope, executiveStatus: updated.executiveStatus };
    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ error: 'Could not submit executive interest' });
  }
});

app.get('/api/admin/executive-applications', requireChapterAdmin, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req, { required: false });
    const members = await repo.getAll('members', filter);
    const items = members
      .filter(m => m.executiveStatus && m.executiveStatus !== 'none')
      .map(m => ({
        id: m.id,
        memberId: m.id,
        name: m.name,
        email: m.email,
        chapterId: m.chapterId,
        role: m.executiveRole,
        department: m.executiveDepartment,
        scope: m.executiveScope,
        executiveStatus: m.executiveStatus,
        isExecutive: !!m.isExecutive,
        createdAt: m.updatedAt || new Date().toISOString()
      }));
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: 'Could not load executive applications' });
  }
});

// Vetting an executive is the Chapter Coordinator's call (the "Chapter
// approvals" row of the responsibility matrix), and approving is one action
// that provisions the whole person: the member is promoted, their portal
// login is issued for this academic year, and their public roster card is
// created — all linked by memberId. Before this, approval flipped a flag and
// stopped, leaving "verified" executives with no way in and roster cards
// belonging to nobody.
app.patch('/api/admin/executive-applications/:memberId', requireChapterCoordinator, async (req, res) => {
  try {
    const { decision, scope, username, password, positionKey, department } = req.body || {};
    const filter = rolesLib.chapterFilter(req, { required: false });
    const member = await repo.getById('members', req.params.memberId, filter);
    if (!member) return res.status(404).json({ error: 'Member not found' });
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ error: 'Decision must be approve or reject' });
    }

    let account = null;
    let issuedLogin = false;
    let position = null;
    if (decision === 'approve') {
      // The position is what grants capabilities, so it is settled here — by
      // the Coordinator doing the vetting — and never by the executive
      // themselves. A portfolio holder must arrive with a real department in
      // this chapter, since that is what their panels operate on.
      position = positions.positionByKey(positionKey);
      if (!position) {
        return res.status(400).json({ error: 'Choose the position this executive is being approved into.' });
      }
      const wantsDepartment = String(department || '').trim();
      if (positions.requiresDepartment(position)) {
        if (!wantsDepartment) {
          return res.status(400).json({ error: `A ${position.label} runs a department — choose which one.` });
        }
        if (!await repo.getById('departments', wantsDepartment, { chapterId: member.chapterId })) {
          return res.status(400).json({ error: 'That department is not in this chapter — pick one from the list.' });
        }
      } else if (wantsDepartment) {
        return res.status(400).json({ error: `A ${position.label} answers for the whole chapter, so they are not attached to a department.` });
      }
    }
    if (decision === 'approve') {
      // Renew in place if this member already holds the office, so a
      // re-elected executive keeps their account, card and history rather
      // than collecting a second set.
      account = await models.StaffUser.findOne({ memberId: member.id, role: 'executive' }).lean();
      if (account) {
        account = await repo.patchById('staffUsers', account.id, {
          active: true, termYear: currentAcademicYearLabel(), termEndsAt: academicYearEndsAt()
        });
      } else {
        const clean = String(username || '').toLowerCase().trim();
        if (!clean || !password) {
          return res.status(400).json({ error: 'A username and password are required to issue this executive their portal login.' });
        }
        if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
        if (await models.StaffUser.findOne({ username: clean })) {
          return res.status(400).json({ error: 'That username is already taken' });
        }
        account = await repo.create('staffUsers', {
          username: clean, name: member.name || clean, role: 'executive',
          chapterId: member.chapterId, memberId: member.id,
          passwordHash: await bcrypt.hash(String(password), 10), active: true,
          termYear: currentAcademicYearLabel(), termEndsAt: academicYearEndsAt()
        }, 'staff');
        issuedLogin = true;
      }

      // The public roster card, created here rather than waiting for the
      // executive to discover the profile form.
      const departmentId = positions.requiresDepartment(position) ? String(department || '').trim() : '';
      const existingCard = await models.Executive.findOne({ staffId: account.id, chapterId: member.chapterId }).lean();
      if (existingCard) {
        // A re-elected executive can come back into a different office, so the
        // position is refreshed rather than frozen at whatever they held first.
        await repo.patchById('executives', existingCard.id, {
          positionKey: position.key, role: position.label, department: departmentId, order: position.order
        }, { chapterId: member.chapterId });
      } else {
        await repo.create('executives', {
          chapterId: member.chapterId, staffId: account.id,
          name: member.name || '', role: position.label, positionKey: position.key,
          department: departmentId, order: position.order,
          bio: '', contact: { phone: member.phone || '', email: member.email || '' },
          imageFileId: member.profileImageFileId || '', history: []
        }, 'exec');
        await logMilestone({
          chapterId: member.chapterId, memberId: member.id, memberName: member.name || '',
          type: 'executive_appointment', note: position.label, loggedBy: 'System'
        });
      }
    }

    // Withdrawing a verification from someone who already held the office
    // closes it: ending the term and the session they are using, rather than
    // leaving a rejected executive with a working login.
    if (decision === 'reject') {
      const held = await models.StaffUser.findOne({ memberId: member.id, role: 'executive' }).lean();
      if (held) {
        await repo.patchById('staffUsers', held.id, { termEndsAt: new Date() });
        revokeStaffSessions(held.id);
      }
    }

    const nextStatus = decision === 'approve' ? 'verified' : 'rejected';
    const updated = await repo.updateById('members', member.id, {
      ...member,
      executiveStatus: nextStatus,
      executiveScope: scope || member.executiveScope || 'chapter',
      executiveRole: position ? position.label : member.executiveRole,
      executiveDepartment: position
        ? (positions.requiresDepartment(position) ? String(department || '').trim() : '')
        : member.executiveDepartment,
      isExecutive: decision === 'approve',
      executiveVerifiedAt: decision === 'approve' ? new Date() : null
    }, filter);
    res.json({ success: true, item: {
      id: updated.id,
      memberId: updated.id,
      name: updated.name,
      executiveStatus: updated.executiveStatus,
      isExecutive: !!updated.isExecutive,
      scope: updated.executiveScope,
      role: updated.executiveRole,
      department: updated.executiveDepartment,
      account: account ? { id: account.id, username: account.username, termYear: account.termYear, termEndsAt: account.termEndsAt } : null,
      issuedLogin
    }});
  } catch (e) {
    res.status(500).json({ error: 'Could not update executive application' });
  }
});

// Reshuffling a sitting executive mid-year — the Secretary steps up to Vice
// President, a portfolio changes hands. Kept with the Coordinator for the same
// reason approval is: the position decides what its holder can do.
app.patch('/api/admin/executives/:id/position', requireChapterCoordinator, async (req, res) => {
  try {
    const filter = rolesLib.chapterFilter(req, { required: false });
    const card = await repo.getById('executives', req.params.id, filter);
    if (!card) return res.status(404).json({ error: 'That executive was not found.' });

    const position = positions.positionByKey(req.body && req.body.positionKey);
    if (!position) return res.status(400).json({ error: 'Choose a position from the list.' });

    const departmentId = String((req.body && req.body.department) || '').trim();
    if (positions.requiresDepartment(position)) {
      if (!departmentId) return res.status(400).json({ error: `A ${position.label} runs a department — choose which one.` });
      if (!await repo.getById('departments', departmentId, { chapterId: card.chapterId })) {
        return res.status(400).json({ error: 'That department is not in this chapter — pick one from the list.' });
      }
    } else if (departmentId) {
      return res.status(400).json({ error: `A ${position.label} answers for the whole chapter, so they are not attached to a department.` });
    }

    // Snapshot the office they are leaving before overwriting it, so "who was
    // Secretary in 2025/2026" survives the reshuffle.
    const history = [...(card.history || [])];
    const changed = card.positionKey !== position.key || (card.department || '') !== departmentId;
    if (changed && (card.role || card.department)) {
      history.push({
        year: currentAcademicYearLabel(),
        role: card.role || '',
        department: card.department || '',
        updatedAt: new Date()
      });
    }

    const item = await repo.patchById('executives', card.id, {
      positionKey: position.key,
      role: position.label,
      department: departmentId,
      order: position.order,
      history
    }, { chapterId: card.chapterId });

    // The member record carries the same office, so it moves with the card.
    if (card.staffId) {
      const staffAccount = await models.StaffUser.findOne({ id: card.staffId }).lean();
      const linkedMember = staffAccount && staffAccount.memberId
        ? await models.Member.findOne({ id: staffAccount.memberId }).lean()
        : null;
      if (linkedMember) {
        await repo.patchById('members', linkedMember.id, {
          executiveRole: position.label,
          executiveDepartment: departmentId
        });
      }
    }

    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ error: 'Could not change this executive\'s position.' });
  }
});

// Public leadership roster: chapter coordinators and the National Coordinator,
// enriched with their member profile image/contact details for the visitors page.
app.get('/api/public/leadership', async (req, res) => {
  try {
    const staffUsers = await repo.getAll('staffUsers', {});
    const members = await repo.getAll('members', {});
    const memberMap = new Map(members.map(m => [m.id, m]));
    const leadership = [];

    const national = staffUsers.find(u => u.role === 'nationalCoordinator' && u.active !== false);
    if (national) {
      const member = memberMap.get(national.memberId) || null;
      leadership.push({
        id: national.id,
        name: national.name || member?.name || 'National Coordinator',
        role: 'National Coordinator',
        chapterId: '',
        chapterName: 'National',
        phone: member?.phone || '',
        email: member?.email || '',
        imageFileId: member?.profileImageFileId || ''
      });
    }

    const coordinators = staffUsers.filter(u => u.role === 'coordinator' && u.active !== false);
    for (const user of coordinators) {
      const chapter = await repo.getById('chapters', user.chapterId || '');
      const member = memberMap.get(user.memberId) || null;
      leadership.push({
        id: user.id,
        name: user.name || member?.name || chapter?.name || 'Chapter Coordinator',
        role: 'Chapter Coordinator',
        chapterId: user.chapterId || '',
        chapterName: chapter?.name || user.chapterId || 'Chapter',
        phone: member?.phone || '',
        email: member?.email || chapter?.contact?.email || '',
        imageFileId: member?.profileImageFileId || ''
      });
    }

    res.json(leadership.sort((a, b) => a.chapterName.localeCompare(b.chapterName)));
  } catch (e) {
    res.status(500).json({ error: 'Could not load leadership roster' });
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
      chapterId: event.chapterId || '', eventId: event.id, name, email, phone: phone || '',
      // Only when they are signed in — the form stays open to anyone.
      memberId: (req.session && req.session.memberId) || ''
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
        // Someone who registered saying they had already graduated. The claim
        // is theirs; confirming it is Shepherding's, and until they do the
        // member is an ordinary visitor.
        registeredAsAlumni: !!m.registeredAsAlumni,
        graduationYear: m.graduationYear || '',
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
    if (!isActivatedMember(member)) {
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
      .filter(m => isActivatedMember(m))
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
        { label: 'Active members', value: members.filter(m => isActivatedMember(m)).length },
        { label: 'Visitors / in review', value: members.filter(m => ['visitor', 'under_review', 'accepted', 'alumni'].includes(m.membershipStage)).length }
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
// Derived from MEMBERSHIP_JOURNEY rather than typed again, so the stages
// Shepherding can set and the journey a member is shown can never drift apart.
const MEMBERSHIP_STAGES = MEMBERSHIP_JOURNEY.map(s => s.stage);

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

    // Newly marked an Executive, and no account behind it: the Coordinator is
    // the only one who can finish this, so they are told rather than left to
    // notice. Only on the change itself — re-saving the same stage is not news.
    if (stage === 'executive' && existing.membershipStage !== 'executive') {
      const account = await models.StaffUser.findOne({ memberId: updated.id }).lean();
      if (!account) tellCoordinatorSomeoneNeedsAnAccount(updated);
    }

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

app.post('/api/shepherd/retention-alerts/run', requireShepherd, async (req, res) => {
  try {
    await checkRetentionAlerts();
    const alerts = await repo.getAll('retentionAlerts', rolesLib.chapterFilter(req));
    res.json({ success: true, open: alerts.filter((a) => a.status === 'open').length, total: alerts.length });
  } catch (e) {
    res.status(500).json({ error: 'Could not run retention check' });
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

app.get('/api/finance/entries', chapterConfidential('Finance ledger entries'), requireViewRole('finance'), async (req, res) => {
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
app.get('/api/finance/export.csv', chapterConfidential('Finance ledger entries'), requireViewRole('finance'), async (req, res) => {
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
app.get('/api/finance/export.pdf', chapterConfidential('Finance ledger entries'), requireViewRole('finance'), async (req, res) => {
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
      // Per chapter now: one chapter can be set up to send while another is not.
      smsConfigured: await sms.isConfigured(rolesLib.getActingScope(req).chapterId || ''),
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
    res.json({ audiences: withCounts, smsConfigured: await sms.isConfigured(chapterId) });
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

// An executive's position is what decides what they can do, so it is resolved
// here — from their own roster card, in their own chapter — and never taken
// from the request. Returns the card alongside the position so a caller that
// needs both does not load the card twice.
async function resolveOwnPosition(req) {
  const record = await findOwnExecutiveRecord(req);
  const position = positions.resolvePosition(
    record && record.positionKey,
    record && record.role,
    !!(record && record.department)
  );
  return { record, position };
}

// The single gate for every executive route. A route names the capability it
// serves; the position grants it or the request stops here. This is the same
// grant the portal reads to decide which panels to draw, so a panel can never
// appear without a route behind it, and a route can never be reachable by an
// executive whose position was never given it.
function requireCapability(capability, handler) {
  return async (req, res) => {
    try {
      const { record, position } = await resolveOwnPosition(req);
      if (!positions.hasCapability(position, capability)) {
        return res.status(403).json({
          error: position.kind === 'unknown'
            ? 'Your position has not been set yet — ask your Chapter Coordinator to set it, and this section will open up.'
            : `This section belongs to another office. Yours is ${position.label || 'not set'}.`
        });
      }
      return await handler(req, res, { record, position, staff: currentStaff(req) });
    } catch (e) {
      res.status(500).json({ error: 'Could not load this section right now.' });
    }
  };
}

app.get('/api/executive/me', requireRole('executive'), async (req, res) => {
  try {
    const { record, position } = await resolveOwnPosition(req);
    let department = null;
    if (record && record.department) {
      const staff = currentStaff(req);
      const found = await repo.getById('departments', record.department, { chapterId: staff.chapterId });
      if (found) department = { id: found.id, name: found.name };
    }
    res.json({
      item: record,
      position: positions.publicShape(position),
      department,
      // A portfolio holder with no department yet cannot run their panels;
      // the portal turns this into a prompt rather than a dead end.
      needsDepartment: positions.requiresDepartment(position) && !department
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not load your executive profile' });
  }
});

// The catalogue itself, so the Coordinator's promotion screen offers real
// positions instead of an empty text box.
app.get('/api/executive-positions', (req, res) => {
  res.json(positions.POSITIONS.map(p => ({
    key: p.key, label: p.label, kind: p.kind, order: p.order,
    requiresDepartment: positions.requiresDepartment(p)
  })));
});

app.post('/api/executive/department-header', requireRole('executive'), upload.single('file'), requireCapability(CAP.DEPARTMENT, async (req, res, { record, staff }) => {
  try {
    if (!record || !record.department) return res.status(400).json({ error: 'Your Chapter Coordinator has not attached a department to your office yet.' });
    if (!req.file) return res.status(400).json({ error: 'No image provided' });
    const department = await repo.getById('departments', record.department, { chapterId: staff.chapterId });
    if (!department) return res.status(404).json({ error: 'Your assigned department was not found in this chapter.' });
    const compressed = await compressIfImage(req.file.buffer, req.file.mimetype);
    const fileId = String(await gridfs.uploadBuffer(compressed.buffer, req.file.originalname, {
      category: 'photo', placement: 'department-header', targetId: department.id,
      title: `${department.name} header`, contentType: compressed.contentType, chapterId: staff.chapterId
    }));
    if (department.headerImageFileId) gridfs.deleteFile(department.headerImageFileId).catch(() => {});
    await repo.patchById('departments', department.id, { headerImageFileId: fileId }, { chapterId: staff.chapterId });
    res.json({ success: true, headerImageFileId: fileId, department: department.name });
  } catch (e) {
    res.status(500).json({ error: 'Could not upload the department header' });
  }
}));

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
    const name = String(req.body?.name || '').trim();
    const bio = String(req.body?.bio || '');
    const phone = String(req.body?.phone || '');
    const email = String(req.body?.email || '');

    // Position and department are deliberately NOT read from this request.
    // They decide which capabilities the holder has (lib/positions.js), so
    // letting an executive type their own would let a Music Director make
    // themselves President and walk into the chapter-wide screens. Both are
    // set by the Chapter Coordinator, who is the one doing the vetting; this
    // form edits how an executive presents themselves, not what they may do.
    const role = existing ? existing.role : '';
    const department = existing ? existing.department : '';

    const history = existing ? existing.history || [] : [];
    const fields = {
      chapterId: staff.chapterId,
      staffId: staff.id,
      name: name || (existing ? existing.name : staff.name),
      role,
      positionKey: existing ? (existing.positionKey || '') : '',
      department,
      bio: bio || (existing ? existing.bio : ''),
      contact: {
        phone: phone || (existing ? existing.contact.phone : ''),
        email: email || (existing ? existing.contact.email : '')
      },
      imageFileId,
      history
    };
    const record = existing
      ? await repo.updateById('executives', existing.id, { ...existing, ...fields })
      : await repo.create('executives', fields, 'exec');
    const member = await models.Member.findOne({ id: staff.memberId || req.session.memberId || '' }).lean();
    if (member) {
      await repo.updateById('members', member.id, {
        ...member,
        isExecutive: true,
        executiveStatus: member.executiveStatus === 'verified' ? 'verified' : 'pending',
        executiveRole: fields.role,
        executiveDepartment: fields.department,
        executiveScope: member.executiveScope || 'chapter',
        executiveVerifiedAt: member.executiveVerifiedAt || new Date()
      });
    }
    res.json({ success: true, item: record });
  } catch (e) {
    res.status(500).json({ error: 'Could not save your executive profile' });
  }
});

// Event submission (section 9): EXECUTIVE -> SUBMITTED -> PUBLICITY REVIEW ->
// APPROVED -> PUBLISHED. Never published directly — that's the whole point
// of the workflow, and it's enforced here (status is always 'submitted'),
// not left to whatever the client sends.
app.post('/api/executive/events', requireRole('executive'), requireCapability(CAP.EVENTS, async (req, res, { staff }) => {
  try {
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
}));

app.get('/api/executive/events', requireRole('executive'), requireCapability(CAP.EVENTS, async (req, res, { staff }) => {
  try {
    const items = await repo.getAll('events', { submittedByStaffId: staff.id, chapterId: staff.chapterId });
    res.json(items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  } catch (e) {
    res.status(500).json({ error: 'Could not load your submitted events' });
  }
}));

// ---------- a portfolio holder's own department ----------
// Everything below is scoped by the department on the executive's own roster
// card, resolved from that card rather than taken from the request — so an
// executive can only ever run the department they actually hold, and only
// inside their own chapter.

// Department panels now sit behind a capability as well as a department:
// only a portfolio holder (Evangelism, Welfare, Publicity, Prayer, Music) is
// granted these, so an officer such as the President — who has no department
// and never should — is turned away by the grant rather than being told to
// go and pick a department they do not have.
function requireOwnDepartment(capability, handler) {
  return requireCapability(capability, async (req, res, ctx) => {
    const department = ctx.record && ctx.record.department
      ? await repo.getById('departments', ctx.record.department, { chapterId: ctx.staff.chapterId })
      : null;
    if (!department) {
      return res.status(400).json({ error: 'Your Chapter Coordinator has not attached a department to your office yet — ask them to set it, and this section will open up.' });
    }
    return await handler(req, res, department, ctx.staff);
  });
}

app.get('/api/executive/department', requireRole('executive'), requireOwnDepartment(CAP.DEPARTMENT, async (req, res, department, staff) => {
  const [members, meetings] = await Promise.all([
    repo.getAll('members', departmentMemberFilter(staff.chapterId, department.id)),
    repo.getAll('departmentMeetings', { chapterId: staff.chapterId, departmentId: department.id })
  ]);
  const recent = [...meetings].sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;
  res.json({
    department,
    memberCount: members.length,
    meetingCount: meetings.length,
    lastMeeting: recent ? { date: recent.date, topic: recent.topic, present: (recent.attendeeMemberIds || []).length } : null
  });
}));

app.put('/api/executive/department', requireRole('executive'), requireOwnDepartment(CAP.DEPARTMENT, async (req, res, department, staff) => {
  // Name stays out: renaming a department is a chapter-level decision, and
  // its id is referenced by members and executives alike.
  const next = { ...department };
  ['tagline', 'description', 'meetingDay', 'meetingTime', 'meetingLocation'].forEach((key) => {
    if (hasOwn(req.body, key)) next[key] = cleanText(req.body[key]);
  });
  const updated = await repo.updateById('departments', department.id, next, { chapterId: staff.chapterId });
  res.json({ success: true, item: updated });
}));

app.get('/api/executive/department/members', requireRole('executive'), requireOwnDepartment(CAP.DEPARTMENT_MEMBERS, async (req, res, department, staff) => {
  const members = await repo.getAll('members', departmentMemberFilter(staff.chapterId, department.id));
  res.json(members
    .map(m => ({
      id: m.id, name: m.name, email: m.email, phone: m.phone || '',
      level: m.level || '', programme: m.programme || '', membershipStage: m.membershipStage
    }))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))));
}));

// Who has asked to serve here, and the head's decision on each. Sits behind
// DEPARTMENT_MEMBERS: deciding a roster is the same authority as seeing one.
app.get('/api/executive/department/requests', requireRole('executive'), requireOwnDepartment(CAP.DEPARTMENT_MEMBERS, async (req, res, department, staff) => {
  const requests = await repo.getAll('departmentRequests', {
    chapterId: staff.chapterId, departmentId: department.id, status: 'pending'
  });
  const items = await Promise.all(requests.map(async (r) => {
    const m = await repo.getById('members', r.memberId, { chapterId: staff.chapterId });
    return {
      id: r.id,
      memberId: r.memberId,
      name: m ? (m.name || 'Member') : 'Member (account removed)',
      level: m ? (m.level || '') : '',
      programme: m ? (m.programme || '') : '',
      profileImageFileId: m ? (m.profileImageFileId || '') : '',
      note: r.note || '',
      createdAt: r.createdAt
    };
  }));
  res.json(items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
}));

app.post('/api/executive/department/requests/:id/decide', requireRole('executive'), requireOwnDepartment(CAP.DEPARTMENT_MEMBERS, async (req, res, department, staff) => {
  const decision = String(req.body.decision || '').toLowerCase();
  if (decision !== 'approved' && decision !== 'declined') {
    return res.status(400).json({ error: 'A request is either approved or declined.' });
  }
  // Scoped to this head's own department as well as their chapter, so one
  // department's head can never decide another's roster.
  const request = await repo.getById('departmentRequests', req.params.id, {
    chapterId: staff.chapterId, departmentId: department.id
  });
  if (!request) return res.status(404).json({ error: 'That request is not one of yours to decide.' });
  if (request.status !== 'pending') {
    return res.status(400).json({ error: 'That request has already been decided.' });
  }

  const member = await repo.getById('members', request.memberId, { chapterId: staff.chapterId });
  if (!member) return res.status(404).json({ error: 'That member no longer has an account.' });

  await repo.patchById('departmentRequests', request.id, {
    status: decision,
    decidedByStaffId: staff.id || '',
    decidedByName: staff.name || '',
    decidedAt: new Date()
  }, { chapterId: staff.chapterId });

  if (decision === 'approved') {
    // Added to what they already serve in rather than replacing it — joining
    // the Choir does not take someone out of Ushering.
    await setMemberDepartments(member.id, [...memberDepartmentIds(member), department.id]);
    createNotification(
      `You're in: ${department.name}`,
      `${staff.name || 'The department head'} accepted your request to serve in ${department.name}.`,
      '/profile.html', 'department', staff.chapterId,
      { departmentId: department.id, memberIds: [member.id] }
    ).catch(() => {});
  } else {
    // Not a feed entry: the only audience a departmental notice has is the
    // department, and someone who was declined is not in it. Sent to them
    // directly instead, so it reaches the one person it concerns.
    push.sendPushToAll(
      {
        title: `About ${department.name}`,
        body: `Your request to serve in ${department.name} was not taken up this time. Your department head can tell you more.`,
        url: '/departments.html'
      },
      staff.chapterId,
      [member.id]
    ).catch(() => {});
  }

  res.json({ success: true, decision });
}));

app.get('/api/executive/department/meetings', requireRole('executive'), requireOwnDepartment(CAP.DEPARTMENT_ATTENDANCE, async (req, res, department, staff) => {
  const meetings = await repo.getAll('departmentMeetings', { chapterId: staff.chapterId, departmentId: department.id });
  res.json(meetings.sort((a, b) => (a.date < b.date ? 1 : -1)));
}));

// Mobile-first register: open, tap whoever is present, save. Attendance is
// confined to this department's own members, so a mistyped or guessed id
// can't pull someone else's record into the count.
app.post('/api/executive/department/meetings', requireRole('executive'), requireOwnDepartment(CAP.DEPARTMENT_ATTENDANCE, async (req, res, department, staff) => {
  const members = await repo.getAll('members', departmentMemberFilter(staff.chapterId, department.id));
  const ownIds = new Set(members.map(m => m.id));
  const attendeeMemberIds = Array.isArray(req.body.attendeeMemberIds)
    ? req.body.attendeeMemberIds.filter(id => ownIds.has(id))
    : [];
  const item = await repo.create('departmentMeetings', {
    chapterId: staff.chapterId,
    departmentId: department.id,
    date: req.body.date || new Date().toISOString().slice(0, 10),
    topic: cleanText(req.body.topic || ''),
    location: cleanText(req.body.location || department.meetingLocation || ''),
    attendeeMemberIds,
    notes: cleanText(req.body.notes || ''),
    recordedBy: actorName(req)
  }, 'dmeet');
  res.json({ success: true, item });
}));

// An announcement to this department's own members, not the whole chapter —
// chapter-wide announcements stay with the Coordinator and Publicity.
app.post('/api/executive/department/announcement', requireRole('executive'), requireOwnDepartment(CAP.ANNOUNCE_DEPARTMENT, async (req, res, department, staff) => {
  const title = cleanText(req.body.title || '');
  const body = cleanText(req.body.body || '');
  if (!title || !body) return res.status(400).json({ error: 'A title and message are required' });
  const members = await repo.getAll('members', departmentMemberFilter(staff.chapterId, department.id));
  const item = await createNotification(
    `${department.name}: ${title}`, body, '/department.html?id=' + department.id, 'department', staff.chapterId,
    { departmentId: department.id, memberIds: members.map(m => m.id) }
  );
  res.json({ success: true, item, reached: members.length });
}));

// ---------- chapter-wide screens, for the elected officers ----------
// A President or Secretary answers for the whole chapter, so these read
// across every department rather than one. Each is gated by the capability
// its position grants (lib/positions.js): the Financial Secretary reaches the
// books summary and nothing else, the Organiser reaches events and
// attendance, and so on.

app.get('/api/executive/chapter/pulse', requireRole('executive'), requireCapability(CAP.CHAPTER_PULSE, async (req, res, { staff }) => {
  const filter = { chapterId: staff.chapterId };
  const [members, departments, events, execs] = await Promise.all([
    repo.getAll('members', filter),
    repo.getAll('departments', filter),
    repo.getAll('events', filter),
    repo.getAll('executives', filter)
  ]);
  const byStage = members.reduce((acc, m) => {
    const stage = m.membershipStage || 'visitor';
    acc[stage] = (acc[stage] || 0) + 1;
    return acc;
  }, {});
  const today = new Date().toISOString().slice(0, 10);
  res.json({
    memberCount: members.length,
    byStage,
    departmentCount: departments.length,
    executiveCount: execs.length,
    upcomingEvents: events
      .filter(e => e.status === 'published' && e.date >= today)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .slice(0, 5)
      .map(e => ({ id: e.id, title: e.title, date: e.date, location: e.location || '' })),
    pendingEvents: events.filter(e => e.status === 'submitted').length
  });
}));

app.get('/api/executive/chapter/members', requireRole('executive'), requireCapability(CAP.CHAPTER_MEMBERS, async (req, res, { staff }) => {
  const members = await repo.getAll('members', { chapterId: staff.chapterId });
  const departments = await repo.getAll('departments', { chapterId: staff.chapterId });
  const deptName = new Map(departments.map(d => [d.id, d.name]));
  // A directory for running the chapter, not a data export: contact details
  // and stage, never password hashes, reset tokens or QR tokens.
  res.json(members
    .map(m => ({
      id: m.id, name: m.name, email: m.email, phone: m.phone || '',
      level: m.level || '', programme: m.programme || '',
      department: deptName.get(m.department) || '',
      membershipStage: m.membershipStage || 'visitor'
    }))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))));
}));

app.get('/api/executive/chapter/departments', requireRole('executive'), requireCapability(CAP.CHAPTER_DEPARTMENTS, async (req, res, { staff }) => {
  const filter = { chapterId: staff.chapterId };
  const [departments, members, execs] = await Promise.all([
    repo.getAll('departments', filter),
    repo.getAll('members', filter),
    repo.getAll('executives', filter)
  ]);
  // A department can have a head and an assistant head; the head is the one
  // named, so assistants never displace them in this view.
  const headByDept = new Map();
  execs.filter(e => e.department).forEach(e => {
    const position = positions.resolvePosition(e.positionKey, e.role, true);
    const existing = headByDept.get(e.department);
    if (!existing || (existing.deputyOf && !position.deputyOf)) {
      headByDept.set(e.department, { ...e, deputyOf: position.deputyOf || '', reportsTo: position.reportsTo || '' });
    }
  });
  const countByDept = members.reduce((acc, m) => {
    if (m.department) acc.set(m.department, (acc.get(m.department) || 0) + 1);
    return acc;
  }, new Map());
  res.json(departments
    .map(d => {
      const head = headByDept.get(d.id);
      const reportsTo = head && head.reportsTo ? positions.positionByKey(head.reportsTo) : null;
      return {
        id: d.id, name: d.name, tagline: d.tagline || '',
        meetingDay: d.meetingDay || '', meetingTime: d.meetingTime || '',
        memberCount: countByDept.get(d.id) || 0,
        headName: head ? head.name : '',
        headRole: head ? head.role : '',
        // Which officer this department answers to, where ACONSU has said so.
        reportsTo: reportsTo ? reportsTo.label : ''
      };
    })
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))));
}));

// ---------- minutes of the executive meetings ----------
app.get('/api/executive/minutes', requireRole('executive'), requireCapability(CAP.MINUTES, async (req, res, { staff }) => {
  const items = await repo.getAll('executiveMinutes', { chapterId: staff.chapterId });
  res.json(items.sort((a, b) => (a.date < b.date ? 1 : -1)));
}));

app.post('/api/executive/minutes', requireRole('executive'), requireCapability(CAP.MINUTES, async (req, res, { staff }) => {
  const date = String(req.body.date || '').trim() || new Date().toISOString().slice(0, 10);
  const title = cleanText(req.body.title || '');
  const body = cleanText(req.body.body || '');
  if (!body) return res.status(400).json({ error: 'Minutes need a body — what was discussed.' });
  // Attendance is confined to this chapter's own executives, so a mistyped or
  // guessed id can never put someone else in the room.
  const execs = await repo.getAll('executives', { chapterId: staff.chapterId });
  const byId = new Map(execs.map(e => [e.id, e]));
  const presentExecutiveIds = Array.isArray(req.body.presentExecutiveIds)
    ? req.body.presentExecutiveIds.filter(id => byId.has(id))
    : [];
  const item = await repo.create('executiveMinutes', {
    chapterId: staff.chapterId,
    date, title, body,
    presentExecutiveIds,
    presentNames: presentExecutiveIds.map(id => byId.get(id).name || ''),
    apologies: cleanText(req.body.apologies || ''),
    decisions: cleanText(req.body.decisions || ''),
    status: 'draft',
    recordedBy: actorName(req)
  }, 'emin');
  res.json({ success: true, item });
}));

// Adopting minutes is what turns a draft into the record, so it is kept to
// the officers who chair the meeting rather than everyone who can write them.
app.patch('/api/executive/minutes/:id/adopt', requireRole('executive'), requireCapability(CAP.MINUTES, async (req, res, { staff, position }) => {
  if (!['president', 'vice_president', 'secretary'].includes(position.key)) {
    return res.status(403).json({ error: 'Only the President, Vice President or Secretary can adopt minutes.' });
  }
  const existing = await repo.getById('executiveMinutes', req.params.id, { chapterId: staff.chapterId });
  if (!existing) return res.status(404).json({ error: 'Those minutes were not found.' });
  const item = await repo.patchById('executiveMinutes', existing.id, {
    status: 'adopted', adoptedBy: actorName(req), adoptedAt: new Date()
  }, { chapterId: staff.chapterId });
  res.json({ success: true, item });
}));

// ---------- chapter attendance (Secretary, Assistant Secretary, Organiser) ----------
app.get('/api/executive/chapter/attendance', requireRole('executive'), requireCapability(CAP.ATTENDANCE_CHAPTER, async (req, res, { staff }) => {
  const records = await repo.getAll('attendanceRecords', { chapterId: staff.chapterId });
  res.json(records
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 50)
    .map(r => ({
      id: r.id, date: r.date, serviceType: r.serviceType, title: r.title || '',
      present: (r.marks || []).filter(m => m.status === 'present').length,
      total: (r.marks || []).length,
      visitorCount: r.visitorCount || 0
    })));
}));

// ---------- books summary (Financial Secretary, President) ----------
// Read-only by design: recording money stays with the Finance portal, so the
// elected officer can answer for the books without being able to edit them.
app.get('/api/executive/chapter/finance', requireRole('executive'), requireCapability(CAP.FINANCE_SUMMARY, async (req, res, { staff }) => {
  const entries = await repo.getAll('financeEntries', { chapterId: staff.chapterId });
  const income = entries.filter(e => e.entryType === 'income');
  const expense = entries.filter(e => e.entryType === 'expense');
  const sum = list => list.reduce((t, e) => t + (Number(e.amount) || 0), 0);
  const byCategory = income.reduce((acc, e) => {
    acc[e.category || 'other'] = (acc[e.category || 'other'] || 0) + (Number(e.amount) || 0);
    return acc;
  }, {});
  res.json({
    totalIncome: sum(income),
    totalExpense: sum(expense),
    balance: sum(income) - sum(expense),
    incomeByCategory: byCategory,
    entryCount: entries.length,
    pendingApprovals: expense.filter(e => e.approvalStatus === 'pending').length
  });
}));

// ---------- the daily verse (Bible Studies Coordinator) ----------
app.get('/api/executive/daily-verses', requireRole('executive'), requireCapability(CAP.DAILY_VERSE, async (req, res, { staff }) => {
  const items = await repo.getAll('dailyVerses', { chapterId: staff.chapterId });
  res.json(items.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 60));
}));

app.post('/api/executive/daily-verses', requireRole('executive'), requireCapability(CAP.DAILY_VERSE, async (req, res, { staff }) => {
  const date = String(req.body.date || '').trim() || new Date().toISOString().slice(0, 10);
  const reference = cleanText(req.body.reference || '');
  if (!reference) return res.status(400).json({ error: 'A scripture reference is required.' });
  const fields = {
    chapterId: staff.chapterId, date, reference,
    text: cleanText(req.body.text || ''),
    reflection: cleanText(req.body.reflection || ''),
    postedBy: actorName(req)
  };
  // One verse per chapter per day: posting again for a date replaces it,
  // rather than leaving two and no way to say which one is today's.
  const existing = await models.DailyVerse.findOne({ chapterId: staff.chapterId, date }).lean();
  const item = existing
    ? await repo.updateById('dailyVerses', existing.id, { ...existing, ...fields }, { chapterId: staff.chapterId })
    : await repo.create('dailyVerses', fields, 'verse');
  res.json({ success: true, item, replaced: !!existing });
}));

app.delete('/api/executive/daily-verses/:id', requireRole('executive'), requireCapability(CAP.DAILY_VERSE, async (req, res, { staff }) => {
  const removed = await repo.removeById('dailyVerses', req.params.id, { chapterId: staff.chapterId });
  if (!removed) return res.status(404).json({ error: 'That verse was not found.' });
  res.json({ success: true });
}));

// Today's verse, for the app. Public on purpose — it is scripture, and the
// home screen shows it before anyone signs in.
app.get('/api/daily-verse', async (req, res) => {
  try {
    const filter = contentChapterFilter(req);
    const today = new Date().toISOString().slice(0, 10);
    const items = await repo.getAll('dailyVerses', filter);
    // Today's if there is one, otherwise the most recent before today, so the
    // screen is never blank because nobody posted this morning.
    const past = items.filter(v => v.date <= today).sort((a, b) => (a.date < b.date ? 1 : -1));
    res.json({ item: past[0] || null });
  } catch (e) {
    res.status(500).json({ error: 'Could not load the daily verse' });
  }
});

// ---------- the money: Treasurer files, Financial Secretary records ----------
// ACONSU splits the money two ways on purpose. The Treasurer holds and
// disburses it and must account for every movement with evidence attached;
// the Financial Secretary keeps the books and is the only executive who
// writes to them. So a Treasurer's filing lands as 'pending' and stays there
// until the Financial Secretary records it — the person holding the funds is
// never the person who records them.

app.post('/api/executive/treasury/report', requireRole('executive'), upload.single('receipt'), requireCapability(CAP.TREASURY_REPORT, async (req, res, { staff }) => {
  const entryType = req.body.entryType === 'expense' ? 'expense' : (req.body.entryType === 'income' ? 'income' : null);
  if (!entryType) return res.status(400).json({ error: 'Say whether this was money received or money spent.' });
  const amount = Number(req.body.amount);
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });
  const category = cleanText(req.body.category || '');
  if (!category) return res.status(400).json({ error: 'A category is required' });
  if (entryType === 'income' && !INCOME_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Invalid income category' });
  }
  // Evidence is the point of this route, so it is required rather than
  // optional: an unevidenced filing is exactly what this split prevents.
  if (!req.file) return res.status(400).json({ error: 'Attach the receipt, transfer screenshot or other evidence — a filing without evidence cannot be recorded.' });
  const compressed = await compressIfImage(req.file.buffer, req.file.mimetype);
  const receiptFileId = String(await gridfs.uploadBuffer(compressed.buffer, req.file.originalname, {
    category: 'receipt', placement: 'treasury', contentType: compressed.contentType,
    title: `${category} — ${amount}`, chapterId: staff.chapterId
  }));
  const item = await repo.create('financeEntries', {
    chapterId: staff.chapterId,
    entryType, category, amount,
    date: req.body.date || new Date().toISOString().slice(0, 10),
    description: cleanText(req.body.description || ''),
    method: ['cash', 'momo', 'bank', 'cheque', 'other'].includes(req.body.method) ? req.body.method : 'cash',
    reference: cleanText(req.body.reference || ''),
    payee: cleanText(req.body.payee || ''),
    receiptFileId,
    source: 'treasury',
    filedBy: staff.name || '',
    approvalStatus: 'pending',
    recordedBy: ''
  }, 'fin');
  res.json({ success: true, item });
}));

// What the Treasurer filed, and what became of it.
app.get('/api/executive/treasury/reports', requireRole('executive'), requireCapability(CAP.TREASURY_REPORT, async (req, res, { staff }) => {
  const entries = await repo.getAll('financeEntries', { chapterId: staff.chapterId, source: 'treasury' });
  res.json(entries
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map(e => ({
      id: e.id, date: e.date, entryType: e.entryType, category: e.category,
      amount: e.amount, description: e.description || '',
      approvalStatus: e.approvalStatus, reviewNote: e.reviewNote || '',
      receiptFileId: e.receiptFileId || '', recordedBy: e.recordedBy || ''
    })));
}));

// The Financial Secretary's books.
app.get('/api/executive/finance/ledger', requireRole('executive'), requireCapability(CAP.FINANCE_LEDGER, async (req, res, { staff }) => {
  const entries = await repo.getAll('financeEntries', { chapterId: staff.chapterId });
  const shape = e => ({
    id: e.id, date: e.date, entryType: e.entryType, category: e.category,
    amount: e.amount, description: e.description || '', method: e.method || '',
    reference: e.reference || '', payee: e.payee || '',
    approvalStatus: e.approvalStatus, source: e.source || 'finance',
    filedBy: e.filedBy || '', recordedBy: e.recordedBy || '',
    reviewNote: e.reviewNote || '', receiptFileId: e.receiptFileId || ''
  });
  const byDate = (a, b) => (a.date < b.date ? 1 : -1);
  res.json({
    // What is waiting on them, first — this is the queue they work.
    awaiting: entries.filter(e => e.source === 'treasury' && e.approvalStatus === 'pending').sort(byDate).map(shape),
    ledger: entries.filter(e => e.approvalStatus !== 'pending').sort(byDate).slice(0, 100).map(shape)
  });
}));

app.patch('/api/executive/finance/ledger/:id', requireRole('executive'), requireCapability(CAP.FINANCE_LEDGER, async (req, res, { staff }) => {
  const decision = req.body && req.body.decision;
  if (!['record', 'reject'].includes(decision)) {
    return res.status(400).json({ error: 'Decision must be record or reject.' });
  }
  const filter = { chapterId: staff.chapterId };
  const existing = await repo.getById('financeEntries', req.params.id, filter);
  if (!existing) return res.status(404).json({ error: 'That filing was not found.' });
  if (existing.approvalStatus !== 'pending') {
    return res.status(400).json({ error: 'That filing has already been dealt with.' });
  }
  const note = cleanText((req.body && req.body.reviewNote) || '');
  if (decision === 'reject' && !note) {
    return res.status(400).json({ error: 'Say why you are sending this back, so the Treasurer can correct it.' });
  }
  const item = await repo.patchById('financeEntries', existing.id, decision === 'record'
    ? { approvalStatus: 'recorded', recordedBy: actorName(req), reviewNote: '' }
    : { approvalStatus: 'rejected', reviewNote: note }, filter);
  res.json({ success: true, item });
}));

// The Financial Secretary keeps the books, so they can also enter something
// directly rather than only reviewing what the Treasurer files.
app.post('/api/executive/finance/ledger', requireRole('executive'), requireCapability(CAP.FINANCE_LEDGER, async (req, res, { staff }) => {
  const entryType = req.body.entryType === 'expense' ? 'expense' : (req.body.entryType === 'income' ? 'income' : null);
  if (!entryType) return res.status(400).json({ error: 'Say whether this is income or an expense.' });
  const amount = Number(req.body.amount);
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });
  const category = cleanText(req.body.category || '');
  if (!category) return res.status(400).json({ error: 'A category is required' });
  if (entryType === 'income' && !INCOME_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Invalid income category' });
  }
  const item = await repo.create('financeEntries', {
    chapterId: staff.chapterId,
    entryType, category, amount,
    date: req.body.date || new Date().toISOString().slice(0, 10),
    description: cleanText(req.body.description || ''),
    method: ['cash', 'momo', 'bank', 'cheque', 'other'].includes(req.body.method) ? req.body.method : 'cash',
    reference: cleanText(req.body.reference || ''),
    payee: cleanText(req.body.payee || ''),
    source: 'finance',
    approvalStatus: 'recorded',
    recordedBy: actorName(req)
  }, 'fin');
  res.json({ success: true, item });
}));

// ---------- a chapter-wide announcement (President, Secretary) ----------
app.post('/api/executive/chapter/announcement', requireRole('executive'), requireCapability(CAP.ANNOUNCE_CHAPTER, async (req, res, { staff }) => {
  const title = cleanText(req.body.title || '');
  const body = cleanText(req.body.body || '');
  if (!title || !body) return res.status(400).json({ error: 'A title and message are required' });
  const members = await repo.getAll('members', { chapterId: staff.chapterId });
  const item = await createNotification(title, body, '/index.html', 'executive', staff.chapterId);
  res.json({ success: true, item, reached: members.length });
}));

// ---------- council: roster, meeting, discussion ----------

// Who sits on the council, built from the accounts that actually hold those
// offices rather than a typed list that would drift the moment anyone changed.
async function buildCouncilRoster() {
  const [staff, chapters, executives] = await Promise.all([
    models.StaffUser.find({ active: { $ne: false } }).lean(),
    repo.getAll('chapters', {}),
    repo.getAll('executives', {})
  ]);
  const chapterName = new Map(chapters.map(c => [c.id, c.name]));
  const seats = [];

  staff.forEach((u) => {
    let seat = null;
    if (u.role === 'nationalCoordinator') seat = 'National Coordinator';
    else if (u.role === 'coordinator') seat = 'Chapter Coordinator';
    else if (u.role === 'patron') seat = u.chapterId ? 'Chapter Patron' : 'National Patron';
    if (seat) {
      seats.push({ name: u.name || u.username, seat, chapterId: u.chapterId || '', chapterName: chapterName.get(u.chapterId) || '' });
    }
  });

  // Chapter Presidents sit by virtue of their position, so they are read from
  // the roster cards rather than from the account's role.
  executives.forEach((e) => {
    const position = positions.resolvePosition(e.positionKey, e.role, !!e.department);
    if (position.key === 'president') {
      seats.push({ name: e.name || '', seat: 'Chapter President', chapterId: e.chapterId || '', chapterName: chapterName.get(e.chapterId) || '', imageFileId: e.imageFileId || '' });
    }
  });

  const rank = { 'National Coordinator': 1, 'National Patron': 2, 'Chapter Patron': 3, 'Chapter Coordinator': 4, 'Chapter President': 5 };
  return seats.sort((a, b) => (rank[a.seat] || 9) - (rank[b.seat] || 9)
    || String(a.chapterName).localeCompare(String(b.chapterName))
    || String(a.name).localeCompare(String(b.name)));
}

app.get('/api/council', requireCouncil, async (req, res) => {
  try {
    const [settings, posts, roster] = await Promise.all([
      repo.getSettings(),
      repo.getAll('councilPosts', {}),
      buildCouncilRoster()
    ]);
    const council = (settings && settings.council) || {};
    const byNewest = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
    const replies = posts.filter(p => p.parentId);
    const threads = posts
      .filter(p => !p.parentId)
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || byNewest(a, b))
      .map(p => ({
        ...p,
        replies: replies
          .filter(r => r.parentId === p.id)
          .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      }));
    res.json({
      seat: councilSeat(req),
      isChair: rolesLib.getActingScope(req).isNational,
      meeting: {
        url: council.meetingUrl || '',
        label: council.meetingLabel || '',
        at: council.meetingAt || '',
        notice: council.notice || ''
      },
      roster,
      threads
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not load the council right now.' });
  }
});

app.put('/api/council/meeting', requireCouncil, requireCouncilChair, async (req, res) => {
  try {
    const url = cleanText(req.body.meetingUrl || '');
    // A meeting link is something council members will click, so only real
    // http(s) links are accepted — never a javascript: or data: URL typed in.
    if (url && !/^https:\/\/[^\s]+$/i.test(url)) {
      return res.status(400).json({ error: 'The meeting link must be a full https:// address.' });
    }
    const settings = await repo.getSettings();
    const saved = await repo.setSettings({
      ...settings,
      council: {
        meetingUrl: url,
        meetingLabel: cleanText(req.body.meetingLabel || ''),
        meetingAt: cleanText(req.body.meetingAt || ''),
        notice: cleanText(req.body.notice || '')
      }
    });
    res.json({ success: true, meeting: (saved && saved.council) || {} });
  } catch (e) {
    res.status(500).json({ error: 'Could not save the council meeting.' });
  }
});

app.post('/api/council/posts', requireCouncil, async (req, res) => {
  try {
    const body = cleanText(req.body.body || '');
    if (!body) return res.status(400).json({ error: 'Say something before posting.' });

    // A reply must attach to a real top-level post, and replies never nest.
    let parentId = String(req.body.parentId || '').trim();
    if (parentId) {
      const parent = await repo.getById('councilPosts', parentId);
      if (!parent) return res.status(400).json({ error: 'That discussion no longer exists.' });
      if (parent.parentId) parentId = parent.parentId; // keep threads one level deep
    }

    const staff = currentStaff(req) || {};
    const chapterId = staff.chapterId || '';
    const chapter = chapterId ? await repo.getById('chapters', chapterId) : null;
    const item = await repo.create('councilPosts', {
      parentId,
      body,
      authorStaffId: staff.id || '',
      authorName: actorName(req),
      authorRole: councilSeat(req) || '',
      authorChapterId: chapterId,
      authorChapterName: chapter ? chapter.name : ''
    }, 'cpost');
    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ error: 'Could not post that.' });
  }
});

// Anyone may retract their own words; the chair may remove anything, since
// they answer for the council.
app.delete('/api/council/posts/:id', requireCouncil, async (req, res) => {
  try {
    const post = await repo.getById('councilPosts', req.params.id);
    if (!post) return res.status(404).json({ error: 'That post was not found.' });
    const staff = currentStaff(req) || {};
    const isChair = rolesLib.getActingScope(req).isNational;
    if (!isChair && post.authorStaffId !== staff.id) {
      return res.status(403).json({ error: 'You can only remove your own posts.' });
    }
    await repo.removeById('councilPosts', post.id);
    // A thread's replies go with it, rather than being left orphaned.
    if (!post.parentId) {
      const replies = await repo.getAll('councilPosts', { parentId: post.id });
      await Promise.all(replies.map(r => repo.removeById('councilPosts', r.id)));
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not remove that post.' });
  }
});

app.patch('/api/council/posts/:id/pin', requireCouncil, requireCouncilChair, async (req, res) => {
  try {
    const post = await repo.getById('councilPosts', req.params.id);
    if (!post) return res.status(404).json({ error: 'That post was not found.' });
    if (post.parentId) return res.status(400).json({ error: 'Only a discussion can be pinned, not a reply.' });
    const item = await repo.patchById('councilPosts', post.id, { pinned: !post.pinned });
    res.json({ success: true, item });
  } catch (e) {
    res.status(500).json({ error: 'Could not pin that.' });
  }
});

// The council roster, public. These are the union's national executives and
// belong on the global app whether or not anyone is signed in.
app.get('/api/national/executives', async (req, res) => {
  try {
    res.json(await buildCouncilRoster());
  } catch (e) {
    res.status(500).json({ error: 'Could not load the national executives' });
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
        awaitingReview: members.filter(m => ['visitor', 'under_review', 'accepted'].includes(m.membershipStage)).length,
        acceptedNotYetActive: members.filter(m => m.membershipStage === 'accepted').length,
        activeMembers: members.filter(m => isActivatedMember(m)).length
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
      // Marked an Executive by Shepherding, still with no account of their
      // own. Counted from rows already read rather than asked for again.
      awaitingAppointment: members.filter(
        (m) => m.membershipStage === 'executive'
          && !staff.some((u) => u.memberId && u.memberId === m.id)
      ).length,
      generatedAt: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not load the coordinator dashboard' });
  }
});

// Who Shepherding has marked an Executive and who is still waiting on the
// Coordinator to give them a position and a login.
app.get('/api/coordinator/pending-executives', requireViewRole('coordinator'), async (req, res) => {
  try {
    const scope = rolesLib.getActingScope(req);
    if (scope.isNational && !scope.chapterId) {
      return res.status(400).json({ error: 'Pick a chapter to view (?chapterId=...).' });
    }
    res.json(await membersAwaitingAppointment(scope.chapterId));
  } catch (e) {
    res.status(500).json({ error: 'Could not load who is waiting for an account' });
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
    await refreshSoleActiveChapter();
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
    await refreshSoleActiveChapter();
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
// Offices a chapter needs staffed to run day to day (the "Staff chapter
// offices" row in GOVERNANCE_TIER_REVIEW.md's responsibility matrix) — a
// deliberately shorter list than every appointable role: executive is a
// whole elected body, per-person, not one office to fill.
const READINESS_OFFICE_ROLES = ['finance', 'shepherding', 'publicity', 'welfare'];

app.get('/api/national/dashboard', rolesLib.requireNational, async (req, res) => {
  try {
    const [chapters, members, events, financeEntries, attendance, shepherdingRecords, executives, staffUsers] = await Promise.all([
      repo.getAll('chapters'), repo.getAll('members'), repo.getAll('events'),
      repo.getAll('financeEntries'), repo.getAll('attendanceRecords'),
      repo.getAll('shepherdingRecords'), repo.getAll('executives'), repo.getAll('staffUsers')
    ]);
    const now = new Date();
    const byChapter = chapters.map((c) => {
      const chMembers = members.filter(m => m.chapterId === c.id);
      const chFinance = financeEntries.filter(f => f.chapterId === c.id);
      const chAttendance = attendance.filter(a => a.chapterId === c.id);
      const recent = [...chAttendance].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      // Chapter readiness rollup (Phase C, item 6) — a national oversight
      // signal that never opens the chapter's own records: who's appointed
      // and what's configured, not what anyone in the chapter is doing.
      const chStaff = staffUsers.filter(s => s.chapterId === c.id && s.active);
      const officesStaffed = Object.fromEntries(READINESS_OFFICE_ROLES.map(role => [role, chStaff.some(s => s.role === role)]));
      const lastStaffLoginAt = chStaff.reduce((latest, s) =>
        (s.lastLoginAt && (!latest || new Date(s.lastLoginAt) > new Date(latest))) ? s.lastLoginAt : latest, null);
      const lastActivityAt = [recent && recent.createdAt, lastStaffLoginAt]
        .filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null;
      return {
        id: c.id, name: c.name, status: c.status,
        memberCount: chMembers.filter(m => isActivatedMember(m)).length,
        visitorCount: chMembers.filter(m => ['visitor', 'under_review', 'accepted'].includes(m.membershipStage)).length
          + shepherdingRecords.filter(r => r.chapterId === c.id && !r.memberId).length,
        executiveCount: executives.filter(e => e.chapterId === c.id).length,
        upcomingEvents: events.filter(e => e.chapterId === c.id && new Date(`${e.date}T${e.time || '00:00'}:00`) >= now).length,
        lastServiceAttendance: recent ? recent.marks.filter(m => m.status === 'present').length + (recent.visitorCount || 0) : null,
        balance: financeTotals(chFinance).balance,
        readiness: {
          coordinatorAssigned: !!c.coordinatorStaffId,
          adminAppointed: chStaff.some(s => s.role === 'chapterAdmin'),
          officesStaffed,
          officesStaffedCount: READINESS_OFFICE_ROLES.filter(role => officesStaffed[role]).length,
          officesTotal: READINESS_OFFICE_ROLES.length,
          settingsComplete: !!(c.tagline && c.serviceTimes && c.serviceTimes.length
            && c.contact && (c.contact.phone || c.contact.email || c.contact.whatsapp)),
          lastActivityAt
        }
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
      activeMembers: members.filter(m => m.chapterId === chapter.id && isActivatedMember(m)).length,
      visitors: members.filter(m => m.chapterId === chapter.id && ['visitor', 'under_review', 'accepted'].includes(m.membershipStage)).length,
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
        activeMembers: chMembers.filter(m => isActivatedMember(m)).length,
        visitors: chMembers.filter(m => ['visitor', 'under_review', 'accepted'].includes(m.membershipStage)).length,
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
  // Promotion to the executive body is the Chapter Coordinator's call — a
  // Chapter Admin runs the chapter's operations, but doesn't elect its
  // officers.
  if (role === 'executive' && !isChapterCoordinatorOrAbove(req)) {
    return res.status(403).json({ error: 'Only the Chapter Coordinator can promote a member to the executive body.' });
  }

  // Whoever runs a chapter is a person in it, not a free-floating username.
  // Tying the account to a member means their own profile shows where they
  // stand, they carry a membership number, and an account cannot outlive the
  // person behind it unnoticed. National Coordinators and Patrons belong to
  // the union rather than to any one chapter, so they are the exception.
  const MEMBER_BACKED_ROLES = ['coordinator', 'chapterAdmin', 'finance', 'shepherding', 'publicity', 'welfare', 'executive'];
  // A National Patron belongs to the union rather than to any chapter, so they
  // are the one other account that legitimately has no chapterId. Saying so
  // takes the explicit NATIONAL_SCOPE token — the same deliberate statement a
  // national executive card takes — and only a national actor may make it.
  const wantsNationalPatron = role === 'patron'
    && String(req.body.chapterId || '') === rolesLib.NATIONAL_SCOPE;
  if (wantsNationalPatron && !scope.isNational) {
    return res.status(403).json({ error: 'Only the National Coordinator can appoint the National Patron.' });
  }

  // A chapter-scoped admin can only ever create accounts for their own
  // chapter, regardless of what the request body claims.
  const chapterId = (role === 'nationalCoordinator' || wantsNationalPatron)
    ? ''
    : await resolveChapterIdForWrite(req, req.body.chapterId);
  if (role !== 'nationalCoordinator' && !wantsNationalPatron && !chapterId) {
    return res.status(400).json({ error: 'A chapter is required for this role — this deployment now has more than one, please specify which.' });
  }
  // An executive is a promoted member, vetted by the Coordinator — so the
  // office is always attached to a real member record, never a free-floating
  // login. That link is what makes the one-year term and their own
  // appointment history mean anything.
  let memberId = '';
  let position = null;
  let executiveDepartment = '';
  let promotedMember = null;
  if (MEMBER_BACKED_ROLES.includes(role)) {
    memberId = String(req.body.memberId || '').trim();
    if (!memberId) return res.status(400).json({ error: 'Choose which member this account belongs to — every chapter leader is a member of the chapter first.' });
    // Scoped to the chapter, so an account here can never be pinned to
    // somebody else's member.
    promotedMember = await repo.getById('members', memberId, chapterId ? { chapterId } : undefined);
    if (!promotedMember) return res.status(400).json({ error: 'That member is not in this chapter.' });
  }
  if (role === 'executive') {

    // An executive without a position is an executive nothing can reason
    // about — no capabilities, no place on the roster. Both ways of creating
    // one (here, and approving an application) settle it up front.
    position = positions.positionByKey(req.body.positionKey);
    if (!position) return res.status(400).json({ error: 'Choose the position this executive is being given.' });
    executiveDepartment = String(req.body.department || '').trim();
    if (positions.requiresDepartment(position)) {
      if (!executiveDepartment) return res.status(400).json({ error: `A ${position.label} runs a department — choose which one.` });
      if (!await repo.getById('departments', executiveDepartment, { chapterId })) {
        return res.status(400).json({ error: 'That department is not in this chapter — pick one from the list.' });
      }
    } else if (executiveDepartment) {
      return res.status(400).json({ error: `A ${position.label} answers for the whole chapter, so they are not attached to a department.` });
    }
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
      username: clean, name: name || clean, role, chapterId, memberId,
      passwordHash: await bcrypt.hash(password, 10), active: true,
      ...(role === 'executive' ? { termYear: currentAcademicYearLabel(), termEndsAt: academicYearEndsAt() } : {})
    }, 'staff');
    // The public roster card is created here rather than waiting for the new
    // executive to find the profile form — the same one-action provisioning
    // the approval route does.
    if (role === 'executive' && position) {
      await repo.create('executives', {
        chapterId, staffId: user.id,
        name: user.name, role: position.label, positionKey: position.key,
        department: executiveDepartment, order: position.order,
        bio: '',
        contact: { phone: (promotedMember && promotedMember.phone) || '', email: (promotedMember && promotedMember.email) || '' },
        imageFileId: (promotedMember && promotedMember.profileImageFileId) || '',
        history: []
      }, 'exec');
      await repo.patchById('members', memberId, {
        isExecutive: true,
        executiveStatus: 'verified',
        executiveRole: position.label,
        executiveDepartment,
        executiveVerifiedAt: new Date()
      });
      // The appointment is the milestone, so it is logged here — at the moment
      // the office is granted — rather than whenever they first open the
      // profile form, which they might never do.
      await logMilestone({
        chapterId, memberId, memberName: user.name,
        type: 'executive_appointment', note: position.label, loggedBy: 'System'
      });
    }
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
    // Renewing an executive for the new academic year — re-election keeps the
    // same account, card and history rather than starting a person over.
    const isExecutive = (role || existing.role) === 'executive';
    const renewTerm = req.body.renewTerm === true && isExecutive;
    // Ending a term early: someone stepping down, or being stood down,
    // before the academic year is out.
    const endTerm = req.body.endTerm === true && isExecutive;
    const updated = await repo.updateById('staffUsers', req.params.id, {
      ...existing,
      name: name !== undefined ? name : existing.name,
      role: role || existing.role,
      active: active !== undefined ? !!active : existing.active,
      passwordHash: password ? await bcrypt.hash(password, 10) : existing.passwordHash,
      ...(renewTerm ? { termYear: currentAcademicYearLabel(), termEndsAt: academicYearEndsAt() } : {}),
      ...(endTerm ? { termEndsAt: new Date() } : {})
    });
    // Anything that takes authority away, or hands it to a different person,
    // has to reach the session they are using right now — not wait for them
    // to sign out. A rename is left alone: it changes nothing they can do.
    const authorityChanged = endTerm
      || (active !== undefined && !active)
      || (role && role !== existing.role)
      || !!password;
    if (authorityChanged) revokeStaffSessions(existing.id);
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
    // "Their sign-in stops working immediately" is what the confirmation
    // promises, so it has to be true of the session they hold right now.
    revokeStaffSessions(existing.id);
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


function rangeDays(beforeDays, afterDays = 0) {
  const now = new Date();
  const from = new Date(now);
  from.setDate(now.getDate() - beforeDays);
  const to = new Date(now);
  to.setDate(now.getDate() + afterDays);
  return { from, to, now };
}

function safeDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function inWindow(date, from, to) {
  if (!date) return false;
  return date >= from && date < to;
}

function trendSummary(current, previous) {
  const delta = current - previous;
  const direction = delta > 0 ? 'up' : (delta < 0 ? 'down' : 'flat');
  const percent = previous === 0 ? (current > 0 ? 100 : 0) : Math.round((delta / previous) * 100);
  return { current, previous, delta, percent, direction };
}

// Builds the operational dashboard payload for one chapter — shared by the
// plain GET (first paint) and the SSE stream below (every push after that),
// so there is exactly one place that computes the Rule-of-4 KPIs and the
// activity feed, not two copies that can drift.
async function buildChapterOverview(chapterId) {
    const filter = { chapterId };
    const [chapter, members, events, attendance, joinRequests, prayerRequests, contactMessages, shepherdingRecords, financeEntries, notifications] = await Promise.all([
      repo.getById('chapters', chapterId),
      repo.getAll('members', filter),
      repo.getAll('events', filter),
      repo.getAll('attendanceRecords', filter),
      repo.getAll('joinRequests', filter),
      repo.getAll('prayerRequests', filter),
      repo.getAll('contactMessages', filter),
      repo.getAll('shepherdingRecords', filter),
      repo.getAll('financeEntries', filter),
      repo.getAll('notifications', filter)
    ]);

    const now = new Date();
    const currentRange = rangeDays(7);
    const previousRange = { from: rangeDays(14).from, to: currentRange.from };
    const next30 = rangeDays(0, 30);
    const prev30 = rangeDays(30);

    const activeMembers = members.filter(m => isActivatedMember(m));
    const newActiveCurrent = activeMembers.filter(m => inWindow(safeDate(m.updatedAt || m.createdAt), currentRange.from, currentRange.to)).length;
    const newActivePrevious = activeMembers.filter(m => inWindow(safeDate(m.updatedAt || m.createdAt), previousRange.from, previousRange.to)).length;

    const pendingCareCount =
      joinRequests.filter(r => r.status === 'new').length +
      prayerRequests.filter(r => r.status === 'new').length +
      contactMessages.filter(m => m.status !== 'replied').length +
      shepherdingRecords.filter(r => ['irregular', 'inactive'].includes(r.attendanceStatus)).length;
    const pendingCareCurrent =
      joinRequests.filter(r => r.status === 'new' && inWindow(safeDate(r.createdAt), currentRange.from, currentRange.to)).length +
      prayerRequests.filter(r => r.status === 'new' && inWindow(safeDate(r.createdAt), currentRange.from, currentRange.to)).length +
      contactMessages.filter(m => m.status !== 'replied' && inWindow(safeDate(m.createdAt), currentRange.from, currentRange.to)).length;
    const pendingCarePrevious =
      joinRequests.filter(r => r.status === 'new' && inWindow(safeDate(r.createdAt), previousRange.from, previousRange.to)).length +
      prayerRequests.filter(r => r.status === 'new' && inWindow(safeDate(r.createdAt), previousRange.from, previousRange.to)).length +
      contactMessages.filter(m => m.status !== 'replied' && inWindow(safeDate(m.createdAt), previousRange.from, previousRange.to)).length;

    const attendanceRows = [...attendance].sort((a, b) => (a.date === b.date ? 0 : (a.date < b.date ? 1 : -1)));
    const turnout = (row) => row.marks.filter(m => m.status === 'present').length + (row.visitorCount || 0);
    const recentFour = attendanceRows.slice(0, 4);
    const previousFour = attendanceRows.slice(4, 8);
    const avg = (rows) => rows.length ? Math.round(rows.reduce((sum, row) => sum + turnout(row), 0) / rows.length) : 0;
    const avgAttendance = avg(recentFour);

    const eventAt = (e) => safeDate(`${e.date || ''}T${e.time || '00:00'}:00`);
    const upcoming30 = events.filter(e => inWindow(eventAt(e), next30.from, next30.to)).length;
    const previous30Count = events.filter(e => inWindow(eventAt(e), prev30.from, prev30.to)).length;

    const currentMonthKey = now.toISOString().slice(0, 7);
    const thisMonthEntries = financeEntries.filter(e => (e.date || '').startsWith(currentMonthKey));
    const monthNet = financeTotals(thisMonthEntries).balance;

    const pendingCareDrilldown = [
      ...joinRequests.filter(r => r.status === 'new').map(r => ({
        id: r.id, type: 'join_request', title: r.name || 'Join request', detail: r.phone || r.email || '', panel: 'joinRequests', at: r.createdAt
      })),
      ...prayerRequests.filter(r => r.status === 'new').map(r => ({
        id: r.id, type: 'prayer_request', title: r.title || r.name || 'Prayer request', detail: r.request || '', panel: 'prayerRequests', at: r.createdAt
      })),
      ...contactMessages.filter(m => m.status !== 'replied').map(m => ({
        id: m.id, type: 'contact_message', title: m.name || m.email || 'Contact message', detail: m.message || '', panel: 'contactMessages', at: m.createdAt
      }))
    ]
      .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
      .slice(0, 12);

    const activity = [
      ...joinRequests.map(r => ({
        id: r.id, type: 'join_request', label: 'New join request', title: r.name || 'Visitor', detail: r.phone || r.email || '', panel: 'joinRequests', at: r.createdAt
      })),
      ...prayerRequests.map(r => ({
        id: r.id, type: 'prayer_request', label: 'Prayer request submitted', title: r.name || 'Member', detail: r.request || '', panel: 'prayerRequests', at: r.createdAt
      })),
      ...contactMessages.map(m => ({
        id: m.id, type: 'contact_message', label: 'Contact message received', title: m.name || m.email || 'Visitor', detail: m.message || '', panel: 'contactMessages', at: m.createdAt
      })),
      ...attendance.map(a => ({
        id: a.id, type: 'attendance', label: 'Service attendance logged', title: `${a.serviceType || 'service'} — ${a.date || ''}`, detail: `${turnout(a)} present/visitors`, panel: 'overview', at: a.createdAt
      })),
      ...financeEntries.filter(e => e.approvalStatus === 'pending').map(e => ({
        id: e.id, type: 'finance_pending', label: 'Finance approval pending', title: `${e.entryType} ${e.category}`, detail: `GHS ${Number(e.amount || 0).toFixed(2)}`, panel: 'reports', at: e.createdAt
      })),
      ...notifications.map(n => ({
        id: n.id, type: 'announcement', label: 'Announcement posted', title: n.title || 'Notification', detail: n.body || '', panel: 'notifications', at: n.createdAt
      }))
    ]
      .filter(item => !!safeDate(item.at))
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .slice(0, 25);

    return {
      chapter: chapter ? { id: chapter.id, name: chapter.name } : { id: chapterId, name: chapterId },
      generatedAt: new Date().toISOString(),
      monthNet,
      kpis: [
        {
          key: 'active_members',
          label: 'Active Members',
          value: activeMembers.length,
          trend: trendSummary(newActiveCurrent, newActivePrevious),
          drilldownPanel: 'members',
          drilldown: activeMembers
            .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
            .slice(0, 12)
            .map(m => ({ id: m.id, name: m.name || 'Member', level: m.level || '', department: m.department || '', at: m.updatedAt || m.createdAt || null }))
        },
        {
          key: 'pending_care',
          label: 'Pending Care Cases',
          value: pendingCareCount,
          trend: trendSummary(pendingCareCurrent, pendingCarePrevious),
          drilldownPanel: 'joinRequests',
          drilldown: pendingCareDrilldown
        },
        {
          key: 'attendance_avg',
          label: 'Avg Attendance (Last 4 Services)',
          value: avgAttendance,
          trend: trendSummary(avgAttendance, avg(previousFour)),
          drilldownPanel: 'overview',
          drilldown: attendanceRows.slice(0, 8).map(row => ({ id: row.id, date: row.date, serviceType: row.serviceType, turnout: turnout(row) }))
        },
        {
          key: 'upcoming_events',
          label: 'Upcoming 30-Day Events',
          value: upcoming30,
          trend: trendSummary(upcoming30, previous30Count),
          drilldownPanel: 'events',
          drilldown: events
            .filter(e => inWindow(eventAt(e), next30.from, next30.to))
            .sort((a, b) => new Date(`${a.date || ''}T${a.time || '00:00'}:00`) - new Date(`${b.date || ''}T${b.time || '00:00'}:00`))
            .slice(0, 12)
            .map(e => ({ id: e.id, title: e.title || 'Event', date: e.date, time: e.time || '', location: e.location || '' }))
        }
      ],
      activity
    };
}

app.get('/api/admin/overview', requireChapterAdmin, async (req, res) => {
  try {
    const chapterId = await resolveChapterIdForWrite(req, req.query.chapterId);
    if (!chapterId) return res.status(400).json({ error: 'Pick a chapter to view this dashboard.' });
    res.json(await buildChapterOverview(chapterId));
  } catch (e) {
    res.status(500).json({ error: 'Could not load admin overview' });
  }
});

// Live push for the operational dashboard (Phase 2) — replaces the previous
// client-side poll. One SSE connection per open dashboard; the server pushes
// a freshly rebuilt overview whenever activityBus reports something in this
// chapter changed (see repo.create() in lib/repo.js), instead of the client
// re-fetching on a timer. Plain GET above still serves the first paint —
// this only carries updates after that.
app.get('/api/admin/overview/stream', requireChapterAdmin, async (req, res) => {
  const chapterId = await resolveChapterIdForWrite(req, req.query.chapterId);
  if (!chapterId) return res.status(400).json({ error: 'Pick a chapter to view this dashboard.' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no' // nginx/Render: don't buffer the stream away
  });
  res.write('retry: 5000\n\n');

  let closed = false;
  const push = async () => {
    if (closed) return;
    try {
      const overview = await buildChapterOverview(chapterId);
      res.write(`event: overview\ndata: ${JSON.stringify(overview)}\n\n`);
    } catch (e) {
      // A build failure shouldn't take the connection down — the next
      // activity event, or the client's own reconnect, tries again.
    }
  };
  const onActivity = (payload) => { if (payload.chapterId === chapterId) push(); };
  activityBus.on('activity', onActivity);

  // Comment-only ping so proxies/load balancers don't time out an otherwise
  // silent connection during a quiet chapter.
  const heartbeat = setInterval(() => { if (!closed) res.write(': ping\n\n'); }, 25000);

  req.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
    activityBus.off('activity', onActivity);
  });
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

// ---------- a chapter's own SMS credentials ----------
// Each chapter runs its own mNotify account, so the bill, the credit balance
// and the sender name members see are all theirs, and no chapter can spend or
// send on another's. Kept off the general chapter-settings route because the
// API key is a live secret with its own read rules.

// The key is never returned. A client needs to know whether one is set and
// roughly which it is, never the value — anyone who can open this screen could
// otherwise walk away with a credential that spends the chapter's money.
function maskedSmsConfig(chapter) {
  const sms = (chapter && chapter.sms) || {};
  const key = sms.apiKey || '';
  return {
    provider: sms.provider || 'mnotify',
    senderId: sms.senderId || '',
    hasApiKey: !!key,
    apiKeyHint: key ? `••••${key.slice(-4)}` : ''
  };
}

app.get('/api/admin/chapter-sms', requireChapterAdmin, async (req, res) => {
  try {
    const chapterId = await resolveChapterIdForWrite(req, req.query.chapterId);
    if (!chapterId) return res.status(400).json({ error: 'Choose which chapter to manage first.' });
    const chapter = await repo.getById('chapters', chapterId);
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });
    res.json({
      ...maskedSmsConfig(chapter),
      // Says whether this chapter can actually send right now, which is not
      // the same question as whether it has its own credentials: a single
      // shared server account may still be covering it.
      canSend: await sms.isConfigured(chapterId),
      usingSharedFallback: !(chapter.sms && chapter.sms.apiKey && chapter.sms.senderId)
        && await sms.isConfigured(chapterId)
    });
  } catch (e) {
    res.status(500).json({ error: 'Could not load this chapter\'s SMS setup' });
  }
});

app.put('/api/admin/chapter-sms', requireChapterAdmin, async (req, res) => {
  try {
    const chapterId = await resolveChapterIdForWrite(req, req.body.chapterId);
    if (!chapterId) return res.status(400).json({ error: 'Choose which chapter to manage first.' });
    const chapter = await repo.getById('chapters', chapterId);
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

    const senderId = cleanText(req.body.senderId || '');
    // mNotify registers sender IDs and rejects anything longer, so this is
    // caught here rather than as an opaque provider error after a failed send.
    if (senderId && senderId.length > 11) {
      return res.status(400).json({ error: 'A sender ID can be at most 11 characters — that is the provider\'s limit.' });
    }

    const existing = (chapter.sms && chapter.sms.apiKey) || '';
    // A blank key means "leave the stored one alone", so the form can be saved
    // to change only the sender ID without re-typing a secret it never sees.
    const submitted = String(req.body.apiKey || '').trim();
    const apiKey = submitted || existing;

    const updated = await repo.patchById('chapters', chapterId, {
      sms: { provider: 'mnotify', apiKey, senderId }
    });
    res.json({ success: true, ...maskedSmsConfig(updated), canSend: await sms.isConfigured(chapterId) });
  } catch (e) {
    res.status(500).json({ error: 'Could not save this chapter\'s SMS setup' });
  }
});

// Clearing credentials is its own action rather than saving a blank key, so
// "I did not want to retype it" can never silently wipe a working setup.
app.delete('/api/admin/chapter-sms', requireChapterAdmin, async (req, res) => {
  try {
    const chapterId = await resolveChapterIdForWrite(req, req.body && req.body.chapterId);
    if (!chapterId) return res.status(400).json({ error: 'Choose which chapter to manage first.' });
    const updated = await repo.patchById('chapters', chapterId, {
      sms: { provider: 'mnotify', apiKey: '', senderId: '' }
    });
    if (!updated) return res.status(404).json({ error: 'Chapter not found' });
    res.json({ success: true, ...maskedSmsConfig(updated) });
  } catch (e) {
    res.status(500).json({ error: 'Could not clear this chapter\'s SMS setup' });
  }
});

app.get('/api/admin/chapter-settings', requireChapterAdmin, async (req, res) => {
  try {
    const chapterId = await resolveChapterIdForWrite(req, req.query.chapterId);
    if (!chapterId) return res.status(400).json({ error: 'Choose which chapter to manage first.' });
    const chapter = await repo.getById('chapters', chapterId);
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });
    res.json(chapterSettingsResponse(chapter));
  } catch (e) {
    res.status(500).json({ error: 'Could not load chapter settings' });
  }
});

app.put('/api/admin/chapter-settings', requireChapterAdmin, async (req, res) => {
  try {
    const chapterId = await resolveChapterIdForWrite(req, req.body.chapterId || req.query.chapterId);
    if (!chapterId) return res.status(400).json({ error: 'Choose which chapter to manage first.' });
    const chapter = await repo.getById('chapters', chapterId);
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

    const next = { ...chapter };
    if (hasOwn(req.body, 'name')) next.name = cleanText(req.body.name);
    if (hasOwn(req.body, 'fullName')) next.fullName = cleanText(req.body.fullName);
    if (hasOwn(req.body, 'institution')) next.institution = cleanText(req.body.institution);
    if (hasOwn(req.body, 'location')) next.location = cleanText(req.body.location);
    if (hasOwn(req.body, 'address')) next.address = cleanText(req.body.address);
    if (hasOwn(req.body, 'tagline')) next.tagline = cleanText(req.body.tagline);
    if (hasOwn(req.body, 'verseOfTheWeek')) next.verseOfTheWeek = cleanText(req.body.verseOfTheWeek);
    if (hasOwn(req.body, 'serviceTimes')) next.serviceTimes = cleanStringList(req.body.serviceTimes);
    if (hasOwn(req.body, 'contact')) {
      next.contact = mergeTextFields(chapter.contact, req.body.contact, [
        'email', 'phone', 'whatsapp', 'facebook', 'instagram', 'youtube', 'tiktok', 'twitter', 'telegram'
      ]);
    }
    if (hasOwn(req.body, 'payment')) {
      next.payment = mergeTextFields(chapter.payment, req.body.payment, [
        'provider', 'momoNumber', 'momoName', 'bankName', 'bankAccountName', 'bankAccountNumber', 'donationDestination', 'welfareDestination'
      ]);
    }
    if (hasOwn(req.body, 'about')) {
      next.about = mergeTextFields(chapter.about, req.body.about, [
        'history', 'vision', 'mission', 'values', 'leadership'
      ]);
    }
    if (!next.name) return res.status(400).json({ error: 'Chapter display name is required' });

    const updated = await repo.updateById('chapters', chapter.id, next);
    res.json({ success: true, item: chapterSettingsResponse(updated) });
  } catch (e) {
    res.status(500).json({ error: 'Could not update chapter settings' });
  }
});

app.post('/api/admin/chapter-settings/banner', requireChapterAdmin, upload.single('image'), async (req, res) => {
  try {
    const chapterId = await resolveChapterIdForWrite(req, req.body.chapterId || req.query.chapterId);
    if (!chapterId) return res.status(400).json({ error: 'Choose which chapter to manage first.' });
    const chapter = await repo.getById('chapters', chapterId);
    if (!chapter) return res.status(404).json({ error: 'Chapter not found' });
    if (!req.file) return res.status(400).json({ error: 'Please choose a banner image to upload' });
    if (!req.file.mimetype || !req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ error: 'Only image files can be used as chapter banners' });
    }

    const compressed = await compressIfImage(req.file.buffer, req.file.mimetype);
    const fileId = await gridfs.uploadBuffer(compressed.buffer, req.file.originalname, {
      category: 'photo',
      placement: 'home-header',
      targetId: chapter.id,
      title: `${chapter.name || chapter.id} banner`,
      description: `Homepage hero banner for ${chapter.name || chapter.id}`,
      contentType: compressed.contentType,
      chapterId: chapter.id
    });

    if (chapter.homeHeaderImageFileId) gridfs.deleteFile(chapter.homeHeaderImageFileId).catch(() => {});
    const updated = await repo.patchById('chapters', chapter.id, { homeHeaderImageFileId: String(fileId) });
    res.json({ success: true, fileId: String(fileId), item: chapterSettingsResponse(updated) });
  } catch (e) {
    res.status(500).json({ error: 'Could not upload the chapter banner' });
  }
});

// National settings only — a chapter's own About/contact/payment info lives
// on its Chapter record instead (edited via the National/Chapter Coordinator
// portals), so this stays a National Coordinator action.
app.put('/api/admin/settings', rolesLib.requireNational, async (req, res) => {
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
  'page-hero': {
    label: 'Artwork for the top of a page',
    needsTarget: 'page-hero',
    describe: (name) => `Becomes the artwork behind the heading at the top of the ${name || 'selected'} page, replacing its built-in background.`
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

// The chapter whose artwork a content manager is editing. A Chapter Admin is
// pinned to their own; a national actor works on whichever they have selected.
async function heroArtChapter(req, explicitId) {
  const chapterId = await resolveChapterIdForWrite(req, explicitId);
  if (!chapterId) return null;
  return repo.getById('chapters', chapterId);
}

async function heroPageTargets(req) {
  const chapter = await heroArtChapter(req).catch(() => null);
  const current = sanitiseHeroArt(chapter && chapter.heroArt);
  return heroArt.HERO_PAGES.map((page) => ({
    id: page.key,
    name: page.label,
    scene: page.scene,
    sceneDescription: heroArt.SCENES[page.scene] || '',
    fileId: current[page.key] ? current[page.key].fileId : '',
    tone: current[page.key] ? current[page.key].tone : 'light'
  }));
}

// Take a chapter's artwork back off a page. The page returns to its built-in
// scene rather than to nothing, which is why this is a removal and not a
// requirement to upload something else.
app.delete('/api/admin/hero-art/:pageKey', requireContentManager, async (req, res) => {
  try {
    if (!heroArt.isHeroPage(req.params.pageKey)) return res.status(400).json({ error: 'Unknown page' });
    const chapter = await heroArtChapter(req, req.query.chapterId);
    if (!chapter) return res.status(400).json({ error: 'A chapter is required.' });
    const next = sanitiseHeroArt(chapter.heroArt);
    const removed = next[req.params.pageKey];
    if (!removed) return res.json({ success: true, heroArt: next });
    delete next[req.params.pageKey];
    gridfs.deleteFile(removed.fileId).catch(() => {});
    await repo.patchById('chapters', chapter.id, { heroArt: next });
    res.json({ success: true, heroArt: next });
  } catch (e) {
    res.status(500).json({ error: 'Could not remove this artwork' });
  }
});

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
      events: events.map(e => ({ id: e.id, name: e.title, hasFlyer: !!e.flyerFileId })),
      // Every page that carries a heading, and whether this chapter has
      // already dressed it, so the picker can say which are still built-in.
      heroPages: await heroPageTargets(req)
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
    } else if (placement === 'page-hero') {
      if (!heroArt.isHeroPage(targetId)) return res.status(400).json({ error: 'Choose which page this artwork belongs to.' });
      const chapter = await heroArtChapter(req, req.body.chapterId || req.query.chapterId);
      if (!chapter) return res.status(400).json({ error: 'A chapter is required.' });
      const next = sanitiseHeroArt(chapter.heroArt);
      // Replacing a page's artwork drops the old file: nothing else points at
      // it, and a chapter should not pay storage for what it has replaced.
      if (next[targetId]) gridfs.deleteFile(next[targetId].fileId).catch(() => {});
      next[targetId] = { fileId: String(fileId), tone: req.body.tone === 'dark' ? 'dark' : 'light' };
      await repo.patchById('chapters', chapter.id, { heroArt: next });
      placedOn = (heroArt.pageByKey(targetId) || {}).label || targetId;
    } else if (placement === 'home-header') {
      const scopedChapterId = await resolveChapterIdForWrite(req, req.body.chapterId || req.query.chapterId);
      if (scopedChapterId) {
        const chapter = await repo.getById('chapters', scopedChapterId);
        if (chapter) {
          if (chapter.homeHeaderImageFileId) gridfs.deleteFile(chapter.homeHeaderImageFileId).catch(() => {});
          await repo.patchById('chapters', scopedChapterId, { homeHeaderImageFileId: String(fileId) });
          placedOn = `${chapter.name || chapter.id} home page header`;
        }
      }
      if (!placedOn) {
        const current = (await repo.getSettings()).homeHeaderImageFileId || '';
        if (current) gridfs.deleteFile(current).catch(() => {});
        await repo.setSettings({ ...(await repo.getSettings()), homeHeaderImageFileId: String(fileId) });
        placedOn = 'Home page header';
      }
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
    // A national actor may deliberately create a NATIONAL executive — one of
    // the union's own officers rather than a chapter's. That is a different
    // statement from "I forgot to pick a chapter", so it has to be said
    // explicitly with the NATIONAL_SCOPE token; everything else still
    // resolves to a real chapter and is rejected if it cannot.
    const wantsNational = rolesLib.getActingScope(req).isNational
      && String(req.body.chapterId || '') === rolesLib.NATIONAL_SCOPE;
    const chapterId = wantsNational
      ? rolesLib.NATIONAL_CHAPTER_ID
      : await resolveChapterIdForWrite(req, req.body.chapterId);
    if (!wantsNational && !chapterId) return res.status(400).json({ error: 'A chapter is required — this deployment now has more than one, please specify which.' });
    let imageFileId = '';
    if (req.file) {
      const compressed = await compressIfImage(req.file.buffer, req.file.mimetype);
      imageFileId = String(await gridfs.uploadBuffer(compressed.buffer, req.file.originalname, {
        category: 'executive', contentType: compressed.contentType, title: req.body.name || req.file.originalname, chapterId
      }));
    }
    // This route creates a roster card on its own — a name and a face on the
    // public page, with no portal login behind it. It still records a real
    // position where one is given, so the card ranks correctly and reads the
    // same as every other. Capabilities are not involved: there is no account
    // here for them to attach to.
    const position = positions.positionByKey(req.body.positionKey);
    const exec = await repo.create('executives', {
      chapterId,
      name: req.body.name || '',
      role: position ? position.label : (req.body.role || ''),
      positionKey: position ? position.key : '',
      department: position && positions.requiresDepartment(position) ? String(req.body.department || '').trim() : '',
      bio: req.body.bio || '',
      order: Number(req.body.order || 0) || (position ? position.order : 0),
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
    // Where a real position is held, its label is the position's — not
    // whatever is typed here. Otherwise the card could read "President" while
    // the capabilities behind it stayed those of a Music Director. Changing
    // the position itself goes through /api/admin/executives/:id/position.
    const held = positions.positionByKey(existing.positionKey);
    const updated = await repo.updateById('executives', req.params.id, {
      name: req.body.name || '',
      role: held ? held.label : (req.body.role || ''),
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
  // A national actor who has chosen a chapter in the dashboard's scope
  // selector has already said which chapter they mean — that choice arrives
  // on the request (see lib/roles.js selectedChapterId) and counts here just
  // as an explicit ?chapterId= would.
  if (scope.chapterId) return scope.chapterId;
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

// ---------- upload failures ----------
// A rejected upload used to fall through to Express's default handler, which
// answers with an HTML page carrying a full stack trace and absolute server
// paths — to a client that asked for JSON and will try to parse it as JSON.
// So an oversized photo showed the member nothing useful, and told anyone
// looking exactly where the code lives on disk.
//
// Registered after every route, because that is where an error thrown by an
// upload middleware arrives.
app.use((err, req, res, next) => {
  if (!(err instanceof multer.MulterError)) return next(err);

  const limitMb = Math.round(UPLOAD_LIMIT_BYTES / (1024 * 1024));
  const messages = {
    // 413 rather than 400: the request was well-formed, it was simply too big.
    LIMIT_FILE_SIZE: [413, `That file is larger than ${limitMb}MB. Please choose a smaller one.`],
    LIMIT_UNEXPECTED_FILE: [400, 'That file was sent under a name this form does not expect.'],
    LIMIT_FILE_COUNT: [400, 'Too many files were sent at once.'],
    LIMIT_PART_COUNT: [400, 'That upload had too many parts.'],
    LIMIT_FIELD_KEY: [400, 'One of the field names in that upload is too long.'],
    LIMIT_FIELD_VALUE: [400, 'One of the values in that upload is too long.'],
    LIMIT_FIELD_COUNT: [400, 'That upload had too many fields.']
  };
  const [status, message] = messages[err.code] || [400, 'That upload could not be accepted.'];
  res.status(status).json({ error: message });
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

// ---------- automated onboarding messages (Phase 3) ----------
async function processOnboardingTasks() {
  try {
    const due = await repo.getAll('onboardingTasks', { status: 'scheduled' });
    for (const task of due.filter((t) => new Date(t.sendAt) <= new Date())) {
      try {
        const member = await repo.getById('members', task.memberId, { chapterId: task.chapterId });
        if (!member) {
          await repo.updateById('onboardingTasks', task.id, { ...task, status: 'skipped', result: 'Member no longer exists.' });
          continue;
        }
        const chapter = task.chapterId ? await repo.getById('chapters', task.chapterId) : null;
        const chapterName = chapter ? chapter.name : 'your chapter';
        const payload = task.sequence === 'day0_welcome'
          ? {
            subject: `Welcome to ${chapterName} — ACONSU`,
            html: `<p>Hi ${escapeHtmlForEmail(member.name || task.memberName || 'there')},</p><p>Welcome to ${escapeHtmlForEmail(chapterName)}. We're glad you're here.</p><p>You are now in our membership workflow as a visitor. A shepherd will follow up shortly.</p>`
          }
          : {
            subject: `Find your small group at ${chapterName}`,
            html: `<p>Hi ${escapeHtmlForEmail(member.name || task.memberName || 'there')},</p><p>Ready to plug in deeper? Join a small group/cell to grow with others this week.</p><p>Open the app and visit Groups to join one that fits you.</p>`
          };
        const sent = await mailer.sendMail({ to: member.email || task.memberEmail, subject: payload.subject, html: payload.html });
        await repo.updateById('onboardingTasks', task.id, {
          ...task,
          status: sent.sent ? 'sent' : (sent.skipped ? 'skipped' : 'failed'),
          result: sent.sent ? 'sent' : (sent.error || 'email not configured')
        });
      } catch (e) {
        await repo.updateById('onboardingTasks', task.id, { ...task, status: 'failed', result: e.message || 'failed' });
      }
    }
  } catch (e) {
    console.error('Onboarding task processing failed:', e.message);
  }
}

// ---------- inactivity retention alerts (Phase 3) ----------
function daysBetween(today, isoDate) {
  if (!isoDate) return 9999;
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return 9999;
  return Math.floor((today - d) / (24 * 60 * 60 * 1000));
}
async function checkRetentionAlerts() {
  try {
    const [members, records, alerts] = await Promise.all([
      repo.getAll('members'),
      repo.getAll('attendanceRecords'),
      repo.getAll('retentionAlerts')
    ]);
    const latestByMember = new Map();
    records.forEach((record) => {
      const presentIds = record.marks.filter((m) => m.status === 'present' && m.memberId).map((m) => m.memberId);
      presentIds.forEach((memberId) => {
        const prev = latestByMember.get(memberId);
        if (!prev || prev < record.date) latestByMember.set(memberId, record.date);
      });
    });
    const now = new Date();
    for (const member of members) {
      if (!isActivatedMember(member) || member.membershipStage === 'alumni') continue;
      const lastPresentDate = latestByMember.get(member.id) || '';
      const daysAbsent = daysBetween(now, lastPresentDate);
      const open = alerts.find((a) => a.memberId === member.id && a.status === 'open');
      if (daysAbsent >= 30) {
        if (!open) {
          await repo.create('retentionAlerts', {
            chapterId: member.chapterId,
            memberId: member.id,
            memberName: member.name,
            daysAbsent,
            lastPresentDate,
            status: 'open',
            alertType: 'inactivity_30d',
            createdBy: 'system'
          }, 'ral');
          notifyOfficeByEmail(
            'shepherdingEmail',
            'Retention Alert — 30+ days inactive',
            `<p><strong>${escapeHtmlForEmail(member.name)}</strong> has been absent for ${daysAbsent} day(s).</p><p>Please follow up from the Shepherding portal.</p>`
          );
          notifyOfficeByEmail(
            'welfareEmail',
            'Welfare Attention Needed — 30+ days inactive',
            `<p><strong>${escapeHtmlForEmail(member.name)}</strong> has been absent for ${daysAbsent} day(s).</p><p>Please coordinate care support if needed.</p>`
          );
        } else if (open.daysAbsent !== daysAbsent) {
          await repo.updateById('retentionAlerts', open.id, { ...open, daysAbsent, lastPresentDate });
        }
      } else if (open) {
        await repo.updateById('retentionAlerts', open.id, { ...open, status: 'resolved', notes: open.notes || 'Auto-resolved after attendance resumed.' });
      }
    }
  } catch (e) {
    console.error('Retention alert check failed:', e.message);
  }
}

// ---------- startup ----------
// Keeps lib/roles.js's "single chapter, zero friction" shortcut honest.
// chapterFilter() runs on nearly every request and cannot be async, so the
// answer to "is there exactly one active chapter?" is cached here and
// refreshed whenever a chapter is created, edited or activated/deactivated.
async function refreshSoleActiveChapter() {
  try {
    const active = await repo.getAll('chapters', { status: 'active' });
    rolesLib.setSoleActiveChapterId(active.length === 1 ? active[0].id : null);
  } catch (e) {
    // Leave the previous value in place rather than silently widening scope.
  }
}

connectDB()
  // Revocations are loaded BEFORE the first request is served: sessions
  // survive a restart now, so a session revoked before the restart must not
  // get a window where it works again.
  .then(() => loadStaffRevocations())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`ACONSU app running on http://localhost:${PORT}`);
    });
    setInterval(loadStaffRevocations, 5 * 60 * 1000);
    refreshSoleActiveChapter();
    setInterval(refreshSoleActiveChapter, 5 * 60 * 1000); // belt and braces against drift
    checkBirthdaysAndNotify();
    setInterval(checkBirthdaysAndNotify, 60 * 60 * 1000); // re-check hourly in case the server started mid-day
    sendDueAnnouncements();
    setInterval(sendDueAnnouncements, 60 * 1000); // a minute's precision is plenty for announcements
    processOnboardingTasks();
    setInterval(processOnboardingTasks, 60 * 1000);
    checkRetentionAlerts();
    setInterval(checkRetentionAlerts, 60 * 60 * 1000);
  })
  .catch((err) => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });
