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

  console.log('\n== the term ends ==');
  r = await call('admin', 'PUT', `/api/admin/staff/${staffId}`, { endTerm: true });
  check('the term is ended', r.status === 200, r.data);
  r = await call('kwame', 'GET', '/api/auth/me');
  check('and the office is gone from their profile', r.data.member.office === null, r.data.member.office);
  r = await call('kwame', 'GET', '/api/member/card');
  check('and from their membership card', !r.data.office, r.data.office);

  console.log(failures ? `\n${failures} FAILURES` : '\nall executive profile checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
