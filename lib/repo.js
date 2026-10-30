const models = require('./models');
const activityBus = require('./activityBus');

// The resources the operational dashboard's activity stream (Phase 2) draws
// from - see buildChapterOverview() in server.js for the matching read side.
// Kept as a small allowlist rather than emitting for every resource so an
// unrelated high-volume write (e.g. chat messages) can't spam every open
// dashboard.
const ACTIVITY_RESOURCES = new Set([
  'joinRequests', 'prayerRequests', 'contactMessages', 'attendanceRecords', 'financeEntries', 'notifications'
]);

const RESOURCE_MODELS = {
  chapters: models.Chapter,
  departments: models.Department,
  departmentRequests: models.DepartmentRequest,
  alumniProfiles: models.AlumniProfile,
  alumniEntries: models.AlumniEntry,
  alumniDetails: models.AlumniDetail,
  alumniSpotlights: models.AlumniSpotlight,
  monthlyThemes: models.MonthlyTheme,
  meetingRooms: models.MeetingRoom,
  events: models.Event,
  sermons: models.Sermon,
  contentItems: models.ContentItem,
  joinRequests: models.JoinRequest,
  prayerRequests: models.PrayerRequest,
  testimonies: models.Testimony,
  contactMessages: models.ContactMessage,
  pages: models.CustomPage,
  eventRegistrations: models.EventRegistration,
  executives: models.Executive,
  churchFounders: models.ChurchFounder,
  members: models.Member,
  notifications: models.Notification,
  pushSubscriptions: models.PushSubscription,
  shepherdingRecords: models.ShepherdingRecord,
  financeEntries: models.FinanceEntry,
  budgets: models.Budget,
  attendanceRecords: models.AttendanceRecord,
  scheduledNotifications: models.ScheduledNotification,
  smsLogs: models.SmsLog,
  staffUsers: models.StaffUser,
  forms: models.Form,
  formSubmissions: models.FormSubmission,
  bibleStudies: models.BibleStudy,
  sermonNotes: models.SermonNote,
  groups: models.Group,
  groupPosts: models.GroupPost,
  groupMeetings: models.GroupMeeting,
  departmentMeetings: models.DepartmentMeeting,
  executiveMinutes: models.ExecutiveMinute,
  semesterOutlines: models.SemesterOutline,
  budgetCalls: models.BudgetCall,
  budgetSubmissions: models.BudgetSubmission,
  announcementCalls: models.AnnouncementCall,
  announcementItems: models.AnnouncementItem,
  committees: models.Committee,
  chapterRequests: models.ChapterRequest,
  dailyVerses: models.DailyVerse,
  councilPosts: models.CouncilPost,
  chatTopics: models.ChatTopic,
  chatMessages: models.ChatMessage,
  volunteerAssignments: models.VolunteerAssignment,
  milestones: models.Milestone,
  welfareRequests: models.WelfareRequest,
  welfareEntries: models.WelfareEntry,
  givingIntents: models.GivingIntent,
  retentionAlerts: models.RetentionAlert,
  onboardingTasks: models.OnboardingTask,
  reconciliationBatches: models.ReconciliationBatch
};

// ---------- chapter walls ----------
// Records that hold people's data or a chapter's own work. Reading or writing
// one of these without saying which chapter is refused: the call must carry a
// chapterId in its filter (for a create, in the data), or say explicitly that
// it spans every chapter with ALL_CHAPTERS. A route that forgets the chapter
// then fails loudly in the tests instead of quietly reading every chapter's
// members. National oversight keeps working: its cross-chapter reads say so
// (GOVERNANCE_TIER_REVIEW.md: national sees aggregates and national records by
// default, not merged chapter member data).
//
// Not here: the chapters themselves, and what is union-wide or public by
// design (the alumni wall and Alumni Connect, monthly themes, events, sermons,
// pages, content, departments, the roster cards, founders, the council,
// notifications).
const CHAPTER_SCOPED = new Set([
  'members', 'staffUsers', 'shepherdingRecords', 'financeEntries', 'budgets', 'attendanceRecords', 'smsLogs',
  'scheduledNotifications', 'pushSubscriptions', 'joinRequests', 'prayerRequests', 'testimonies', 'contactMessages',
  'eventRegistrations', 'formSubmissions', 'groups', 'groupPosts', 'groupMeetings', 'departmentMeetings',
  'departmentRequests', 'executiveMinutes', 'semesterOutlines', 'budgetCalls', 'budgetSubmissions', 'announcementCalls',
  'announcementItems', 'committees', 'chatTopics', 'chatMessages', 'volunteerAssignments', 'milestones', 'welfareRequests',
  'welfareEntries', 'givingIntents', 'retentionAlerts', 'onboardingTasks', 'reconciliationBatches', 'sermonNotes',
  'meetingRooms', 'chapterRequests'
]);

// "Every chapter, on purpose." A symbol, so it never reaches the database: a
// filter carrying it can still be handed straight to a model, and means there
// exactly what {} meant.
const ALL_CHAPTERS = Symbol.for('aconsu.allChapters');
const allChapters = (filter) => ({ ...(filter || {}), [ALL_CHAPTERS]: true });
// The same pass, for a record found by something only its owner holds: the
// member id in their own signed-in session. It can only ever be theirs, in
// their own chapter, so naming the chapter adds nothing.
const ownRecord = allChapters;

// A filter names a chapter when it has a chapterId, or every branch of an
// $or / $and does.
function namesChapter(filter) {
  if (!filter || typeof filter !== 'object') return false;
  if (filter[ALL_CHAPTERS]) return true;
  if (Object.prototype.hasOwnProperty.call(filter, 'chapterId')) return true;
  const branches = filter.$and || filter.$or;
  return Array.isArray(branches) && branches.length > 0 && branches.every(namesChapter);
}

// CHAPTER_GUARD: 'refuse' (the default) throws; 'warn' logs once per call site
// and lets it through, an escape hatch for production if a route the tests do
// not reach turns out to forget its chapter; 'off' does nothing.
const warned = new Set();
function guard(resource, filter, how) {
  if (!CHAPTER_SCOPED.has(resource) || namesChapter(filter)) return;
  const mode = String(process.env.CHAPTER_GUARD || 'refuse').toLowerCase();
  if (mode === 'off') return;
  const where = (new Error().stack || '').split('\n').slice(3, 4).join('').trim();
  const message = `${how} on ${resource} without a chapter (pass { chapterId } or repo.allChapters()) ${where}`;
  if (mode === 'warn') {
    if (!warned.has(where)) { warned.add(where); console.warn(`CHAPTER GUARD: ${message}`); }
    return;
  }
  const err = new Error(`Chapter guard: ${message}`);
  err.chapterGuard = true;
  throw err;
}

function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function clean(doc) {
  if (!doc) return doc;
  const obj = doc.toObject ? doc.toObject() : doc;
  delete obj._id;
  delete obj.__v;
  return obj;
}

function modelFor(resource) {
  const model = RESOURCE_MODELS[resource];
  if (!model) throw new Error(`Unknown resource: ${resource}`);
  return model;
}

// `filter` is an optional Mongo-style query object, used throughout server.js
// to scope a read to one chapter (e.g. `repo.getAll('events', { chapterId })`).
// Omitting it keeps every existing call site working unchanged.
//
// `options` is optional too: { sort: { createdAt: -1 }, limit: 40 } makes the
// database do the ordering and the cut, so a list that only ever shows the
// newest few does not read the whole collection to find them.
async function getAll(resource, filter, options) {
  guard(resource, filter, 'a read');
  let query = modelFor(resource).find(filter || {});
  if (options && options.sort) query = query.sort(options.sort);
  if (options && options.limit) query = query.limit(options.limit);
  const docs = await query.lean();
  return docs.map((d) => {
    delete d._id;
    delete d.__v;
    return d;
  });
}

async function getById(resource, id, filter) {
  guard(resource, filter, 'a read by id');
  const doc = await modelFor(resource).findOne({ id, ...(filter || {}) }).lean();
  if (!doc) return null;
  delete doc._id;
  delete doc.__v;
  return doc;
}

async function create(resource, data, idPrefix) {
  guard(resource, data, 'a create');
  const Model = modelFor(resource);
  const id = data.id || genId(idPrefix || resource.slice(0, 4));
  const doc = await Model.create({ ...data, id });
  const created = clean(doc);
  if (ACTIVITY_RESOURCES.has(resource) && created.chapterId) {
    activityBus.emit('activity', { chapterId: created.chapterId, resource });
  }
  return created;
}

// `filter` (optional) narrows which document can be touched - e.g. passing
// { chapterId } means a chapter-scoped route can never update/delete another
// chapter's record even if it somehow guessed a valid id (section 43: chapter
// isolation must hold against a manipulated id, not just a hidden button).
async function updateById(resource, id, data, filter) {
  guard(resource, filter, 'an update');
  const Model = modelFor(resource);
  const doc = await Model.findOneAndUpdate(
    { id, ...(filter || {}) },
    { $set: { ...data, id } },
    { new: true }
  );
  return clean(doc);
}

async function patchById(resource, id, data, filter) {
  guard(resource, filter, 'an update');
  const Model = modelFor(resource);
  const doc = await Model.findOneAndUpdate({ id, ...(filter || {}) }, { $set: data }, { new: true });
  return clean(doc);
}

async function removeById(resource, id, filter) {
  guard(resource, filter, 'a delete');
  const result = await modelFor(resource).deleteOne({ id, ...(filter || {}) });
  return result.deletedCount > 0;
}

async function getSettings() {
  let doc = await models.Settings.findOne({ singleton: 'main' }).lean();
  if (!doc) return {};
  delete doc._id;
  delete doc.__v;
  return doc;
}

async function setSettings(data) {
  const doc = await models.Settings.findOneAndUpdate(
    { singleton: 'main' },
    { $set: { ...data, singleton: 'main' } },
    { new: true, upsert: true }
  );
  return clean(doc);
}

module.exports = {
  genId, getAll, getById, create, updateById, patchById, removeById,
  getSettings, setSettings,
  CHAPTER_SCOPED, ALL_CHAPTERS, allChapters, ownRecord, namesChapter
};
