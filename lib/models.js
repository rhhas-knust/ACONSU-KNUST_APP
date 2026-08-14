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
  image: String,
  // Header photo shown across the top of the department's own page and on its
  // card in the departments listing. References a GridFS file (see /api/files/:id).
  headerImageFileId: { type: String, default: '' }
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
  recordedBy: { type: String, default: '' },
  // Finance-office fields — every real entry should be traceable back to how the
  // money moved and who handled it, the way an actual books department works.
  method: { type: String, enum: ['cash', 'momo', 'bank', 'cheque', 'other'], default: 'cash' },
  reference: { type: String, default: '' }, // MoMo transaction id, cheque number, receipt number...
  payee: { type: String, default: '' }, // who was paid (expense) or who gave (income), when it matters
  // Links the entry to a budget line so planned-vs-actual can be calculated
  // without re-typing anything. Blank means "outside the budget".
  budgetId: { type: String, default: '' },
  budgetLineId: { type: String, default: '' },
  // Money out above a certain size normally needs a second pair of eyes.
  approvalStatus: { type: String, enum: ['recorded', 'pending', 'approved', 'rejected'], default: 'recorded' },
  approvedBy: { type: String, default: '' },
  receiptFileId: { type: String, default: '' } // scanned receipt / screenshot in GridFS
}, { timestamps: true });

// A budget is a plan for a period (a semester, a term, a year). Each line is one
// planned income source or planned expense; actuals are never stored here — they
// are summed live from FinanceEntry records that point at the line, so the two
// can never drift out of sync.
const budgetLineSchema = new Schema({
  lineId: { type: String, required: true },
  lineType: { type: String, enum: ['income', 'expense'], required: true },
  category: { type: String, required: true },
  plannedAmount: { type: Number, default: 0 },
  notes: { type: String, default: '' }
}, { _id: false });

const budgetSchema = new Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true }, // e.g. "2025/26 Academic Year"
  startDate: { type: String, required: true }, // 'YYYY-MM-DD'
  endDate: { type: String, required: true },
  status: { type: String, enum: ['draft', 'active', 'closed'], default: 'draft' },
  notes: { type: String, default: '' },
  lines: { type: [budgetLineSchema], default: [] },
  createdBy: { type: String, default: '' }
}, { timestamps: true });

// One Sunday (or midweek) service register. Per-person marks live in `marks`
// so a whole service is a single document — fast to save from the portal and
// fast to read back for attendance history.
const attendanceMarkSchema = new Schema({
  memberId: { type: String, default: '' },   // an ACONSU account holder
  recordId: { type: String, default: '' },   // a shepherding visitor record with no account
  name: { type: String, default: '' },       // snapshot of the name at the time it was taken
  status: { type: String, enum: ['present', 'absent', 'excused'], default: 'absent' }
}, { _id: false });

const attendanceRecordSchema = new Schema({
  id: { type: String, required: true, unique: true },
  date: { type: String, required: true }, // 'YYYY-MM-DD' — one register per date + serviceType
  serviceType: { type: String, enum: ['sunday', 'midweek', 'special'], default: 'sunday' },
  title: { type: String, default: '' },
  marks: { type: [attendanceMarkSchema], default: [] },
  // Headcounts for people who were in the room but aren't on any list.
  visitorCount: { type: Number, default: 0 },
  notes: { type: String, default: '' },
  recordedBy: { type: String, default: '' }
}, { timestamps: true });

// Publicity: an announcement queued to go out at a chosen time, on the channels
// they pick. A scheduled item stays 'scheduled' until the sender loop picks it
// up; sending is recorded on the same document so nothing goes out twice.
const scheduledNotificationSchema = new Schema({
  id: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  body: { type: String, required: true },
  url: { type: String, default: '/index.html' },
  channels: { type: [String], default: ['app'] }, // 'app' (in-app + push) and/or 'sms'
  audience: { type: String, default: 'all' }, // 'all' | 'members' | 'department:<departmentId>'
  scheduledFor: { type: Date, required: true },
  status: { type: String, enum: ['scheduled', 'sent', 'cancelled', 'failed'], default: 'scheduled' },
  sentAt: { type: Date, default: null },
  result: { type: String, default: '' }, // short human-readable outcome, shown in the portal
  createdBy: { type: String, default: '' }
}, { timestamps: true });

// Every SMS attempt, kept so publicity can see what actually reached people
// and so a failed batch can be understood after the fact.
const smsLogSchema = new Schema({
  id: { type: String, required: true, unique: true },
  to: { type: String, required: true },
  body: { type: String, default: '' },
  status: { type: String, enum: ['sent', 'failed', 'skipped'], default: 'sent' },
  detail: { type: String, default: '' },
  sourceId: { type: String, default: '' }, // the notification this SMS belonged to
  createdAt: { type: Date, default: Date.now }
});

// Portal accounts for the union's leaders. Created and managed by the admin in
// the admin dashboard — one account per person, per role, so a leader can be
// added or removed without anyone sharing a password.
const staffUserSchema = new Schema({
  id: { type: String, required: true, unique: true },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, default: '' },
  role: {
    type: String,
    enum: ['coordinator', 'finance', 'shepherding', 'publicity'],
    required: true
  },
  passwordHash: { type: String, required: true },
  active: { type: Boolean, default: true },
  lastLoginAt: { type: Date, default: null }
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
  nextServiceLabel: String,
  // Where each office's copy of an incoming message should go. Blank falls back
  // to the main contact email above, so nothing is ever silently dropped.
  shepherdingEmail: String,
  financeEmail: String,
  publicityEmail: String
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
  FinanceEntry: mongoose.model('FinanceEntry', financeEntrySchema),
  Budget: mongoose.model('Budget', budgetSchema),
  AttendanceRecord: mongoose.model('AttendanceRecord', attendanceRecordSchema),
  ScheduledNotification: mongoose.model('ScheduledNotification', scheduledNotificationSchema),
  SmsLog: mongoose.model('SmsLog', smsLogSchema),
  StaffUser: mongoose.model('StaffUser', staffUserSchema)
};
