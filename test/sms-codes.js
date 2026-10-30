// Codes by SMS (Phase 5): signing in with one, choosing a new password with
// one, signing up without a password where the chapter has its own SMS
// account, and confirming it is you on an account with no password. The SMS
// provider is answered here; nothing leaves the machine.
//
//   node test/sms-codes.js     (also run by `npm test`)
const { fakeModels } = require('./harness.js');

(async () => {
  process.env.MONGODB_URI = 'mongodb://stub/aconsu_sms';
  process.env.PORT = '4347';
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'admin123';
  process.env.SESSION_SECRET = 'test';
  process.env.LOGIN_RATE_LIMIT_MAX = '300';
  process.env.SMS_CODE_LIMIT_MAX = '200';
  process.env.SMS_CODE_TRY_LIMIT_MAX = '200';
  process.env.PRIVACY_RATE_LIMIT_MAX = '50';
  ['SHEPHERD_USERNAME', 'MNOTIFY_API_KEY', 'SMS_SENDER_ID', 'NODE_ENV'].forEach(k => delete process.env[k]);

  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 500)}` : ''}`); }
  }

  // The SMS provider, answered here: every text is kept for the test to read.
  const texts = [];
  const passOn = global.fetch;
  global.fetch = (url, opts) => {
    if (String(url).startsWith('https://apps.mnotify.net/')) {
      const q = new URL(String(url)).searchParams;
      texts.push({ to: q.get('to'), msg: q.get('msg'), key: q.get('key') });
      return Promise.resolve(new Response('1000', { status: 200 }));
    }
    return passOn(url, opts);
  };
  // And the console, for the code a development machine shows there.
  const said = [];
  const log = console.log;
  console.log = (...a) => { said.push(a.join(' ')); log(...a); };
  const codeIn = (t) => (String(t || '').match(/\b(\d{6})\b/) || [])[1];
  const settle = () => new Promise(r => setTimeout(r, 60));

  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4347';
  const jars = {};
  async function call(jar, method, p, body) {
    const h = {};
    if (jar && jars[jar]) h.cookie = jars[jar];
    if (body) h['content-type'] = 'application/json';
    const res = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (jar && sc.length) jars[jar] = sc.map(c => c.split(';')[0]).join('; ');
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: res.status, data };
  }
  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  for (const [id, name] of [['aconsu-knust', 'KNUST'], ['aconsu-ucc', 'UCC']]) {
    await call('admin', 'POST', '/api/national/chapters', { id, name: `ACONSU ${name}`, institution: name });
  }
  // KNUST has its own mNotify account; UCC has none, and there is no shared one.
  fakeModels.Chapter._docs.find(c => c.id === 'aconsu-knust').sms = { apiKey: 'knust-key', senderId: 'ACONSU' };
  const join = (who, body) => call(who, 'POST', '/api/auth/register', { password: 'secret123', consent: 'true', ...body });
  await join('ama', { name: 'Ama Owusu', phone: '0244123456', chapterId: 'aconsu-knust' });
  await join('kofi', { name: 'Kofi Ucc', phone: '0551234567', chapterId: 'aconsu-ucc' });
  const ama = fakeModels.Member._docs.find(m => m.name === 'Ama Owusu');

  console.log('\n== who can get codes ==');
  let r = await call(null, 'GET', '/api/auth/sms-status?chapterId=aconsu-knust');
  check('a chapter with its own SMS account: codes, and sign-up without a password', r.data.codes === true && r.data.phoneOnlySignup === true, r.data);
  r = await call(null, 'GET', '/api/auth/sms-status?chapterId=aconsu-ucc');
  check('a chapter with none: neither, and the pages offer the password', r.data.codes === false && r.data.phoneOnlySignup === false, r.data);

  console.log('\n== asking for a code ==');
  r = await call(null, 'POST', '/api/auth/sms/request', { phone: '+233 24 412 3456', purpose: 'signin' });
  await settle();
  const sent = texts.pop();
  const code = codeIn(sent && sent.msg);
  check('a code goes by text to the number, on the chapter\'s own account', r.status === 200 && sent && sent.to === '233244123456' && sent.key === 'knust-key' && /^\d{6}$/.test(code || ''), sent);
  const known = r.data;
  r = await call(null, 'POST', '/api/auth/sms/request', { phone: '0209090909', purpose: 'signin' });
  await settle();
  check('a number nobody has gets the very same answer, and no text', r.status === 200 && JSON.stringify(r.data) === JSON.stringify(known) && texts.length === 0, r.data);
  r = await call(null, 'POST', '/api/auth/sms/request', { phone: '+44 7700 900123', purpose: 'signin' });
  check('a number from another country is not texted', r.status === 400);
  const store = JSON.stringify([fakeModels.PhoneCode._docs, fakeModels.SmsLog ? fakeModels.SmsLog._docs : []]);
  check('the code is kept nowhere as itself: not in the codes, not in the SMS log', !store.includes(code), store.slice(0, 300));
  const logged = (fakeModels.SmsLog ? fakeModels.SmsLog._docs : []).find(l => /signin code/.test(l.body || l.message || ''));
  check('the SMS log says a sign-in code was sent, without it', !!logged, (fakeModels.SmsLog || {})._docs);
  check('a development machine also shows it in its own console', said.some(s => s.includes('[development only]') && s.includes(code)));

  console.log('\n== signing in with it ==');
  r = await call('in', 'POST', '/api/auth/sms/signin', { phone: '0244123456', code: code === '000000' ? '111111' : '000000' });
  check('a wrong code is refused', r.status === 400 && /not right/.test(r.data.error), r.data);
  r = await call('in', 'POST', '/api/auth/sms/signin', { phone: '024 412 3456', code });
  check('the right code signs them in', r.status === 200 && r.data.member.id === ama.id, r.data);
  r = await call('in', 'GET', '/api/auth/me');
  check('and they are signed in', r.data.member && r.data.member.id === ama.id);
  r = await call('again', 'POST', '/api/auth/sms/signin', { phone: '0244123456', code });
  check('a code works once', r.status === 400);
  await call(null, 'POST', '/api/auth/sms/request', { phone: '0244123456', purpose: 'signin' });
  await settle();
  const c2 = codeIn(texts.pop().msg);
  const wrongOne = c2 === '123456' ? '654321' : '123456';
  for (let i = 0; i < 4; i += 1) await call(null, 'POST', '/api/auth/sms/signin', { phone: '0244123456', code: wrongOne });
  r = await call(null, 'POST', '/api/auth/sms/signin', { phone: '0244123456', code: wrongOne });
  check('five wrong tries end the code', r.status === 429 && /Too many wrong/.test(r.data.error), r.data);
  r = await call(null, 'POST', '/api/auth/sms/signin', { phone: '0244123456', code: c2 });
  check('even the right one, after that', r.status !== 200);
  r = await call(null, 'POST', '/api/auth/sms/request', { phone: '0244123456', purpose: 'signin' });
  check('a third code in 15 minutes is fine', r.status === 200);
  r = await call(null, 'POST', '/api/auth/sms/request', { phone: '0244123456', purpose: 'signin' });
  check('a fourth is not', r.status === 429 && /Try again in/.test(r.data.error), r.data);
  for (let i = 0; i < 3; i += 1) await call(null, 'POST', '/api/auth/sms/request', { phone: '0209090909', purpose: 'signin' });
  r = await call(null, 'POST', '/api/auth/sms/request', { phone: '0209090909', purpose: 'signin' });
  check('the same limit for a number nobody has, so the limit gives nothing away', r.status === 429);
  await settle();
  texts.length = 0;
  const live = fakeModels.PhoneCode._docs.find(d => d.phoneKey === '233244123456' && d.purpose === 'signin');
  live.sends = [];
  await call(null, 'POST', '/api/auth/sms/request', { phone: '0244123456', purpose: 'signin' });
  await settle();
  const c3 = codeIn(texts.pop().msg);
  live.expiresAt = new Date(Date.now() - 1000);
  r = await call(null, 'POST', '/api/auth/sms/signin', { phone: '0244123456', code: c3 });
  check('a code more than 10 minutes old is refused', r.status === 400);

  console.log('\n== a chapter without SMS ==');
  said.length = 0;
  r = await call(null, 'POST', '/api/auth/sms/request', { phone: '0551234567', purpose: 'signin' });
  await settle();
  check('the same answer, and no text (there is no account to send it on)', r.status === 200 && JSON.stringify(r.data) === JSON.stringify(known) && texts.length === 0);
  check('on a development machine the code is in the console, to try it out', said.some(s => s.includes('[development only]') && s.includes('233551234567')));
  said.length = 0;
  fakeModels.PhoneCode._docs.find(d => d.phoneKey === '233551234567').sends = [];
  process.env.NODE_ENV = 'production';
  await call(null, 'POST', '/api/auth/sms/request', { phone: '0551234567', purpose: 'signin' });
  await settle();
  delete process.env.NODE_ENV;
  check('never in production', !said.some(s => s.includes('[development only]')), said);

  console.log('\n== a new password by code ==');
  await call(null, 'POST', '/api/auth/sms/request', { phone: '0244123456', purpose: 'reset' });
  await settle();
  const rc = codeIn(texts.pop().msg);
  r = await call(null, 'POST', '/api/auth/sms/reset', { phone: '0244123456', code: rc, newPassword: 'short' });
  check('too short a password is refused first, and the code is not used up', r.status === 400);
  r = await call(null, 'POST', '/api/auth/sms/reset', { phone: '0244123456', code: rc, newPassword: 'brand-new-pass' });
  check('the code and a new password change it', r.status === 200, r.data);
  check('the old password no longer works', (await call(null, 'POST', '/api/auth/login', { identifier: '0244123456', password: 'secret123' })).status === 401);
  check('the new one does', (await call(null, 'POST', '/api/auth/login', { identifier: '0244123456', password: 'brand-new-pass' })).status === 200);
  r = await call('in', 'GET', '/api/auth/me');
  check('and every device signed in before is signed out', r.data.member === null, r.data);
  r = await call(null, 'POST', '/api/auth/sms/reset', { phone: '0244123456', code: rc, newPassword: 'another-pass-1' });
  check('a reset code works once', r.status === 400);

  console.log('\n== two older accounts on one number ==');
  const bcrypt = require('bcryptjs');
  for (const id of ['old1', 'old2']) {
    await fakeModels.Member.create({ id, chapterId: 'aconsu-knust', name: `Old ${id}`, email: `${id}@example.com`, passwordHash: await bcrypt.hash('x', 4), phone: '0277000000', phoneKey: '233277000000', profileImageFileId: 'f' });
  }
  await call(null, 'POST', '/api/auth/sms/request', { phone: '0277000000', purpose: 'signin' });
  await settle();
  r = await call(null, 'POST', '/api/auth/sms/signin', { phone: '0277000000', code: codeIn(texts.pop().msg) });
  check('a code cannot choose between them: email and password instead', r.status === 409, r.data);

  console.log('\n== signing up without a password ==');
  r = await call(null, 'POST', '/api/auth/sms/signup-code', { phone: '0201112222', chapterId: 'aconsu-ucc' });
  check('not where the chapter has no SMS account of its own', r.status === 400 && /password/.test(r.data.error));
  r = await join(null, { name: 'Sneaky', phone: '0201112222', chapterId: 'aconsu-ucc', password: '', smsCode: '123456' });
  check('nor by sending a code to the sign-up form anyway', r.status === 400);
  r = await call(null, 'POST', '/api/auth/sms/signup-code', { phone: '0244123456', chapterId: 'aconsu-knust' });
  check('a number that already has an account is told to sign in', r.status === 400 && /already exists/.test(r.data.error));
  r = await call(null, 'POST', '/api/auth/sms/signup-code', { phone: '0201112222', chapterId: 'aconsu-knust' });
  const sc = codeIn((texts.pop() || {}).msg);
  check('where it has: a code to the number', r.status === 200 && /^\d{6}$/.test(sc || ''), r.data);
  r = await join('efua', { name: 'Efua Code', phone: '020 111 2222', chapterId: 'aconsu-knust', password: '', smsCode: sc === '000000' ? '111111' : '000000' });
  check('a wrong code does not make the account', r.status === 400 && !fakeModels.Member._docs.some(m => m.name === 'Efua Code'));
  r = await join('efua', { name: 'Efua Code', phone: '020 111 2222', chapterId: 'aconsu-knust', password: '', smsCode: sc });
  const efua = fakeModels.Member._docs.find(m => m.name === 'Efua Code');
  check('the right one does, with no password at all', r.status === 200 && efua && efua.passwordHash === '', r.data);
  r = await call('efua', 'GET', '/api/auth/me');
  check('the app knows they have no password yet', r.data.member.hasPassword === false);
  check('an empty password does not open it', (await call(null, 'POST', '/api/auth/login', { identifier: '0201112222', password: '' })).status === 400
    && (await call(null, 'POST', '/api/auth/login', { identifier: '0201112222', password: 'anything' })).status === 401);

  console.log('\n== an account with no password confirms by code ==');
  r = await call('efua', 'POST', '/api/member/export', {});
  check('downloading their data asks for a code', r.status === 400 && /code/.test(r.data.error), r.data);
  r = await call('efua', 'POST', '/api/member/confirm-code', {});
  const cc = codeIn((texts.pop() || {}).msg);
  check('one goes to their own number', r.status === 200 && /ending 22/.test(r.data.message) && cc, r.data);
  r = await call('efua', 'POST', '/api/member/export', { smsCode: cc });
  check('and with it they get their data', r.status === 200 && typeof r.data === 'object' && r.data.profile, typeof r.data);
  r = await call('efua', 'POST', '/api/member/export', { smsCode: cc });
  check('once', r.status === 401);
  r = await call('efua', 'PUT', '/api/member/password', { newPassword: 'first-password-1' });
  check('they can choose a first password without an old one', r.status === 200, r.data);
  check('and sign in with it', (await call(null, 'POST', '/api/auth/login', { identifier: '0201112222', password: 'first-password-1' })).status === 200);
  r = await call('efua', 'PUT', '/api/member/password', { newPassword: 'second-password-2' });
  check('after that, changing it needs the current one again', r.status === 400);

  console.log = log;
  console.log(failures ? `\n${failures} FAILURES` : '\nall SMS code checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
