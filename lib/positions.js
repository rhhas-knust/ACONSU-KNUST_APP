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
  FINANCE_LEDGER: 'finance.ledger',         // keeps the books: records entries
  TREASURY_REPORT: 'treasury.report',       // files money movements with evidence
  EVENTS: 'events',                         // submit events for review
  ANNOUNCE_CHAPTER: 'announce.chapter',     // message the whole chapter
  DAILY_VERSE: 'dailyVerse',                // posts the daily scripture
  DEPARTMENT: 'department',                 // own department's profile
  DEPARTMENT_MEMBERS: 'department.members',
  DEPARTMENT_ATTENDANCE: 'department.attendance',
  ANNOUNCE_DEPARTMENT: 'announce.department',
  BIBLE_STUDIES: 'bibleStudies'
};

const C = CAPABILITIES;

// Every head of a department runs it the same way. An Assistant Head holds
// exactly this too: ACONSU's assistants act fully in the head's place rather
// than being a reduced deputy, so there is no lesser tier to model.
const PORTFOLIO_CAPABILITIES = [
  C.PROFILE, C.DEPARTMENT, C.DEPARTMENT_MEMBERS, C.DEPARTMENT_ATTENDANCE,
  C.ANNOUNCE_DEPARTMENT, C.BIBLE_STUDIES, C.EVENTS
];

// ---- the positions ---------------------------------------------------------
// ACONSU's actual executive body. `order` drives the public roster's ranking,
// so the President is never listed below a department head because someone
// happened to add that card first.
//
// `reportsTo` records which officer a department answers to. Only the links
// ACONSU has actually stated are set — an unset one means "not recorded yet",
// never "answers to nobody in particular".
const POSITIONS = [
  // ---- officers of the chapter. No department: they answer for all of it.
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
    key: 'general_secretary', label: 'General Secretary', kind: 'officer', order: 30,
    capabilities: [
      C.PROFILE, C.CHAPTER_PULSE, C.CHAPTER_MEMBERS, C.MINUTES,
      C.ATTENDANCE_CHAPTER, C.ANNOUNCE_CHAPTER
    ]
  },
  {
    // Acts fully in the General Secretary's place, so the grant is the same.
    key: 'assistant_general_secretary', label: 'Assistant General Secretary', kind: 'officer', order: 40,
    deputyOf: 'general_secretary',
    capabilities: [
      C.PROFILE, C.CHAPTER_PULSE, C.CHAPTER_MEMBERS, C.MINUTES,
      C.ATTENDANCE_CHAPTER, C.ANNOUNCE_CHAPTER
    ]
  },
  {
    // Keeps the books. This is the one executive who WRITES to the ledger:
    // the Treasurer files what was received or spent, with evidence, and the
    // Financial Secretary is who records it.
    key: 'financial_secretary', label: 'Financial Secretary', kind: 'officer', order: 50,
    capabilities: [C.PROFILE, C.CHAPTER_MEMBERS, C.FINANCE_SUMMARY, C.FINANCE_LEDGER]
  },
  {
    // Holds and disburses the money, and must account for every movement of
    // it to the Financial Secretary with evidence attached. Deliberately has
    // no ledger write: the person holding the funds is not the person who
    // records them, which is the whole point of having both seats.
    key: 'treasurer', label: 'Treasurer', kind: 'officer', order: 60,
    capabilities: [C.PROFILE, C.CHAPTER_MEMBERS, C.FINANCE_SUMMARY, C.TREASURY_REPORT]
  },
  {
    key: 'organising_secretary', label: 'Organising Secretary', kind: 'officer', order: 70,
    capabilities: [
      C.PROFILE, C.CHAPTER_PULSE, C.CHAPTER_MEMBERS, C.CHAPTER_DEPARTMENTS,
      C.ATTENDANCE_CHAPTER, C.EVENTS
    ]
  },
  {
    key: 'campus_coordinator', label: 'Campus Coordinator', kind: 'officer', order: 80,
    capabilities: [
      C.PROFILE, C.CHAPTER_PULSE, C.CHAPTER_MEMBERS, C.CHAPTER_DEPARTMENTS, C.EVENTS
    ]
  },

  // ---- department heads. Each runs one department, and an Assistant Head
  // holds the same grant rather than a reduced one.
  { key: 'shepherding_head', label: 'Shepherding Head', kind: 'portfolio', order: 100, capabilities: PORTFOLIO_CAPABILITIES },
  // The largest department in the chapter, and it answers to the Organiser.
  { key: 'ushering_head', label: 'Ushering Head', kind: 'portfolio', order: 110, reportsTo: 'organising_secretary', capabilities: PORTFOLIO_CAPABILITIES },
  { key: 'media_head', label: 'Media Head', kind: 'portfolio', order: 120, capabilities: PORTFOLIO_CAPABILITIES },
  { key: 'assistant_media_head', label: 'Assistant Media Head', kind: 'portfolio', order: 125, deputyOf: 'media_head', capabilities: PORTFOLIO_CAPABILITIES },
  { key: 'technical_head', label: 'Technical Head', kind: 'portfolio', order: 130, capabilities: PORTFOLIO_CAPABILITIES },
  // Distinct from the Publicity *office portal*, which is a staff login of its
  // own: this is the elected executive who heads the publicity department.
  { key: 'publicity_head', label: 'Publicity Head', kind: 'portfolio', order: 140, capabilities: PORTFOLIO_CAPABILITIES },
  { key: 'mog_head', label: 'M.O.G Head', kind: 'portfolio', order: 150, capabilities: PORTFOLIO_CAPABILITIES },
  { key: 'assistant_mog_head', label: 'Assistant M.O.G Head', kind: 'portfolio', order: 155, deputyOf: 'mog_head', capabilities: PORTFOLIO_CAPABILITIES },
  { key: 'los_head', label: 'Ladies Of Substance Head (WOCOM)', kind: 'portfolio', order: 160, capabilities: PORTFOLIO_CAPABILITIES },
  { key: 'assistant_los_head', label: 'Assistant L.O.S Head', kind: 'portfolio', order: 165, deputyOf: 'los_head', capabilities: PORTFOLIO_CAPABILITIES },
  { key: 'welfare_head', label: 'Welfare Head', kind: 'portfolio', order: 170, capabilities: PORTFOLIO_CAPABILITIES },
  { key: 'assistant_welfare_head', label: 'Assistant Welfare Head', kind: 'portfolio', order: 175, deputyOf: 'welfare_head', capabilities: PORTFOLIO_CAPABILITIES },
  { key: 'music_director', label: 'Music Director', kind: 'portfolio', order: 180, capabilities: PORTFOLIO_CAPABILITIES },
  { key: 'assistant_music_director', label: 'Assistant Music Director', kind: 'portfolio', order: 185, deputyOf: 'music_director', capabilities: PORTFOLIO_CAPABILITIES },
  { key: 'prayer_secretary', label: 'Prayer Secretary', kind: 'portfolio', order: 190, capabilities: PORTFOLIO_CAPABILITIES },
  {
    // Runs the Bible Studies department and is who posts the daily verse.
    key: 'bible_studies_coordinator', label: 'Bible Studies Coordinator', kind: 'portfolio', order: 200,
    capabilities: [...PORTFOLIO_CAPABILITIES, C.DAILY_VERSE]
  }
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
// "Assistant" is spelled at least three ways across ACONSU's roster
// (assistant, assitant, asstiant) and abbreviated as asst. Rather than carry a
// row per misspelling for every deputy, the word itself is normalised here.
// The list is explicit rather than a fuzzy pattern: a loose match could fold
// some future position's name into "assistant" and hand out the wrong grant.
const ASSISTANT_SPELLINGS = new Set(['assistant', 'assitant', 'asstiant', 'asstiant', 'asst', 'assist', 'asistant', 'assisstant']);

function normalise(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')   // drops '.', '/', '-' so "vice-president" and "asst." land
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(word => (ASSISTANT_SPELLINGS.has(word) ? 'assistant' : word))
    .join(' ');
}

// Exact phrases only. Substring matching is tempting and wrong here: "vice
// president" contains "president", and silently handing a Vice President the
// President's capabilities is precisely the kind of bug this file exists to
// prevent.
// Exact phrases only, matched after normalise() lowercases the text and turns
// punctuation into spaces (so "M.O.G" becomes "m o g" and "Vice - President"
// becomes "vice president"). Substring matching is tempting and wrong here:
// "vice president" contains "president", and "Assistant Media Head" contains
// "Media Head" — silently handing a deputy or a Vice President someone else's
// capabilities is exactly the bug this file exists to prevent.
//
// Misspellings ACONSU actually uses are included on purpose ("secertary",
// "assitant", "organizer"): these have to match the roster as it is written
// today, not as it ought to be.
const ALIASES = new Map(Object.entries({
  // officers
  'president': 'president',
  'chapter president': 'president',
  'vice president': 'vice_president',
  'vice': 'vice_president',
  'vp': 'vice_president',
  'deputy president': 'vice_president',
  'general secretary': 'general_secretary',
  'general secertary': 'general_secretary',
  'secretary': 'general_secretary',
  'secertary': 'general_secretary',
  'assistant general secretary': 'assistant_general_secretary',
  'assistant general secertary': 'assistant_general_secretary',
  'deputy general secretary': 'assistant_general_secretary',
  'financial secretary': 'financial_secretary',
  'financial secertary': 'financial_secretary',
  'finance secretary': 'financial_secretary',
  'treasurer': 'treasurer',
  'organising secretary': 'organising_secretary',
  'organizing secretary': 'organising_secretary',
  'organising secertary': 'organising_secretary',
  'organizing secertary': 'organising_secretary',
  'organiser': 'organising_secretary',
  'organizer': 'organising_secretary',
  'campus coordinator': 'campus_coordinator',
  'campus co ordinator': 'campus_coordinator',

  // department heads
  'shepherding head': 'shepherding_head',
  'shepherd head': 'shepherding_head',
  'ushering head': 'ushering_head',
  'usher head': 'ushering_head',
  'ushers head': 'ushering_head',
  'media head': 'media_head',
  'assistant media head': 'assistant_media_head',
  'technical head': 'technical_head',
  'tech head': 'technical_head',
  'publicity head': 'publicity_head',
  'publicity': 'publicity_head',
  'public relations officer': 'publicity_head',
  'pro': 'publicity_head',
  'p r o': 'publicity_head',   // "P.R.O." once punctuation becomes spaces
  'm o g head': 'mog_head',
  'mog head': 'mog_head',
  'men of god head': 'mog_head',
  'assistant m o g head': 'assistant_mog_head',
  'assistant mog head': 'assistant_mog_head',
  'ladies of substance head wocom': 'los_head',
  'ladies of substance head': 'los_head',
  'l o s head': 'los_head',
  'los head': 'los_head',
  'wocom head': 'los_head',
  'wocom': 'los_head',
  'assistant l o s head': 'assistant_los_head',
  'assistant los head': 'assistant_los_head',
  'welfare head': 'welfare_head',
  'assistant welfare head': 'assistant_welfare_head',
  'music director': 'music_director',
  'assistant music director': 'assistant_music_director',
  'choir director': 'music_director',
  'choirmaster': 'music_director',
  'prayer secretary': 'prayer_secretary',
  'prayer secertary': 'prayer_secretary',
  'prayer coordinator': 'prayer_secretary',
  'intercession': 'prayer_secretary',
  'bible studies coordinator': 'bible_studies_coordinator',
  'bible study coordinator': 'bible_studies_coordinator',
  'bible studies': 'bible_studies_coordinator'
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
