const mongoose = require('mongoose');
const { Schema } = mongoose;

// A permissive base: every resource keeps a stable public "id" string
// (separate from Mongo's internal _id) so the existing frontend code,
// which links to things like /department.html?id=choir, keeps working
// unchanged.

// ============================================================
// Multi-chapter foundation
// ============================================================
// A Chapter is one local ACONSU branch (e.g. a university campus union).
// Every chapter-owned collection below carries a `chapterId` pointing back
// here (empty string = national/unscoped content, never a real chapter's
// data — see lib/roles.js for how that's enforced). Chapter documents are
// the only place chapter-specific "About" content and payment configuration
// live, so chapters never share a payment destination or public profile.
const chapterSchema = new Schema({
  id: { type: String, required: true, unique: true }, // e.g. 'aconsu-knust' — used as the chapterId FK everywhere
  name: { type: String, required: true },              // e.g. 'ACONSU-KNUST'
  fullName: { type: String, default: '' },              // e.g. "The Apostles' Continuation Students Union — KNUST"
  institution: { type: String, default: '' },           // e.g. 'Kwame Nkrumah University of Science and Technology'
  location: { type: String, default: '' },
  address: { type: String, default: '' },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  // Contact — public-facing, shown on the chapter's About/Contact page.
  contact: {
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    whatsapp: { type: String, default: '' },
    facebook: { type: String, default: '' },
    instagram: { type: String, default: '' },
    youtube: { type: String, default: '' }
  },
  // Payment configuration — deliberately isolated per chapter (section 32:
  // chapter financial data must never mix). Left blank until a chapter sets
  // its own; Finance/Donations simply stay unconfigured until they do.
  payment: {
    provider: { type: String, default: '' },        // e.g. 'Paystack', 'Manual MoMo'
    momoNumber: { type: String, default: '' },
    momoName: { type: String, default: '' },
    bankName: { type: String, default: '' },
    bankAccountName: { type: String, default: '' },
    bankAccountNumber: { type: String, default: '' },
    donationDestination: { type: String, default: '' }, // free-text note, e.g. "General Fund"
    welfareDestination: { type: String, default: '' }
  },
  // Chapter About page content (section 31) — filled in by the Chapter
  // Coordinator/Admin; the public page itself ships in a later phase, but the
  // data has a home from day one so nothing needs re-migrating later.
  about: {
    history: { type: String, default: '' },
    vision: { type: String, default: '' },
    mission: { type: String, default: '' },
    values: { type: String, default: '' },
    leadership: { type: String, default: '' }
  },
  // Denormalized for fast display (source of truth is StaffUser: chapterId + role).
  coordinatorStaffId: { type: String, default: '' },
  coordinatorName: { type: String, default: '' },
  createdBy: { type: String, default: '' } // name of the National Coordinator who created it
}, { timestamps: true });

// National Coordinator-controlled module toggles (section 39). A singleton
// today; every module defaults ON so nothing existing regresses when this
// ships. Per-chapter overrides can be layered on later without a schema
// change (an empty per-chapter override map already has a natural home here
// if/when that's needed — kept out for now to avoid building ahead of need).
const featureFlagsSchema = new Schema({
  singleton: { type: String, default: 'main', unique: true },
  modules: {
    bible: { type: Boolean, default: true },
    bibleStudy: { type: Boolean, default: true },
    events: { type: Boolean, default: true },
    donations: { type: Boolean, default: true },
    welfare: { type: Boolean, default: true },
    communityChat: { type: Boolean, default: true },
    ebooks: { type: Boolean, default: true },
    liveStreaming: { type: Boolean, default: true },
    attendance: { type: Boolean, default: true },
    seminars: { type: Boolean, default: true },
    prayerWall: { type: Boolean, default: true },
    groups: { type: Boolean, default: true },
    departments: { type: Boolean, default: true }
  }
}, { timestamps: true });

const departmentSchema = new Schema({
  id: { type: String, required: true, unique: true },
  chapterId: { type: String, default: '', index: true },
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
  chapterId: { type: String, default: '', index: true },
  // A national event is visible to every chapter — set when Publicity/National
  // marks it as such, rather than a second, duplicated events system.
  isNational: { type: Boolean, default: false },
  title: String,
  date: String,
  time: String,
  location: String,
  description: String,
  recurring: String,
  image: String,
  category: { type: String, default: '' },
  videoUrl: { type: String, default: '' }, // optional promo/recap link
  flyerFileId: { type: String, default: '' }, // references a GridFS file — shown on the homepage once approved+published
  registrationFormId: { type: String, default: '' }, // optional link to a Form (section 11)
  // Event workflow (section 9): EXECUTIVE -> SUBMITTED -> PUBLICITY REVIEW ->
  // APPROVED -> PUBLISHED. Admin/Publicity/Coordinator creating an event
  // directly still publishes immediately — 'published' stays the default so
  // every event created before this field existed, and every one created
  // through the existing direct-create routes, needs no extra step.
  status: { type: String, enum: ['draft', 'submitted', 'approved', 'rejected', 'published'], default: 'published' },
  submittedBy: { type: String, default: '' },       // display name, for the review queue
  submittedByStaffId: { type: String, default: '' }, // the executive's StaffUser id
  reviewedBy: { type: String, default: '' },
  reviewNotes: { type: String, default: '' },
  // Registration (all optional — leave capacity blank/0 for an open, unlimited event)
  registrationEnabled: { type: Boolean, default: false },
  capacity: { type: Number, default: 0 }, // 0 = unlimited
  registrationDeadline: { type: String, default: '' } // ISO datetime string
}, { timestamps: true });

const customPageSchema = new Schema({
  id: { type: String, required: true, unique: true },
  chapterId: { type: String, default: '', index: true },
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
  chapterId: { type: String, default: '', index: true },
  eventId: String,
  name: String,
  email: String,
  phone: String,
  createdAt: { type: Date, default: Date.now }
});

// One academic-year snapshot of an executive's position — kept so "who was
// Financial Secretary in 2025/2026" is still answerable after a handover,
// the same idea as a member's academicHistory (section 9).
const executiveHistoryEntrySchema = new Schema({
  year: { type: String, default: '' },
  role: { type: String, default: '' },
  department: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now }
}, { _id: false });

const executiveSchema = new Schema({
  id: { type: String, required: true, unique: true },
  chapterId: { type: String, default: '', index: true },
  name: String,
  role: String, // current position, e.g. "President"
  department: { type: String, default: '' }, // department id, if this position leads one
  bio: String,
  contact: {
    phone: { type: String, default: '' },
    email: { type: String, default: '' }
  },
  imageFileId: { type: String, default: '' }, // references a GridFS file
  order: { type: Number, default: 0 },
  history: { type: [executiveHistoryEntrySchema], default: [] },
  // Links this public-facing card to the portal account that may edit it —
  // an executive with a StaffUser login can only ever touch their own card
  // (see requireOwnExecutiveRecord in server.js), never anyone else's.
  staffId: { type: String, default: '' }
}, { timestamps: true });

// One academic-year snapshot of a member's programme/level/hostel, kept so
// "where were they in 2025/2026" is answerable without losing history the
// moment someone updates their current year (section 8).
const academicHistoryEntrySchema = new Schema({
  year: { type: String, default: '' },   // e.g. '2025/2026'
  level: { type: String, default: '' },
  hostel: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now }
}, { _id: false });

const memberSchema = new Schema({
  id: { type: String, required: true, unique: true },
  // Every member/visitor belongs to exactly one chapter, chosen at registration.
  // Blank is only valid for a bootstrap National Coordinator profile (none of
  // today's real accounts are national, so this is empty-safe by default).
  chapterId: { type: String, default: '', index: true },
  name: String,
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: String,
  phone: { type: String, default: '' },
  level: { type: String, default: '' },
  programme: { type: String, default: '' },  // course of study
  hostel: { type: String, default: '' },      // hostel / residence
  academicHistory: { type: [academicHistoryEntrySchema], default: [] },
  department: { type: String, default: '' }, // department id they primarily belong to
  profileImageFileId: { type: String, default: '' },
  // Membership workflow (section 7): REGISTERED -> VISITOR -> SHEPHERDING REVIEW
  // -> ACCEPTED -> ASSIGNED SHEPHERD -> ACTIVE. New registrations start as
  // 'visitor'; Shepherding moves them along. Existing accounts created before
  // this workflow existed are grandfathered to 'active' by the migration
  // script rather than silently demoted.
  membershipStage: { type: String, enum: ['visitor', 'under_review', 'accepted', 'active'], default: 'visitor' },
  membershipNumber: { type: String, default: '' }, // assigned once accepted; shown on the digital membership card
  qrToken: { type: String, default: '' },          // unguessable token encoded in the member's QR — never the member id
  shepherdStaffId: { type: String, default: '' },  // assigned shepherd (StaffUser id)
  shepherdName: { type: String, default: '' },     // denormalized snapshot for display
  graduationYear: { type: String, default: '' },   // e.g. '2027' — optional, for a graduation milestone (section 36)
  // Moderation (section 19) — set by a Chapter Admin/Coordinator; a
  // restricted member can still read Community Chat, just not post.
  chatRestricted: { type: Boolean, default: false },
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
  // Blank chapterId = national broadcast, visible to every chapter — mirrors
  // the NATIONAL marker used across the rest of the schema (section 44).
  chapterId: { type: String, default: '', index: true },
  title: String,
  body: String,
  url: { type: String, default: '/index.html' },
  source: { type: String, enum: ['admin', 'system'], default: 'admin' },
  createdAt: { type: Date, default: Date.now }
});

const pushSubscriptionSchema = new Schema({
  id: { type: String, required: true, unique: true },
  chapterId: { type: String, default: '', index: true }, // denormalized from the member at subscribe time
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
  chapterId: { type: String, default: '', index: true },
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
  chapterId: { type: String, default: '', index: true },
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
  chapterId: { type: String, default: '', index: true },
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
  chapterId: { type: String, default: '', index: true },
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
  chapterId: { type: String, default: '', index: true }, // blank = national announcement
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
  chapterId: { type: String, default: '', index: true },
  to: { type: String, required: true },
  body: { type: String, default: '' },
  status: { type: String, enum: ['sent', 'failed', 'skipped'], default: 'sent' },
  detail: { type: String, default: '' },
  sourceId: { type: String, default: '' }, // the notification this SMS belonged to
  createdAt: { type: Date, default: Date.now }
});

// Portal accounts for the union's leaders. Created and managed by the admin
// (or, going forward, the National/Chapter Coordinator) — one account per
// person, per role, so a leader can be added or removed without anyone
// sharing a password.
//
// Role hierarchy note (see lib/roles.js for the full picture): 'coordinator'
// is the Chapter Coordinator — the name is unchanged from before multi-chapter
// support existed (nothing live depends on renaming it), but its authority is
// now the top of an individual chapter rather than a read-only rollup.
// 'nationalCoordinator' sits above every chapter; leave chapterId blank for
// that role only. Every other role requires a chapterId.
const staffUserSchema = new Schema({
  id: { type: String, required: true, unique: true },
  chapterId: { type: String, default: '' }, // blank only valid for nationalCoordinator
  // Optional link to this person's own Member profile, so their office login
  // stays separate while their public identity (badges, attendance, digital
  // card) stays on the one profile everyone else has — see the audit notes on
  // why this is a deliberate middle ground rather than a full account merge.
  memberId: { type: String, default: '' },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, default: '' },
  role: {
    type: String,
    enum: [
      'nationalCoordinator', 'coordinator', 'chapterAdmin', 'executive',
      'finance', 'shepherding', 'publicity', 'welfare', 'departmentLeader'
    ],
    required: true
  },
  passwordHash: { type: String, required: true },
  active: { type: Boolean, default: true },
  lastLoginAt: { type: Date, default: null }
}, { timestamps: true });

const sermonSchema = new Schema({
  id: { type: String, required: true, unique: true },
  chapterId: { type: String, default: '', index: true },
  title: String,
  speaker: String,
  date: String,
  type: String,
  url: String,
  description: String
}, { timestamps: true });

// Reusable public content for Phase 7. Keeping the common publishing fields
// together avoids a separate, near-identical database collection for each
// content page while retaining a typed category for filtering and access.
const contentItemSchema = new Schema({
  id: { type: String, required: true, unique: true },
  chapterId: { type: String, default: '', index: true }, // blank = national
  kind: { type: String, enum: ['live_service', 'seminar', 'weekly_highlight', 'ebook', 'founder', 'church_info', 'aconsu_info'], required: true },
  title: { type: String, required: true },
  summary: { type: String, default: '' },
  body: { type: String, default: '' },
  imageFileId: { type: String, default: '' },
  previewUrl: { type: String, default: '' },
  resourceUrl: { type: String, default: '' },
  resourceFileId: { type: String, default: '' },
  category: { type: String, default: '' },
  eventDate: { type: String, default: '' },
  published: { type: Boolean, default: true },
  featured: { type: Boolean, default: false },
  sortOrder: { type: Number, default: 0 },
  createdBy: { type: String, default: '' }
}, { timestamps: true });

const joinRequestSchema = new Schema({
  id: { type: String, required: true, unique: true },
  chapterId: { type: String, default: '', index: true },
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
  chapterId: { type: String, default: '', index: true },
  name: String,
  email: String,
  request: String,
  isPrivate: Boolean, // kept for backward compatibility — visibility below is authoritative going forward
  // Who can see it (section 18): public (the Prayer Wall), private (staff
  // only, e.g. Shepherding/Publicity), shepherd_only (pastoral-care team
  // only), or anonymous (public wall, but the name is never shown).
  visibility: { type: String, enum: ['public', 'private', 'shepherd_only', 'anonymous'], default: 'private' },
  memberId: { type: String, default: '' }, // if submitted while logged in
  prayingMemberIds: { type: [String], default: [] }, // who tapped "I'm praying for you"
  answered: { type: Boolean, default: false },
  testimony: { type: String, default: '' },
  answeredAt: { type: Date, default: null },
  status: { type: String, default: 'new' },
  createdAt: { type: Date, default: Date.now }
});

// ============================================================
// Form Builder (section 11) — reusable across event registration,
// travelling-event sign-ups, executive info, department activities, welfare
// and anything else a chapter needs to collect structured answers for.
// ============================================================
const formFieldSchema = new Schema({
  id: { type: String, required: true },
  label: { type: String, required: true },
  type: {
    type: String,
    enum: ['short_text', 'long_text', 'multiple_choice', 'checkboxes', 'dropdown', 'date', 'time', 'phone', 'email', 'file'],
    required: true
  },
  required: { type: Boolean, default: false },
  options: { type: [String], default: [] }, // multiple_choice / checkboxes / dropdown
  order: { type: Number, default: 0 }
}, { _id: false });

const formSchema = new Schema({
  id: { type: String, required: true, unique: true },
  chapterId: { type: String, default: '', index: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  // What this form is for — purely descriptive/organisational; every
  // category is built on the same generic field/submission engine.
  category: {
    type: String,
    enum: ['event_registration', 'travelling_event', 'executive', 'department', 'welfare', 'custom'],
    default: 'custom'
  },
  linkedEventId: { type: String, default: '' }, // set when category === 'event_registration' / 'travelling_event'
  fields: { type: [formFieldSchema], default: [] },
  isOpen: { type: Boolean, default: true },
  closesAt: { type: String, default: '' }, // ISO datetime string, optional
  createdBy: { type: String, default: '' }
}, { timestamps: true });

const formSubmissionSchema = new Schema({
  id: { type: String, required: true, unique: true },
  chapterId: { type: String, default: '', index: true },
  formId: { type: String, required: true, index: true },
  memberId: { type: String, default: '' }, // set when submitted while logged in
  submitterName: { type: String, default: '' },  // convenience snapshot — never requires a join to display a list
  submitterEmail: { type: String, default: '' },
  answers: { type: Schema.Types.Mixed, default: {} }, // { [fieldId]: value }
  createdAt: { type: Date, default: Date.now }
});

// ============================================================
// Bible Study (section 16) — always linked to a real passage, so a study
// entry can jump straight into the existing Bible reader rather than
// repeating scripture text here.
// ============================================================
const bibleStudySchema = new Schema({
  id: { type: String, required: true, unique: true },
  chapterId: { type: String, default: '', index: true },
  topic: { type: String, required: true },
  date: { type: String, default: '' },
  scriptureReference: { type: String, default: '' }, // e.g. "John 3:1-21" — parsed by the Bible reader link
  studyMaterial: { type: String, default: '' },
  questions: { type: [String], default: [] },
  notes: { type: String, default: '' },
  resources: { type: [String], default: [] }, // free-text titles/links
  createdBy: { type: String, default: '' }
}, { timestamps: true });

// ============================================================
// Sermon Notes (section 17) — personal, member-owned; never visible to
// anyone but the member who wrote them (and admins, only for moderation).
// ============================================================
const sermonNoteSchema = new Schema({
  id: { type: String, required: true, unique: true },
  memberId: { type: String, required: true, index: true },
  chapterId: { type: String, default: '' },
  sermonTitle: { type: String, default: '' },
  preacher: { type: String, default: '' },
  date: { type: String, default: '' },
  scripture: { type: String, default: '' },
  notes: { type: String, default: '' },
  summary: { type: String, default: '' },
  keyLessons: { type: String, default: '' },
  reflections: { type: String, default: '' }
}, { timestamps: true });

const testimonySchema = new Schema({
  id: { type: String, required: true, unique: true },
  chapterId: { type: String, default: '', index: true },
  name: String,
  testimony: String,
  published: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const contactMessageSchema = new Schema({
  id: { type: String, required: true, unique: true },
  chapterId: { type: String, default: '', index: true },
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

// ============================================================
// Groups (section 20) — Bible Study / Prayer / Fellowship / Department /
// Cell / other. Distinct from Department (section 21): a Department is a
// chapter's formal organisational unit; a Group is a smaller, informal
// gathering that can optionally sit under one (linkedDepartmentId).
// ============================================================
const groupSchema = new Schema({
  id: { type: String, required: true, unique: true },
  chapterId: { type: String, default: '', index: true },
  name: { type: String, required: true },
  type: { type: String, enum: ['bible_study', 'prayer', 'fellowship', 'department', 'cell', 'other'], default: 'other' },
  description: { type: String, default: '' },
  linkedDepartmentId: { type: String, default: '' },
  leaderMemberId: { type: String, default: '' },
  leaderName: { type: String, default: '' },
  meetingDay: { type: String, default: '' },
  meetingTime: { type: String, default: '' },
  meetingLocation: { type: String, default: '' },
  memberIds: { type: [String], default: [] },
  resources: { type: [{ title: String, url: String }], default: [] },
  createdBy: { type: String, default: '' }
}, { timestamps: true });

// A group's combined announcement/discussion feed — a leader's post can be
// flagged as an announcement (pinned to the top); anything else is just
// members talking. One feed rather than two separate systems.
const groupPostSchema = new Schema({
  id: { type: String, required: true, unique: true },
  chapterId: { type: String, default: '', index: true },
  groupId: { type: String, required: true, index: true },
  authorMemberId: { type: String, default: '' },
  authorName: { type: String, default: '' },
  body: { type: String, required: true },
  isAnnouncement: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const groupMeetingSchema = new Schema({
  id: { type: String, required: true, unique: true },
  chapterId: { type: String, default: '', index: true },
  groupId: { type: String, required: true, index: true },
  date: { type: String, required: true },
  topic: { type: String, default: '' },
  location: { type: String, default: '' },
  attendeeMemberIds: { type: [String], default: [] },
  notes: { type: String, default: '' },
  recordedBy: { type: String, default: '' }
}, { timestamps: true });

// ============================================================
// Community Chat (section 19) — chapter-wide discussion, separate from a
// Group's own feed. Moderation is deliberately simple: hide (soft-delete,
// so nothing is destroyed outright), report, and restrict a member from
// posting further (Member.chatRestricted, checked at post time).
// ============================================================
const chatTopicSchema = new Schema({
  id: { type: String, required: true, unique: true },
  chapterId: { type: String, default: '', index: true },
  title: { type: String, required: true },
  createdByMemberId: { type: String, default: '' },
  createdByName: { type: String, default: '' },
  locked: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const chatMessageSchema = new Schema({
  id: { type: String, required: true, unique: true },
  chapterId: { type: String, default: '', index: true },
  topicId: { type: String, required: true, index: true },
  authorMemberId: { type: String, default: '' },
  authorName: { type: String, default: '' },
  body: { type: String, required: true },
  reportCount: { type: Number, default: 0 },
  hidden: { type: Boolean, default: false }, // moderator soft-delete — content stays for audit, just stops showing
  hiddenBy: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

// ============================================================
// Volunteer / Service Scheduling (section 23)
// ============================================================
const volunteerAssignmentSchema = new Schema({
  id: { type: String, required: true, unique: true },
  chapterId: { type: String, default: '', index: true },
  eventId: { type: String, required: true, index: true },
  role: {
    type: String,
    enum: ['usher', 'prayer_team', 'media', 'musician', 'protocol', 'publicity', 'transport', 'other'],
    required: true
  },
  memberId: { type: String, required: true },
  memberName: { type: String, default: '' },
  status: { type: String, enum: ['assigned', 'confirmed', 'declined'], default: 'assigned' },
  notes: { type: String, default: '' },
  assignedBy: { type: String, default: '' }
}, { timestamps: true });

// ============================================================
// Member Milestones (section 36) — birthdays already have their own
// automatic daily check (see server.js); this covers the ones that need a
// human to notice and log them: graduation, a new executive appointment,
// membership anniversaries, or anything else worth celebrating.
// ============================================================
const milestoneSchema = new Schema({
  id: { type: String, required: true, unique: true },
  chapterId: { type: String, default: '', index: true },
  // Not required — an executive-appointment milestone can fire for a staff
  // account with no linked Member profile yet (see server.js: logMilestone).
  memberId: { type: String, default: '' },
  memberName: { type: String, default: '' },
  type: { type: String, enum: ['graduation', 'executive_appointment', 'membership_anniversary', 'other'], default: 'other' },
  note: { type: String, default: '' },
  loggedBy: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

// ============================================================
// Welfare (section 33) — a member's own request, or a referral Shepherding
// notices during pastoral care (section 7, 22). Sensitive by nature: only
// welfare officers and chapter leadership ever see the description/notes in
// full — see requireWelfareAccess in server.js.
// ============================================================
const welfareRequestSchema = new Schema({
  id: { type: String, required: true, unique: true },
  chapterId: { type: String, default: '', index: true },
  memberId: { type: String, default: '' },
  memberName: { type: String, default: '' },
  category: { type: String, enum: ['financial', 'medical', 'bereavement', 'academic', 'other'], default: 'other' },
  description: { type: String, default: '' },
  amountRequested: { type: Number, default: 0 },
  status: { type: String, enum: ['submitted', 'under_review', 'approved', 'declined', 'fulfilled'], default: 'submitted' },
  notes: { type: String, default: '' }, // welfare-officer-only case notes
  referredBy: { type: String, default: '' }, // set when Shepherding raises it on someone's behalf
  handledBy: { type: String, default: '' }
}, { timestamps: true });

// ============================================================
// Giving (section 32) — deliberately NOT a live payment gateway (no card
// charging happens anywhere in this codebase). A member is shown their
// chapter's real MoMo/bank details (Chapter.payment) and logs what they
// sent; Finance reconciles each claim into a real ledger entry or rejects
// it. This is the same "manual, honest, no pretending" pattern the app
// already uses for SMS/email — nothing here claims to move money it can't
// actually move.
// ============================================================
const givingIntentSchema = new Schema({
  id: { type: String, required: true, unique: true },
  chapterId: { type: String, default: '', index: true },
  memberId: { type: String, default: '' },
  memberName: { type: String, default: '' },
  amount: { type: Number, required: true },
  purpose: { type: String, enum: ['momo', 'tithe', 'harvest', 'offertory', 'other'], default: 'other' },
  method: { type: String, enum: ['momo', 'bank', 'cash', 'other'], default: 'momo' },
  reference: { type: String, default: '' }, // the transaction id/reference the member provides
  status: { type: String, enum: ['pending', 'confirmed', 'rejected'], default: 'pending' },
  matchedFinanceEntryId: { type: String, default: '' }, // set once Finance confirms it into the real ledger
  reviewNotes: { type: String, default: '' },
  reviewedBy: { type: String, default: '' }
}, { timestamps: true });

module.exports = {
  Chapter: mongoose.model('Chapter', chapterSchema),
  FeatureFlags: mongoose.model('FeatureFlags', featureFlagsSchema),
  Form: mongoose.model('Form', formSchema),
  FormSubmission: mongoose.model('FormSubmission', formSubmissionSchema),
  BibleStudy: mongoose.model('BibleStudy', bibleStudySchema),
  SermonNote: mongoose.model('SermonNote', sermonNoteSchema),
  Group: mongoose.model('Group', groupSchema),
  GroupPost: mongoose.model('GroupPost', groupPostSchema),
  GroupMeeting: mongoose.model('GroupMeeting', groupMeetingSchema),
  ChatTopic: mongoose.model('ChatTopic', chatTopicSchema),
  ChatMessage: mongoose.model('ChatMessage', chatMessageSchema),
  VolunteerAssignment: mongoose.model('VolunteerAssignment', volunteerAssignmentSchema),
  Milestone: mongoose.model('Milestone', milestoneSchema),
  WelfareRequest: mongoose.model('WelfareRequest', welfareRequestSchema),
  GivingIntent: mongoose.model('GivingIntent', givingIntentSchema),
  Department: mongoose.model('Department', departmentSchema),
  Event: mongoose.model('Event', eventSchema),
  Sermon: mongoose.model('Sermon', sermonSchema),
  ContentItem: mongoose.model('ContentItem', contentItemSchema),
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
