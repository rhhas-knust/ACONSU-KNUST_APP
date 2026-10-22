// A chapter's look is its own: the main admin may change a chapter's site
// settings, artwork, media, custom pages and department pages only while that
// chapter has asked it to. Boots the real app on the in-memory data layer.
//
//   node test/chapter-look.js     (also run by `npm test`)
const { fakeModels } = require('./harness.js');
{
  const realFetch = global.fetch;
  global.fetch = (url, opts) => {
    if (/\/api\/auth\/register$/.test(String(url)) && opts && opts.body instanceof FormData && !opts.body.has('consent')) opts.body.append('consent', 'true');
    return realFetch(url, opts);
  };
}

(async () => {
  process.env.MONGODB_URI = 'mongodb://stub/aconsu_look';
  process.env.MAP_LINK_RESOLVE = 'off'; // map links are never followed out to Google from a test
  process.env.PORT = '4324';
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'admin123';
  process.env.SESSION_SECRET = 'test';
  process.env.LOGIN_RATE_LIMIT_MAX = '200';
  delete process.env.SHEPHERD_USERNAME;
  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));

  const BASE = 'http://127.0.0.1:4324';
  let failures = 0;
  const jars = {};
  async function call(jar, method, path, body, headers, isForm) {
    const h = { ...(headers || {}) };
    if (jars[jar]) h.cookie = jars[jar];
    let payload;
    if (body && !isForm) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); } else if (body) payload = body;
    const res = await fetch(BASE + path, { method, headers: h, body: payload });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (sc.length) jars[jar] = sc.map(c => c.split(';')[0]).join('; ');
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: res.status, data };
  }
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail ? ` - ${JSON.stringify(detail).slice(0, 300)}` : ''}`); }
  }
  const asked = (r) => r.status === 403 && r.data && r.data.needsChapterRequest === true;

  console.log('\n== setting up three chapters ==');
  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  for (const [id, name] of [['knust', 'ACONSU-KNUST'], ['ucc', 'ACONSU-UCC'], ['legon', 'ACONSU-Legon']]) {
    await call('admin', 'POST', '/api/national/chapters', { id, name, institution: name });
  }
  let n = 0;
  const member = async (name, chapterId) => {
    n += 1;
    const fd = new FormData();
    fd.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
    fd.append('name', name); fd.append('email', `look${n}@test.com`); fd.append('password', 'secret123'); fd.append('chapterId', chapterId);
    return (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd })).json()).member.id;
  };
  const deptK = (await call('admin', 'POST', '/api/admin/departments', { name: 'Choir', chapterId: 'knust' })).data.item.id;
  check('before a chapter has an admin of its own, the main admin sets it up', !!deptK);
  for (const [username, role, chapterId] of [['coord.k', 'coordinator', 'knust'], ['admin.u', 'chapterAdmin', 'ucc'], ['fin.k', 'finance', 'knust']]) {
    const r = await call('admin', 'POST', '/api/admin/staff', { username, name: username, role, password: 'password123', memberId: await member(username, chapterId), chapterId });
    check(`${username} is created`, r.status === 200, r.data);
    await call(username, 'POST', '/api/portal/login', { username, password: 'password123' });
  }
  await call('member', 'POST', '/api/auth/login', { email: 'look1@test.com', password: 'secret123' });

  console.log('\n== without a request, the main admin cannot change a chapter\'s look ==');
  const K = { 'X-Chapter-Id': 'knust' };
  let r = await call('admin', 'PUT', '/api/admin/chapter-settings', { tagline: 'Changed from above' }, K);
  check('not its site settings', asked(r) && /ACONSU-KNUST/.test(r.data.error), r.data);
  r = await call('admin', 'POST', '/api/admin/departments', { name: 'Media', chapterId: 'knust' });
  check('not by naming the chapter in the request either', asked(r), r.data);
  r = await call('admin', 'PUT', `/api/admin/departments/${deptK}`, { tagline: 'Sing louder' }, K);
  check('not its department pages', asked(r), r.data);
  r = await call('admin', 'POST', '/api/admin/pages', { title: 'Our story', slug: 'story' }, K);
  check('not its custom pages', asked(r), r.data);
  r = await call('admin', 'DELETE', '/api/admin/hero-art/home', null, K);
  check('not its artwork', asked(r), r.data);
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0])], { type: 'image/jpeg' }), 'x.jpg');
  r = await call('admin', 'POST', '/api/admin/uploads', fd, K, true);
  check('not its media library', asked(r), r.data);
  r = await call('admin', 'POST', '/api/admin/content', { kind: 'weekly_highlight', title: 'x' }, K);
  check('not its content hub', asked(r), r.data);
  r = await call('admin', 'GET', '/api/admin/chapter-settings', null, K);
  check('it can still look', r.status === 200, r.data);
  r = await call('admin', 'POST', '/api/admin/events', { title: 'Joint rally', date: '2026-12-01', chapterId: 'knust' });
  check('and what is not the chapter\'s look is unchanged (an event)', r.status === 200, r.data);
  r = await call('admin', 'PUT', '/api/admin/chapter-settings', { tagline: 'A new chapter' }, { 'X-Chapter-Id': 'legon' });
  check('a chapter with no admin of its own yet can still be set up', r.status === 200, r.data);
  r = await call('coord.k', 'PUT', '/api/admin/chapter-settings', { tagline: 'Our own words' });
  check('the chapter\'s own Coordinator changes its look whenever it likes', r.status === 200, r.data);
  r = await call('admin.u', 'PUT', '/api/admin/chapter-settings', { tagline: 'Ours too' });
  check('so does another chapter\'s own admin, for their chapter', r.status === 200, r.data);

  r = await call('admin', 'GET', '/api/chapter-requests/status?chapterId=knust');
  check('the dashboard can see why: the chapter has not asked', r.status === 200 && r.data.canChangeLook === false && r.data.reason === 'not_asked', r.data);
  r = await call('admin', 'GET', '/api/chapter-requests/status?chapterId=legon');
  check('and that a chapter with no admin is in set-up', r.data.canChangeLook === true && r.data.reason === 'setup', r.data);

  console.log('\n== asking ==');
  r = await call('coord.k', 'POST', '/api/chapter-requests', { message: 'hi' });
  check('a request has to say what is needed', r.status === 400, r.data);
  for (const jar of ['fin.k', 'member', 'anon']) {
    r = await call(jar, 'POST', '/api/chapter-requests', { message: 'Please change our banner photo.' });
    check(`${jar} cannot ask on the chapter's behalf`, r.status === 401 || r.status === 403, r);
  }
  r = await call('coord.k', 'POST', '/api/chapter-requests', { message: 'Please replace our banner with the retreat photo.', days: 99, chapterId: 'ucc' });
  check('the Coordinator asks, for their own chapter whatever the request names, and for at most 30 days',
    r.status === 200 && r.data.item.chapterId === 'knust' && new Date(r.data.item.expiresAt) <= new Date(Date.now() + 30 * 86400000 + 5000), r.data);
  const reqK = r.data.item.id;
  r = await call('admin', 'PUT', '/api/admin/chapter-settings', { tagline: 'Banner updated by National' }, K);
  check('now the main admin can change that chapter\'s look', r.status === 200, r.data);
  r = await call('admin', 'POST', '/api/admin/departments', { name: 'Media', chapterId: 'knust' });
  check('all of it, while the request is open', r.status === 200, r.data);
  r = await call('admin', 'PUT', '/api/admin/chapter-settings', { tagline: 'Not asked' }, { 'X-Chapter-Id': 'ucc' });
  check('but only that chapter\'s: another chapter that has not asked stays closed', asked(r), r.data);
  r = await call('admin', 'GET', '/api/chapter-requests/status?chapterId=knust');
  check('the status says it was asked, and shows the request', r.data.canChangeLook === true && r.data.reason === 'asked' && r.data.request.id === reqK, r.data);

  console.log('\n== who sees the requests ==');
  await call('admin.u', 'POST', '/api/chapter-requests', { message: 'Please add our new logo.' });
  r = await call('admin', 'GET', '/api/chapter-requests');
  check('the main admin sees every chapter\'s open requests, with the chapter named', r.status === 200 && r.data.open === 2 && r.data.items.some(i => i.chapterName === 'ACONSU-UCC'), r.data);
  r = await call('coord.k', 'GET', '/api/chapter-requests');
  check('a chapter sees only its own', r.data.items.length === 1 && r.data.items[0].chapterId === 'knust' && r.data.mayAsk === true, r.data);
  r = await call('member', 'GET', '/api/chapter-requests');
  check('a member sees none', r.status === 401, r);

  console.log('\n== closing ==');
  r = await call('admin.u', 'POST', `/api/chapter-requests/${reqK}/close`);
  check('another chapter cannot close it', r.status === 404, r.data);
  r = await call('coord.k', 'POST', `/api/chapter-requests/${reqK}/close`);
  check('the chapter withdraws its request', r.status === 200 && r.data.item.status === 'withdrawn', r.data);
  r = await call('admin', 'PUT', '/api/admin/chapter-settings', { tagline: 'Too late' }, K);
  check('and the main admin is closed out again at once', asked(r), r.data);
  r = await call('coord.k', 'POST', '/api/chapter-requests', { message: 'Please fix our department header.' });
  const second = r.data.item.id;
  r = await call('admin', 'POST', `/api/chapter-requests/${second}/close`, { note: 'Header replaced.' });
  check('the main admin marks a request done when the work is finished', r.status === 200 && r.data.item.status === 'done' && r.data.item.closedNote === 'Header replaced.', r.data);
  r = await call('admin', 'PUT', '/api/admin/chapter-settings', { tagline: 'After done' }, K);
  check('which closes the door too', asked(r), r.data);

  console.log('\n== a request does not stay open for ever ==');
  r = await call('coord.k', 'POST', '/api/chapter-requests', { message: 'Please update the about page.', days: 1 });
  const third = fakeModels.ChapterRequest._docs.find(d => d.id === r.data.item.id);
  third.expiresAt = new Date(Date.now() - 1000).toISOString();
  r = await call('admin', 'PUT', '/api/admin/chapter-settings', { tagline: 'Expired' }, K);
  check('once its days are up, the main admin is closed out', asked(r), r.data);
  r = await call('coord.k', 'GET', '/api/chapter-requests');
  check('and the request shows as expired', r.data.items.find(i => i.id === third.id).status === 'expired', r.data.items);
  for (let i = 0; i < 3; i += 1) await call('coord.k', 'POST', '/api/chapter-requests', { message: `Request number ${i + 1} please.` });
  r = await call('coord.k', 'POST', '/api/chapter-requests', { message: 'One more please.' });
  check('a chapter can have at most three open at once', r.status === 409, r.data);

  console.log('\n== what a first-time visitor is told ==');
  r = await call('coord.k', 'PUT', '/api/admin/chapter-settings', { location: 'Great Hall', address: 'KNUST Campus, Kumasi', serviceTimes: 'Sundays 8:00 AM\nWednesdays 6:30 PM', about: { firstVisit: 'Services last about two hours. Ushers at the door will help you find a seat.' } });
  check('the chapter writes what a first-time visitor should know', r.status === 200, r.data);
  r = await call('anon', 'GET', '/api/settings', null, K);
  check('a visitor\'s page is given it, with the meeting times and place', r.data.about && /two hours/.test(r.data.about.firstVisit) && r.data.meetingPlace === 'Great Hall' && r.data.serviceTimes.length === 2, r.data);
  r = await call('anon', 'GET', '/api/settings', null, { 'X-Chapter-Id': 'ucc' });
  check('and another chapter\'s visitors are told that chapter\'s, not this one\'s', !(r.data.about && /two hours/.test(r.data.about.firstVisit || '')), r.data.about);

  console.log(failures ? `\n${failures} check(s) failed` : '\nall chapter-look checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
