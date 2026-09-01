const models = require('./models');

const RESOURCE_MODELS = {
  chapters: models.Chapter,
  departments: models.Department,
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
  chatTopics: models.ChatTopic,
  chatMessages: models.ChatMessage,
  volunteerAssignments: models.VolunteerAssignment,
  milestones: models.Milestone,
  welfareRequests: models.WelfareRequest,
  givingIntents: models.GivingIntent
};

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
async function getAll(resource, filter) {
  const docs = await modelFor(resource).find(filter || {}).lean();
  return docs.map((d) => {
    delete d._id;
    delete d.__v;
    return d;
  });
}

async function getById(resource, id, filter) {
  const doc = await modelFor(resource).findOne({ id, ...(filter || {}) }).lean();
  if (!doc) return null;
  delete doc._id;
  delete doc.__v;
  return doc;
}

async function create(resource, data, idPrefix) {
  const Model = modelFor(resource);
  const id = data.id || genId(idPrefix || resource.slice(0, 4));
  const doc = await Model.create({ ...data, id });
  return clean(doc);
}

// `filter` (optional) narrows which document can be touched — e.g. passing
// { chapterId } means a chapter-scoped route can never update/delete another
// chapter's record even if it somehow guessed a valid id (section 43: chapter
// isolation must hold against a manipulated id, not just a hidden button).
async function updateById(resource, id, data, filter) {
  const Model = modelFor(resource);
  const doc = await Model.findOneAndUpdate(
    { id, ...(filter || {}) },
    { $set: { ...data, id } },
    { new: true }
  );
  return clean(doc);
}

async function patchById(resource, id, data, filter) {
  const Model = modelFor(resource);
  const doc = await Model.findOneAndUpdate({ id, ...(filter || {}) }, { $set: data }, { new: true });
  return clean(doc);
}

async function removeById(resource, id, filter) {
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
  getSettings, setSettings
};
