// Members stay signed in, as on X or WhatsApp: 90 days, counted again from each
// day they open the app. Leaders' portals keep their 8 hours. Signing out, and a
// password change elsewhere, still end it.
//
//   node test/stay-signed-in.js     (also run by `npm test`)
const { fakeModels } = require('./harness.js');

(async () => {
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/aconsu_stay', PORT: '4376', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 'test', LOGIN_RATE_LIMIT_MAX: '500' });
  delete process.env.SHEPHERD_USERNAME;
  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 500)}` : ''}`); }
  }
  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4376';
  const jars = {};
  const lastCookie = {};
  async function call(jar, method, p, body) {
    const h = {};
    if (jars[jar]) h.cookie = jars[jar];
    if (body) h['content-type'] = 'application/json';
    const res = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.getSetCookie();
    if (sc.length) { jars[jar] = sc.map(c => c.split(';')[0]).join('; '); lastCookie[jar] = sc.join(' | '); }
    return { status: res.status, data: await res.json().catch(() => ({})), setCookie: sc.join(' | ') };
  }
  // How long the cookie the browser was just given lasts, in days.
  const daysLeft = (setCookie) => {
    const m = /Expires=([^;|]+)/i.exec(setCookie || '');
    return m ? (new Date(m[1]).getTime() - Date.now()) / 86400000 : 0;
  };

  const C = 'aconsu-knust';
  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  await call('admin', 'POST', '/api/national/chapters', { id: C, name: 'ACONSU-KNUST', institution: 'KNUST' });
  const f = new FormData();
  f.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
  Object.entries({ name: 'Efua Stays', email: 'efua@example.com', phone: '0244900100', password: 'a-good-long-password', chapterId: C, consent: 'true' }).forEach(([k, v]) => f.append(k, v));
  const memberId = (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: f })).json()).member.id;

  console.log('\n== a member ==');
  let r = await call('phone', 'POST', '/api/auth/login', { identifier: 'efua@example.com', password: 'a-good-long-password' });
  check('(signed in)', r.status === 200, r.data);
  r = await call('phone', 'GET', '/api/auth/me');
  check('opening the app gives the phone a sign-in that lasts about 90 days', daysLeft(r.setCookie) > 89 && daysLeft(r.setCookie) <= 90.01, r.setCookie);
  r = await call('phone', 'GET', '/api/auth/me');
  check('opening it again the same day changes nothing (no needless writes)', r.setCookie === '' && r.data.member && r.data.member.id === memberId, r.setCookie);
  r = await call('phone', 'POST', '/api/auth/logout');
  r = await call('phone', 'GET', '/api/auth/me');
  check('signing out still signs out', r.data.member === null, r.data);

  console.log('\n== a password change elsewhere ==');
  await call('a', 'POST', '/api/auth/login', { identifier: 'efua@example.com', password: 'a-good-long-password' });
  await call('a', 'GET', '/api/auth/me');
  await call('b', 'POST', '/api/auth/login', { identifier: 'efua@example.com', password: 'a-good-long-password' });
  r = await call('b', 'PUT', '/api/member/password', { currentPassword: 'a-good-long-password', newPassword: 'another-long-password' });
  check('(the password is changed on another phone)', r.status === 200, r.data);
  r = await call('a', 'GET', '/api/auth/me');
  check('still ends the long sign-in on the first phone', r.data.member === null, r.data);

  console.log('\n== a leader ==');
  await call('admin', 'POST', '/api/admin/staff', { username: 'fin.knust', name: 'Efua Stays', role: 'finance', password: 'Office-Pass-12345', memberId, chapterId: C });
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; a.mustSetUpSecondStep = false; });
  r = await call('fin', 'POST', '/api/portal/login', { username: 'fin.knust', password: 'Office-Pass-12345', portal: 'finance' });
  check('a leader\'s portal sign-in still lasts 8 hours', r.status === 200 && daysLeft(r.setCookie) > 0.3 && daysLeft(r.setCookie) < 0.34, r.setCookie);
  r = await call('fin', 'GET', '/api/portal/me');
  check('and is not stretched by using it', r.setCookie === '' || daysLeft(r.setCookie) < 0.34, r.setCookie);

  console.log(failures ? `\n${failures} FAILURES` : '\nall stay-signed-in checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
