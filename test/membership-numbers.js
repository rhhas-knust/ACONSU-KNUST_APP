// No two members share a membership number, even when several are accepted
// at the same moment; numbers already given twice are mended, the first
// holder keeping theirs.
//
//   node test/membership-numbers.js     (also run by `npm test`)
const { fakeModels } = require('./harness.js');

(async () => {
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/aconsu_numbers', PORT: '4383', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 'test', LOGIN_RATE_LIMIT_MAX: '500' });
  delete process.env.SHEPHERD_USERNAME;
  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 600)}` : ''}`); }
  }
  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4383';
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
    Object.entries({ name, email: `n${n}@example.com`, phone: `02448000${String(n).padStart(2, '0')}`, password: 'secret123', chapterId: chapterId || C, consent: 'true', joiningAs: 'visitor' }).forEach(([k, v]) => f.append(k, v));
    return (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: f })).json()).member.id;
  }
  const doc = (id) => fakeModels.Member._docs.find(m => m.id === id);

  const lead = await member('Shepherd Lead');
  await call('admin', 'POST', '/api/admin/staff', { username: 'shep.knust', name: 'Shepherd Lead', role: 'shepherding', password: 'Office-Pass-12345', memberId: lead, chapterId: C });
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; a.mustSetUpSecondStep = false; });
  await call('shep', 'POST', '/api/portal/login', { username: 'shep.knust', password: 'Office-Pass-12345', portal: 'shepherding' });

  console.log('\n== the counter starts from what is already given ==');
  const old = await member('Already Numbered');
  doc(old).membershipNumber = 'ACONSU-KNUST-0040';
  doc(old).membershipStage = 'active';
  const first = await member('First New');
  let r = await call('shep', 'PATCH', `/api/shepherd/members/${first}/stage`, { stage: 'active' });
  check('the next number follows the highest one given, so none is reused', r.status === 200 && doc(first).membershipNumber === 'ACONSU-KNUST-0041', doc(first).membershipNumber);

  console.log('\n== many at the same moment ==');
  const people = [];
  for (let i = 0; i < 8; i += 1) people.push(await member(`Person ${i}`));
  const more = [];
  for (let i = 0; i < 6; i += 1) more.push(await member(`Batch ${i}`));
  // Every read now takes a while to come back, as over a network: requests
  // made together overlap, which is exactly when the old way gave a number twice.
  fakeModels.Member.findDelayMs = 25;
  fakeModels.Counter.findDelayMs = 25;
  await Promise.all([
    ...people.map(id => call('shep', 'PATCH', `/api/shepherd/members/${id}/stage`, { stage: 'active' })),
    call('shep', 'POST', '/api/shepherd/members/bulk-stage', { memberIds: more.slice(0, 3), stage: 'active' }),
    call('shep', 'POST', '/api/shepherd/members/bulk-stage', { memberIds: more.slice(3), stage: 'active' })
  ]);
  fakeModels.Member.findDelayMs = 0;
  fakeModels.Counter.findDelayMs = 0;
  const numbers = [first, ...people, ...more].map(id => doc(id).membershipNumber);
  check('everyone accepted at once has a number', numbers.every(Boolean), numbers);
  check('and no two are the same', new Set(numbers).size === numbers.length, numbers);
  check('they run on without gaps from 0041', [...numbers].sort().join() === Array.from({ length: numbers.length }, (_, i) => `ACONSU-KNUST-${String(41 + i).padStart(4, '0')}`).join(), [...numbers].sort());

  console.log('\n== each chapter counts for itself ==');
  const ucc = await member('UCC Member', 'aconsu-ucc');
  const numbers2 = require('../lib/membershipNumbers').create({ models: fakeModels });
  doc(ucc).membershipNumber = await numbers2.next('aconsu-ucc');
  check('another chapter starts at its own 0001', doc(ucc).membershipNumber === 'ACONSU-UCC-0001', doc(ucc).membershipNumber);

  console.log('\n== numbers already given twice ==');
  const a = await member('Had It First');
  const b = await member('Had It Second');
  doc(a).membershipNumber = 'ACONSU-KNUST-0007'; doc(a).createdAt = '2026-01-01T00:00:00.000Z';
  doc(b).membershipNumber = 'ACONSU-KNUST-0007'; doc(b).createdAt = '2026-02-01T00:00:00.000Z';
  const changed = await numbers2.repairDuplicates();
  check('the first to have it keeps it', doc(a).membershipNumber === 'ACONSU-KNUST-0007');
  check('the other is given a new number, and their old one is kept on their record',
    doc(b).membershipNumber !== 'ACONSU-KNUST-0007' && /^ACONSU-KNUST-\d{4}$/.test(doc(b).membershipNumber) && doc(b).previousMembershipNumbers.includes('ACONSU-KNUST-0007'), doc(b));
  check('it says what it changed', changed.length === 1 && changed[0].from === 'ACONSU-KNUST-0007' && changed[0].id === b, changed);
  const all = fakeModels.Member._docs.filter(m => m.membershipNumber).map(m => `${m.chapterId}:${m.membershipNumber}`);
  check('no number is now held twice', new Set(all).size === all.length, all);
  check('running it again changes nothing', (await numbers2.repairDuplicates()).length === 0);

  console.log(failures ? `\n${failures} FAILURES` : '\nall membership number checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
