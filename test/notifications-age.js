// Notifications leave members' feed and bell after two days. They stay stored
// for the admin's history (until the yearly clear-out), and the admin's
// Notifications panel still shows them. NOTIFICATIONS_SHOW_DAYS changes the two.
//
//   node test/notifications-age.js     (also run by `npm test`)
const { fakeModels } = require('./harness.js');

(async () => {
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/aconsu_notif_age', PORT: '4379', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 'test', LOGIN_RATE_LIMIT_MAX: '500' });
  ['SHEPHERD_USERNAME', 'NOTIFICATIONS_SHOW_DAYS'].forEach(k => delete process.env[k]);
  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 500)}` : ''}`); }
  }
  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4379';
  const jars = {};
  async function call(jar, method, p, body) {
    const h = { 'X-Chapter-Id': 'aconsu-knust' };
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
  const f = new FormData();
  f.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
  Object.entries({ name: 'Ama Reader', email: 'ama@example.com', phone: '0244600100', password: 'secret123', chapterId: C, consent: 'true' }).forEach(([k, v]) => f.append(k, v));
  const reg = await fetch(BASE + '/api/auth/register', { method: 'POST', body: f });
  jars.ama = reg.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');

  for (const title of ['Three days old', 'Yesterday', 'Just now']) {
    await call('admin', 'POST', '/api/admin/notifications', { title, body: 'A notice', url: '/index.html', chapterId: C });
  }
  const doc = (title) => fakeModels.Notification._docs.find(n => n.title === title);
  const daysAgo = (d) => new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
  doc('Three days old').createdAt = daysAgo(3);
  doc('Yesterday').createdAt = daysAgo(1);
  const titles = (r) => (Array.isArray(r.data) ? r.data.map(n => n.title) : r.data);

  let r = await call('ama', 'GET', '/api/notifications');
  check('a member sees the last two days\' notifications', titles(r).includes('Just now') && titles(r).includes('Yesterday'), titles(r));
  check('and not one from three days ago: it has cleared away', !titles(r).includes('Three days old'), titles(r));
  r = await call(null, 'GET', '/api/notifications');
  check('the same for someone not signed in', !titles(r).includes('Three days old') && titles(r).includes('Just now'), titles(r));
  r = await call('ama', 'GET', '/api/notifications?all=1');
  check('a member cannot ask for the old ones back', !titles(r).includes('Three days old'), titles(r));
  r = await call('admin', 'GET', '/api/notifications?all=1');
  check('the admin\'s history still has every one', ['Three days old', 'Yesterday', 'Just now'].every(t => titles(r).includes(t)), titles(r));
  check('and it is still stored (the yearly clear-out removes it, not this)', !!doc('Three days old'));

  process.env.NOTIFICATIONS_SHOW_DAYS = '1';
  doc('Yesterday').createdAt = daysAgo(1.5);
  r = await call('ama', 'GET', '/api/notifications');
  check('NOTIFICATIONS_SHOW_DAYS=1 shows one day', titles(r).includes('Just now') && !titles(r).includes('Yesterday'), titles(r));
  process.env.NOTIFICATIONS_SHOW_DAYS = '0';
  r = await call('ama', 'GET', '/api/notifications');
  check('and 0 shows them all again', titles(r).includes('Three days old'), titles(r));
  delete process.env.NOTIFICATIONS_SHOW_DAYS;

  console.log(failures ? `\n${failures} FAILURES` : '\nall notification age checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
