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
  // Accounts made for the password-change checks below are taken as past their
  // first sign-in. The first sign-in itself is tested on its own further down,
  // on the accounts named in `firstSignIn`.
  const firstSignIn = new Set();
  const login = (jar, username, password) => {
    const doc = fakeModels.StaffUser._docs.find(a => a.username === username);
    if (doc && !firstSignIn.has(username)) doc.mustChangePassword = false;
    return call(jar, 'POST', '/api/portal/login', { username, password });
  };

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

  console.log('\n== an executive office comes with its own login ==');
  await call('coord', 'POST', '/api/portal/login', { username: 'coord.one', password: 'Start-Pass-1' });
  const vpMember = await member('Efua Vice');
  r = await call('admin', 'POST', '/api/admin/staff', { role: 'executive', positionKey: 'vice_president', memberId: vpMember, chapterId: C });
  check('appointing an executive without a username or password issues the office\'s own login',
    r.status === 200 && r.data.issued && r.data.issued.username === 'vicepresident.knust' && r.data.issued.password === 'vicepresident123', r.data);
  check('named after the member', r.data.item && r.data.item.name === 'Efua Vice', r.data.item);
  const vp = fakeModels.StaffUser._docs.find(a => a.username === 'vicepresident.knust');
  check('and it must be changed at the first sign-in, within 14 days', vp.mustChangePassword === true && new Date(vp.startingPasswordExpiresAt) > new Date(Date.now() + 13 * 86400000), vp);
  firstSignIn.add('vicepresident.knust');
  r = await login('vp', 'vicepresident.knust', 'vicepresident123');
  check('the Vice President signs in with the starting password', r.status === 200 && r.data.mustChangePassword === true, r.data);
  r = await call('vp', 'GET', '/api/portal/me');
  check('the portal is told a password must be chosen first', r.status === 200 && r.data.staff && r.data.staff.mustChangePassword === true, r.data);
  for (const [m, path, body] of [['GET', '/api/executive/me'], ['GET', '/api/executive/chapter/finance'], ['GET', '/api/executive/minutes'], ['POST', '/api/portal/password', { currentPassword: 'vicepresident123', newPassword: 'Any Good Phrase 1' }], ['POST', '/api/portal/sign-out-others']]) {
    r = await call('vp', m, path, body);
    check(`with only the starting password, ${m} ${path} stays shut`, r.status === 401, r);
  }
  r = await call('vp', 'GET', '/api/portal/account');
  check('it may see its own account, to be greeted by office', r.status === 200 && r.data.office === 'Vice President' && r.data.mustChangePassword === true && r.data.hasMemberEmail === true, r.data);
  const firstPw = (jar, email, newPassword) => call(jar, 'POST', '/api/portal/first-password', { email, newPassword });
  r = await firstPw('vp', '', 'Steady Hands 2026');
  check('choosing a password asks for the email on the member profile', r.status === 400 && /email/.test(r.data.error), r.data);
  r = await firstPw('vp', 'someone.else@test.com', 'Steady Hands 2026');
  check('and refuses someone else\'s', r.status === 400 && /not the email/.test(r.data.error), r.data);
  const vpEmail = fakeModels.Member._docs.find(m => m.id === vpMember).email;
  r = await firstPw('vp', vpEmail.toUpperCase(), 'vicepresident123');
  check('the starting password cannot be kept', r.status === 400 && /starting password/.test(r.data.error), r.data);
  r = await firstPw('vp', vpEmail, 'password123');
  check('a very common one is turned away', r.status === 400, r.data);
  r = await firstPw('vp', ' ' + vpEmail.toUpperCase() + ' ', 'Steady Hands 2026');
  check('with the right email (in any case) and a good password it is saved', r.status === 200, r.data);
  r = await call('vp', 'GET', '/api/executive/me');
  check('and the same session now opens the portal', r.status === 200 && r.data.position.key === 'vice_president', r);
  r = await firstPw('vp', vpEmail, 'Another Phrase 99');
  check('the first-sign-in step cannot be used again', r.status === 400, r.data);
  check('the starting password no longer signs in', (await login('vpOld', 'vicepresident.knust', 'vicepresident123')).status === 401);
  check('the chosen one does, straight into the portal', (await login('vpNew', 'vicepresident.knust', 'Steady Hands 2026')).data.mustChangePassword === false);
  const vpAfter = fakeModels.StaffUser._docs.find(a => a.username === 'vicepresident.knust');
  check('and the account now records a password of its own', vpAfter.mustChangePassword === false && !!vpAfter.passwordChangedAt && vpAfter.startingPasswordExpiresAt === null, vpAfter);

  console.log('\n== every chapter has its own office logins ==');
  await call('admin', 'POST', '/api/national/chapters', { id: 'ucc', name: 'ACONSU-UCC', institution: 'UCC' });
  await call('admin', 'POST', '/api/national/chapters', { id: 'aconsu-knust', name: 'ACONSU KNUST Annex', institution: 'KNUST Annex' });
  const memberIn = async (name, chapterId) => {
    counter += 1;
    const fd = new FormData();
    fd.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
    fd.append('name', name); fd.append('email', `acct${counter}@test.com`);
    fd.append('password', 'secret123'); fd.append('chapterId', chapterId);
    return (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd })).json()).member.id;
  };
  r = await call('admin', 'POST', '/api/admin/staff', { role: 'executive', positionKey: 'vice_president', memberId: await memberIn('UCC Vice', 'ucc'), chapterId: 'ucc' });
  check('another chapter\'s Vice President gets a login of their own chapter', r.status === 200 && r.data.issued.username === 'vicepresident.ucc', r.data);
  r = await call('admin', 'POST', '/api/admin/staff', { role: 'executive', positionKey: 'vice_president', memberId: await memberIn('Annex Vice', 'aconsu-knust'), chapterId: 'aconsu-knust' });
  check('two chapters whose short names match never share a login', r.status === 200 && r.data.issued.username !== 'vicepresident.knust' && /^vicepresident\./.test(r.data.issued.username), r.data);
  firstSignIn.add('vicepresident.ucc');
  r = await login('uccVp', 'vicepresident.ucc', 'vicepresident123');
  r = await call('uccVp', 'POST', '/api/portal/first-password', { email: vpEmail, newPassword: 'Steady Hands 2026' });
  check('nor can one chapter\'s office holder finish another\'s first sign-in with their own email', r.status === 400, r.data);

  console.log('\n== an unclaimed starting password expires ==');
  const uccVp = fakeModels.StaffUser._docs.find(a => a.username === 'vicepresident.ucc');
  uccVp.startingPasswordExpiresAt = new Date(Date.now() - 1000).toISOString();
  r = await login('uccLate', 'vicepresident.ucc', 'vicepresident123');
  check('once its 14 days are up it no longer signs in, and says to ask for a reset', r.status === 403 && /expired/.test(r.data.error), r.data);

  console.log('\n== the Coordinator puts the starting password back ==');
  r = await call('coord', 'GET', '/api/coordinator/offices');
  const vpRow = r.data.items.find(o => o.key === 'vice_president');
  check('Key offices shows who has chosen a password and who has not', vpRow.holder.awaitingFirstSignIn === false, vpRow.holder);
  r = await call('coord', 'POST', '/api/coordinator/offices/reset-password', { staffId: vpAfter.id });
  check('the Coordinator resets the Vice President to the starting password', r.status === 200 && r.data.issued.username === 'vicepresident.knust' && r.data.issued.password === 'vicepresident123', r.data);
  check('which signs out the Vice President everywhere', (await call('vpNew', 'GET', '/api/executive/me')).status === 401);
  check('and their own password stops working', (await login('vpX', 'vicepresident.knust', 'Steady Hands 2026')).status === 401);
  r = await login('vpBack', 'vicepresident.knust', 'vicepresident123');
  check('the starting password works again, for choosing a new one only', r.status === 200 && r.data.mustChangePassword === true, r.data);
  r = await call('coord', 'GET', '/api/coordinator/offices');
  check('and Key offices shows they have not chosen one yet', r.data.items.find(o => o.key === 'vice_president').holder.awaitingFirstSignIn === true);
  r = await call('coord', 'POST', '/api/coordinator/offices/reset-password', { staffId: uccVp.id });
  check('a Coordinator cannot reset another chapter\'s office', r.status === 404, r.data);
  r = await call('fin', 'POST', '/api/coordinator/offices/reset-password', { staffId: vpAfter.id });
  check('nor can anyone but the Coordinator', r.status === 401 || r.status === 403, r);
  r = await call('admin', 'PUT', `/api/admin/staff/${pres.id}`, { password: 'Reset-By-Coordinator-2' });
  const presAfter = fakeModels.StaffUser._docs.find(a => a.id === pres.id);
  check('a password set for an executive by someone else must also be changed at the next sign-in', presAfter.mustChangePassword === true, presAfter);
  presAfter.mustChangePassword = false; // back to how the next section expects it

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
