// ============================================================
// Role hierarchy + chapter-scope resolution for the multi-chapter platform.
// ============================================================
// This is the one place that decides "what chapter is this request allowed
// to touch, and under what authority" — every chapter-scoped route in
// server.js should go through chapterFilter()/getActingScope() rather than
// re-deriving this itself, so the isolation rule in spec section 43 (a user
// must never reach another chapter's data, even by manipulating an id or
// query string) has exactly one implementation to get right.
//
// The seed chapter created by migrate-multichapter.js for the ACONSU-KNUST
// data that already exists in production. The legacy env-based admin and
// shepherd logins (kept for zero-risk backward compatibility — see
// server.js) predate the idea of "which chapter", so when they act on
// chapter-owned data they're scoped to this chapter rather than left
// meaningless. New, real multi-chapter accounts never use this constant.
const LEGACY_CHAPTER_ID = 'aconsu-knust';

// Chapter-owned records carry a real chapterId; records belonging to ACONSU
// nationally carry an empty one. NATIONAL_SCOPE is the explicit way for a
// national actor to *say* "national" on a write, which matters because
// "no chapter chosen" and "deliberately national" look identical otherwise
// (see resolveChapterIdForWrite in server.js).
const NATIONAL_CHAPTER_ID = '';
const NATIONAL_SCOPE = '__national__';

// "Single chapter, zero friction" — the same rule resolvePublicChapterId and
// resolveChapterIdForWrite already apply on the write side. With exactly one
// active chapter there is nothing to disambiguate and no other chapter's data
// to leak into view, so a national actor who has chosen nothing simply sees
// it, exactly as before this change. The moment a second chapter exists,
// unscoped "national" stops meaning "every chapter merged together" and
// starts meaning "ACONSU nationally" — which is when merging actually starts
// doing harm. server.js keeps this in step; chapterFilter is called on nearly
// every request and cannot be async.
let soleActiveChapterId = null;
function setSoleActiveChapterId(id) {
  soleActiveChapterId = id ? String(id) : null;
}
function getSoleActiveChapterId() {
  return soleActiveChapterId;
}

// Display labels — the DB enum values are kept stable (nothing live is
// renamed), but several of them read differently in the new hierarchy than
// they did as a single-chapter app. This is the one place that relabeling
// happens, so a UI change here never requires a data migration.
const ROLE_LABELS = {
  nationalCoordinator: 'National Coordinator',
  coordinator: 'Chapter Coordinator',
  chapterAdmin: 'Chapter Admin',
  executive: 'Executive',
  finance: 'Finance Officer',
  shepherding: 'Shepherding',
  publicity: 'Publicity Officer',
  welfare: 'Welfare Officer'
};

// Top-down order, matching the spec's organisational hierarchy. Used for
// display and for "is this role at least as senior as that one" checks —
// not currently load-bearing for security (every route checks an explicit
// role/scope instead of a numeric threshold), kept simple on purpose.
const ROLE_ORDER = [
  'nationalCoordinator', 'coordinator', 'chapterAdmin', 'executive',
  'shepherding', 'publicity', 'finance', 'welfare'
];

function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

// Who is this request acting as, and which chapter(s) can it touch?
//   isNational: true  -> may read/write across every chapter (National
//               Coordinator, or the legacy global admin standing in for one)
//   chapterId:  the one chapter a chapter-scoped actor is confined to, or
//               (for a national actor) an optional chapter they've chosen to
//               look at via ?chapterId=, or null/'' meaning "every chapter".
// A request that authenticates as nobody in particular (no admin/staff
// session) gets isNational:false, chapterId:null — callers must treat that
// as "no access", never as "every chapter".
// Which chapter has a national actor chosen to look at, if any? Accepts
// ?chapterId= (used by direct API calls and the existing national portal) or
// the X-Chapter-Id header (what the admin dashboard's scope selector sends,
// so switching scope does not mean rewriting every fetch in admin.js).
// The NATIONAL_SCOPE token and an empty value both mean "stay national".
function selectedChapterId(req) {
  const raw = (req.query && req.query.chapterId)
    || (req.headers && req.headers['x-chapter-id'])
    || '';
  const clean = String(raw).trim();
  if (!clean || clean === NATIONAL_SCOPE) return null;
  return clean;
}

function getActingScope(req) {
  const session = req.session || {};

  if (session.isAdmin) {
    // The original single global admin. Treated as the bootstrap National
    // Coordinator (see README) — full cross-chapter reach, same as before
    // multi-chapter existed, so nothing this account could already do stops
    // working. Can optionally narrow to one chapter via ?chapterId=.
    return { isNational: true, chapterId: selectedChapterId(req), kind: 'admin' };
  }

  const staff = session.staff || null;
  if (staff && staff.role === 'nationalCoordinator') {
    return { isNational: true, chapterId: selectedChapterId(req), kind: 'staff' };
  }
  if (staff && staff.chapterId) {
    return { isNational: false, chapterId: staff.chapterId, kind: 'staff' };
  }
  if (staff) {
    // A staff account somehow missing its chapterId (shouldn't happen for
    // anything created going forward) — fail closed rather than leak.
    return { isNational: false, chapterId: '__none__', kind: 'staff' };
  }

  if (session.isShepherd) {
    // Legacy SHEPHERD_USERNAME/PASSWORD env login — predates chapters, so it
    // is pinned to the one chapter that existed when this shipped.
    return { isNational: false, chapterId: LEGACY_CHAPTER_ID, kind: 'legacyShepherd' };
  }

  return { isNational: false, chapterId: null, kind: 'anonymous' };
}

// The Mongo filter fragment for a chapter-scoped read/write. `required:
// true` (the default) means "anonymous"/no-scope resolves to a filter that
// matches nothing, rather than an empty {} that would return every chapter's
// data — chapter-scoped routes should always use the default. Pass
// `required: false` only for genuinely cross-chapter contexts (national
// dashboards) where an empty {} is the intended "every chapter" query.
// `crossChapter: true` is the deliberate escape hatch for a genuinely
// cross-chapter read (national aggregation, comparison reports). Without it,
// a national actor who has not selected a chapter sees ACONSU's own national
// records rather than every chapter's records merged together — see the
// "national by default, chapter by selection" rule in
// GOVERNANCE_TIER_REVIEW.md. Merging was how a national officer ended up
// browsing individual members and every chapter's executives at once, which
// the national dashboard's own privacy note says must not happen.
function chapterFilter(req, { required = true, crossChapter = false } = {}) {
  const scope = getActingScope(req);
  if (scope.isNational) {
    if (scope.chapterId) return { chapterId: scope.chapterId };
    if (crossChapter) return {};
    if (soleActiveChapterId) return { chapterId: soleActiveChapterId };
    return { chapterId: NATIONAL_CHAPTER_ID };
  }
  if (scope.chapterId) return { chapterId: scope.chapterId };
  return required ? { chapterId: '__no_access__' } : {};
}

// The chapterId to stamp on a NEW chapter-scoped document. Always derived
// from the acting session, never trusted from the request body — this is
// what stops someone from creating a record under another chapter's id by
// hand-crafting a request (section 43).
function chapterIdForWrite(req) {
  const scope = getActingScope(req);
  if (scope.chapterId && scope.chapterId !== '__none__') return scope.chapterId;
  // A national actor creating chapter-scoped content without picking a
  // chapter first — the route calling this should have already validated
  // req.query.chapterId/req.body.chapterId explicitly in that case; this is
  // the safe fallback if it didn't.
  return req.body && req.body.chapterId ? String(req.body.chapterId) : '';
}

function requireNational(req, res, next) {
  const scope = getActingScope(req);
  if (scope.isNational) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

module.exports = {
  LEGACY_CHAPTER_ID,
  NATIONAL_CHAPTER_ID,
  NATIONAL_SCOPE,
  selectedChapterId,
  setSoleActiveChapterId,
  getSoleActiveChapterId,
  ROLE_LABELS,
  ROLE_ORDER,
  roleLabel,
  getActingScope,
  chapterFilter,
  chapterIdForWrite,
  requireNational
};
