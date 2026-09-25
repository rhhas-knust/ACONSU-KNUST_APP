// Smoke test for the leadership portals.
// Boots the real Express app against an in-memory stand-in for MongoDB
// (see harness.js) and drives it over HTTP, so routes, permission rules and
// the finance/attendance calculations are all exercised for real.
//
//   npm test              — the full suite
//   SMOKE_SLOW=1 npm test — also waits out the 60s scheduled-send tick
const { fakeModels, fakeDb } = require('./harness.js');

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

  async function call(jar, method, path, body, isForm, extraHeaders) {
    const headers = { ...(extraHeaders || {}) };
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
  // Every chapter leader is a member of the chapter first, so each office
  // account is opened against a real member rather than a free-floating
  // username. Their own profile then shows where they stand, like anyone else's.
  async function registerMember(name, email) {
    const fd = new FormData();
    fd.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
    fd.append('name', name); fd.append('email', email);
    fd.append('password', 'secret123'); fd.append('chapterId', chapterId);
    const res = await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd })).json();
    return res.member.id;
  }
  const officeMemberIds = {};
  for (const [role, user] of Object.entries({ finance: 'fin.ama', shepherding: 'shep.kojo', publicity: 'pub.esi', coordinator: 'coord.yaw' })) {
    officeMemberIds[user] = await registerMember(user, user.replace('.', '') + '@test.com');
    r = await call('admin', 'POST', '/api/admin/staff', { username: user, name: user, role, password: 'password123', memberId: officeMemberIds[user] });
    check(`create ${role} account`, r.status === 200, r.data);
  }
  r = await call('admin', 'POST', '/api/admin/staff', { username: 'fin.nomember', name: 'No Member', role: 'finance', password: 'password123' });
  check('a chapter office account cannot be created without a member behind it', r.status === 400, r.data);
  // An executive is a promoted member, so the office can't be created out of
  // thin air — the promotion itself is exercised further down, once members
  // exist (see "executive portal + event workflow").
  r = await call('admin', 'POST', '/api/admin/staff', { username: 'exec.nomember', name: 'No Member', role: 'executive', password: 'password123' });
  check('an executive account cannot be created without a member to promote', r.status === 400, r.data);
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

  console.log('\n== the admin no longer takes over every office portal ==');
  // Reported from the live site: whichever portal you opened, the admin was
  // already sitting in it, and the office's own sign-in was unreachable.
  r = await call('adminPortals', 'POST', '/api/portal/login', { username: 'admin', password: 'admin123' });
  check('the admin signs in', r.status === 200, r.data);
  r = await call('adminPortals', 'GET', '/api/portal/me');
  const adminAccess = r.data.access || {};
  check('the office portals now ask for the office holder instead of seating the admin',
    ['finance', 'shepherding', 'publicity', 'welfare', 'executive'].every(role => adminAccess[role].view === false), adminAccess);
  check('while the national portal, which is genuinely theirs, still opens',
    adminAccess.nationalCoordinator.view === true, adminAccess);
  check('and the coordinator portal is deliberately left alone',
    adminAccess.coordinator.view === true, adminAccess);

  // The people who actually hold the offices are unaffected.
  r = await call('fin', 'GET', '/api/portal/me');
  check('the finance officer still opens their own portal', r.data.access.finance.view === true, r.data.access);
  check('but is not handed somebody else\'s office', r.data.access.publicity.view === false, r.data.access);
  r = await call('coord', 'GET', '/api/portal/me');
  check('a chapter coordinator still oversees their own chapter\'s offices',
    r.data.access.finance.view === true && r.data.access.welfare.view === true, r.data.access);

  // The admin keeps its API reach — this changed which portal opens, not who
  // can do what once inside.
  r = await call('adminPortals', 'GET', '/api/finance/summary');
  check('the admin still has its API authority over finance', r.status === 200, r.data);

  console.log('\n== logging out actually logs you out ==');
  // The env admin signing in through a portal form gets BOTH isAdmin and a
  // staff record, so a logout that only cleared `staff` left them signed in —
  // which is what made the portals feel impossible to leave.
  r = await call('logoutTest', 'POST', '/api/portal/login', { username: 'admin', password: 'admin123' });
  check('the env admin can sign in through a portal login form', r.status === 200, r.data);
  r = await call('logoutTest', 'GET', '/api/admin/check');
  check('and is recognised as admin while signed in', r.data.isAdmin === true, r.data);
  r = await call('logoutTest', 'POST', '/api/portal/logout');
  check('portal logout succeeds', r.status === 200, r.data);
  r = await call('logoutTest', 'GET', '/api/admin/check');
  check('the admin flag is gone after logging out, not just the staff record', r.data.isAdmin === false, r.data);
  r = await call('logoutTest', 'GET', '/api/portal/me');
  check('and the portal no longer recognises them at all', !r.data.staff && r.data.isAdmin === false, r.data);

  // A member signed in on the same browser is signed out too, rather than
  // being left behind on a shared device.
  r = await call('logoutTest2', 'POST', '/api/portal/login', { username: 'fin.ama', password: 'password123' });
  check('a staff account signs in', r.status === 200, r.data);
  r = await call('logoutTest2', 'POST', '/api/auth/logout');
  check('the member-side logout ends the session too', r.status === 200, r.data);
  r = await call('logoutTest2', 'GET', '/api/portal/me');
  check('leaving no staff identity behind on a shared device', !r.data.staff, r.data);

  console.log('\n== national coordinator ==');
  r = await call('admin', 'GET', '/api/admin/image-placements');
  check('homepage header placement is available to the media library', r.status === 200 && r.data.placements.some(p => p.value === 'home-header'), r.data);

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

  r = await call('admin', 'POST', '/api/admin/sermons', {
    chapterId,
    title: 'Covenant Search Message',
    speaker: 'Rev Search',
    description: 'Searchable sermon detail',
    url: 'https://example.com/sermon'
  });
  check('admin creates a searchable sermon', r.status === 200 && r.data.item.title === 'Covenant Search Message', r.data);
  const searchableSermonId = r.data.item.id;

  r = await call('admin', 'POST', '/api/admin/events', {
    chapterId,
    title: 'Grace Search Convention',
    date: '2026-03-14',
    time: '18:00',
    location: 'Main Auditorium',
    description: 'Searchable event detail',
    status: 'published'
  });
  check('admin creates a searchable published event', r.status === 200 && r.data.item.title === 'Grace Search Convention', r.data);
  const searchableEventId = r.data.item.id;

  r = await call('admin', 'POST', '/api/admin/pages', {
    chapterId,
    title: 'Search Welcome Page',
    slug: 'search-welcome-page',
    navLabel: 'Search Welcome',
    description: 'Findable custom page',
    content: 'Welcome to the searchable custom page'
  });
  check('admin creates a searchable custom page', r.status === 200 && r.data.item.slug === 'search-welcome-page', r.data);

  r = await call('anon', 'GET', `/api/search?q=${encodeURIComponent('Sunday Miracle Service')}`);
  const liveSearchHit = (r.data.results || []).find(item => item.id === liveContentId);
  check('public search ranks and deep-links exact content matches', r.status === 200 && r.data.results[0] && r.data.results[0].id === liveContentId && liveSearchHit && liveSearchHit.href.includes(`/content.html?kind=live_service&item=${liveContentId}&q=Sunday%20Miracle%20Service`), r.data.results);

  r = await call('anon', 'GET', `/api/search?q=${encodeURIComponent('Covenant Search Message')}`);
  const sermonSearchHit = (r.data.results || []).find(item => item.id === searchableSermonId);
  check('public search deep-links sermons to the selected item', r.status === 200 && sermonSearchHit && sermonSearchHit.href.includes(`/media.html?sermon=${searchableSermonId}&q=Covenant%20Search%20Message`), r.data.results);

  r = await call('anon', 'GET', `/api/search?q=${encodeURIComponent('Grace Search Convention')}`);
  const eventSearchHit = (r.data.results || []).find(item => item.id === searchableEventId);
  check('public search deep-links events to the selected item', r.status === 200 && eventSearchHit && eventSearchHit.href.includes(`/events.html?event=${searchableEventId}&q=Grace%20Search%20Convention`), r.data.results);

  r = await call('anon', 'GET', `/api/search?q=${encodeURIComponent('Search Welcome Page')}`);
  check('public search deep-links custom pages', r.status === 200 && (r.data.results || []).some(item => item.href.includes('/page.html?slug=search-welcome-page&q=Search%20Welcome%20Page')), r.data.results);

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
  r = await call('anon', 'GET', `/api/search?q=${encodeURIComponent('Sunday Miracle Service')}`);
  check('disabled live-streaming also hides live content from public search', r.status === 200 && !(r.data.results || []).some(item => item.id === liveContentId), r.data.results);
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
  const onboardingTasks = await fakeModels.OnboardingTask.find({ memberId: regData.member.id });
  check('day 0 + day 3 onboarding tasks are queued for a new registration', onboardingTasks.length === 2, onboardingTasks);

  console.log('\n== shepherding: attendance ==');
  r = await call('shep', 'GET', '/api/shepherd/members');
  // Found by identity, not position. This used to read r.data[0] because the
  // suite had exactly one member; the moment office accounts got members of
  // their own, "the first row" became somebody else and every later test
  // quietly operated on the wrong person.
  const memberId = regData.member.id;
  const meRow = r.data.find(m => m.memberId === memberId);
  check('member appears in the shepherding list', !!meRow, r.data.map(m => m.name));
  check('new registration starts as a visitor', meRow && meRow.membershipStage === 'visitor', meRow);

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
  r = await call('shep', 'PATCH', `/api/shepherd/members/${memberId}/stage`, { stage: 'worker' });
  check('lifecycle can advance from active to worker', r.status === 200 && r.data.item.membershipStage === 'worker', r.data);
  r = await call('shep', 'PATCH', `/api/shepherd/members/${memberId}/stage`, { stage: 'executive' });
  check('lifecycle can advance from worker to executive', r.status === 200 && r.data.item.membershipStage === 'executive', r.data);
  r = await call('shep', 'PATCH', `/api/shepherd/members/${memberId}/stage`, { stage: 'alumni' });
  check('lifecycle can advance from executive to alumni', r.status === 200 && r.data.item.membershipStage === 'alumni', r.data);
  r = await call('shep', 'PATCH', `/api/shepherd/members/${memberId}/stage`, { stage: 'active' });
  check('lifecycle can return to active when needed', r.status === 200 && r.data.item.membershipStage === 'active', r.data);
  r = await call('shep', 'POST', '/api/shepherd/retention-alerts/run');
  check('retention automation run succeeds', r.status === 200, r.data);
  r = await call('shep', 'GET', '/api/shepherd/retention-alerts');
  check('shepherding can read inactivity retention alerts', r.status === 200 && Array.isArray(r.data), r.data);

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
  check('audiences list reachable numbers',
    r.status === 200 && r.data.audiences[0].reachable >= 1, r.data);

  r = await call('pub', 'POST', '/api/publicity/notifications', { title: 'Service at 9', body: 'Come early', channels: ['app', 'sms'] });
  check('announcement sends on both channels', r.status === 200 && /posted to the app/.test(r.data.result), r.data);
  check('SMS reports itself unconfigured rather than failing', /not set up for this chapter/.test(r.data.result), r.data);

  console.log('\n== each chapter\'s own SMS credentials ==');
  // A chapter runs its own mNotify account, so the bill, the credit and the
  // sender name members see are all theirs.
  r = await call('admin', 'GET', `/api/admin/chapter-sms?chapterId=${chapterId}`);
  check('a chapter starts with no SMS credentials of its own', r.status === 200 && r.data.hasApiKey === false, r.data);

  r = await call('admin', 'PUT', '/api/admin/chapter-sms', { chapterId, apiKey: 'live-key-abcd1234', senderId: 'ACONSUKN' });
  check('the chapter saves its own key and sender ID', r.status === 200 && r.data.senderId === 'ACONSUKN', r.data);
  check('and can send once it has them', r.data.canSend === true, r.data);

  // The key is a live secret that spends the chapter's money, so it must never
  // come back out — only whether one is set, and enough to recognise it.
  r = await call('admin', 'GET', `/api/admin/chapter-sms?chapterId=${chapterId}`);
  check('the API key is never returned to the client',
    r.data.hasApiKey === true && !JSON.stringify(r.data).includes('live-key-abcd1234'), r.data);
  check('only a hint of it is shown', r.data.apiKeyHint === '••••1234', r.data);

  // The provider rejects a longer sender ID, so it is caught here rather than
  // as an opaque error after a failed send.
  r = await call('admin', 'PUT', '/api/admin/chapter-sms', { chapterId, senderId: 'WAY-TOO-LONG-NAME' });
  check('a sender ID over the provider limit is refused', r.status === 400, r.data);

  // Saving without re-typing the secret must not wipe it.
  r = await call('admin', 'PUT', '/api/admin/chapter-sms', { chapterId, senderId: 'ACONSU' });
  check('saving without re-typing the key keeps the stored one', r.status === 200 && r.data.hasApiKey === true && r.data.senderId === 'ACONSU', r.data);

  // Clearing is its own action, so "I did not retype it" can never wipe a
  // working setup by accident. (Cross-chapter isolation is proved in the
  // chapter-isolation section below, where a second chapter already exists —
  // creating one here would switch the whole deployment out of "single
  // chapter, zero friction" mode and change behaviour for every later test.)
  r = await call('admin', 'DELETE', '/api/admin/chapter-sms', { chapterId });
  check('credentials can be cleared deliberately', r.status === 200 && r.data.hasApiKey === false, r.data);
  r = await call('admin', 'PUT', '/api/admin/chapter-sms', { chapterId, apiKey: 'live-key-abcd1234', senderId: 'ACONSU' });
  check('and set again afterwards', r.status === 200 && r.data.hasApiKey === true, r.data);

  r = await call('pub', 'GET', '/api/publicity/sms-logs');
  check('SMS attempt is logged even when skipped',
    r.data.length >= 1 && r.data.every(l => l.status === 'skipped'), r.data);

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
  // Registration needs a photo, so this goes through multipart like the real
  // form does. An executive is a promoted member, so one is registered here
  // purely to be promoted.
  const execRegForm = new FormData();
  execRegForm.append('profileImage', new Blob([Buffer.from('fake-photo-bytes')], { type: 'image/png' }), 'exec.png');
  execRegForm.append('name', 'Ama Exec');
  execRegForm.append('email', 'exec.ama@test.com');
  execRegForm.append('password', 'secret123');
  execRegForm.append('chapterId', chapterId);
  const execRegRes = await fetch(BASE + '/api/auth/register', { method: 'POST', body: execRegForm });
  const execRegData = await execRegRes.json();
  check('a member registers, ready to be promoted to executive', execRegRes.status === 200, execRegData);
  const amaMemberId = execRegData.member.id;

  // A position is required up front — an executive with no position is one
  // nothing in the system can reason about.
  r = await call('admin', 'POST', '/api/admin/staff', { username: 'exec.nopos', name: 'No Position', role: 'executive', password: 'password123', memberId: amaMemberId });
  check('an executive cannot be created without a position', r.status === 400, r.data);

  // A portfolio holder runs a department; an officer never does. Both halves
  // of that rule are enforced, not just the first.
  r = await call('admin', 'POST', '/api/admin/staff', { username: 'exec.nodept', name: 'No Dept', role: 'executive', password: 'password123', memberId: amaMemberId, positionKey: 'music_director' });
  check('a portfolio holder must be given a department', r.status === 400, r.data);
  r = await call('admin', 'POST', '/api/admin/staff', { username: 'exec.baddept', name: 'Officer With Dept', role: 'executive', password: 'password123', memberId: amaMemberId, positionKey: 'president', department: deptId });
  check('an officer is refused a department, since they answer for the whole chapter', r.status === 400, r.data);

  r = await call('admin', 'POST', '/api/admin/staff', { username: 'exec.ama', name: 'Ama Exec', role: 'executive', password: 'password123', memberId: amaMemberId, positionKey: 'music_director', department: deptId });
  check('executive account created by promoting that member', r.status === 200 && r.data.item.memberId === amaMemberId, r.data);
  check('the promoted executive is given a one-year term of office', !!r.data.item.termEndsAt && !!r.data.item.termYear, r.data.item);
  r = await call('exec', 'POST', '/api/portal/login', { username: 'exec.ama', password: 'password123' });
  check('executive signs in', r.status === 200, r.data);

  // Provisioning is one action: the roster card exists before they ever open
  // the profile form.
  r = await call('exec', 'GET', '/api/executive/me');
  check('their roster card is provisioned with the account', r.status === 200 && r.data.item && r.data.item.positionKey === 'music_director', r.data);
  check('the portal is told which position they hold', r.data.position && r.data.position.key === 'music_director' && r.data.position.kind === 'portfolio', r.data.position);
  check('a portfolio holder is granted their department panels',
    r.data.position.capabilities.includes('department') && r.data.position.capabilities.includes('department.members'), r.data.position);
  check('and is not granted the chapter-wide ones',
    !r.data.position.capabilities.includes('chapter.pulse') && !r.data.position.capabilities.includes('finance.summary'), r.data.position);

  // The position decides what its holder can do, so it cannot be self-set:
  // otherwise any executive could type their way into the officers' screens.
  const escalateForm = new FormData();
  escalateForm.append('name', 'Ama Executive');
  escalateForm.append('role', 'President');
  escalateForm.append('positionKey', 'president');
  escalateForm.append('department', '');
  const escalateRes = await fetch(BASE + '/api/executive/me', { method: 'PUT', headers: { cookie: jars.exec }, body: escalateForm });
  const escalateData = await escalateRes.json();
  check('an executive can save their profile', escalateRes.status === 200, escalateData);
  check('but cannot promote themselves by typing a different position',
    escalateData.item.positionKey === 'music_director' && escalateData.item.role === 'Music Director', escalateData.item);
  r = await call('exec', 'GET', '/api/executive/chapter/pulse');
  check('so the chapter-wide screens stay shut to them', r.status === 403, r.data);
  r = await call('exec', 'GET', '/api/executive/chapter/finance');
  check('including the books summary', r.status === 403, r.data);

  r = await call('exec', 'POST', '/api/admin/bible-studies', { topic: 'Faith in Action', date: '2026-02-01', scriptureReference: 'James 2:14-26', studyMaterial: 'Test study' });
  check('executive can manage Bible studies', r.status === 200 && r.data.item.topic === 'Faith in Action', r.data);

  console.log('\n== an executive runs their own department ==');
  // Their department comes from their own roster card, never the request.
  r = await call('exec', 'GET', '/api/executive/department');
  check('an executive sees the department they actually hold', r.status === 200 && r.data.department.id === deptId, r.data);

  r = await call('exec', 'PUT', '/api/executive/department', {
    tagline: 'Caring for one another', meetingDay: 'Saturdays', meetingTime: '4:00 PM', meetingLocation: 'Room 12'
  });
  check('they keep their own department page current', r.status === 200 && r.data.item.meetingDay === 'Saturdays', r.data);
  r = await call('anon', 'GET', '/api/departments');
  check('and that reaches the public department listing',
    Array.isArray(r.data) && r.data.some(d => d.id === deptId && d.meetingTime === '4:00 PM'), r.data);

  // Who leads a department is derived from whoever holds the office, so there
  // is no typed-in name left to go stale when it changes hands.
  check('the department names its leader from the executive holding it',
    r.data.some(d => d.id === deptId && d.leaderName === 'Ama Executive' && d.leaderRole === 'Music Director'), r.data);
  r = await call('anon', 'GET', `/api/departments/${deptId}`);
  check('the department\'s own page names them too', r.data.leaderName === 'Ama Executive', r.data);

  // A mid-year reshuffle is the Coordinator's to make, not the executive's.
  r = await call('exec', 'GET', '/api/executive/me');
  const amaCardId = r.data.item.id;
  r = await call('exec', 'PATCH', `/api/admin/executives/${amaCardId}/position`, { positionKey: 'president' });
  check('an executive cannot reshuffle themselves', r.status === 401 || r.status === 403, r.data);

  r = await call('admin', 'PATCH', `/api/admin/executives/${amaCardId}/position`, { positionKey: 'welfare_head', department: deptId });
  check('the coordinator moves a sitting executive to another portfolio', r.status === 200 && r.data.item.positionKey === 'welfare_head', r.data);
  check('the office they left is snapshotted into their history',
    (r.data.item.history || []).some(h => h.role === 'Music Director'), r.data.item);
  r = await call('anon', 'GET', `/api/departments/${deptId}`);
  check('and it follows the office, not a stale copy, when the position changes',
    r.data.leaderRole === 'Welfare Head', r.data);

  // Moving someone into an officer's seat has to release the department, and
  // the rule is enforced rather than silently patched over.
  r = await call('admin', 'PATCH', `/api/admin/executives/${amaCardId}/position`, { positionKey: 'president', department: deptId });
  check('an officer cannot keep hold of a department', r.status === 400, r.data);

  // Put them back where the rest of these checks expect them.
  r = await call('admin', 'PATCH', `/api/admin/executives/${amaCardId}/position`, { positionKey: 'music_director', department: deptId });
  check('and back again, with the department intact', r.status === 200 && r.data.item.department === deptId, r.data);

  // Put a member in the department so there is someone to see and to mark.
  r = await call('admin', 'PUT', `/api/admin/members/${amaMemberId}`, { department: deptId });
  check('a member is assigned to the department', r.status === 200, r.data);

  r = await call('exec', 'GET', '/api/executive/department/members');
  check('the executive sees their department\'s members', r.status === 200 && r.data.some(m => m.id === amaMemberId), r.data);

  r = await call('exec', 'POST', '/api/executive/department/meetings', {
    date: '2026-03-07', topic: 'Welfare planning', attendeeMemberIds: [amaMemberId, memberId]
  });
  check('the executive logs a department meeting register', r.status === 200, r.data);
  check('marking is confined to their own department\'s members, whatever ids are sent',
    r.data.item.attendeeMemberIds.length === 1 && r.data.item.attendeeMemberIds[0] === amaMemberId, r.data.item);

  r = await call('exec', 'GET', '/api/executive/department/meetings');
  check('past meetings are listed back', r.status === 200 && r.data.length === 1, r.data);

  // The point of a separate register: department meetings must not quietly
  // inflate the chapter's service attendance figures.
  r = await call('shep', 'GET', '/api/shepherd/attendance');
  check('a department meeting never lands in the chapter\'s service register',
    Array.isArray(r.data) && !r.data.some(a => a.date === '2026-03-07'), r.data);

  r = await call('exec', 'POST', '/api/executive/department/announcement', { title: 'Meeting moved', body: 'We now meet at 5pm.' });
  check('the executive messages their own department', r.status === 200 && r.data.reached >= 1, r.data);
  // It belongs to the department, not the chapter. Before this it was stored
  // chapter-wide, so it reached everyone while reporting only the department.
  check('and the announcement is addressed to that department, not the chapter',
    r.data.item.departmentId === deptId, r.data.item);
  r = await call('exec', 'POST', '/api/executive/department/announcement', { title: '', body: '' });
  check('an empty announcement is refused', r.status === 400, r.data);

  // Someone outside the department must never see it in their notifications.
  const outsiderForm = new FormData();
  outsiderForm.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'o.png');
  outsiderForm.append('name', 'Outside Thedept');
  outsiderForm.append('email', 'outside.dept@test.com');
  outsiderForm.append('password', 'secret123');
  outsiderForm.append('chapterId', chapterId);
  const outsiderRes = await fetch(BASE + '/api/auth/register', { method: 'POST', body: outsiderForm });
  jars.outsider = (outsiderRes.headers.getSetCookie ? outsiderRes.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');

  r = await call('outsider', 'GET', '/api/notifications');
  check('a member outside the department never sees its announcement',
    !r.data.some(n => n.title === 'Choir: Meeting moved'), r.data.map(n => n.title));
  // And a chapter-wide notice still reaches everyone, so the filter has not
  // simply hidden everything.
  check('while chapter-wide notices still reach them', r.data.length > 0, r.data.map(n => n.title));

  // A different chapter's executive must never reach this department.
  r = await call('coord2', 'GET', '/api/executive/department');
  check('a chapter 2 account cannot read chapter 1\'s department through this route', r.status === 401, r.data);

  r = await call('member', 'POST', '/api/member/executive-interest', {
    role: 'Treasurer', department: 'finance', scope: 'chapter'
  });
  check('member submits an executive interest', r.status === 200 && r.data.item.executiveStatus === 'pending', r.data);
  r = await call('admin', 'GET', '/api/admin/executive-applications');
  check('executive applications are visible to admin', r.status === 200 && Array.isArray(r.data) && r.data.some(a => a.id === memberId), r.data);
  r = await call('admin', 'PATCH', `/api/admin/executive-applications/${memberId}`, { decision: 'approve', scope: 'chapter' });
  check('approving without a login to issue is refused, rather than half-provisioning', r.status === 400, r.data);
  r = await call('admin', 'PATCH', `/api/admin/executive-applications/${memberId}`, {
    decision: 'approve', scope: 'chapter', username: 'exec.kwabena', password: 'password123'
  });
  check('approving without naming a position is refused', r.status === 400, r.data);
  r = await call('admin', 'PATCH', `/api/admin/executive-applications/${memberId}`, {
    decision: 'approve', scope: 'chapter', username: 'exec.kwabena', password: 'password123', positionKey: 'president'
  });
  check('chapter executive application is approved', r.status === 200 && r.data.item.executiveStatus === 'verified', r.data);
  check('the approved office is recorded on the member, from the position chosen',
    r.data.item.role === 'President' && !r.data.item.department, r.data.item);
  check('approval issues the portal login in the same action', r.data.item.issuedLogin === true && !!r.data.item.account.termEndsAt, r.data.item);

  // The whole point of provisioning in one action: the approved executive can
  // sign in and already has a public roster card, with nothing done by hand.
  r = await call('newExec', 'POST', '/api/portal/login', { username: 'exec.kwabena', password: 'password123' });
  check('the newly approved executive can sign straight in', r.status === 200, r.data);
  r = await call('newExec', 'GET', '/api/executive/me');
  check('their public roster card already exists', r.status === 200 && r.data.item && r.data.item.staffId, r.data);

  console.log('\n== an officer runs the chapter, not a department ==');
  // The case the portal could not serve at all before: a President has no
  // department, and used to be told to go and choose one before anything
  // would open. They are now granted chapter-wide screens instead.
  check('a President holds an officer position, with no department',
    r.data.position.key === 'president' && r.data.position.kind === 'officer' && !r.data.needsDepartment, r.data);

  r = await call('newExec', 'GET', '/api/executive/chapter/pulse');
  check('the President sees the chapter as a whole',
    r.status === 200 && typeof r.data.memberCount === 'number' && typeof r.data.departmentCount === 'number', r.data);
  r = await call('newExec', 'GET', '/api/executive/chapter/members');
  check('and the chapter-wide member directory', r.status === 200 && Array.isArray(r.data) && r.data.length > 0, r.data);
  check('which carries no credential material',
    r.data.every(m => !('passwordHash' in m) && !('qrToken' in m) && !('resetTokenHash' in m)), r.data[0]);
  r = await call('newExec', 'GET', '/api/executive/chapter/departments');
  check('and every department with who heads it',
    r.status === 200 && r.data.some(d => d.id === deptId && d.headName === 'Ama Executive'), r.data);
  r = await call('newExec', 'GET', '/api/executive/chapter/finance');
  check('the President can read the books summary', r.status === 200 && typeof r.data.balance === 'number', r.data);

  // Officers are not handed department screens they have no department for.
  r = await call('newExec', 'GET', '/api/executive/department');
  check('an officer is turned away from the department screens by their position', r.status === 403, r.data);
  r = await call('newExec', 'GET', '/api/executive/department/members');
  check('including its member list', r.status === 403, r.data);

  // Attendance belongs to the Secretary and Organiser, not the President.
  r = await call('newExec', 'GET', '/api/executive/chapter/attendance');
  check('a capability the President was not granted stays shut, even to the President', r.status === 403, r.data);

  // Minutes: written by those who keep them, adopted only by those who chair.
  r = await call('newExec', 'POST', '/api/executive/minutes', { date: '2026-04-02', title: 'Term planning', body: 'Agreed the calendar.' });
  check('the President records minutes of an executive meeting', r.status === 200 && r.data.item.status === 'draft', r.data);
  const minuteId = r.data.item.id;
  r = await call('newExec', 'POST', '/api/executive/minutes', { date: '2026-04-02', body: '' });
  check('empty minutes are refused', r.status === 400, r.data);
  r = await call('newExec', 'PATCH', `/api/executive/minutes/${minuteId}/adopt`);
  check('and the President adopts them', r.status === 200 && r.data.item.status === 'adopted' && !!r.data.item.adoptedAt, r.data);
  r = await call('exec', 'GET', '/api/executive/minutes');
  check('a portfolio holder cannot read the executive minutes', r.status === 403, r.data);

  r = await call('newExec', 'POST', '/api/executive/chapter/announcement', { title: 'Chapter meeting', body: 'Saturday, 4pm.' });
  check('the President messages the whole chapter', r.status === 200 && r.data.reached >= 1, r.data);
  r = await call('exec', 'POST', '/api/executive/chapter/announcement', { title: 'Hello', body: 'Everyone' });
  check('a portfolio holder cannot message the whole chapter', r.status === 403, r.data);

  // The roster ranks by office, so the President is never listed under a
  // portfolio holder because of the order the cards were created in.
  r = await call('anon', 'GET', '/api/executives');
  const rosterNames = r.data.map(e => e.role);
  check('the public roster ranks the President above a portfolio holder',
    rosterNames.indexOf('President') !== -1 && rosterNames.indexOf('President') < rosterNames.indexOf('Music Director'), rosterNames);

  console.log('\n== every position on ACONSU\'s roster resolves ==');
  // These are the titles as they are actually written on ACONSU's roster,
  // misspellings and abbreviations included. Every one must land on a real
  // position: an unresolved title means that executive signs in with almost
  // nothing, so this is the migration guarantee, asserted rather than assumed.
  {
    const positionsLib = require('../lib/positions.js');
    const roster = [
      'Asstiant Media Head', 'Financial Secretary', 'Assitant M.O.G Head', 'Assitant Music Director',
      'Shepherding Head', 'Vice - President', 'Campus Coordinator', 'Technical Head', 'Prayer Secertary',
      'Publicity Head', 'PRESIDENT', 'Treasurer', 'Usher Head', 'General Secertary', 'M.O.G Head',
      'Assistant Welfare Head', 'Ushering Head', 'Welfare Head', 'Bible Studies Coordinator', 'Media Head',
      'Organising Secertary', 'Assistant L.O.S Head', 'Assistant General Secertary', 'Music Director',
      'Ladies Of Substance Head(WOCOM)'
    ];
    const unresolved = roster.filter(t => positionsLib.resolvePosition('', t, false).kind === 'unknown');
    check('every title on the real roster maps to a position', unresolved.length === 0, unresolved);

    // A head and their assistant are different offices and must never collide,
    // and "Vice President" must never fold into "President".
    check('an assistant never resolves to their head\'s position',
      positionsLib.resolvePosition('', 'Assistant Media Head', false).key === 'assistant_media_head'
      && positionsLib.resolvePosition('', 'Media Head', false).key === 'media_head');
    check('a Vice President is never resolved as the President',
      positionsLib.resolvePosition('', 'Vice President', false).key === 'vice_president');

    // Assistants act fully in their head's place, so the grants match exactly.
    const head = positionsLib.positionByKey('welfare_head');
    const deputy = positionsLib.positionByKey('assistant_welfare_head');
    check('an Assistant Head holds exactly what the Head holds',
      JSON.stringify(head.capabilities) === JSON.stringify(deputy.capabilities), { head: head.capabilities, deputy: deputy.capabilities });

    // Ushering is the largest department and answers to the Organiser.
    check('Ushering is recorded as answering to the Organising Secretary',
      positionsLib.positionByKey('ushering_head').reportsTo === 'organising_secretary');

    // The two money seats are deliberately different.
    check('only the Financial Secretary writes the books, and only the Treasurer files',
      positionsLib.hasCapability(positionsLib.positionByKey('financial_secretary'), 'finance.ledger')
      && !positionsLib.hasCapability(positionsLib.positionByKey('financial_secretary'), 'treasury.report')
      && positionsLib.hasCapability(positionsLib.positionByKey('treasurer'), 'treasury.report')
      && !positionsLib.hasCapability(positionsLib.positionByKey('treasurer'), 'finance.ledger'));
  }

  console.log('\n== the money: Treasurer files, Financial Secretary records ==');
  // ACONSU splits the money two ways: the Treasurer holds it and must account
  // for every movement with evidence; the Financial Secretary keeps the books
  // and is the only executive who writes to them.
  const treasRegForm = new FormData();
  treasRegForm.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 't.png');
  treasRegForm.append('name', 'Kojo Treasurer');
  treasRegForm.append('email', 'treasurer@test.com');
  treasRegForm.append('password', 'secret123');
  treasRegForm.append('chapterId', chapterId);
  const treasMemberId = (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: treasRegForm })).json()).member.id;

  const finRegForm = new FormData();
  finRegForm.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'f.png');
  finRegForm.append('name', 'Abena FinSec');
  finRegForm.append('email', 'finsec@test.com');
  finRegForm.append('password', 'secret123');
  finRegForm.append('chapterId', chapterId);
  const finMemberId = (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: finRegForm })).json()).member.id;

  r = await call('admin', 'POST', '/api/admin/staff', { username: 'exec.treasurer', name: 'Kojo Treasurer', role: 'executive', password: 'password123', memberId: treasMemberId, positionKey: 'treasurer' });
  check('a Treasurer is appointed', r.status === 200, r.data);
  r = await call('admin', 'POST', '/api/admin/staff', { username: 'exec.finsec', name: 'Abena FinSec', role: 'executive', password: 'password123', memberId: finMemberId, positionKey: 'financial_secretary' });
  check('a Financial Secretary is appointed', r.status === 200, r.data);
  await call('treas', 'POST', '/api/portal/login', { username: 'exec.treasurer', password: 'password123' });
  await call('finsec', 'POST', '/api/portal/login', { username: 'exec.finsec', password: 'password123' });

  // The Treasurer holds the money but never writes the ledger.
  r = await call('treas', 'GET', '/api/executive/finance/ledger');
  check('the Treasurer cannot open the ledger', r.status === 403, r.data);
  r = await call('treas', 'POST', '/api/executive/finance/ledger', { entryType: 'income', amount: 50, category: 'momo' });
  check('nor record an entry directly', r.status === 403, r.data);
  // And the Financial Secretary, who records, does not file on the Treasurer's behalf.
  r = await call('finsec', 'GET', '/api/executive/treasury/reports');
  check('the Financial Secretary does not file on the Treasurer\'s behalf', r.status === 403, r.data);

  // Evidence is the point of the split, so a filing without it is refused.
  const noEvidence = new FormData();
  noEvidence.append('entryType', 'income');
  noEvidence.append('amount', '120');
  noEvidence.append('category', 'offertory');
  let fileRes = await fetch(BASE + '/api/executive/treasury/report', { method: 'POST', headers: { cookie: jars.treas }, body: noEvidence });
  check('a filing with no evidence is refused', fileRes.status === 400, await fileRes.json());

  const filing = new FormData();
  filing.append('receipt', new Blob([Buffer.from('receipt-bytes')], { type: 'image/png' }), 'r.png');
  filing.append('entryType', 'income');
  filing.append('amount', '120');
  filing.append('category', 'offertory');
  filing.append('date', '2026-05-04');
  filing.append('description', 'Sunday offertory');
  fileRes = await fetch(BASE + '/api/executive/treasury/report', { method: 'POST', headers: { cookie: jars.treas }, body: filing });
  const filed = await fileRes.json();
  check('the Treasurer files a movement with evidence', fileRes.status === 200, filed);
  check('and it waits, rather than landing in the books', filed.item.approvalStatus === 'pending' && filed.item.source === 'treasury', filed.item);
  check('with the evidence attached and the Treasurer named', !!filed.item.receiptFileId && filed.item.filedBy === 'Kojo Treasurer', filed.item);
  const filingId = filed.item.id;

  r = await call('finsec', 'GET', '/api/executive/finance/ledger');
  check('it appears in the Financial Secretary\'s queue', r.status === 200 && r.data.awaiting.some(a => a.id === filingId), r.data);

  // Sending something back has to say why, so the Treasurer can correct it.
  r = await call('finsec', 'PATCH', `/api/executive/finance/ledger/${filingId}`, { decision: 'reject' });
  check('sending a filing back without a reason is refused', r.status === 400, r.data);
  r = await call('finsec', 'PATCH', `/api/executive/finance/ledger/${filingId}`, { decision: 'reject', reviewNote: 'Receipt is unreadable.' });
  check('the Financial Secretary sends it back with a reason', r.status === 200 && r.data.item.approvalStatus === 'rejected', r.data);
  r = await call('treas', 'GET', '/api/executive/treasury/reports');
  check('and the Treasurer sees why', r.data.some(f => f.id === filingId && f.reviewNote === 'Receipt is unreadable.'), r.data);

  // Once dealt with, a filing cannot be re-decided.
  r = await call('finsec', 'PATCH', `/api/executive/finance/ledger/${filingId}`, { decision: 'record' });
  check('a filing already dealt with cannot be decided twice', r.status === 400, r.data);

  const filing2 = new FormData();
  filing2.append('receipt', new Blob([Buffer.from('clear-receipt')], { type: 'image/png' }), 'r2.png');
  filing2.append('entryType', 'expense');
  filing2.append('amount', '75');
  filing2.append('category', 'transport');
  filing2.append('date', '2026-05-05');
  const filed2 = await (await fetch(BASE + '/api/executive/treasury/report', { method: 'POST', headers: { cookie: jars.treas }, body: filing2 })).json();
  r = await call('finsec', 'PATCH', `/api/executive/finance/ledger/${filed2.item.id}`, { decision: 'record' });
  check('a good filing is recorded into the books', r.status === 200 && r.data.item.approvalStatus === 'recorded', r.data);
  check('and the ledger names who recorded it, not just who filed it',
    r.data.item.recordedBy === 'Abena FinSec' && r.data.item.filedBy === 'Kojo Treasurer', r.data.item);

  // The Financial Secretary keeps the books, so they can enter directly too.
  r = await call('finsec', 'POST', '/api/executive/finance/ledger', { entryType: 'income', amount: 200, category: 'tithe', date: '2026-05-06' });
  check('the Financial Secretary records an entry directly', r.status === 200 && r.data.item.approvalStatus === 'recorded', r.data);
  r = await call('finsec', 'POST', '/api/executive/finance/ledger', { entryType: 'income', amount: 200, category: 'not-a-category' });
  check('an invalid income category is refused', r.status === 400, r.data);

  console.log('\n== the daily verse ==');
  const bsRegForm = new FormData();
  bsRegForm.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'b.png');
  bsRegForm.append('name', 'Esi Bible');
  bsRegForm.append('email', 'bible@test.com');
  bsRegForm.append('password', 'secret123');
  bsRegForm.append('chapterId', chapterId);
  const bsMemberId = (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: bsRegForm })).json()).member.id;
  r = await call('admin', 'POST', '/api/admin/staff', { username: 'exec.bible', name: 'Esi Bible', role: 'executive', password: 'password123', memberId: bsMemberId, positionKey: 'bible_studies_coordinator', department: deptId });
  check('a Bible Studies Coordinator is appointed', r.status === 200, r.data);
  await call('bible', 'POST', '/api/portal/login', { username: 'exec.bible', password: 'password123' });

  const today = new Date().toISOString().slice(0, 10);
  r = await call('bible', 'POST', '/api/executive/daily-verses', { date: today, reference: 'Psalm 23:1', text: 'The Lord is my shepherd.' });
  check('the Bible Studies Coordinator posts the daily verse', r.status === 200 && r.data.replaced === false, r.data);
  r = await call('bible', 'POST', '/api/executive/daily-verses', { date: today, reference: 'Psalm 23:1-2', text: 'He makes me lie down.' });
  check('posting again for the same day replaces it rather than stacking a second',
    r.status === 200 && r.data.replaced === true, r.data);
  r = await call('bible', 'GET', '/api/executive/daily-verses');
  check('only one verse exists for that day', r.data.filter(v => v.date === today).length === 1, r.data);
  r = await call('anon', 'GET', '/api/daily-verse');
  check('and anyone opening the app sees it, signed in or not',
    r.status === 200 && r.data.item && r.data.item.reference === 'Psalm 23:1-2', r.data);
  r = await call('bible', 'POST', '/api/executive/daily-verses', { date: today, reference: '' });
  check('a verse with no reference is refused', r.status === 400, r.data);
  r = await call('exec', 'POST', '/api/executive/daily-verses', { date: today, reference: 'John 1:1' });
  check('an executive without that office cannot post the daily verse', r.status === 403, r.data);

  r = await call('anon', 'GET', '/api/executive-positions');
  check('the position catalogue is available for the promotion screen',
    r.status === 200 && r.data.some(p => p.key === 'president' && p.requiresDepartment === false)
      && r.data.some(p => p.key === 'music_director' && p.requiresDepartment === true), r.data);

  // Editing a roster card must not let the displayed title drift away from the
  // position behind it — a card reading "President" with a Music Director's
  // capabilities is exactly the confusion positions exist to prevent.
  const editForm = new FormData();
  editForm.append('name', 'Ama Executive');
  editForm.append('role', 'President');
  editForm.append('order', '0');
  const editRes = await fetch(BASE + `/api/admin/executives/${amaCardId}`, {
    method: 'PUT', headers: { cookie: jars.admin }, body: editForm
  });
  const editData = await editRes.json();
  check('a card edit cannot rename the office out from under its position',
    editRes.status === 200 && editData.item.role === 'Music Director' && editData.item.positionKey === 'music_director', editData.item);
  check('and the edit still saves what it is meant to', editData.item.name === 'Ama Executive', editData.item);

  // Term of office. The deadline is compared against the live clock on every
  // check, so a term that runs out mid-session ends that session's authority
  // there and then — no sweep job has to have run. Proved here by signing in
  // with a deadline a second away and letting it pass.
  const lapsed = fakeModels.StaffUser._docs.find(s => s.username === 'exec.kwabena');
  lapsed.termEndsAt = new Date(Date.now() + 1200);
  r = await call('expiring', 'POST', '/api/portal/login', { username: 'exec.kwabena', password: 'password123' });
  check('an executive signs in while their term still has time to run', r.status === 200, r.data);
  r = await call('expiring', 'GET', '/api/executive/me');
  check('and works normally right up to the deadline', r.status === 200, r.data);
  await new Promise(res => setTimeout(res, 1400));
  r = await call('expiring', 'GET', '/api/executive/me');
  check('the moment the term runs out, that live session loses its authority', r.status === 401, r.data);

  lapsed.termEndsAt = new Date(Date.now() - 86400000);
  r = await call('lapsedExec', 'POST', '/api/portal/login', { username: 'exec.kwabena', password: 'password123' });
  check('a lapsed executive is refused at login, and told why', r.status === 403 && /term of office has ended/.test(r.data.error || ''), r.data);

  r = await call('admin', 'PUT', `/api/admin/staff/${lapsed.id}`, { renewTerm: true });
  check('the coordinator renews the term for the new year', r.status === 200 && new Date(r.data.item.termEndsAt) > new Date(), r.data);
  r = await call('renewedExec', 'POST', '/api/portal/login', { username: 'exec.kwabena', password: 'password123' });
  check('the renewed executive signs in again, same account and card', r.status === 200, r.data);

  // Appointing mid-year: the term runs to the same academic-year boundary as
  // everyone else's, so the whole body still hands over together.
  check('a mid-year appointment still ends with the academic year',
    new Date(lapsed.termEndsAt).getUTCMonth() === 7 && new Date(lapsed.termEndsAt).getUTCDate() === 1, lapsed.termEndsAt);

  console.log('\n== ending an office reaches the session already in use ==');
  // The gap this closes: a term ended, an account disabled or deleted used to
  // leave whoever held it working away in a session stamped before the change.
  r = await call('renewedExec', 'GET', '/api/executive/me');
  check('the executive is working normally before anything changes', r.status === 200, r.data);

  r = await call('admin', 'PUT', `/api/admin/staff/${lapsed.id}`, { endTerm: true });
  check('the coordinator ends their term early', r.status === 200, r.data);
  r = await call('renewedExec', 'GET', '/api/executive/me');
  check('their live session stops working at once, without signing out', r.status === 401, r.data);
  r = await call('endedExec', 'POST', '/api/portal/login', { username: 'exec.kwabena', password: 'password123' });
  check('and they cannot sign back in', r.status === 403, r.data);

  // Sessions live in the database now and outlive a restart, so the record
  // that revokes them has to as well — an in-memory-only list would be
  // forgotten while the session it revoked came back.
  check('the revocation is written to the account, not just held in memory',
    !!fakeModels.StaffUser._docs.find(s => s.id === lapsed.id).sessionsRevokedAt,
    fakeModels.StaffUser._docs.find(s => s.id === lapsed.id));

  // Disabling an account reaches a live session the same way.
  r = await call('admin', 'PUT', `/api/admin/staff/${lapsed.id}`, { renewTerm: true });
  r = await call('reinstated', 'POST', '/api/portal/login', { username: 'exec.kwabena', password: 'password123' });
  check('reinstated once the coordinator renews the term', r.status === 200, r.data);
  r = await call('admin', 'PUT', `/api/admin/staff/${lapsed.id}`, { active: false });
  r = await call('reinstated', 'GET', '/api/executive/me');
  check('disabling an account also ends the session it is being used in', r.status === 401, r.data);

  // A rename is not a loss of authority, so it must not sign anyone out.
  r = await call('admin', 'PUT', `/api/admin/staff/${lapsed.id}`, { active: true });
  r = await call('renamed', 'POST', '/api/portal/login', { username: 'exec.kwabena', password: 'password123' });
  check('re-enabled and signed in again', r.status === 200, r.data);
  r = await call('admin', 'PUT', `/api/admin/staff/${lapsed.id}`, { name: 'Kwabena Renamed' });
  r = await call('renamed', 'GET', '/api/executive/me');
  check('but simply renaming them does not throw them out mid-session', r.status === 200, r.data);

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
  console.log('\n== uploads that cannot be accepted ==');
  // A rejected upload used to fall through to Express's default handler: an
  // HTML page with a full stack trace and absolute server paths, sent to a
  // client that asked for JSON. The member saw nothing useful and anyone
  // looking learned where the code lives on disk.
  {
    const tooBig = new FormData();
    tooBig.append('profileImage', new Blob([Buffer.alloc(31 * 1024 * 1024, 7)], { type: 'image/png' }), 'huge.png');
    tooBig.append('name', 'Too Big');
    tooBig.append('email', 'toobig@test.com');
    tooBig.append('password', 'secret123');
    tooBig.append('chapterId', chapterId);
    const res = await fetch(BASE + '/api/auth/register', { method: 'POST', body: tooBig });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (e) { /* left null, which is the failure */ }
    check('an oversized upload is refused with 413, not 500', res.status === 413, { status: res.status, text: text.slice(0, 120) });
    check('and answers in JSON, as the client asked', !!parsed && !!parsed.error, text.slice(0, 120));
    check('saying plainly what went wrong', /larger than 30MB/.test((parsed && parsed.error) || ''), parsed);
    check('and never leaking a stack trace or server paths',
      !/at \s|\/home\/|node_modules|MulterError/.test(text), text.slice(0, 160));
  }
  {
    const wrongField = new FormData();
    wrongField.append('notTheField', new Blob([Buffer.alloc(512)], { type: 'image/png' }), 'x.png');
    wrongField.append('name', 'Wrong Field');
    wrongField.append('email', 'wrongfield@test.com');
    wrongField.append('password', 'secret123');
    wrongField.append('chapterId', chapterId);
    const res = await fetch(BASE + '/api/auth/register', { method: 'POST', body: wrongField });
    const text = await res.text();
    check('a file sent under an unexpected name is refused with 400', res.status === 400, { status: res.status, text: text.slice(0, 120) });
    check('also in JSON, also without a stack trace',
      /^\{/.test(text.trim()) && !/node_modules|MulterError/.test(text), text.slice(0, 160));
  }

  console.log('\n== the events a member signed up for ==');
  // Registering worked; seeing what you had signed up for did not, and event
  // registration had no coverage at all.
  r = await call('admin', 'POST', '/api/admin/events', {
    title: 'Members Retreat', date: '2027-03-12', time: '09:00', location: 'Retreat Centre',
    chapterId, status: 'published', registrationEnabled: true, capacity: 2
  });
  const retreatId = r.data.item.id;
  check('an event open for registration is published', r.status === 200 && r.data.item.registrationEnabled === true, r.data);

  r = await call('member', 'GET', '/api/member/events');
  check('a member who has signed up for nothing gets an empty list', r.status === 200 && r.data.length === 0, r.data);

  r = await call('member', 'POST', `/api/events/${retreatId}/register`, { name: 'Ama Test', email: 'member@test.com', phone: '0240000000' });
  check('a signed-in member registers for it', r.status === 200, r.data);
  r = await call('member', 'GET', '/api/member/events');
  check('and can now see what they signed up for',
    r.status === 200 && r.data.some(e => e.id === retreatId), r.data);
  check('with the date, time and place they will need',
    r.data[0].date === '2027-03-12' && r.data[0].time === '09:00' && r.data[0].location === 'Retreat Centre', r.data[0]);
  check('and it is listed as still to come, not already attended', r.data[0].past === false, r.data[0]);

  // One member's registrations are their own.
  r = await call('outsider', 'GET', '/api/member/events');
  check('another member does not see it among theirs', r.status === 200 && !r.data.some(e => e.id === retreatId), r.data);
  r = await call('anon', 'GET', '/api/member/events');
  check('and it is refused to someone not signed in', r.status === 401, r.data);

  // Capacity is enforced, which is the point of setting one.
  await call('outsider', 'POST', `/api/events/${retreatId}/register`, { name: 'Outside Thedept', email: 'outside.dept@test.com' });
  r = await call('anon', 'POST', `/api/events/${retreatId}/register`, { name: 'Walk In', email: 'walkin@test.com' });
  check('registration closes once the event is full', r.status === 400 && /fully booked/i.test(r.data.error || ''), r.data);

  console.log('\n== the member streak ==');
  // This route mutates a Mongoose document and saves it, so until the harness
  // grew a .save() it 500'd under test and the streak was never exercised once.
  r = await call('member', 'POST', '/api/member/checkin');
  check('a first check-in starts the streak at one', r.status === 200 && r.data.currentStreak === 1, r.data);
  r = await call('member', 'POST', '/api/member/checkin');
  check('checking in twice on the same day does not inflate it', r.status === 200 && r.data.currentStreak === 1, r.data);

  {
    // Yesterday's check-in continues the streak; an older one restarts it.
    const doc = fakeModels.Member._docs.find(m => m.id === memberId);
    const dayBefore = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    doc.lastActiveDate = dayBefore;
    doc.currentStreak = 4;
    r = await call('member', 'POST', '/api/member/checkin');
    check('checking in the day after continues the streak', r.status === 200 && r.data.currentStreak === 5, r.data);
    check('and the longest streak keeps up with it', r.data.longestStreak >= 5, r.data);

    // A long streak, then a gap. longestStreak is set alongside it here because
    // that is what real use produces: it is raised on every check-in as the
    // streak grows, so by the time a gap happens it already holds the peak.
    doc.lastActiveDate = '2020-01-01';
    doc.currentStreak = 9;
    doc.longestStreak = 9;
    r = await call('member', 'POST', '/api/member/checkin');
    check('a gap restarts the streak at one', r.status === 200 && r.data.currentStreak === 1, r.data);
    check('but the longest streak is remembered', r.data.longestStreak === 9, r.data);
  }

  console.log('\n== a member can see where they stand ==');
  // All of this already drove Shepherding's workflow; none of it was ever
  // shown to the member it was about.
  r = await call('member', 'GET', '/api/member/standing');
  check('a member can see where they stand', r.status === 200 && !!r.data.stage, r.data);

  // The journey a member is shown and the stages Shepherding can actually set
  // must be the same list, or someone could be put at a stage the app has no
  // words for. Asserted against the real route rather than a typed-out copy.
  {
    const shown = r.data.journey.map(j => j.key);
    const rejected = [];
    for (const stage of shown) {
      const res = await call('shep', 'PATCH', `/api/shepherd/members/${memberId}/stage`, { stage });
      if (res.status !== 200) rejected.push({ stage, status: res.status });
    }
    check('every stage the member can be shown is one Shepherding can set', rejected.length === 0, rejected);
    const unknown = await call('shep', 'PATCH', `/api/shepherd/members/${memberId}/stage`, { stage: 'not_a_stage' });
    check('and a stage outside that list is refused', unknown.status === 400, unknown.data);
    // Put them back where the checks below expect them.
    await call('shep', 'PATCH', `/api/shepherd/members/${memberId}/stage`, { stage: 'active' });
    r = await call('member', 'GET', '/api/member/standing');
  }
  check('their stage is explained in plain words, not a database value',
    r.data.stage.key !== r.data.stage.label && r.data.stage.blurb.length > 20, r.data.stage);
  check('and the journey shows what comes next', Array.isArray(r.data.journey) && r.data.journey.length > 1, r.data.journey);

  // A member with no department is told so plainly, because it is a thing to
  // act on rather than an error.
  check('a member with no department is told how to find one', r.data.needsDepartment === true && r.data.department === null, r.data);

  r = await call('admin', 'PUT', `/api/admin/members/${memberId}`, { department: deptId });
  check('the member is placed in a department', r.status === 200, r.data);
  r = await call('member', 'GET', '/api/member/standing');
  check('and now sees which department they belong to',
    r.data.department && r.data.department.id === deptId, r.data.department);
  check('with when it meets and who leads it',
    r.data.department.meetingDay === 'Saturdays' && !!r.data.department.headName, r.data.department);

  // The other half of the audience rule: the department's own members must
  // still receive it, both in their notifications and on their profile, where
  // they can find it again after the push has gone.
  r = await call('member', 'GET', '/api/notifications');
  check('a member of the department does see its announcement',
    r.data.some(n => n.title === 'Choir: Meeting moved'), r.data.map(n => n.title));
  r = await call('member', 'GET', '/api/member/standing');
  check('and can read it back on their profile, not only as a push',
    (r.data.departmentNotices || []).some(n => n.title === 'Choir: Meeting moved'),
    (r.data.departmentNotices || []).map(n => n.title));
  // A deputy must not displace the head as the named leader — which only means
  // something if an assistant is actually sitting in the same department.
  const asstRegForm = new FormData();
  asstRegForm.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'a.png');
  asstRegForm.append('name', 'Kofi Assistant');
  asstRegForm.append('email', 'kofi.assistant@test.com');
  asstRegForm.append('password', 'secret123');
  asstRegForm.append('chapterId', chapterId);
  const asstMemberId = (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: asstRegForm })).json()).member.id;
  r = await call('admin', 'POST', '/api/admin/staff', { username: 'exec.asstmusic', name: 'Kofi Assistant', role: 'executive', password: 'password123', memberId: asstMemberId, positionKey: 'assistant_music_director', department: deptId });
  check('an Assistant Head is appointed to the same department', r.status === 200, r.data);
  r = await call('member', 'GET', '/api/member/standing');
  check('the head is named, not their assistant',
    !/Assistant/i.test(r.data.department.headRole || '') && !!r.data.department.headName,
    r.data.department);

  // Saving your own profile must not quietly cost you your department. The
  // profile form sends name/phone/level/birthday and no department field at
  // all, so a handler that writes `req.body.department || ''` resets it to
  // blank every time a member edits their phone number — and nothing tells
  // them it happened.
  {
    const beforeDept = (await call('member', 'GET', '/api/member/standing')).data.department;
    const profileForm = new FormData();
    profileForm.append('name', 'Ama Test');
    profileForm.append('phone', '0270000000');
    const saved = await fetch(BASE + '/api/member/profile', {
      method: 'PUT', headers: { cookie: jars['member'] }, body: profileForm
    });
    check('a member can save their own profile', saved.status === 200, saved.status);
    r = await call('member', 'GET', '/api/member/standing');
    check('and saving it does not wipe the department they belong to',
      r.data.department && r.data.department.id === (beforeDept && beforeDept.id),
      { before: beforeDept && beforeDept.id, after: r.data.department && r.data.department.id });
  }

  console.log('\n== joining a department: the member asks, the head decides ==');
  {
    // A second department, so "joining one" can be told apart from "replacing
    // the one you had" — the member is already in Choir at this point.
    r = await call('admin', 'POST', '/api/admin/departments', { name: 'Ushering', tagline: 'Welcome' });
    const usheringId = r.data.item.id;

    r = await call('member', 'GET', '/api/member/departments');
    check('a member sees their own chapter\'s departments without picking a chapter',
      r.status === 200 && r.data.departments.some(d => d.id === usheringId) && r.data.departments.some(d => d.id === deptId), r.data);
    check('and which ones they are already serving in',
      (r.data.departments.find(d => d.id === deptId) || {}).joined === true, r.data.departments);

    r = await call('member', 'POST', `/api/member/departments/${usheringId}/request`, { note: 'I would like to serve.' });
    check('a member can ask to join a department', r.status === 200, r.data);
    const requestId = r.data.item.id;

    // Asking is not joining: nothing changes until the head decides.
    r = await call('member', 'GET', '/api/member/standing');
    check('asking does not put them in it yet',
      !r.data.departments.some(d => d.id === usheringId), r.data.departments);
    check('but the page can show the request is waiting',
      (r.data.pendingRequests || []).some(p => p.departmentId === usheringId), r.data.pendingRequests);

    r = await call('member', 'POST', `/api/member/departments/${usheringId}/request`, {});
    check('tapping again does not stack up a second request',
      r.status === 200 && r.data.alreadyPending === true && r.data.item.id === requestId, r.data);

    // A join request must not be announced to the department: it would tell
    // everyone in Ushering who had applied, and why.
    r = await call('member', 'GET', '/api/notifications');
    check('asking to join is not broadcast to the department',
      !r.data.some(n => /wants to join/i.test(n.title || '')), r.data.map(n => n.title));

    // The head of Choir must not be able to decide Ushering's roster.
    r = await call('exec', 'GET', '/api/executive/department/requests');
    check("a head sees only their own department's requests",
      r.status === 200 && !r.data.some(x => x.id === requestId), r.data);
    r = await call('exec', 'POST', `/api/executive/department/requests/${requestId}/decide`, { decision: 'approved' });
    check("and cannot decide another department's request", r.status === 404, r.data);

    // Now give Ushering a head of its own.
    const ushRegForm = new FormData();
    ushRegForm.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'u.png');
    ushRegForm.append('name', 'Yaw Usher');
    ushRegForm.append('email', 'yaw.usher@test.com');
    ushRegForm.append('password', 'secret123');
    ushRegForm.append('chapterId', chapterId);
    const ushMemberId = (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: ushRegForm })).json()).member.id;
    r = await call('admin', 'POST', '/api/admin/staff', { username: 'exec.ushering', name: 'Yaw Usher', role: 'executive', password: 'password123', memberId: ushMemberId, positionKey: 'ushering_head', department: usheringId });
    check('an Ushering head is appointed', r.status === 200, r.data);
    r = await call('ushead', 'POST', '/api/portal/login', { username: 'exec.ushering', password: 'password123' });
    check('the Ushering head signs in', r.status === 200, r.data);

    r = await call('ushead', 'GET', '/api/executive/department/requests');
    check('the right head does see the request waiting',
      r.status === 200 && r.data.some(x => x.id === requestId), r.data);
    check('with enough about the member to decide',
      (r.data.find(x => x.id === requestId) || {}).note === 'I would like to serve.', r.data);

    r = await call('ushead', 'POST', `/api/executive/department/requests/${requestId}/decide`, { decision: 'approved' });
    check('the head can approve it', r.status === 200, r.data);

    // The whole point of the choice: joining Ushering must not remove them
    // from Choir.
    r = await call('member', 'GET', '/api/member/standing');
    const joined = (r.data.departments || []).map(d => d.id);
    check('the member is now in BOTH departments, not moved between them',
      joined.includes(deptId) && joined.includes(usheringId), joined);
    check('and no longer has it listed as waiting',
      !(r.data.pendingRequests || []).some(p => p.departmentId === usheringId), r.data.pendingRequests);

    // Deciding twice would double-add them.
    r = await call('ushead', 'POST', `/api/executive/department/requests/${requestId}/decide`, { decision: 'declined' });
    check('a decided request cannot be decided again', r.status === 400, r.data);

    // Both heads must now see them, which is what the roster query change is for.
    r = await call('ushead', 'GET', '/api/executive/department/members');
    check('the Ushering roster includes them', r.data.some(m => m.id === memberId), r.data.map(m => m.id));
    r = await call('exec', 'GET', '/api/executive/department/members');
    check('and the Choir roster still does too', r.data.some(m => m.id === memberId), r.data.map(m => m.id));

    // Announcements from either department must reach them.
    r = await call('ushead', 'POST', '/api/executive/department/announcement', { title: 'Early call', body: 'Be there at 7.' });
    check('the Ushering head can announce to their department', r.status === 200, r.data);
    r = await call('member', 'GET', '/api/notifications');
    check('a member of two departments hears from both',
      r.data.some(n => n.title === 'Ushering: Early call') && r.data.some(n => n.title === 'Choir: Meeting moved'),
      r.data.map(n => n.title));

    // Leaving is theirs to do.
    r = await call('member', 'DELETE', `/api/member/departments/${usheringId}`);
    check('a member can step back out of a department', r.status === 200, r.data);
    r = await call('member', 'GET', '/api/member/standing');
    check('which leaves the other one untouched',
      (r.data.departments || []).map(d => d.id).join(',') === deptId, r.data.departments);

    // A department that does not exist is refused rather than creating a
    // dangling request. (The cross-chapter case is checked further down, once
    // the suite has a second chapter — creating one here would end the
    // single-chapter defaulting that every test in between relies on.)
    r = await call('member', 'POST', '/api/member/departments/depa_not_a_real_id/request', {});
    check('asking to join a department that does not exist is refused', r.status === 404, r.data);

    r = await call('anon', 'GET', '/api/member/departments');
    check('and none of this is open to someone not signed in', r.status === 401, r.data);
  }

  // Standing is your own. It must never answer for anyone else.
  r = await call('anon', 'GET', '/api/member/standing');
  check('standing is refused to someone not signed in', r.status === 401, r.data);

  // The session endpoint must not hand the browser credential material.
  r = await call('member', 'GET', '/api/auth/me');
  check('the member session carries no reset token or QR token',
    r.status === 200 && r.data.member
    && !('resetTokenHash' in r.data.member)
    && !('resetTokenExpires' in r.data.member)
    && !('qrToken' in r.data.member)
    && !('passwordHash' in r.data.member), Object.keys(r.data.member || {}));

  r = await call('member', 'GET', '/api/member/card');
  check('an active member gets a real digital card with a QR code', r.status === 200 && r.data.ready === true && !!r.data.qrDataUrl, { ready: r.data.ready });

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
  r = await call('pub', 'PUT', `/api/admin/groups/${groupId}`, { leaderMemberId: memberId });
  check('group leader can be assigned for attendance logging', r.status === 200 && r.data.item.leaderMemberId === memberId, r.data);
  r = await call('member', 'POST', `/api/groups/${groupId}/meetings/quick`, { date: '2026-09-02', attendeeMemberIds: [memberId] });
  check('a group leader can submit 3-tap quick attendance', r.status === 200 && r.data.item.attendeeMemberIds.length === 1, r.data);
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
  r = await call('pub', 'POST', '/api/publicity/events', { title: 'Clashing Event', date: '2026-09-02', time: '18:00', location: 'Main Hall' });
  check('a second event can be created for conflict checks', r.status === 200, r.data);
  const clashEventId = r.status === 200 && r.data.item ? r.data.item.id : '';
  if (clashEventId) {
    r = await call('pub', 'POST', `/api/events/${clashEventId}/volunteers`, { role: 'media', memberId });
    check('volunteer double-booking is blocked by default', r.status === 409, r.data);
    r = await call('pub', 'POST', `/api/events/${clashEventId}/volunteers`, { role: 'media', memberId, force: true });
    check('volunteer assignment can be force-saved after warning', r.status === 200, r.data);
  }
  r = await call('member', 'GET', '/api/member/volunteer-assignments');
  check('the member sees their assignments with event details attached', r.data.some(a => a.event && a.event.id === eventId), r.data);
  r = await call('member', 'PATCH', `/api/member/volunteer-assignments/${volAssignmentId}`, { status: 'confirmed' });
  check('the member confirms their assignment', r.status === 200 && r.data.item.status === 'confirmed', r.data);

  console.log('\n== Member Milestones (section 36) ==');
  r = await call('shep', 'POST', '/api/shepherd/milestones', { memberId, type: 'membership_anniversary', note: '1 year!' });
  check('shepherding logs a milestone', r.status === 200, r.data);
  r = await call('shep', 'GET', '/api/shepherd/milestones');
  check('the milestone is listed', r.data.some(m => m.type === 'membership_anniversary'), r.data);
  check('an executive-appointment milestone was logged when the office was granted, not when a form was filled in', r.data.some(m => m.type === 'executive_appointment'), r.data);

  console.log('\n== Welfare (section 33) ==');
  const welfMemberId = await registerMember('Efua Welfare', 'efua.welfare@test.com');
  r = await call('admin', 'POST', '/api/admin/staff', { username: 'welf.efua', name: 'Efua Welfare', role: 'welfare', password: 'password123', memberId: welfMemberId });
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
  r = await call('welf', 'GET', '/api/welfare/retention-alerts');
  check('welfare can read inactivity retention alerts', r.status === 200 && Array.isArray(r.data), r.data);
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
  r = await call('member', 'POST', '/api/giving/intents', { amount: 30, purpose: 'offertory', method: 'momo', reference: 'MMBATCH1' });
  const batchIntent1 = r.data.item.id;
  r = await call('member', 'POST', '/api/giving/intents', { amount: 20, purpose: 'harvest', method: 'bank', reference: 'MMBATCH2' });
  const batchIntent2 = r.data.item.id;
  r = await call('fin', 'POST', '/api/finance/giving/reconcile-batch', { intentIds: [batchIntent1, batchIntent2] });
  check('finance can reconcile giving claims as a pending-approval batch', r.status === 200 && r.data.item.status === 'pending_approval', r.data);
  const batchId = r.data.item.id;
  r = await call('fin', 'PATCH', `/api/finance/reconciliation-batches/${batchId}`, { action: 'approve' });
  check('batch creator cannot self-approve due to dual-control rule', r.status === 403, r.data);
  r = await call('coord', 'PATCH', `/api/finance/reconciliation-batches/${batchId}`, { action: 'approve' });
  check('coordinator can approve reconciled batch', r.status === 200 && r.data.item.status === 'approved', r.data);

  console.log('\n== chapter isolation (section 1, 43, 44) — the whole point of this phase ==');
  r = await call('admin', 'POST', '/api/national/chapters', { id: 'test-chapter-2', name: 'ACONSU-Test-2', institution: 'Second University' });
  check('a second chapter is created', r.status === 200, r.data);
  r = await call('admin', 'GET', '/api/national/dashboard');
  check('national dashboard now counts two chapters', r.data.totalChapters === 2, r.data);

  // SMS credentials are per chapter for the same reason finance is: a chapter's
  // own mNotify account, its own credit, its own registered sender name. This
  // is the guarantee that one chapter can never spend or send on another's.
  r = await call('admin', 'PUT', '/api/admin/chapter-sms', { chapterId: 'test-chapter-2', apiKey: 'other-key-9999', senderId: 'ACONSU2' });
  check('chapter 2 sets its own SMS credentials', r.status === 200 && r.data.senderId === 'ACONSU2', r.data);
  r = await call('admin', 'GET', `/api/admin/chapter-sms?chapterId=${chapterId}`);
  check('which leaves chapter 1\'s credentials untouched',
    r.data.senderId === 'ACONSU' && r.data.apiKeyHint === '••••1234', r.data);

  // Departments are chapter property too: a member of chapter 1 must not be
  // able to put themselves on chapter 2's roster by quoting its id.
  r = await call('admin', 'POST', '/api/admin/departments', { name: 'Other Choir', chapterId: 'test-chapter-2' });
  check("chapter 2 gets a department of its own", r.status === 200, r.data);
  const otherChapterDeptId = r.data.item.id;
  r = await call('member', 'POST', `/api/member/departments/${otherChapterDeptId}/request`, {});
  check("a member cannot ask to join another chapter's department", r.status === 404, r.data);
  r = await call('member', 'GET', '/api/member/departments');
  check("and another chapter's departments are not even listed to them",
    !(r.data.departments || []).some(d => d.id === otherChapterDeptId), r.data.departments);

  {
    const smsLib = require('../lib/sms.js');
    const c1 = await smsLib.resolveConfig(chapterId);
    const c2 = await smsLib.resolveConfig('test-chapter-2');
    check('each chapter resolves to its own SMS account, never the other\'s',
      c1.apiKey === 'live-key-abcd1234' && c2.apiKey === 'other-key-9999', { c1: c1.apiKey, c2: c2.apiKey });
    check('so a batch is signed with that chapter\'s own sender ID',
      c1.senderId === 'ACONSU' && c2.senderId === 'ACONSU2', { c1: c1.senderId, c2: c2.senderId });
  }

  r = await call('admin', 'POST', '/api/admin/departments', { name: 'Chapter 1 Only Dept', chapterId });
  check('explicit chapterId still works now that a default can no longer be assumed', r.status === 200, r.data);
  r = await call('admin', 'POST', '/api/admin/departments', { name: 'No Chapter Given' });
  check('a national actor MUST specify a chapter once more than one exists', r.status === 400, r.data);

  const fin2MemberId = (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: (() => { const fd = new FormData(); fd.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png'); fd.append('name', 'Fin Two'); fd.append('email', 'fin2@test.com'); fd.append('password', 'secret123'); fd.append('chapterId', 'test-chapter-2'); return fd; })() })).json()).member.id;
  r = await call('admin', 'POST', '/api/admin/staff', { username: 'fin2', name: 'fin2', role: 'finance', password: 'password123', chapterId: 'test-chapter-2', memberId: fin2MemberId });
  check('finance account created for chapter 2', r.status === 200 && r.data.item.chapterId === 'test-chapter-2', r.data);
  r = await call('fin2', 'POST', '/api/portal/login', { username: 'fin2', password: 'password123' });
  check('chapter 2 finance officer signs in', r.status === 200, r.data);

  r = await call('admin', 'POST', '/api/admin/pages', {
    chapterId: 'test-chapter-2',
    title: 'Chapter Two Search Page',
    slug: 'chapter-two-search-page',
    description: 'Only the second chapter should see this page',
    content: 'Chapter two search content'
  });
  check('admin creates a chapter 2 page for search scoping', r.status === 200 && r.data.item.slug === 'chapter-two-search-page', r.data);

  r = await call('anon', 'GET', `/api/search?q=${encodeURIComponent('Chapter Two Search Page')}`, null, false, { 'X-Chapter-Id': chapterId });
  check('public search hides other chapters when chapter 1 is selected', r.status === 200 && !(r.data.results || []).some(item => item.href.includes('/page.html?slug=chapter-two-search-page')), r.data.results);

  r = await call('anon', 'GET', `/api/search?q=${encodeURIComponent('Chapter Two Search Page')}`, null, false, { 'X-Chapter-Id': 'test-chapter-2' });
  check('public search shows chapter-specific results for the chosen chapter', r.status === 200 && (r.data.results || []).some(item => item.href.includes('/page.html?slug=chapter-two-search-page')), r.data.results);

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

  const shep2MemberId = (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: (() => { const fd = new FormData(); fd.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png'); fd.append('name', 'Shep Two'); fd.append('email', 'shep2@test.com'); fd.append('password', 'secret123'); fd.append('chapterId', 'test-chapter-2'); return fd; })() })).json()).member.id;
  r = await call('admin', 'POST', '/api/admin/staff', { username: 'shep2', name: 'shep2', role: 'shepherding', password: 'password123', chapterId: 'test-chapter-2', memberId: shep2MemberId });
  check('shepherding account created for chapter 2', r.status === 200, r.data);
  r = await call('shep2', 'POST', '/api/portal/login', { username: 'shep2', password: 'password123' });
  check('chapter 2 shepherd signs in', r.status === 200, r.data);
  r = await call('shep2', 'GET', '/api/shepherd/members');
  check("chapter 2's member list does not include chapter 1's registered member",
    !r.data.some(m => m.memberId === memberId), r.data.map(m => m.name));
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

  console.log('\n== chapter-scoped site settings (Phase 1) ==');
  r = await call('admin', 'GET', '/api/admin/chapter-settings?chapterId=' + chapterId);
  check('admin reads chapter 1 settings', r.status === 200 && r.data.chapterId === chapterId, r.data);

  r = await call('coord', 'PUT', '/api/admin/chapter-settings', {
    name: 'ACONSU-KNUST Updated',
    tagline: 'Empowered for Impact',
    verseOfTheWeek: 'Romans 12:1-2',
    serviceTimes: ['Sundays 8:00 AM', 'Wednesdays 6:30 PM'],
    contact: { whatsapp: '233240000000', email: 'knust@aconsu.org', telegram: 'https://t.me/aconsuknust' },
    payment: {
      provider: 'Manual MoMo',
      momoName: 'ACONSU KNUST',
      bankAccountName: 'ACONSU KNUST Fellowship',
      donationDestination: 'General Fund',
      welfareDestination: 'Welfare Fund'
    },
    about: {
      vision: 'To raise steadfast believers on campus.',
      values: 'Prayer, fellowship, scripture, service.',
      leadership: 'The chapter leadership team serves students across KNUST.'
    }
  });
  check('chapter 1 coordinator updates chapter settings', r.status === 200 && r.data.item.tagline === 'Empowered for Impact', r.data);
  check('chapter 1 settings include telegram and payment metadata', r.data.item.contact.telegram === 'https://t.me/aconsuknust' && r.data.item.payment.provider === 'Manual MoMo' && r.data.item.about.values.includes('scripture'), r.data);

  r = await call('coord2', 'GET', '/api/admin/chapter-settings');
  check('chapter 2 coordinator reads chapter 2 settings', r.status === 200 && r.data.chapterId === 'test-chapter-2', r.data);
  check('chapter 2 settings do not have chapter 1 tagline', r.data.tagline !== 'Empowered for Impact', r.data);

  // The chapter 2 Coordinator passes requireChapterAdmin, so this genuinely
  // exercises the chapter scoping rather than bouncing off the role guard:
  // asking for chapter 1's SMS credentials by id must still answer with their
  // own chapter's, never chapter 1's key hint.
  r = await call('coord2', 'GET', `/api/admin/chapter-sms?chapterId=${chapterId}`);
  check('a chapter 2 coordinator cannot read chapter 1\'s SMS credentials',
    r.status !== 200 || r.data.apiKeyHint !== '••••1234', { status: r.status, data: r.data });

  r = await call('coord', 'PUT', '/api/admin/settings', { tagline: 'Should not be allowed' });
  check('chapter coordinator cannot overwrite global settings', r.status === 401, r.data);

  const bannerForm = new FormData();
  bannerForm.append('image', new Blob([Buffer.from('fake-banner-bytes')], { type: 'image/png' }), 'banner.png');
  const bannerRes = await fetch(BASE + '/api/admin/chapter-settings/banner', {
    method: 'POST',
    headers: jars.coord ? { cookie: jars.coord } : {},
    body: bannerForm
  });
  const bannerData = await bannerRes.json();
  check('chapter coordinator uploads a chapter banner', bannerRes.status === 200 && !!bannerData.fileId, bannerData);

  r = await call('coord', 'GET', '/api/admin/chapter-settings');
  check('chapter banner is linked to chapter 1 settings', r.status === 200 && r.data.homeHeaderImageFileId === bannerData.fileId, r.data);

  const bannerFileRes = await fetch(BASE + '/api/files/' + bannerData.fileId);
  check('chapter banner is publicly served from files API', bannerFileRes.status === 200);

  const pubRes = await fetch(BASE + '/api/settings', {
    headers: { 'X-Chapter-Id': chapterId }
  });
  const pubSettings = await pubRes.json();
  check('public settings reflect chapter 1 verse of the week', pubRes.status === 200 && pubSettings.verseOfTheWeek === 'Romans 12:1-2', pubSettings);
  check('public settings reflect chapter 1 service times', Array.isArray(pubSettings.serviceTimes) && pubSettings.serviceTimes.includes('Sundays 8:00 AM'), pubSettings);
  check('public settings reflect chapter 1 banner', pubSettings.homeHeaderImageFileId === bannerData.fileId, pubSettings);
  check('public settings reflect chapter 1 contact and about details', pubSettings.contact.telegram === 'https://t.me/aconsuknust' && pubSettings.payment.donationDestination === 'General Fund' && pubSettings.about.leadership.includes('leadership team'), pubSettings);

  console.log('\n== operational dashboard (Phase 2) ==');
  r = await call('coord', 'GET', '/api/admin/overview');
  check('chapter coordinator can load operational dashboard overview', r.status === 200 && r.data.chapter.id === chapterId, r.data);
  check('operational dashboard returns Rule-of-4 KPI cards', Array.isArray(r.data.kpis) && r.data.kpis.length === 4, r.data.kpis);
  check('operational dashboard returns activity stream rows', Array.isArray(r.data.activity), r.data.activity);

  r = await call('coord2', 'GET', '/api/admin/overview');
  check('chapter 2 coordinator sees chapter 2 dashboard scope only', r.status === 200 && r.data.chapter.id === 'test-chapter-2', r.data);

  r = await call('admin', 'GET', '/api/admin/overview');
  check('national admin must pick a chapter for operational dashboard once multiple chapters exist', r.status === 400, r.data);
  r = await call('admin', 'GET', '/api/admin/overview?chapterId=' + chapterId);
  check('national admin can load a selected chapter operational dashboard', r.status === 200 && r.data.chapter.id === chapterId, r.data);

  console.log('\n== operational dashboard: live push, not polling (Phase 2, SSE) ==');
  {
    const streamHeaders = (cookieJar) => (jars[cookieJar] ? { cookie: jars[cookieJar] } : {});
    const anonStream = await fetch(BASE + '/api/admin/overview/stream?chapterId=' + chapterId);
    check('the live dashboard stream requires authentication', anonStream.status === 401, anonStream.status);

    // A helper that reads SSE chunks off a real, open connection until a
    // marker string shows up or the deadline passes — this is exercising the
    // actual push transport, not a stand-in for it.
    const readUntil = async (reader, decoder, marker, timeoutMs) => {
      const deadline = Date.now() + timeoutMs;
      let buffer = '';
      while (Date.now() < deadline) {
        const remaining = deadline - Date.now();
        const { value, done } = await Promise.race([
          reader.read(),
          new Promise((resolve) => setTimeout(() => resolve({ done: false, value: undefined, timeout: true }), Math.max(50, remaining)))
        ]);
        if (done) return { found: false, buffer };
        if (value) buffer += decoder.decode(value, { stream: true });
        if (buffer.includes(marker)) return { found: true, buffer };
      }
      return { found: false, buffer };
    };

    const ch1 = new AbortController();
    const ch1Res = await fetch(BASE + '/api/admin/overview/stream?chapterId=' + chapterId, { headers: streamHeaders('coord'), signal: ch1.signal });
    check('the live dashboard stream opens for an authenticated chapter admin',
      ch1Res.status === 200 && (ch1Res.headers.get('content-type') || '').includes('text/event-stream'), ch1Res.status);

    const ch2 = new AbortController();
    const ch2Res = await fetch(BASE + '/api/admin/overview/stream?chapterId=test-chapter-2', { headers: streamHeaders('coord2'), signal: ch2.signal });
    const ch1Reader = ch1Res.body.getReader();
    const ch2Reader = ch2Res.body.getReader();
    const decoder1 = new TextDecoder();
    const decoder2 = new TextDecoder();

    const marker = 'SSE push marker ' + Date.now();
    const posted = await fetch(BASE + '/api/contact', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-chapter-id': chapterId },
      body: JSON.stringify({ name: marker, email: 'sse-test@example.com', message: 'live push check' })
    });
    check('a public contact message is accepted (the activity this push is about)', posted.status === 200, posted.status);

    const ch1Result = await readUntil(ch1Reader, decoder1, marker, 4000);
    check('the chapter\'s own dashboard stream pushes the new activity, unprompted', ch1Result.found, ch1Result.buffer.slice(0, 300));

    const ch2Result = await readUntil(ch2Reader, decoder2, marker, 800);
    check('a different chapter\'s stream never receives another chapter\'s activity', !ch2Result.found, ch2Result.buffer.slice(0, 300));

    ch1.abort(); ch2.abort();
  }

  console.log('\n== governance tiers: national by default, chapter by selection ==');
  // With more than one chapter in play, an unscoped national read must mean
  // "ACONSU nationally", not "every chapter merged into one list" — that
  // merging is what let a national officer browse every chapter's executives
  // and members at once. See GOVERNANCE_TIER_REVIEW.md.
  r = await call('admin', 'GET', '/api/executives');
  check('national scope returns no chapter-owned executives once several chapters exist',
    Array.isArray(r.data) && r.data.every(e => !e.chapterId), r.data);

  r = await call('admin', 'POST', '/api/admin/executives', new URLSearchParams({
    name: 'National President', role: 'National President', chapterId: '__national__', order: '0'
  }).toString(), true, { 'content-type': 'application/x-www-form-urlencoded' });
  check('national coordinator can create a national executive', r.status === 200 && r.data.item.chapterId === '', r.data);

  r = await call('admin', 'GET', '/api/executives');
  check('the national executive is listed at national scope',
    Array.isArray(r.data) && r.data.some(e => e.name === 'National President'), r.data);

  r = await call('coord', 'GET', '/api/executives');
  check('a chapter never sees national executives mixed into its own roster',
    Array.isArray(r.data) && r.data.every(e => e.chapterId === chapterId), r.data);

  r = await call('admin', 'GET', '/api/executives?chapterId=' + chapterId);
  check('national can still look into one chapter deliberately',
    Array.isArray(r.data) && r.data.every(e => e.chapterId === chapterId), r.data);

  // The X-Chapter-Id header is what the admin dashboard's scope selector
  // sends, so it must narrow a national actor exactly as ?chapterId= does.
  r = await call('admin', 'GET', '/api/executives', null, false, { 'x-chapter-id': 'test-chapter-2' });
  check('the scope-selector header narrows a national actor the same way',
    Array.isArray(r.data) && r.data.every(e => e.chapterId === 'test-chapter-2'), r.data);

  console.log('\n== national events: open to the public, not any chapter\'s ==');
  r = await call('admin', 'POST', '/api/admin/events', {
    title: 'National Youth Conference', date: '2026-12-01', time: '09:00', location: 'National Auditorium',
    isNational: true
  });
  check('national coordinator creates a national event', r.status === 200 && r.data.item.chapterId === '' && r.data.item.isNational === true, r.data);
  const nationalEventId = r.data.item.id;

  r = await call('anon', 'GET', '/api/events');
  check('an anonymous visitor sees the national event on the public site',
    Array.isArray(r.data) && r.data.some(e => e.id === nationalEventId), r.data);

  r = await call('admin', 'GET', '/api/events');
  check('national scope sees only national events, never a chapter\'s own merged in',
    Array.isArray(r.data) && r.data.every(e => e.isNational), r.data);

  r = await call('coord', 'GET', '/api/events');
  check('a chapter\'s own events view includes the national event alongside its own',
    Array.isArray(r.data) && r.data.some(e => e.id === nationalEventId) && r.data.some(e => e.chapterId === chapterId), r.data);

  await call('coord', 'DELETE', `/api/admin/events/${nationalEventId}`);
  r = await call('admin', 'GET', '/api/events');
  check('a chapter admin cannot delete a national event by guessing its id',
    Array.isArray(r.data) && r.data.some(e => e.id === nationalEventId), r.data);

  r = await call('admin', 'PUT', `/api/admin/events/${nationalEventId}`, { title: 'National Youth Conference (Updated)' });
  check('national coordinator edits the national event', r.status === 200 && r.data.item.title === 'National Youth Conference (Updated)', r.data);

  await call('admin', 'DELETE', `/api/admin/events/${nationalEventId}`);
  r = await call('admin', 'GET', '/api/events');
  check('national coordinator removes the national event',
    Array.isArray(r.data) && !r.data.some(e => e.id === nationalEventId), r.data);

  console.log('\n== delegation: a coordinator staffs their own chapter ==');
  const delegatedMemberId = await registerMember('Delegated Admin', 'delegated.admin@test.com');
  r = await call('coord', 'POST', '/api/admin/staff',
    { username: 'delegated-admin', name: 'Delegated Admin', role: 'chapterAdmin', password: 'password123', memberId: delegatedMemberId });
  check('Chapter Coordinator appoints their own Chapter Admin', r.status === 200 && r.data.item.chapterId === chapterId, r.data);

  r = await call('delegated', 'POST', '/api/portal/login', { username: 'delegated-admin', password: 'password123' });
  check('the appointed Chapter Admin can sign in', r.status === 200, r.data);

  r = await call('delegated', 'GET', '/api/admin/chapter-settings');
  check('the appointed Chapter Admin carries on the chapter work', r.status === 200, r.data);

  // /chapter.html now offers the same panels as /admin.html, so what the
  // Chapter Admin signed in there can actually reach has to be checked rather
  // than assumed — a nav button that answers 401 is worse than no button.
  r = await call('delegated', 'GET', '/api/admin/forms');
  check('the Chapter Admin can use the form builder offered in their nav', r.status === 200, r.data);
  const financeCsv = await call('delegated', 'GET', '/api/finance/export.csv');
  check('and the chapter finance ledger stays shut to that role too',
    financeCsv.status === 401, financeCsv.status);
  // The two shepherding exports go through canView('shepherding'), which passes
  // for a Coordinator but not for the chapterAdmin role. Asserted rather than
  // glossed over: the Reports panel is honest for a Coordinator and partly
  // closed for a delegated Chapter Admin, and that is a permissions decision
  // to make deliberately, not a thing to discover from a broken download.
  const shepherdReport = await call('delegated', 'GET', '/api/shepherd/members/report.pdf');
  check('the membership PDF is NOT open to the delegated Chapter Admin role',
    shepherdReport.status === 401, shepherdReport.status);
  const coordReport = await call('coord', 'GET', '/api/shepherd/members/report.pdf');
  check('but a Chapter Coordinator can pull it', coordReport.status === 200, coordReport.status);

  r = await call('coord', 'POST', '/api/admin/staff',
    { username: 'nope', name: 'Nope', role: 'nationalCoordinator', password: 'password123' });
  check('a coordinator still cannot mint a National Coordinator', r.status === 403, r.data);

  // Electing officers is the Coordinator's call, not the Chapter Admin's.
  r = await call('delegated', 'POST', '/api/admin/staff',
    { username: 'exec.sneak', name: 'Sneak Exec', role: 'executive', password: 'password123', memberId });
  check('a Chapter Admin cannot promote a member to the executive body', r.status === 403, r.data);

  r = await call('coord2', 'GET', '/api/admin/staff');
  check('chapter 2 never sees chapter 1\'s newly appointed staff',
    Array.isArray(r.data) && r.data.every(s => s.chapterId === 'test-chapter-2'), r.data);

  // The dashboard's scope selector sends its choice on the request rather
  // than as ?chapterId=, so endpoints that resolve a chapter for themselves
  // must honour it too — otherwise picking a chapter in the top bar silently
  // fails to reach them.
  r = await call('admin', 'GET', '/api/admin/overview', null, false, { 'x-chapter-id': chapterId });
  check('the scope selector reaches endpoints that resolve their own chapter',
    r.status === 200 && r.data.chapter.id === chapterId, r.data);

  console.log('\n== confidentiality boundary: national sees aggregates, not case files ==');
  r = await call('admin', 'GET', '/api/welfare/requests');
  check('national is refused the welfare queue outright, with a reason', r.status === 403 && /stay inside the chapter/.test(r.data.error || ''), r.data);

  r = await call('admin', 'GET', '/api/welfare/requests?chapterId=' + chapterId);
  check('naming a chapter does not open welfare case notes to national either', r.status === 403, r.data);

  r = await call('admin', 'GET', '/api/finance/entries');
  check('national is refused the finance ledger', r.status === 403, r.data);

  r = await call('admin', 'GET', '/api/finance/export.csv?chapterId=' + chapterId);
  check('national cannot export a chapter ledger either', r.status === 403, r.data);

  r = await call('welf', 'GET', '/api/welfare/requests');
  check('the chapter welfare officer still reads their own queue', r.status === 200, r.data);

  r = await call('fin', 'GET', '/api/finance/entries');
  check('the chapter finance officer still reads their own ledger', r.status === 200, r.data);

  r = await call('admin', 'GET', '/api/national/dashboard');
  check('national keeps the aggregate financial picture', r.status === 200 && r.data.financialOverview, r.data);

  console.log('\n== chapter readiness rollup (Phase D): oversight without interference ==');
  r = await call('admin', 'POST', '/api/national/chapters', { id: 'readiness-ch', name: 'ACONSU-Readiness', institution: 'Readiness U' });
  check('a fresh chapter is created for readiness checks', r.status === 200, r.data);

  r = await call('admin', 'GET', '/api/national/dashboard');
  let readinessCh = (r.data.chapters || []).find(c => c.id === 'readiness-ch');
  check('a brand-new chapter starts with nothing staffed, no coordinator and incomplete settings',
    !!readinessCh && !readinessCh.readiness.coordinatorAssigned && !readinessCh.readiness.adminAppointed &&
    readinessCh.readiness.officesStaffedCount === 0 && !readinessCh.readiness.settingsComplete &&
    readinessCh.readiness.lastActivityAt === null, readinessCh);

  r = await call('admin', 'POST', '/api/national/chapters/readiness-ch/assign-coordinator',
    { username: 'readiness-coord', name: 'Readiness Coordinator', password: 'password123' });
  check('national assigns the new chapter its own coordinator', r.status === 200 && r.data.chapter.coordinatorStaffId, r.data);

  r = await call('readiness-coord', 'POST', '/api/portal/login', { username: 'readiness-coord', password: 'password123' });
  check('the new coordinator signs in', r.status === 200, r.data);
  const readinessFinMemberId = (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: (() => {
    const fd = new FormData();
    fd.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
    fd.append('name', 'Readiness Finance'); fd.append('email', 'readiness.fin@test.com');
    fd.append('password', 'secret123'); fd.append('chapterId', 'readiness-ch');
    return fd;
  })() })).json()).member.id;
  r = await call('readiness-coord', 'POST', '/api/admin/staff',
    { username: 'readiness-fin', name: 'Readiness Finance', role: 'finance', password: 'password123', memberId: readinessFinMemberId });
  check('the coordinator staffs the finance office', r.status === 200, r.data);

  r = await call('admin', 'GET', '/api/national/dashboard');
  readinessCh = (r.data.chapters || []).find(c => c.id === 'readiness-ch');
  check('readiness now shows a coordinator and exactly one of four offices staffed', !!readinessCh &&
    readinessCh.readiness.coordinatorAssigned && !readinessCh.readiness.adminAppointed &&
    readinessCh.readiness.officesStaffedCount === 1 && readinessCh.readiness.officesStaffed.finance === true &&
    readinessCh.readiness.officesStaffed.welfare === false, readinessCh);

  r = await call('readiness-coord', 'PUT', '/api/admin/chapter-settings',
    { tagline: 'Readiness Test Tagline', serviceTimes: ['Sundays 9AM'], contact: { phone: '0000000000' } });
  check('the coordinator completes the chapter\'s settings', r.status === 200, r.data);

  r = await call('admin', 'GET', '/api/national/dashboard');
  readinessCh = (r.data.chapters || []).find(c => c.id === 'readiness-ch');
  check('readiness reflects settings now being complete, without national ever reading chapter content',
    !!readinessCh && readinessCh.readiness.settingsComplete, readinessCh);

  console.log('\n== the national council ==');
  // The one body where the whole union sits together. A seat grants exactly
  // two things — reading the council and speaking in it — and nothing at all
  // about another chapter.
  r = await call('admin', 'POST', '/api/admin/staff', { username: 'patron.nat', name: 'Nana Patron', role: 'patron', password: 'password123', chapterId: '__national__' });
  check('the National Patron is appointed', r.status === 200 && r.data.item.chapterId === '', r.data);
  r = await call('admin', 'POST', '/api/admin/staff', { username: 'patron.ch', name: 'Chapter Patron', role: 'patron', password: 'password123', chapterId });
  check('a Chapter Patron is appointed to their own chapter', r.status === 200 && r.data.item.chapterId === chapterId, r.data);
  r = await call('coord2', 'POST', '/api/admin/staff', { username: 'patron.sneak', name: 'Sneak', role: 'patron', password: 'password123', chapterId: '__national__' });
  check('a chapter coordinator cannot appoint the National Patron', r.status === 403, r.data);

  await call('patron', 'POST', '/api/portal/login', { username: 'patron.nat', password: 'password123' });
  r = await call('patron', 'GET', '/api/portal/me');
  check('the Patron is seated on the council', r.data.councilSeat === 'National Patron' && r.data.access.council.view === true, r.data.councilSeat);

  // The Chapter President earns a seat through their position, not their role.
  // A fresh President is appointed here rather than reusing the one above,
  // whose term this suite deliberately expires and whose sessions it revokes.
  const presRegForm = new FormData();
  presRegForm.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
  presRegForm.append('name', 'Yaw President');
  presRegForm.append('email', 'yaw.president@test.com');
  presRegForm.append('password', 'secret123');
  presRegForm.append('chapterId', chapterId);
  const presMemberId = (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: presRegForm })).json()).member.id;
  r = await call('admin', 'POST', '/api/admin/staff', { username: 'exec.president', name: 'Yaw President', role: 'executive', password: 'password123', memberId: presMemberId, positionKey: 'president', chapterId });
  check('a sitting Chapter President is appointed', r.status === 200, r.data);
  await call('pres', 'POST', '/api/portal/login', { username: 'exec.president', password: 'password123' });

  r = await call('pres', 'GET', '/api/portal/me');
  check('a Chapter President is seated by virtue of their position', r.data.councilSeat === 'Chapter President', r.data.councilSeat);
  r = await call('coord', 'GET', '/api/portal/me');
  check('a Chapter Coordinator is seated too', r.data.councilSeat === 'Chapter Coordinator', r.data.councilSeat);
  // An executive who is not the President has no seat.
  r = await call('exec', 'GET', '/api/portal/me');
  check('an ordinary executive holds no council seat', !r.data.councilSeat && r.data.access.council.view === false, r.data.councilSeat);
  r = await call('exec', 'GET', '/api/council');
  check('and cannot open the council at all', r.status === 401, r.data);

  // Everyone with a seat sees the same discussion, across chapters.
  r = await call('pres', 'POST', '/api/council/posts', { body: 'Proposing a joint retreat next semester.' });
  check('a Chapter President raises a matter', r.status === 200 && r.data.item.authorRole === 'Chapter President', r.data);
  const threadId = r.data.item.id;
  r = await call('patron', 'POST', '/api/council/posts', { body: 'The patrons support this.', parentId: threadId });
  check('the Patron replies to it', r.status === 200 && r.data.item.parentId === threadId, r.data);
  r = await call('coord2', 'GET', '/api/council');
  check('a different chapter\'s Coordinator sees the same discussion',
    r.status === 200 && r.data.threads.some(t => t.id === threadId && t.replies.length === 1), r.data.threads);

  // Threads stay one level deep, so a discussion stays readable.
  const replyId = (await call('coord2', 'GET', '/api/council')).data.threads
    .find(t => t.id === threadId).replies[0].id;
  r = await call('coord', 'POST', '/api/council/posts', { body: 'Replying to a reply.', parentId: replyId });
  check('a reply to a reply is folded back into the same thread',
    r.status === 200 && r.data.item.parentId === threadId, r.data.item);
  r = await call('coord', 'POST', '/api/council/posts', { body: '' });
  check('an empty post is refused', r.status === 400, r.data);

  // THE POINT: a council seat is not a key to another chapter. Chapter 2 gets
  // a member with an unmistakable name, and the President — who sits on the
  // council beside chapter 2's Coordinator — must never see them, even when
  // asking for chapter 2 by name.
  const otherRegForm = new FormData();
  otherRegForm.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
  otherRegForm.append('name', 'Chapter Two Only Member');
  otherRegForm.append('email', 'chaptertwo.only@test.com');
  otherRegForm.append('password', 'secret123');
  otherRegForm.append('chapterId', 'test-chapter-2');
  await fetch(BASE + '/api/auth/register', { method: 'POST', body: otherRegForm });

  r = await call('pres', 'GET', '/api/executive/chapter/members');
  check('a President on the council still only ever sees their own chapter',
    r.status === 200 && r.data.length > 0 && !r.data.some(m => m.name === 'Chapter Two Only Member'),
    r.data.map(m => m.name));
  r = await call('pres', 'GET', '/api/executive/chapter/members?chapterId=test-chapter-2');
  check('and asking for another chapter by name changes nothing',
    r.status === 200 && !r.data.some(m => m.name === 'Chapter Two Only Member'), r.data.map(m => m.name));
  r = await call('pres', 'GET', '/api/executive/chapter/members', null, false, { 'X-Chapter-Id': 'test-chapter-2' });
  check('nor does asking through a chapter header',
    r.status === 200 && !r.data.some(m => m.name === 'Chapter Two Only Member'), r.data.map(m => m.name));
  r = await call('patron', 'GET', '/api/admin/members');
  check('a Patron administers nothing — not even their own chapter\'s members', r.status === 401, r.data);
  r = await call('patron', 'GET', '/api/finance/summary');
  check('and cannot reach any chapter\'s finances', r.status === 401, r.data);
  r = await call('patron', 'PUT', '/api/council/meeting', { meetingUrl: 'https://zoom.us/j/123' });
  check('only the National Coordinator convenes the council', r.status === 403, r.data);

  // The meeting link is something people click, so it must be a real https URL.
  r = await call('admin', 'PUT', '/api/council/meeting', { meetingUrl: 'javascript:alert(1)' });
  check('a meeting link that is not a real https address is refused', r.status === 400, r.data);
  r = await call('admin', 'PUT', '/api/council/meeting', {
    meetingUrl: 'https://zoom.us/j/9876543210', meetingLabel: 'Monthly Council', meetingAt: 'First Saturday, 7:00 PM'
  });
  check('the National Coordinator sets the meeting', r.status === 200 && /zoom\.us/.test(r.data.meeting.meetingUrl), r.data);
  r = await call('pres', 'GET', '/api/council');
  check('and every seat can see it', r.data.meeting.url === 'https://zoom.us/j/9876543210', r.data.meeting);

  // Removing posts: your own always, anyone's only as chair.
  r = await call('coord2', 'DELETE', `/api/council/posts/${threadId}`);
  check('you cannot remove someone else\'s post', r.status === 403, r.data);
  r = await call('admin', 'PATCH', `/api/council/posts/${threadId}/pin`);
  check('the chair pins a matter', r.status === 200 && r.data.item.pinned === true, r.data);
  r = await call('admin', 'DELETE', `/api/council/posts/${threadId}`);
  check('the chair can remove a thread', r.status === 200, r.data);
  r = await call('admin', 'GET', '/api/council');
  check('and its replies go with it, rather than being orphaned',
    !r.data.threads.some(t => t.id === threadId), r.data.threads);

  // The roster is public: these are the union's national executives.
  r = await call('anon', 'GET', '/api/national/executives');
  check('the national executives are listed publicly', r.status === 200 && Array.isArray(r.data) && r.data.length > 0, r.data);
  check('with the National Coordinator ranked first', r.data[0].seat === 'National Coordinator' || r.data[0].seat === 'National Patron', r.data[0]);
  check('and Chapter Presidents named among them', r.data.some(x => x.seat === 'Chapter President'), r.data.map(x => x.seat));
  r = await call('anon', 'GET', '/api/council');
  check('but the discussion itself is not public', r.status === 401, r.data);

  console.log('\n== static pages ==');
  for (const page of [
    '/more.html', '/admin.html', '/national.html', '/finance.html', '/coordinator.html', '/publicity.html', '/shepherding.html',
    '/register.html', '/executive.html', '/card.html', '/bible-study.html', '/sermon-notes.html', '/prayer.html',
    '/events.html', '/index.html',
    '/groups.html', '/group.html', '/chat.html', '/welfare.html', '/welfare-portal.html', '/give.html',
    '/content.html', '/content-manager.html',
    '/council.html', '/privacy.html',
    '/js/portal.js', '/js/national.js', '/js/executive.js', '/js/welfare-portal.js', '/js/council.js', '/css/portal.css'
  ]) {
    const res = await fetch(BASE + page);
    check(`${page} served`, res.status === 200);
  }

  // A shared script may only touch elements that exist on every page loading
  // it. admin.js is loaded by both admin.html and chapter.html, and its login
  // handler disables #loginBtn before sending the request — chapter.html had
  // no such id, so the handler threw on the first line and the Chapter Admin
  // login silently did nothing at all. These assert the contract directly, so
  // the next page to share a script cannot quietly drop an id its script needs.
  // Google Play and the App Store both open the privacy policy while signed
  // out, and reject a listing whose policy URL does not load. The same is true
  // of the page a data-deletion request is made from.
  {
    const policy = await fetch(BASE + '/privacy.html');
    const policyText = await policy.text();
    check('the privacy policy loads without signing in', policy.status === 200, policy.status);
    check('and says what is actually collected',
      /prayer request/i.test(policyText) && /welfare/i.test(policyText) && /hostel/i.test(policyText), policyText.length);
    check('and tells people how to have it deleted', /delete your account/i.test(policyText));
    const contact = await fetch(BASE + '/contact.html');
    check('the contact page a deletion request goes through also loads signed out', contact.status === 200, contact.status);
  }

  console.log('\n== PWA: installability and what happens with no network ==');
  {
    const fs = require('fs');
    const path = require('path');
    const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

    const manifest = JSON.parse(pub('manifest.json'));
    // The implicit manifest id is start_url. If a declared id ever disagrees with
    // it, everyone who already installed the app gets a SECOND icon rather than an
    // update to the one they have — silent, and unfixable after the fact.
    check('the manifest id matches start_url, so existing installs are not duplicated',
      manifest.id === manifest.start_url, { id: manifest.id, start_url: manifest.start_url });
    check('the manifest still declares a maskable icon',
      manifest.icons.some(i => i.purpose === 'maskable'), manifest.icons.map(i => i.purpose));

    const sw = pub('sw.js');
    const offline = await fetch(BASE + '/offline.html');
    check('the offline page is actually served', offline.status === 200, offline.status);
    const offlineText = await offline.text();
    // It is shown precisely when the network is gone, so anything it links out
    // to could be the very thing that failed. It has to stand on its own bytes.
    check('the offline page pulls in no stylesheet or script it could not load',
      !/<link[^>]+rel=["']stylesheet["']/.test(offlineText) && !/<script[^>]+src=/.test(offlineText));
    check('the offline page is in the cached shell', sw.includes("'/offline.html'"));
    check('a document that is missing offline falls back to it, not to "page not found"',
      sw.includes("caches.match('/offline.html')") && !sw.includes("caches.match('/404.html')"));

    // A shared phone: one member signs out, the next opens the app with no data.
    // Without this the service worker hands over the first member's cached records.
    check('the service worker can be told to drop cached account data',
      sw.includes('CLEAR_API_CACHE'));
    check('and never caches who-you-are responses in the first place',
      sw.includes('NEVER_CACHE_API') && sw.includes("'/api/auth/me'"));
    check('and only ever caches a successful API response',
      /res\.status === 200 && !NEVER_CACHE_API/.test(sw));
    for (const [page, file] of [['profile.html', 'profile.html'], ['more.html', 'more.html']]) {
      check(`${page} clears cached account data when signing out`,
        pub(file).includes('clearCachedAccountData()'));
    }
    check('the portals clear cached account data when signing out',
      pub('js/portal.js').includes('clearCachedAccountData()'));

    const main = pub('js/main.js');
    // Safari fires no install event at all, and we are not on the App Store, so
    // Add to Home Screen is the only route an iPhone member has.
    // Checked as "defined AND called", not as a bare substring: a plain
    // includes('isIosSafari') still passes after the function is renamed to
    // isIosSafariXX, which is a test that cannot fail.
    check('iOS gets install instructions, since Safari fires no install prompt',
      /function isIosSafari\s*\(/.test(main) && /[^\w]isIosSafari\(\)/.test(main) && /Add to Home Screen/i.test(main));
    check('and browsers on iOS that cannot install are not told to try',
      /CriOS\|FxiOS/.test(main));
    check('an already-installed app is not asked to install again',
      /function isStandalone\s*\(/.test(main) && /[^\w]isStandalone\(\)/.test(main) && main.includes('display-mode: standalone'));
    check('a slow request explains the wait instead of showing a dead screen',
      /function showSlowBanner\s*\(/.test(main) && main.includes('SLOW_REQUEST_MS'));
    // Registration requires a photo, and a photo on mobile data is routinely
    // slower than the cold-start threshold. Calling that "waking the server up"
    // would be wrong, to a brand-new member, at their first moment in the app.
    check('a slow upload is not mistaken for a sleeping server',
      main.includes('opts.body instanceof FormData') && /Still uploading/.test(main));
  }

  console.log('\n== is the database actually there? ==');
  {
    // The home page answers 200 whether or not MongoDB is reachable, because
    // it is a static file. So "the site loads" has never been evidence that
    // the database is up, and this is the URL that is.
    const health = await fetch(BASE + '/api/health');
    const body = await health.json();
    check('the health check answers without signing in', health.status === 200, health.status);
    check('and says the database is connected', body.ok === true && body.database.connected === true, body);
    check('and reports a real round trip, not just a flag', typeof body.database.pingMs === 'number', body.database);
    check('and how long this instance has been up', typeof body.uptimeSeconds === 'number', body);
    // Anyone can reach this URL, so it must give away nothing.
    const asText = JSON.stringify(body).toLowerCase();
    check('it leaks no connection string, host or credentials',
      !asText.includes('mongodb') && !asText.includes('mongodb+srv') && !asText.includes('password')
      && !asText.includes('@') && !asText.includes('uri'), body);

    // The branch that matters. A monitor only helps if a dead database makes
    // this URL go red — answering 200 while nothing works is worse than having
    // no health check at all.
    fakeDb.healthy = false;
    const down = await fetch(BASE + '/api/health');
    const downBody = await down.json();
    check('a database that has gone away turns the health check red',
      down.status === 503, down.status);
    check('and it says so plainly rather than claiming to be fine',
      downBody.ok === false && downBody.database.connected === false, downBody);
    fakeDb.healthy = true;
    const back = await fetch(BASE + '/api/health');
    check('and it goes green again when the database returns', back.status === 200, back.status);

    // Everything above runs against the harness's stand-in for lib/db.js, so
    // it proves the ROUTE and nothing about the module the route depends on.
    // Deleting the real dbStatus entirely left this whole section green, which
    // is exactly the blind spot a stub creates. This reaches past the stub to
    // the file that ships.
    {
      const path = require('path');
      // require() inside this process still lands on the stub, which is the
      // whole difficulty — so the real module is run in a process the harness
      // was never loaded into.
      const { execFileSync } = require('child_process');
      const probe = execFileSync(process.execPath, ['-e',
        "const d=require('./lib/db.js');" +
        "if(typeof d.dbStatus!=='function'){console.log('{\"missing\":true}');process.exit(0);}" +
        "d.dbStatus().then(s=>console.log(JSON.stringify(s))).catch(e=>console.log(JSON.stringify({threw:e.message})));"
      ], { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 15000 }).trim();
      const offline = JSON.parse(probe);
      check('the real lib/db.js exports the status probe the route calls', !offline.missing, offline);
      // Nothing is connected in that process, so it must say so rather than throw.
      check('and reports a disconnected database instead of throwing',
        !offline.threw && offline.connected === false && typeof offline.state === 'string', offline);
      check('and never puts a connection string in what it returns',
        !probe.toLowerCase().includes('mongodb'), probe.slice(0, 120));
      const src = require('fs').readFileSync(path.join(__dirname, '..', 'lib', 'db.js'), 'utf8');
      check('it asks the database a real question rather than trusting a flag',
        src.includes('admin().ping()'), 'no ping in lib/db.js');
      check('and a connection lost after startup is logged rather than silent',
        /connection\.on\('disconnected'/.test(src), 'nothing watches for a drop');
    }
  }

  console.log('\n== ACONSU Rooms: small meetings, honestly capped ==');
  {
    // Opening a room is a leader's act.
    r = await call('member', 'POST', '/api/rooms', { title: 'Sneaky Room', chapterId });
    check('an ordinary member cannot open a room', r.status === 403 || r.status === 401, r.status);
    r = await call('coord', 'POST', '/api/rooms', { title: 'Exec Huddle', chapterId });
    check('a coordinator opens a room for the chapter', r.status === 200, r.data);
    const roomId = r.data.item.id;
    check('and it holds four people, not more', r.data.item.maxParticipants === 4, r.data.item);

    r = await call('member', 'GET', '/api/rooms');
    check('a member of the chapter sees it', r.status === 200 && r.data.items.some(x => x.id === roomId), r.data);
    check('and is told the capacity up front', r.data.capacity === 4, r.data);

    // A department room is that department's, not the chapter's.
    r = await call('coord', 'POST', '/api/rooms', { title: 'Choir Practice', chapterId, departmentId: deptId });
    check('a room can belong to one department', r.status === 200 && r.data.item.departmentId === deptId, r.data);
    const choirRoomId = r.data.item.id;
    r = await call('newbie', 'GET', '/api/rooms');
    check("someone not in that department is not offered its room",
      !(r.data.items || []).some(x => x.id === choirRoomId), r.data.items);

    // Chapter isolation holds here as everywhere else.
    r = await call('coord2', 'POST', '/api/rooms', { title: 'Other Chapter Room', chapterId: 'test-chapter-2' });
    const otherRoomId = r.data.item && r.data.item.id;
    r = await call('member', 'GET', '/api/rooms');
    check("another chapter's room is never listed here",
      !(r.data.items || []).some(x => x.id === otherRoomId), r.data.items);
    // The listing is filtered by chapter at the query, so it proves nothing
    // about the guard. Opening the stream for a room by id is the path that
    // does: it looks the room up unscoped and then asks canEnterRoom.
    {
      const ctrl = new AbortController();
      const streamRes = await fetch(BASE + `/api/rooms/${otherRoomId}/events`, {
        headers: { cookie: jars['member'], accept: 'text/event-stream' },
        signal: ctrl.signal
      });
      ctrl.abort();
      check("a member cannot open another chapter's room at all", streamRes.status === 403, streamRes.status);
    }

    // The relay carries a message between two people in one room, and refuses
    // anything else. Nobody is in the room here, so speaking as a peer that
    // does not exist must fail rather than be forwarded anywhere.
    r = await call('member', 'POST', `/api/rooms/${roomId}/signal`, { from: 'not-a-peer', to: 'nor-this', data: { sdp: 'x' } });
    check('you cannot signal as a peer who is not in the room', r.status === 403, r.data);

    r = await call('anon', 'GET', '/api/rooms');
    check('rooms are not listed to someone signed out', r.status === 401, r.data);
    r = await call('anon', 'GET', `/api/rooms/${roomId}/events`);
    check('and the signalling stream is refused to them too', r.status === 401, r.status);

    // A room that is closed is closed.
    r = await call('coord', 'POST', `/api/rooms/${roomId}/close`, {});
    check('a leader can close the room', r.status === 200, r.data);
    r = await call('member', 'GET', '/api/rooms');
    check('and it stops being offered', !(r.data.items || []).some(x => x.id === roomId), r.data.items);
    r = await call('member', 'GET', `/api/rooms/${roomId}/events`);
    check('nor can anyone still join it', r.status === 403, r.status);

    // The page itself, and the worker that must not touch its stream.
    const fs = require('fs');
    const path = require('path');
    const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
    const meetPage = await fetch(BASE + '/meet.html');
    check('the ACONSU Rooms page is served', meetPage.status === 200, meetPage.status);
    check('and is reachable from the app', pub('more.html').includes('/meet.html'));
    // An event stream never ends. Caching one would hold a clone of an
    // infinite body open for the whole call, and the call would never connect.
    const sw = pub('sw.js');
    check('the service worker never intercepts a live stream',
      sw.includes("'/api/rooms/'") && sw.includes('text/event-stream'));
    // The cap is the one thing that must not be advisory.
    const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    check('capacity is enforced server-side, not just shown in the page',
      /peers\.size >= \(room\.maxParticipants/.test(srv));
    check('TURN is read from the environment so a chapter can add one',
      srv.includes('TURN_URL') && srv.includes('hasTurn'));
  }

  console.log('\n== signing up as an alumnus ==');
  {
    // Not everyone joining is a student. Someone who has finished says so at
    // registration and is asked for a graduation year instead of a hostel.
    const alForm = new FormData();
    alForm.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'g.png');
    alForm.append('name', 'Grace Returned');
    alForm.append('email', 'grace.returned@test.com');
    alForm.append('password', 'secret123');
    alForm.append('chapterId', chapterId);
    alForm.append('memberKind', 'alumni');
    alForm.append('graduationYear', '2019');
    const alRes = await fetch(BASE + '/api/auth/register', { method: 'POST', body: alForm });
    const alData = await alRes.json();
    check('someone can register as an alumnus', alRes.status === 200, alData);
    const graceId = alData.member.id;

    // The claim is recorded. The stage is NOT granted by saying it — otherwise
    // Alumni Connect, which spans the union, is a directory anyone can write
    // themselves into.
    r = await call('shep', 'GET', '/api/shepherd/members');
    const grace = r.data.find(m => m.memberId === graceId);
    check('shepherding can see they said they had graduated', grace && grace.registeredAsAlumni === true, grace);
    check('and the year they gave', grace && grace.graduationYear === '2019', grace);
    check('but the stage is still theirs to confirm, not self-granted',
      grace && grace.membershipStage === 'visitor', grace && grace.membershipStage);

    r = await call('grace', 'POST', '/api/auth/login', { email: 'grace.returned@test.com', password: 'secret123' });
    check('the alumnus can sign in', r.status === 200, r.data);
    r = await call('grace', 'PUT', '/api/member/alumni-profile', { listed: true, profession: 'Architect' });
    check('and cannot list themselves until shepherding confirms it', r.status === 403, r.data);

    r = await call('shep', 'PATCH', `/api/shepherd/members/${graceId}/stage`, { stage: 'alumni' });
    check('shepherding confirms them as alumni', r.status === 200, r.data);
    r = await call('grace', 'PUT', '/api/member/alumni-profile', { listed: true, profession: 'Architect', industry: 'Architecture & Built Environment' });
    check('and now the listing opens to them', r.status === 200, r.data);
  }

  console.log('\n== a chapter leader is a member of the chapter first ==');
  {
    // An office account with no member behind it has no profile, no membership
    // number, and no way to show the holder where they stand.
    r = await call('admin', 'POST', '/api/admin/staff',
      { username: 'ghost.office', name: 'Ghost', role: 'shepherding', password: 'password123', chapterId });
    check('an office account cannot be opened without naming the member', r.status === 400, r.data);
    r = await call('admin', 'POST', '/api/admin/staff',
      { username: 'real.office', name: 'Real Office', role: 'shepherding', password: 'password123', memberId, chapterId });
    check('and is accepted once a member is named', r.status === 200 && r.data.item.memberId === memberId, r.data);
    // National Coordinators and Patrons belong to the union, not to a chapter,
    // so they remain the exception rather than being forced to hold a
    // membership somewhere.
    r = await call('admin', 'POST', '/api/admin/staff',
      { username: 'nat.two', name: 'National Two', role: 'nationalCoordinator', password: 'password123' });
    check('a National Coordinator is still allowed without one', r.status === 200, r.data);
  }

  console.log('\n== Alumni Connect: opt-in, union-wide, and shut to newcomers ==');
  {
    // The member is 'active' by this point in the suite.
    r = await call('member', 'GET', '/api/alumni');
    check('an active member may browse the directory', r.status === 200, r.data);
    // Asserted about this member rather than the total, so an alumnus listed
    // by an earlier test does not make this one lie.
    const listedMe = (d) => (d.items || []).some(i => i.name === 'Ama Test');
    check('and this member is not in it, having not opted in', !listedMe(r.data), r.data.items.map(i => i.name));

    // Listing yourself requires Shepherding to have marked you alumni. Claiming
    // it is not enough — otherwise anyone could put themselves in the directory.
    r = await call('member', 'PUT', '/api/member/alumni-profile',
      { listed: true, profession: 'Software Engineer', industry: 'Technology' });
    check('a member who is not alumni cannot list themselves', r.status === 403, r.data);

    r = await call('shep', 'PATCH', `/api/shepherd/members/${memberId}/stage`, { stage: 'alumni' });
    check('shepherding marks them alumni', r.status === 200, r.data);

    // Writing a profile is not the same as publishing it.
    r = await call('member', 'PUT', '/api/member/alumni-profile',
      { listed: false, profession: 'Software Engineer', organisation: 'Hubtel', industry: 'Technology', graduationYear: '2024', city: 'Accra' });
    check('an alumnus can save a listing without publishing it', r.status === 200 && r.data.item.listed === false, r.data);
    r = await call('member', 'GET', '/api/alumni');
    check('an unlisted profile does not appear to anyone', !listedMe(r.data), r.data.items.map(i => i.name));

    r = await call('member', 'PUT', '/api/member/alumni-profile',
      { listed: true, profession: 'Software Engineer', organisation: 'Hubtel', industry: 'Technology',
        graduationYear: '2024', city: 'Accra', openToMentoring: true, showEmail: true });
    check('publishing it puts them in the directory', r.status === 200 && r.data.item.listed === true, r.data);
    r = await call('member', 'GET', '/api/alumni');
    const mine = (r.data.items || []).find(i => i.name === 'Ama Test');
    check('and now they are findable', !!mine && mine.profession === 'Software Engineer', r.data.items.map(i => i.name));

    // Contact details are published only where the alumnus ticked the box.
    check('the email they chose to show is shown', !!mine.email, mine);
    check('the phone they did NOT choose to show is withheld', mine.phone === '', mine);

    r = await call('member', 'GET', '/api/alumni?industry=Technology');
    check('the industry filter finds them', listedMe(r.data), r.data.items.map(i => i.name));
    r = await call('member', 'GET', '/api/alumni?industry=Law');
    check('and excludes them from another industry', !listedMe(r.data), r.data.items.map(i => i.name));
    r = await call('member', 'GET', '/api/alumni?q=hubtel');
    check('search matches where they work', r.data.count === 1 && listedMe(r.data), r.data.items.map(i => i.name));
    r = await call('member', 'GET', '/api/alumni?mentoring=1');
    check('and "open to mentoring" can be filtered on', listedMe(r.data), r.data.items.map(i => i.name));

    // Listing yourself must not be a way to publish something you cannot name.
    r = await call('member', 'PUT', '/api/member/alumni-profile', { listed: true, profession: '' });
    check('you cannot publish a listing with no profession on it', r.status === 400, r.data);

    // A brand-new visitor is exactly who this directory is closed to.
    const newbieForm = new FormData();
    newbieForm.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'n.png');
    newbieForm.append('name', 'Kojo Newcomer');
    newbieForm.append('email', 'kojo.newcomer@test.com');
    newbieForm.append('password', 'secret123');
    newbieForm.append('chapterId', chapterId);
    await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: newbieForm })).json();
    r = await call('newbie', 'POST', '/api/auth/login', { email: 'kojo.newcomer@test.com', password: 'secret123' });
    check('a brand-new visitor can sign in', r.status === 200, r.data);
    r = await call('newbie', 'GET', '/api/alumni');
    check('but cannot browse alumni names, jobs and employers', r.status === 403, r.data);
    r = await call('anon', 'GET', '/api/alumni');
    check('and neither can someone signed out', r.status === 401, r.data);

    // Union-wide by design — but a chapter can still take down its own.
    r = await call('coord2', 'DELETE', `/api/admin/alumni/${(await call('member','GET','/api/member/alumni-profile')).data.profile.id}`);
    check("another chapter's admin cannot unlist this chapter's alumnus", r.status === 404, r.data);
  }

  {
    const fs = require('fs');
    const path = require('path');
    const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
    const page = await fetch(BASE + '/alumni.html');
    check('the Alumni Connect page is served', page.status === 200, page.status);
    check('and is reachable from the app, not just by typing the URL',
      pub('more.html').includes('/alumni.html') && pub('discover.html').includes('/alumni.html')
      && pub('js/main.js').includes('/alumni.html'));
    check('and opens offline like the other member pages', pub('sw.js').includes("'/alumni.html'"));
    // The directory is the first thing here visible across chapters, so the
    // policy has to say so rather than keep promising it never happens.
    const policy = pub('privacy.html');
    check('the privacy policy documents the cross-chapter directory',
      /Alumni Connect/.test(policy) && /visible across chapters/i.test(policy));
    check('and says plainly that it is off until switched on',
      /off unless you turn it on/i.test(policy));
    check('and that contact details are shown only on request',
      /not published just because we hold them/i.test(policy));
  }

  console.log('\n== the handover: Shepherding marks an executive, the Coordinator opens the account ==');
  {
    // Shepherding can label someone an Executive; only the Coordinator can
    // give them a portal. Nothing used to carry that between the two offices,
    // so a member sat marked as an executive with no account and no page.
    const waitingId = await registerMember('Nana Awaiting', 'nana.awaiting@test.com');

    let r2 = await call('coord', 'GET', '/api/coordinator/pending-executives');
    check('nobody is waiting for an account before anyone is marked',
      r2.status === 200 && !r2.data.some(w => w.id === waitingId), r2.data);

    r2 = await call('shep', 'PATCH', `/api/shepherd/members/${waitingId}/stage`, { stage: 'executive', shepherdName: 'Sister Grace' });
    check('Shepherding marks the member an Executive', r2.status === 200 && r2.data.item.membershipStage === 'executive', r2.data);

    r2 = await call('coord', 'GET', '/api/coordinator/pending-executives');
    const waiting = r2.data.find(w => w.id === waitingId);
    check('and the Coordinator is shown that they are waiting for an account', !!waiting, r2.data);
    check('with the shepherd who marked them, so the Coordinator knows who to ask',
      !!waiting && waiting.shepherdName === 'Sister Grace', waiting);

    // The notifications feed is chapter-wide: a row there would announce to
    // every member which of them had just been made an executive.
    r2 = await call('anon', 'GET', '/api/notifications');
    check('and the whole chapter is not told about it',
      !r2.data.some(n => /Nana Awaiting/.test(`${n.title} ${n.body}`)), r2.data.slice(0, 3));

    r2 = await call('coord', 'GET', '/api/coordinator/overview');
    check('the dashboard counts them too', r2.data.awaitingAppointment >= 1, r2.data.awaitingAppointment);

    // Appointing them is what clears it — nothing has to remember to.
    r2 = await call('coord', 'POST', '/api/admin/staff', {
      username: 'exec.awaiting', name: 'Nana Awaiting', role: 'executive',
      password: 'password123', memberId: waitingId, positionKey: 'general_secretary'
    });
    check('the Coordinator appoints them', r2.status === 200, r2.data);

    r2 = await call('coord', 'GET', '/api/coordinator/pending-executives');
    check('and they stop waiting, because the account is the thing that was missing',
      !r2.data.some(w => w.id === waitingId), r2.data);

    // A member marked an executive in another chapter is that chapter's
    // business, not this one's.
    const otherId = (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: (() => {
      const fd = new FormData();
      fd.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
      fd.append('name', 'Other Chapter Exec'); fd.append('email', 'other.exec@test.com');
      fd.append('password', 'secret123'); fd.append('chapterId', 'test-chapter-2');
      return fd;
    })() })).json()).member.id;
    await call('admin', 'PATCH', `/api/shepherd/members/${otherId}/stage`, { stage: 'executive' }, false, { 'X-Chapter-Id': 'test-chapter-2' });
    r2 = await call('coord', 'GET', '/api/coordinator/pending-executives');
    check('another chapter\'s waiting executive is not in this chapter\'s list',
      !r2.data.some(w => w.id === otherId), r2.data);

    r2 = await call('pub', 'GET', '/api/coordinator/pending-executives');
    check('and it is not open to every office', r2.status === 401, r2.status);
  }

  console.log('\n== appointing a leader asks for the member the server requires ==');
  {
    const fs = require('fs');
    const path = require('path');
    const js = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8');

    // The server has always required a member for every chapter office. The
    // Coordinator's form only asked when appointing an executive, so every
    // other appointment was refused with nothing on screen to explain it.
    const coord = js('coordinator.js');
    check('the Coordinator form sends the member for any office, not only an executive',
      /payload\.memberId = memberSelect \? memberSelect\.value : '';/.test(coord)
      && !/if \(roleSelect\.value === 'executive'\) \{\s*payload\.memberId/.test(coord), null);
    check('and it no longer hides the member picker behind the executive branch',
      !/memberWrap\.hidden = !isExecutive/.test(coord), null);
    check('while the position picker stays an executive-only question',
      /positionWrap\.hidden = !isExecutive/.test(coord), null);

    // The admin portal had no member picker at all, so it could not create a
    // Finance, Shepherding, Publicity or Welfare account either.
    const adm = js('admin.js');
    check('the admin form knows which roles are held by a member',
      /const MEMBER_BACKED_STAFF_ROLES = \[/.test(adm)
      && /'finance', 'shepherding', 'publicity', 'welfare'/.test(adm), null);
    check('and sends the member it asked for',
      /payload\.memberId = memberSelect\.value;/.test(adm), null);
    check('and reloads the roster when the chapter changes, so the two agree',
      /chapterSelect\.addEventListener\('change', loadMembersForChapter\)/.test(adm), null);

    // The real proof: the exact payload each form now sends is accepted.
    const finMemberId = await registerMember('Kwesi Books', 'kwesi.books@test.com');
    let r2 = await call('coord', 'POST', '/api/admin/staff',
      { username: 'fin.kwesi', name: 'Kwesi Books', role: 'finance', password: 'password123', memberId: finMemberId });
    check('a Finance Officer can be appointed the way the form appoints one', r2.status === 200, r2.data);

    r2 = await call('coord', 'POST', '/api/admin/staff',
      { username: 'fin.nobody', name: 'Nobody', role: 'finance', password: 'password123' });
    check('and one with no member behind it is still refused',
      r2.status === 400 && /member/i.test(r2.data.error), r2.data);
  }

  console.log('\n== the welfare purse: its own account, answerable to the chapter ==');
  {
    const money = (fields, withReceipt) => {
      const fd = new FormData();
      Object.entries(fields).forEach(([k, v]) => fd.append(k, String(v)));
      fd.append('chapterId', chapterId);
      if (withReceipt) fd.append('receipt', new Blob([Buffer.from('receipt')], { type: 'image/png' }), 'r.png');
      return fd;
    };

    r = await call('welf', 'POST', '/api/welfare/ledger',
      money({ entryType: 'income', category: 'tithe', amount: 200, date: '2026-09-06', method: 'momo', reference: 'MM-1' }, false), true);
    check('welfare records tithe collected into its own account', r.status === 200 && r.data.item.amount === 200, r.data);

    r = await call('welf', 'POST', '/api/welfare/ledger',
      money({ entryType: 'income', category: 'semester_dues', amount: 50, memberId: welfMemberId, term: '2026/27 Sem 1' }, false), true);
    check('and semester dues against the member who paid them',
      r.status === 200 && r.data.item.memberName === 'Efua Welfare' && r.data.item.term === '2026/27 Sem 1', r.data);

    // Money going out is the half that needs evidence.
    r = await call('welf', 'POST', '/api/welfare/ledger',
      money({ entryType: 'expense', category: 'medical', amount: 80, payee: 'Clinic' }, false), true);
    check('an expense with no evidence is refused', r.status === 400 && /evidence/i.test(r.data.error), r.data);

    r = await call('welf', 'POST', '/api/welfare/ledger',
      money({ entryType: 'expense', category: 'medical', amount: 80, payee: 'Clinic' }, true), true);
    check('and is recorded once the receipt is attached', r.status === 200 && !!r.data.item.receiptFileId, r.data);

    r = await call('welf', 'POST', '/api/welfare/ledger',
      money({ entryType: 'income', category: 'harvest', amount: 10 }, false), true);
    check('a category the purse does not keep is refused', r.status === 400, r.data);

    r = await call('welf', 'GET', '/api/welfare/ledger');
    check('the book adds up', r.status === 200 && r.data.totals.income === 250 && r.data.totals.expense === 80
      && r.data.totals.balance === 170, r.data.totals);
    check('and separates what each kind of income brought in',
      r.data.totals.byCategory.tithe === 200 && r.data.totals.byCategory.semester_dues === 50, r.data.totals.byCategory);

    // The whole point of the arrangement: the people it answers to can read it.
    r = await call('coord', 'GET', '/api/welfare/report');
    check('the Coordinator can read the welfare report', r.status === 200 && r.data.totals.balance === 170, r.data.totals);
    r = await call('bible', 'GET', '/api/welfare/report');
    check('and so can the executive body, not only the desk that keeps it', r.status === 200, r.data);
    r = await call('member', 'GET', '/api/welfare/report');
    check('while an ordinary member cannot', r.status === 401, r.status);

    // The body is owed the figures, not a list of who needed help.
    const report = (await call('coord', 'GET', '/api/welfare/report')).data;
    const reportRows = Array.isArray(report.entries) ? report.entries : [];
    check('the report carries the movements without naming who paid or was helped',
      reportRows.length > 0 && reportRows.every(e => !('memberName' in e) && !('memberId' in e)), reportRows[0]);
    check('though it does say which movements have evidence behind them',
      reportRows.some(e => e.hasEvidence === true), reportRows[0]);

    r = await call('coord', 'GET', '/api/coordinator/overview');
    check('and the figures reach the Coordinator\'s dashboard on their own',
      r.data.welfare && r.data.welfare.balance === 170, r.data.welfare);

    // A separate account is a separate book: these rows are not the treasury's.
    r = await call('fin', 'GET', '/api/finance/summary');
    const financeTotal = r.data.totalIncome || 0;
    r = await call('welf', 'POST', '/api/welfare/ledger', money({ entryType: 'income', category: 'tithe', amount: 999 }, false), true);
    check('recording in the purse does not move the chapter ledger', r.status === 200, r.data);
    r = await call('fin', 'GET', '/api/finance/summary');
    check('the treasury total is unchanged, because that money was never in it',
      (r.data.totalIncome || 0) === financeTotal, { before: financeTotal, after: r.data.totalIncome });

    r = await call('welf', 'GET', '/api/welfare/ledger');
    const strayId = r.data.entries[0].id;
    r = await call('fin', 'GET', '/api/welfare/ledger');
    check('and Finance is not the welfare desk either', r.status === 401, r.status);

    r = await call('welf', 'DELETE', `/api/welfare/ledger/${strayId}`);
    check('a mistaken entry can be taken back out', r.status === 200, r.data);
    r = await call('welf', 'GET', '/api/welfare/ledger');
    check('and the balance follows it', r.data.totals.balance === 170, r.data.totals);

    // Welfare holds its own account, so members are told its number, not the
    // chapter's — sending dues to the wrong MoMo is a real way to lose money.
    r = await call('admin', 'PUT', '/api/admin/chapter-settings', {
      chapterId, payment: { welfareMomoNumber: '0244000111', welfareMomoName: 'ACONSU Welfare' }
    });
    check('a chapter can set the welfare account details', r.status === 200, r.data);
    r = await call('anon', 'GET', '/api/settings', null, false, { 'X-Chapter-Id': chapterId });
    check('and members are shown them',
      r.data.payment.welfareMomoNumber === '0244000111' && r.data.payment.welfareMomoName === 'ACONSU Welfare', r.data.payment);
  }

  console.log('\n== the app shell: a rail on wide screens, tabs on a phone ==');
  {
    const fs = require('fs');
    const path = require('path');
    const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
    const main = pub('js/main.js');
    const css = pub('css/style.css');

    check('every page gets the rail, because every page goes through initLayout',
      /renderSideNav\(activePath, customPages, member\);/.test(main), null);

    // A rail is a promise that everything in it is reachable. A link to a page
    // that does not exist is a 404 the person only finds by trusting the menu.
    const hrefs = [...main.matchAll(/href: '(\/[^']+)'/g)].map((m) => m[1]);
    const railLinks = hrefs.filter((h) => h.endsWith('.html') || h.includes('.html?'));
    const missing = [...new Set(railLinks)]
      .map((h) => h.split('?')[0])
      .filter((h) => !fs.existsSync(path.join(__dirname, '..', 'public', h)));
    check('and every link in it points at a page that exists', !missing.length, missing);
    check('with enough of them to be worth a rail', railLinks.length >= 12, railLinks.length);

    // Three tiers. The phone must not inherit the desktop shell.
    check('the rail is hidden until there is room for it',
      /\.side-nav \{ display: none; \}/.test(css) && /@media \(min-width: 1024px\)/.test(css), null);
    check('and where it shows, the top bar stops repeating the same links',
      /@media \(min-width: 1024px\)[\s\S]{0,3000}?\.nav-links \{ display: none !important; \}/.test(css), null);
    check('the bottom tabs stay the phone\'s navigation',
      /@media \(min-width: 861px\) \{ \.bottom-nav \{ display: none; \} \}/.test(css), null);

    // The same shape of bug as the floating verse bar: a rule written for a
    // full-width section, reused inside a narrow column.
    check('the quick-access tiles do not keep six columns inside a dashboard card',
      /\.dash-quick \.tile-grid \{[^}]*repeat\(3, 1fr\)/.test(css), null);

    check('the home dashboard leads with what is happening next',
      /\.dash-events \{ order: 1; \}/.test(css) && /\.dash-verse  \{ order: 3; \}/.test(css), null);
  }

  console.log('\n== notifications, in the app rather than on another page ==');
  {
    const fs = require('fs');
    const path = require('path');
    const main = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'main.js'), 'utf8');

    check('the bell is still a real link to the full history',
      /href="\/notifications\.html" class="bell-link"/.test(main), null);
    check('and a modified click is left alone, so it can still open in a tab',
      /if \(e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| e\.button !== 0\) return;/.test(main), null);
    check('opening the panel is what marks them seen',
      /markNotificationsSeen\(\);[\s\S]{0,120}notif-count/.test(main), null);
    check('the unread count is shown as a number, not only a dot',
      /badge\.textContent = count > 9 \? '9\+' : String\(count\);/.test(main), null);

    // timeAgo is a pure function, so it can be run rather than read.
    const fn = main.match(/function timeAgo\(iso\)[\s\S]*?\n\}/)[0];
    const timeAgo = new Function(`${fn}; return timeAgo;`)();
    const ago = (secs) => timeAgo(new Date(Date.now() - secs * 1000).toISOString());
    check('a notice from seconds ago reads as just now', ago(5) === 'just now', ago(5));
    check('minutes and hours read as themselves', ago(600) === '10m ago' && ago(7200) === '2h ago', [ago(600), ago(7200)]);
    check('and a day old reads in days', ago(86400 * 2) === '2d ago', ago(86400 * 2));
    // A behaviour check, not a guard: a timestamp ahead of this device's clock
    // falls through to 'just now' because of the branch order, with or without
    // the clamp in front of it. Worth asserting that it stays true; not worth
    // claiming it proves the clamp does something.
    check('a timestamp ahead of the device clock still reads sensibly',
      timeAgo(new Date(Date.now() + 40000).toISOString()) === 'just now',
      timeAgo(new Date(Date.now() + 40000).toISOString()));
    check('and nonsense in gives nothing out, not "NaN ago"', timeAgo('not-a-date') === '', timeAgo('not-a-date'));
  }

  console.log('\n== opening the app, and one class name that belonged to two things ==');
  {
    const fs = require('fs');
    const path = require('path');
    const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
    const css = pub('css/style.css');
    const home = pub('index.html');
    const bible = pub('bible.html');

    // The regression this guards: the Bible page's floating action bar was
    // added as `.verse-actions`, a class the home page had been using since
    // long before for the row inside its Verse of the Day card. The shared
    // stylesheet then pinned that row to the bottom of the screen, where it
    // floated over the quick-access tiles on every scroll.
    check('the shared stylesheet leaves .verse-actions to the page that owns it',
      !/^\.verse-actions[\s{,]/m.test(css), (css.match(/^\.verse-actions.*/m) || [])[0]);
    check('and the home page still styles its own row',
      /\.verse-actions\s*\{[^}]*display:\s*flex/.test(home), null);
    check('while the Bible page\'s floating bar has a name of its own',
      /class="verse-action-bar"/.test(bible) && !/class="verse-actions"/.test(bible), null);
    check('which the stylesheet is what pins to the screen',
      /\.verse-action-bar\s*\{[^}]*position:\s*fixed/.test(css), null);
    check('and the Bible page dismisses it by that same name',
      /closest\('\.verse-action-bar'\)/.test(bible), null);

    // The splash colour is not a taste: it is the icon's own background, which
    // is what makes the mark sit on the screen rather than on a tile.
    const manifest = JSON.parse(pub('manifest.json'));
    const sharp = require('sharp');
    const icon = await sharp(path.join(__dirname, '..', 'public', 'icons', 'icon-maskable-512.png'))
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const corner = [icon.data[0], icon.data[1], icon.data[2]];
    const cornerHex = '#' + corner.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    check('the splash background is the icon artwork\'s own ground colour',
      manifest.background_color.toUpperCase() === cornerHex, { manifest: manifest.background_color, icon: cornerHex });

    // A splash that only script can dismiss is a splash that a failed script
    // leaves you staring at.
    check('the opening screen removes itself in CSS, not in script',
      /animation:\s*splashOut[^;]*forwards/.test(home) && /@keyframes splashOut/.test(home), null);
    check('and is painted before the stylesheet is even asked for',
      home.indexOf('#appSplash') < home.indexOf('css/style.css'), null);
    check('the mark it shows has had its white backing removed',
      /logo-splash\.png/.test(home) && fs.existsSync(path.join(__dirname, '..', 'public', 'icons', 'logo-splash.png')), null);
    check('and is cached, being the first thing anyone sees',
      /logo-splash\.png/.test(pub('sw.js')), null);
  }

  console.log('\n== hero art: every page wears something, and a chapter can dress it ==');
  {
    const fs = require('fs');
    const path = require('path');
    const catalogue = require('../lib/heroArt.js');

    // The scene is drawn by CSS from an attribute in the page's own HTML, so
    // it is on screen before any request returns. That only holds while the
    // catalogue and the pages agree — which is what these check.
    let dressed = 0;
    let mismatched = [];
    for (const page of catalogue.HERO_PAGES) {
      const file = path.join(__dirname, '..', 'public', page.path);
      if (!fs.existsSync(file)) { mismatched.push(`${page.key}: no such page`); continue; }
      const html = fs.readFileSync(file, 'utf8');
      const hero = html.match(/<section class="hero[^"]*"[^>]*>/);
      if (!hero) { mismatched.push(`${page.key}: no hero`); continue; }
      if (!hero[0].includes(`data-hero-page="${page.key}"`)) { mismatched.push(`${page.key}: wrong key`); continue; }
      if (!hero[0].includes(`data-art="${page.scene}"`)) { mismatched.push(`${page.key}: wrong scene`); continue; }
      dressed++;
    }
    check('every page in the catalogue carries its own scene and key',
      dressed === catalogue.HERO_PAGES.length && !mismatched.length, mismatched.slice(0, 4));
    check('and that is more than a couple of pages', dressed >= 20, dressed);

    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'style.css'), 'utf8');
    const missingScene = [...new Set(catalogue.HERO_PAGES.map(p => p.scene))]
      .filter(scene => !css.includes(`.hero[data-art="${scene}"]`));
    check('and every scene a page asks for is actually drawn', !missingScene.length, missingScene);

    // Nothing is uploaded yet, so the pages are wearing their built-in scenes.
    r = await call('anon', 'GET', '/api/settings', null, false, { 'X-Chapter-Id': chapterId });
    check('a chapter that has uploaded nothing reports no artwork',
      r.status === 200 && r.data.heroArt && Object.keys(r.data.heroArt).length === 0, r.data.heroArt);

    const artwork = (page, tone) => {
      const fd = new FormData();
      fd.append('file', new Blob([Buffer.from('\x89PNG art')], { type: 'image/png' }), 'art.png');
      fd.append('placement', 'page-hero');
      fd.append('targetId', page);
      fd.append('chapterId', chapterId); // as the admin form does, since FormData carries no scope header
      if (tone) fd.append('tone', tone);
      return fd;
    };

    r = await call('admin', 'POST', '/api/admin/uploads', artwork('give', 'dark'), true);
    check('a chapter uploads artwork for one page', r.status === 200 && /Give/.test(r.data.placedOn || ''), r.data);

    r = await call('anon', 'GET', '/api/settings', null, false, { 'X-Chapter-Id': chapterId });
    check('and the page that was dressed now carries it',
      !!(r.data.heroArt.give && r.data.heroArt.give.fileId), r.data.heroArt);
    check('with the tone it was uploaded as, which is what keeps the heading readable',
      r.data.heroArt.give.tone === 'dark', r.data.heroArt.give);
    check('while every other page is left on its built-in scene',
      Object.keys(r.data.heroArt).length === 1, r.data.heroArt);

    // Anything that is not a page of this app never reaches the record.
    r = await call('admin', 'POST', '/api/admin/uploads', artwork('not-a-page', 'dark'), true);
    check('artwork for a page that does not exist is refused', r.status === 400, r.data);

    r = await call('admin', 'POST', '/api/admin/uploads', artwork('prayer', 'chartreuse'), true);
    check('an unrecognised tone is read as light rather than stored as given', r.status === 200, r.data);
    r = await call('anon', 'GET', '/api/settings', null, false, { 'X-Chapter-Id': chapterId });
    check('and comes back as light', r.data.heroArt.prayer.tone === 'light', r.data.heroArt.prayer);

    // Taking artwork off returns the page to its scene, not to nothing.
    r = await call('admin', 'DELETE', `/api/admin/hero-art/prayer?chapterId=${chapterId}`);
    check('artwork can be taken back off a page', r.status === 200, r.data);
    r = await call('anon', 'GET', '/api/settings', null, false, { 'X-Chapter-Id': chapterId });
    check('and the page falls back to its built-in scene',
      !r.data.heroArt.prayer && !!r.data.heroArt.give, r.data.heroArt);

    r = await call('pub', 'GET', '/api/admin/image-placements');
    check('the picker offers every page as somewhere artwork can go',
      r.status === 200 && (r.data.heroPages || []).length === catalogue.HERO_PAGES.length,
      (r.data.heroPages || []).length);
    check('and says which scene each page is wearing now',
      (r.data.heroPages || []).every(p => p.scene && typeof p.sceneDescription === 'string'), (r.data.heroPages || [])[0]);
  }

  console.log('\n== a verse card is no longer one purple rectangle ==');
  {
    r = await call('anon', 'GET', '/api/verse-styles');
    check('the card backgrounds are listed', r.status === 200 && r.data.styles.length >= 5, r.data);
    check('each one can be shown without downloading a card',
      r.data.styles.every(st => st.value && st.label && /gradient\(/.test(st.swatch || '')), r.data.styles[0]);
    check('and one of them is the default', r.data.styles.some(st => st.value === r.data.defaultStyle), r.data.defaultStyle);

    const png = async (query) => {
      const res = await fetch(BASE + '/api/verse-image?' + query);
      return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
    };
    const verse = 'verse=' + encodeURIComponent('The Lord is my shepherd') + '&reference=' + encodeURIComponent('Psalm 23:1');
    const plain = await png(verse);
    const night = await png(verse + '&style=night');
    const parchment = await png(verse + '&style=parchment');
    check('asking for a different background gives a different card',
      !plain.buf.equals(night.buf), { plain: plain.buf.length, night: night.buf.length });
    check('and so does a third', !night.buf.equals(parchment.buf) && !plain.buf.equals(parchment.buf), parchment.buf.length);

    // A link someone shared last term should still produce a card.
    const nonsense = await png(verse + '&style=not-a-style');
    check('an unknown background falls back to the default rather than failing',
      nonsense.status === 200 && nonsense.buf.equals(plain.buf), nonsense.status);
  }

  console.log('\n== the Bible reader: more versions, and one the app may not serve ==');
  {
    r = await call('anon', 'GET', '/api/bible/books');
    check('the reader offers more than the five versions it started with',
      r.status === 200 && r.data.translations.length > 5, r.data && r.data.translations && r.data.translations.length);
    check('every version says what language it is in',
      r.data.translations.every(t => t.code && t.label && typeof t.language === 'string'), r.data.translations[0]);
    check('the KJV leads the list, since it is the default',
      r.data.translations[0].code === 'kjv', r.data.translations[0]);
    const codes = r.data.translations.map(t => t.code);
    check('the versions it already had are all still there',
      ['kjv', 'web', 'webbe', 'oeb-us', 'clementine'].every(c => codes.includes(c)), codes);

    // NASB 2020 is the version the church approved, and it is copyrighted.
    // The app must offer it as a way to reach it, never as text it serves.
    const external = r.data.externalVersions || [];
    const nasb = external.find(v => v.code === 'nasb2020');
    check('NASB 2020 is offered as a version', !!nasb, external);
    check('and is not in the list the app serves text from',
      !codes.includes('nasb2020'), codes);
    check('and says openly why it opens elsewhere',
      !!nasb && /copyright/i.test(nasb.note), nasb);
    check('and names its publisher', !!nasb && /Lockman/i.test(nasb.publisher || ''), nasb);
    check('and carries a link the reader fills in with the passage',
      !!nasb && nasb.urlTemplate.includes('{reference}'), nasb);

    r = await call('anon', 'GET', '/api/bible/passage?book=John&chapter=3&translation=nasb2020');
    check('asking the server for it is answered with where to read it, not with text',
      r.status === 409 && r.data.externalVersion && !r.data.verses, r.data);
    check('and the link it gives points at the passage that was asked for',
      r.status === 409 && /John%203/.test(r.data.externalVersion.url), r.data.externalVersion);
  }

  console.log('\n== sharing a verse as an image: the verse has to be on it ==');
  {
    // The bug this covers: the card used to be laid out with <foreignObject>,
    // which the renderer ignores. Every share was the background and nothing
    // else — so two different verses produced byte-identical files.
    const png = async (query) => {
      const res = await fetch(BASE + '/api/verse-image?' + query);
      return { status: res.status, type: res.headers.get('content-type'), buf: Buffer.from(await res.arrayBuffer()) };
    };
    // Held against the *same* reference on purpose: if only the reference
    // rendered, two different verses would still differ, and this check would
    // pass while the card was blank where the scripture belongs.
    const psalm = await png('verse=' + encodeURIComponent('The Lord is my shepherd') + '&reference=' + encodeURIComponent('Psalm 23:1'));
    const otherVerse = await png('verse=' + encodeURIComponent('For God so loved the world') + '&reference=' + encodeURIComponent('Psalm 23:1'));
    const otherRef = await png('verse=' + encodeURIComponent('The Lord is my shepherd') + '&reference=' + encodeURIComponent('John 3:16'));
    check('the share image is a PNG', psalm.status === 200 && psalm.type === 'image/png', psalm.status);
    check('the scripture itself is on the card, not just the background',
      !psalm.buf.equals(otherVerse.buf), { psalm: psalm.buf.length, other: otherVerse.buf.length });
    check('and so is the reference',
      !psalm.buf.equals(otherRef.buf), { psalm: psalm.buf.length, other: otherRef.buf.length });

    // Both conventions in this app put the reference at opposite ends: the
    // Coordinator's daily verse trails it, the Verse of the Week leads with
    // it. Whichever way it arrives, the same card has to come out.
    const trailing = await png('verse=' + encodeURIComponent('"The Lord is my shepherd" — Psalm 23:1'));
    const leading = await png('verse=' + encodeURIComponent('Psalm 23:1 — The Lord is my shepherd'));
    check('a verse with the reference at the end is split the same way',
      trailing.buf.equals(psalm.buf), { trailing: trailing.buf.length, expected: psalm.buf.length });
    check('and so is one that leads with the reference',
      leading.buf.equals(psalm.buf), { leading: leading.buf.length, expected: psalm.buf.length });

    const noRef = await png('verse=' + encodeURIComponent('Be still, and know that I am God'));
    check('a verse with no reference at all still renders', noRef.status === 200, noRef.status);
  }

  console.log('\n== the two admin portals are one portal ==');
  {
    const fs = require('fs');
    const path = require('path');
    const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
    const chapterHtml = pub('chapter.html');
    const adminHtml = pub('admin.html');

    // /admin.html and /chapter.html render the SAME markup from js/admin.js.
    // They each used to carry their own inline copy of its styles, the copies
    // drifted, and the Chapter Admin's dashboard lost its KPI cards and its
    // activity-stream button to rules that only existed on the other page.
    for (const [name, html] of [['chapter.html', chapterHtml], ['admin.html', adminHtml]]) {
      check(`${name} takes the admin shell styles from the shared stylesheet`,
        html.includes('/css/admin.css'));
      check(`${name} keeps no private inline copy of them`, !/<style>/.test(html));
    }

    // js/admin.js calls these unconditionally; each bails silently when its
    // markup is absent, which is exactly how chapter.html lost the command
    // palette and the mobile drawer without anything appearing to break.
    for (const id of ['cmdPaletteBackdrop', 'cmdInput', 'cmdList', 'cmdPaletteBtn',
                      'mobileNavBtn', 'adminSideBackdrop', 'adminChapterBadge', 'adminNav']) {
      check(`chapter.html has #${id}, which admin.js drives`, chapterHtml.includes(`id="${id}"`));
    }
    check('chapter.html groups its nav rather than listing 20 flat buttons',
      (chapterHtml.match(/class="nav-group /g) || []).length >= 5);
    check('and every nav button names a panel that exists on the page',
      [...chapterHtml.matchAll(/data-panel="([a-zA-Z]+)"/g)]
        .every(m => chapterHtml.includes(`id="panel-${m[1]}"`)),
      [...chapterHtml.matchAll(/data-panel="([a-zA-Z]+)"/g)].map(m => m[1]));

    // Global Settings writes site-wide config behind requireNational. The
    // chapter portal used to offer it as "Site Settings", so a Chapter Admin
    // could fill the form in and only discover on save that it was never
    // theirs. Chapter Site Settings is the one that is.
    check('chapter.html offers Chapter Site Settings, not the national one',
      chapterHtml.includes('data-panel="chapterSettings"') && !chapterHtml.includes('data-panel="settings"'));
    check('and does not link the National Portal', !chapterHtml.includes('national.html'));

    // Internal names leaking onto buttons a Chapter Admin reads.
    check('no development phase number is used as a nav label', !/Phase \d/.test(chapterHtml));
    const adminJs = pub('js/admin.js');
    check('panels are offered by their human name, not their internal key',
      adminJs.includes('panelLabel(item.panel)') && adminJs.includes('panelLabel(kpi.drilldownPanel)'));
    check('and the dashboard does not show internal design jargon',
      !/Rule of 4/.test(adminJs));
    check('the activity-stream button is styled rather than a bare browser button',
      /data-activity-panel[\s\S]{0,40}class="btn|class="btn[^"]*"[^>]*data-activity-panel/.test(adminJs));
    // Confidential exports are filtered client-side to match the server guard.
    check('confidential exports are only offered to accounts the server lets through',
      adminJs.includes('seesConfidential') && adminJs.includes("ADMIN_SCOPE.role === 'coordinator'"));
  }

  console.log('\n== shared scripts only touch elements their pages actually have ==');
  const pageHtml = {};
  for (const page of ['/admin.html', '/chapter.html', '/executive.html', '/coordinator.html']) {
    pageHtml[page] = await (await fetch(BASE + page)).text();
  }
  for (const page of ['/admin.html', '/chapter.html']) {
    for (const id of ['loginForm', 'loginBtn', 'loginMsg', 'loginWrap', 'adminShell', 'logoutBtn']) {
      check(`${page} has #${id}, which admin.js drives`, pageHtml[page].includes(`id="${id}"`));
    }
  }
  // Scripts loaded into the same page share ONE global scope, so a top-level
  // `const` in one file collides with a `function` of the same name in
  // another — and a collision is a SyntaxError that kills the whole file, so
  // the portal renders nothing at all. node --check passes each file happily
  // on its own, which is exactly why this has to be checked in combination.
  // (Caught for real: executive.js declared `const money` while portal.js
  // already had `function money`, and the executive portal went blank.)
  {
    const vm = require('vm');
    const fs = require('fs');
    const path = require('path');
    const bundles = {
      'executive.html': ['main.js', 'portal.js', 'executive.js'],
      'coordinator.html': ['main.js', 'portal.js', 'coordinator.js'],
      'admin.html': ['main.js', 'admin.js']
    };
    for (const [page, files] of Object.entries(bundles)) {
      const combined = files
        .map(f => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8'))
        .join('\n;\n');
      let error = '';
      try { new vm.Script(combined); } catch (e) { error = e.message; }
      check(`${page}'s scripts declare no clashing globals`, error === '', error);
    }
  }

  // The chapter name in the header is the portal's identity, so the element it
  // is written into has to exist on every portal that has a chapter.
  check('/chapter.html can show which chapter it belongs to', pageHtml['/chapter.html'].includes('id="adminBrandName"'));
  check('/executive.html can show which chapter it belongs to', pageHtml['/executive.html'].includes('id="portalBrandName"'));
  check('/coordinator.html can show which chapter it belongs to', pageHtml['/coordinator.html'].includes('id="portalBrandName"'));

  // council.html is built from the same shell, so it must satisfy the same
  // contract and its scripts must not clash in one global scope either.
  {
    const vm = require('vm');
    const fs = require('fs');
    const path = require('path');
    const combined = ['main.js', 'portal.js', 'council.js']
      .map(f => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8'))
      .join('\n;\n');
    let error = '';
    try { new vm.Script(combined); } catch (e) { error = e.message; }
    check("council.html's scripts declare no clashing globals", error === '', error);
  }

  // The send loop only ticks once a minute, so this one is opt-in: run it with
  // SMOKE_SLOW=1 when the scheduling path itself is what changed.
  if (process.env.SMOKE_SLOW === '1') {
  console.log('\n== scheduler (waits for the 60s tick) ==');
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
