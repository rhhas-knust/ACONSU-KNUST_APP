// The office is the executive: the Financial Secretary runs Finance, the
// Shepherding Head runs Shepherding, the Publicity, Welfare and Media Heads run
// theirs, for their year. A department head can be appointed before their
// department exists, and sets it up themselves from their portal.
//
//   node test/key-offices.js     (also run by `npm test`)
const { fakeModels } = require('./harness.js');
const positions = require('../lib/positions');
const secondStep = require('../lib/secondStep');

(async () => {
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/aconsu_key_offices', PORT: '4380', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 'test', LOGIN_RATE_LIMIT_MAX: '500' });
  delete process.env.SHEPHERD_USERNAME;
  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 600)}` : ''}`); }
  }

  console.log('\n== which executive runs which office ==');
  check('Financial Secretary, Shepherding, Publicity, Welfare and Media Heads (and the Assistants for Welfare and Media) run those portals',
    positions.officePortalOf('financial_secretary') === 'finance' && positions.officePortalOf('shepherding_head') === 'shepherding'
    && positions.officePortalOf('publicity_head') === 'publicity' && positions.officePortalOf('welfare_head') === 'welfare'
    && positions.officePortalOf('assistant_welfare_head') === 'welfare' && positions.officePortalOf('media_head') === 'media'
    && positions.officePortalOf('assistant_media_head') === 'media');
  check('the Treasurer does not (the person holding the money does not record it)', positions.officePortalOf('treasurer') === '');
  check('the Shepherding and Welfare Heads need the second step, as those offices always have',
    secondStep.requiredFor({ role: 'executive', positionKey: 'shepherding_head' }) && secondStep.requiredFor({ role: 'executive', positionKey: 'welfare_head' })
    && !secondStep.requiredFor({ role: 'executive', positionKey: 'music_director' }));

  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4380';
  const jars = {};
  async function call(jar, method, p, body) {
    const h = { 'X-Chapter-Id': 'aconsu-knust' };
    if (jars[jar]) h.cookie = jars[jar];
    if (body) h['content-type'] = 'application/json';
    const res = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.getSetCookie();
    if (sc.length) jars[jar] = sc.map(c => c.split(';')[0]).join('; ');
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }
  const C = 'aconsu-knust';
  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  await call('admin', 'POST', '/api/national/chapters', { id: C, name: 'ACONSU-KNUST', institution: 'KNUST' });
  let n = 0;
  async function member(name) {
    n += 1;
    const f = new FormData();
    f.append('profileImage', new Blob([Buffer.from(name)], { type: 'image/png' }), 'me.png');
    Object.entries({ name, email: `k${n}@example.com`, phone: `02445000${String(n).padStart(2, '0')}`, password: 'a-good-long-password', chapterId: C, consent: 'true' }).forEach(([k, v]) => f.append(k, v));
    return (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: f })).json()).member.id;
  }
  const appoint = async (name, positionKey, extra) => {
    const id = await member(name);
    const r = await call('admin', 'POST', '/api/admin/staff', { role: 'executive', positionKey, memberId: id, chapterId: C, ...(extra || {}) });
    return { id, r };
  };
  const signIn = async (jar, email, portal) => call(jar, 'POST', '/api/portal/login', { username: email, password: 'a-good-long-password', portal });

  console.log('\n== appointed, with no department yet ==');
  const media = await appoint('Kofi Media', 'media_head');
  check('a Media Head can be appointed before the Media department exists', media.r.status === 200, media.r.data);
  const shep = await appoint('Abena Shepherd', 'shepherding_head');
  const welfare = await appoint('Esi Welfare', 'welfare_head');
  const finsec = await appoint('Yaw Finance', 'financial_secretary');
  check('(and the others)', [shep, welfare, finsec].every(x => x.r.status === 200), [shep, welfare, finsec].map(x => x.r.data));
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; a.mustSetUpSecondStep = false; });

  await signIn('media', 'k1@example.com', 'media');
  let r = await call('media', 'GET', '/api/portal/me');
  check('the Media Head opens the Media portal', r.data.access && r.data.access.media && r.data.access.media.view, r.data.access && r.data.access.media);
  await signIn('shep', 'k2@example.com', 'shepherding');
  r = await call('shep', 'GET', '/api/portal/me');
  check('the Shepherding Head opens Shepherding', r.data.access && r.data.access.shepherding && r.data.access.shepherding.edit, r.data.access && r.data.access.shepherding);
  await signIn('welfare', 'k3@example.com', 'welfare');
  r = await call('welfare', 'GET', '/api/portal/me');
  check('the Welfare Head opens Welfare', r.data.access && r.data.access.welfare && r.data.access.welfare.view, r.data.access && r.data.access.welfare);
  await signIn('fin', 'k4@example.com', 'finance');
  r = await call('fin', 'GET', '/api/portal/me');
  check('the Financial Secretary opens Finance', r.data.access && r.data.access.finance && r.data.access.finance.view, r.data.access && r.data.access.finance);
  r = await call('shep', 'GET', '/api/portal/me');
  check('and none of them opens another office\'s portal', !r.data.access.finance.view && !r.data.access.welfare.view);
  const headAccount = fakeModels.StaffUser._docs.find(a => a.memberId === shep.id);
  check('each office comes with the executive\'s one-year term', !!headAccount.termEndsAt && !!headAccount.termYear, { termEndsAt: headAccount.termEndsAt });

  console.log('\n== they set up their own department ==');
  await signIn('mediaExec', 'k1@example.com', 'executive');
  r = await call('mediaExec', 'GET', '/api/executive/me');
  check('their portal knows they have no department yet', r.data.needsDepartment === true, r.data);
  r = await call('mediaExec', 'POST', '/api/executive/my-department', { name: '' });
  check('a department needs a name', r.status === 400);
  r = await call('mediaExec', 'POST', '/api/executive/my-department', { name: 'Media', tagline: 'Telling the chapter\'s story', description: 'Cameras, sound and the live stream.', meetingDay: 'Saturdays', meetingTime: '4:00pm', meetingLocation: 'Room 12' });
  check('the Media Head creates the Media department, with its description', r.status === 200 && r.data.department.name === 'Media', r.data);
  const dept = fakeModels.Department._docs.find(d => d.name === 'Media');
  check('it is saved in their chapter, with what they wrote', dept && dept.chapterId === C && dept.description === 'Cameras, sound and the live stream.' && dept.meetingDay === 'Saturdays');
  const card = fakeModels.Executive._docs.find(e => e.staffId === fakeModels.StaffUser._docs.find(a => a.memberId === media.id).id);
  check('and it is theirs: on their roster card and member record', card.department === dept.id && fakeModels.Member._docs.find(m => m.id === media.id).executiveDepartment === dept.id);
  r = await call(null, 'GET', '/api/departments');
  const listed = Array.isArray(r.data) && r.data.find(d => d.id === dept.id);
  check('the departments page lists it, with them as its head', !!listed && JSON.stringify(listed).includes('Kofi Media'), listed);
  r = await call('mediaExec', 'GET', '/api/executive/me');
  check('their portal no longer asks', r.data.needsDepartment === false && r.data.department && r.data.department.name === 'Media', r.data);
  r = await call('mediaExec', 'POST', '/api/executive/my-department', { name: 'Another' });
  check('and they cannot make a second one', r.status === 409);

  console.log('\n== an existing department nobody leads ==');
  const choir = (await call('admin', 'POST', '/api/admin/departments', { name: 'Choir', chapterId: C })).data.item;
  const music = await appoint('Ama Music', 'music_director');
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; a.mustSetUpSecondStep = false; });
  await signIn('music', 'k5@example.com', 'executive');
  r = await call('music', 'GET', '/api/executive/my-department/choices');
  check('they are offered the chapter\'s departments that have no head (Choir), not Media', Array.isArray(r.data) && r.data.some(d => d.id === choir.id) && !r.data.some(d => d.id === dept.id), r.data);
  r = await call('music', 'POST', '/api/executive/my-department', { name: 'choir' });
  check('making a second "Choir" is refused, pointing to the one there', r.status === 409 && /Choose it from the list/.test(r.data.error), r.data);
  r = await call('music', 'POST', '/api/executive/my-department', { departmentId: dept.id });
  check('taking a department that already has a head is refused', r.status === 409, r.data);
  r = await call('music', 'POST', '/api/executive/my-department', { departmentId: choir.id });
  check('taking Choir works', r.status === 200 && r.data.department.id === choir.id, r.data);
  check('(music)', !!music);

  console.log('\n== officers and others ==');
  const pres = await appoint('Kwame President', 'president');
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; a.mustSetUpSecondStep = false; });
  await signIn('pres', 'k6@example.com', 'executive');
  r = await call('pres', 'POST', '/api/executive/my-department', { name: 'Presidency' });
  check('an officer (the President) answers for the whole chapter and gets no department', r.status === 400, r.data);
  r = await call('member', 'POST', '/api/executive/my-department', { name: 'Sneaky' });
  check('nobody else can make one this way', r.status === 401 || r.status === 403);
  const withDept = await appoint('Efua Ushering', 'ushering_head', { department: 'not-a-department' });
  check('a department that is named must still be one of the chapter\'s', withDept.r.status === 400, withDept.r.data);
  check('(president)', !!pres);

  console.log(failures ? `\n${failures} FAILURES` : '\nall key office checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
