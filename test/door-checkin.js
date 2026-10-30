// The visitor QR code at the door: Shepherding makes a code for one service
// day, a visitor scans it and checks themselves in. Someone already on the
// list (same phone, a name that agrees) is checked in as themselves; anyone
// else is added as new. The form answers the same either way, and the code
// works only on its own day, in its own chapter, until it is turned off.
//
//   node test/door-checkin.js     (also run by `npm test`)
const { fakeModels } = require('./harness.js');

(async () => {
  process.env.MONGODB_URI = 'mongodb://stub/aconsu_door';
  process.env.PORT = '4345';
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'admin123';
  process.env.SESSION_SECRET = 'test';
  process.env.LOGIN_RATE_LIMIT_MAX = '300';
  process.env.DOOR_CHECKIN_LIMIT_MAX = '200';
  delete process.env.SHEPHERD_USERNAME;
  delete process.env.PUBLIC_BASE_URL;

  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 500)}` : ''}`); }
  }

  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4345';
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
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  for (const [id, name] of [['aconsu-knust', 'KNUST'], ['aconsu-ucc', 'UCC']]) {
    await call('admin', 'POST', '/api/national/chapters', { id, name: `ACONSU ${name}`, institution: name });
  }
  let n = 0;
  async function member(name, chapterId, phone) {
    n += 1;
    const fd = new FormData();
    fd.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
    Object.entries({ name, email: `door${n}@example.com`, password: 'secret123', chapterId, consent: 'true', ...(phone ? { phone } : {}) }).forEach(([k, v]) => fd.append(k, v));
    return (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd })).json()).member.id;
  }
  for (const [username, role, chapterId] of [['shep.knust', 'shepherding', 'aconsu-knust'], ['pub.knust', 'publicity', 'aconsu-knust'], ['shep.ucc', 'shepherding', 'aconsu-ucc']]) {
    await call('admin', 'POST', '/api/admin/staff', { username, name: username, role, password: 'Counting-Faithfully-26', chapterId, memberId: await member(username, chapterId) });
  }
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; });
  const ama = await member('Ama Owusu', 'aconsu-knust', '0244123456');
  await fakeModels.ShepherdingRecord.create({ id: 'rec-kojo', chapterId: 'aconsu-knust', memberId: '', name: 'Kojo Mensah', phone: '0551234567', origin: 'import' });
  for (const who of ['shep.knust', 'pub.knust', 'shep.ucc']) await call(who, 'POST', '/api/portal/login', { username: who, password: 'Counting-Faithfully-26' });

  console.log('\n== making the code ==');
  let r = await call('shep.knust', 'GET', '/api/shepherd/door-code');
  check('there is none until Shepherding makes one', r.status === 200 && r.data.code === null && r.data.today === today, r.data);
  r = await call('pub.knust', 'POST', '/api/shepherd/door-code', {});
  check('someone helping at the door cannot make one (only Shepherding)', r.status === 401, r.status);
  r = await call('shep.knust', 'POST', '/api/shepherd/door-code', { date: yesterday });
  check('nor for a day that has passed', r.status === 400);
  r = await call('shep.knust', 'POST', '/api/shepherd/door-code', {});
  const code = r.data.code;
  check('Shepherding makes today\'s Sunday code', r.status === 200 && code && code.date === today && code.serviceType === 'sunday' && code.active, r.data);
  const token = code && new URL(code.url).searchParams.get('c');
  check('a link to the visitor form, with a random code in it, not an id', /\/welcome\.html\?c=[A-Za-z0-9_-]{20,}$/.test(code.url) && !code.url.includes(code.id), code.url);
  check('and the QR picture of that link', /^data:image\/png;base64,/.test(code.qr));
  r = await call('shep.knust', 'POST', '/api/shepherd/door-code', {});
  check('asked again, the same code (two phones at the door show one)', r.data.code.id === code.id);
  r = await call('pub.knust', 'GET', '/api/shepherd/door-code');
  check('anyone at the door may show it', r.status === 200 && r.data.code && r.data.code.id === code.id);
  r = await call('shep.ucc', 'GET', '/api/shepherd/door-code');
  check('another chapter does not see it', r.status === 200 && r.data.code === null);
  r = await call(null, 'GET', '/api/shepherd/door-code');
  check('nor does somebody signed out', r.status === 401);

  console.log('\n== a visitor checks in ==');
  r = await call(null, 'GET', `/api/door/${token}`);
  check('the form knows the chapter and the service, and nothing else', r.status === 200 && r.data.chapter.name === 'ACONSU KNUST' && r.data.date === today && r.data.serviceType === 'sunday' && !JSON.stringify(r.data).includes('Ama'), r.data);
  r = await call(null, 'POST', `/api/door/${token}`, { name: 'Efua Asante', phone: '020 765 4321', programme: 'BSc Nursing', hall: 'Unity Hall', heard: 'friend', consent: true });
  const efua = fakeModels.ShepherdingRecord._docs.find(x => x.name === 'Efua Asante');
  check('someone new is thanked by their first name', r.status === 200 && r.data.success && r.data.firstName === 'Efua', r.data);
  check('and added to the chapter\'s list as new, from the QR code, with what they gave', efua && efua.chapterId === 'aconsu-knust' && efua.origin === 'qr' && efua.attendanceStatus === 'new'
    && efua.programme === 'BSc Nursing' && efua.address === 'Unity Hall' && efua.consentedAt && /visitor QR code/.test(efua.pastoralNotes) && /a friend/.test(efua.pastoralNotes), efua);
  const register = () => fakeModels.AttendanceRecord._docs.find(x => x.chapterId === 'aconsu-knust' && x.date === today && x.serviceType === 'sunday');
  check('and checked in to today\'s Sunday service', register() && register().marks.some(m => m.recordId === (efua && efua.id) && m.status === 'present'), register());
  const before = fakeModels.ShepherdingRecord._docs.length;
  const again = await call(null, 'POST', `/api/door/${token}`, { name: 'Efua Asante', phone: '+233 20 765 4321', consent: true });
  check('scanning again does not add them twice', again.status === 200 && fakeModels.ShepherdingRecord._docs.length === before);
  r = await call(null, 'POST', `/api/door/${token}`, { name: 'Ama', phone: '024 412 3456', consent: true });
  const amaMark = register().marks.find(m => m.memberId === ama);
  check('a member who uses it, by phone and a name that agrees, is checked in as themselves', r.status === 200 && amaMark && amaMark.status === 'present' && fakeModels.ShepherdingRecord._docs.length === before, register().marks);
  r = await call(null, 'POST', `/api/door/${token}`, { name: 'Kojo Mensah', phone: '0551234567', consent: true });
  check('as is someone on the chapter\'s list', register().marks.some(m => m.recordId === 'rec-kojo' && m.status === 'present') && fakeModels.ShepherdingRecord._docs.length === before);
  const newShape = JSON.stringify(Object.keys(again.data).sort());
  check('the answer is the same whether they were on the list or not', JSON.stringify(Object.keys(r.data).sort()) === newShape && newShape === '["firstName","success"]', [r.data, again.data]);
  r = await call(null, 'POST', `/api/door/${token}`, { name: 'Yaw Boateng', phone: '0244123456', consent: true });
  const yaw = fakeModels.ShepherdingRecord._docs.find(x => x.name === 'Yaw Boateng');
  check('a known number with a name that does not agree checks nobody else in: they are added as new', r.status === 200 && yaw && register().marks.filter(m => m.memberId === ama).length === 1, yaw);
  r = await call(null, 'POST', `/api/door/${token}`, { name: 'No Consent', phone: '0201112223' });
  check('without agreeing to keep the details, nothing is kept', r.status === 400 && !fakeModels.ShepherdingRecord._docs.some(x => x.name === 'No Consent'));
  r = await call(null, 'POST', `/api/door/${token}`, { name: 'No Phone', consent: true });
  check('a phone number is needed', r.status === 400);
  r = await call(null, 'POST', `/api/door/${token}`, { name: 'A Robot', phone: '0209998887', consent: true, website: 'http://spam.example' });
  check('a form filled in by a script is thanked and nothing kept', r.status === 200 && !fakeModels.ShepherdingRecord._docs.some(x => x.name === 'A Robot'));
  r = await call('shep.knust', 'GET', '/api/shepherd/door-code');
  check('Shepherding sees how many checked in with it', r.data.code.uses === 5, r.data.code.uses);
  r = await call('shep.knust', 'GET', `/api/attendance/checkins?date=${today}&serviceType=sunday`);
  check('and the door\'s own list shows them, as if they had been checked in there', r.data.present.some(m => m.name === 'Efua Asante'), r.data.present);

  console.log('\n== where it does not work ==');
  r = await call(null, 'GET', '/api/door/not-a-real-code-at-all');
  check('a made-up code', r.status === 404);
  r = await call(null, 'GET', '/api/door/<script>');
  check('or nonsense', r.status === 404);
  const old = fakeModels.DoorCode._docs.find(d => d.id === code.id);
  old.date = yesterday;
  r = await call(null, 'POST', `/api/door/${token}`, { name: 'Late Comer', phone: '0201231234', consent: true });
  check('yesterday\'s code, a photo of it passed around, adds nobody', r.status === 410 && r.data.expired && !fakeModels.ShepherdingRecord._docs.some(x => x.name === 'Late Comer'), r.data);
  old.date = tomorrow;
  r = await call(null, 'GET', `/api/door/${token}`);
  check('nor does one for a service still to come', r.status === 410);
  old.date = today;
  r = await call('shep.knust', 'POST', '/api/shepherd/door-code', { replace: true });
  const fresh = r.data.code;
  r = await call(null, 'GET', `/api/door/${token}`);
  check('a new code stops the old one at once', fresh.id !== code.id && r.status === 404);
  r = await call('shep.ucc', 'POST', `/api/shepherd/door-code/${fresh.id}/close`);
  check('another chapter cannot turn it off', r.status === 404 && fakeModels.DoorCode._docs.find(d => d.id === fresh.id).active);
  r = await call('shep.knust', 'POST', `/api/shepherd/door-code/${fresh.id}/close`);
  const freshToken = new URL(fresh.url).searchParams.get('c');
  const after = await call(null, 'GET', `/api/door/${freshToken}`);
  check('Shepherding can turn it off, and then it opens nothing', r.status === 200 && after.status === 404);
  check('no other chapter\'s list was touched', !fakeModels.ShepherdingRecord._docs.some(x => x.chapterId === 'aconsu-ucc'));

  console.log(failures ? `\n${failures} FAILURES` : '\nall door check-in checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
