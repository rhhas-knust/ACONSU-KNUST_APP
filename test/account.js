// A leader's own account: the page that shows who they are, and changing their own
// password. Boots the real app on the in-memory data layer, like smoke.js.
//
//   node test/account.js     (also run by `npm test`)
const { fakeModels } = require('./harness.js');
{
  const realFetch = global.fetch;
  global.fetch = (url, opts) => {
    if (/\/api\/auth\/register$/.test(String(url)) && opts && opts.body instanceof FormData && !opts.body.has('consent')) opts.body.append('consent', 'true');
    return realFetch(url, opts);
  };
}

(async () => {
  process.env.MONGODB_URI = 'mongodb://stub/aconsu_account';
  process.env.PORT = '4323';
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'admin123';
  process.env.SESSION_SECRET = 'test';
  process.env.LOGIN_RATE_LIMIT_MAX = '40'; // the password limiter shares this setting; the suite stays well under it until it means to hit it
  delete process.env.SHEPHERD_USERNAME;
  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));

  const BASE = 'http://127.0.0.1:4323';
  let failures = 0;
  const jars = {};
  async function call(jar, method, path, body) {
    const headers = {};
    if (jars[jar]) headers.cookie = jars[jar];
    let payload;
    if (body) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + path, { method, headers, body: payload });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (setCookie.length) jars[jar] = setCookie.map(c => c.split(';')[0]).join('; ');
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: res.status, data };
  }
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail ? ` - ${JSON.stringify(detail).slice(0, 300)}` : ''}`); }
  }
  const login = (jar, username, password) => call(jar, 'POST', '/api/portal/login', { username, password });

  console.log('\n== setting up ==');
  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  const C = 'knust';
  await call('admin', 'POST', '/api/national/chapters', { id: C, name: 'ACONSU-KNUST', institution: 'KNUST' });
  let counter = 0;
  async function member(name) {
    counter += 1;
    const fd = new FormData();
    fd.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
    fd.append('name', name); fd.append('email', `acct${counter}@test.com`);
    fd.append('password', 'secret123'); fd.append('chapterId', C);
    return (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd })).json()).member.id;
  }
  const dept = (await call('admin', 'POST', '/api/admin/departments', { name: 'Choir', chapterId: C })).data.item.id;
  const made = async (username, name, role, extra) => (await call('admin', 'POST', '/api/admin/staff', {
    username, name, role, password: 'Start-Pass-1', memberId: await member(name), chapterId: C, ...(extra || {})
  })).data.item;
  const pres = await made('exec.pres', 'Yaw President', 'executive', { positionKey: 'president' });
  await made('exec.choir', 'Ama Choir', 'executive', { positionKey: 'music_director', department: dept });
  await made('fin.one', 'Finance One', 'finance');
  const coord = await made('coord.one', 'Coordinator One', 'coordinator');
  check('every leader signs in with their starting password',
    [(await login('pres', 'exec.pres', 'Start-Pass-1')).status, (await login('choir', 'exec.choir', 'Start-Pass-1')).status,
      (await login('fin', 'fin.one', 'Start-Pass-1')).status, (await login('coord', 'coord.one', 'Start-Pass-1')).status].every(s => s === 200));

  console.log('\n== the account page ==');
  let r = await call('anon', 'GET', '/api/portal/account');
  check('a visitor who is not signed in gets nothing', r.status === 401, r);
  r = await call('pres', 'GET', '/api/portal/account');
  check('the President sees their name, username and office',
    r.status === 200 && r.data.editable === true && r.data.name === 'Yaw President' && r.data.username === 'exec.pres' && r.data.office === 'President', r.data);
  check('their chapter and their term', r.data.chapter.name === 'ACONSU-KNUST' && !!r.data.termYear && r.data.daysLeft > 0, r.data);
  check('and that the password is still the one the Coordinator chose', r.data.usingStartingPassword === true && r.data.passwordChangedAt === null, r.data);
  check('no credential material is in the answer', !('passwordHash' in r.data) && !/\$2[aby]\$/.test(JSON.stringify(r.data)), r.data);
  r = await call('choir', 'GET', '/api/portal/account');
  check('a department head sees their department too', r.data.office === 'Music Director' && r.data.department === 'Choir', r.data);
  r = await call('fin', 'GET', '/api/portal/account');
  check('a Finance officer has an account page as well', r.data.editable === true && r.data.roleLabel && r.data.office === '', r.data);
  r = await call('admin', 'POST', '/api/portal/login', { username: 'admin', password: 'admin123' });
  r = await call('admin', 'GET', '/api/portal/account');
  check('the administrator login is shown, but has nothing to change', r.status === 200 && r.data.editable === false, r.data);
  r = await call('admin', 'POST', '/api/portal/password', { currentPassword: 'admin123', newPassword: 'Another-Phrase-9' });
  check('and its password cannot be changed from the portal', r.status === 400 && /settings/.test(r.data.error), r.data);

  console.log('\n== changing the password ==');
  const change = (jar, currentPassword, newPassword) => call(jar, 'POST', '/api/portal/password', { currentPassword, newPassword });
  r = await call('anon', 'POST', '/api/portal/password', { currentPassword: 'x', newPassword: 'yyyyyyyyy' });
  check('a visitor cannot change anyone\'s password', r.status === 401, r);
  r = await change('pres', '', 'Rooted-In-Him-77');
  check('the current password has to be given', r.status === 400, r.data);
  r = await change('pres', 'Start-Pass-1', '');
  check('and a new one', r.status === 400, r.data);
  r = await change('pres', 'not-my-password', 'Rooted-In-Him-77');
  check('a wrong current password is refused', r.status === 401 && /not right/.test(r.data.error), r.data);
  check('and changes nothing: the old password still signs in', (await login('probe', 'exec.pres', 'Start-Pass-1')).status === 200);
  r = await change('pres', 'not-my-password', 'short');
  check('the new password is judged only once the current one is proved', r.status === 401, r.data);
  for (const [label, pw, expect] of [
    ['too short', 'Short1', /at least 8/],
    ['a common password', 'password123', /first that anyone would try/],
    ['a run of digits', '12345678', /run like/],
    ['one repeated character', 'aaaaaaaaaa', /repeated/],
    ['the username inside it', 'Exec.Pres-2026!', /username/],
    ['spaces at either end', ' Rooted In Him 7', /spaces/],
    ['longer than bcrypt reads', 'Q9' + 'x'.repeat(80), /72/],
    ['the same as the current one', 'Start-Pass-1', /different/]
  ]) {
    r = await change('pres', 'Start-Pass-1', pw);
    check(`a new password that is ${label} is turned away, and says why`, r.status === 400 && expect.test(r.data.error), r.data);
  }
  check('none of those changed the password', (await login('probe', 'exec.pres', 'Start-Pass-1')).status === 200);

  // A second device signed in before the change.
  await login('presPhone', 'exec.pres', 'Start-Pass-1');
  check('the President is signed in on a second device', (await call('presPhone', 'GET', '/api/portal/account')).status === 200);
  r = await change('pres', 'Start-Pass-1', 'Rooted In Him 77');
  check('a good new password is accepted', r.status === 200, r.data);
  r = await call('pres', 'GET', '/api/portal/account');
  check('this device stays signed in', r.status === 200 && r.data.usingStartingPassword === false && !!r.data.passwordChangedAt, r.data);
  r = await call('presPhone', 'GET', '/api/portal/account');
  check('the other device is signed out at once', r.status === 401, r);
  r = await call('presPhone', 'GET', '/api/executive/outline');
  check('and cannot reach the President\'s work either', r.status === 401, r);
  check('the old password no longer signs in', (await login('probe2', 'exec.pres', 'Start-Pass-1')).status === 401);
  check('the new one does', (await login('probe3', 'exec.pres', 'Rooted In Him 77')).status === 200);
  const stored = fakeModels.StaffUser._docs.find(a => a.id === pres.id);
  check('what is stored is a hash, not the password', !!stored.passwordHash && !stored.passwordHash.includes('Rooted') && /^\$2[aby]\$/.test(stored.passwordHash), stored.passwordHash && stored.passwordHash.slice(0, 7));
  r = await call('pres', 'GET', '/api/executive/me');
  check('and the President\'s portal carries on working', r.status === 200, r);

  console.log('\n== signing out of the other devices ==');
  await login('d1', 'exec.choir', 'Start-Pass-1');
  await login('d2', 'exec.choir', 'Start-Pass-1');
  r = await call('d1', 'POST', '/api/portal/sign-out-others');
  check('one device signs the others out', r.status === 200, r.data);
  check('it stays in itself', (await call('d1', 'GET', '/api/portal/account')).status === 200);
  check('and the other is out', (await call('d2', 'GET', '/api/portal/account')).status === 401);
  check('a visitor cannot do it', (await call('anon', 'POST', '/api/portal/sign-out-others')).status === 401);

  console.log('\n== every kind of leader ==');
  r = await change('fin', 'Start-Pass-1', 'Budget Keeper 2026!');
  check('a Finance officer changes their own password', r.status === 200, r.data);
  check('and signs in with it', (await login('finAgain', 'fin.one', 'Budget Keeper 2026!')).status === 200);
  await login('choir', 'exec.choir', 'Start-Pass-1'); // the earlier sign-out-others ended this jar's first session
  r = await change('choir', 'Start-Pass-1', 'Hymns Of Praise 88');
  check('a department head changes theirs', r.status === 200, r.data);
  check('and nobody else\'s moved', (await login('presCheck', 'exec.pres', 'Rooted In Him 77')).status === 200);

  console.log('\n== when the Coordinator resets it ==');
  r = await call('admin', 'PUT', `/api/admin/staff/${pres.id}`, { password: 'Reset-By-Coordinator-1' });
  check('the Coordinator can still reset a leader\'s password', r.status === 200, r.data);
  r = await login('afterReset', 'exec.pres', 'Reset-By-Coordinator-1');
  r = await call('afterReset', 'GET', '/api/portal/account');
  check('and it counts as a starting password again, until its owner changes it', r.data.usingStartingPassword === true && r.data.passwordChangedAt === null, r.data);

  console.log('\n== guessing the current password ==');
  let limited = null;
  for (let i = 0; i < 45 && !limited; i += 1) {
    const x = await change('afterReset', 'guess-' + i, 'Whatever-Else-12');
    if (x.status === 429) limited = x;
  }
  check('guessing the current password is slowed down', !!limited && /Too many/.test(JSON.stringify(limited.data)), limited);

  console.log(failures ? `\n${failures} check(s) failed` : '\nall account checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
