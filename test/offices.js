// The executive offices' working forms: semester outline, budget requests,
// minutes, Sunday announcements, committees, the alumni desk, and handing an
// office over. Boots the real app on the in-memory data layer, like smoke.js, and
// drives it over HTTP as the people who hold each office.
//
//   node test/offices.js     (also run by `npm test`)
const { fakeModels } = require('./harness.js');
{
  const realFetch = global.fetch;
  global.fetch = (url, opts) => {
    if (/\/api\/auth\/register$/.test(String(url)) && opts && opts.body instanceof FormData && !opts.body.has('consent')) opts.body.append('consent', 'true');
    return realFetch(url, opts);
  };
}

(async () => {
  process.env.MONGODB_URI = 'mongodb://stub/aconsu_offices';
  process.env.PORT = '4322';
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'admin123';
  process.env.SESSION_SECRET = 'test';
  process.env.LOGIN_RATE_LIMIT_MAX = '400';
  delete process.env.SHEPHERD_USERNAME;
  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));

  const BASE = 'http://127.0.0.1:4322';
  let failures = 0;
  const jars = {};
  async function call(jar, method, path, body, isForm) {
    const headers = {};
    if (jars[jar]) headers.cookie = jars[jar];
    let payload;
    if (body && !isForm) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); } else if (body) payload = body;
    const res = await fetch(BASE + path, { method, headers, body: payload });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (setCookie.length) jars[jar] = setCookie.map(c => c.split(';')[0]).join('; ');
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: res.status, data };
  }
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail ? ` — ${JSON.stringify(detail).slice(0, 400)}` : ''}`); }
  }
  const denied = (r) => r.status === 401 || r.status === 403;

  // ---------------------------------------------------------------- setup ----
  console.log('\n== setting the chapters and the people up ==');
  let r = await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  check('admin signs in', r.status === 200, r.data);
  const C1 = 'knust'; const C2 = 'ucc';
  await call('admin', 'POST', '/api/national/chapters', { id: C1, name: 'ACONSU-KNUST', institution: 'KNUST' });
  await call('admin', 'POST', '/api/national/chapters', { id: C2, name: 'ACONSU-UCC', institution: 'UCC' });

  const dept = {};
  for (const [key, name, chapterId] of [['choir', 'Choir', C1], ['welfare', 'Welfare', C1], ['media', 'Media', C1], ['otherChoir', 'Choir', C2]]) {
    r = await call('admin', 'POST', '/api/admin/departments', { name, chapterId });
    dept[key] = r.data.item && r.data.item.id;
  }
  check('departments exist in both chapters', Object.values(dept).every(Boolean), dept);

  let counter = 0;
  async function registerMember(name, chapterId) {
    counter += 1;
    const fd = new FormData();
    fd.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
    fd.append('name', name); fd.append('email', `person${counter}@test.com`);
    fd.append('password', 'secret123'); fd.append('chapterId', chapterId);
    const res = await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd })).json();
    return res.member.id;
  }
  const people = {};
  async function seat(jar, username, name, positionKey, { department, chapterId = C1, alumnus = false } = {}) {
    const memberId = await registerMember(name, chapterId);
    if (alumnus) fakeModels.Member._docs.find(m => m.id === memberId).membershipStage = 'alumni';
    const out = await call('admin', 'POST', '/api/admin/staff', {
      username, name, role: 'executive', password: 'password123', memberId, positionKey, chapterId, ...(department ? { department } : {})
    });
    if (out.status !== 200) return { out, memberId };
    await call(jar, 'POST', '/api/portal/login', { username, password: 'password123' });
    people[jar] = { memberId, staffId: out.data.item.id, username, name };
    return { out, memberId };
  }

  // The alumni seat refuses a member who is not an alumnus.
  let attempt = await seat('alumTry', 'exec.alumtry', 'Not Alumnus', 'alumni_president');
  check('the Alumni President seat refuses a member who is not an alumnus', attempt.out.status === 409 && /alumn/i.test(attempt.out.data.error), attempt.out.data);

  const made = {};
  for (const [jar, username, name, key, opts] of [
    ['pres', 'exec.pres', 'Yaw President', 'president', {}],
    ['vp', 'exec.vp', 'Efua Vice', 'vice_president', {}],
    ['gs', 'exec.gs', 'Abena Secretary', 'general_secretary', {}],
    ['ags', 'exec.ags', 'Akosua Assistant', 'assistant_general_secretary', {}],
    ['fs', 'exec.fs', 'Kojo FinSec', 'financial_secretary', {}],
    ['tr', 'exec.tr', 'Kwame Treasurer', 'treasurer', {}],
    ['alum', 'exec.alum', 'Nana Alumnus', 'alumni_president', { alumnus: true }],
    ['choir', 'exec.choir', 'Ama Choir', 'music_director', { department: dept.choir }],
    ['welfare', 'exec.welfare', 'Esi Welfare', 'welfare_head', { department: dept.welfare }],
    ['media', 'exec.media', 'Kofi Media', 'media_head', { department: dept.media }],
    ['pres2', 'exec.pres2', 'Other President', 'president', { chapterId: C2 }],
    ['gs2', 'exec.gs2', 'Other Secretary', 'general_secretary', { chapterId: C2 }],
    ['fs2', 'exec.fs2', 'Other FinSec', 'financial_secretary', { chapterId: C2 }]
  ]) {
    made[jar] = await seat(jar, username, name, key, opts);
  }
  check('every office is seated, each to a member of its own chapter', Object.values(made).every(m => m.out.status === 200), Object.entries(made).filter(([, m]) => m.out.status !== 200));

  // The Chapter Coordinators and a Finance office login.
  for (const [jar, username, chapterId] of [['coord', 'coord.one', C1], ['coord2', 'coord.two', C2], ['fin', 'fin.one', C1]]) {
    const memberId = await registerMember(username, chapterId);
    const out = await call('admin', 'POST', '/api/admin/staff', {
      username, name: username, role: jar === 'fin' ? 'finance' : 'coordinator', password: 'password123', memberId, chapterId
    });
    check(`${username} is created`, out.status === 200, out.data);
    await call(jar, 'POST', '/api/portal/login', { username, password: 'password123' });
  }
  const member = await registerMember('Plain Member', C1);
  void member;

  // ------------------------------------------------- what each office is --
  console.log('\n== each office holds the right tools ==');
  const caps = async (jar) => (await call(jar, 'GET', '/api/executive/me')).data.position.capabilities;
  const pc = await caps('pres'); const vc = await caps('vp'); const gc = await caps('gs'); const ac = await caps('ags');
  const fc = await caps('fs'); const tc = await caps('tr'); const lc = await caps('alum'); const hc = await caps('choir');
  check('the President writes the semester outline and follows what was resolved', pc.includes('outline.write') && pc.includes('followup'));
  check('the President does not take the minutes', !pc.includes('minutes.keep'));
  check('the Vice President records the finances', vc.includes('finance.ledger') && vc.includes('finance.summary'));
  check('the Vice President decides on budgets, runs committees and follows up', vc.includes('budget.decide') && vc.includes('committees') && vc.includes('followup'));
  check('the Vice President does not ask for budgets, that is Finance', !vc.includes('budget.call'));
  check('the General Secretary and the Assistant hold exactly the same tools', JSON.stringify(gc) === JSON.stringify(ac));
  check('the secretariat takes minutes and collects announcements', gc.includes('minutes.keep') && gc.includes('announce.collect'));
  check('the Financial Secretary asks departments for budgets', fc.includes('budget.call'));
  check('the Treasurer does not decide on budgets', !tc.includes('budget.decide') && !tc.includes('budget.call'));
  check('the Alumni President has the alumni desk and an outline of their own', lc.includes('alumni.body') && lc.includes('outline.write'));
  check('the Alumni President does not read the executive minutes', !lc.includes('minutes') && !lc.includes('minutes.keep'));
  check('a department head answers budget requests', hc.includes('budget.submit'));
  check('every executive reads the shared outline and minutes, and answers the announcement call',
    [vc, gc, fc, tc, hc, pc].every(c => c.includes('outline.read') && c.includes('minutes') && c.includes('announce.submit')));

  // Nothing is open to someone who is not signed in.
  const anonRoutes = [
    ['GET', '/api/executive/outline'], ['POST', '/api/executive/outline'], ['GET', '/api/executive/outline/shared'],
    ['GET', '/api/coordinator/outlines'], ['POST', '/api/coordinator/outlines/x/approve'],
    ['GET', '/api/budget/calls'], ['POST', '/api/budget/calls'], ['POST', '/api/budget/submissions/x/decide'],
    ['GET', '/api/executive/budget-requests'], ['PUT', '/api/executive/budget-requests/x'],
    ['GET', '/api/executive/minutes'], ['POST', '/api/executive/minutes'], ['POST', '/api/executive/minutes/x/approve'],
    ['GET', '/api/executive/announcement-calls'], ['POST', '/api/executive/announcement-calls'],
    ['GET', '/api/executive/announcement-requests'], ['GET', '/api/executive/committees'],
    ['GET', '/api/executive/followups'], ['GET', '/api/executive/alumni'],
    ['GET', '/api/coordinator/offices'], ['POST', '/api/coordinator/offices/handover'], ['GET', '/api/coordinator/minutes']
  ];
  const open = [];
  for (const [m, p] of anonRoutes) { const x = await call('anon', m, p, m === 'GET' ? undefined : {}); if (x.status !== 401) open.push(`${m} ${p} ${x.status}`); }
  check('none of the office routes answer a visitor who is not signed in', open.length === 0, open);

  // ------------------------------------------------------ semester outline --
  console.log('\n== the semester outline: President writes, Coordinator approves, everyone reads ==');
  r = await call('pres', 'GET', '/api/executive/outline');
  check('the President opens the outline form, with the chapter\'s departments to choose from',
    r.status === 200 && r.data.items.length === 0 && r.data.body === 'chapter' && r.data.departments.length === 3 && r.data.departments.every(d => d.id !== dept.otherChoir), r.data);
  for (const jar of ['vp', 'gs', 'choir', 'tr', 'alum']) {
    if (jar === 'alum') continue;
    r = await call(jar, 'POST', '/api/executive/outline', { title: 'Mine' });
    check(`${jar} cannot write the President's outline`, r.status === 403, r.data);
  }
  r = await call('pres', 'POST', '/api/executive/outline', { title: '' });
  check('an outline needs a title', r.status === 400, r.data);
  r = await call('pres', 'POST', '/api/executive/outline', { title: 'First semester', startDate: '2026-09-01', endDate: '2026-02-30' });
  check('a date that is not real is refused', r.status === 400, r.data);
  r = await call('pres', 'POST', '/api/executive/outline', { title: 'First semester', startDate: '2026-12-20', endDate: '2026-09-01' });
  check('a semester cannot end before it starts', r.status === 400, r.data);
  r = await call('pres', 'POST', '/api/executive/outline', { title: 'First semester', programmes: [{ title: 'Retreat', departmentId: dept.otherChoir }] });
  check('a programme cannot be given to another chapter\'s department', r.status === 400, r.data);
  r = await call('pres', 'POST', '/api/executive/outline', { title: 'First semester', programmes: [{ title: 'Retreat', departmentId: { $ne: null } }] });
  check('an injected operator in place of a department id is refused', r.status === 400, r.data);
  r = await call('pres', 'POST', '/api/executive/outline', { title: 'First semester', startDate: '2026-09-01', endDate: '2026-12-20', theme: 'Rooted' });
  check('a half-written outline saves as a draft', r.status === 200 && r.data.item.status === 'draft' && r.data.item.body === 'chapter', r.data);
  const outlineId = r.data.item.id;
  r = await call('pres', 'POST', '/api/executive/outline', { title: 'Another' });
  check('only one outline is in progress at a time', r.status === 409, r.data);
  r = await call('pres', 'POST', `/api/executive/outline/${outlineId}/submit`);
  check('it cannot go to the Coordinator until it is complete, and says what is missing', r.status === 400 && r.data.gaps.length >= 3, r.data);
  r = await call('pres', 'PUT', `/api/executive/outline/${outlineId}`, {
    title: 'First semester', semesterLabel: '2026/2027 first semester', startDate: '2026-09-01', endDate: '2026-12-20', theme: 'Rooted', scripture: 'Col 2:7',
    goals: ['Grow weekly attendance', 'Start a mentoring programme'],
    programmes: [
      { date: '2027-01-15', title: 'Out-of-term retreat', departmentId: dept.choir, estimatedCost: 500 },
      { date: '2026-10-10', title: 'Choir concert', kind: 'service', departmentId: dept.choir, estimatedCost: '1500.50' }, {}
    ]
  });
  check('the form saves, empty rows dropped, programmes put in date order, departments named',
    r.status === 200 && r.data.item.programmes.length === 2 && r.data.item.programmes[0].title === 'Choir concert' && r.data.item.programmes[0].departmentName === 'Choir' && r.data.item.version === 2, r.data);
  r = await call('pres', 'POST', `/api/executive/outline/${outlineId}/submit`);
  check('a programme dated outside the semester stops it being sent', r.status === 400 && /Out-of-term retreat/.test(r.data.error), r.data);
  r = await call('pres', 'PUT', `/api/executive/outline/${outlineId}`, {
    title: 'First semester', semesterLabel: '2026/2027 first semester', startDate: '2026-09-01', endDate: '2026-12-20', theme: 'Rooted',
    goals: ['Grow weekly attendance'], programmes: [{ date: '2026-10-10', title: 'Choir concert', departmentId: dept.choir, estimatedCost: 1500 }]
  });
  r = await call('pres', 'POST', `/api/executive/outline/${outlineId}/submit`);
  check('a complete outline goes to the Chapter Coordinator', r.status === 200 && r.data.item.status === 'submitted' && !!r.data.item.submittedAt, r.data);
  r = await call('pres', 'POST', `/api/executive/outline/${outlineId}/submit`);
  check('and cannot be sent twice', r.status === 409, r.data);
  r = await call('pres', 'PUT', `/api/executive/outline/${outlineId}`, { title: 'Sneaky edit' });
  check('while it waits the President cannot change it under the Coordinator', r.status === 409, r.data);
  r = await call('pres', 'DELETE', `/api/executive/outline/${outlineId}`);
  check('nor delete it', r.status === 409, r.data);
  r = await call('choir', 'GET', '/api/executive/outline/shared');
  check('until it is approved nobody else reads it', r.status === 200 && r.data.items.length === 0, r.data);

  r = await call('coord', 'GET', '/api/coordinator/outlines');
  check('the Chapter Coordinator sees it waiting', r.status === 200 && r.data.waiting === 1 && r.data.items[0].id === outlineId, r.data);
  r = await call('coord2', 'GET', '/api/coordinator/outlines');
  check('another chapter\'s Coordinator sees none of it', r.status === 200 && r.data.items.length === 0, r.data);
  r = await call('coord2', 'POST', `/api/coordinator/outlines/${outlineId}/approve`);
  check('and cannot approve it', r.status === 409, r.data);
  r = await call('pres', 'POST', `/api/coordinator/outlines/${outlineId}/approve`);
  check('the President cannot approve their own outline', denied(r), r);
  r = await call('fs', 'POST', `/api/coordinator/outlines/${outlineId}/approve`);
  check('nor can another executive', denied(r), r);
  r = await call('coord', 'POST', `/api/coordinator/outlines/${outlineId}/return`, { note: '  ' });
  check('sending it back needs a reason', r.status === 400, r.data);
  r = await call('coord', 'POST', `/api/coordinator/outlines/${outlineId}/return`, { note: 'Please add the mentoring programme to the calendar.' });
  check('the Coordinator sends it back with a reason', r.status === 200 && r.data.item.status === 'returned', r.data);
  r = await call('pres', 'GET', '/api/executive/outline');
  check('the President sees the reason', r.data.items[0].status === 'returned' && /mentoring/.test(r.data.items[0].returnNote), r.data);
  r = await call('pres', 'PUT', `/api/executive/outline/${outlineId}`, {
    title: 'First semester', semesterLabel: '2026/2027 first semester', startDate: '2026-09-01', endDate: '2026-12-20', theme: 'Rooted',
    goals: ['Grow weekly attendance'], programmes: [{ date: '2026-10-10', title: 'Choir concert', departmentId: dept.choir }, { date: '2026-11-07', title: 'Mentoring launch', kind: 'training' }]
  });
  check('they can fix it', r.status === 200 && r.data.item.programmes.length === 2, r.data);
  r = await call('pres', 'POST', `/api/executive/outline/${outlineId}/submit`);
  check('and send it again, which clears the old reason', r.status === 200 && r.data.item.returnNote === '', r.data);
  r = await call('coord', 'POST', `/api/coordinator/outlines/${outlineId}/approve`);
  check('the Coordinator approves it, and approval shares it', r.status === 200 && r.data.item.status === 'approved' && !!r.data.item.sharedAt, r.data);
  r = await call('coord', 'POST', `/api/coordinator/outlines/${outlineId}/approve`);
  check('a second approval changes nothing', r.status === 409, r.data);
  r = await call('coord', 'POST', `/api/coordinator/outlines/${outlineId}/return`, { note: 'Too late' });
  check('an approved outline cannot be sent back afterwards', r.status === 409, r.data);
  for (const jar of ['vp', 'gs', 'ags', 'fs', 'tr', 'choir', 'welfare', 'alum']) {
    r = await call(jar, 'GET', '/api/executive/outline/shared');
    check(`${jar} reads the approved outline`, r.status === 200 && r.data.items.length === 1 && r.data.items[0].title === 'First semester', r.data);
  }
  r = await call('pres2', 'GET', '/api/executive/outline/shared');
  check('another chapter\'s executive does not', r.status === 200 && r.data.items.length === 0, r.data);
  r = await call('pres', 'PUT', `/api/executive/outline/${outlineId}`, { title: 'Late change' });
  check('an approved outline is locked', r.status === 409, r.data);

  // The Alumni President has a plan of their own, on the same path.
  r = await call('alum', 'GET', '/api/executive/outline');
  check('the Alumni President starts with no outline of their own, not the President\'s', r.status === 200 && r.data.items.length === 0 && r.data.body === 'alumni', r.data);
  r = await call('alum', 'POST', '/api/executive/outline', {
    title: 'Alumni year', semesterLabel: '2026/2027', startDate: '2026-09-01', endDate: '2027-07-31', vision: 'Reconnect the alumni',
    goals: ['Hold a homecoming'], programmes: [{ date: '2027-03-06', title: 'Homecoming', kind: 'fellowship' }]
  });
  check('the Alumni President writes the alumni body\'s plan', r.status === 200 && r.data.item.body === 'alumni', r.data);
  const alumOutline = r.data.item.id;
  r = await call('pres', 'GET', '/api/executive/outline');
  check('which the President does not see among theirs', r.data.items.every(o => o.id !== alumOutline), r.data);
  r = await call('pres', 'PUT', `/api/executive/outline/${alumOutline}`, { title: 'Taken over' });
  check('and cannot edit', r.status === 404, r.data);
  r = await call('alum', 'POST', `/api/executive/outline/${alumOutline}/submit`);
  check('the plan goes to the same Coordinator', r.status === 200, r.data);
  r = await call('coord', 'POST', `/api/coordinator/outlines/${alumOutline}/approve`);
  check('who approves it the same way', r.status === 200, r.data);
  r = await call('vp', 'GET', '/api/executive/outline/shared');
  check('and both plans are then shared', r.data.items.length === 2, r.data.items.map(i => i.body));

  // A draft for next semester, left for whoever holds the office next.
  r = await call('pres', 'POST', '/api/executive/outline', { title: 'Second semester', semesterLabel: '2027 second semester' });
  const nextDraftId = r.data.item.id;
  check('the President starts the next semester\'s draft', r.status === 200, r.data);

  // ------------------------------------------------------------- budgets ----
  console.log('\n== budget requests: Finance asks, heads answer, Finance reviews, the Vice President decides ==');
  r = await call('fs', 'POST', '/api/budget/calls', { periodLabel: '2026/2027', departmentIds: [dept.choir] });
  check('a request needs a title', r.status === 400, r.data);
  r = await call('fs', 'POST', '/api/budget/calls', { title: 'Budgets 2026/2027', departmentIds: [] });
  check('and at least one department', r.status === 400, r.data);
  r = await call('fs', 'POST', '/api/budget/calls', { title: 'Budgets 2026/2027', departmentIds: [dept.otherChoir] });
  check('a department from another chapter cannot be asked', r.status === 400, r.data);
  r = await call('fs', 'POST', '/api/budget/calls', { title: 'Budgets 2026/2027', departmentIds: [dept.choir], dueDate: '2026-13-40' });
  check('a due date that is not real is refused', r.status === 400, r.data);
  for (const jar of ['tr', 'pres', 'gs', 'choir']) {
    r = await call(jar, 'POST', '/api/budget/calls', { title: 'Not mine', departmentIds: [dept.choir] });
    check(`${jar} cannot ask departments for budgets`, denied(r), r);
  }
  r = await call('fs', 'POST', '/api/budget/calls', {
    title: 'Budgets 2026/2027', periodLabel: '2026/2027', dueDate: '2026-09-30', instructions: 'Quote real prices please.', departmentIds: [dept.choir, dept.welfare]
  });
  check('the Financial Secretary asks two departments for their budgets', r.status === 200 && r.data.item.status === 'open' && r.data.item.departmentIds.length === 2, r.data);
  const callId = r.data.item.id;

  r = await call('media', 'GET', '/api/executive/budget-requests');
  check('a department that was not asked sees nothing', r.status === 200 && r.data.items.length === 0, r.data);
  r = await call('media', 'PUT', `/api/executive/budget-requests/${callId}`, { lines: [{ item: 'Mic', unitCost: 100 }], submit: true });
  check('and cannot answer', r.status === 404, r.data);
  r = await call('choir', 'GET', '/api/executive/budget-requests');
  check('the Music Director sees the request and no answer yet', r.status === 200 && r.data.items.length === 1 && r.data.items[0].submission === null && r.data.department.name === 'Choir', r.data);
  r = await call('choir', 'PUT', `/api/executive/budget-requests/${callId}`, { lines: [{ item: 'Keyboard', quantity: 1, unitCost: -5 }] });
  check('a negative cost is refused', r.status === 400, r.data);
  r = await call('choir', 'PUT', `/api/executive/budget-requests/${callId}`, { lines: [{ item: '', unitCost: 50 }] });
  check('a line without a name is refused', r.status === 400, r.data);
  r = await call('choir', 'PUT', `/api/executive/budget-requests/${callId}`, { lines: [], submit: true });
  check('an empty budget cannot be sent', r.status === 400, r.data);
  r = await call('choir', 'PUT', `/api/executive/budget-requests/${callId}`, {
    lines: [{ item: 'Keyboard stand', quantity: 2, unitCost: 150.25, amount: 1, note: 'for rehearsals' }, { item: 'Robes', quantity: 10, unitCost: 80 }, {}], total: 1, justification: 'The choir has grown.'
  });
  check('the head saves a draft, and the server works the amounts out itself, whatever was sent',
    r.status === 200 && r.data.item.status === 'draft' && r.data.item.total === 1100.5 && r.data.item.lines[0].amount === 300.5 && r.data.item.lines.length === 2, r.data);
  r = await call('choir', 'PUT', `/api/executive/budget-requests/${callId}`, { lines: r.data.item.lines.map(l => ({ item: l.item, quantity: l.quantity, unitCost: l.unitCost })), justification: 'The choir has grown.', submit: true });
  check('and sends it to Finance', r.status === 200 && r.data.item.status === 'submitted' && r.data.item.total === 1100.5, r.data);
  const choirSub = r.data.item.id;
  r = await call('choir', 'PUT', `/api/executive/budget-requests/${callId}`, { lines: [{ item: 'More', unitCost: 1 }] });
  check('once sent, the head cannot change it', r.status === 409, r.data);
  r = await call('welfare', 'GET', '/api/executive/budget-requests');
  check('the Welfare Head never sees the Choir\'s budget', r.data.items.length === 1 && r.data.items[0].submission === null, r.data);

  r = await call('fs', 'GET', `/api/budget/calls/${callId}`);
  check('Finance sees every department asked, who has answered and who has not',
    r.status === 200 && r.data.rows.length === 2 && r.data.rows.find(x => x.departmentId === dept.choir).submission.status === 'submitted'
    && r.data.rows.find(x => x.departmentId === dept.welfare).submission === null && r.data.rows.find(x => x.departmentId === dept.choir).headName === 'Ama Choir', r.data);
  r = await call('vp', 'POST', `/api/budget/submissions/${choirSub}/decide`, { action: 'approve' });
  check('the Vice President cannot decide before Finance has reviewed', r.status === 409, r.data);
  r = await call('vp', 'POST', `/api/budget/submissions/${choirSub}/review`, { action: 'recommend' });
  check('and does not do Finance\'s review', denied(r), r);
  r = await call('choir', 'POST', `/api/budget/submissions/${choirSub}/review`, { action: 'recommend' });
  check('a head cannot review their own budget', denied(r), r);
  r = await call('fs', 'POST', `/api/budget/submissions/${choirSub}/review`, { action: 'maybe' });
  check('a review must recommend or send back', r.status === 400, r.data);
  r = await call('fs', 'POST', `/api/budget/submissions/${choirSub}/review`, { action: 'return' });
  check('sending back needs a reason', r.status === 400, r.data);
  r = await call('fs', 'POST', `/api/budget/submissions/${choirSub}/review`, { action: 'recommend', recommendedTotal: 5000 });
  check('a recommendation cannot exceed what was asked', r.status === 400, r.data);
  r = await call('fs', 'POST', `/api/budget/submissions/${choirSub}/review`, { action: 'recommend', recommendedTotal: 900 });
  check('recommending less means saying why', r.status === 400, r.data);
  r = await call('fs', 'POST', `/api/budget/submissions/${choirSub}/review`, { action: 'recommend', recommendedTotal: 900, note: 'Robes can wait a term.' });
  check('Finance recommends a trimmed budget with a reason', r.status === 200 && r.data.item.status === 'recommended' && r.data.item.recommendedTotal === 900, r.data);
  r = await call('fs', 'POST', `/api/budget/submissions/${choirSub}/review`, { action: 'recommend' });
  check('a second review changes nothing', r.status === 409, r.data);

  r = await call('fs', 'POST', `/api/budget/submissions/${choirSub}/decide`, { action: 'approve' });
  check('Finance cannot also decide', denied(r), r);
  r = await call('tr', 'POST', `/api/budget/submissions/${choirSub}/decide`, { action: 'approve' });
  check('nor the Treasurer', denied(r), r);
  r = await call('vp', 'POST', `/api/budget/submissions/${choirSub}/decide`, { action: 'approve', approvedTotal: 2000 });
  check('the Vice President cannot approve more than was asked', r.status === 400, r.data);
  r = await call('vp', 'POST', `/api/budget/submissions/${choirSub}/decide`, { action: 'approve', approvedTotal: 800 });
  check('approving less means saying why', r.status === 400, r.data);
  r = await call('vp', 'POST', `/api/budget/submissions/${choirSub}/decide`, { action: 'approve', approvedTotal: 800, note: 'Keyboard stands only for now.' });
  check('the Vice President approves', r.status === 200 && r.data.item.status === 'approved' && r.data.item.approvedTotal === 800, r.data);
  r = await call('vp', 'POST', `/api/budget/submissions/${choirSub}/decide`, { action: 'decline', note: 'changed my mind' });
  check('a decision cannot be flipped afterwards', r.status === 409, r.data);

  // The Welfare Head answers, and Finance is slow: the Coordinator can decide.
  r = await call('welfare', 'PUT', `/api/executive/budget-requests/${callId}`, { lines: [{ item: 'Hampers', quantity: 20, unitCost: 45 }], submit: true });
  check('the Welfare Head sends theirs', r.status === 200 && r.data.item.total === 900, r.data);
  const welfareSub = r.data.item.id;
  r = await call('vp', 'POST', `/api/budget/submissions/${welfareSub}/decide`, { action: 'approve' });
  check('the Vice President still waits for Finance on this one', r.status === 409, r.data);
  r = await call('coord2', 'POST', `/api/budget/submissions/${welfareSub}/decide`, { action: 'approve' });
  check('another chapter\'s Coordinator cannot touch it', r.status === 404, r.data);
  r = await call('coord', 'POST', `/api/budget/submissions/${welfareSub}/decide`, { action: 'approve' });
  check('the Chapter Coordinator can decide it so one empty seat does not stall the year', r.status === 200 && r.data.item.status === 'approved' && r.data.item.approvedTotal === 900, r.data);

  // Send-back round trip on a second request.
  r = await call('fin', 'POST', '/api/budget/calls', { title: 'Mid-year top-up', departmentIds: [dept.media] });
  check('the Finance office can ask for budgets too', r.status === 200, r.data);
  const call2 = r.data.item.id;
  r = await call('media', 'PUT', `/api/executive/budget-requests/${call2}`, { lines: [{ item: 'Camera', unitCost: 4000 }], submit: true });
  const mediaSub = r.data.item.id;
  r = await call('fin', 'POST', `/api/budget/submissions/${mediaSub}/review`, { action: 'return', note: 'Get a second quote.' });
  check('Finance sends it back with a reason', r.status === 200 && r.data.item.status === 'returned', r.data);
  r = await call('fin', 'POST', `/api/budget/submissions/${mediaSub}/decide`, { action: 'approve' });
  check('the Finance office cannot decide either', denied(r), r);
  r = await call('media', 'GET', '/api/executive/budget-requests');
  check('the head sees why', r.data.items[0].submission.status === 'returned' && /second quote/.test(r.data.items[0].submission.reviewNote), r.data);
  r = await call('media', 'PUT', `/api/executive/budget-requests/${call2}`, { lines: [{ item: 'Camera', unitCost: 3600 }], submit: true });
  check('they correct it and send it again', r.status === 200 && r.data.item.status === 'submitted' && r.data.item.total === 3600, r.data);
  r = await call('coord', 'POST', `/api/budget/submissions/${mediaSub}/decide`, { action: 'decline' });
  check('declining needs a reason', r.status === 400, r.data);
  r = await call('coord', 'POST', `/api/budget/submissions/${mediaSub}/decide`, { action: 'decline', note: 'Not this term.' });
  check('a declined budget is closed, with nothing approved', r.status === 200 && r.data.item.status === 'declined' && r.data.item.approvedTotal === 0, r.data);

  // Posting.
  r = await call('vp', 'POST', `/api/budget/calls/${callId}/post`);
  check('the Vice President decides but does not post to the books', denied(r), r);
  r = await call('fs', 'POST', `/api/budget/calls/${callId}/post`);
  check('Finance posts the approved budgets into the chapter budget', r.status === 200 && r.data.posted === 2, r.data);
  const posted = fakeModels.Budget._docs.find(b => b.id === r.data.budgetId);
  check('as a draft budget holding one line per department, at the approved amounts',
    posted && posted.status === 'draft' && posted.chapterId === C1 && posted.lines.length === 2
    && posted.lines.find(l => l.category === 'Choir').plannedAmount === 800 && posted.lines.find(l => l.category === 'Welfare').plannedAmount === 900, posted);
  r = await call('fs', 'POST', `/api/budget/calls/${callId}/post`);
  check('posting again adds nothing', r.status === 400, r.data);
  r = await call('fs', 'GET', '/api/budget/calls');
  const listed = r.data.items.find(c => c.id === callId);
  check('the list shows the totals and that nothing is left to post', listed.approvedTotal === 1700 && listed.readyToPost === 0 && listed.counts.approved === 2, listed);
  r = await call('fs2', 'GET', `/api/budget/calls/${callId}`);
  check('another chapter\'s Financial Secretary cannot open it', r.status === 404, r.data);
  r = await call('fs2', 'GET', '/api/budget/calls');
  check('or see it listed', r.status === 200 && r.data.items.length === 0, r.data);
  r = await call('fs', 'PUT', `/api/budget/calls/${callId}`, { status: 'closed' });
  check('Finance closes the request', r.status === 200 && r.data.item.status === 'closed', r.data);
  r = await call('welfare', 'PUT', `/api/executive/budget-requests/${callId}`, { lines: [{ item: 'x', unitCost: 1 }] });
  check('a closed request takes no more answers', r.status === 409, r.data);

  // ------------------------------------------------------------- minutes ----
  console.log('\n== minutes: the two secretaries agree them before the executive body sees them ==');
  r = await call('gs', 'GET', '/api/executive/minutes-setup');
  check('the secretary\'s form lists the executives to tick and shows both seats filled',
    r.status === 200 && r.data.executives.length >= 8 && r.data.seats.length === 2 && r.data.executives.every(e => !!e.name), r.data);
  const roster = r.data.executives;
  const idOf = (name) => roster.find(e => e.name === name).id;
  for (const jar of ['pres', 'vp', 'choir', 'fs']) {
    r = await call(jar, 'POST', '/api/executive/minutes', { date: '2026-10-03', body: 'x' });
    check(`${jar} does not take the minutes`, r.status === 403, r.data);
  }
  r = await call('gs', 'POST', '/api/executive/minutes', { date: '2026-10-33' });
  check('minutes need a real date', r.status === 400, r.data);
  r = await call('gs', 'POST', '/api/executive/minutes', { date: '2026-10-03', startTime: '25:99' });
  check('and times written as times', r.status === 400, r.data);
  r = await call('gs', 'POST', '/api/executive/minutes', { date: '2026-10-03', actions: [{ task: 'Book the hall', dueDate: 'next week' }] });
  check('an action\'s due date must be a real date', r.status === 400, r.data);
  r = await call('gs', 'POST', '/api/executive/minutes', {
    date: '2026-10-03', title: 'October executive meeting', startTime: '16:30', endTime: '18:00', venue: 'Room 4', chair: 'Yaw President',
    presentExecutiveIds: [idOf('Yaw President'), idOf('Efua Vice'), idOf('Abena Secretary'), 'exec_not_mine'],
    apologies: 'Kojo Media', openingPrayer: 'Ama Choir',
    items: [{ heading: 'Semester outline', discussion: 'Reviewed.', decision: 'Adopted as read.' }, { heading: '', discussion: '', decision: '' }],
    actions: [{ task: 'Book the hall for the retreat', owner: 'Organising Secretary', dueDate: '2020-01-20' }, { task: 'Send thank-you notes', owner: 'Media Head', dueDate: '2099-12-31' }],
    nextMeeting: '2026-11-07 at 16:30'
  });
  check('the General Secretary starts the minutes, attendance confined to this chapter\'s executives, blank rows dropped',
    r.status === 200 && r.data.item.status === 'draft' && r.data.item.presentExecutiveIds.length === 3 && r.data.item.items.length === 1 && r.data.item.actions.length === 2
    && r.data.item.presentNames.includes('Efua Vice'), r.data);
  const m1 = r.data.item.id;
  r = await call('gs', 'POST', '/api/executive/minutes', { date: '2026-10-04' });
  const emptyMinutes = r.data.item.id;
  r = await call('gs', 'POST', `/api/executive/minutes/${emptyMinutes}/review`);
  check('minutes with nothing in them cannot go to the other secretary', r.status === 400 && r.data.gaps.length === 2, r.data);
  r = await call('gs', 'DELETE', `/api/executive/minutes/${emptyMinutes}`);
  check('an unwanted draft can be deleted', r.status === 200, r.data);

  r = await call('vp', 'GET', '/api/executive/minutes');
  check('the Vice President cannot see a draft', r.status === 200 && r.data.length === 0, r.data);
  r = await call('ags', 'GET', '/api/executive/minutes');
  check('the Assistant, who works on them, can', r.status === 200 && r.data.length === 1 && r.data[0].id === m1, r.data);
  r = await call('ags', 'POST', `/api/executive/minutes/${m1}/approve`);
  check('minutes cannot be approved before they are sent for review', r.status === 409, r.data);
  r = await call('gs', 'POST', `/api/executive/minutes/${m1}/review`);
  check('the General Secretary sends them to the Assistant', r.status === 200 && r.data.item.status === 'in_review', r.data);
  r = await call('gs', 'POST', `/api/executive/minutes/${m1}/review`);
  check('which cannot be done twice', r.status === 409, r.data);
  r = await call('vp', 'GET', '/api/executive/minutes');
  check('in review they are still the secretaries\' alone', r.data.length === 0, r.data);
  r = await call('vp', 'POST', `/api/executive/minutes/${m1}/comments`, { text: 'Can I see these?' });
  check('another executive cannot join the thread', r.status === 403, r.data);
  r = await call('ags', 'POST', `/api/executive/minutes/${m1}/comments`, { text: '   ' });
  check('an empty comment is refused', r.status === 400, r.data);
  r = await call('ags', 'POST', `/api/executive/minutes/${m1}/comments`, { text: 'Please add who proposed the outline.' });
  check('the Assistant comments on them', r.status === 200 && r.data.item.comments.length === 1 && r.data.item.comments[0].position === 'assistant_general_secretary', r.data);
  r = await call('gs', 'POST', `/api/executive/minutes/${m1}/approve`);
  check('the General Secretary signs, and they wait for the Assistant',
    r.status === 200 && r.data.shared === false && r.data.waitingFor.length === 1 && r.data.waitingFor[0] === 'assistant_general_secretary', r.data);
  r = await call('gs', 'POST', `/api/executive/minutes/${m1}/approve`);
  check('signing twice counts once', r.status === 200 && r.data.item.approvedPositions.length === 1, r.data);
  r = await call('ags', 'PUT', `/api/executive/minutes/${m1}`, {
    date: '2026-10-03', title: 'October executive meeting', presentExecutiveIds: [idOf('Yaw President'), idOf('Efua Vice'), idOf('Abena Secretary')],
    items: [{ heading: 'Semester outline', discussion: 'Reviewed. Proposed by the Vice President.', decision: 'Adopted as read.' }],
    actions: [{ task: 'Book the hall for the retreat', owner: 'Organising Secretary', dueDate: '2020-01-20' }, { task: 'Send thank-you notes', owner: 'Media Head', dueDate: '2099-12-31' }]
  });
  check('the Assistant edits them, which clears the General Secretary\'s signature', r.status === 200 && r.data.item.approvedPositions.length === 0 && r.data.item.status === 'in_review', r.data);
  r = await call('gs', 'GET', '/api/executive/minutes');
  check('and the thread records that they must sign again', r.data[0].comments.some(c => /approve them again/.test(c.text)), r.data[0].comments);
  r = await call('ags', 'POST', `/api/executive/minutes/${m1}/approve`);
  check('the Assistant signs', r.status === 200 && r.data.shared === false, r.data);
  r = await call('vp', 'GET', '/api/executive/minutes');
  check('one signature is not enough to share', r.data.length === 0, r.data);
  r = await call('gs', 'POST', `/api/executive/minutes/${m1}/approve`);
  check('both have signed, so the minutes are the record and are shared', r.status === 200 && r.data.shared === true && r.data.item.status === 'approved' && !!r.data.item.sharedAt, r.data);
  r = await call('vp', 'GET', '/api/executive/minutes');
  check('the Vice President now reads them', r.status === 200 && r.data.length === 1 && r.data[0].id === m1, r.data);
  check('without the secretaries\' working', r.data[0].comments === undefined && r.data[0].approvedBy === undefined, Object.keys(r.data[0]));
  r = await call('choir', 'GET', '/api/executive/minutes');
  check('a department head reads them too', r.status === 200 && r.data.length === 1, r.data);
  r = await call('alum', 'GET', '/api/executive/minutes');
  check('the Alumni President, who is not on the chapter executive, does not', r.status === 403, r.data);
  r = await call('pres2', 'GET', '/api/executive/minutes');
  check('another chapter\'s executive reads none of it', r.status === 200 && r.data.length === 0, r.data);
  r = await call('gs', 'PUT', `/api/executive/minutes/${m1}`, { date: '2026-10-03', body: 'rewrite history' });
  check('shared minutes are the record and cannot be rewritten', r.status === 409, r.data);
  r = await call('gs', 'DELETE', `/api/executive/minutes/${m1}`);
  check('or deleted', r.status === 409, r.data);
  r = await call('gs', 'POST', `/api/executive/minutes/${m1}/comments`, { text: 'one more' });
  check('or commented on', r.status === 409, r.data);
  r = await call('ags', 'POST', `/api/executive/minutes/${m1}/approve`);
  check('or signed again', r.status === 409, r.data);
  r = await call('coord', 'GET', '/api/coordinator/minutes');
  check('the Chapter Coordinator reads the shared record', r.status === 200 && r.data.items.length === 1, r.data);

  // Scan of the paper minutes.
  const second = (await call('gs', 'POST', '/api/executive/minutes', { date: '2026-11-07', title: 'November meeting', presentExecutiveIds: [idOf('Yaw President')], body: 'Paper minutes attached.' })).data.item.id;
  const upload = (name, bytes, type) => { const fd = new FormData(); fd.append('file', new Blob([bytes], { type }), name); return fd; };
  r = await call('gs', 'POST', `/api/executive/minutes/${second}/file`, upload('notes.txt', Buffer.from('plain text notes here'), 'text/plain'), true);
  check('only a PDF or a photo can be attached, judged by the bytes', r.status === 400, r.data);
  r = await call('gs', 'POST', `/api/executive/minutes/${second}/file`, upload('minutes.pdf', Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n'), 'application/pdf'), true);
  check('a scan attaches to the minutes', r.status === 200 && !!r.data.item.fileId, r.data);
  const scanId = r.data.item.fileId;
  r = await call('vp', 'POST', `/api/executive/minutes/${second}/file`, upload('minutes.pdf', Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n'), 'application/pdf'), true);
  check('only the secretaries attach one', r.status === 403, r.data);
  r = await call('gs', 'GET', `/api/files/${scanId}`);
  check('the secretary opens it', r.status === 200, r.status);
  r = await call('ags', 'GET', `/api/files/${scanId}`);
  check('so does the Assistant', r.status === 200, r.status);
  r = await call('coord', 'GET', `/api/files/${scanId}`);
  check('and the Chapter Coordinator', r.status === 200, r.status);
  for (const jar of ['vp', 'choir', 'anon', 'coord2', 'pres2', 'alum']) {
    r = await call(jar, 'GET', `/api/files/${scanId}`);
    check(`${jar} cannot open it while the minutes are still being agreed`, r.status === 404, r.status);
  }
  r = await call('anon', 'GET', '/api/files?category=minutes');
  check('and it is never listed', r.status === 200 && r.data.length === 0, r.data);
  r = await call('gs', 'POST', `/api/executive/minutes/${second}/review`);
  r = await call('gs', 'POST', `/api/executive/minutes/${second}/approve`);
  r = await call('ags', 'POST', `/api/executive/minutes/${second}/approve`);
  check('the second set is shared', r.data.shared === true, r.data);
  r = await call('vp', 'GET', `/api/files/${scanId}`);
  check('the Vice President opens the scan now it is shared', r.status === 200, r.status);
  r = await call('choir', 'GET', `/api/files/${scanId}`);
  check('as does a department head', r.status === 200, r.status);
  for (const jar of ['anon', 'coord2', 'pres2', 'alum']) {
    r = await call(jar, 'GET', `/api/files/${scanId}`);
    check(`${jar} still cannot`, r.status === 404, r.status);
  }

  // A seat with nobody in it.
  r = await call('gs', 'POST', '/api/executive/minutes', { date: '2026-11-21', presentExecutiveIds: [idOf('Yaw President')], body: 'Short meeting.' });
  const third = r.data.item.id;
  await call('gs', 'POST', `/api/executive/minutes/${third}/review`);
  r = await call('admin', 'PUT', `/api/admin/staff/${people.ags.staffId}`, { endTerm: true });
  check('the Assistant\'s term ends', r.status === 200, r.data);
  r = await call('ags', 'GET', '/api/executive/minutes');
  check('their login stops at once', denied(r), r);
  r = await call('gs', 'POST', `/api/executive/minutes/${third}/approve`);
  check('with the Assistant\'s seat empty, the General Secretary\'s signature alone shares the minutes', r.status === 200 && r.data.shared === true, r.data);

  // Minutes written before this workflow was 'adopted'; they still read as shared.
  fakeModels.ExecutiveMinute._docs.push({ _id: 'legacy', id: 'emin_legacy', chapterId: C1, date: '2025-05-01', title: 'Old minutes', status: 'adopted', body: 'Before.', presentNames: [], presentExecutiveIds: [], actions: [], items: [], comments: [], approvedBy: [] });
  r = await call('vp', 'GET', '/api/executive/minutes');
  check('minutes adopted under the old process still read as shared', r.data.some(m => m.id === 'emin_legacy'), r.data.map(m => m.id));

  // ---------------------------------------------------------- follow-up ----
  console.log('\n== follow-up on what the executive resolved ==');
  r = await call('vp', 'GET', '/api/executive/followups');
  const hall = r.data.actions && r.data.actions.find(a => /Book the hall/.test(a.task));
  check('the Vice President sees the action items from the shared minutes, the one past its date marked overdue', r.status === 200 && r.data.actions.length === 2 && r.data.overdue === 1 && hall.overdue === true && hall.owner === 'Organising Secretary', r.data);
  r = await call('vp', 'PATCH', `/api/executive/followups/${hall.minuteId}/${hall.actionId}`, { done: true });
  check('they tick one off', r.status === 200, r.data);
  r = await call('pres', 'GET', '/api/executive/followups');
  check('the President sees that it is done', r.data.open === 1 && r.data.actions.find(a => a.actionId === hall.actionId).done === true, r.data);
  r = await call('choir', 'GET', '/api/executive/followups');
  check('a department head has no follow-up screen', r.status === 403, r.data);
  r = await call('pres2', 'PATCH', `/api/executive/followups/${hall.minuteId}/${hall.actionId}`, { done: false });
  check('and another chapter cannot untick it', denied(r) || r.status === 404, r);

  // -------------------------------------------------------- announcements --
  console.log('\n== Sunday announcements: the secretaries ask, the executives answer, the secretaries compile ==');
  r = await call('gs', 'POST', '/api/executive/announcement-calls', { title: 'x' });
  check('a request needs the date of the service', r.status === 400, r.data);
  r = await call('gs', 'POST', '/api/executive/announcement-calls', { serviceDate: '2026-11-08', dueDate: '2026-11-09' });
  check('and a deadline before the service', r.status === 400, r.data);
  for (const jar of ['choir', 'pres', 'vp']) {
    r = await call(jar, 'POST', '/api/executive/announcement-calls', { serviceDate: '2026-11-08' });
    check(`${jar} does not ask for announcements`, r.status === 403, r.data);
  }
  r = await call('gs', 'POST', '/api/executive/announcement-calls', { serviceDate: '2026-11-08', dueDate: '2026-11-06', note: 'Keep it short.' });
  check('the General Secretary asks for Sunday\'s announcements', r.status === 200 && r.data.item.status === 'open' && /Sunday/.test(r.data.item.title), r.data);
  const acall = r.data.item.id;
  r = await call('gs', 'POST', '/api/executive/announcement-calls', { serviceDate: '2026-11-08' });
  check('and the same service cannot be asked twice', r.status === 409, r.data);

  r = await call('choir', 'GET', '/api/executive/announcement-requests');
  check('the Music Director sees the request and no answer yet', r.status === 200 && r.data.items[0].call.id === acall && r.data.items[0].answer === null, r.data);
  r = await call('choir', 'PUT', `/api/executive/announcement-requests/${acall}`, { text: '  ' });
  check('an empty answer is refused, unless they say they have nothing', r.status === 400, r.data);
  r = await call('choir', 'PUT', `/api/executive/announcement-requests/${acall}`, { text: 'Choir rehearsal is moved to Friday.', whenWhere: 'Friday 5pm, Chapel', contact: '0240000000' });
  check('they send theirs', r.status === 200 && r.data.item.status === 'submitted', r.data);
  r = await call('choir', 'PUT', `/api/executive/announcement-requests/${acall}`, { text: 'Choir rehearsal is moved to Friday at 6pm.', whenWhere: 'Friday 6pm, Chapel' });
  check('and can change it, still as one answer', r.status === 200 && fakeModels.AnnouncementItem._docs.filter(i => i.callId === acall).length === 1, r.data);
  r = await call('tr', 'PUT', `/api/executive/announcement-requests/${acall}`, { nothing: true });
  check('the Treasurer says they have nothing', r.status === 200 && r.data.item.nothing === true, r.data);
  r = await call('pres', 'PUT', `/api/executive/announcement-requests/${acall}`, { text: 'x'.repeat(5000) });
  check('a long answer is cut to a length that can be read out', r.status === 200 && r.data.item.text.length === 1200, r.data.item && r.data.item.text.length);

  r = await call('gs', 'GET', `/api/executive/announcement-calls/${acall}`);
  check('the secretary sees the three answers and who has not yet answered',
    r.status === 200 && r.data.items.length === 3 && r.data.waitingOn.length >= 3 && r.data.waitingOn.some(w => w.name === 'Efua Vice') && !r.data.waitingOn.some(w => w.name === 'Ama Choir'), r.data);
  const choirItem = r.data.items.find(i => i.fromName === 'Ama Choir');
  const presItem = r.data.items.find(i => i.fromName === 'Yaw President');
  const gsList = await call('gs', 'GET', '/api/executive/announcement-calls');
  check('the list shows how many have answered', gsList.data.items[0].received === 3 && gsList.data.items[0].nothingCount === 1, gsList.data.items[0]);
  r = await call('gs', 'PUT', `/api/executive/announcement-calls/${acall}/items/${choirItem.id}`, { status: 'included', order: 1, finalText: 'The choir rehearses on Friday at 6pm.' });
  check('they choose what is read out, and tidy the wording', r.status === 200 && r.data.item.status === 'included', r.data);
  r = await call('gs', 'PUT', `/api/executive/announcement-calls/${acall}/items/${presItem.id}`, { status: 'left_out' });
  check('and leave one out', r.status === 200, r.data);
  r = await call('gs', 'PUT', `/api/executive/announcement-calls/${acall}/items/nope`, { status: 'included' });
  check('an unknown answer is not found', r.status === 404, r.data);
  r = await call('gs2', 'PUT', `/api/executive/announcement-calls/${acall}/items/${choirItem.id}`, { status: 'left_out' });
  check('another chapter\'s secretary cannot touch it', r.status === 404, r.data);
  r = await call('gs2', 'GET', `/api/executive/announcement-calls/${acall}`);
  check('or read it', r.status === 404, r.data);
  r = await call('gs', 'POST', `/api/executive/announcement-calls/${acall}/compile`, {});
  check('the compiled text holds what was included, attributed, and nothing that was left out or said nothing',
    r.status === 200 && /Announcements for Sunday, 8 November 2026/.test(r.data.item.compiledText) && /rehearses on Friday at 6pm/.test(r.data.item.compiledText)
    && /Friday 6pm, Chapel/.test(r.data.item.compiledText) && /Music Director/.test(r.data.item.compiledText) && !/Yaw President/.test(r.data.item.compiledText) && !/Treasurer/.test(r.data.item.compiledText), r.data);
  r = await call('vp', 'PUT', `/api/executive/announcement-requests/${acall}`, { text: 'Please pray for the examinations.' });
  check('a late answer arrives undecided', r.status === 200 && r.data.item.status === 'submitted', r.data);
  r = await call('gs', 'POST', `/api/executive/announcement-calls/${acall}/compile`, { includeAll: true });
  check('"read out everything" includes whatever was undecided, but not what was left out', r.status === 200 && fakeModels.AnnouncementItem._docs.filter(i => i.callId === acall && i.status === 'included').length === 2 && /pray for the examinations/.test(r.data.item.compiledText) && !/Yaw President/.test(r.data.item.compiledText), r.data);
  r = await call('gs', 'PUT', `/api/executive/announcement-calls/${acall}`, { status: 'closed', compiledText: 'Final text for Sunday.' });
  check('the secretary edits the final text and closes the request', r.status === 200 && r.data.item.status === 'closed' && r.data.item.compiledText === 'Final text for Sunday.', r.data);
  r = await call('choir', 'PUT', `/api/executive/announcement-requests/${acall}`, { text: 'late one' });
  check('a closed request takes no more', r.status === 409, r.data);

  // ----------------------------------------------------------- committees --
  console.log('\n== committees and task forces: the Vice President\'s ==');
  r = await call('gs', 'GET', '/api/executive/committees');
  check('the General Secretary has no committees screen', r.status === 403, r.data);
  r = await call('vp', 'POST', '/api/executive/committees', { name: '' });
  check('a committee needs a name', r.status === 400, r.data);
  r = await call('vp', 'POST', '/api/executive/committees', { name: 'Retreat task force', startDate: '2026-11-10', dueDate: '2026-11-01' });
  check('and cannot be due before it starts', r.status === 400, r.data);
  r = await call('vp', 'POST', '/api/executive/committees', { name: 'Retreat task force', kind: 'task_force', mandate: 'Plan the retreat', chairName: 'Ama Choir', memberNames: ['Esi Welfare', 'Kofi Media'], dueDate: '2026-12-01' });
  check('the Vice President sets up a task force', r.status === 200 && r.data.item.kind === 'task_force' && r.data.item.memberNames.length === 2, r.data);
  const tf = r.data.item.id;
  r = await call('vp', 'PUT', `/api/executive/committees/${tf}`, { name: 'Retreat task force', kind: 'task_force', status: 'done', progressNote: 'Venue booked.' });
  check('and records its progress', r.status === 200 && r.data.item.status === 'done', r.data);
  r = await call('pres2', 'GET', '/api/executive/committees');
  check('another chapter sees none', denied(r), r);
  r = await call('vp', 'DELETE', `/api/executive/committees/${tf}`);
  check('it can be removed', r.status === 200, r.data);

  // ----------------------------------------------------------- finances --
  console.log('\n== the Vice President records the finances ==');
  r = await call('vp', 'POST', '/api/executive/finance/ledger', { entryType: 'income', amount: 120, category: 'offertory', description: 'Sunday offering', date: '2026-10-04' });
  check('the Vice President records a ledger entry', r.status === 200, r.data);
  r = await call('vp', 'GET', '/api/executive/finance/ledger');
  check('and reads the ledger back', r.status === 200, r.data);
  r = await call('vp', 'GET', '/api/executive/chapter/finance');
  check('and the books summary', r.status === 200 && typeof r.data.balance === 'number', r.data);
  r = await call('gs', 'POST', '/api/executive/finance/ledger', { entryType: 'income', amount: 1, category: 'offertory' });
  check('the General Secretary does not', r.status === 403, r.data);

  // ------------------------------------------------------------ alumni --
  console.log('\n== the Alumni President\'s desk shows only what alumni have chosen to share ==');
  const mA = await registerMember('Listed Alumna', C1); const mB = await registerMember('Private Alumnus', C1);
  const mC = await registerMember('Other Chapter Alumna', C2); const mD = await registerMember('Current Student', C1);
  [mA, mB, mC].forEach(id => { fakeModels.Member._docs.find(m => m.id === id).membershipStage = 'alumni'; });
  fakeModels.Member._docs.find(m => m.id === mA).graduationYear = '2021';
  await fakeModels.AlumniProfile.create({ id: 'ap1', memberId: mA, chapterId: C1, listed: true, profession: 'Nurse', city: 'Accra', showEmail: true, showPhone: false, openToMentoring: true });
  await fakeModels.AlumniProfile.create({ id: 'ap2', memberId: mB, chapterId: C1, listed: false, profession: 'Secret job', showEmail: true });
  void mD;
  r = await call('alum', 'GET', '/api/executive/alumni');
  const listedA = r.data.items && r.data.items.find(i => i.name === 'Listed Alumna');
  const privateB = r.data.items && r.data.items.find(i => i.name === 'Private Alumnus');
  check('the Alumni President sees this chapter\'s alumni, not its students or another chapter\'s',
    r.status === 200 && r.data.items.some(i => i.name === 'Nana Alumnus') && !!listedA && !!privateB && !r.data.items.some(i => /Other Chapter|Current Student/.test(i.name)), r.data);
  check('a listed alumna shows what she published, and her email only because she ticked it',
    listedA.profession === 'Nurse' && listedA.email.includes('@') && listedA.phone === '' && listedA.graduationYear === '2021' && listedA.openToMentoring === true, listedA);
  check('one who did not list herself shows a name only, whatever else is on file', privateB.profession === '' && privateB.email === '' && privateB.listed === false, privateB);
  check('with counts', r.data.count === 3 && r.data.listed === 1 && r.data.mentors === 1, r.data);
  r = await call('pres', 'GET', '/api/executive/alumni');
  check('the President of the chapter has no alumni desk', r.status === 403, r.data);

  // --------------------------------------------------- key offices, hand-over --
  console.log('\n== key offices, renewing and handing over ==');
  r = await call('coord', 'GET', '/api/coordinator/offices');
  const byKey = (x) => (r.data.items || []).filter(o => o.key === x);
  check('the Coordinator sees every key office', r.status === 200 && ['president', 'vice_president', 'general_secretary', 'treasurer', 'alumni_president'].every(k => byKey(k).length === 1), r.data.items && r.data.items.map(o => o.key));
  check('a seat nobody holds shows as vacant', byKey('organising_secretary')[0].status === 'vacant' && byKey('organising_secretary')[0].holder === null, byKey('organising_secretary'));
  check('a seat whose term has ended shows as ended', byKey('assistant_general_secretary')[0].status === 'ended', byKey('assistant_general_secretary'));
  check('and one that is current, with the days left', byKey('president')[0].status === 'current' && byKey('president')[0].holder.daysLeft > 0 && byKey('president')[0].holder.name === 'Yaw President', byKey('president'));
  check('the count of seats needing attention', r.data.needsAttention >= 3, r.data.needsAttention);
  r = await call('pres', 'GET', '/api/coordinator/offices');
  check('an executive cannot open it', denied(r), r);
  r = await call('coord2', 'GET', '/api/coordinator/offices');
  check('another chapter\'s Coordinator sees only their own officers', r.status === 200 && r.data.items.find(o => o.key === 'president').holder.name === 'Other President', r.data.items.find(o => o.key === 'president'));

  // A second President cannot be seated next to the first.
  const spare = await registerMember('Spare Person', C1);
  r = await call('admin', 'POST', '/api/admin/staff', { username: 'exec.pres.two', name: 'Spare Person', role: 'executive', password: 'password123', memberId: spare, positionKey: 'president', chapterId: C1 });
  check('a seat that is held cannot be given to a second person', r.status === 409 && /Hand over/.test(r.data.error), r.data);

  const handover = (body) => call('coord', 'POST', '/api/coordinator/offices/handover', body);
  const successorMember = await registerMember('Kwesi New President', C1);
  r = await handover({ positionKey: 'nonsense', memberId: successorMember, username: 'exec.newpres', password: 'password123' });
  check('hand-over needs a real office', r.status === 400, r.data);
  r = await handover({ positionKey: 'president', username: 'exec.newpres', password: 'password123' });
  check('and the member taking over', r.status === 400, r.data);
  r = await handover({ positionKey: 'president', memberId: 'nobody', username: 'exec.newpres', password: 'password123' });
  check('who must exist', r.status === 400, r.data);
  r = await handover({ positionKey: 'president', memberId: people.pres2.memberId, username: 'exec.newpres', password: 'password123' });
  check('and be a member of this chapter first', r.status === 400, r.data);
  r = await handover({ positionKey: 'president', memberId: successorMember, username: 'exec.pres', password: 'password123' });
  check('with a username that is free', r.status === 400, r.data);
  r = await handover({ positionKey: 'president', memberId: successorMember, username: 'exec.newpres', password: 'short' });
  check('and a password of a decent length', r.status === 400, r.data);
  r = await handover({ positionKey: 'president', memberId: people.pres.memberId, username: 'exec.newpres', password: 'password123' });
  check('the person already holding the office is told to use renew, not hand over', r.status === 400 && /Renew/.test(r.data.error), r.data);
  r = await handover({ positionKey: 'president', memberId: people.vp.memberId, username: 'exec.newpres', password: 'password123' });
  check('someone who holds another office must leave it first', r.status === 409, r.data);
  r = await handover({ positionKey: 'alumni_president', memberId: successorMember, username: 'exec.newalum', password: 'password123' });
  check('the Alumni President seat can pass only to an alumnus', r.status === 409 && /alumn/i.test(r.data.error), r.data);
  r = await call('pres', 'POST', '/api/coordinator/offices/handover', { positionKey: 'president', memberId: successorMember, username: 'exec.newpres', password: 'password123' });
  check('an executive cannot hand over their own office', denied(r), r);

  const cardBefore = fakeModels.Executive._docs.find(c => c.positionKey === 'president' && c.chapterId === C1);
  r = await handover({ positionKey: 'president', memberId: successorMember, username: 'exec.newpres', password: 'password123' });
  check('the Coordinator hands the Presidency over', r.status === 200 && r.data.handedOverFrom === 'Yaw President' && r.data.item.positionKey === 'president', r.data);
  const newStaffId = r.data.item.id;
  const oldAccount = fakeModels.StaffUser._docs.find(a => a.id === people.pres.staffId);
  check('the outgoing account is ended and points to the successor, not deleted', !!oldAccount && oldAccount.handedOverTo === newStaffId && !!oldAccount.endedAt && new Date(oldAccount.termEndsAt) <= new Date(), oldAccount);
  r = await call('pres', 'GET', '/api/executive/outline');
  check('the outgoing President\'s session stops at once', denied(r), r);
  r = await call('pres', 'POST', '/api/portal/login', { username: 'exec.pres', password: 'password123' });
  check('and they cannot sign in again', denied(r), r);
  const cardAfter = fakeModels.Executive._docs.find(c => c.id === cardBefore.id);
  check('the office keeps its roster card, now showing the successor', cardAfter.staffId === newStaffId && cardAfter.name === 'Kwesi New President' && cardAfter.history.length === 0, cardAfter);
  check('the outgoing member no longer shows as an executive, the new one does',
    fakeModels.Member._docs.find(m => m.id === people.pres.memberId).isExecutive === false && fakeModels.Member._docs.find(m => m.id === successorMember).isExecutive === true);
  r = await call('newpres', 'POST', '/api/portal/login', { username: 'exec.newpres', password: 'password123' });
  check('the successor signs in with their own login', r.status === 200, r.data);
  r = await call('newpres', 'GET', '/api/executive/outline');
  check('and finds the outline draft the last President left, and the approved one',
    r.status === 200 && r.data.items.some(o => o.id === nextDraftId && o.status === 'draft') && r.data.items.some(o => o.id === outlineId && o.status === 'approved'), r.data);
  r = await call('newpres', 'PUT', `/api/executive/outline/${nextDraftId}`, { title: 'Second semester', semesterLabel: '2027 second semester' });
  check('and carries on editing it', r.status === 200, r.data);
  r = await call('admin', 'PUT', `/api/admin/staff/${people.pres.staffId}`, { renewTerm: true });
  check('the old account cannot be renewed to get the seat back', r.status === 409, r.data);
  r = await call('coord', 'GET', '/api/coordinator/offices');
  const presRow = r.data.items.find(o => o.key === 'president');
  check('the office list shows the new holder and who held it before', presRow.holder.name === 'Kwesi New President' && presRow.before.length === 1 && presRow.before[0].name === 'Yaw President', presRow);

  // A department head's office carries its department and its open work.
  const choirCard = fakeModels.Executive._docs.find(c => c.positionKey === 'music_director' && c.chapterId === C1);
  const choirSuccessor = await registerMember('Yaa New Choir', C1);
  r = await handover({ positionKey: 'music_director', memberId: choirSuccessor, username: 'exec.newchoir', password: 'password123' });
  check('a department head\'s office passes on with its department', r.status === 200 && r.data.card.department === dept.choir && r.data.card.id === choirCard.id, r.data);
  await call('newchoir', 'POST', '/api/portal/login', { username: 'exec.newchoir', password: 'password123' });
  r = await call('newchoir', 'GET', '/api/executive/announcement-requests');
  check('the successor finds the answer their office gave to the announcement call', r.data.items[0].answer && r.data.items[0].answer.fromName === 'Ama Choir', r.data);
  r = await call('newchoir', 'GET', '/api/executive/budget-requests');
  check('and the budget the office sent in', r.data.items[0].submission && r.data.items[0].submission.status === 'approved', r.data);
  r = await call('choir', 'GET', '/api/executive/budget-requests');
  check('while the outgoing head sees nothing', denied(r), r);

  // Filling a seat nobody holds.
  const orgMember = await registerMember('Efo Organiser', C1);
  r = await handover({ positionKey: 'organising_secretary', memberId: orgMember, username: 'exec.org', password: 'password123' });
  check('a vacant office is filled the same way, with nobody to end', r.status === 200 && r.data.handedOverFrom === '', r.data);
  r = await handover({ positionKey: 'music_director', memberId: orgMember, username: 'exec.org2', password: 'password123' });
  check('though nobody can hold two', r.status === 409, r.data);

  // Alumni seat passes to another alumnus.
  const alumSuccessor = await registerMember('Nii New Alumni', C1);
  fakeModels.Member._docs.find(m => m.id === alumSuccessor).membershipStage = 'alumni';
  r = await handover({ positionKey: 'alumni_president', memberId: alumSuccessor, username: 'exec.newalum', password: 'password123' });
  check('the Alumni President seat passes to another alumnus', r.status === 200 && r.data.handedOverFrom === 'Nana Alumnus', r.data);
  await call('newalum', 'POST', '/api/portal/login', { username: 'exec.newalum', password: 'password123' });
  r = await call('newalum', 'GET', '/api/executive/outline');
  check('who inherits the alumni plan', r.data.items.length === 1 && r.data.items[0].id === alumOutline, r.data);

  // Renewing the same person for another year.
  fakeModels.StaffUser._docs.find(a => a.id === people.tr.staffId).termEndsAt = new Date(Date.now() - 86400000).toISOString();
  r = await call('tr2', 'POST', '/api/portal/login', { username: 'exec.tr', password: 'password123' });
  check('a Treasurer whose year has ended can no longer sign in', denied(r), r);
  r = await call('coord', 'GET', '/api/coordinator/offices');
  check('and shows as ended', r.data.items.find(o => o.key === 'treasurer').status === 'ended', r.data.items.find(o => o.key === 'treasurer'));
  r = await call('coord', 'PUT', `/api/admin/staff/${people.tr.staffId}`, { renewTerm: true });
  check('the Coordinator renews the same person for the new year', r.status === 200 && new Date(r.data.item.termEndsAt) > new Date(), r.data);
  r = await call('tr', 'POST', '/api/portal/login', { username: 'exec.tr', password: 'password123' });
  check('and they sign in again', r.status === 200, r.data);

  console.log(failures ? `\n${failures} check(s) failed` : '\nall office checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
