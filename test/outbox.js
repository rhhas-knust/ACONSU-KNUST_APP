// The offline outbox's server side (Phase 7): something sent again with the
// same Idempotency-Key is done once, and the first answer is given again. For
// the check-ins at the door and the prayer and contact forms, which a phone
// with weak signal queues and sends later, sometimes twice.
//
//   node test/outbox.js     (also run by `npm test`)
const fs = require('fs');
const path = require('path');
const { fakeModels } = require('./harness.js');

(async () => {
  process.env.MONGODB_URI = 'mongodb://stub/aconsu_outbox';
  process.env.PORT = '4349';
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'admin123';
  process.env.SESSION_SECRET = 'test';
  process.env.LOGIN_RATE_LIMIT_MAX = '300';
  process.env.FORM_RATE_LIMIT_MAX = '200';
  delete process.env.SHEPHERD_USERNAME;

  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 500)}` : ''}`); }
  }

  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4349';
  const jars = {};
  async function call(jar, method, p, body, headers) {
    const h = { ...(headers || {}) };
    if (jar && jars[jar]) h.cookie = jars[jar];
    if (body) h['content-type'] = 'application/json';
    const res = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (jar && sc.length) jars[jar] = sc.map(c => c.split(';')[0]).join('; ');
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: res.status, data, replay: res.headers.get('idempotent-replay') };
  }
  const C = 'aconsu-knust';
  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  await call('admin', 'POST', '/api/national/chapters', { id: C, name: 'ACONSU KNUST', institution: 'KNUST' });
  const chap = { 'X-Chapter-Id': C };
  const key = (k) => ({ ...chap, 'Idempotency-Key': k });

  console.log('\n== a prayer request sent twice ==');
  const prayer = { name: 'Ama', request: 'Exams next week', visibility: 'private' };
  let r1 = await call(null, 'POST', '/api/prayer-requests', prayer, key('prayer-key-0001'));
  let r2 = await call(null, 'POST', '/api/prayer-requests', prayer, key('prayer-key-0001'));
  check('the first is handled', r1.status === 200 && r1.data.success && !r1.replay);
  check('the second, with the same key, gets the same answer, marked as given before', r2.status === 200 && JSON.stringify(r2.data) === JSON.stringify(r1.data) && r2.replay === 'true', r2);
  check('and there is one request, not two', fakeModels.PrayerRequest._docs.filter(p => p.request === 'Exams next week').length === 1);
  await call(null, 'POST', '/api/prayer-requests', prayer, key('prayer-key-0002'));
  check('a different key is a different request', fakeModels.PrayerRequest._docs.filter(p => p.request === 'Exams next week').length === 2);
  await call(null, 'POST', '/api/prayer-requests', prayer, chap);
  check('with no key, as it always was', fakeModels.PrayerRequest._docs.filter(p => p.request === 'Exams next week').length === 3);
  r1 = await call(null, 'POST', '/api/prayer-requests', prayer, key('bad key!'));
  check('a key that is not one is refused', r1.status === 400);
  r1 = await call(null, 'POST', '/api/prayer-requests', { name: 'x' }, key('prayer-key-0003'));
  r2 = await call(null, 'POST', '/api/prayer-requests', { name: 'x', request: 'now with words' }, key('prayer-key-0003'));
  check('a refusal is remembered too (the same answer, not a second try with different words)', r1.status === 400 && r2.status === 400 && r2.replay === 'true' && !fakeModels.PrayerRequest._docs.some(p => p.request === 'now with words'));

  console.log('\n== a contact message sent twice ==');
  const msg = { name: 'Kofi', email: 'kofi@example.com', message: 'When is the retreat?' };
  await call(null, 'POST', '/api/contact', msg, key('contact-key-001'));
  await call(null, 'POST', '/api/contact', msg, key('contact-key-001'));
  check('one message', fakeModels.ContactMessage._docs.filter(m => m.message === 'When is the retreat?').length === 1);

  console.log('\n== a check-in at the door sent twice ==');
  const fd = new FormData();
  Object.entries({ name: 'Shep Head', email: 'shep@example.com', password: 'secret123', chapterId: C, consent: 'true' }).forEach(([k, v]) => fd.append(k, v));
  const memberId = (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd })).json()).member.id;
  await call('admin', 'POST', '/api/admin/staff', { username: 'shep', name: 'Shep Head', role: 'shepherding', password: 'Counting-Faithfully-26', chapterId: C, memberId });
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; });
  await call('shep', 'POST', '/api/portal/login', { username: 'shep', password: 'Counting-Faithfully-26' });
  const today = new Date().toISOString().slice(0, 10);
  const nc = { name: 'Efua New', phone: '0207654321', date: today, serviceType: 'sunday' };
  r1 = await call('shep', 'POST', '/api/attendance/newcomer', nc, { 'Idempotency-Key': 'door-new-0001' });
  r2 = await call('shep', 'POST', '/api/attendance/newcomer', nc, { 'Idempotency-Key': 'door-new-0001' });
  check('someone new added at the door, sent twice, is added once', r1.status === 200 && r2.replay === 'true' && fakeModels.ShepherdingRecord._docs.filter(x => x.name === 'Efua New').length === 1, r2);
  const reg = () => fakeModels.AttendanceRecord._docs.find(x => x.chapterId === C && x.date === today);
  const mark = { memberId, date: today, serviceType: 'sunday' };
  await call('shep', 'POST', '/api/attendance/mark', mark, { 'Idempotency-Key': 'door-mark-001' });
  await call('shep', 'POST', '/api/attendance/unmark', mark, { 'Idempotency-Key': 'door-unmark-01' });
  r2 = await call('shep', 'POST', '/api/attendance/mark', mark, { 'Idempotency-Key': 'door-mark-001' });
  const m = reg().marks.find(x => x.memberId === memberId);
  check('a check-in sent again after it was taken back does not check them in again', r2.replay === 'true' && (!m || m.status !== 'present'), reg().marks);
  r1 = await call('admin', 'POST', '/api/prayer-requests', prayer, key('prayer-key-0001'));
  check('one person\'s key never gives another person\'s answer: it is theirs alone', r1.status === 200 && !r1.replay);

  console.log('\n== while the first is still being handled ==');
  const crypto = require('crypto');
  await fakeModels.IdempotencyKey.create({ id: crypto.createHash('sha256').update(`anyone|POST|/api/contact|busy-key-0001`).digest('hex'), state: 'working', expireAt: new Date(Date.now() + 60000) });
  r1 = await call(null, 'POST', '/api/contact', msg, key('busy-key-0001'));
  check('the second is told to wait, and the phone tries again later', r1.status === 409 && r1.data.retry === true, r1);
  check('kept a day, then cleared by the database (a TTL index)', fakeModels.IdempotencyKey._docs.every(d => d.expireAt && new Date(d.expireAt) - Date.now() <= 24 * 60 * 60 * 1000 + 1000));

  console.log('\n== the pages ==');
  const pub = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
  check('prayer, contact and check-in send through the outbox', /AconsuOutbox\.send/.test(pub('prayer.html')) && /AconsuOutbox\.send/.test(pub('contact.html')) && /AconsuOutbox\.send/.test(pub('js/shepherd-list.js')));
  check('and load it, its store first', ['prayer.html', 'contact.html', 'shepherding.html'].every(f => { const s = pub(f); return s.indexOf('/js/outbox-core.js') > 0 && s.indexOf('/js/outbox-core.js') < s.indexOf('/js/outbox.js'); }));
  const sw = pub('sw.js');
  check('the service worker sends it when the phone is back, and keeps both files for offline', /importScripts\('\/js\/outbox-core\.js'\)/.test(sw) && /addEventListener\('sync'/.test(sw) && sw.includes("'/js/outbox.js'"));
  check('every queued request carries its key', /'Idempotency-Key': item\.key/.test(pub('js/outbox-core.js')));

  console.log(failures ? `\n${failures} FAILURES` : '\nall outbox checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
