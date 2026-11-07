// A member made an executive: their roster card is filled from their own
// profile, their profile and membership card say which office they hold, and
// a photo, name, phone or email they change later follows onto the card
// (unless the card was given its own). When the term ends, the office goes
// from their pages.
//
//   node test/executive-profile.js     (also run by `npm test`)
const { fakeModels } = require('./harness.js');

(async () => {
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/aconsu_exec_profile', PORT: '4361', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 'test', LOGIN_RATE_LIMIT_MAX: '300' });
  delete process.env.SHEPHERD_USERNAME;

  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 600)}` : ''}`); }
  }
  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4361';
  const jars = {};
  async function call(jar, method, p, body) {
    const h = {};
    if (jar && jars[jar]) h.cookie = jars[jar];
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + p, { method, headers: h, body: payload });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (jar && sc.length) jars[jar] = sc.map(c => c.split(';')[0]).join('; ');
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: res.status, data };
  }
  const photo = (name) => { const fd = new FormData(); fd.append('photo', new Blob([Buffer.from(name)], { type: 'image/png' }), `${name}.png`); return fd; };

  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  const C = 'aconsu-knust';
  await call('admin', 'POST', '/api/national/chapters', { id: C, name: 'ACONSU-KNUST', institution: 'KNUST' });
  const fd = new FormData();
  fd.append('profileImage', new Blob([Buffer.from('first-photo')], { type: 'image/png' }), 'me.png');
  Object.entries({ name: 'Kwame Asante', email: 'kwame@example.com', phone: '0244123456', password: 'secret123', chapterId: C, consent: 'true' }).forEach(([k, v]) => fd.append(k, v));
  let r = await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd });
  jars.kwame = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  const memberId = (await r.json()).member.id;
  const member = () => fakeModels.Member._docs.find(m => m.id === memberId);
  const firstPhoto = member().profileImageFileId;

  console.log('\n== before ==');
  r = await call('kwame', 'GET', '/api/auth/me');
  check('a member who holds no office has none on their profile', r.data.member && r.data.member.office === null, r.data.member && r.data.member.office);

  console.log('\n== made President ==');
  r = await call('admin', 'POST', '/api/admin/staff', { username: 'president.knust', name: 'Kwame Asante', role: 'executive', positionKey: 'president', password: 'Start-Pass-12345', memberId, chapterId: C });
  check('the main admin appoints them (the chapter has no admin of its own yet)', r.status === 200, r.data);
  const staffId = r.data.item && r.data.item.id;
  const card = () => fakeModels.Executive._docs.find(e => e.staffId === staffId);
  check('their roster card is filled from their profile: name, photo, phone and email', card() && card().name === 'Kwame Asante' && card().imageFileId === firstPhoto && card().contact.phone === '0244123456' && card().contact.email === 'kwame@example.com' && card().role === 'President', card());
  r = await call('kwame', 'GET', '/api/auth/me');
  check('their profile now says they are President, confirmed', r.data.member.office && r.data.member.office.title === 'President' && r.data.member.office.confirmed === true, r.data.member.office);
  member().membershipStage = 'active';
  member().membershipNumber = 'ACK-0001';
  r = await call('kwame', 'GET', '/api/member/card');
  check('and so does their membership card', r.data.ready && r.data.office && r.data.office.title === 'President', r.data);
  r = await call('kwame', 'GET', '/api/auth/me');
  check('their profile has a link straight into the Executive Portal, with their office username filled in', (r.data.member.portals || []).length === 1 && r.data.member.portals[0].label === 'Executive Portal' && r.data.member.portals[0].href === '/executive.html?as=president.knust' && r.data.member.portals[0].username === 'president.knust', r.data.member.portals);
  check('and says it is their first sign-in, with the starting password', r.data.member.portals[0].firstSignIn === true);
  check('but never a password', !JSON.stringify(r.data.member.portals).toLowerCase().includes('pass-'));
  r = await fetch(`${BASE}/api/executives`, { headers: { 'X-Chapter-Id': C } }).then(x => x.json());
  check('the chapter\'s executives list shows them as President, with their photo', Array.isArray(r) && r.some(e => e.name === 'Kwame Asante' && e.role === 'President' && e.imageFileId === firstPhoto), r);

  console.log('\n== they change their profile ==');
  r = await call('kwame', 'POST', '/api/member/photo', photo('second-photo'));
  check('a new photo', r.status === 200, r.data);
  const secondPhoto = member().profileImageFileId;
  check('reaches their roster card, so it never points at the photo just deleted', card().imageFileId === secondPhoto && secondPhoto !== firstPhoto, { card: card().imageFileId, secondPhoto, firstPhoto });
  const edit = new FormData();
  Object.entries({ name: 'Kwame Asante-Boateng', phone: '0244999888', email: 'kwame.ab@example.com' }).forEach(([k, v]) => edit.append(k, v));
  r = await call('kwame', 'PUT', '/api/member/profile', edit);
  check('a new name, phone and email on the profile', r.status === 200, r.data);
  check('reach the roster card too', card().name === 'Kwame Asante-Boateng' && card().contact.phone === '0244999888' && card().contact.email === 'kwame.ab@example.com', card());
  // A picture chosen for the roster itself is the executive's choice and stays.
  card().imageFileId = 'formal-portrait';
  card().contact.email = 'president@aconsu.org';
  await call('kwame', 'POST', '/api/member/photo', photo('third-photo'));
  const third = new FormData(); third.append('email', 'kwame.third@example.com');
  await call('kwame', 'PUT', '/api/member/profile', third);
  check('but a photo or email set on the card itself is kept', card().imageFileId === 'formal-portrait' && card().contact.email === 'president@aconsu.org', card());

  console.log('\n== the other offices ==');
  const leader = async (name, email, phone, account) => {
    const f = new FormData();
    f.append('profileImage', new Blob([Buffer.from(name)], { type: 'image/png' }), 'me.png');
    Object.entries({ name, email, phone, password: 'secret123', chapterId: C, consent: 'true' }).forEach(([k, v]) => f.append(k, v));
    const res = await fetch(BASE + '/api/auth/register', { method: 'POST', body: f });
    const jar = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const id = (await res.json()).member.id;
    const made = await call('admin', 'POST', '/api/admin/staff', { ...account, memberId: id, chapterId: C, password: 'Start-Pass-12345' });
    if (made.status !== 200) console.log('   (could not make the account)', JSON.stringify(made.data).slice(0, 200));
    return jar;
  };
  jars.coord = await leader('Abena Coordinator', 'abena@example.com', '0244000111', { username: 'coord.knust', name: 'Abena Coordinator', role: 'coordinator' });
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; a.mustSetUpSecondStep = false; });
  r = await call('coord', 'GET', '/api/auth/me');
  check('a Coordinator using the app gets a link to the Coordinator Portal', (r.data.member.portals || []).some(p => p.label === 'Coordinator Portal' && p.href === '/coordinator.html?as=coord.knust' && !p.firstSignIn), r.data.member.portals);
  // The chapter now runs itself: its Coordinator makes the other accounts.
  await call('coordAcct', 'POST', '/api/portal/login', { username: 'coord.knust', password: 'Start-Pass-12345', chapterId: C });
  jars.admin = jars.coordAcct;
  jars.fin = await leader('Yaw Finance', 'yaw@example.com', '0244000222', { username: 'fin.knust', name: 'Yaw Finance', role: 'finance' });
  r = await call('fin', 'GET', '/api/auth/me');
  check('the Finance officer gets a link to the Finance Office', (r.data.member.portals || []).some(p => p.label === 'Finance Office' && p.href === '/finance.html?as=fin.knust'), r.data.member.portals);
  const dept = (await call('admin', 'POST', '/api/admin/departments', { name: 'Publicity', description: 'Telling the chapter' })).data.item;
  jars.pub = await leader('Esi Publicity', 'esi@example.com', '0244000333', { username: 'publicityhead.knust', name: 'Esi Publicity', role: 'executive', positionKey: 'publicity_head', executiveDepartment: dept && dept.id, department: dept && dept.id });
  r = await call('pub', 'GET', '/api/auth/me');
  const pubLinks = (r.data.member.portals || []).map(p => p.label);
  check('the Publicity Head gets both the Executive Portal and Publicity, the office they run', pubLinks.includes('Executive Portal') && pubLinks.includes('Publicity'), r.data.member.portals);
  jars.plain = (await fetch(BASE + '/api/auth/register', { method: 'POST', body: (() => { const f = new FormData(); f.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png'); Object.entries({ name: 'Plain Member', email: 'plain@example.com', phone: '0244000444', password: 'secret123', chapterId: C, consent: 'true' }).forEach(([k, v]) => f.append(k, v)); return f; })() })).headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  r = await call('plain', 'GET', '/api/auth/me');
  check('a member who holds no office gets no office links', Array.isArray(r.data.member.portals) && r.data.member.portals.length === 0, r.data.member.portals);

  console.log('\n== the term ends ==');
  r = await call('admin', 'PUT', `/api/admin/staff/${staffId}`, { endTerm: true });
  check('the chapter\'s Coordinator ends the term (the main admin may not, unless the chapter asks)', r.status === 200, r.data);
  r = await call('kwame', 'GET', '/api/auth/me');
  check('and the office is gone from their profile', r.data.member.office === null, r.data.member.office);
  r = await call('kwame', 'GET', '/api/member/card');
  check('and from their membership card', !r.data.office, r.data.office);
  r = await call('kwame', 'GET', '/api/auth/me');
  check('and so is the link to the Executive Portal', (r.data.member.portals || []).length === 0, r.data.member.portals);

  console.log(failures ? `\n${failures} FAILURES` : '\nall executive profile checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
