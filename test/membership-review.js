// Reviewing many new members at once: Shepherding ticks them and accepts and
// activates them in one step; each gets a membership number (never one already
// given) and a shepherd, shared evenly across the check-up team or all to one.
// Appointing an executive marks them Executive on their membership record, so
// Shepherding does not have to promote them first.
//
//   node test/membership-review.js     (also run by `npm test`)
const { fakeModels } = require('./harness.js');

(async () => {
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/aconsu_review', PORT: '4377', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 'test', LOGIN_RATE_LIMIT_MAX: '500' });
  delete process.env.SHEPHERD_USERNAME;
  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 600)}` : ''}`); }
  }
  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4377';
  const jars = {};
  async function call(jar, method, p, body) {
    const h = {};
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
  await call('admin', 'POST', '/api/national/chapters', { id: 'aconsu-ucc', name: 'ACONSU-UCC', institution: 'UCC' });
  let n = 0;
  async function member(name, chapterId) {
    n += 1;
    const f = new FormData();
    f.append('profileImage', new Blob([Buffer.from(name)], { type: 'image/png' }), 'me.png');
    Object.entries({ name, email: `r${n}@example.com`, phone: `02447000${String(n).padStart(2, '0')}`, password: 'secret123', chapterId: chapterId || C, consent: 'true' }).forEach(([k, v]) => f.append(k, v));
    return (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: f })).json()).member.id;
  }
  const doc = (id) => fakeModels.Member._docs.find(m => m.id === id);

  // Shepherding, and a check-up team of two.
  const shepLead = await member('Shepherd Lead');
  await call('admin', 'POST', '/api/admin/staff', { username: 'shep.knust', name: 'Shepherd Lead', role: 'shepherding', password: 'Office-Pass-12345', memberId: shepLead, chapterId: C });
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; a.mustSetUpSecondStep = false; });
  await call('shep', 'POST', '/api/portal/login', { username: 'shep.knust', password: 'Office-Pass-12345', portal: 'shepherding' });
  const ama = await member('Ama Team');
  const kofi = await member('Kofi Team');
  for (const id of [ama, kofi]) { doc(id).membershipStage = 'active'; doc(id).membershipNumber = ''; }
  let r = await call('shep', 'POST', '/api/shepherd/members/bulk-stage', { memberIds: [ama], stage: 'active', shepherd: 'share' });
  check('sharing out with nobody on the check-up team says to add people first', r.status === 400 && /check-up team/.test(r.data.error), r.data);
  for (const id of [ama, kofi]) {
    r = await call('shep', 'POST', '/api/shepherd/team', { memberId: id });
    if (r.status !== 200) console.log('   (team)', JSON.stringify(r.data));
  }

  console.log('\n== accept and activate many at once ==');
  const intake = [];
  for (let i = 1; i <= 6; i++) intake.push(await member(`New Member ${i}`));
  r = await call('shep', 'POST', '/api/shepherd/members/bulk-stage', { memberIds: intake, stage: 'active', shepherd: 'share' });
  check('six new members accepted and activated in one step', r.status === 200 && r.data.done.length === 6 && r.data.failed.length === 0, r.data);
  check('each is an active member now', intake.every(id => doc(id).membershipStage === 'active'));
  const numbers = intake.map(id => doc(id).membershipNumber);
  check('each has a membership number, all different', numbers.every(Boolean) && new Set(numbers).size === 6, numbers);
  const perShepherd = [ama, kofi].map(t => intake.filter(id => doc(id).shepherdMemberId === t).length);
  check('shared evenly across the check-up team (3 and 3)', perShepherd[0] === 3 && perShepherd[1] === 3, perShepherd);
  check('with the shepherd\'s name on each record', intake.every(id => ['Ama Team', 'Kofi Team'].includes(doc(id).shepherdName)));

  console.log('\n== the details ==');
  const more = [await member('Later One'), await member('Later Two')];
  r = await call('shep', 'POST', '/api/shepherd/members/bulk-stage', { memberIds: more, stage: 'active', shepherd: kofi });
  check('or all to one chosen shepherd', r.status === 200 && more.every(id => doc(id).shepherdMemberId === kofi), r.data);
  doc(intake[0]).membershipStage = 'worker';
  const late = await member('Late Joiner');
  r = await call('shep', 'POST', '/api/shepherd/members/bulk-stage', { memberIds: [late], stage: 'active', shepherd: 'share' });
  const all = fakeModels.Member._docs.filter(m => m.chapterId === C && m.membershipNumber).map(m => m.membershipNumber);
  check('a number is never given twice, even after someone moves on to Worker', new Set(all).size === all.length && doc(late).membershipNumber, all);
  check('and sharing still goes to whoever has the fewest', doc(late).shepherdMemberId === ama, { ama: doc(late).shepherdMemberId === ama });
  const kept = intake[1];
  const keptShepherd = doc(kept).shepherdMemberId;
  r = await call('shep', 'POST', '/api/shepherd/members/bulk-stage', { memberIds: [kept], stage: 'worker', shepherd: 'share' });
  check('someone who already has a shepherd keeps them', r.status === 200 && doc(kept).shepherdMemberId === keptShepherd && doc(kept).membershipStage === 'worker');
  const visitors = [await member('Visitor A'), await member('Visitor B')];
  r = await call('shep', 'POST', '/api/shepherd/members/bulk-stage', { memberIds: visitors, stage: 'under_review' });
  check('many can begin review together, with no shepherd yet', r.status === 200 && visitors.every(id => doc(id).membershipStage === 'under_review' && !doc(id).shepherdMemberId));
  const elsewhere = await member('Other Chapter', 'aconsu-ucc');
  r = await call('shep', 'POST', '/api/shepherd/members/bulk-stage', { memberIds: [visitors[0], elsewhere], stage: 'active', shepherd: 'share' });
  check('another chapter\'s member is left alone and reported, the rest done', r.status === 200 && r.data.done.length === 1 && r.data.failed.length === 1 && doc(elsewhere).membershipStage !== 'active', r.data);
  r = await call('shep', 'POST', '/api/shepherd/members/bulk-stage', { memberIds: [visitors[1]], stage: 'boss' });
  check('an unknown stage is refused', r.status === 400);
  r = await call('shep', 'POST', '/api/shepherd/members/bulk-stage', { memberIds: Array.from({ length: 301 }, (_, i) => `x${i}`), stage: 'active' });
  check('and so is more than 300 at a time', r.status === 400);
  r = await call(null, 'POST', '/api/shepherd/members/bulk-stage', { memberIds: [visitors[1]], stage: 'active' });
  check('nobody signed out can do it', r.status === 401);
  r = await call('shep', 'PATCH', `/api/shepherd/members/${visitors[1]}/stage`, { stage: 'active', shepherdMemberId: ama });
  check('one at a time still works as before', r.status === 200 && doc(visitors[1]).membershipStage === 'active' && doc(visitors[1]).shepherdMemberId === ama, r.data);

  console.log('\n== undoing a promotion made by mistake ==');
  const oops = intake[2];
  const before = { no: doc(oops).membershipNumber, shepherd: doc(oops).shepherdMemberId };
  r = await call('shep', 'PATCH', `/api/shepherd/members/${oops}/stage`, { stage: 'alumni' });
  check('(marked alumni by mistake)', r.status === 200 && doc(oops).membershipStage === 'alumni');
  r = await call('shep', 'PATCH', `/api/shepherd/members/${oops}/stage`, { stage: 'active' });
  check('brought back to active, with the same membership number and shepherd', r.status === 200 && doc(oops).membershipStage === 'active' && doc(oops).membershipNumber === before.no && doc(oops).shepherdMemberId === before.shepherd, { stage: doc(oops).membershipStage, before, after: { no: doc(oops).membershipNumber, shepherd: doc(oops).shepherdMemberId } });

  console.log('\n== appointing executives ==');
  const president = await member('Straight To President');
  r = await call('admin', 'POST', '/api/admin/staff', { role: 'executive', positionKey: 'president', memberId: president, chapterId: C });
  check('a member can be appointed straight away, without Shepherding promoting them first', r.status === 200 && r.data.issued && r.data.issued.username, r.data);
  check('with no name typed, the account takes the name on their member record', fakeModels.StaffUser._docs.some(a => a.memberId === president && a.name === 'Straight To President'));
  check('and their membership record now says Executive, with a membership number', doc(president).membershipStage === 'executive' && !!doc(president).membershipNumber, { stage: doc(president).membershipStage, no: doc(president).membershipNumber });
  const marked = await member('Marked By Shepherding');
  await call('shep', 'PATCH', `/api/shepherd/members/${marked}/stage`, { stage: 'executive' });
  r = await call('admin', 'GET', `/api/coordinator/pending-executives?chapterId=${C}`);
  check('someone Shepherding marked an Executive waits for the Coordinator', Array.isArray(r.data) && r.data.some(w => w.id === marked) && !r.data.some(w => w.id === president), r.data);
  r = await call('admin', 'POST', '/api/admin/staff', { name: 'Marked By Shepherding', role: 'executive', positionKey: 'general_secretary', memberId: marked, chapterId: C });
  r = await call('admin', 'GET', `/api/coordinator/pending-executives?chapterId=${C}`);
  check('and leaves the list once appointed', Array.isArray(r.data) && !r.data.some(w => w.id === marked), r.data);

  console.log(failures ? `\n${failures} FAILURES` : '\nall membership review checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
