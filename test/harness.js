// Test harness: swaps the Mongo-backed data layer for an in-memory one, so the
// real Express app (routes, permissions, calculations) can be exercised without
// a database. Loaded before server.js by .smoke-test.js.
const path = require('path');
const Module = require('module');

const clone = (o) => JSON.parse(JSON.stringify(o, (k, v) => v));

function matches(doc, query) {
  return Object.entries(query || {}).every(([key, cond]) => {
    if (key === '$or') return (cond || []).some((sub) => matches(doc, sub));
    const value = doc[key];
    if (Array.isArray(cond)) return cond.includes(value); // bare-array shorthand, used nowhere yet but cheap to support
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('$lte' in cond) return new Date(value) <= new Date(cond.$lte);
      if ('$gte' in cond) return new Date(value) >= new Date(cond.$gte);
      if ('$ne' in cond) return value !== cond.$ne;
      if ('$in' in cond) return (cond.$in || []).includes(value);
      if ('$exists' in cond) return cond.$exists ? value !== undefined : value === undefined;
      return true;
    }
    if (cond instanceof Date) return new Date(value).getTime() === cond.getTime();
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

function makeModel(defaults) {
  const docs = [];
  let counter = 0;

  const result = (value) => {
    const p = Promise.resolve(value);
    p.lean = () => Promise.resolve(value);
    p.sort = () => result(value);
    return p;
  };

  return {
    _docs: docs,
    find(query) { return result(docs.filter(d => matches(d, query || {})).map(clone)); },
    findOne(query) { const d = docs.find(x => matches(x, query)); return result(d ? clone(d) : null); },
    countDocuments(query) { return Promise.resolve(docs.filter(d => matches(d, query || {})).length); },
    create(data) {
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
    contact: {}, payment: {}, about: {}, coordinatorStaffId: '', coordinatorName: '', createdBy: ''
  }),
  FeatureFlags: makeModel({ modules: {} }),
  Department: makeModel({ chapterId: '', headerImageFileId: '' }),
  Event: makeModel({
    chapterId: '', isNational: false, registrationEnabled: false, capacity: 0, registrationDeadline: '',
    category: '', videoUrl: '', flyerFileId: '', registrationFormId: '',
    status: 'published', submittedBy: '', submittedByStaffId: '', reviewedBy: '', reviewNotes: ''
  }),
  Sermon: makeModel({ chapterId: '' }),
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
  Form: makeModel({ chapterId: '', description: '', category: 'custom', linkedEventId: '', fields: [], isOpen: true, closesAt: '', createdBy: '' }),
  FormSubmission: makeModel({ chapterId: '', memberId: '', submitterName: '', submitterEmail: '', answers: {} }),
  BibleStudy: makeModel({ chapterId: '', date: '', scriptureReference: '', studyMaterial: '', questions: [], notes: '', resources: [], createdBy: '' }),
  SermonNote: makeModel({ chapterId: '', sermonTitle: '', preacher: '', date: '', scripture: '', notes: '', summary: '', keyLessons: '', reflections: '' }),
  Group: makeModel({
    chapterId: '', type: 'other', description: '', linkedDepartmentId: '', leaderMemberId: '', leaderName: '',
    meetingDay: '', meetingTime: '', meetingLocation: '', memberIds: [], resources: [], createdBy: ''
  }),
  GroupPost: makeModel({ chapterId: '', authorMemberId: '', authorName: '', isAnnouncement: false }),
  GroupMeeting: makeModel({ chapterId: '', topic: '', location: '', attendeeMemberIds: [], notes: '', recordedBy: '' }),
  ChatTopic: makeModel({ chapterId: '', createdByMemberId: '', createdByName: '', locked: false }),
  ChatMessage: makeModel({ chapterId: '', authorMemberId: '', authorName: '', reportCount: 0, hidden: false, hiddenBy: '' }),
  VolunteerAssignment: makeModel({ chapterId: '', memberName: '', status: 'assigned', notes: '', assignedBy: '' }),
  Milestone: makeModel({ chapterId: '', memberId: '', memberName: '', type: 'other', note: '', loggedBy: '' }),
  WelfareRequest: makeModel({
    chapterId: '', memberId: '', memberName: '', category: 'other', description: '', amountRequested: 0,
    status: 'submitted', notes: '', referredBy: '', handledBy: ''
  }),
  GivingIntent: makeModel({
    chapterId: '', memberId: '', memberName: '', purpose: 'other', method: 'momo', reference: '',
    status: 'pending', matchedFinanceEntryId: '', reviewNotes: '', reviewedBy: ''
  }),
  Member: makeModel({
    chapterId: '', phone: '', level: '', programme: '', hostel: '', academicHistory: [], department: '',
    profileImageFileId: '', membershipStage: 'visitor', membershipNumber: '', qrToken: '',
    shepherdStaffId: '', shepherdName: '', graduationYear: '', chatRestricted: false,
    currentStreak: 0, longestStreak: 0, bibleChaptersRead: 0, birthdayMonth: null, birthdayDay: null
  }),
  Notification: makeModel({ chapterId: '', source: 'admin' }),
  PushSubscription: makeModel({ chapterId: '' }),
  SystemState: makeModel({ lastBirthdayNotifDate: '' }),
  ShepherdingRecord: makeModel({ chapterId: '', memberId: '', name: '', phone: '', address: '', emergencyContact: '', attendanceStatus: 'new', lastContactDate: '', pastoralNotes: '', imageFileId: '' }),
  FinanceEntry: makeModel({ chapterId: '', method: 'cash', reference: '', payee: '', budgetId: '', budgetLineId: '', approvalStatus: 'recorded', approvedBy: '', receiptFileId: '', description: '', recordedBy: '' }),
  Budget: makeModel({ chapterId: '', status: 'draft', notes: '', lines: [], createdBy: '' }),
  AttendanceRecord: makeModel({ chapterId: '', serviceType: 'sunday', title: '', marks: [], visitorCount: 0, notes: '', recordedBy: '' }),
  ScheduledNotification: makeModel({ chapterId: '', status: 'scheduled', channels: ['app'], audience: 'all', url: '/index.html', sentAt: null, result: '', createdBy: '' }),
  SmsLog: makeModel({ chapterId: '', status: 'sent', detail: '', sourceId: '' }),
  StaffUser: makeModel({ chapterId: '', memberId: '', active: true, lastLoginAt: null, name: '' })
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
      return k.startsWith('metadata.') ? f.metadata[key] === v : f[k] === v;
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

stub('lib/models.js', fakeModels);
stub('lib/gridfs.js', fakeGridfs);
stub('lib/db.js', { connectDB: () => Promise.resolve({}) });

module.exports = { fakeModels, fakeGridfs };
