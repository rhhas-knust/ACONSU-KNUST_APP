// Signing up as a member, a visitor or one of the alumni, and the level that
// moves up by itself every 1 August.
//
//   node test/signup-kinds.js     (also run by `npm test`)
const { fakeModels } = require('./harness.js');
const studyYear = require('../lib/studyYear');

(async () => {
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/aconsu_signup_kinds', PORT: '4385', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 'test', LOGIN_RATE_LIMIT_MAX: '500' });
  delete process.env.SHEPHERD_USERNAME;
  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 600)}` : ''}`); }
  }

  console.log('\n== the level, year by year ==');
  check('the academic year turns on 1 August', studyYear.academicYearOf(new Date('2027-07-31T12:00:00Z')) === '2026/2027' && studyYear.academicYearOf(new Date('2027-08-01T12:00:00Z')) === '2027/2028');
  check('200 becomes 300, in whatever way it was typed', studyYear.bump('200', 1) === '300' && studyYear.bump('Level 200', 1) === 'Level 300' && studyYear.bump('L200', 2) === 'L400');
  check('"Year 2" and "2" move on too', studyYear.bump('Year 2', 1) === 'Year 3' && studyYear.bump('2', 1) === '3');
  check('it stops at the longest courses (600, Year 6)', studyYear.bump('500', 3) === '600' && studyYear.bump('Year 6', 1) === 'Year 6');
  check('a level it cannot read is left alone', studyYear.bump('Final year', 1) === null && studyYear.bump('MPhil', 1) === null);

  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4385';
  const C = 'aconsu-knust';
  await fetch(BASE + '/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123' }) })
    .then(async (r) => {
      const jar = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
      await fetch(BASE + '/api/national/chapters', { method: 'POST', headers: { 'content-type': 'application/json', cookie: jar }, body: JSON.stringify({ id: C, name: 'ACONSU-KNUST', institution: 'KNUST' }) });
    });
  let n = 0;
  async function signUp(fields) {
    n += 1;
    const f = new FormData();
    f.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'me.png');
    Object.entries({ name: `Person ${n}`, phone: `02445500${String(n).padStart(2, '0')}`, password: 'a-good-long-password', chapterId: C, consent: 'true', ...fields }).forEach(([k, v]) => f.append(k, v));
    const res = await fetch(BASE + '/api/auth/register', { method: 'POST', body: f });
    const data = await res.json();
    return { status: res.status, doc: data.member && fakeModels.Member._docs.find(m => m.id === data.member.id), data };
  }

  console.log('\n== joining ==');
  const member = await signUp({ joiningAs: 'member', level: '100' });
  check('a member is in at once, with a membership number', member.doc.membershipStage === 'active' && member.doc.membershipNumber === 'ACONSU-KNUST-0001', member.doc);
  const visitor = await signUp({ joiningAs: 'visitor' });
  check('a visitor starts as a visitor, without a number', visitor.doc.membershipStage === 'visitor' && !visitor.doc.membershipNumber, visitor.doc);
  const alum = await signUp({ joiningAs: 'alumni', graduationYear: '2019', level: '400' });
  check('one of the alumni is alumni at once, with the year they finished and a number', alum.doc.membershipStage === 'alumni' && alum.doc.registeredAsAlumni === true
    && alum.doc.graduationYear === '2019' && /^ACONSU-KNUST-\d{4}$/.test(alum.doc.membershipNumber) && alum.doc.level === '', alum.doc);
  const plain = await signUp({});
  check('saying nothing makes you a member', plain.doc.membershipStage === 'active', plain.doc.membershipStage);
  const odd = await signUp({ joiningAs: 'executive' });
  check('nobody can sign themselves up as anything else', odd.doc.membershipStage === 'active', odd.doc.membershipStage);

  console.log('\n== every 1 August ==');
  const before = studyYear.academicYearOf(new Date());
  check('the level given at sign-up is dated to this academic year', member.doc.levelAcademicYear === before, member.doc.levelAcademicYear);
  // A year on: 1 September next year.
  const nextYear = new Date(new Date().getFullYear() + (new Date().getMonth() + 1 >= 8 ? 1 : 0), 8, 1);
  const old = fakeModels.Member._docs.find(m => m.id === visitor.doc.id);
  old.level = 'Level 300'; old.levelAcademicYear = ''; // a level from before this was dated
  const changed = await studyYear.rollLevels({ models: fakeModels, now: nextYear });
  const after = fakeModels.Member._docs.find(m => m.id === member.doc.id);
  check('a year on, Level 100 is Level 200, and the old level is kept in the history', after.level === '200' && after.levelAcademicYear === studyYear.academicYearOf(nextYear)
    && after.academicHistory.some(h => h.level === '100'), after);
  check('a level that was never dated starts counting now rather than jumping', old.level === 'Level 300' && old.levelAcademicYear === studyYear.academicYearOf(nextYear), old);
  check('the alumni are not moved', fakeModels.Member._docs.find(m => m.id === alum.doc.id).level === '');
  check('it says what it changed', changed.length === 1 && changed[0].to === '200', changed);
  check('running it again the same year changes nothing', (await studyYear.rollLevels({ models: fakeModels, now: nextYear })).length === 0);

  console.log(failures ? `\n${failures} FAILURES` : '\nall sign-up checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
