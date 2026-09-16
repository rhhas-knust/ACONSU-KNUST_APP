// The chapter executive body, as a closed vocabulary.
//
// Before this file, an executive's position was free text typed into a box on
// three different screens ("President", "president", "Snr. Prefect"). Nothing
// in the code could reason about it, so every executive was handed the same
// seven department-shaped panels — and a President, who runs the whole
// chapter and has no department, was met with "Choose your department on your
// profile first" and could go no further.
//
// Positions come in two kinds:
//   officer   — the elected six. They answer for the chapter as a whole, so
//               they are never attached to a department.
//   portfolio — an officer who owns one area of the chapter's work and runs
//               the department behind it. These are the executives the old
//               department panels were really written for.
//
// A position grants CAPABILITIES, and both the server guards and the portal's
// panel list read from the same grant. One definition, no drift: a capability
// the server refuses can never appear as a panel, and a panel can never exist
// without a route willing to serve it.

// ---- capabilities ----------------------------------------------------------
const CAPABILITIES = {
  PROFILE: 'profile',                       // own public roster card
  CHAPTER_PULSE: 'chapter.pulse',           // chapter-wide dashboard
  CHAPTER_MEMBERS: 'chapter.members',       // chapter-wide member directory
  CHAPTER_DEPARTMENTS: 'chapter.departments', // every department + its head
  MINUTES: 'minutes',                       // minutes of executive meetings
  ATTENDANCE_CHAPTER: 'attendance.chapter', // service registers
  FINANCE_SUMMARY: 'finance.summary',       // read-only books summary
  EVENTS: 'events',                         // submit events for review
  ANNOUNCE_CHAPTER: 'announce.chapter',     // message the whole chapter
  DEPARTMENT: 'department',                 // own department's profile
  DEPARTMENT_MEMBERS: 'department.members',
  DEPARTMENT_ATTENDANCE: 'department.attendance',
  ANNOUNCE_DEPARTMENT: 'announce.department',
  BIBLE_STUDIES: 'bibleStudies'
};

const C = CAPABILITIES;

// Every portfolio holder runs a department, so they all share one grant.
const PORTFOLIO_CAPABILITIES = [
  C.PROFILE, C.DEPARTMENT, C.DEPARTMENT_MEMBERS, C.DEPARTMENT_ATTENDANCE,
  C.ANNOUNCE_DEPARTMENT, C.BIBLE_STUDIES, C.EVENTS
];

// ---- the positions ---------------------------------------------------------
// `order` drives the public roster's ranking, so the President is never
// listed below the Organiser because someone typed the cards in that order.
const POSITIONS = [
  {
    key: 'president', label: 'President', kind: 'officer', order: 10,
    capabilities: [
      C.PROFILE, C.CHAPTER_PULSE, C.CHAPTER_MEMBERS, C.CHAPTER_DEPARTMENTS,
      C.MINUTES, C.ANNOUNCE_CHAPTER, C.EVENTS, C.FINANCE_SUMMARY
    ]
  },
  {
    key: 'vice_president', label: 'Vice President', kind: 'officer', order: 20,
    capabilities: [
      C.PROFILE, C.CHAPTER_PULSE, C.CHAPTER_MEMBERS, C.CHAPTER_DEPARTMENTS,
      C.MINUTES, C.EVENTS
    ]
  },
  {
    key: 'secretary', label: 'Secretary', kind: 'officer', order: 30,
    capabilities: [
      C.PROFILE, C.CHAPTER_PULSE, C.CHAPTER_MEMBERS, C.MINUTES,
      C.ATTENDANCE_CHAPTER, C.ANNOUNCE_CHAPTER
    ]
  },
  {
    key: 'assistant_secretary', label: 'Assistant Secretary', kind: 'officer', order: 40,
    capabilities: [C.PROFILE, C.CHAPTER_MEMBERS, C.MINUTES, C.ATTENDANCE_CHAPTER]
  },
  {
    // Reads the books; never writes them. Recording income and expenses stays
    // with the Finance portal, so the elected officer can answer for the money
    // without being able to quietly edit it.
    key: 'financial_secretary', label: 'Financial Secretary', kind: 'officer', order: 50,
    capabilities: [C.PROFILE, C.CHAPTER_MEMBERS, C.FINANCE_SUMMARY]
  },
  {
    key: 'organiser', label: 'Organiser', kind: 'officer', order: 60,
    capabilities: [
      C.PROFILE, C.CHAPTER_MEMBERS, C.CHAPTER_DEPARTMENTS,
      C.ATTENDANCE_CHAPTER, C.EVENTS
    ]
  },

  // ---- portfolio officers: one area of the work each ----
  { key: 'evangelism', label: 'Evangelism Coordinator', kind: 'portfolio', order: 70, capabilities: PORTFOLIO_CAPABILITIES },
  { key: 'welfare',    label: 'Welfare Coordinator',    kind: 'portfolio', order: 80, capabilities: PORTFOLIO_CAPABILITIES },
  // Distinct from the Publicity *office portal* (a staff role with its own
  // login): this is the elected executive who owns the publicity department.
  { key: 'publicity',  label: 'Publicity Coordinator',  kind: 'portfolio', order: 90, capabilities: PORTFOLIO_CAPABILITIES },
  { key: 'prayer',     label: 'Prayer Coordinator',     kind: 'portfolio', order: 100, capabilities: PORTFOLIO_CAPABILITIES },
  { key: 'music',      label: 'Music Director',         kind: 'portfolio', order: 110, capabilities: PORTFOLIO_CAPABILITIES }
];

const BY_KEY = new Map(POSITIONS.map(p => [p.key, p]));

// An executive whose position we cannot place — an old free-text card, or a
// title this chapter uses that isn't in the list yet. They keep a profile and
// can still submit events, and the portal tells them to ask their Coordinator
// to set the position properly. Deliberately minimal: an unrecognised title
// must never be a route to capabilities nobody granted.
const UNKNOWN_POSITION = {
  key: '', label: '', kind: 'unknown', order: 500,
  capabilities: [C.PROFILE, C.EVENTS]
};

// ---- matching free text to a position --------------------------------------
function normalise(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')   // drops '.', '/', '-' so "vice-president" and "asst." land
    .replace(/\s+/g, ' ')
    .trim();
}

// Exact phrases only. Substring matching is tempting and wrong here: "vice
// president" contains "president", and silently handing a Vice President the
// President's capabilities is precisely the kind of bug this file exists to
// prevent.
const ALIASES = new Map(Object.entries({
  'president': 'president',
  'chapter president': 'president',
  'vice president': 'vice_president',
  'vice': 'vice_president',
  'vp': 'vice_president',
  'deputy president': 'vice_president',
  'secretary': 'secretary',
  'general secretary': 'secretary',
  'chapter secretary': 'secretary',
  'assistant secretary': 'assistant_secretary',
  'asst secretary': 'assistant_secretary',
  'deputy secretary': 'assistant_secretary',
  'financial secretary': 'financial_secretary',
  'finance secretary': 'financial_secretary',
  'treasurer': 'financial_secretary',
  'organiser': 'organiser',
  'organizer': 'organiser',
  'organising secretary': 'organiser',
  'organizing secretary': 'organiser',
  'evangelism': 'evangelism',
  'evangelism coordinator': 'evangelism',
  'evangelist': 'evangelism',
  'welfare': 'welfare',
  'welfare coordinator': 'welfare',
  'publicity': 'publicity',
  'publicity coordinator': 'publicity',
  'public relations officer': 'publicity',
  'pro': 'publicity',
  'p r o': 'publicity',   // "P.R.O." once punctuation becomes spaces
  'prayer': 'prayer',
  'prayer coordinator': 'prayer',
  'prayer secretary': 'prayer',
  'intercession': 'prayer',
  'music': 'music',
  'music director': 'music',
  'choir director': 'music',
  'choirmaster': 'music'
}));

// Resolves a stored position key, falling back to the free-text title that
// existing records carry. `hasDepartment` decides the fallback for a title we
// cannot place: an unrecognised executive who already runs a department keeps
// exactly the panels they have today, so nothing regresses on deploy.
function resolvePosition(positionKey, roleText, hasDepartment) {
  const stored = BY_KEY.get(String(positionKey || '').trim());
  if (stored) return stored;

  const matchedKey = ALIASES.get(normalise(roleText));
  const matched = matchedKey ? BY_KEY.get(matchedKey) : null;
  if (matched) return matched;

  if (hasDepartment) {
    return {
      ...UNKNOWN_POSITION,
      kind: 'portfolio',
      capabilities: PORTFOLIO_CAPABILITIES
    };
  }
  return UNKNOWN_POSITION;
}

function positionByKey(key) {
  return BY_KEY.get(String(key || '').trim()) || null;
}

function isKnownPosition(key) {
  return BY_KEY.has(String(key || '').trim());
}

// A portfolio holder must have a department — it is what their panels operate
// on. An officer must not: they answer for the whole chapter, and attaching
// one to a department would quietly shrink their remit.
function requiresDepartment(position) {
  return !!position && position.kind === 'portfolio';
}

function hasCapability(position, capability) {
  return !!position && position.capabilities.includes(capability);
}

// What the portal needs to draw itself, and nothing more.
function publicShape(position) {
  return {
    key: position.key,
    label: position.label,
    kind: position.kind,
    capabilities: [...position.capabilities]
  };
}

module.exports = {
  CAPABILITIES,
  POSITIONS,
  UNKNOWN_POSITION,
  resolvePosition,
  positionByKey,
  isKnownPosition,
  requiresDepartment,
  hasCapability,
  publicShape,
  normalise
};
