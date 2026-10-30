// The short sign-up (Phase 5): a name, a phone number, the chapter, a password
// and agreement. Email optional, the photo straight after, everything else on
// the profile and never required. Members sign in with their phone number
// however it is typed, accounts made before keep working, and guests can still
// look around without an account.
//
//   node test/signup.js     (also run by `npm test`)
//
// Sign-ups here are sent as JSON, which the harness leaves alone (it gives
// older suites' form sign-ups a phone number of their own).
const path = require('path');
const { execFileSync } = require('child_process');
const { fakeModels } = require('./harness.js');
const memberAccount = require('../lib/memberAccount');
const phone = require('../lib/phone');

(async () => {
  process.env.MONGODB_URI = 'mongodb://stub/aconsu_signup';
  process.env.PORT = '4346';
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'admin123';
  process.env.SESSION_SECRET = 'test';
  process.env.LOGIN_RATE_LIMIT_MAX = '300';
  delete process.env.SHEPHERD_USERNAME;

  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 500)}` : ''}`); }
  }

  console.log('\n== one phone number, however it is typed ==');
  check('024..., +233 24..., 233 24... and 24... are one number', ['0244123456', '+233 24 412 3456', '233244123456', '244123456', '(024) 412-3456'].every(v => phone.ghanaKey(v) === '233244123456'));
  check('anything else is not a Ghanaian mobile number', ['', '12345', '+44 7700 900123', '02441234567'].every(v => phone.ghanaKey(v) === ''));
  check('the sign-in box tells a number from an email address', phone.looksLikePhone('024 412 3456') && phone.looksLikePhone('+233244123456') && !phone.looksLikePhone('ama@example.com'));

  console.log('\n== the real schema ==');
  {
    // In a process of its own: this one has the in-memory stand-in for models.
    const script = `
      const m = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'models.js'))});
      const run = (name, ctx) => new Promise((res, rej) => m.Member.schema.s.hooks.execPre(name, ctx, [], (e) => (e ? rej(e) : res())));
      (async () => {
        const q = m.Member.findOneAndUpdate({ id: 'x' }, { $set: { phone: '+233 24 412 3456' } });
        await run('findOneAndUpdate', q);
        const d = new m.Member({ id: 'y', phone: '0201234567', name: 'A' });
        await run('save', d);
        const idx = m.Member.schema.indexes().filter(i => i[0].email);
        const field = m.Member.schema.path('email');
        process.stdout.write(JSON.stringify({ update: q.getUpdate().$set.phoneKey, saved: d.phoneKey, email: d.email === undefined, idx, required: !!field.isRequired, fieldUnique: !!(field.options && field.options.unique) }));
        process.exit(0);
      })();`;
    const out = JSON.parse(execFileSync(process.execPath, ['-e', script]).toString());
    check('an update to the phone number updates the key it signs in with', out.update === '233244123456', out);
    check('so does saving a member', out.saved === '233201234567', out);
    check('an account need not have an email address, and has no email field when it does not', out.email && !out.required, out);
    check('one account per email address, among accounts that have one', !out.fieldUnique && out.idx.length === 1 && out.idx[0][1].unique && out.idx[0][1].partialFilterExpression.email.$gt === '', out.idx);
  }

  console.log('\n== replacing the old email index, once ==');
  {
    const fake = (indexes, { refuseTwo } = {}) => {
      const done = [];
      return {
        done,
        collection: {
          indexes: async () => indexes.slice(),
          createIndex: async (key, opts) => {
            if (refuseTwo && indexes.some(i => i.key.email === 1)) throw new Error('Index already exists with a different name');
            done.push(['create', opts.name, JSON.stringify(opts.partialFilterExpression)]);
            indexes.push({ name: opts.name, key, unique: true, partialFilterExpression: opts.partialFilterExpression });
          },
          dropIndex: async (name) => { done.push(['drop', name]); indexes.splice(indexes.findIndex(i => i.name === name), 1); }
        }
      };
    };
    const realCollection = Object.getOwnPropertyDescriptor(fakeModels.Member, 'collection');
    const swap = (c) => Object.defineProperty(fakeModels.Member, 'collection', { value: c, configurable: true, writable: true });
    const quiet = { log: () => {} };
    let f = fake([{ name: '_id_', key: { _id: 1 } }, { name: 'email_1', key: { email: 1 }, unique: true }]);
    swap(f.collection);
    let r = await memberAccount.optionalEmailIndex({ dryRun: true, ...quiet });
    check('a dry run says what it would do and does nothing', r === 'would change' && f.done.length === 0, f.done);
    r = await memberAccount.optionalEmailIndex(quiet);
    check('the new index is made, then the old one goes', r === 'changed' && f.done[0][0] === 'create' && f.done[0][1] === 'email_unique_when_set' && f.done[1][0] === 'drop' && f.done[1][1] === 'email_1', f.done);
    r = await memberAccount.optionalEmailIndex(quiet);
    check('and the next start changes nothing', r === 'ready' && f.done.length === 2, f.done);
    f = fake([{ name: 'email_1', key: { email: 1 }, unique: true }], { refuseTwo: true });
    swap(f.collection);
    r = await memberAccount.optionalEmailIndex(quiet);
    check('where the database allows only one index on the field: the old one goes first', r === 'changed' && f.done[0][0] === 'drop' && f.done[1][0] === 'create', f.done);
    if (realCollection) Object.defineProperty(fakeModels.Member, 'collection', realCollection); else delete fakeModels.Member.collection;
  }

  // ------------------------------------------------------------------ the app --
  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4346';
  const jars = {};
  async function call(jar, method, p, body, raw) {
    const h = {};
    if (jar && jars[jar]) h.cookie = jars[jar];
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    if (raw) Object.assign(h, raw);
    const res = await fetch(BASE + p, { method, headers: h, body: payload });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (jar && sc.length) jars[jar] = sc.map(c => c.split(';')[0]).join('; ');
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: res.status, data, text };
  }
  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  await call('admin', 'POST', '/api/national/chapters', { id: 'aconsu-knust', name: 'ACONSU KNUST', institution: 'KNUST' });
  const C = 'aconsu-knust';
  const join = (who, body) => call(who, 'POST', '/api/auth/register', { chapterId: C, password: 'secret123', consent: 'true', ...body });

  console.log('\n== signing up ==');
  let r = await join('ama', { name: 'Ama Owusu', phone: '024 412 3456' });
  const ama = fakeModels.Member._docs.find(m => m.name === 'Ama Owusu');
  check('a name, a phone number, the chapter, a password and agreement are enough', r.status === 200 && r.data.success && r.data.needsPhoto === true, r.data);
  check('no email field at all, and the number kept in the form it signs in with', ama && !('email' in ama) && ama.phoneKey === '233244123456' && ama.phone === '024 412 3456', ama);
  check('signed in straight away', (await call('ama', 'GET', '/api/auth/me')).data.member.id === ama.id);
  r = await join('kofi', { name: 'Kofi Mensah', phone: '0551234567' });
  check('a second account without an email address is fine', r.status === 200, r.data);
  r = await join(null, { name: 'Ama Again', phone: '+233 24 412 3456' });
  check('the same number typed another way is the same number: refused', r.status === 400 && /already exists/.test(r.data.error), r.data);
  r = await join(null, { name: 'No Phone' });
  check('a phone number is needed', r.status === 400 && /phone number/.test(r.data.error), r.data);
  r = await join(null, { name: 'Abroad', phone: '+44 7700 900123' });
  check('a number from another country needs an email address to sign in with', r.status === 400 && /email/.test(r.data.error), r.data);
  r = await join('abroad', { name: 'Abroad', phone: '+44 7700 900123', email: 'Abroad@Example.com ' });
  check('and with one it is fine (the email kept tidy)', r.status === 200 && fakeModels.Member._docs.some(m => m.email === 'abroad@example.com' && m.phoneKey === ''), r.data);
  r = await join(null, { name: 'Bad Email', phone: '0207777777', email: 'not-an-email' });
  check('an email address that is not one is refused', r.status === 400);
  r = await join(null, { name: 'Taken', phone: '0208888888', email: 'abroad@example.com' });
  check('as is one another account has', r.status === 400 && /email already exists/.test(r.data.error));
  r = await join(null, { name: 'x', phone: '0209999999' });
  check('a name of one letter is not a name', r.status === 400);
  r = await join(null, { name: 'No Consent', phone: '0201111111', consent: 'false' });
  check('agreeing to the Terms is still needed', r.status === 400);

  console.log('\n== the photo, straight after ==');
  r = await call('ama', 'GET', '/api/auth/me');
  check('until there is a photo, the app is told to ask for it', r.data.member.needsPhoto === true);
  let fd = new FormData();
  fd.append('photo', new Blob([Buffer.from('not an image')], { type: 'text/plain' }), 'x.txt');
  r = await call('ama', 'POST', '/api/member/photo', fd);
  check('something that is not a picture is refused', r.status === 400);
  fd = new FormData();
  fd.append('photo', new Blob([Buffer.from('p')], { type: 'image/png' }), 'me.png');
  r = await call('ama', 'POST', '/api/member/photo', fd);
  check('a photo is saved', r.status === 200 && fakeModels.Member._docs.find(m => m.id === ama.id).profileImageFileId);
  r = await call('ama', 'GET', '/api/auth/me');
  check('and then nothing is asked', r.data.member.needsPhoto === false);
  r = await call(null, 'POST', '/api/member/photo', fd);
  check('nobody signed out can set one', r.status === 401);

  console.log('\n== signing in ==');
  for (const typed of ['0244123456', '+233 24 412 3456', '233244123456']) {
    r = await call(`in-${typed}`, 'POST', '/api/auth/login', { identifier: typed, password: 'secret123' });
    check(`with the phone number typed as ${typed}`, r.status === 200 && r.data.member.id === ama.id, r.data);
  }
  const wrong = await call(null, 'POST', '/api/auth/login', { identifier: '0244123456', password: 'nope-nope' });
  const nobody = await call(null, 'POST', '/api/auth/login', { identifier: '0209090909', password: 'nope-nope' });
  check('a wrong password and a number nobody has get the same answer', wrong.status === 401 && nobody.status === 401 && wrong.data.error === nobody.data.error, [wrong.data, nobody.data]);
  r = await call(null, 'POST', '/api/auth/login', { identifier: 'abroad@example.com', password: 'secret123' });
  check('with an email address', r.status === 200);
  // An account from before: an email, a password, a phone number typed any
  // old way, and no phone key yet.
  const bcrypt = require('bcryptjs');
  await fakeModels.Member.create({ id: 'mem_old', chapterId: C, name: 'Yaw Old', email: 'yaw@example.com', passwordHash: await bcrypt.hash('oldpass99', 10), phone: '0 27 777 7777', profileImageFileId: 'f1' });
  delete fakeModels.Member._docs.find(m => m.id === 'mem_old').phoneKey;
  r = await call(null, 'POST', '/api/auth/login', { email: 'yaw@example.com', password: 'oldpass99' });
  check('an account from before still signs in with its email and password, as the old page sent them', r.status === 200 && r.data.member.id === 'mem_old', r.data);
  const filled = await memberAccount.backfillPhoneKeys({ log: () => {} });
  r = await call(null, 'POST', '/api/auth/login', { identifier: '0277777777', password: 'oldpass99' });
  check('and, once start-up has filled in its phone key, with its phone number too', filled === 1 && r.status === 200 && r.data.member.id === 'mem_old', { filled, r: r.data });
  check('filling them in again finds nothing to do', await memberAccount.backfillPhoneKeys({ log: () => {} }) === 0);

  console.log('\n== the profile ==');
  const amaNow = () => fakeModels.Member._docs.find(m => m.id === ama.id);
  r = await call('ama', 'PUT', '/api/member/profile', { name: 'Ama Owusu', level: '200' });
  check('saving a profile without the phone field keeps the number (it used to be blanked)', r.status === 200 && amaNow().phone === '024 412 3456' && amaNow().phoneKey === '233244123456', amaNow());
  r = await call('ama', 'PUT', '/api/member/profile', { name: 'Ama Owusu', phone: '' });
  check('with no email, the number cannot be taken away (it is how they sign in)', r.status === 400 && amaNow().phone === '024 412 3456');
  r = await call('ama', 'PUT', '/api/member/profile', { name: 'Ama Owusu', phone: '055 123 4567' });
  check('nor changed to a number another account has', r.status === 400 && /Another account/.test(r.data.error));
  r = await call('ama', 'PUT', '/api/member/profile', { name: 'Ama Owusu', phone: '0201234500', email: 'Ama@Example.com', programme: 'BSc Nursing', hostel: 'Unity Hall', memberKind: 'alumni', graduationYear: '2021 ' });
  const now = amaNow();
  check('a new number, an email address, what they study and their hall are saved', r.status === 200 && now.phoneKey === '233201234500' && now.email === 'ama@example.com' && now.programme === 'BSc Nursing' && now.hostel === 'Unity Hall', now);
  check('"finished" is recorded as a claim; the stage stays Shepherding\'s to set', now.registeredAsAlumni === true && now.graduationYear === '2021' && now.membershipStage === 'visitor', now);
  r = await call('ama', 'PUT', '/api/member/profile', { name: 'Ama Owusu', email: 'abroad@example.com' });
  check('an email address another account has is refused', r.status === 400);
  r = await call('in-0244123456', 'POST', '/api/auth/login', { identifier: '020 123 4500', password: 'secret123' });
  check('and the new number signs in', r.status === 200);

  console.log('\n== guests look around without an account ==');
  const pages = ['/', '/events.html', '/media.html', '/bible.html', '/prayer.html', '/visit.html', '/about.html', '/give.html'];
  const pageCodes = await Promise.all(pages.map(async p => [p, (await fetch(BASE + p)).status]));
  check('the public pages open', pageCodes.every(([, s]) => s === 200), pageCodes);
  const apis = ['/api/events', '/api/sermons', '/api/chapters', '/api/settings', '/api/pages', '/api/prayer-wall'];
  const apiCodes = await Promise.all(apis.map(async p => [p, (await fetch(BASE + p, { headers: { 'X-Chapter-Id': C } })).status]));
  check('and what they show is there without signing in', apiCodes.every(([, s]) => s === 200), apiCodes);

  console.log(failures ? `\n${failures} FAILURES` : '\nall sign-up checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
