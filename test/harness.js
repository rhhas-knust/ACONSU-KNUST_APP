// Test harness: swaps the Mongo-backed data layer for an in-memory one, so the
// real Express app (routes, permissions, calculations) can be exercised without
// a database. Loaded before server.js by .smoke-test.js.
const path = require('path');
const Module = require('module');

const clone = (o) => JSON.parse(JSON.stringify(o, (k, v) => v));

function matches(doc, query) {
  return Object.entries(query || {}).every(([key, cond]) => {
    if (key === '$or') return (cond || []).some((sub) => matches(doc, sub));
    if (key === '$and') return (cond || []).every((sub) => matches(doc, sub));
    const value = doc[key];
    if (Array.isArray(cond)) return cond.includes(value); // bare-array shorthand, used nowhere yet but cheap to support
    if (cond === null) return value == null; // Mongo: { field: null } also finds a doc without the field
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('$lte' in cond) return new Date(value) <= new Date(cond.$lte);
      if ('$gte' in cond) return new Date(value) >= new Date(cond.$gte);
      if ('$ne' in cond) return value !== cond.$ne;
      if ('$in' in cond) return (cond.$in || []).includes(value);
      if ('$nin' in cond) return !(cond.$nin || []).includes(value);
      if ('$exists' in cond) return cond.$exists ? value !== undefined : value === undefined;
      return true;
    }
    if (cond instanceof Date) return new Date(value).getTime() === cond.getTime();
    // Mongo matches a scalar against an array field by containment: a query of
    // { departments: 'choir' } finds every doc whose departments array holds
    // 'choir'. Without this the double would answer "no" to a query the real
    // database answers "yes" to, and a roster query would look broken in tests
    // while working in production — or, worse, look fine here and be wrong there.
    if (Array.isArray(value)) return value.includes(cond);
    return value === cond;
  });
}

function applyUpdate(doc, update) {
  if (update.$set) Object.assign(doc, update.$set);
  if (update.$inc) {
    Object.entries(update.$inc).forEach(([k, v]) => { doc[k] = (doc[k] || 0) + v; });
  }
  if (update.$addToSet) {
    Object.entries(update.$addToSet).forEach(([k, v]) => {
      if (!Array.isArray(doc[k])) doc[k] = [];
      if (!doc[k].includes(v)) doc[k].push(v);
    });
  }
  if (update.$push) {
    Object.entries(update.$push).forEach(([k, v]) => {
      if (!Array.isArray(doc[k])) doc[k] = [];
      doc[k].push(v);
    });
  }
  if (update.$pull) {
    Object.entries(update.$pull).forEach(([k, v]) => {
      if (Array.isArray(doc[k])) doc[k] = doc[k].filter((item) => item !== v);
    });
  }
  const direct = Object.fromEntries(Object.entries(update).filter(([k]) => !k.startsWith('$')));
  Object.assign(doc, direct);
  doc.updatedAt = new Date().toISOString();
  return doc;
}

// `unique` lists fields the real collection has a unique index on, for a model
// whose code relies on the database refusing a second document with the same
// value (a register made by two phones at once): create() then refuses one as
// MongoDB does, with code 11000.
function makeModel(defaults, { unique = [] } = {}) {
  const docs = [];
  let counter = 0;

  const result = (value) => {
    const p = Promise.resolve(value);
    p.lean = () => Promise.resolve(value);
    // A real sort, not a no-op: a route that sorts in the database and then takes
    // the first N must be exercised on the order the database would give it.
    p.sort = (spec) => {
      if (!Array.isArray(value) || !spec || typeof spec !== 'object') return result(value);
      const keys = Object.entries(spec);
      const sorted = [...value].sort((a, b) => {
        for (const [k, dir] of keys) {
          const x = a[k], y = b[k];
          const xv = x instanceof Date || typeof x === 'string' ? new Date(x).getTime() || String(x) : x;
          const yv = y instanceof Date || typeof y === 'string' ? new Date(y).getTime() || String(y) : y;
          if (xv < yv) return -dir;
          if (xv > yv) return dir;
        }
        return 0;
      });
      return result(sorted);
    };
    p.limit = (n) => result(Array.isArray(value) ? value.slice(0, n) : value);
    return p;
  };

  // A read that takes a while to come back, as one over a network does: what
  // was read is a snapshot, and another request may write in between.
  const later = (value, ms) => {
    const p = new Promise((resolve) => setTimeout(() => resolve(value), ms));
    p.lean = () => p;
    p.sort = () => p;
    p.limit = () => p;
    return p;
  };

  return {
    _docs: docs,
    // Instant unless a test about a "read, then write" race sets findDelayMs.
    findDelayMs: 0,
    find(query) {
      const value = docs.filter(d => matches(d, query || {})).map(clone);
      return this.findDelayMs > 0 ? later(value, this.findDelayMs) : result(value);
    },
    // Mongoose's findOne() (without .lean()) hands back a real document with a
    // .save() on it, and some routes mutate that document and save it rather
    // than going through repo. Returning a bare object here meant any such
    // route threw on .save() and 500'd under test only — so the member streak
    // could never be exercised by the suite at all. The copy stays a copy:
    // .save() writes it back to the store, exactly as Mongoose would.
    findOne(query) {
      const d = docs.find(x => matches(x, query));
      if (!d) return result(null);
      const copy = clone(d);
      Object.defineProperty(copy, 'save', {
        enumerable: false,
        value: function save() {
          const live = docs.find(x => matches(x, query));
          if (live) Object.assign(live, JSON.parse(JSON.stringify(this)), { updatedAt: new Date().toISOString() });
          return Promise.resolve(this);
        }
      });
      return result(copy);
    },
    // Instant by default, so the suite stays fast. A test about a "count, then
    // write" race sets countDelayMs on the model for the moment it needs: a real
    // database answers over a network, so requests made together overlap, and
    // an answer that arrives within the same breath hides the race entirely.
    countDelayMs: 0,
    countDocuments(query) {
      const n = docs.filter(d => matches(d, query || {})).length;
      return this.countDelayMs > 0 ? new Promise((resolve) => setTimeout(() => resolve(n), this.countDelayMs)) : Promise.resolve(n);
    },
    create(data) {
      const taken = unique.find(f => data[f] !== undefined && docs.some(d => d[f] === data[f]));
      if (taken) return Promise.reject(Object.assign(new Error(`E11000 duplicate key error: ${taken}`), { code: 11000 }));
      const doc = { _id: `oid${++counter}`, ...defaults, ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      docs.push(doc);
      return Promise.resolve(clone(doc));
    },
    findOneAndUpdate(query, update, opts) {
      let doc = docs.find(x => matches(x, query));
      if (!doc && opts && opts.upsert) {
        doc = { _id: `oid${++counter}`, ...defaults, ...query, createdAt: new Date().toISOString() };
        docs.push(doc);
      }
      if (!doc) return result(null);
      applyUpdate(doc, update);
      return result(clone(doc));
    },
    updateOne(query, update) {
      const doc = docs.find(x => matches(x, query));
      if (doc) applyUpdate(doc, update);
      return Promise.resolve({ modifiedCount: doc ? 1 : 0 });
    },
    updateMany(query, update) {
      docs.filter(d => matches(d, query)).forEach(d => applyUpdate(d, update));
      return Promise.resolve({});
    },
    deleteOne(query) {
      const i = docs.findIndex(x => matches(x, query));
      if (i >= 0) docs.splice(i, 1);
      return Promise.resolve({ deletedCount: i >= 0 ? 1 : 0 });
    },
    deleteMany(query) {
      const before = docs.length;
      const keep = docs.filter(d => !matches(d, query || {}));
      docs.length = 0;
      docs.push(...keep);
      return Promise.resolve({ deletedCount: before - docs.length });
    }
  };
}

const fakeModels = {
  Chapter: makeModel({
    status: 'active', fullName: '', institution: '', location: '', address: '',
    contact: {}, payment: {}, about: {}, coordinatorStaffId: '', coordinatorName: '', createdBy: '',
    mapUrl: '', mapPlace: null
  }),
  FeatureFlags: makeModel({ modules: {} }),
  Department: makeModel({ chapterId: '', headerImageFileId: '', mapUrl: '', mapPlace: null }),
  DepartmentRequest: makeModel({ chapterId: '', memberId: '', departmentId: '', status: 'pending', note: '', decidedByStaffId: '', decidedByName: '', decidedAt: null }),
  AlumniProfile: makeModel({ memberId: '', chapterId: '', listed: false, profession: '', organisation: '', industry: '', programme: '', graduationYear: '', city: '', country: 'Ghana', bio: '', openToMentoring: false, showEmail: false, showPhone: false, linkedin: '' }),
  MeetingRoom: makeModel({ chapterId: '', departmentId: '', title: '', createdByName: '', createdByStaffId: '', maxParticipants: 4, open: true, closedAt: null }),
  Event: makeModel({
    chapterId: '', isNational: false, registrationEnabled: false, capacity: 0, registrationDeadline: '',
    category: '', videoUrl: '', flyerFileId: '', registrationFormId: '',
    status: 'published', submittedBy: '', submittedByStaffId: '', reviewedBy: '', reviewNotes: '',
    mapUrl: '', mapPlace: null
  }),
  Sermon: makeModel({ chapterId: '' }),
  ContentItem: makeModel({ chapterId: '', published: true, featured: false, sortOrder: 0 }),
  JoinRequest: makeModel({ chapterId: '', status: 'new' }),
  PrayerRequest: makeModel({
    chapterId: '', status: 'new', visibility: 'private', memberId: '',
    prayingMemberIds: [], answered: false, testimony: '', answeredAt: null
  }),
  Testimony: makeModel({ chapterId: '', published: false }),
  ContactMessage: makeModel({ chapterId: '', status: 'new' }),
  Settings: makeModel({}),
  CustomPage: makeModel({ chapterId: '', showInNav: true, order: 0 }),
  EventRegistration: makeModel({ chapterId: '' }),
  Executive: makeModel({
    chapterId: '', order: 0, imageFileId: '', department: '', contact: { phone: '', email: '' },
    history: [], staffId: ''
  }),
  // No chapterId, deliberately: one set of founders for the whole church.
  AlumniEntry: makeModel({ about: '', currentWork: '', classOf: '', chapterId: '', imageFileId: '', status: 'pending', via: 'app', contact: '', declineReason: '', approvedAt: null, approvedBy: '', lastSpotlightWeek: '', prevSpotlightWeek: '' }),
  AlumniDetail: makeModel({ chapterId: '', classOf: '', programme: '', profession: '', organisation: '', industry: '', city: '', country: 'Ghana', openToMentoring: false, email: '', phone: '', shareWithMembers: false, showContact: false, consentedAt: null, consentVersion: '', status: 'new', via: 'site' }),
  AlumniSpotlight: makeModel({ weekKey: '', entryId: '', pinned: false }),
  MonthlyTheme: makeModel({ scripture: '', blurb: '', flyerFileIds: [], prayer: '', prayerNote: '', prayerFlyerFileIds: [], status: 'approved', proposedByChapterId: '', proposedByName: '', declineReason: '', decidedAt: null, decidedBy: '' }),
  ChurchFounder: makeModel({ role: '', about: '', imageFileId: '', inMemoriam: false, order: 0 }),
  Form: makeModel({ chapterId: '', description: '', category: 'custom', linkedEventId: '', fields: [], isOpen: true, closesAt: '', createdBy: '' }),
  FormSubmission: makeModel({ chapterId: '', memberId: '', submitterName: '', submitterEmail: '', answers: {} }),
  BibleStudy: makeModel({ chapterId: '', date: '', scriptureReference: '', studyMaterial: '', questions: [], notes: '', resources: [], createdBy: '' }),
  SermonNote: makeModel({ chapterId: '', sermonTitle: '', preacher: '', date: '', scripture: '', notes: '', summary: '', keyLessons: '', reflections: '' }),
  Group: makeModel({
    chapterId: '', type: 'other', description: '', linkedDepartmentId: '', leaderMemberId: '', leaderName: '',
    meetingDay: '', meetingTime: '', meetingLocation: '', memberIds: [], resources: [], createdBy: '',
    mapUrl: '', mapPlace: null
  }),
  GroupPost: makeModel({ chapterId: '', authorMemberId: '', authorName: '', isAnnouncement: false }),
  GroupMeeting: makeModel({ chapterId: '', topic: '', location: '', mapUrl: '', attendeeMemberIds: [], notes: '', recordedBy: '' }),
  DepartmentMeeting: makeModel({ chapterId: '', departmentId: '', topic: '', location: '', attendeeMemberIds: [], notes: '', recordedBy: '' }),
  ExecutiveMinute: makeModel({ chapterId: '', date: '', title: '', startTime: '', endTime: '', venue: '', chair: '', presentExecutiveIds: [], presentNames: [], apologies: '', openingPrayer: '', announcements: '', items: [], actions: [], nextMeeting: '', closingPrayer: '', body: '', decisions: '', fileId: '', status: 'draft', comments: [], approvedBy: [], approvedPositions: [], sharedAt: null, adoptedBy: '', adoptedAt: null, recordedBy: '', recordedPosition: '' }),
  SemesterOutline: makeModel({ chapterId: '', body: 'chapter', title: '', semesterLabel: '', startDate: '', endDate: '', theme: '', scripture: '', vision: '', goals: [], priorities: [], programmes: [], departmentFocus: [], needs: '', risks: '', status: 'draft', returnNote: '', version: 1, submittedAt: null, submittedBy: '', reviewedBy: '', reviewedAt: null, sharedAt: null, createdBy: '', updatedBy: '' }),
  BudgetCall: makeModel({ chapterId: '', title: '', periodLabel: '', dueDate: '', startDate: '', endDate: '', instructions: '', departmentIds: [], status: 'open', budgetId: '', createdBy: '', closedAt: null }),
  BudgetSubmission: makeModel({ chapterId: '', callId: '', departmentId: '', departmentName: '', lines: [], total: 0, justification: '', status: 'draft', submittedBy: '', submittedByName: '', submittedAt: null, reviewedBy: '', reviewedAt: null, reviewNote: '', recommendedTotal: 0, decidedBy: '', decidedAt: null, decisionNote: '', approvedTotal: 0, postedAt: null }),
  AnnouncementCall: makeModel({ chapterId: '', serviceDate: '', title: '', note: '', dueDate: '', status: 'open', compiledText: '', compiledBy: '', compiledAt: null, createdBy: '' }),
  AnnouncementItem: makeModel({ chapterId: '', callId: '', executiveId: '', staffId: '', positionKey: '', fromLabel: '', fromName: '', nothing: false, text: '', whenWhere: '', contact: '', status: 'submitted', finalText: '', order: 0 }),
  ChapterRequest: makeModel({ chapterId: '', message: '', status: 'open', requestedBy: '', requestedByName: '', requestedByRole: '', expiresAt: null, closedAt: null, closedBy: '', closedNote: '' }),
  Committee: makeModel({ chapterId: '', name: '', kind: 'committee', mandate: '', chairName: '', chairExecutiveId: '', memberNames: [], startDate: '', dueDate: '', status: 'active', progressNote: '', createdBy: '' }),
  DailyVerse: makeModel({ chapterId: '', date: '', reference: '', text: '', reflection: '', postedBy: '' }),
  CouncilPost: makeModel({ parentId: '', body: '', authorStaffId: '', authorName: '', authorRole: '', authorChapterId: '', authorChapterName: '', pinned: false }),
  ChatTopic: makeModel({ chapterId: '', createdByMemberId: '', createdByName: '', locked: false }),
  ChatMessage: makeModel({ chapterId: '', authorMemberId: '', authorName: '', reportCount: 0, hidden: false, hiddenBy: '' }),
  VolunteerAssignment: makeModel({ chapterId: '', memberName: '', status: 'assigned', notes: '', assignedBy: '' }),
  Milestone: makeModel({ chapterId: '', memberId: '', memberName: '', type: 'other', note: '', loggedBy: '' }),
  WelfareRequest: makeModel({
    chapterId: '', memberId: '', memberName: '', category: 'other', description: '', amountRequested: 0,
    status: 'submitted', notes: '', referredBy: '', handledBy: ''
  }),
  WelfareEntry: makeModel({
    chapterId: '', entryType: 'income', category: 'other', amount: 0, date: '', description: '',
    method: 'momo', reference: '', memberId: '', memberName: '', payee: '', receiptFileId: '',
    term: '', recordedBy: ''
  }),
  GivingIntent: makeModel({
    chapterId: '', memberId: '', memberName: '', purpose: 'other', method: 'momo', reference: '',
    status: 'pending', matchedFinanceEntryId: '', reviewNotes: '', reviewedBy: ''
  }),
  RetentionAlert: makeModel({
    chapterId: '', memberId: '', memberName: '', daysAbsent: 0, lastPresentDate: '',
    status: 'open', alertType: 'inactivity_30d', notes: '', createdBy: 'system', handledBy: ''
  }),
  OnboardingTask: makeModel({
    chapterId: '', memberId: '', memberEmail: '', memberName: '', sequence: 'day0_welcome',
    sendAt: null, status: 'scheduled', result: ''
  }),
  ReconciliationBatch: makeModel({
    chapterId: '', intentIds: [], financeEntryIds: [], totalAmount: 0, status: 'pending_approval',
    createdBy: '', approvedBy: '', approvedAt: null, notes: ''
  }),
  Member: makeModel({
    chapterId: '', phone: '', level: '', programme: '', hostel: '', academicHistory: [], department: '', departments: [],
    profileImageFileId: '', membershipStage: 'visitor', membershipNumber: '', qrToken: '',
    shepherdStaffId: '', shepherdName: '', graduationYear: '', registeredAsAlumni: false, chatRestricted: false,
    currentStreak: 0, longestStreak: 0, bibleChaptersRead: 0, birthdayMonth: null, birthdayDay: null
  }),
  Notification: makeModel({ chapterId: '', source: 'admin' }),
  PushSubscription: makeModel({ chapterId: '' }),
  SystemState: makeModel({ lastBirthdayNotifDate: '' }, { unique: ['singleton'] }),
  Metric: makeModel({ count: 0 }),
  PhoneCode: makeModel({ codeHash: '', expiresAt: null, attempts: 0, sends: [], purgeAt: null }),
  DoorCode: makeModel({ serviceType: 'sunday', active: true, uses: 0, createdBy: '', closedAt: null, closedBy: '' }, { unique: ['token'] }),
  ShepherdingRecord: makeModel({ chapterId: '', memberId: '', name: '', phone: '', email: '', level: '', programme: '', department: '', birthdayMonth: null, birthdayDay: null, origin: 'manual', linkedAt: null, linkedHow: '', linkedBy: '', mergedFromList: false, address: '', emergencyContact: '', attendanceStatus: 'new', lastContactDate: '', pastoralNotes: '', imageFileId: '' }),
  FinanceEntry: makeModel({ chapterId: '', method: 'cash', reference: '', payee: '', budgetId: '', budgetLineId: '', approvalStatus: 'recorded', approvedBy: '', receiptFileId: '', description: '', recordedBy: '', serviceDate: '', serviceType: '', origin: '' }),
  Budget: makeModel({ chapterId: '', status: 'draft', notes: '', lines: [], createdBy: '' }),
  AttendanceRecord: makeModel({ chapterId: '', serviceType: 'sunday', title: '', marks: [], visitorCount: 0, notes: '', recordedBy: '', rev: 0 }, { unique: ['id'] }),
  ScheduledNotification: makeModel({ chapterId: '', status: 'scheduled', channels: ['app'], audience: 'all', url: '/index.html', sentAt: null, result: '', createdBy: '' }),
  SmsLog: makeModel({ chapterId: '', status: 'sent', detail: '', sourceId: '' }),
  StaffUser: makeModel({ chapterId: '', memberId: '', active: true, lastLoginAt: null, name: '', positionKey: '', endedAt: null, handedOverTo: '', handedOverFrom: '', passwordChangedAt: null, mustChangePassword: false, startingPasswordExpiresAt: null }),
  NationalReport: makeModel({ reportDate: '', region: '', continent: '', metrics: {} })
};

// In-memory GridFS: enough for uploads, listing, streaming and deletion.
const files = new Map();
let fileCounter = 0;
const fakeGridfs = {
  uploadBuffer(buffer, filename, metadata) {
    const id = `file${++fileCounter}`;
    files.set(id, { _id: id, filename, length: buffer.length, uploadDate: new Date(), metadata });
    return Promise.resolve(id);
  },
  listFiles(query) {
    const entries = [...files.values()].filter((f) => Object.entries(query || {}).every(([k, v]) => {
      const key = k.replace('metadata.', '');
      const have = k.startsWith('metadata.') ? (f.metadata || {})[key] : f[k];
      // The two operators the app's own queries use; anything else is not an
      // equality, so it never matches (which is also what makes an injected one fail).
      if (v && typeof v === 'object' && '$nin' in v) return !v.$nin.includes(have);
      if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(have);
      return have === v;
    }));
    return Promise.resolve(entries);
  },
  findFile(id) { return Promise.resolve(files.get(id) || null); },
  openDownloadStream() { const { Readable } = require('stream'); return Readable.from(['x']); },
  deleteFile(id) { files.delete(id); return Promise.resolve(); },
  getBucket() { return {}; }
};

// Put the fakes in the module cache before server.js requires the real ones.
const root = path.join(__dirname, '..');
function stub(relPath, exports) {
  const full = require.resolve(path.join(root, relPath));
  const mod = new Module(full);
  mod.filename = full;
  mod.loaded = true;
  mod.exports = exports;
  require.cache[full] = mod;
}

// The member email index's name (lib/models.js), which lib/memberAccount.js
// looks for. Not enumerable, so nothing that walks the models sees it.
Object.defineProperty(fakeModels, 'MEMBER_EMAIL_INDEX', { value: 'email_unique_when_set' });
stub('lib/models.js', fakeModels);
stub('lib/gridfs.js', fakeGridfs);
// The double stands in for a healthy database by default, and can be told to
// play a dead one — the 503 branch is the whole point of a health check, so it
// has to be reachable from a test rather than taken on trust.
const fakeDb = {
  healthy: true,
  status() {
    return this.healthy
      ? { state: 'connected', connected: true, name: 'aconsu_test', pingMs: 1 }
      : { state: 'unreachable', connected: false, name: 'aconsu_test', pingMs: null, error: 'no reply' };
  }
};
stub('lib/db.js', {
  connectDB: () => Promise.resolve({}),
  createSessionStore: () => undefined,
  dbStatus: () => Promise.resolve(fakeDb.status())
});

// Signing up needs a phone number (Phase 5). The suites written before then
// sign their people up with an email address only; each sign-up sent as a
// form without a number is given one of its own here (020 1xx xxxx, a range no
// test types by hand), so those suites keep testing what they were written to
// test. test/signup.js tests the requirement itself, with JSON bodies, which
// this leaves alone.
const realFetch = global.fetch;
let phoneSeq = 0;
global.fetch = (url, opts) => {
  if (opts && opts.method === 'POST' && /\/api\/auth\/register$/.test(String(url))
      && opts.body instanceof FormData && !opts.body.get('phone')) {
    phoneSeq += 1;
    opts.body.set('phone', `0201${String(phoneSeq).padStart(6, '0')}`);
  }
  return realFetch(url, opts);
};

module.exports = { fakeDb, fakeModels, fakeGridfs };
