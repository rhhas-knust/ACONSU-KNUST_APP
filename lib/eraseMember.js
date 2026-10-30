// Erasing a member, and handing them everything held about them.
//
// The privacy page promises both. One routine does each, used by the chapter
// admin's "delete member" button and by the member's own "Delete my account"
// on their profile, so the two can never do different things.
//
// PLAN below names, for every kind of record that holds a member's id, what
// erasing does to it and what the export gives back. test/privacy.js reads
// every schema in lib/models.js and fails if a field holding a member's id is
// missing here, so a new record type cannot be added and quietly forgotten.
//
// What erasing does, in short:
//   - what is theirs alone is deleted: notes, requests, posts, messages,
//     registrations, care notes, devices, their photo;
//   - money is never deleted, because the books must still add up: the rows
//     stay and their name comes off them;
//   - counts stay right: a Sunday they were at still counts one more person,
//     with no name on the mark;
//   - they come off other people's records: groups, meetings, prayer lists,
//     anyone they shepherded;
//   - a leadership login linked to them is closed and signed out, and their
//     office shows as vacant until it is handed over;
//   - every session they have, on every device, ends.
// Records that arrived without an account (a contact message, a join request,
// an alumni form, texts sent to them) are matched by their email address or
// phone number, within their chapter.

const models = require('./models');
const gridfs = require('./gridfs');
const { phoneKey } = require('./peopleImport');

const FORMER = 'Former member';
const lower = (v) => String(v == null ? '' : v).trim().toLowerCase();

// For a model, each field that holds a member id, and in words what happens
// to it. `erase` and `export` below follow this; the test checks it covers
// every schema.
const PLAN = {
  Member: { fields: ['shepherdMemberId'], erase: 'the record is deleted; members they shepherded lose the link', export: 'their profile' },
  FormSubmission: { fields: ['memberId'], erase: 'deleted', export: 'every form they sent' },
  SermonNote: { fields: ['memberId'], erase: 'deleted', export: 'their sermon notes' },
  Group: { fields: ['leaderMemberId', 'memberIds'], erase: 'taken off; a group they led has no leader', export: 'the groups they are in' },
  GroupPost: { fields: ['authorMemberId'], erase: 'deleted', export: 'their posts' },
  GroupMeeting: { fields: ['attendeeMemberIds'], erase: 'taken off the attendance', export: 'meetings they attended' },
  DepartmentMeeting: { fields: ['attendeeMemberIds'], erase: 'taken off the attendance', export: 'meetings they attended' },
  ChatTopic: { fields: ['createdByMemberId'], erase: 'kept for the others in it, with no name', export: 'topics they started' },
  ChatMessage: { fields: ['authorMemberId'], erase: 'deleted', export: 'their messages' },
  VolunteerAssignment: { fields: ['memberId'], erase: 'deleted', export: 'their volunteer roles' },
  Milestone: { fields: ['memberId'], erase: 'deleted', export: 'their milestones' },
  WelfareRequest: { fields: ['memberId'], erase: 'deleted', export: 'their welfare requests' },
  WelfareEntry: { fields: ['memberId', 'recordedByMemberId'], erase: 'money kept, name removed', export: 'welfare money in their name' },
  GivingIntent: { fields: ['memberId'], erase: 'money kept, name and the number it was sent from removed, also from the ledger rows it became', export: 'their giving' },
  RetentionAlert: { fields: ['memberId'], erase: 'deleted', export: 'follow-ups raised about them' },
  OnboardingTask: { fields: ['memberId'], erase: 'deleted', export: 'welcome messages scheduled for them' },
  DepartmentRequest: { fields: ['memberId'], erase: 'deleted', export: 'their requests to join departments' },
  AlumniProfile: { fields: ['memberId'], erase: 'deleted', export: 'their alumni profile' },
  PrayerRequest: { fields: ['memberId', 'prayingMemberIds'], erase: 'theirs deleted; taken off others\' praying lists', export: 'their prayer requests' },
  EventRegistration: { fields: ['memberId'], erase: 'deleted', export: 'events they registered for' },
  PushSubscription: { fields: ['memberId'], erase: 'deleted', export: 'devices that get notifications' },
  ShepherdingRecord: { fields: ['memberId'], erase: 'deleted, with its photo', export: 'their care record' },
  AttendanceRecord: { fields: ['marks.memberId'], erase: 'the mark kept so the count stays right, with no name', export: 'services they were marked at' },
  StaffUser: { fields: ['memberId'], erase: 'closed, signed out and unlinked; the office shows as vacant', export: 'leadership logins linked to them' }
};

// The fields of a record that are never handed out, even to its owner.
const SECRET = ['_id', '__v', 'passwordHash', 'resetTokenHash', 'resetTokenExpires', 'qrToken', 'sessionsRevokedAt', 'keys', 'endpoint'];
const strip = (doc) => {
  if (!doc) return doc;
  const out = { ...doc };
  SECRET.forEach((k) => delete out[k]);
  return out;
};

async function all(Model, query) {
  return Model.find(query).lean();
}

// The one person, as the records outside their account can find them.
function who(member) {
  return {
    id: String(member.id),
    chapterId: member.chapterId || '',
    name: String(member.name || '').trim(),
    email: lower(member.email),
    phone: phoneKey(member.phone)
  };
}

// Within their chapter, records without an account that are theirs by email
// or phone. A field that is empty never matches.
async function matchedBy(Model, p, { emailField, phoneField }) {
  const docs = await all(Model, { chapterId: p.chapterId });
  return docs.filter((d) => (emailField && p.email && lower(d[emailField]) === p.email)
    || (phoneField && p.phone && phoneKey(d[phoneField]) === p.phone));
}

// "Giving confirmed, Ama Mensah" -> "Giving confirmed, a former member". Only a
// full name of two words or more is replaced, so a short first name is never
// cut out of somebody else's text.
function scrubName(text, name) {
  const s = String(text == null ? '' : text);
  if (!name || name.split(/\s+/).length < 2) return s;
  return s.split(name).join('a former member');
}

// ---------------------------------------------------------------- erase --
// hooks: { revokeMember(id), revokeStaff(id), endSessions({ memberId, staffIds }) }
// Returns what was done, counted by kind, for the caller to log or show.
async function erase(memberId, hooks = {}) {
  const member = await models.Member.findOne({ id: String(memberId) }).lean();
  if (!member) return null;
  const p = who(member);
  const done = {};
  const count = (k, n) => { if (n) done[k] = (done[k] || 0) + n; };
  const files = new Set([member.profileImageFileId].filter(Boolean));

  // Their leadership logins: closed now, before anything else, so nothing
  // they still have open can act while the rest is removed.
  const accounts = await all(models.StaffUser, { memberId: p.id });
  const staffIds = accounts.map((a) => String(a.id));
  for (const a of accounts) {
    await models.StaffUser.updateOne({ id: a.id }, {
      $set: { active: false, memberId: '', name: 'Former holder', endedAt: new Date(), termEndsAt: new Date(), sessionsRevokedAt: new Date() }
    });
    if (hooks.revokeStaff) await hooks.revokeStaff(a.id);
  }
  count('leadership logins closed', accounts.length);
  if (hooks.revokeMember) await hooks.revokeMember(p.id);

  // The public roster card for an office they held: the office stays, they go.
  const cards = (await all(models.Executive, { chapterId: p.chapterId }))
    .filter((c) => (c.staffId && staffIds.includes(String(c.staffId))) || (p.email && lower(c.contact && c.contact.email) === p.email));
  for (const c of cards) {
    if (c.imageFileId) files.add(c.imageFileId);
    await models.Executive.updateOne({ id: c.id }, { $set: { name: 'Vacant', bio: '', contact: { phone: '', email: '' }, imageFileId: '' } });
  }
  count('roster cards emptied', cards.length);

  // Theirs alone: deleted.
  const byMember = [
    ['FormSubmission', 'memberId'], ['SermonNote', 'memberId'], ['GroupPost', 'authorMemberId'], ['ChatMessage', 'authorMemberId'],
    ['VolunteerAssignment', 'memberId'], ['Milestone', 'memberId'], ['WelfareRequest', 'memberId'], ['RetentionAlert', 'memberId'],
    ['OnboardingTask', 'memberId'], ['DepartmentRequest', 'memberId'], ['AlumniProfile', 'memberId'], ['PrayerRequest', 'memberId'],
    ['EventRegistration', 'memberId'], ['PushSubscription', 'memberId']
  ];
  for (const [name, field] of byMember) {
    const r = await models[name].deleteMany({ [field]: p.id });
    count(name, r.deletedCount || 0);
  }
  const care = await all(models.ShepherdingRecord, { memberId: p.id });
  care.forEach((r) => { if (r.imageFileId) files.add(r.imageFileId); });
  count('ShepherdingRecord', (await models.ShepherdingRecord.deleteMany({ memberId: p.id })).deletedCount || 0);

  // Theirs, sent without an account: matched by email or phone.
  const unsigned = [
    ['FormSubmission', { emailField: 'submitterEmail' }], ['EventRegistration', { emailField: 'email', phoneField: 'phone' }],
    ['PrayerRequest', { emailField: 'email' }], ['ContactMessage', { emailField: 'email' }],
    ['JoinRequest', { emailField: 'email', phoneField: 'phone' }], ['AlumniDetail', { emailField: 'email', phoneField: 'phone' }],
    ['AlumniEntry', { emailField: 'contact', phoneField: 'contact' }], ['SmsLog', { phoneField: 'to' }]
  ];
  for (const [name, how] of unsigned) {
    const found = await matchedBy(models[name], p, how);
    for (const d of found) {
      if (d.imageFileId) files.add(d.imageFileId);
      await models[name].deleteOne({ id: d.id });
    }
    count(name, found.length);
  }

  // Off other people's records.
  const pulls = [['Group', 'memberIds'], ['GroupMeeting', 'attendeeMemberIds'], ['DepartmentMeeting', 'attendeeMemberIds'], ['PrayerRequest', 'prayingMemberIds']];
  for (const [name, field] of pulls) {
    const hit = await all(models[name], { [field]: p.id });
    if (hit.length) await models[name].updateMany({ [field]: p.id }, { $pull: { [field]: p.id } });
    count(`${name} lists left`, hit.length);
  }
  const led = await all(models.Group, { leaderMemberId: p.id });
  if (led.length) await models.Group.updateMany({ leaderMemberId: p.id }, { $set: { leaderMemberId: '', leaderName: '' } });
  count('groups left without a leader', led.length);
  const flock = await all(models.Member, { shepherdMemberId: p.id });
  if (flock.length) await models.Member.updateMany({ shepherdMemberId: p.id }, { $set: { shepherdMemberId: '', shepherdName: '' } });
  count('members who lose them as shepherd', flock.length);
  const topics = await all(models.ChatTopic, { createdByMemberId: p.id });
  if (topics.length) await models.ChatTopic.updateMany({ createdByMemberId: p.id }, { $set: { createdByMemberId: '', createdByName: FORMER } });
  count('chat topics kept without a name', topics.length);

  // Money: kept, with no name.
  const gifts = await all(models.GivingIntent, { memberId: p.id });
  for (const g of gifts) {
    if (g.matchedFinanceEntryId) {
      const e = await models.FinanceEntry.findOne({ id: g.matchedFinanceEntryId }).lean();
      if (e) {
        await models.FinanceEntry.updateOne({ id: e.id }, { $set: {
          payee: lower(e.payee) === lower(p.name) ? FORMER : scrubName(e.payee, p.name),
          description: scrubName(e.description, p.name)
        } });
      }
    }
  }
  if (gifts.length) await models.GivingIntent.updateMany({ memberId: p.id }, { $set: { memberId: '', memberName: FORMER, payerNumber: '' } });
  count('gifts kept without a name', gifts.length);
  const welfare = await all(models.WelfareEntry, { memberId: p.id });
  for (const w of welfare) {
    await models.WelfareEntry.updateOne({ id: w.id }, { $set: { memberId: '', memberName: FORMER, description: scrubName(w.description, p.name) } });
  }
  count('welfare money kept without a name', welfare.length);
  const recorded = await all(models.WelfareEntry, { recordedByMemberId: p.id });
  if (recorded.length) await models.WelfareEntry.updateMany({ recordedByMemberId: p.id }, { $set: { recordedByMemberId: '', recordedBy: FORMER } });
  count('welfare entries they recorded', recorded.length);

  // Sundays: the mark stays, so the count does; the name goes. The register is
  // written under its revision, as check-in does, so a check-in at the door at
  // the same moment is not lost.
  const registers = (await all(models.AttendanceRecord, { chapterId: p.chapterId }))
    .filter((r) => (r.marks || []).some((m) => m.memberId === p.id));
  for (let r of registers) {
    for (let tries = 0; tries < 5 && r; tries += 1) {
      const marks = (r.marks || []).map((m) => (m.memberId === p.id ? { ...m, memberId: '', recordId: '', name: FORMER } : m));
      const res = await models.AttendanceRecord.updateOne({ id: r.id, rev: r.rev || 0 }, { $set: { marks }, $inc: { rev: 1 } });
      if (res.modifiedCount) break;
      r = await models.AttendanceRecord.findOne({ id: r.id }).lean();
    }
  }
  count('Sunday marks kept without a name', registers.length);

  // Their full name in the chapter's notifications ("Congratulations, Ama Mensah!").
  if (p.name.split(/\s+/).length >= 2) {
    const notes = (await all(models.Notification, { chapterId: p.chapterId }))
      .filter((n) => String(n.title || '').includes(p.name) || String(n.body || '').includes(p.name));
    for (const n of notes) {
      await models.Notification.updateOne({ id: n.id }, { $set: { title: scrubName(n.title, p.name), body: scrubName(n.body, p.name) } });
    }
    count('notifications with their name removed', notes.length);
  }

  // Last, the account itself, its pictures, and every session it has.
  await models.Member.deleteOne({ id: p.id });
  count('Member', 1);
  for (const f of files) await gridfs.deleteFile(f).catch(() => {});
  count('files', files.size);
  if (hooks.endSessions) await hooks.endSessions({ memberId: p.id, staffIds });
  return { memberId: p.id, chapterId: p.chapterId, done };
}

// --------------------------------------------------------------- export --
// Everything held about them, as plain data. Other people's ids and names
// are left out of shared records (a group's member list, a register's other
// marks); their own records come whole, minus secrets.
async function exportData(memberId) {
  const member = await models.Member.findOne({ id: String(memberId) }).lean();
  if (!member) return null;
  const p = who(member);
  const mine = async (name, field) => (await all(models[name], { [field]: p.id })).map(strip);
  const out = {
    about: 'Everything ACONSU holds about you, as of the date below. See the privacy page for what each part is and how long it is kept.',
    exportedAt: new Date().toISOString(),
    profile: strip(member)
  };
  out.formsSent = await mine('FormSubmission', 'memberId');
  out.sermonNotes = await mine('SermonNote', 'memberId');
  out.groups = (await all(models.Group, { memberIds: p.id })).map((g) => ({ name: g.name, youLeadIt: g.leaderMemberId === p.id }));
  out.groupPosts = await mine('GroupPost', 'authorMemberId');
  out.meetingsAttended = [
    ...(await all(models.GroupMeeting, { attendeeMemberIds: p.id })).map((m) => ({ kind: 'group', title: m.title || '', date: m.date || m.createdAt })),
    ...(await all(models.DepartmentMeeting, { attendeeMemberIds: p.id })).map((m) => ({ kind: 'department', title: m.title || '', date: m.date || m.createdAt }))
  ];
  out.chatTopicsStarted = (await all(models.ChatTopic, { createdByMemberId: p.id })).map((t) => ({ title: t.title, createdAt: t.createdAt }));
  out.chatMessages = await mine('ChatMessage', 'authorMemberId');
  out.volunteerRoles = await mine('VolunteerAssignment', 'memberId');
  out.milestones = await mine('Milestone', 'memberId');
  out.welfareRequests = await mine('WelfareRequest', 'memberId');
  out.welfareMoney = await mine('WelfareEntry', 'memberId');
  out.welfareEntriesYouRecorded = (await all(models.WelfareEntry, { recordedByMemberId: p.id })).map((w) => ({ date: w.date, amount: w.amount, type: w.entryType || w.type || '' }));
  out.giving = await mine('GivingIntent', 'memberId');
  out.followUps = await mine('RetentionAlert', 'memberId');
  out.welcomeMessages = await mine('OnboardingTask', 'memberId');
  out.departmentRequests = await mine('DepartmentRequest', 'memberId');
  out.alumniProfile = await mine('AlumniProfile', 'memberId');
  out.prayerRequests = (await mine('PrayerRequest', 'memberId')).map((r) => ({ ...r, prayingMemberIds: undefined, peoplePraying: (r.prayingMemberIds || []).length }));
  out.eventRegistrations = await mine('EventRegistration', 'memberId');
  out.devicesForNotifications = (await all(models.PushSubscription, { memberId: p.id })).map((s) => ({ addedAt: s.createdAt }));
  out.careRecord = await mine('ShepherdingRecord', 'memberId');
  out.sundays = (await all(models.AttendanceRecord, { chapterId: p.chapterId })).flatMap((r) => (r.marks || [])
    .filter((m) => m.memberId === p.id).map((m) => ({ date: r.date, service: r.serviceType, status: m.status, at: m.at })));
  out.leadershipLogins = (await all(models.StaffUser, { memberId: p.id })).map((a) => strip({
    username: a.username, role: a.role, positionKey: a.positionKey || '', active: a.active !== false, termYear: a.termYear || '', termEndsAt: a.termEndsAt || null
  }));
  out.sentWithoutAnAccount = {
    contactMessages: (await matchedBy(models.ContactMessage, p, { emailField: 'email' })).map(strip),
    joinRequests: (await matchedBy(models.JoinRequest, p, { emailField: 'email', phoneField: 'phone' })).map(strip),
    alumniForms: (await matchedBy(models.AlumniDetail, p, { emailField: 'email', phoneField: 'phone' })).map(strip),
    alumniWall: (await matchedBy(models.AlumniEntry, p, { emailField: 'contact', phoneField: 'contact' })).map(strip),
    formsSent: (await matchedBy(models.FormSubmission, p, { emailField: 'submitterEmail' })).filter((d) => d.memberId !== p.id).map(strip),
    eventRegistrations: (await matchedBy(models.EventRegistration, p, { emailField: 'email', phoneField: 'phone' })).filter((d) => d.memberId !== p.id).map(strip),
    prayerRequests: (await matchedBy(models.PrayerRequest, p, { emailField: 'email' })).filter((d) => d.memberId !== p.id).map((r) => ({ ...strip(r), prayingMemberIds: undefined }))
  };
  out.textsSentToYou = (await matchedBy(models.SmsLog, p, { phoneField: 'to' })).map((s) => ({ sentAt: s.createdAt, message: s.body, status: s.status }));
  return JSON.parse(JSON.stringify(out));
}

module.exports = { PLAN, erase, exportData, scrubName };
