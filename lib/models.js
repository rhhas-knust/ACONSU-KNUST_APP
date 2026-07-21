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
  profileImageFileId: { type: String, default: '' }
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
  Member: mongoose.model('Member', memberSchema)
};
