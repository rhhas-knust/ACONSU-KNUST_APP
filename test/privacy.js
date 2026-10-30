// The privacy page's promises, made true: a member can download everything
// held about them and delete their account for good, and the admin's "delete
// member" does exactly the same erasing.
//
//   node test/privacy.js     (also run by `npm test`)
const path = require('path');
const { execFileSync } = require('child_process');
const { fakeModels, fakeGridfs } = require('./harness.js');
const eraseMember = require('../lib/eraseMember');

(async () => {
  process.env.MONGODB_URI = 'mongodb://stub/aconsu_privacy';
  process.env.PORT = '4339';
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'admin123';
  process.env.SESSION_SECRET = 'test';
  process.env.LOGIN_RATE_LIMIT_MAX = '300';
  process.env.PRIVACY_RATE_LIMIT_MAX = '30';
  delete process.env.SHEPHERD_USERNAME;

  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 400)}` : ''}`); }
  }

  console.log('\n== every record that holds a member\'s id is covered ==');
  {
    // Read from the real schemas, in a process of its own (this one has the
    // in-memory stand-in for them): any field with "memberId" in its name.
    const script = `
      const models = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'models.js'))});
      const out = {};
      for (const [name, M] of Object.entries(models)) {
        if (!M || !M.schema) continue;
        const hits = [];
        const walk = (schema, pre) => schema.eachPath((p, t) => { if (/memberid/i.test(p)) hits.push(pre + p); if (t.schema) walk(t.schema, pre + p + '.'); });
        walk(M.schema, '');
        if (hits.length) out[name] = hits;
      }
      process.stdout.write(JSON.stringify(out));`;
    const inSchemas = JSON.parse(execFileSync(process.execPath, ['-e', script]).toString());
    const missing = Object.entries(inSchemas).flatMap(([m, fields]) => fields.filter(f => !(eraseMember.PLAN[m] && eraseMember.PLAN[m].fields.includes(f))).map(f => `${m}.${f}`));
    check('every field holding a member id, in every schema, says what erasing and exporting do to it', missing.length === 0, missing);
    const stale = Object.entries(eraseMember.PLAN).flatMap(([m, p]) => p.fields.filter(f => !(inSchemas[m] || []).includes(f)).map(f => `${m}.${f}`));
    check('and the plan names no field that is not there', stale.length === 0, stale);
    check('and it found a real number of them', Object.keys(inSchemas).length >= 20, Object.keys(inSchemas));
    check('each says what erasing does and what the export gives', Object.values(eraseMember.PLAN).every(p => p.erase && p.export));
  }

  // ------------------------------------------------------------------ the app --
  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4339';
  const jars = {};
  async function call(jar, method, p, body) {
    const h = {};
    if (jars[jar]) h.cookie = jars[jar];
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + p, { method, headers: h, body: payload });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (sc.length) jars[jar] = sc.map(c => c.split(';')[0]).join('; ');
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: res.status, data, text, headers: res.headers };
  }

  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  const C = 'aconsu-knust';
  await call('admin', 'POST', '/api/national/chapters', { id: C, name: 'ACONSU KNUST', institution: 'KNUST' });
  async function register(name, email, phone) {
    const fd = new FormData();
    fd.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
    Object.entries({ name, email, phone, password: 'secret123', chapterId: C, consent: 'true' }).forEach(([k, v]) => fd.append(k, v));
    return (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd })).json()).member.id;
  }
  const ama = await register('Ama Mensah', 'ama@example.com', '0241234567');
  const kofi = await register('Kofi Asare', 'kofi@example.com', '0207654321');
  await call('ama1', 'POST', '/api/auth/login', { email: 'ama@example.com', password: 'secret123' });
  await call('ama2', 'POST', '/api/auth/login', { email: 'ama@example.com', password: 'secret123' });
  await call('kofi', 'POST', '/api/auth/login', { email: 'kofi@example.com', password: 'secret123' });
  const amaPhoto = fakeModels.Member._docs.find(m => m.id === ama).profileImageFileId;

  // Ama holds an office, with the login it comes with.
  let r = await call('admin', 'POST', '/api/admin/staff', { role: 'executive', positionKey: 'treasurer', memberId: ama, chapterId: C });
  const tr = r.data.issued;
  fakeModels.StaffUser._docs.filter(a => a.memberId === ama).forEach(a => { a.mustChangePassword = false; });
  const amaStaff = fakeModels.StaffUser._docs.find(a => a.memberId === ama);
  await call('amaStaff', 'POST', '/api/portal/login', { username: tr.username, password: tr.password });
  check('(Ama is the Treasurer and signed in as that office)', (await call('amaStaff', 'GET', '/api/portal/me')).status === 200);

  // Everything else a year in the app leaves behind, Ama's and other people's.
  const file = async () => fakeGridfs.uploadBuffer(Buffer.from('jpg'), 'x.jpg', {});
  const careFile = await file();
  const wallFile = await file();
  const cardFile = await file();
  const mk = (model, doc) => fakeModels[model].create({ chapterId: C, ...doc });
  await mk('SermonNote', { id: 'sn1', memberId: ama, notes: 'Grace' });
  await mk('SermonNote', { id: 'sn2', memberId: kofi, notes: 'Kofi\'s own' });
  await mk('FormSubmission', { id: 'fs1', formId: 'f', memberId: ama, submitterName: 'Ama Mensah' });
  await mk('FormSubmission', { id: 'fs2', formId: 'f', memberId: '', submitterEmail: 'Ama@Example.com', submitterName: 'Ama' });
  await mk('Group', { id: 'g1', name: 'Cell A', leaderMemberId: ama, leaderName: 'Ama Mensah', memberIds: [ama, kofi] });
  await mk('GroupPost', { id: 'gp1', groupId: 'g1', authorMemberId: ama, authorName: 'Ama Mensah', body: 'hi' });
  await mk('GroupMeeting', { id: 'gm1', groupId: 'g1', title: 'Cell night', attendeeMemberIds: [ama, kofi] });
  await mk('DepartmentMeeting', { id: 'dm1', title: 'Choir practice', attendeeMemberIds: [ama, kofi] });
  await mk('ChatTopic', { id: 'ct1', title: 'Exams', createdByMemberId: ama, createdByName: 'Ama Mensah' });
  await mk('ChatMessage', { id: 'cm1', topicId: 'ct1', authorMemberId: ama, authorName: 'Ama Mensah', body: 'mine' });
  await mk('ChatMessage', { id: 'cm2', topicId: 'ct1', authorMemberId: kofi, authorName: 'Kofi Asare', body: 'his' });
  await mk('VolunteerAssignment', { id: 'va1', memberId: ama, memberName: 'Ama Mensah' });
  await mk('Milestone', { id: 'ms1', memberId: ama, memberName: 'Ama Mensah', type: 'graduation' });
  await mk('WelfareRequest', { id: 'wr1', memberId: ama, memberName: 'Ama Mensah', description: 'Hospital bill' });
  await mk('WelfareEntry', { id: 'we1', memberId: ama, memberName: 'Ama Mensah', amount: 30, description: 'Dues, Ama Mensah' });
  await mk('WelfareEntry', { id: 'we2', memberId: kofi, memberName: 'Kofi Asare', amount: 20, recordedByMemberId: ama, recordedBy: 'Ama Mensah' });
  await mk('FinanceEntry', { id: 'fe1', entryType: 'income', amount: 50, payee: 'Ama Mensah', description: 'Giving confirmed, Ama Mensah', approvalStatus: 'approved' });
  await mk('GivingIntent', { id: 'gi1', memberId: ama, memberName: 'Ama Mensah', amount: 50, status: 'confirmed', matchedFinanceEntryId: 'fe1' });
  await mk('RetentionAlert', { id: 'ra1', memberId: ama, memberName: 'Ama Mensah' });
  await mk('DepartmentRequest', { id: 'dr1', memberId: ama });
  await mk('AlumniProfile', { id: 'ap1', memberId: ama });
  await mk('PrayerRequest', { id: 'pr1', memberId: ama, name: 'Ama Mensah', request: 'Exams' });
  await mk('PrayerRequest', { id: 'pr2', memberId: kofi, name: 'Kofi Asare', request: 'Travel', prayingMemberIds: [ama, kofi] });
  await mk('EventRegistration', { id: 'er1', eventId: 'e', memberId: ama, name: 'Ama Mensah', email: 'ama@example.com' });
  await mk('PushSubscription', { id: 'ps1', endpoint: 'https://fcm.googleapis.com/x', memberId: ama });
  await mk('ShepherdingRecord', { id: 'sr1', memberId: ama, pastoralNotes: 'Visited', imageFileId: careFile });
  await mk('AttendanceRecord', { id: 'ar1', date: '2026-10-25', serviceType: 'sunday', rev: 0, marks: [
    { memberId: ama, recordId: '', name: 'Ama Mensah', status: 'present' }, { memberId: kofi, recordId: '', name: 'Kofi Asare', status: 'present' }] });
  await mk('Notification', { id: 'n1', title: 'Congratulations, Ama Mensah!', body: 'Ama Mensah graduated.' });
  await mk('Notification', { id: 'n2', title: 'Sunday service', body: 'Come early.' });
  await mk('ContactMessage', { id: 'c1', name: 'Ama', email: 'AMA@example.com', message: 'Hello' });
  await mk('ContactMessage', { id: 'c2', name: 'Kofi', email: 'kofi@example.com', message: 'Hi' });
  await mk('JoinRequest', { id: 'j1', name: 'Ama', phone: '+233 24 123 4567' });
  await mk('SmsLog', { id: 'sms1', to: '233241234567', body: 'Service at 9am' });
  await mk('SmsLog', { id: 'sms2', to: '233207654321', body: 'Service at 9am' });
  await mk('AlumniDetail', { id: 'ad1', name: 'Ama Mensah', email: 'ama@example.com' });
  await mk('AlumniEntry', { id: 'ae1', name: 'Ama Mensah', contact: 'ama@example.com', imageFileId: wallFile, status: 'approved' });
  await mk('Executive', { id: 'ex1', name: 'Ama Mensah', role: 'Treasurer', positionKey: 'treasurer', staffId: amaStaff.id, contact: { phone: '0241234567', email: 'ama@example.com' }, imageFileId: cardFile });
  fakeModels.Member._docs.find(m => m.id === kofi).shepherdMemberId = ama;
  fakeModels.Member._docs.find(m => m.id === kofi).shepherdName = 'Ama Mensah';

  console.log('\n== Download my data ==');
  r = await call('ama1', 'POST', '/api/member/export', { password: 'wrong-one' });
  check('it asks for the password again, and a wrong one gets nothing', r.status === 401 && !/Grace/.test(r.text), r.status);
  r = await call('ama1', 'POST', '/api/member/export', {});
  check('and none at all gets nothing', r.status === 400, r.status);
  r = await call('ama1', 'POST', '/api/member/export', { password: 'secret123' });
  const x = r.data;
  check('with it, a file to keep comes back', r.status === 200 && /attachment; filename="aconsu-my-data-\d{4}-\d{2}-\d{2}\.json"/.test(r.headers.get('content-disposition')) && r.headers.get('cache-control') === 'no-store', r.headers.get('content-disposition'));
  check('holding their profile, without any secret', x.profile && x.profile.email === 'ama@example.com' && !/passwordHash|resetToken|qrToken|\$2[aby]\$/.test(r.text), Object.keys(x.profile || {}));
  check('and their own records, from every kind', x.sermonNotes.length === 1 && x.formsSent.length === 1 && x.groupPosts.length === 1 && x.chatMessages.length === 1
    && x.welfareRequests.length === 1 && x.giving.length === 1 && x.careRecord.length === 1 && x.prayerRequests.length === 1 && x.eventRegistrations.length === 1
    && x.sundays.length === 1 && x.sundays[0].status === 'present' && x.leadershipLogins.length === 1 && x.milestones.length >= 1,
    Object.fromEntries(Object.entries(x).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length])));
  check('shared records as far as they are theirs: the groups they are in, not who else is', x.groups.length === 1 && x.groups[0].name === 'Cell A' && x.groups[0].youLeadIt === true && x.meetingsAttended.length === 2);
  check('nobody else\'s id or record is in it', !r.text.includes(kofi) && !/Kofi/.test(r.text), [r.text.includes(kofi), /Kofi/.test(r.text)]);
  check('and what they sent before they had an account, found by email or phone', x.sentWithoutAnAccount.contactMessages.length === 1 && x.sentWithoutAnAccount.joinRequests.length === 1
    && x.sentWithoutAnAccount.alumniForms.length === 1 && x.sentWithoutAnAccount.alumniWall.length === 1 && x.sentWithoutAnAccount.formsSent.length === 1
    && x.textsSentToYou.length === 1 && x.textsSentToYou[0].message === 'Service at 9am', x.sentWithoutAnAccount);
  check('a device is named only by when it was added', x.devicesForNotifications.length === 1 && !/fcm\.googleapis/.test(r.text));
  r = await call('nobody', 'POST', '/api/member/export', { password: 'secret123' });
  check('nobody signed out can ask', r.status === 401, r.status);

  console.log('\n== Delete my account ==');
  r = await call('ama1', 'POST', '/api/member/delete-account', { password: 'secret123' });
  check('it needs DELETE typed as well as the password', r.status === 400 && /DELETE/.test(r.data.error) && fakeModels.Member._docs.some(m => m.id === ama), r.data);
  r = await call('ama1', 'POST', '/api/member/delete-account', { password: 'nope', confirm: 'DELETE' });
  check('and the right password', r.status === 401 && fakeModels.Member._docs.some(m => m.id === ama), r.data);
  const sundaysBefore = fakeModels.AttendanceRecord._docs.find(a => a.id === 'ar1').marks.filter(m => m.status === 'present').length;
  r = await call('ama1', 'POST', '/api/member/delete-account', { password: 'secret123', confirm: 'delete' });
  check('with both, the account is deleted', r.status === 200 && r.data.success === true && !fakeModels.Member._docs.some(m => m.id === ama), r.data);

  const left = (model, field) => fakeModels[model]._docs.filter(d => {
    const v = field.split('.').reduce((o, k) => (o == null ? o : o[k]), d);
    return Array.isArray(v) ? v.includes(ama) : v === ama;
  }).length;
  const gone = ['FormSubmission', 'SermonNote', 'VolunteerAssignment', 'Milestone', 'WelfareRequest', 'RetentionAlert', 'OnboardingTask', 'DepartmentRequest', 'AlumniProfile', 'PrayerRequest', 'EventRegistration', 'PushSubscription', 'ShepherdingRecord'];
  check('what was theirs alone is gone', gone.every(m => left(m, 'memberId') === 0) && left('GroupPost', 'authorMemberId') === 0 && left('ChatMessage', 'authorMemberId') === 0,
    gone.filter(m => left(m, 'memberId')));
  const byId = (model, id) => fakeModels[model]._docs.find(d => d.id === id);
  check('and so is what they sent without an account, matched by email or phone', !byId('FormSubmission', 'fs2') && !byId('ContactMessage', 'c1') && !byId('JoinRequest', 'j1')
    && !byId('SmsLog', 'sms1') && !byId('AlumniDetail', 'ad1') && !byId('AlumniEntry', 'ae1'));
  check('their id is on no record anywhere', Object.keys(fakeModels).every(m => !JSON.stringify(fakeModels[m]._docs || []).includes(ama)),
    Object.keys(fakeModels).filter(m => JSON.stringify(fakeModels[m]._docs || []).includes(ama)));
  check('their photo, their care record\'s, the wall\'s and the roster card\'s are deleted', [amaPhoto, careFile, wallFile, cardFile].every(f => !fakeGridfs.findFile || true)
    && (await Promise.all([amaPhoto, careFile, wallFile, cardFile].map(f => fakeGridfs.findFile(f)))).every(f => f === null));
  check('they are off other people\'s records: the group, its meetings, a prayer list', byId('Group', 'g1').memberIds.join() === kofi && byId('Group', 'g1').leaderMemberId === ''
    && byId('GroupMeeting', 'gm1').attendeeMemberIds.join() === kofi && byId('DepartmentMeeting', 'dm1').attendeeMemberIds.join() === kofi && byId('PrayerRequest', 'pr2').prayingMemberIds.join() === kofi);
  check('someone they shepherded no longer has them as shepherd', fakeModels.Member._docs.find(m => m.id === kofi).shepherdMemberId === '' && fakeModels.Member._docs.find(m => m.id === kofi).shepherdName === '');
  check('a chat topic they started stays for the others in it, with no name', byId('ChatTopic', 'ct1').createdByName === 'Former member' && byId('ChatMessage', 'cm2'));
  check('money stays in the books, with their name taken off', byId('FinanceEntry', 'fe1').amount === 50 && byId('FinanceEntry', 'fe1').payee === 'Former member'
    && !/Ama/.test(byId('FinanceEntry', 'fe1').description) && byId('GivingIntent', 'gi1').amount === 50 && byId('GivingIntent', 'gi1').memberName === 'Former member'
    && byId('WelfareEntry', 'we1').amount === 30 && !/Ama/.test(JSON.stringify(byId('WelfareEntry', 'we1'))), [byId('FinanceEntry', 'fe1'), byId('WelfareEntry', 'we1')]);
  check('welfare money they recorded for someone else stays, recorded by a former member', byId('WelfareEntry', 'we2').memberId === kofi && byId('WelfareEntry', 'we2').recordedBy === 'Former member');
  const sunday = byId('AttendanceRecord', 'ar1');
  check('a Sunday they were at still counts them, with no name on the mark', sunday.marks.filter(m => m.status === 'present').length === sundaysBefore
    && sunday.marks.some(m => m.name === 'Former member' && m.memberId === '') && !/Ama/.test(JSON.stringify(sunday)), sunday.marks);
  check('their full name is gone from the chapter\'s notifications', !/Ama Mensah/.test(byId('Notification', 'n1').title + byId('Notification', 'n1').body) && byId('Notification', 'n2').title === 'Sunday service', byId('Notification', 'n1'));
  check('their office login is closed, and the roster card shows the office vacant', fakeModels.StaffUser._docs.find(a => a.id === amaStaff.id).active === false
    && fakeModels.StaffUser._docs.find(a => a.id === amaStaff.id).memberId === '' && byId('Executive', 'ex1').name === 'Vacant' && byId('Executive', 'ex1').role === 'Treasurer'
    && !/ama@|0241234567/.test(JSON.stringify(byId('Executive', 'ex1'))), byId('Executive', 'ex1'));
  check('other people\'s things are untouched', byId('SermonNote', 'sn2') && byId('ContactMessage', 'c2') && byId('SmsLog', 'sms2') && byId('PrayerRequest', 'pr2'));

  r = await call('ama1', 'GET', '/api/auth/me');
  check('the phone they deleted it from is signed out', !r.data.member, r.data);
  r = await call('ama2', 'GET', '/api/auth/me');
  check('and so is every other phone they were signed in on', !r.data.member, r.data);
  r = await call('ama2', 'POST', '/api/prayer-requests', { name: 'Ghost', request: 'x', visibility: 'private' });
  check('which cannot then make records in their name', !fakeModels.PrayerRequest._docs.some(p => p.memberId === ama), r.status);
  r = await call('amaStaff', 'GET', '/api/portal/me');
  check('and their office login is signed out too', r.status === 200 && !r.data.staff, r.data);
  r = await call('ama2', 'POST', '/api/auth/login', { email: 'ama@example.com', password: 'secret123' });
  check('the account cannot be signed into again', r.status !== 200 || !r.data.member, r.status);

  console.log('\n== the admin\'s "delete member" does the same ==');
  await mk('SermonNote', { id: 'sn3', memberId: kofi, notes: 'More' });
  r = await call('admin', 'DELETE', `/api/admin/members/${kofi}`);
  check('the admin deletes a member', r.status === 200 && r.data.success && !fakeModels.Member._docs.some(m => m.id === kofi), r.data);
  check('and their records go too, not just the member record', !byId('SermonNote', 'sn2') && !byId('SermonNote', 'sn3') && !byId('ContactMessage', 'c2') && !byId('SmsLog', 'sms2') && !byId('PrayerRequest', 'pr2')
    && Object.keys(fakeModels).every(m => !JSON.stringify(fakeModels[m]._docs || []).includes(kofi)), Object.keys(fakeModels).filter(m => JSON.stringify(fakeModels[m]._docs || []).includes(kofi)));
  check('and the admin is told what was removed', r.data.removed && r.data.removed.SermonNote === 2, r.data.removed);
  r = await call('kofi', 'GET', '/api/auth/me');
  check('and they are signed out', !r.data.member, r.data);
  check('erasing someone already gone does nothing', await eraseMember.erase(kofi) === null);
  check('a short first name is never cut out of other text', eraseMember.scrubName('Ama called Ama', 'Ama') === 'Ama called Ama' && eraseMember.scrubName('From Ama Mensah', 'Ama Mensah') === 'From a former member');

  console.log('\n== old things are cleared every day, by one copy of the app ==');
  {
    const retention = require('../lib/retention');
    const { withLock } = require('../lib/jobLock');
    const policy = retention.policy({});
    const days = Object.fromEntries(policy.map(p => [p.setting, p.days]));
    check('notifications, texts and contact messages are kept 12 months; chat 2 years', days.RETAIN_NOTIFICATIONS_DAYS === 365 && days.RETAIN_SMS_LOG_DAYS === 365
      && days.RETAIN_CONTACT_MESSAGES_DAYS === 365 && days.RETAIN_CHAT_DAYS === 730, days);
    check('each can be changed, and 0 keeps that kind for ever; nonsense keeps the default',
      retention.daysFor(retention.RULES[0], { RETAIN_NOTIFICATIONS_DAYS: '30' }) === 30 && retention.daysFor(retention.RULES[0], { RETAIN_NOTIFICATIONS_DAYS: '0' }) === 0
      && retention.daysFor(retention.RULES[0], { RETAIN_NOTIFICATIONS_DAYS: 'soon' }) === 365);
    const page = require('fs').readFileSync(path.join(__dirname, '..', 'public', 'privacy.html'), 'utf8');
    const said = { 365: '12 months', 730: '2 years' };
    check('the privacy page states the same numbers', [['Notifications in the app', 365], ['The record of text messages (SMS) sent', 365], ['Messages sent through the contact form', 365], ['Chat messages', 730]]
      .every(([what, d]) => page.includes(`${what}: after ${said[d]}`)) && policy.every(p => said[p.days]), policy);

    const old = new Date(Date.now() - 400 * 86400000);
    const older = new Date(Date.now() - 800 * 86400000);
    const fresh = new Date(Date.now() - 5 * 86400000);
    await mk('Notification', { id: 'old-n', title: 't', createdAt: old });
    await mk('Notification', { id: 'new-n', title: 't', createdAt: fresh });
    await mk('SmsLog', { id: 'old-s', to: '1', createdAt: old });
    await mk('ContactMessage', { id: 'old-c', email: 'x@y.z', createdAt: old });
    await mk('ChatMessage', { id: 'mid-m', topicId: 't', body: 'b', createdAt: old });
    await mk('ChatMessage', { id: 'old-m', topicId: 't', body: 'b', createdAt: older });
    // The store sets createdAt itself; put the old dates back as the database would hold them.
    for (const [m, id, at] of [['Notification', 'old-n', old], ['Notification', 'new-n', fresh], ['SmsLog', 'old-s', old], ['ContactMessage', 'old-c', old], ['ChatMessage', 'mid-m', old], ['ChatMessage', 'old-m', older]]) {
      fakeModels[m]._docs.find(d => d.id === id).createdAt = at.toISOString();
    }
    const ran = await retention.runDaily({});
    check('the daily run clears what is older than its rule', ran.ran && !byId('Notification', 'old-n') && !byId('SmsLog', 'old-s') && !byId('ContactMessage', 'old-c') && !byId('ChatMessage', 'old-m'), ran);
    check('and keeps what is not', byId('Notification', 'new-n') && byId('ChatMessage', 'mid-m'));
    await retention.sweep({ RETAIN_CHAT_DAYS: '0' });
    check('a kind set to 0 is never cleared', byId('ChatMessage', 'mid-m'));

    // Two copies of the app at once: exactly one runs it.
    let runs = 0;
    const job = () => withLock('test-job', 60000, async () => { runs += 1; await new Promise(res => setTimeout(res, 50)); return 'done'; });
    const [a, b] = await Promise.all([job(), job()]);
    check('two copies asking at the same moment: one runs, the other stands down', runs === 1 && [a.ran, b.ran].sort().join() === 'false,true', [a, b]);
    check('and once it is done, the next day\'s run can take it', (await job()).ran === true && runs === 2);
    const row = fakeModels.SystemState._docs.find(d => d.singleton === 'lock:test-job');
    row.lockedUntil = new Date(Date.now() + 60000).toISOString(); row.lockHolder = 'another-copy';
    check('while another copy holds it, this one does not run', (await job()).ran === false && runs === 2);
    row.lockedUntil = new Date(Date.now() - 1000).toISOString();
    check('and a lock left by a copy that crashed lapses by itself', (await job()).ran === true && runs === 3);
    check('there is one lock row per job, however many copies asked', fakeModels.SystemState._docs.filter(d => d.singleton === 'lock:test-job').length === 1);
  }

  console.log('\n== a few tries an hour, no more ==');
  await register('Esi Owusu', 'esi@example.com', '0551112222');
  await call('esi', 'POST', '/api/auth/login', { email: 'esi@example.com', password: 'secret123' });
  let limited = null;
  for (let i = 0; i < 40 && !limited; i += 1) {
    r = await call('esi', 'POST', '/api/member/export', { password: 'wrong-guess' });
    if (r.status === 429) limited = r;
  }
  check('guessing the password over and over is stopped', limited && /wait an hour/.test(limited.data.error), limited && limited.data);
  await register('Yaa Boateng', 'yaa@example.com', '0553334444');
  await call('yaa', 'POST', '/api/auth/login', { email: 'yaa@example.com', password: 'secret123' });
  r = await call('yaa', 'POST', '/api/member/export', { password: 'secret123' });
  check('but only for that account: someone else on the same Wi-Fi is not locked out', r.status === 200 && r.data.profile && r.data.profile.email === 'yaa@example.com', r.status);

  console.log(failures ? `\n${failures} FAILURES` : '\nall privacy checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
