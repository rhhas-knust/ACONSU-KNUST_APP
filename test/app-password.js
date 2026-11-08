// A leader signs in to their office's portal with the password they use in
// the app: with their phone number, their email, or their office username. The
// office's own password keeps working. A leader's rules still hold: the app
// password must be 12 characters, a second step set up is still asked for, an
// ended term opens nothing, and the portal must be one their office uses.
//
//   node test/app-password.js     (also run by `npm test`)
const { fakeModels } = require('./harness.js');

(async () => {
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/aconsu_app_password', PORT: '4373', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 'test', LOGIN_RATE_LIMIT_MAX: '500' });
  delete process.env.SHEPHERD_USERNAME;

  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 600)}` : ''}`); }
  }
  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4373';
  const jars = {};
  async function call(jar, method, p, body) {
    const h = {};
    if (jar && jars[jar]) h.cookie = jars[jar];
    if (body) h['content-type'] = 'application/json';
    const res = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (jar && sc.length) jars[jar] = sc.map(c => c.split(';')[0]).join('; ');
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }
  const C = 'aconsu-knust';
  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  await call('admin', 'POST', '/api/national/chapters', { id: C, name: 'ACONSU-KNUST', institution: 'KNUST' });
  const pubDept = (await call('admin', 'POST', '/api/admin/departments', { name: 'Publicity', chapterId: C })).data.item;
  const mediaDept = (await call('admin', 'POST', '/api/admin/departments', { name: 'Media', chapterId: C })).data.item;

  const LONG = 'my-own-long-password';
  async function member(name, email, phone, password) {
    const f = new FormData();
    f.append('profileImage', new Blob([Buffer.from(name)], { type: 'image/png' }), 'me.png');
    Object.entries({ name, email, phone, password, chapterId: C, consent: 'true' }).forEach(([k, v]) => f.append(k, v));
    return (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: f })).json()).member.id;
  }
  const staff = async (memberId, account) => (await call('admin', 'POST', '/api/admin/staff', { ...account, memberId, chapterId: C })).data;

  const kwame = await member('Kwame Asante', 'kwame@example.com', '0244123456', LONG);
  const pres = await staff(kwame, { name: 'Kwame Asante', role: 'executive', positionKey: 'president' }); // the office login: president.knust / president123
  const esi = await member('Esi Owusu', 'esi@example.com', '0244222333', LONG);
  await staff(esi, { username: 'publicityhead.knust', name: 'Esi Owusu', role: 'executive', positionKey: 'publicity_head', executiveDepartment: pubDept.id, department: pubDept.id, password: 'Office-Pass-12345' });
  const ama = await member('Ama Short', 'ama@example.com', '0244333444', 'secret123');
  await staff(ama, { username: 'fin.knust', name: 'Ama Short', role: 'finance', password: 'Office-Pass-12345' });
  const yaw = await member('Yaw Two', 'yaw@example.com', '0244444555', LONG);
  await staff(yaw, { username: 'mediahead.knust', name: 'Yaw Two', role: 'executive', positionKey: 'media_head', executiveDepartment: mediaDept.id, department: mediaDept.id, password: 'Office-Pass-12345' });
  await staff(yaw, { username: 'yaw.media', name: 'Yaw Two', role: 'media', password: 'Office-Pass-12345' });
  const plain = await member('Plain Member', 'plain@example.com', '0244555666', LONG);
  fakeModels.StaffUser._docs.filter(a => a.username !== (pres.item && pres.item.username)).forEach(a => { a.mustChangePassword = false; a.mustSetUpSecondStep = false; });
  const presAccount = () => fakeModels.StaffUser._docs.find(a => a.memberId === kwame);
  check('(the President\'s office login is still on its starting password)', presAccount() && presAccount().mustChangePassword === true && presAccount().username === 'president.knust', presAccount());

  const signIn = (jar, username, password, portal, extra) => call(jar, 'POST', '/api/portal/login', { username, password, ...(portal ? { portal } : {}), ...(extra || {}) });
  const me = async (jar) => (await call(jar, 'GET', '/api/portal/me')).data;

  console.log('\n== the app password opens the office ==');
  let r = await signIn('k1', '024 412 3456', LONG, 'executive');
  check('the President signs in to the Executive Portal with their phone number and app password', r.status === 200 && r.data.success && r.data.staff.username === 'president.knust', r.data);
  check('and is not asked to choose a password: they used their own', r.data.mustChangePassword === false);
  check('so the guessable starting password no longer works', (await signIn('k0', 'president.knust', 'president123', 'executive')).status === 401);
  check('and the office username with the app password does', (await signIn('k2', 'president.knust', LONG, 'executive')).status === 200);
  r = await signIn('k3', 'Kwame@Example.com', LONG, 'executive');
  check('so does their email, written any way', r.status === 200 && r.data.staff.username === 'president.knust', r.data);
  let m = await me('k3');
  check('and the portal opens for them', m.access && m.access.executive && m.access.executive.view, m.access && m.access.executive);

  console.log('\n== the right office for the portal ==');
  r = await signIn('e1', 'esi@example.com', LONG, 'publicity');
  check('the Publicity Head\'s app password opens Publicity', r.status === 200 && (await me('e1')).access.publicity.view, r.data);
  r = await signIn('e2', 'esi@example.com', LONG, 'executive');
  check('and the Executive Portal', r.status === 200);
  r = await signIn('e3', 'esi@example.com', LONG, 'finance');
  check('but not Finance: their office does not use it', r.status === 403 && /does not use this portal/.test(r.data.error), r.data);
  r = await signIn('y1', 'yaw@example.com', LONG, 'media');
  check('two offices that both use the portal: asked to use that office\'s username', r.status === 409 && /username/.test(r.data.error), r.data);
  check('which works', (await signIn('y2', 'yaw.media', 'Office-Pass-12345', 'media')).status === 200);

  console.log('\n== a leader\'s rules still hold ==');
  r = await signIn('a1', 'ama@example.com', 'secret123', 'finance');
  check('a short app password is refused, saying to make it longer, and that the office password still works', r.status === 403 && /12 characters/.test(r.data.error) && /still work/.test(r.data.error), r.data);
  check('the office username with a short app password is refused the same way', (await signIn('a2', 'fin.knust', 'secret123', 'finance')).status === 403);
  check('the office\'s own password still works', (await signIn('a3', 'fin.knust', 'Office-Pass-12345', 'finance')).status === 200);
  r = await signIn('k4', 'kwame@example.com', 'not-my-password-at-all', 'executive');
  check('a wrong app password is refused', r.status === 401 && /do not match/.test(r.data.error), r.data);
  r = await signIn('p1', 'plain@example.com', LONG, 'executive');
  check('a member who holds no office is told so', r.status === 403 && /does not hold an office/.test(r.data.error), r.data);
  r = await signIn('k5', 'kwame@example.com', LONG, 'executive', { chapterId: 'aconsu-ucc' });
  check('choosing a chapter that is not theirs is refused', r.status === 403);

  presAccount().totpEnabledAt = new Date().toISOString();
  r = await signIn('k6', 'kwame@example.com', LONG, 'executive');
  check('with a second step set up, the code is still asked for', r.status === 200 && r.data.needsSecondStep === true && !r.data.staff, r.data);
  m = await me('k6');
  check('and nothing opens until it is given', !(m.access && m.access.executive && m.access.executive.view));
  presAccount().totpEnabledAt = null;

  presAccount().endedAt = new Date().toISOString();
  r = await signIn('k7', 'kwame@example.com', LONG, 'executive');
  check('an office whose term has ended opens nothing', r.status === 403 && /does not hold an office/.test(r.data.error), r.data);
  presAccount().endedAt = null;

  console.log('\n== the chapter admin page ==');
  const kofi = await member('Kofi Admin', 'kofi@example.com', '0244666777', LONG);
  await staff(kofi, { username: 'chadmin.knust', name: 'Kofi Admin', role: 'chapterAdmin', password: 'Office-Pass-12345' });
  fakeModels.StaffUser._docs.forEach(a => { if (a.username === 'chadmin.knust') { a.mustChangePassword = false; a.mustSetUpSecondStep = false; } });
  r = await signIn('c1', '0244666777', LONG, 'admin');
  check('a chapter admin signs in to the admin page with their app password', r.status === 200 && r.data.staff.role === 'chapterAdmin', r.data);
  r = await signIn('c2', '0244666777', LONG, 'publicity');
  check('but it does not open Publicity for them', r.status === 403);
  check('and the main admin\'s own login is untouched', (await signIn('z', 'admin', 'admin123', 'admin')).status === 200);
  void plain;

  console.log(failures ? `\n${failures} FAILURES` : '\nall app password checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
