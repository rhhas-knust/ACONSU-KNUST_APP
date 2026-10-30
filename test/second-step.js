// A second step at sign-in for the leaders who can reach money, welfare,
// shepherding, coordinator or national records; an account that rests after
// wrong tries; and leaders' passwords of 12 characters.
//
//   node test/second-step.js     (also run by `npm test`)
const { fakeModels } = require('./harness.js');
const totp = require('../lib/totp');
const secondStep = require('../lib/secondStep');

(async () => {
  process.env.MONGODB_URI = 'mongodb://stub/aconsu_second_step';
  process.env.PORT = '4340';
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'admin123';
  process.env.SESSION_SECRET = 'test';
  process.env.LOGIN_RATE_LIMIT_MAX = '500';
  delete process.env.ENFORCE_LEADER_2FA;
  delete process.env.SHEPHERD_USERNAME;

  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 400)}` : ''}`); }
  }

  console.log('\n== the codes are the standard ones ==');
  {
    // RFC 6238 appendix B (SHA-1) and RFC 4226 appendix D, last six digits.
    const key = Buffer.from('12345678901234567890');
    const secret = totp.base32Encode(key);
    const rfc6238 = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
    check('every RFC 6238 test value', rfc6238.every(([t, c]) => totp.codeAt(secret, t * 1000) === c.slice(-6)));
    check('every RFC 4226 test value', ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'].every((c, i) => totp.hotp(key, i) === c));
    check('base32 goes there and back', totp.base32Decode(totp.base32Encode(key)).equals(key));
    const s = totp.generateSecret();
    const now = Date.now();
    check('a code is good for its 30 seconds and one step either side', totp.verify(s, totp.codeAt(s, now), { now }) > 0
      && totp.verify(s, totp.codeAt(s, now - 30000), { now }) > 0 && totp.verify(s, totp.codeAt(s, now + 30000), { now }) > 0);
    check('but not two steps away', totp.verify(s, totp.codeAt(s, now - 61000), { now }) === 0);
    check('and never twice', totp.verify(s, totp.codeAt(s, now), { now, lastStep: totp.stepAt(now) }) === 0);
    check('anything but six digits is not a code', ['', '12345', '1234567', 'abcdef', null].every(c => totp.verify(s, c, { now }) === 0));
    const sealed = totp.seal(s);
    check('the secret is kept sealed, and only this server\'s key opens it', !sealed.includes(s) && totp.open(sealed) === s && totp.open(sealed, { SESSION_SECRET: 'another' }) === '');
    const codes = totp.makeRecoveryCodes();
    check('ten recovery codes, all different, kept only as hashes', codes.length === 10 && new Set(codes).size === 10 && /^[A-Z2-7]{4}-[A-Z2-7]{4}$/.test(codes[0])
      && totp.hashRecovery(codes[0].toLowerCase().replace('-', ' ')) === totp.hashRecovery(codes[0]) && !totp.hashRecovery(codes[0]).includes(codes[0].slice(0, 4)));
  }

  console.log('\n== who needs it ==');
  check('Coordinators, chapter admins, finance, shepherding, welfare and national do',
    ['nationalCoordinator', 'coordinator', 'chapterAdmin', 'finance', 'shepherding', 'welfare'].every(role => secondStep.requiredFor({ role })));
  check('so do the Treasurer, the Financial Secretary and the President, who reach the books',
    ['treasurer', 'financial_secretary', 'president'].every(positionKey => secondStep.requiredFor({ role: 'executive', positionKey })));
  check('a Music Director or Publicity does not have to (but may)', !secondStep.requiredFor({ role: 'executive', positionKey: 'music_director' }) && !secondStep.requiredFor({ role: 'publicity' }));
  {
    const DAY = 86400000;
    const now = Date.now();
    const acct = { role: 'finance', createdAt: new Date(now - 100 * DAY) };
    const env = { ENFORCE_LEADER_2FA: 'on' };
    check('not switched on: nobody is made to', secondStep.standing(acct, { since: new Date(now), env: {} }).deadline === null);
    let st = secondStep.standing(acct, { since: new Date(now - 3 * DAY), now, env });
    check('switched on 3 days ago: 11 days left, still free to use the portal', st.daysLeft === 11 && !st.mustSetUpNow, st);
    st = secondStep.standing(acct, { since: new Date(now - 15 * DAY), now, env });
    check('after 14 days: the setup screen only', st.mustSetUpNow, st);
    st = secondStep.standing({ ...acct, createdAt: new Date(now - 2 * DAY) }, { since: new Date(now - 30 * DAY), now, env });
    check('an account made later gets its own 14 days', st.daysLeft === 12 && !st.mustSetUpNow, st);
    check('set up already: nothing to do', secondStep.standing({ ...acct, totpEnabledAt: new Date() }, { since: new Date(now - 30 * DAY), now, env }).mustSetUpNow === false);
    let a = {};
    const lockedAt = [];
    for (let i = 1; i <= 9; i += 1) { a = { ...a, ...secondStep.afterWrongTry(a, now) }; lockedAt.push(a.lockedUntil ? Math.round((new Date(a.lockedUntil) - now) / 60000) : 0); }
    check('four wrong tries cost nothing; then 1, 2, 4, 8, 16 minutes', lockedAt.join() === '0,0,0,0,1,2,4,8,16', lockedAt);
    for (let i = 0; i < 10; i += 1) a = { ...a, ...secondStep.afterWrongTry(a, now) };
    check('never more than an hour', secondStep.lockedFor(a, now) === 60, secondStep.lockedFor(a, now));
  }

  // ------------------------------------------------------------------ the app --
  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4340';
  const jars = {};
  async function call(jar, method, p, body) {
    const h = {};
    if (jars[jar]) h.cookie = jars[jar];
    if (body) h['content-type'] = 'application/json';
    const res = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (sc.length) jars[jar] = sc.map(c => c.split(';')[0]).join('; ');
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: res.status, data, text };
  }
  const login = (jar, username, password) => { delete jars[jar]; return call(jar, 'POST', '/api/portal/login', { username, password }); };

  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  const C = 'aconsu-knust';
  await call('admin', 'POST', '/api/national/chapters', { id: C, name: 'ACONSU KNUST', institution: 'KNUST' });
  const PW = 'Counting-Faithfully-26';
  // Every chapter leader is a member first.
  let n = 0;
  async function member(name) {
    n += 1;
    const fd = new FormData();
    fd.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
    Object.entries({ name, email: `ss${n}@example.com`, password: 'secret123', chapterId: C, consent: 'true' }).forEach(([k, v]) => fd.append(k, v));
    return (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd })).json()).member.id;
  }
  const staff = async (username, name, role, password = PW) => call('admin', 'POST', '/api/admin/staff', { username, name, role, password, chapterId: C, memberId: await member(name) });

  console.log('\n== leaders\' passwords are 12 characters ==');
  let r = await staff('fin.short', 'Short', 'finance', 'eleven-char');
  check('a leader account cannot be made with fewer than 12', r.status === 400 && /12 characters/.test(r.data.error), r.data);
  r = await staff('fin.one', 'Efua Finance', 'finance');
  check('with 12 or more it can', r.status === 200, r.data);
  const finId = fakeModels.StaffUser._docs.find(a => a.username === 'fin.one').id;
  r = await login('fin', 'fin.one', PW);
  check('and signs in with the password alone while it has no second step', r.status === 200 && r.data.success, r.data);
  r = await call('fin', 'POST', '/api/portal/password', { currentPassword: PW, newPassword: 'Short-Pass1' });
  check('changing it to fewer than 12 is turned away, and says why', r.status === 400 && /at least 12/.test(r.data.error), r.data);

  console.log('\n== setting it up ==');
  r = await call('fin', 'GET', '/api/portal/second-step');
  check('My Account says the account needs it, and it is not on yet', r.status === 200 && r.data.required && !r.data.enrolled && !r.data.enforced, r.data);
  r = await call('fin', 'POST', '/api/portal/second-step/begin', { password: 'not-it' });
  check('starting asks for the password again', r.status === 401, r.data);
  r = await call('fin', 'POST', '/api/portal/second-step/begin', { password: PW });
  check('then gives a QR code to scan and the key to type', r.status === 200 && /^data:image\/png;base64,/.test(r.data.qr) && /^otpauth:\/\/totp\/ACONSU(:|%3A)fin\.one\?secret=[A-Z2-7]+&issuer=ACONSU/.test(r.data.url), { ...r.data, qr: String(r.data.qr).slice(0, 30) });
  const secret = r.data.secret.replace(/ /g, '');
  r = await call('fin', 'POST', '/api/portal/second-step/confirm', { code: '000000' });
  check('a wrong first code does not turn it on', r.status === 401 && !fakeModels.StaffUser._docs.find(a => a.id === finId).totpEnabledAt, r.data);
  r = await call('fin', 'POST', '/api/portal/second-step/confirm', { code: totp.codeAt(secret) });
  const recovery = r.data.recoveryCodes || [];
  check('the right one does, and hands over ten recovery codes, once', r.status === 200 && recovery.length === 10, r.data);
  const acct = () => fakeModels.StaffUser._docs.find(a => a.id === finId);
  check('the database holds the secret sealed and the recovery codes hashed, never as given', acct().totpSecretEnc && !acct().totpSecretEnc.includes(secret)
    && acct().totpRecoveryHashes.length === 10 && !acct().totpRecoveryHashes.some(h => recovery.some(c => h.includes(c.replace('-', '')))));
  r = await call('admin', 'GET', '/api/admin/staff');
  const listed = r.data.find(a => a.id === finId);
  check('the account list shows it is on, and nothing secret', listed && listed.secondStepOn === true && !/totp(Secret|Pending|Recovery)|passwordHash/.test(JSON.stringify(r.data)), listed);
  check('and it is written in the account\'s own log', acct().securityLog.some(l => /set up/.test(l.what)));

  console.log('\n== signing in with it ==');
  r = await login('fin', 'fin.one', PW);
  check('the password alone now only asks for the code', r.status === 200 && r.data.needsSecondStep === true && !r.data.success, r.data);
  r = await call('fin', 'GET', '/api/portal/me');
  check('and opens nothing until the code comes', !r.data.staff, r.data);
  r = await call('fin', 'GET', '/api/finance/summary');
  check('not the books either', r.status === 401 || r.status === 403, r.status);
  r = await call('fin', 'POST', '/api/portal/login/second-step', { code: '123456' });
  check('a wrong code is refused', r.status === 401 && /not right/.test(r.data.error), r.data);
  const next = totp.codeAt(secret, Date.now() + 30000);
  r = await call('fin', 'POST', '/api/portal/login/second-step', { code: next });
  check('the right code signs them in', r.status === 200 && r.data.success && r.data.staff && r.data.staff.username === 'fin.one', r.data);
  r = await call('fin', 'GET', '/api/finance/summary');
  check('and the books open', r.status === 200, r.status);
  await login('fin2', 'fin.one', PW);
  r = await call('fin2', 'POST', '/api/portal/login/second-step', { code: next });
  check('the same code cannot be used again, even from another phone', r.status === 401, r.data);
  r = await call('fin2', 'POST', '/api/portal/login/second-step', { recoveryCode: recovery[0].toLowerCase() });
  check('a recovery code works instead, typed any way', r.status === 200 && r.data.success && r.data.recoveryCodesLeft === 9, r.data);
  await login('fin3', 'fin.one', PW);
  r = await call('fin3', 'POST', '/api/portal/login/second-step', { recoveryCode: recovery[0] });
  check('but only once', r.status === 401 && /used/.test(r.data.error), r.data);
  r = await call('nobody', 'POST', '/api/portal/login/second-step', { code: totp.codeAt(secret) });
  check('a code with no password before it opens nothing', r.status === 401 && /password again/.test(r.data.error), r.data);
  r = await call('fin', 'POST', '/api/portal/second-step/off', { password: PW, code: totp.codeAt(secret, Date.now() + 60000) });
  check('an account that needs it cannot turn it off', r.status === 400 && /cannot be turned off/.test(r.data.error), r.data);

  console.log('\n== wrong tries ==');
  await staff('shep.one', 'Kwesi Shepherd', 'shepherding');
  let last;
  for (let i = 0; i < 5; i += 1) last = await login('guess', 'shep.one', 'wrong-guess-123');
  check('after five wrong passwords in a row the account rests, and says for how long', last.status === 429 && /1 minute/.test(last.data.error), last.data);
  r = await login('guess', 'shep.one', PW);
  check('while it rests, even the right password waits', r.status === 429, r.data);
  const shep = fakeModels.StaffUser._docs.find(a => a.username === 'shep.one');
  check('and the account\'s log says so', (shep.securityLog || []).some(l => /rested after 5 wrong tries/.test(l.what)), shep.securityLog);
  r = await call('admin', 'GET', '/api/admin/staff');
  check('the account list shows it resting', r.data.find(a => a.id === shep.id).lockedMinutes === 1);
  r = await call('admin', 'POST', `/api/admin/staff/${shep.id}/second-step/reset`);
  check('the Coordinator (here the admin) can unlock it', r.status === 200, r.data);
  r = await login('shep', 'shep.one', PW);
  check('and then it signs in', r.status === 200 && r.data.success, r.data);
  check('who unlocked it is written on the account', fakeModels.StaffUser._docs.find(a => a.id === shep.id).securityLog.some(l => /reset and account unlocked/.test(l.what) && l.by === 'Admin'));
  await login('x', 'shep.one', 'wrong-guess-123');
  await login('shep', 'shep.one', PW);
  check('a right password clears the count of wrong ones', fakeModels.StaffUser._docs.find(a => a.id === shep.id).failedSignIns === 0);
  await login('guess', 'fin.one', 'wrong');
  for (let i = 0; i < 4; i += 1) { await login('guess', 'fin.one', PW); await call('guess', 'POST', '/api/portal/login/second-step', { code: '000000' }); }
  check('wrong codes count too', secondStep.lockedFor(acct()) > 0, acct().failedSignIns);

  console.log('\n== a lost phone ==');
  r = await call('admin', 'POST', `/api/admin/staff/${finId}/second-step/reset`);
  check('the Coordinator resets the second step', r.status === 200 && !acct().totpEnabledAt && acct().totpRecoveryHashes.length === 0 && !acct().lockedUntil, r.data);
  r = await call('fin', 'GET', '/api/portal/me');
  check('which signs the holder out everywhere', !r.data.staff, r.data);
  r = await login('fin', 'fin.one', PW);
  check('and they sign in with the password, ready to set it up again', r.status === 200 && r.data.success, r.data);
  r = await call('fin', 'POST', `/api/admin/staff/${finId}/second-step/reset`);
  check('nobody resets their own', r.status !== 200, r.status);

  console.log('\n== someone who does not need it can turn it off ==');
  await staff('pub.one', 'Pub Lisher', 'publicity');
  await login('pub', 'pub.one', PW);
  const pubSecret = (await call('pub', 'POST', '/api/portal/second-step/begin', { password: PW })).data.secret.replace(/ /g, '');
  await call('pub', 'POST', '/api/portal/second-step/confirm', { code: totp.codeAt(pubSecret) });
  r = await call('pub', 'POST', '/api/portal/second-step/off', { password: PW, code: totp.codeAt(pubSecret, Date.now() + 30000) });
  check('with the password and a code', r.status === 200 && !fakeModels.StaffUser._docs.find(a => a.username === 'pub.one').totpEnabledAt, r.data);

  console.log('\n== switching it on for everyone ==');
  await staff('wel.one', 'Wel Fare', 'welfare');
  await login('welOld', 'wel.one', PW);
  process.env.ENFORCE_LEADER_2FA = 'on';
  r = await call('welOld', 'GET', '/api/welfare/ledger');
  check('a session open before it was switched on carries on', r.status === 200, r.status);
  await login('wel', 'wel.one', PW);
  r = await call('wel', 'GET', '/api/portal/second-step');
  check('a leader without it gets 14 days, counted down', r.data.enforced && r.data.daysLeft === 14 && !r.data.mustSetUpNow, r.data);
  r = await call('wel', 'GET', '/api/welfare/ledger');
  check('and meanwhile works as before', r.status === 200, r.status);
  const since = fakeModels.SystemState._docs.find(d => d.singleton === 'leader2fa');
  since.startedAt = new Date(Date.now() - 20 * 86400000).toISOString();
  fakeModels.StaffUser._docs.find(a => a.username === 'wel.one').createdAt = new Date(Date.now() - 60 * 86400000).toISOString();
  r = await login('wel', 'wel.one', PW);
  check('when the days are up, signing in still works', r.status === 200 && r.data.success, r.data);
  r = await call('wel', 'GET', '/api/portal/me');
  check('but the portal is told to show only the setup', r.data.staff && r.data.staff.mustSetUpSecondStep === true, r.data.staff);
  r = await call('wel', 'GET', '/api/welfare/ledger');
  check('and nothing else opens', r.status === 401 || r.status === 403, r.status);
  const welSecret = (await call('wel', 'POST', '/api/portal/second-step/begin', { password: PW })).data.secret.replace(/ /g, '');
  r = await call('wel', 'POST', '/api/portal/second-step/confirm', { code: totp.codeAt(welSecret) });
  check('setting it up is allowed', r.status === 200 && r.data.recoveryCodes.length === 10, r.data);
  r = await call('wel', 'GET', '/api/welfare/ledger');
  check('and opens everything again straight away', r.status === 200, r.status);
  r = await login('pub', 'pub.one', PW);
  r = await call('pub', 'GET', '/api/portal/me');
  check('someone who does not need it is never held to it', r.data.staff && !r.data.staff.mustSetUpSecondStep, r.data.staff);
  delete process.env.ENFORCE_LEADER_2FA;

  console.log(failures ? `\n${failures} FAILURES` : '\nall second-step checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
