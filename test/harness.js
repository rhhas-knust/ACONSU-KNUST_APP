// Test harness: swaps the Mongo-backed data layer for an in-memory one, so the
// real Express app (routes, permissions, calculations) can be exercised without
// a database. Loaded before server.js by .smoke-test.js.
const path = require('path');
const Module = require('module');

const clone = (o) => JSON.parse(JSON.stringify(o, (k, v) => v));

function matches(doc, query) {
  return Object.entries(query || {}).every(([key, cond]) => {
    const value = doc[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('$lte' in cond) return new Date(value) <= new Date(cond.$lte);
      if ('$gte' in cond) return new Date(value) >= new Date(cond.$gte);
      if ('$ne' in cond) return value !== cond.$ne;
      return true;
    }
    if (cond instanceof Date) return new Date(value).getTime() === cond.getTime();
    return value === cond;
  });
}

function applyUpdate(doc, update) {
  if (update.$set) Object.assign(doc, update.$set);
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
    }
  };
}

const fakeModels = {
  Department: makeModel({ headerImageFileId: '' }),
  Event: makeModel({ registrationEnabled: false, capacity: 0, registrationDeadline: '' }),
  Sermon: makeModel({}),
  JoinRequest: makeModel({ status: 'new' }),
  PrayerRequest: makeModel({ status: 'new' }),
  Testimony: makeModel({ published: false }),
  ContactMessage: makeModel({ status: 'new' }),
  Settings: makeModel({}),
  CustomPage: makeModel({ showInNav: true, order: 0 }),
  EventRegistration: makeModel({}),
  Executive: makeModel({ order: 0, imageFileId: '' }),
  Member: makeModel({ phone: '', level: '', department: '', profileImageFileId: '', currentStreak: 0, longestStreak: 0, bibleChaptersRead: 0, birthdayMonth: null, birthdayDay: null }),
  Notification: makeModel({ source: 'admin' }),
  PushSubscription: makeModel({}),
  SystemState: makeModel({ lastBirthdayNotifDate: '' }),
  ShepherdingRecord: makeModel({ memberId: '', name: '', phone: '', address: '', emergencyContact: '', attendanceStatus: 'new', lastContactDate: '', pastoralNotes: '', imageFileId: '' }),
  FinanceEntry: makeModel({ method: 'cash', reference: '', payee: '', budgetId: '', budgetLineId: '', approvalStatus: 'recorded', approvedBy: '', receiptFileId: '', description: '', recordedBy: '' }),
  Budget: makeModel({ status: 'draft', notes: '', lines: [], createdBy: '' }),
  AttendanceRecord: makeModel({ serviceType: 'sunday', title: '', marks: [], visitorCount: 0, notes: '', recordedBy: '' }),
  ScheduledNotification: makeModel({ status: 'scheduled', channels: ['app'], audience: 'all', url: '/index.html', sentAt: null, result: '', createdBy: '' }),
  SmsLog: makeModel({ status: 'sent', detail: '', sourceId: '' }),
  StaffUser: makeModel({ active: true, lastLoginAt: null, name: '' })
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
