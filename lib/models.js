const mongoose = require('mongoose');
const { Schema } = mongoose;

// A permissive base: every resource keeps a stable public "id" string
// (separate from Mongo's internal _id) so the existing frontend code,
// which links to things like /department.html?id=choir, keeps working
// unchanged.

const departmentSchema = new Schema({
  id: { type: String, required: true, unique: true },
  name: String,
  tagline: String,
  description: String,
  meetingDay: String,
  meetingTime: String,
  meetingLocation: String,
  leader: String,
  image: String
}, { timestamps: true });

const eventSchema = new Schema({
  id: { type: String, required: true, unique: true },
  title: String,
  date: String,
  time: String,
  location: String,
  description: String,
  recurring: String,
  image: String,
  // Registration (all optional — leave capacity blank/0 for an open, unlimited event)
  registrationEnabled: { type: Boolean, default: false },
  capacity: { type: Number, default: 0 }, // 0 = unlimited
  registrationDeadline: { type: String, default: '' } // ISO datetime string
}, { timestamps: true });

const customPageSchema = new Schema({
  id: { type: String, required: true, unique: true },
  slug: { type: String, required: true, unique: true },
  title: String,
  navLabel: String,
  type: { type: String, enum: ['gallery', 'bookshelf', 'text'], default: 'text' },
  description: String,
  content: String, // used by 'text' type
  showInNav: { type: Boolean, default: true },
  order: { type: Number, default: 0 }
}, { timestamps: true });

const eventRegistrationSchema = new Schema({
  id: { type: String, required: true, unique: true },
  eventId: String,
  name: String,
  email: String,
  phone: String,
  createdAt: { type: Date, default: Date.now }
});

const executiveSchema = new Schema({
  id: { type: String, required: true, unique: true },
  name: String,
  role: String,
  bio: String,
  imageFileId: { type: String, default: '' }, // references a GridFS file
  order: { type: Number, default: 0 }
}, { timestamps: true });

const memberSchema = new Schema({
  id: { type: String, required: true, unique: true },
  name: String,
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: String,
  phone: { type: String, default: '' },
  level: { type: String, default: '' },
  department: { type: String, default: '' }, // department id they primarily belong to
  profileImageFileId: { type: String, default: '' },
  // Birthday — month/day ONLY, never a year, so age can never be derived from this data.
  birthdayMonth: { type: Number, min: 1, max: 12, default: null },
  birthdayDay: { type: Number, min: 1, max: 31, default: null },
  // Engagement — used for the streak counter and badge calculations on the profile page.
  currentStreak: { type: Number, default: 0 },
  longestStreak: { type: Number, default: 0 },
  lastActiveDate: { type: String, default: '' }, // 'YYYY-MM-DD'
  bibleChaptersRead: { type: Number, default: 0 },
  // Password reset — token is a hash (never store the raw token), with a short expiry.
  resetTokenHash: { type: String, default: '' },
  resetTokenExpires: { type: Date, default: null }
}, { timestamps: true });

const notificationSchema = new Schema({
  id: { type: String, required: true, unique: true },
  title: String,
  body: String,
  url: { type: String, default: '/index.html' },
  source: { type: String, enum: ['admin', 'system'], default: 'admin' },
  createdAt: { type: Date, default: Date.now }
});

const pushSubscriptionSchema = new Schema({
  id: { type: String, required: true, unique: true },
  endpoint: { type: String, required: true, unique: true },
  keys: {
    p256dh: String,
    auth: String
  },
  memberId: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

const systemStateSchema = new Schema({
  singleton: { type: String, default: 'main', unique: true },
  lastBirthdayNotifDate: { type: String, default: '' } // 'YYYY-MM-DD', prevents duplicate daily pushes
});

// Shepherding record: extends a Member (or a non-member visitor) with pastoral-care
// details the Shepherding Head maintains by hand. Auto-imported fields (name, email,
// phone, department, birthday, profile photo) are read live from the Member record
// at query time rather than duplicated here — this schema only stores what can't
// come from anywhere else.
const shepherdingRecordSchema = new Schema({
  id: { type: String, required: true, unique: true },
  memberId: { type: String, default: '' }, // linked Member.id, blank if this is a manually-added visitor
  // Manual fields, always used (covers both linked members and standalone visitor entries):
  name: { type: String, default: '' }, // only used when memberId is blank (visitor with no account)
  phone: { type: String, default: '' }, // only used when memberId is blank
  address: { type: String, default: '' },
  emergencyContact: { type: String, default: '' },
  attendanceStatus: { type: String, enum: ['regular', 'irregular', 'inactive', 'new'], default: 'new' },
  lastContactDate: { type: String, default: '' }, // 'YYYY-MM-DD'
  pastoralNotes: { type: String, default: '' },
  imageFileId: { type: String, default: '' } // manually uploaded photo, used when there's no linked member photo
}, { timestamps: true });

const financeEntrySchema = new Schema({
  id: { type: String, required: true, unique: true },
  entryType: { type: String, enum: ['income', 'expense'], required: true },
  // Income categories are fixed to match the church's actual income sources.
  // Expenses use a free-text category since expense types vary more.
  category: { type: String, required: true }, // income: momo | tithe | harvest | offertory | other — expense: free text
  amount: { type: Number, required: true },
  date: { type: String, required: true }, // 'YYYY-MM-DD'
  description: { type: String, default: '' },
  recordedBy: { type: String, default: '' }
}, { timestamps: true });

const sermonSchema = new Schema({
  id: { type: String, required: true, unique: true },
  title: String,
  speaker: String,
  date: String,
  type: String,
  url: String,
  description: String
}, { timestamps: true });

const joinRequestSchema = new Schema({
  id: { type: String, required: true, unique: true },
  departmentId: String,
  name: String,
  email: String,
  phone: String,
  level: String,
  message: String,
  status: { type: String, default: 'new' },
  createdAt: { type: Date, default: Date.now }
});

const prayerRequestSchema = new Schema({
  id: { type: String, required: true, unique: true },
  name: String,
  email: String,
  request: String,
  isPrivate: Boolean,
  status: { type: String, default: 'new' },
  createdAt: { type: Date, default: Date.now }
});

const testimonySchema = new Schema({
  id: { type: String, required: true, unique: true },
  name: String,
  testimony: String,
  published: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const contactMessageSchema = new Schema({
  id: { type: String, required: true, unique: true },
  name: String,
  email: String,
  message: String,
  status: { type: String, default: 'new' },
  createdAt: { type: Date, default: Date.now }
});

const settingsSchema = new Schema({
  singleton: { type: String, default: 'main', unique: true },
  fellowshipName: String,
  fullName: String,
  tagline: String,
  verseOfTheWeek: String,
  address: String,
  email: String,
  phone: String,
  whatsapp: String,
  instagram: String,
  facebook: String,
  youtube: String,
  nextServiceLabel: String
});

module.exports = {
  Department: mongoose.model('Department', departmentSchema),
  Event: mongoose.model('Event', eventSchema),
  Sermon: mongoose.model('Sermon', sermonSchema),
  JoinRequest: mongoose.model('JoinRequest', joinRequestSchema),
  PrayerRequest: mongoose.model('PrayerRequest', prayerRequestSchema),
  Testimony: mongoose.model('Testimony', testimonySchema),
  ContactMessage: mongoose.model('ContactMessage', contactMessageSchema),
  Settings: mongoose.model('Settings', settingsSchema),
  CustomPage: mongoose.model('CustomPage', customPageSchema),
  EventRegistration: mongoose.model('EventRegistration', eventRegistrationSchema),
  Executive: mongoose.model('Executive', executiveSchema),
  Member: mongoose.model('Member', memberSchema),
  Notification: mongoose.model('Notification', notificationSchema),
  PushSubscription: mongoose.model('PushSubscription', pushSubscriptionSchema),
  SystemState: mongoose.model('SystemState', systemStateSchema),
  ShepherdingRecord: mongoose.model('ShepherdingRecord', shepherdingRecordSchema),
  FinanceEntry: mongoose.model('FinanceEntry', financeEntrySchema)
};
