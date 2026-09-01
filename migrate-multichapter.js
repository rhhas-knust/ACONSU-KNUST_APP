// One-time migration to the multi-chapter data model (Phase 2 of the ACONSU
// platform spec). Run once, after deploying the new code, whenever you're
// ready to cut over:
//
//   node migrate-multichapter.js
//
// Safe to re-run: it only ever fills in a missing chapterId — it never
// touches a document that already has one, so running it twice (or running
// it after a second chapter already exists) changes nothing extra.
//
// What this does:
//   1. Creates one Chapter document for the chapter that already exists in
//      this database today, using whatever is already in Settings (fellowship
//      name, address, contact email) so nothing has to be retyped.
//   2. Backfills that chapter's id onto every existing chapter-scoped
//      document across every collection that didn't have one yet.
//   3. Grandfathers existing Member accounts straight to 'active' membership
//      (they already went through the old direct-registration flow, so it
//      would be wrong to suddenly demote them to 'visitor') and issues them
//      a membership number + QR token for the digital membership card.
//
// This never deletes or overwrites data that's already there.

require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('./lib/db');
const models = require('./lib/models');
const { LEGACY_CHAPTER_ID } = require('./lib/roles');

// Collections that carry a chapterId field going forward. Each entry is
// [Model, human label] purely for the printed summary.
const CHAPTER_SCOPED = [
  [models.Department, 'departments'],
  [models.Event, 'events'],
  [models.EventRegistration, 'event registrations'],
  [models.Executive, 'executives'],
  [models.Sermon, 'sermons'],
  [models.JoinRequest, 'join requests'],
  [models.PrayerRequest, 'prayer requests'],
  [models.Testimony, 'testimonies'],
  [models.ContactMessage, 'contact messages'],
  [models.CustomPage, 'custom pages'],
  [models.FinanceEntry, 'finance entries'],
  [models.Budget, 'budgets'],
  [models.AttendanceRecord, 'attendance records'],
  [models.ShepherdingRecord, 'shepherding records'],
  [models.ScheduledNotification, 'scheduled notifications'],
  [models.SmsLog, 'SMS logs']
  // Notification and PushSubscription are deliberately left out here: a
  // blank chapterId on those means "national/broadcast", which is exactly
  // what every notification created before chapters existed actually was —
  // backfilling a chapter onto them would incorrectly narrow their audience.
];

async function run() {
  console.log('Connecting to MongoDB Atlas...');
  await connectDB();

  // ---- 1. Seed chapter ----
  let chapter = await models.Chapter.findOne({ id: LEGACY_CHAPTER_ID });
  if (!chapter) {
    const settings = await models.Settings.findOne({ singleton: 'main' }).lean();
    chapter = await models.Chapter.create({
      id: LEGACY_CHAPTER_ID,
      name: (settings && settings.fellowshipName) || 'ACONSU',
      fullName: (settings && settings.fullName) || '',
      institution: 'KNUST',
      address: (settings && settings.address) || '',
      status: 'active',
      contact: {
        email: (settings && settings.email) || '',
        phone: (settings && settings.phone) || '',
        whatsapp: (settings && settings.whatsapp) || '',
        facebook: (settings && settings.facebook) || '',
        instagram: (settings && settings.instagram) || '',
        youtube: (settings && settings.youtube) || ''
      },
      createdBy: 'migrate-multichapter.js'
    });
    console.log(`Created chapter "${chapter.name}" (${chapter.id})`);
  } else {
    console.log(`Chapter "${chapter.name}" (${chapter.id}) already exists — leaving it as is.`);
  }

  // ---- 2. Backfill chapterId everywhere else ----
  const results = {};
  for (const [Model, label] of CHAPTER_SCOPED) {
    const { modifiedCount } = await Model.updateMany(
      { $or: [{ chapterId: { $exists: false } }, { chapterId: '' }] },
      { $set: { chapterId: chapter.id } }
    );
    results[label] = modifiedCount;
  }

  // ---- 3. Members: chapter + grandfathered membership status ----
  const membersToBackfill = await models.Member.find({
    $or: [{ chapterId: { $exists: false } }, { chapterId: '' }]
  });
  let membersUpdated = 0;
  let activeCount = await models.Member.countDocuments({ chapterId: chapter.id, membershipStage: 'active' });
  for (const member of membersToBackfill) {
    member.chapterId = chapter.id;
    if (!member.membershipStage || member.membershipStage === 'visitor') {
      // Pre-existing accounts predate the visitor workflow entirely — they
      // were, in effect, already full members under the old system.
      member.membershipStage = 'active';
    }
    if (member.membershipStage === 'active' && !member.membershipNumber) {
      activeCount += 1;
      member.membershipNumber = `${chapter.id.toUpperCase()}-${String(activeCount).padStart(4, '0')}`;
    }
    if (!member.qrToken) {
      member.qrToken = require('crypto').randomBytes(16).toString('hex');
    }
    await member.save();
    membersUpdated++;
  }
  results.members = membersUpdated;

  // ---- 4. Staff accounts (leadership portal logins) ----
  const staffResult = await models.StaffUser.updateMany(
    { role: { $ne: 'nationalCoordinator' }, $or: [{ chapterId: { $exists: false } }, { chapterId: '' }] },
    { $set: { chapterId: chapter.id } }
  );
  results.staffUsers = staffResult.modifiedCount;

  console.log('\nMulti-chapter migration complete. Documents updated per collection:');
  console.log(results);
  console.log(`\nEverything above is now associated with chapter "${chapter.name}" (${chapter.id}).`);
  console.log('Create additional chapters from the National Coordinator portal (/national.html) whenever you\'re ready.');

  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
