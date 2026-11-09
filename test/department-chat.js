// Every department has its own chat: its members and its head talk there, and
// nobody else reads it. The About page lists the chapter's Coordinator and its
// executives from their app profiles, and the National Coordinator only once
// they choose to be listed.
//
//   node test/department-chat.js     (also run by `npm test`)
const { fakeModels } = require('./harness.js');
const push = require('../lib/push');

(async () => {
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/aconsu_dept_chat', PORT: '4381', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 'test', LOGIN_RATE_LIMIT_MAX: '500' });
  delete process.env.SHEPHERD_USERNAME;
  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 600)}` : ''}`); }
  }
  // What would have been pushed, and to whom.
  const pushed = [];
  push.sendPushToAll = async (payload, chapterId, memberIds) => { pushed.push({ payload, chapterId, memberIds }); return { sent: 0 }; };

  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4381';
  const jars = {};
  async function call(jar, method, p, body, headers) {
    const h = { ...(headers || {}) };
    if (jars[jar]) h.cookie = jars[jar];
    if (body) h['content-type'] = 'application/json';
    const res = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.getSetCookie();
    if (sc.length) jars[jar] = sc.map(c => c.split(';')[0]).join('; ');
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }
  const C = 'aconsu-knust';
  const OTHER = 'aconsu-ug';
  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  await call('admin', 'POST', '/api/national/chapters', { id: C, name: 'ACONSU-KNUST', institution: 'KNUST' });
  await call('admin', 'POST', '/api/national/chapters', { id: OTHER, name: 'ACONSU-UG', institution: 'UG' });
  let n = 0;
  async function member(name, chapterId) {
    n += 1;
    const f = new FormData();
    f.append('profileImage', new Blob([Buffer.from(name)], { type: 'image/png' }), 'me.png');
    Object.entries({ name, email: `d${n}@example.com`, phone: `02446000${String(n).padStart(2, '0')}`, password: 'a-good-long-password', chapterId: chapterId || C, consent: 'true' }).forEach(([k, v]) => f.append(k, v));
    const out = await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: f })).json();
    return { id: out.member.id, email: `d${n}@example.com` };
  }
  const signIn = (jar, who) => call(jar, 'POST', '/api/auth/login', { email: who.email, password: 'a-good-long-password' });
  const putIn = (who, deptId) => { fakeModels.Member._docs.find(m => m.id === who.id).departments = [deptId]; };

  const choir = (await call('admin', 'POST', '/api/admin/departments', { name: 'Choir', chapterId: C })).data.item;
  const ushers = (await call('admin', 'POST', '/api/admin/departments', { name: 'Ushering', chapterId: C })).data.item;
  const head = await member('Ama Music');
  await call('admin', 'POST', '/api/admin/staff', { role: 'executive', positionKey: 'music_director', memberId: head.id, chapterId: C, department: choir.id });
  const kofi = await member('Kofi Singer');
  const esi = await member('Esi Alto');
  const yaw = await member('Yaw Usher');
  const away = await member('Abena Elsewhere', OTHER);
  putIn(kofi, choir.id); putIn(esi, choir.id); putIn(yaw, ushers.id);
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; a.mustSetUpSecondStep = false; });
  for (const [jar, who] of [['head', head], ['kofi', kofi], ['esi', esi], ['yaw', yaw], ['away', away]]) await signIn(jar, who);
  const chat = `/api/departments/${choir.id}/chat`;

  console.log('\n== who is in ==');
  let r = await call(null, 'GET', chat);
  check('a visitor who is not signed in is asked to sign in', r.status === 401, r);
  r = await call('kofi', 'GET', chat);
  check('a member of the department opens its chat, with nothing set up first', r.status === 200 && r.data.department.name === 'Choir' && Array.isArray(r.data.threads) && r.data.isHead === false, r.data);
  r = await call('head', 'GET', chat);
  check('its head opens it too, as its head (they are on the roster card, not in the member list)', r.status === 200 && r.data.isHead === true, r.data);
  r = await call('yaw', 'GET', chat);
  check('a member of another department is kept out, and told how to join', r.status === 403 && /Departments page/.test(r.data.error), r.data);
  r = await call('away', 'GET', chat);
  check('someone in another chapter is not told it exists', r.status === 404, r.data);

  console.log('\n== talking ==');
  pushed.length = 0;
  r = await call('kofi', 'POST', chat, { body: 'Practice moved to 5pm on Saturday?' });
  check('a member posts', r.status === 200 && r.data.item.body === 'Practice moved to 5pm on Saturday?', r.data);
  const first = r.data.item.id;
  check('the post is kept with the group posts, under the department\'s own chat', fakeModels.GroupPost._docs.some(p => p.id === first && p.groupId === `dept:${choir.id}` && p.chapterId === C));
  const to = (pushed[0] && pushed[0].memberIds) || [];
  check('it reaches everyone in the department and its head, and not the writer or other departments',
    to.includes(esi.id) && to.includes(head.id) && !to.includes(kofi.id) && !to.includes(yaw.id), pushed);
  check('the notification opens the chat', pushed[0] && pushed[0].payload.url === `/department.html?id=${choir.id}#chat` && /^Choir: Kofi Singer/.test(pushed[0].payload.title), pushed[0]);
  r = await call('kofi', 'POST', chat, { body: '   ' });
  check('an empty message is refused', r.status === 400);
  r = await call('yaw', 'POST', chat, { body: 'Can I sneak in?' });
  check('someone outside the department cannot post', r.status === 403);

  pushed.length = 0;
  r = await call('head', 'POST', chat, { body: 'Yes, 5pm.', parentId: first });
  check('the head replies to it', r.status === 200 && r.data.item.parentId === first && r.data.item.authorRole === 'Head', r.data);
  check('a reply reaches the people in that conversation only', pushed.length === 1 && pushed[0].memberIds.join() === kofi.id, pushed);
  r = await call('esi', 'POST', chat, { body: 'Reply to a reply', parentId: r.data.item.id });
  check('a reply cannot be answered as its own conversation', r.status === 404);
  await call('esi', 'POST', chat, { body: 'Who has the hymn list?' });
  r = await call('kofi', 'GET', chat);
  check('conversations come newest first, each with its replies', r.data.threads.length === 2 && r.data.threads[0].body === 'Who has the hymn list?'
    && r.data.threads[1].replies.length === 1 && r.data.threads[1].replies[0].body === 'Yes, 5pm.', r.data.threads);

  console.log('\n== the head keeps it in order ==');
  r = await call('kofi', 'POST', `${chat}/${first}/pin`, {});
  check('a member cannot pin', r.status === 403);
  r = await call('head', 'POST', `${chat}/${first}/pin`, {});
  check('the head pins a message', r.status === 200 && r.data.pinned === true, r.data);
  r = await call('esi', 'GET', chat);
  check('a pinned message sits on top', r.data.threads[0].id === first && r.data.threads[0].pinned === true, r.data.threads.map(t => t.body));
  const esiPost = r.data.threads.find(t => t.body === 'Who has the hymn list?');
  check('a member may remove their own message and nobody else\'s', esiPost.canRemove === true && r.data.threads[0].canRemove === false);
  r = await call('esi', 'DELETE', `${chat}/${first}`);
  check('a member cannot remove someone else\'s message', r.status === 403);
  r = await call('head', 'DELETE', `${chat}/${first}`);
  check('the head removes a message, and its replies go with it', r.status === 200 && !fakeModels.GroupPost._docs.some(p => p.id === first || p.parentId === first), r.data);
  r = await call('esi', 'DELETE', `${chat}/${esiPost.id}`);
  check('the writer removes their own', r.status === 200);
  fakeModels.Member._docs.find(m => m.id === kofi.id).chatRestricted = true;
  r = await call('kofi', 'POST', chat, { body: 'Hello?' });
  check('a member restricted from posting reads but cannot post', r.status === 403);
  r = await call('kofi', 'GET', chat);
  check('(and is told so)', r.status === 200 && r.data.canPost === false);

  console.log('\n== kept in step with the department ==');
  putIn(esi, ushers.id);
  r = await call('esi', 'GET', chat);
  check('someone who moves to another department is out of the old one\'s chat', r.status === 403);
  r = await call('esi', 'GET', `/api/departments/${ushers.id}/chat`);
  check('and in the new one\'s', r.status === 200);
  r = await call('head', 'GET', '/api/member/standing');
  const leads = r.data.leads || [];
  check('the head\'s profile names the department they lead, so the chat is a tap away', leads.some(l => l.id === choir.id), r.data.leads);

  console.log('\n== the About page\'s leaders ==');
  const coord = await member('Kwabena Coordinator');
  await call('admin', 'POST', '/api/admin/staff', { username: 'coord.knust', role: 'coordinator', password: 'Office-Pass-12345', memberId: coord.id, chapterId: C });
  await call('admin', 'POST', '/api/admin/staff', { username: 'national', name: 'Kofi National', role: 'nationalCoordinator', password: 'Office-Pass-12345' });
  const card = fakeModels.Executive._docs.find(e => e.department === choir.id);
  card.imageFileId = ''; card.contact = { phone: '', email: '' };
  r = await call(null, 'GET', '/api/public/leadership', null, { 'X-Chapter-Id': C });
  const names = (r.data || []).map(p => p.name);
  check('a chapter\'s page lists its Coordinator and its executives', names.includes('Kwabena Coordinator') && names.includes('Ama Music'), r.data);
  const amaRow = (r.data || []).find(p => p.name === 'Ama Music');
  const amaMember = fakeModels.Member._docs.find(m => m.id === head.id);
  check('an executive\'s face, phone and email come from their app profile when the card has none',
    amaRow && amaRow.imageFileId && amaRow.imageFileId === amaMember.profileImageFileId && amaRow.phone === amaMember.phone && amaRow.email === amaMember.email, amaRow);
  check('the Coordinator\'s come from theirs', (r.data || []).some(p => p.name === 'Kwabena Coordinator' && p.role === 'Chapter Coordinator' && p.email === coord.email));
  check('the National Coordinator is hidden until they choose to be listed', !names.includes('Kofi National') && !(r.data || []).some(p => p.role === 'National Coordinator'), names);
  r = await call(null, 'GET', '/api/public/leadership', null, { 'X-Chapter-Id': OTHER });
  check('another chapter\'s page does not list this chapter\'s team', !(r.data || []).some(p => p.name === 'Ama Music' || p.name === 'Kwabena Coordinator'), r.data);
  r = await call(null, 'GET', '/api/national/executives');
  check('nor does the public national list', Array.isArray(r.data) && !r.data.some(s => s.seat === 'National Coordinator'), r.data);
  r = await call(null, 'GET', '/api/executives', null, { 'X-Chapter-Id': C });
  const execCard = (r.data || []).find(e => e.department === choir.id);
  check('the executives list fills a blank card from the profile too', execCard && execCard.imageFileId === amaMember.profileImageFileId && execCard.contact.phone === amaMember.phone, execCard);

  r = await call('admin', 'PUT', '/api/admin/settings', { showNationalCoordinator: true });
  check('Global Settings can show the National Coordinator again', r.status === 200, r.data);
  r = await call(null, 'GET', '/api/public/leadership', null, { 'X-Chapter-Id': C });
  check('then they are listed', (r.data || []).some(p => p.name === 'Kofi National' && p.role === 'National Coordinator'), r.data);
  r = await call(null, 'GET', '/api/national/executives');
  check('(on the national list too)', r.data.some(s => s.seat === 'National Coordinator'));
  r = await call('admin', 'PUT', '/api/admin/settings', { fellowshipName: 'ACONSU' });
  r = await call(null, 'GET', '/api/public/leadership');
  check('saving other settings leaves the choice as it was', (r.data || []).some(p => p.role === 'National Coordinator'), r.data);
  await call('admin', 'PUT', '/api/admin/settings', { showNationalCoordinator: false });
  r = await call(null, 'GET', '/api/public/leadership');
  check('with no chapter chosen, every chapter\'s Coordinator, and the National Coordinator hidden again',
    (r.data || []).some(p => p.name === 'Kwabena Coordinator' && p.chapterName === 'ACONSU-KNUST') && !(r.data || []).some(p => p.role === 'National Coordinator'), r.data);

  console.log(failures ? `\n${failures} FAILURES` : '\nall department chat and leadership checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
