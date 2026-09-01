// Smoke test for the leadership portals.
// Boots the real Express app against an in-memory stand-in for MongoDB
// (see harness.js) and drives it over HTTP, so routes, permission rules and
// the finance/attendance calculations are all exercised for real.
//
//   npm test              — the full suite
//   SMOKE_SLOW=1 npm test — also waits out the 60s scheduled-send tick
require('./harness.js');

(async () => {
  process.env.MONGODB_URI = 'mongodb://stub/aconsu_test';
  process.env.PORT = '4321';
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'admin123';
  process.env.SESSION_SECRET = 'test';
  process.env.LOGIN_RATE_LIMIT_MAX = '200'; // this suite signs far more accounts in/out per run than any real IP would in 15 minutes
  delete process.env.SHEPHERD_USERNAME;

  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));

  const BASE = 'http://127.0.0.1:4321';
  let failures = 0;
  const jars = {};

  async function call(jar, method, path, body, isForm) {
    const headers = {};
    if (jars[jar]) headers.cookie = jars[jar];
    let payload;
    if (body && !isForm) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    else if (body) payload = body;
    const res = await fetch(BASE + path, { method, headers, body: payload });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (setCookie.length) jars[jar] = setCookie.map(c => c.split(';')[0]).join('; ');
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: res.status, data };
  }

  function check(label, cond, detail) {
    if (cond) { console.log(`  ok   ${label}`); }
    else { failures++; console.log(`  FAIL ${label}${detail ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ''}`); }
  }

  console.log('\n== auth ==');
  let r = await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  check('admin logs in', r.status === 200, r.data);

  r = await call('anon', 'GET', '/api/finance/summary');
  check('finance is locked to signed-out visitors', r.status === 401, r.data);

  console.log('\n== multi-chapter foundation: the one chapter every other test runs inside ==');
  // The legacy admin login is treated as the bootstrap National Coordinator
  // (see lib/roles.js) — it can create chapters and, with exactly one active
  // chapter in play, every chapter-scoped write below auto-defaults to it
  // without needing to say so explicitly (see resolveChapterIdForWrite).
  r = await call('admin', 'POST', '/api/national/chapters', { id: 'test-chapter', name: 'ACONSU-Test', institution: 'Test University' });
  check('national coordinator creates a chapter', r.status === 200 && r.data.item.id === 'test-chapter', r.data);
  r = await call('admin', 'POST', '/api/national/chapters', { id: 'test-chapter', name: 'dupe' });
  check('duplicate chapter id rejected', r.status === 400, r.data);
  const chapterId = 'test-chapter';
  r = await call('anon', 'GET', '/api/chapters');
  check('chapters are publicly listable', r.data.length === 1 && r.data[0].id === chapterId, r.data);
  check('the public chapter list omits payment details', r.data[0].payment === undefined, r.data[0]);

  console.log('\n== leadership accounts ==');
  for (const [role, user] of Object.entries({ finance: 'fin.ama', shepherding: 'shep.kojo', publicity: 'pub.esi', coordinator: 'coord.yaw' })) {
    r = await call('admin', 'POST', '/api/admin/staff', { username: user, name: user, role, password: 'password123' });
    check(`create ${role} account`, r.status === 200, r.data);
  }
  r = await call('admin', 'POST', '/api/admin/staff', { username: 'fin.ama', name: 'dupe', role: 'finance', password: 'password123' });
  check('duplicate username rejected', r.status === 400, r.data);
  r = await call('admin', 'POST', '/api/admin/staff', { username: 'weak', name: 'weak', role: 'finance', password: 'short' });
  check('short password rejected', r.status === 400, r.data);

  for (const [jar, user] of Object.entries({ fin: 'fin.ama', shep: 'shep.kojo', pub: 'pub.esi', coord: 'coord.yaw' })) {
    r = await call(jar, 'POST', '/api/portal/login', { username: user, password: 'password123' });
    check(`${user} signs in`, r.status === 200, r.data);
  }
  r = await call('bad', 'POST', '/api/portal/login', { username: 'fin.ama', password: 'wrong' });
  check('wrong password rejected', r.status === 401, r.data);

  console.log('\n== national coordinator ==');
  r = await call('admin', 'GET', '/api/national/dashboard');
  check('national dashboard loads', r.status === 200 && r.data.totalChapters === 1 && r.data.activeChapters === 1, r.data);
  r = await call('fin', 'GET', '/api/national/dashboard');
  check('a chapter-level role cannot read the national dashboard', r.status === 401, r.data);
  r = await call('coord', 'GET', '/api/national/dashboard');
  check('a Chapter Coordinator cannot read the national dashboard either', r.status === 401, r.data);
  r = await call('fin', 'POST', '/api/admin/staff', { username: 'sneaky', name: 'sneaky', role: 'coordinator', password: 'password123' });
  check('a non-national role cannot self-elevate a new account to coordinator', r.status === 403 || r.status === 401, r.data);

  console.log('\n== Phase 7–8 content and national management ==');
  r = await call('pub', 'POST', '/api/admin/content', { kind: 'live_service', title: 'Sunday Service', previewUrl: 'https://youtube.com/example', featured: true });
  check('publicity publishes chapter live-service content', r.status === 200 && r.data.item.chapterId === chapterId, r.data);
  const liveContentId = r.data.item.id;

  r = await call('anon', 'GET', `/api/content/item/${liveContentId}`);
  check('single content item lookup works publicly', r.status === 200 && r.data.id === liveContentId && r.data.title === 'Sunday Service', r.data);

  r = await call('pub', 'PUT', `/api/admin/content/${liveContentId}`, { title: 'Sunday Miracle Service', summary: 'Live stream of service' });
  check('publicity edits content item', r.status === 200 && r.data.item.title === 'Sunday Miracle Service' && r.data.item.summary === 'Live stream of service', r.data);

  r = await call('pub', 'POST', '/api/admin/content', { kind: 'ebook', title: 'Draft Manual', published: false, category: 'Leadership' });
  check('publicity creates draft content item', r.status === 200 && r.data.item.published === false, r.data);
  const draftEbookId = r.data.item.id;

  r = await call('anon', 'GET', '/api/content/ebook');
  check('draft content is hidden from public view', r.status === 200 && !r.data.some(i => i.id === draftEbookId), r.data);

  r = await call('pub', 'GET', '/api/admin/content');
  check('draft content is visible in content manager', r.status === 200 && r.data.some(i => i.id === draftEbookId), r.data);

  r = await call('pub', 'DELETE', `/api/admin/content/${draftEbookId}`);
  check('publicity deletes content item', r.status === 200, r.data);

  r = await call('anon', 'GET', '/api/content/live_service');
  check('public live-service content is chapter-scoped and visible', r.status === 200 && r.data.some(i => i.title === 'Sunday Miracle Service'), r.data);
  r = await call('fin', 'POST', '/api/admin/content', { kind: 'ebook', title: 'No access' });
  check('finance cannot manage public content', r.status === 401, r.data);
  r = await call('admin', 'GET', '/api/national/features');
  check('national feature configuration loads', r.status === 200 && r.data.modules.liveStreaming === true, r.data);
  r = await call('fin', 'PUT', '/api/national/features', { modules: { liveStreaming: false } });
  check('chapter-level staff cannot change national features', r.status === 401, r.data);
  r = await call('admin', 'PUT', '/api/national/features', { modules: { liveStreaming: false } });
  check('national coordinator can disable a module', r.status === 200 && r.data.modules.liveStreaming === false, r.data);
  r = await call('anon', 'GET', '/api/content/live_service');
  check('disabled live-streaming hides public live content', r.status === 200 && r.data.length === 0, r.data);
  r = await call('admin', 'PUT', '/api/national/features', { modules: { liveStreaming: true } });
  r = await call('admin', 'GET', '/api/national/reports/overview');
  check('national report returns aggregates only', r.status === 200 && r.data[0].activeMembers !== undefined && r.data[0].email === undefined, r.data);
  r = await call('admin', 'POST', '/api/national/reports/snapshot', { region: 'Ashanti' });
  check('national coordinator takes a report snapshot', r.status === 200 && r.data.item.metrics.totalChapters >= 1 && r.data.item.region === 'Ashanti', r.data);
  r = await call('fin', 'POST', '/api/national/reports/snapshot');
  check('chapter-level staff cannot take a report snapshot', r.status === 401, r.data);
  r = await call('admin', 'GET', '/api/national/reports/history');
  check('national report history returns stored snapshots', r.status === 200 && r.data.length >= 1 && r.data[0].metrics.totalChapters >= 1, r.data);
  r = await call('fin', 'GET', '/api/national/reports/history');
  check('chapter-level staff cannot read report history', r.status === 401, r.data);

  console.log('\n== role boundaries ==');
  r = await call('pub', 'GET', '/api/finance/summary');
  check('publicity cannot read finance', r.status === 401, r.data);
  r = await call('coord', 'GET', '/api/finance/summary');
  check('coordinator CAN read finance', r.status === 200, r.data);
  r = await call('coord', 'POST', '/api/finance/entries', { entryType: 'income', category: 'momo', amount: 5, date: '2026-01-01' });
  check('coordinator CANNOT write finance', r.status === 401, r.data);
  r = await call('shep', 'POST', '/api/publicity/notifications', { title: 'x', body: 'y' });
  check('shepherding cannot send announcements', r.status === 401, r.data);

  console.log('\n== finance: budgets + ledger ==');
  r = await call('fin', 'POST', '/api/finance/budgets', {
    name: '2026 Year', startDate: '2026-01-01', endDate: '2026-12-31', status: 'active',
    lines: [
      { lineType: 'income', category: 'offertory', plannedAmount: 5000 },
      { lineType: 'expense', category: 'Refreshments', plannedAmount: 800 }
    ]
  });
  check('budget created with lines', r.status === 200 && r.data.item.lines.length === 2, r.data);
  const budget = r.data.item;
  const incomeLine = budget.lines.find(l => l.lineType === 'income');
  const expenseLine = budget.lines.find(l => l.lineType === 'expense');

  r = await call('fin', 'POST', '/api/finance/budgets', { name: 'bad', startDate: '2026-06-01', endDate: '2026-01-01' });
  check('end-before-start rejected', r.status === 400, r.data);

  r = await call('fin', 'POST', '/api/finance/entries', {
    entryType: 'income', category: 'offertory', amount: 1200, date: '2026-02-01',
    method: 'momo', reference: 'MM123', budgetId: budget.id, budgetLineId: incomeLine.lineId
  });
  check('income entry booked to a budget line', r.status === 200, r.data);
  const entryId = r.data.item.id;

  r = await call('fin', 'POST', '/api/finance/entries', {
    entryType: 'expense', category: 'Refreshments', amount: 300, date: '2026-02-05',
    budgetId: budget.id, budgetLineId: expenseLine.lineId
  });
  check('expense entry booked', r.status === 200, r.data);

  r = await call('fin', 'POST', '/api/finance/entries', { entryType: 'income', category: 'not-a-source', amount: 10, date: '2026-02-05' });
  check('invalid income category rejected', r.status === 400, r.data);
  r = await call('fin', 'POST', '/api/finance/entries', { entryType: 'income', category: 'momo', amount: -50, date: '2026-02-05' });
  check('negative amount rejected', r.status === 400, r.data);

  r = await call('fin', 'GET', '/api/finance/summary');
  check('summary totals correct', r.data.totalIncome === 1200 && r.data.totalExpense === 300 && r.data.balance === 900, r.data);
  check('monthly series built', Array.isArray(r.data.monthly) && r.data.monthly[0].month === '2026-02', r.data.monthly);

  r = await call('fin', 'GET', `/api/finance/budgets/${budget.id}`);
  const line = r.data.lines.find(l => l.lineType === 'income');
  check('budget actuals summed from the ledger', line.actual === 1200 && line.usedPercent === 24, r.data.lines);
  check('expense variance is under-spend positive', r.data.lines.find(l => l.lineType === 'expense').variance === 500, r.data.lines);

  r = await call('fin', 'GET', '/api/finance/entries?entryType=income&from=2026-01-01&to=2026-03-01');
  check('ledger filters apply', Array.isArray(r.data) && r.data.length === 1, r.data);

  r = await call('fin', 'GET', '/api/finance/export.csv');
  check('CSV export renders with totals', typeof r.data === 'string' && r.data.includes('TOTAL INCOME') && r.data.includes('1200.00'), r.data.slice(0, 200));

  r = await call('fin', 'DELETE', `/api/finance/budgets/${budget.id}`);
  check('deleting a budget keeps its entries', r.status === 200, r.data);
  r = await call('fin', 'GET', '/api/finance/summary');
  check('entries survived the budget deletion', r.data.totalIncome === 1200, r.data);
  await call('fin', 'DELETE', `/api/finance/entries/${entryId}`);

  console.log('\n== registration: chapter + compulsory photo (section 6) ==');
  r = await call('anon', 'POST', '/api/auth/register', { name: 'No Photo', email: 'nophoto@test.com', password: 'secret123', chapterId });
  check('registration without a photo is rejected', r.status === 400, r.data);
  r = await call('anon', 'POST', '/api/auth/register', { name: 'No Chapter', email: 'nochapter@test.com', password: 'secret123' });
  check('registration without a chapter is rejected', r.status === 400, r.data);

  const regForm = new FormData();
  regForm.append('profileImage', new Blob([Buffer.from('fake-photo-bytes')], { type: 'image/png' }), 'me.png');
  regForm.append('name', 'Ama Test');
  regForm.append('email', 'ama@test.com');
  regForm.append('password', 'secret123');
  regForm.append('phone', '0244123456');
  regForm.append('chapterId', chapterId);
  regForm.append('programme', 'BSc. Computer Science');
  regForm.append('hostel', 'Hostel A');
  const regRes = await fetch(BASE + '/api/auth/register', { method: 'POST', body: regForm });
  const regData = await regRes.json();
  jars.member = (regRes.headers.getSetCookie ? regRes.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');
  check('a member registers with chapter + photo', regRes.status === 200, regData);

  console.log('\n== shepherding: attendance ==');
  r = await call('shep', 'GET', '/api/shepherd/members');
  check('member appears in the shepherding list', r.data.length === 1, r.data);
  check('new registration starts as a visitor', r.data[0].membershipStage === 'visitor', r.data);
  const memberId = r.data[0].memberId;

  r = await call('shep', 'POST', '/api/shepherd/attendance', {
    date: '2026-08-09', serviceType: 'sunday', visitorCount: 4,
    marks: [{ memberId, name: 'Ama Test', status: 'present' }]
  });
  check('register saved', r.status === 200, r.data);

  r = await call('shep', 'POST', '/api/shepherd/attendance', {
    date: '2026-08-09', serviceType: 'sunday', visitorCount: 6,
    marks: [{ memberId, name: 'Ama Test', status: 'excused' }]
  });
  check('re-saving the same date updates rather than duplicates', r.status === 200, r.data);
  r = await call('shep', 'GET', '/api/shepherd/attendance');
  check('only one register exists for that date', r.data.length === 1 && r.data[0].visitorCount === 6, r.data);
  check('totals computed', r.data[0].excused === 1 && r.data[0].total === 6, r.data[0]);

  r = await call('shep', 'GET', `/api/shepherd/attendance-history/${memberId}`);
  check('attendance history reads back', r.data.servicesRecorded === 1 && r.data.rate === 0, r.data);

  console.log('\n== membership workflow (section 7): visitor -> active ==');
  r = await call('shep', 'PATCH', `/api/shepherd/members/${memberId}/stage`, { stage: 'not_a_real_stage' });
  check('an unknown membership stage is rejected', r.status === 400, r.data);
  r = await call('shep', 'PATCH', `/api/shepherd/members/${memberId}/stage`, { stage: 'under_review' });
  check('shepherding begins review', r.status === 200 && r.data.item.membershipStage === 'under_review', r.data);
  r = await call('shep', 'PATCH', `/api/shepherd/members/${memberId}/stage`, { stage: 'accepted' });
  check('shepherding accepts the visitor as a member', r.status === 200 && r.data.item.membershipStage === 'accepted', r.data);
  check('no membership number yet — not active', !r.data.item.membershipNumber, r.data);
  r = await call('shep', 'PATCH', `/api/shepherd/members/${memberId}/stage`, { stage: 'active', shepherdName: 'Sister Grace' });
  check('shepherding assigns a shepherd and activates membership', r.status === 200 && r.data.item.membershipStage === 'active', r.data);
  check('a membership number is issued on activation', /^TEST-CHAPTER-\d{4}$/.test(r.data.item.membershipNumber), r.data.item);
  check('the assigned shepherd is recorded', r.data.item.shepherdName === 'Sister Grace', r.data.item);
  check('a QR token was generated for the digital membership card', !!r.data.item.qrToken, r.data.item);

  console.log('\n== shepherding: member edits + messages ==');
  r = await call('shep', 'PUT', `/api/shepherd/members/${memberId}`, { phone: '0201234567', level: '300' });
  check('shepherding edits member details', r.status === 200 && r.data.item.phone === '0201234567', r.data);
  check('email is never returned with a password hash', r.data.item.passwordHash === undefined, r.data);

  r = await call('anon', 'POST', '/api/contact', { name: 'Kofi', email: 'kofi@test.com', message: 'Hello there' });
  check('contact form accepts a message', r.status === 200, r.data);
  r = await call('shep', 'GET', '/api/shepherd/contact-messages');
  check('message reaches shepherding', r.data.length === 1, r.data);
  const msgId = r.data[0].id;
  r = await call('shep', 'PATCH', `/api/shepherd/contact-messages/${msgId}`, { status: 'replied' });
  check('message can be marked replied', r.status === 200 && r.data.item.status === 'replied', r.data);

  console.log('\n== publicity ==');
  r = await call('pub', 'GET', '/api/publicity/audiences');
  check('audiences list reachable numbers', r.status === 200 && r.data.audiences[0].reachable === 1, r.data);

  r = await call('pub', 'POST', '/api/publicity/notifications', { title: 'Service at 9', body: 'Come early', channels: ['app', 'sms'] });
  check('announcement sends on both channels', r.status === 200 && /posted to the app/.test(r.data.result), r.data);
  check('SMS reports itself unconfigured rather than failing', /not configured/.test(r.data.result), r.data);

  r = await call('pub', 'GET', '/api/publicity/sms-logs');
  check('SMS attempt is logged even when skipped', r.data.length === 1 && r.data[0].status === 'skipped', r.data);

  r = await call('pub', 'POST', '/api/publicity/scheduled', {
    title: 'Tomorrow', body: 'Programme at 6', channels: ['app'],
    scheduledFor: new Date(Date.now() + 3600000).toISOString()
  });
  check('announcement scheduled', r.status === 200, r.data);
  const schedId = r.data.item.id;
  r = await call('pub', 'POST', '/api/publicity/scheduled', {
    title: 'Past', body: 'x', scheduledFor: new Date(Date.now() - 86400000).toISOString()
  });
  check('past send time rejected', r.status === 400, r.data);
  r = await call('pub', 'PATCH', `/api/publicity/scheduled/${schedId}/cancel`);
  check('scheduled announcement cancelled', r.status === 200 && r.data.item.status === 'cancelled', r.data);

  r = await call('anon', 'POST', '/api/testimonies', { name: 'Esi', testimony: 'God is good' });
  check('testimony submitted publicly', r.status === 200, r.data);
  r = await call('pub', 'GET', '/api/publicity/testimonies');
  check('testimony lands in the publicity inbox', r.data.length === 1 && r.data[0].published === false, r.data);
  r = await call('pub', 'PATCH', `/api/publicity/testimonies/${r.data[0].id}`, { published: true });
  check('publicity publishes it', r.status === 200 && r.data.item.published === true, r.data);
  r = await call('anon', 'GET', '/api/testimonies');
  check('published testimony now public', r.data.length === 1, r.data);

  r = await call('pub', 'POST', '/api/publicity/events', { title: 'Revival', date: '2026-09-01', time: '18:00', location: 'Auditorium' });
  check('publicity creates an event', r.status === 200, r.data);
  const eventId = r.data.item.id;
  r = await call('pub', 'PUT', `/api/publicity/events/${eventId}`, { title: 'Revival', date: '2026-09-02', time: '18:00', announceUpdate: true });
  check('publicity updates and announces it', r.status === 200 && r.data.item.date === '2026-09-02', r.data);

  console.log('\n== department header images ==');
  r = await call('admin', 'POST', '/api/admin/departments', { name: 'Choir', tagline: 'Sing' });
  check('department created', r.status === 200, r.data);
  const deptId = r.data.item.id;
  r = await call('admin', 'GET', '/api/admin/image-placements');
  check('placement options served', r.status === 200 && r.data.placements.some(p => p.value === 'department-header'), r.data);
  check('departments offered as targets', r.data.departments.some(d => d.id === deptId), r.data.departments);

  const form = new FormData();
  form.append('file', new Blob([Buffer.from('fake-image-bytes')], { type: 'image/png' }), 'header.png');
  form.append('placement', 'department-header');
  form.append('targetId', deptId);
  const upRes = await fetch(BASE + '/api/admin/uploads', { method: 'POST', headers: { cookie: jars.admin }, body: form });
  const upData = await upRes.json();
  check('header upload succeeds', upRes.status === 200, upData);
  check('upload explains where the image went', /Choir/.test(upData.message || ''), upData);
  r = await call('anon', 'GET', `/api/departments/${deptId}`);
  check('department now carries the header image', !!r.data.headerImageFileId, r.data);
  const fileId = r.data.headerImageFileId;

  r = await call('admin', 'DELETE', `/api/admin/files/${fileId}`);
  check('deleting the file succeeds', r.status === 200, r.data);
  r = await call('anon', 'GET', `/api/departments/${deptId}`);
  check('department no longer points at a deleted image', !r.data.headerImageFileId, r.data);

  console.log('\n== coordinator dashboard ==');
  r = await call('coord', 'GET', '/api/coordinator/overview');
  check('overview loads', r.status === 200, r.data);
  check('finance section present', r.data.finance && typeof r.data.finance.balance === 'number', r.data.finance);
  check('shepherding trend present', Array.isArray(r.data.shepherding.attendanceTrend), r.data.shepherding);
  check('team list omits password hashes', r.data.team.every(t => t.passwordHash === undefined), r.data.team);
  r = await call('fin', 'GET', '/api/coordinator/overview');
  check('finance role cannot read the coordinator dashboard', r.status === 401, r.data);
  r = await call('admin', 'GET', `/api/coordinator/overview?chapterId=${chapterId}`);
  check('national coordinator can open a specific chapter\'s coordinator dashboard', r.status === 200 && r.data.chapter.id === chapterId, r.data);
  r = await call('admin', 'GET', '/api/coordinator/overview');
  check('national coordinator must pick a chapter — no implicit "everything" view here', r.status === 400, r.data);

  console.log('\n== form builder (section 11) ==');
  r = await call('pub', 'POST', '/api/admin/forms', {
    title: 'Retreat Sign-up', category: 'travelling_event',
    fields: [
      { label: 'Full Name', type: 'short_text', required: true },
      { label: 'T-Shirt Size', type: 'dropdown', options: ['S', 'M', 'L'], required: false }
    ]
  });
  check('publicity creates a form', r.status === 200 && r.data.item.fields.length === 2, r.data);
  const formId = r.data.item.id;
  const nameFieldId = r.data.item.fields[0].id;

  r = await call('fin', 'POST', '/api/admin/forms', { title: 'Not allowed', fields: [] });
  check('finance cannot build forms', r.status === 401, r.data);

  r = await call('anon', 'GET', '/api/forms');
  check('open forms are publicly listable', r.data.some(f => f.id === formId), r.data);

  r = await call('anon', 'POST', `/api/forms/${formId}/submit`, { answers: {} });
  check('a required field is enforced on submission', r.status === 400, r.data);

  r = await call('anon', 'POST', `/api/forms/${formId}/submit`, {
    answers: { [nameFieldId]: 'Ama Retreat' }, submitterName: 'Ama Retreat', submitterEmail: 'ama.retreat@test.com'
  });
  check('form submission accepted', r.status === 200, r.data);

  r = await call('pub', 'GET', `/api/admin/forms/${formId}/submissions`);
  check('publicity sees the submission', r.data.submissions.length === 1 && r.data.submissions[0].submitterName === 'Ama Retreat', r.data);
  r = await call('fin', 'GET', `/api/admin/forms/${formId}/submissions`);
  check('finance cannot view form submissions', r.status === 401, r.data);

  console.log('\n== executive portal + event workflow (section 9) ==');
  r = await call('admin', 'POST', '/api/admin/staff', { username: 'exec.ama', name: 'Ama Exec', role: 'executive', password: 'password123' });
  check('executive account created', r.status === 200, r.data);
  r = await call('exec', 'POST', '/api/portal/login', { username: 'exec.ama', password: 'password123' });
  check('executive signs in', r.status === 200, r.data);

  r = await call('exec', 'GET', '/api/executive/me');
  check('no executive record exists yet', r.data.item === null, r.data);

  const execForm = new FormData();
  execForm.append('name', 'Ama Executive');
  execForm.append('role', 'Financial Secretary');
  execForm.append('department', 'welfare');
  const execRes = await fetch(BASE + '/api/executive/me', { method: 'PUT', headers: { cookie: jars.exec }, body: execForm });
  const execData = await execRes.json();
  check('executive saves their own profile', execRes.status === 200 && execData.item.role === 'Financial Secretary', execData);

  r = await call('exec', 'POST', '/api/executive/events', { title: 'Campus Outreach', date: '2026-10-10' });
  check('executive submits an event', r.status === 200 && r.data.item.status === 'submitted', r.data);
  const execEventId = r.data.item.id;

  r = await call('anon', 'GET', '/api/events');
  check('a submitted event is not public yet', !r.data.some(e => e.id === execEventId), r.data);
  r = await call('pub', 'GET', '/api/publicity/events/queue');
  check('the event appears in publicity\'s review queue', r.data.some(e => e.id === execEventId), r.data);

  r = await call('exec', 'PATCH', `/api/publicity/events/${execEventId}/review`, { decision: 'approved' });
  check('an executive cannot review events (including their own)', r.status === 401, r.data);
  r = await call('pub', 'PATCH', `/api/publicity/events/${execEventId}/review`, { decision: 'approved' });
  check('publicity approves the event', r.status === 200 && r.data.item.status === 'approved', r.data);
  r = await call('anon', 'GET', '/api/events');
  check('approved-but-not-published is still not public', !r.data.some(e => e.id === execEventId), r.data);
  r = await call('pub', 'PATCH', `/api/publicity/events/${execEventId}/publish`, {});
  check('publicity publishes the event', r.status === 200 && r.data.item.status === 'published', r.data);
  r = await call('anon', 'GET', '/api/events');
  check('a published event is now public', r.data.some(e => e.id === execEventId), r.data);

  console.log('\n== digital membership card + QR attendance (sections 13, 14) ==');
  r = await call('member', 'GET', '/api/member/card');
  check('an active member gets a real digital card with a QR code', r.status === 200 && r.data.ready === true && !!r.data.qrDataUrl, { ready: r.data.ready });

  const { fakeModels } = require('./harness.js');
  const memberDoc = (await fakeModels.Member.find({ id: memberId }))[0];
  const qrToken = memberDoc.qrToken;
  check('the member has a real qrToken on file', typeof qrToken === 'string' && qrToken.length > 10, { qrToken });

  r = await call('shep', 'POST', '/api/attendance/scan', { qrToken, date: '2026-08-16', serviceType: 'sunday' });
  check('scanning a valid QR code records attendance', r.status === 200 && r.data.member.id === memberId, r.data);
  r = await call('shep', 'POST', '/api/attendance/scan', { qrToken, date: '2026-08-16', serviceType: 'sunday' });
  check('scanning the same code again reports "already marked"', r.status === 200 && r.data.alreadyMarked === true, r.data);
  r = await call('shep', 'POST', '/api/attendance/scan', { qrToken: 'not-a-real-token', date: '2026-08-16' });
  check('an unknown QR code is rejected', r.status === 404, r.data);
  r = await call('pub', 'POST', '/api/attendance/mark', { memberId, date: '2026-08-16', serviceType: 'midweek' });
  check('the manual search fallback also records attendance', r.status === 200, r.data);

  const membershipPdf = await fetch(BASE + '/api/shepherd/members/report.pdf', { headers: { cookie: jars.shep } });
  check('membership PDF report generates', membershipPdf.status === 200 && (membershipPdf.headers.get('content-type') || '').includes('application/pdf'), { status: membershipPdf.status });
  const attendancePdf = await fetch(BASE + '/api/shepherd/attendance-summary.pdf', { headers: { cookie: jars.shep } });
  check('attendance percentage PDF report generates', attendancePdf.status === 200 && (attendancePdf.headers.get('content-type') || '').includes('application/pdf'), { status: attendancePdf.status });
  const financePdf = await fetch(BASE + '/api/finance/export.pdf', { headers: { cookie: jars.fin } });
  check('finance PDF report generates', financePdf.status === 200 && (financePdf.headers.get('content-type') || '').includes('application/pdf'), { status: financePdf.status });

  console.log('\n== Bible Study (section 16) ==');
  r = await call('admin', 'POST', '/api/admin/bible-studies', {
    topic: 'The Armor of God', scriptureReference: 'Ephesians 6:10-18', questions: ['What stood out to you?']
  });
  check('a Bible study is created', r.status === 200 && r.data.item.questions.length === 1, r.data);
  const studyId = r.data.item.id;
  r = await call('anon', 'GET', '/api/bible-studies');
  check('Bible studies are publicly listed', r.data.some(s => s.id === studyId), r.data);
  r = await call('admin', 'DELETE', `/api/admin/bible-studies/${studyId}`);
  check('a Bible study can be deleted', r.status === 200, r.data);

  console.log('\n== Sermon Notes (section 17) — private to the member ==');
  r = await call('member', 'POST', '/api/member/sermon-notes', { sermonTitle: 'Faith That Moves', preacher: 'Rev. Owusu', notes: 'Great word today' });
  check('a member saves a sermon note', r.status === 200, r.data);
  const noteId = r.data.item.id;
  r = await call('member', 'GET', '/api/member/sermon-notes');
  check('the member sees their own note', r.data.length === 1 && r.data[0].id === noteId, r.data);
  r = await call('shep', 'GET', '/api/member/sermon-notes');
  check('a staff-only session (no member login) cannot read sermon notes', r.status === 401, r.data);
  r = await call('member', 'PUT', `/api/member/sermon-notes/${noteId}`, { summary: 'Updated summary' });
  check('the member updates their own note', r.status === 200 && r.data.item.summary === 'Updated summary', r.data);
  r = await call('member', 'DELETE', `/api/member/sermon-notes/${noteId}`);
  check('the member deletes their own note', r.status === 200, r.data);

  console.log('\n== Prayer Wall (section 18) ==');
  r = await call('anon', 'POST', '/api/prayer-requests', { name: 'Kwame', request: 'Pray for my exams', visibility: 'public' });
  check('a public prayer request is submitted', r.status === 200, r.data);
  r = await call('anon', 'GET', '/api/prayer-wall');
  check('it appears on the public wall', r.data.some(p => p.request === 'Pray for my exams'), r.data);
  const wallItem = r.data.find(p => p.request === 'Pray for my exams');

  r = await call('anon', 'POST', `/api/prayer-requests/${wallItem.id}/pray`, {});
  check('signed-out visitors cannot say they are praying', r.status === 401, r.data);
  r = await call('member', 'POST', `/api/prayer-requests/${wallItem.id}/pray`, {});
  check('a signed-in member can say they are praying', r.status === 200, r.data);
  r = await call('anon', 'GET', '/api/prayer-wall');
  check('the praying count increments', r.data.find(p => p.id === wallItem.id).prayingCount === 1, r.data);

  r = await call('anon', 'POST', '/api/prayer-requests', { name: 'Ama', request: 'A private matter', visibility: 'private' });
  r = await call('anon', 'GET', '/api/prayer-wall');
  check('private prayer requests never appear on the public wall', !r.data.some(p => p.request === 'A private matter'), r.data);

  r = await call('member', 'PATCH', `/api/prayer-requests/${wallItem.id}/answered`, { testimony: 'God answered!' });
  check('a member who did not submit a request cannot mark it answered', r.status === 403, r.data);
  r = await call('shep', 'PATCH', `/api/prayer-requests/${wallItem.id}/answered`, { testimony: 'God answered!' });
  check('shepherding can mark it answered on behalf of an anonymous submitter', r.status === 200 && r.data.item.answered === true, r.data);
  r = await call('anon', 'GET', '/api/prayer-wall');
  check('the answered testimony shows on the public wall', r.data.find(p => p.id === wallItem.id).testimony === 'God answered!', r.data);

  console.log('\n== Groups (section 20) ==');
  r = await call('pub', 'POST', '/api/admin/groups', { name: 'Young Adults Bible Study', type: 'bible_study', meetingDay: 'Wednesday' });
  check('a group is created', r.status === 200, r.data);
  const groupId = r.data.item.id;
  r = await call('anon', 'GET', '/api/groups');
  check('groups are publicly listable', r.data.some(g => g.id === groupId), r.data);
  r = await call('member', 'GET', `/api/groups/${groupId}/posts`);
  check('a non-member cannot read a group\'s posts', r.status === 403, r.data);
  r = await call('member', 'POST', `/api/groups/${groupId}/join`);
  check('a member joins the group', r.status === 200, r.data);
  r = await call('member', 'GET', `/api/groups/${groupId}`);
  check('membership is reflected on the group', r.data.isMember === true && r.data.memberCount === 1, r.data);
  r = await call('member', 'POST', `/api/groups/${groupId}/posts`, { body: 'Excited for this study!', isAnnouncement: true });
  check('a member can post, but cannot post as an announcement (leader-only)', r.status === 200 && r.data.item.isAnnouncement === false, r.data);
  r = await call('member', 'GET', `/api/groups/${groupId}/posts`);
  check('the post is visible to group members', r.data.length === 1, r.data);
  r = await call('member', 'POST', `/api/groups/${groupId}/meetings`, { date: '2026-09-02', topic: 'Intro' });
  check('a plain member cannot log a meeting (leader-only)', r.status === 403, r.data);
  r = await call('member', 'POST', `/api/groups/${groupId}/leave`);
  check('a member leaves the group', r.status === 200, r.data);
  r = await call('member', 'GET', `/api/groups/${groupId}`);
  check('membership count drops after leaving', r.data.memberCount === 0, r.data);

  console.log('\n== Community Chat (section 19) ==');
  r = await call('member', 'POST', '/api/chat/topics', { title: 'What blessed you this week?' });
  check('a member starts a discussion', r.status === 200, r.data);
  const topicId = r.data.item.id;
  r = await call('member', 'POST', `/api/chat/topics/${topicId}/messages`, { body: 'Grace abounding!' });
  check('a member posts a message', r.status === 200, r.data);
  const chatMsgId = r.data.item.id;
  r = await call('member', 'POST', `/api/chat/messages/${chatMsgId}/report`);
  check('a member reports a message', r.status === 200, r.data);
  r = await call('fin', 'PATCH', `/api/chat/messages/${chatMsgId}/moderate`, { hidden: true });
  check('a non-admin role cannot moderate chat', r.status === 401, r.data);
  r = await call('admin', 'PATCH', `/api/chat/messages/${chatMsgId}/moderate`, { hidden: true });
  check('an admin/chapter-admin hides a reported message', r.status === 200 && r.data.item.hidden === true, r.data);
  r = await call('member', 'GET', `/api/chat/topics/${topicId}/messages`);
  check('a hidden message no longer shows, but is not destroyed', r.data.length === 0, r.data);
  r = await call('admin', 'PATCH', `/api/chat/topics/${topicId}/lock`, { locked: true });
  check('an admin locks the discussion', r.status === 200, r.data);
  r = await call('member', 'POST', `/api/chat/topics/${topicId}/messages`, { body: 'Late reply' });
  check('posting to a locked discussion is rejected', r.status === 400, r.data);
  r = await call('admin', 'PATCH', `/api/admin/members/${memberId}/chat-restriction`, { chatRestricted: true });
  check('a member is restricted from chat', r.status === 200, r.data);
  r = await call('member', 'POST', '/api/chat/topics', { title: 'Should not be allowed' });
  check('a restricted member cannot start a new discussion', r.status === 403, r.data);
  await call('admin', 'PATCH', `/api/admin/members/${memberId}/chat-restriction`, { chatRestricted: false });

  console.log('\n== Volunteer / Service Scheduling (section 23) ==');
  r = await call('pub', 'POST', `/api/events/${eventId}/volunteers`, { role: 'usher', memberId });
  check('publicity assigns a volunteer role', r.status === 200 && r.data.item.status === 'assigned', r.data);
  const volAssignmentId = r.data.item.id;
  r = await call('member', 'GET', '/api/member/volunteer-assignments');
  check('the member sees their own assignment, with the event attached', r.data.length === 1 && r.data[0].event && r.data[0].event.id === eventId, r.data);
  r = await call('member', 'PATCH', `/api/member/volunteer-assignments/${volAssignmentId}`, { status: 'confirmed' });
  check('the member confirms their assignment', r.status === 200 && r.data.item.status === 'confirmed', r.data);

  console.log('\n== Member Milestones (section 36) ==');
  r = await call('shep', 'POST', '/api/shepherd/milestones', { memberId, type: 'membership_anniversary', note: '1 year!' });
  check('shepherding logs a milestone', r.status === 200, r.data);
  r = await call('shep', 'GET', '/api/shepherd/milestones');
  check('the milestone is listed', r.data.some(m => m.type === 'membership_anniversary'), r.data);
  check('an executive-appointment milestone was auto-logged earlier when Ama Executive set up her profile', r.data.some(m => m.type === 'executive_appointment'), r.data);

  console.log('\n== Welfare (section 33) ==');
  r = await call('admin', 'POST', '/api/admin/staff', { username: 'welf.efua', name: 'Efua Welfare', role: 'welfare', password: 'password123' });
  check('welfare officer account created', r.status === 200, r.data);
  r = await call('welf', 'POST', '/api/portal/login', { username: 'welf.efua', password: 'password123' });
  check('welfare officer signs in', r.status === 200, r.data);

  r = await call('member', 'POST', '/api/welfare/requests', { category: 'financial', description: 'Struggling with hostel fees this semester' });
  check('a member submits their own welfare request', r.status === 200, r.data);
  const ownWelfareId = r.data.item.id;
  r = await call('member', 'GET', '/api/welfare/requests/mine');
  check('the member sees their own request, without internal notes', r.data.length === 1 && r.data[0].notes === undefined, r.data);
  r = await call('fin', 'GET', '/api/welfare/requests');
  check('finance cannot see the welfare queue', r.status === 401, r.data);
  r = await call('shep', 'GET', '/api/welfare/requests');
  check('shepherding can refer, but cannot browse the full welfare queue', r.status === 401, r.data);
  r = await call('shep', 'POST', '/api/shepherd/welfare-referrals', { memberId, category: 'medical', description: 'Mentioned they have been unwell' });
  check('shepherding raises a referral on behalf of a member', r.status === 200 && r.data.item.referredBy, r.data);
  r = await call('welf', 'GET', '/api/welfare/requests');
  check('the welfare officer sees both the self-submitted request and the referral', r.data.length === 2, r.data);
  r = await call('welf', 'PATCH', `/api/welfare/requests/${ownWelfareId}`, { status: 'approved', notes: 'Approved for GHS200 support' });
  check('the welfare officer updates status and case notes', r.status === 200 && r.data.item.status === 'approved', r.data);
  r = await call('member', 'GET', '/api/welfare/requests/mine');
  check('the member sees the updated status but still no notes', r.data.find(w => w.id === ownWelfareId).status === 'approved' && r.data.find(w => w.id === ownWelfareId).notes === undefined, r.data);

  console.log('\n== Giving (section 32) — manual/reference-based, not a live payment gateway ==');
  r = await call('member', 'GET', '/api/giving/chapter-info');
  check('giving is not configured until the chapter sets payment details', r.data.configured === false, r.data);
  r = await call('admin', 'PUT', `/api/national/chapters/${chapterId}`, {
    payment: { momoNumber: '0244000000', momoName: 'ACONSU Test Chapter', provider: 'Manual MoMo' }
  });
  check('national coordinator sets the chapter\'s payment details', r.status === 200, r.data);
  r = await call('member', 'GET', '/api/giving/chapter-info');
  check('giving now shows the chapter\'s real MoMo details', r.data.configured === true && r.data.payment.momoNumber === '0244000000', r.data);

  r = await call('member', 'POST', '/api/giving/intents', { amount: 50, purpose: 'tithe', method: 'momo', reference: 'MM998877' });
  check('a member logs a gift they sent', r.status === 200 && r.data.item.status === 'pending', r.data);
  const givingIntentId = r.data.item.id;
  r = await call('fin', 'GET', '/api/finance/giving-queue');
  check('finance sees the pending claim', r.data.some(g => g.id === givingIntentId), r.data);
  r = await call('fin', 'GET', '/api/finance/summary');
  const incomeBeforeGiving = r.data.totalIncome;
  r = await call('fin', 'PATCH', `/api/finance/giving/${givingIntentId}/confirm`, {});
  check('finance confirms the claim into a real ledger entry', r.status === 200 && r.data.item.status === 'confirmed' && !!r.data.entry.id, r.data);
  r = await call('fin', 'GET', '/api/finance/summary');
  check('the confirmed gift actually moved the books by GHS 50', r.data.totalIncome === incomeBeforeGiving + 50, r.data);
  r = await call('member', 'GET', '/api/giving/mine');
  check('the member sees it as confirmed in their own history', r.data.find(g => g.id === givingIntentId).status === 'confirmed', r.data);

  console.log('\n== chapter isolation (section 1, 43, 44) — the whole point of this phase ==');
  r = await call('admin', 'POST', '/api/national/chapters', { id: 'test-chapter-2', name: 'ACONSU-Test-2', institution: 'Second University' });
  check('a second chapter is created', r.status === 200, r.data);
  r = await call('admin', 'GET', '/api/national/dashboard');
  check('national dashboard now counts two chapters', r.data.totalChapters === 2, r.data);

  r = await call('admin', 'POST', '/api/admin/departments', { name: 'Chapter 1 Only Dept', chapterId });
  check('explicit chapterId still works now that a default can no longer be assumed', r.status === 200, r.data);
  r = await call('admin', 'POST', '/api/admin/departments', { name: 'No Chapter Given' });
  check('a national actor MUST specify a chapter once more than one exists', r.status === 400, r.data);

  r = await call('admin', 'POST', '/api/admin/staff', { username: 'fin2', name: 'fin2', role: 'finance', password: 'password123', chapterId: 'test-chapter-2' });
  check('finance account created for chapter 2', r.status === 200 && r.data.item.chapterId === 'test-chapter-2', r.data);
  r = await call('fin2', 'POST', '/api/portal/login', { username: 'fin2', password: 'password123' });
  check('chapter 2 finance officer signs in', r.status === 200, r.data);

  // Captured fresh rather than assumed, since an earlier (unrelated) test
  // already deleted the original 1200 income entry as its own cleanup step —
  // isolation is "chapter 2's activity never moves this number", not any
  // particular absolute figure.
  r = await call('fin', 'GET', '/api/finance/summary');
  const chapter1IncomeBefore = r.data.totalIncome;

  r = await call('fin2', 'POST', '/api/finance/entries', { entryType: 'income', category: 'offertory', amount: 999, date: '2026-03-01' });
  check('chapter 2 records its own income', r.status === 200, r.data);
  const chapter2EntryId = r.data.item.id;

  r = await call('fin', 'GET', '/api/finance/summary');
  check("chapter 1's finance summary is untouched by chapter 2's income", r.data.totalIncome === chapter1IncomeBefore, r.data);
  r = await call('fin', 'GET', '/api/finance/entries');
  check("chapter 1's ledger does not list chapter 2's entry", !r.data.some(e => e.id === chapter2EntryId), r.data);
  r = await call('fin', 'PATCH', `/api/finance/entries/${chapter2EntryId}/approval`, { approvalStatus: 'approved' });
  check("chapter 1's finance officer cannot approve chapter 2's entry by guessing its id", r.status === 404, r.data);
  r = await call('fin', 'DELETE', `/api/finance/entries/${chapter2EntryId}`);
  check("chapter 1's finance officer cannot delete chapter 2's entry by id either", r.status === 404, r.data);
  r = await call('fin2', 'GET', '/api/finance/summary');
  check('chapter 2 sees its own 999 income, not chapter 1\'s books', r.data.totalIncome === 999, r.data);

  r = await call('admin', 'POST', '/api/admin/staff', { username: 'shep2', name: 'shep2', role: 'shepherding', password: 'password123', chapterId: 'test-chapter-2' });
  check('shepherding account created for chapter 2', r.status === 200, r.data);
  r = await call('shep2', 'POST', '/api/portal/login', { username: 'shep2', password: 'password123' });
  check('chapter 2 shepherd signs in', r.status === 200, r.data);
  r = await call('shep2', 'GET', '/api/shepherd/members');
  check("chapter 2's member list does not include chapter 1's registered member", r.data.length === 0, r.data);
  r = await call('shep2', 'POST', '/api/attendance/scan', { qrToken, date: '2026-08-16' });
  check("chapter 2 cannot check in chapter 1's member by QR code — chapter is verified, not just the code", r.status === 404, r.data);

  r = await call('admin', 'POST', `/api/national/chapters/test-chapter-2/assign-coordinator`, { username: 'coord2', name: 'Coord Two', password: 'password123' });
  check('national coordinator assigns chapter 2 its own Chapter Coordinator', r.status === 200, r.data);
  r = await call('coord2', 'POST', '/api/portal/login', { username: 'coord2', password: 'password123' });
  check('chapter 2 coordinator signs in', r.status === 200, r.data);
  r = await call('coord2', 'GET', '/api/finance/summary');
  check("chapter 2's coordinator reads chapter 2's finances (999), never chapter 1's", r.status === 200 && r.data.totalIncome === 999, r.data);
  r = await call('coord', 'GET', '/api/finance/summary');
  check("chapter 1's coordinator still reads only chapter 1's finances, unaffected by any of the above", r.data.totalIncome === chapter1IncomeBefore, r.data);

  console.log('\n== static pages ==');
  for (const page of [
    '/more.html', '/national.html', '/finance.html', '/coordinator.html', '/publicity.html', '/shepherding.html',
    '/register.html', '/executive.html', '/card.html', '/bible-study.html', '/sermon-notes.html', '/prayer.html',
    '/events.html', '/index.html',
    '/groups.html', '/group.html', '/chat.html', '/welfare.html', '/welfare-portal.html', '/give.html',
    '/content.html', '/content-manager.html',
    '/js/portal.js', '/js/national.js', '/js/executive.js', '/js/welfare-portal.js', '/css/portal.css'
  ]) {
    const res = await fetch(BASE + page);
    check(`${page} served`, res.status === 200);
  }

  // The send loop only ticks once a minute, so this one is opt-in: run it with
  // SMOKE_SLOW=1 when the scheduling path itself is what changed.
  if (process.env.SMOKE_SLOW === '1') {
  console.log('\n== scheduler (waits for the 60s tick) ==');
  const { fakeModels } = require('./harness.js');
  await fakeModels.ScheduledNotification.create({
    id: 'due_1', title: 'Due now', body: 'Should fire', url: '/index.html',
    channels: ['app', 'sms'], audience: 'all', scheduledFor: new Date(Date.now() - 5000), status: 'scheduled'
  });
  const beforeCount = (await fakeModels.Notification.find({})).length;
  await new Promise(res => setTimeout(res, 62000));
  const fired = (await fakeModels.ScheduledNotification.findOne({ id: 'due_1' }));
  check('due announcement was sent by the scheduler', fired.status === 'sent', fired);
  check('scheduler recorded an outcome', /posted to the app/.test(fired.result || ''), fired.result);
  const afterCount = (await fakeModels.Notification.find({})).length;
  check('it reached the in-app feed', afterCount === beforeCount + 1, { beforeCount, afterCount });
  }

  console.log(`\n${failures ? `${failures} FAILURES` : 'all checks passed'}`);
  process.exit(failures ? 1 : 0);
})();
