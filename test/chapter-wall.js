// Chapter walls in the data layer: a read or write on a record holding
// people's data or a chapter's own work must name its chapter, or say it spans
// every chapter on purpose (lib/repo.js). Three kinds of check:
//
//   1. the rule itself;
//   2. every call to the data layer in the code, read without running it:
//      one on a walled record with no filter at all, or a filter written out
//      with no chapter, fails here, including on routes no other test reaches;
//   3. the whole test suite runs with the wall refusing (the default), so a
//      route whose filter turns out chapterless at run time fails its test.
//
//   node test/chapter-wall.js     (also run by `npm test`)
const fs = require('fs');
const path = require('path');
const { fakeModels } = require('./harness.js');
const repo = require('../lib/repo');

(async () => {
  process.env.MONGODB_URI = 'mongodb://stub/aconsu_wall';
  process.env.PORT = '4341';
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'admin123';
  process.env.SESSION_SECRET = 'test';
  process.env.LOGIN_RATE_LIMIT_MAX = '300';
  delete process.env.CHAPTER_GUARD;
  delete process.env.SHEPHERD_USERNAME;

  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 600)}` : ''}`); }
  }
  const refused = async (fn) => { try { await fn(); return false; } catch (e) { return !!e.chapterGuard; } };

  console.log('\n== the rule ==');
  check('a read of members with no chapter is refused', await refused(() => repo.getAll('members')));
  check('so is one by id, an update, a delete and a create', await refused(() => repo.getById('members', 'x'))
    && await refused(() => repo.patchById('members', 'x', { name: 'y' })) && await refused(() => repo.removeById('financeEntries', 'x'))
    && await refused(() => repo.create('prayerRequests', { request: 'x' })));
  check('naming the chapter is enough', !await refused(() => repo.getAll('members', { chapterId: 'c1' })) && !await refused(() => repo.create('prayerRequests', { chapterId: 'c1', request: 'x' })));
  check('so is an $or whose every branch names one', !await refused(() => repo.getAll('members', { $or: [{ chapterId: 'a' }, { chapterId: 'b' }] }))
    && await refused(() => repo.getAll('members', { $or: [{ chapterId: 'a' }, { email: 'x' }] })));
  check('or saying it is every chapter on purpose', !await refused(() => repo.getAll('members', repo.allChapters())) && !await refused(() => repo.getById('members', 'x', repo.ownRecord())));
  check('the mark never reaches the database: it is a symbol, not a field', JSON.stringify(repo.allChapters({ a: 1 })) === '{"a":1}' && Object.keys(repo.allChapters()).length === 0);
  await fakeModels.Member.create({ id: 'm1', chapterId: 'c1', name: 'A' });
  await fakeModels.Member.create({ id: 'm2', chapterId: 'c2', name: 'B' });
  check('and a filter carrying it finds exactly what {} would', (await repo.getAll('members', repo.allChapters())).length === 2 && (await repo.getAll('members', repo.allChapters({ name: 'B' }))).length === 1);
  check('the chapters themselves, events and public content are not walled', !await refused(() => repo.getAll('chapters')) && !await refused(() => repo.getAll('events')) && !await refused(() => repo.getAll('sermons')));
  process.env.CHAPTER_GUARD = 'warn';
  check('CHAPTER_GUARD=warn lets it through (the escape hatch), and says so in the log', !await refused(() => repo.getAll('members')));
  process.env.CHAPTER_GUARD = 'off';
  check('and off does nothing', !await refused(() => repo.getAll('members')));
  delete process.env.CHAPTER_GUARD;
  fakeModels.Member._docs.length = 0;

  console.log('\n== every call in the code ==');
  {
    const espree = require('espree');
    const POS = { getAll: 1, getById: 2, updateById: 3, patchById: 3, removeById: 2, create: 1 };
    const root = path.join(__dirname, '..');
    const files = ['server.js', ...['routes', 'lib'].flatMap(d => fs.readdirSync(path.join(root, d)).filter(f => f.endsWith('.js')).map(f => `${d}/${f}`))];
    const bad = [];
    let calls = 0;
    for (const f of files) {
      const ast = espree.parse(fs.readFileSync(path.join(root, f), 'utf8'), { ecmaVersion: 'latest', loc: true });
      (function walk(n) {
        if (!n || typeof n.type !== 'string') return;
        if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && n.callee.object.name === 'repo' && POS[n.callee.property.name] !== undefined) {
          const res = n.arguments[0];
          const name = res && res.type === 'Literal' ? res.value : null;
          if (name === null || repo.CHAPTER_SCOPED.has(name)) {
            calls += 1;
            const a = n.arguments[POS[n.callee.property.name]];
            const names = a && (a.type !== 'ObjectExpression'
              || a.properties.some(p => p.type === 'SpreadElement' || (p.key && (p.key.name || p.key.value) === 'chapterId')));
            if (!names) bad.push(`${f}:${n.loc.start.line} ${n.callee.property.name}(${name || 'a resource chosen at run time'})`);
          }
        }
        for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v); }
      })(ast);
    }
    check(`none of the ${calls} calls on walled records leaves its chapter out`, calls > 200 && bad.length === 0, bad);
  }

  // ------------------------------------------------------------------ the app --
  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4341';
  const jars = {};
  async function call(jar, method, p, body, headers) {
    const h = { ...(headers || {}) };
    if (jars[jar]) h.cookie = jars[jar];
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + p, { method, headers: h, body: payload });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (sc.length) jars[jar] = sc.map(c => c.split(';')[0]).join('; ');
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: res.status, data };
  }
  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  for (const [id, name] of [['aconsu-knust', 'KNUST'], ['aconsu-ucc', 'UCC']]) {
    await call('admin', 'POST', '/api/national/chapters', { id, name: `ACONSU ${name}`, institution: name });
  }
  let n = 0;
  async function member(name, chapterId) {
    n += 1;
    const fd = new FormData();
    fd.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
    Object.entries({ name, email: `wall${n}@example.com`, password: 'secret123', chapterId, consent: 'true' }).forEach(([k, v]) => fd.append(k, v));
    return (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd })).json()).member.id;
  }

  console.log('\n== across chapters ==');
  await member('Ama Knust', 'aconsu-knust');
  await call('ama', 'POST', '/api/auth/login', { email: 'wall1@example.com', password: 'secret123' });
  let r = await call('ama', 'POST', '/api/prayer-requests', { name: 'Ama', request: 'Exams', visibility: 'private' }, { 'X-Chapter-Id': 'aconsu-knust' });
  const prayer = fakeModels.PrayerRequest._docs.find(p => p.request === 'Exams');
  check('(a member in KNUST sends a prayer request)', r.status === 200 && prayer && prayer.chapterId === 'aconsu-knust', r.data);
  await call('admin', 'POST', '/api/admin/staff', { username: 'admin.ucc', name: 'UCC Admin', role: 'chapterAdmin', password: 'Counting-Faithfully-26', chapterId: 'aconsu-ucc', memberId: await member('Kofi Ucc', 'aconsu-ucc') });
  await call('ucc', 'POST', '/api/portal/login', { username: 'admin.ucc', password: 'Counting-Faithfully-26' });
  r = await call('ucc', 'PATCH', `/api/prayer-requests/${prayer.id}/answered`, { testimony: 'x' });
  check('another chapter\'s admin cannot mark it answered (they once could, by id)', r.status === 404 && !fakeModels.PrayerRequest._docs.find(p => p.id === prayer.id).answered, r);
  r = await call('ama', 'PATCH', `/api/prayer-requests/${prayer.id}/answered`, { testimony: 'Passed' });
  check('the person who sent it can', r.status === 200 && fakeModels.PrayerRequest._docs.find(p => p.id === prayer.id).answered, r.data);
  await call('admin', 'POST', '/api/admin/groups', { name: 'KNUST Cell', chapterId: 'aconsu-knust' }, { 'X-Chapter-Id': 'aconsu-knust' });
  const group = fakeModels.Group._docs.find(g => g.name === 'KNUST Cell');
  r = await call('guest', 'GET', '/api/groups', null, { 'X-Chapter-Id': 'aconsu-knust' });
  check('with a chapter chosen, that chapter\'s', r.status === 200 && r.data.some(g => g.name === 'KNUST Cell'), r.data);
  r = await call('guest', 'GET', `/api/groups/${group && group.id}`, null, { 'X-Chapter-Id': 'aconsu-ucc' });
  check('a group asked for from another chapter is not found', r.status === 404, r.status);
  r = await call('admin', 'GET', '/api/national/dashboard');
  check('National still sees every chapter\'s totals', r.status === 200, r.status);
  r = await call('admin', 'GET', '/api/admin/staff?chapterId=aconsu-ucc');
  check('and any chapter\'s leadership accounts, one chapter at a time', r.status === 200 && r.data.some(a => a.username === 'admin.ucc') && r.data.every(a => a.chapterId === 'aconsu-ucc'), r.data);
  r = await call('ucc', 'GET', '/api/admin/staff');
  check('a chapter admin, only their own chapter\'s', r.status === 200 && r.data.every(a => a.chapterId === 'aconsu-ucc'), r.data);

  console.log(failures ? `\n${failures} FAILURES` : '\nall chapter-wall checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
