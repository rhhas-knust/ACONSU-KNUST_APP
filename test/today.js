// The Today screens: the first-steps list is kept per account and per portal,
// and every number a Today button shows is read from a route that portal's
// own screens already read, so it shows nobody anything new.
//
//   node test/today.js     (also run by `npm test`)
const fs = require('fs');
const path = require('path');
const { fakeModels } = require('./harness.js');

(async () => {
  process.env.MONGODB_URI = 'mongodb://stub/aconsu_today';
  process.env.PORT = '4344';
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'admin123';
  process.env.SESSION_SECRET = 'test';
  process.env.LOGIN_RATE_LIMIT_MAX = '300';
  delete process.env.SHEPHERD_USERNAME;

  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 400)}` : ''}`); }
  }
  const PUB = path.join(__dirname, '..', 'public');
  const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

  console.log('\n== the numbers on the buttons ==');
  {
    // Each portal page, the scripts it loads, and the routes its Today reads.
    const pages = { coordinator: 'coordinator.js', finance: 'finance.js', shepherding: 'shepherd.js', publicity: 'publicity.js', 'welfare-portal': 'welfare-portal.js', executive: 'executive.js', admin: 'admin.js' };
    const problems = [];
    let counted = 0;
    for (const [page, own] of Object.entries(pages)) {
      const scripts = [...read(`${page}.html`).matchAll(/<script src="\/js\/([^"?]+)/g)].map(m => m[1]);
      const src = read(`js/${own}`);
      const others = scripts.map(s => read(`js/${s}`)).join('\n').replace(/get\('[^']*'\)/g, '');
      for (const [, url] of src.matchAll(/get\('([^']+)'\)/g)) {
        counted += 1;
        if (!others.includes(`fetchJSON('${url}'`) && !others.includes(`fetchJSON(\`${url}`)) problems.push(`${page}: ${url}`);
      }
    }
    check(`every number (${counted} of them) comes from a route the same portal's screens already read`, counted >= 15 && problems.length === 0, problems);
    const today = read('js/today.js');
    check('at most five buttons, whatever a portal asks for', /MAX_ACTIONS = 5/.test(today) && /\.slice\(0, MAX_ACTIONS\)/.test(today));
    check('a button only for a screen this account has', /filter\(\(a\) => has\(a\.panel\)\)/.test(today));
    check('the how-to video is the last first step, and it is there', /'\/video\/how-to-aconsu\.mp4'/.test(today) && fs.existsSync(path.join(PUB, 'video', 'how-to-aconsu.mp4')));
  }

  // ------------------------------------------------------------------ the app --
  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4344';
  const jars = {};
  async function call(jar, method, p, body) {
    const h = {};
    if (jars[jar]) h.cookie = jars[jar];
    let payload;
    if (body) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + p, { method, headers: h, body: payload });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (sc.length) jars[jar] = sc.map(c => c.split(';')[0]).join('; ');
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: res.status, data };
  }
  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  await call('admin', 'POST', '/api/national/chapters', { id: 'aconsu-knust', name: 'ACONSU KNUST', institution: 'KNUST' });
  let n = 0;
  async function member(name) {
    n += 1;
    const fd = new FormData();
    fd.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
    Object.entries({ name, email: `today${n}@example.com`, password: 'secret123', chapterId: 'aconsu-knust', consent: 'true' }).forEach(([k, v]) => fd.append(k, v));
    return (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd })).json()).member.id;
  }
  for (const [username, role] of [['fin.one', 'finance'], ['fin.two', 'finance']]) {
    await call('admin', 'POST', '/api/admin/staff', { username, name: username, role, password: 'Counting-Faithfully-26', chapterId: 'aconsu-knust', memberId: await member(username) });
  }
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; });
  await call('one', 'POST', '/api/portal/login', { username: 'fin.one', password: 'Counting-Faithfully-26' });
  await call('two', 'POST', '/api/portal/login', { username: 'fin.two', password: 'Counting-Faithfully-26' });

  console.log('\n== the first-steps list ==');
  let r = await call('nobody', 'GET', '/api/portal/first-run');
  check('nobody signed in has one', r.status === 401);
  r = await call('one', 'GET', '/api/portal/first-run');
  check('a new account starts with nothing done', r.status === 200 && JSON.stringify(r.data.portals) === '{}', r.data);
  r = await call('one', 'POST', '/api/portal/first-run', { portal: 'finance', done: 'ledger' });
  await call('one', 'POST', '/api/portal/first-run', { portal: 'finance', done: 'ledger' });
  await call('one', 'POST', '/api/portal/first-run', { portal: 'finance', done: 'video' });
  r = await call('one', 'GET', '/api/portal/first-run');
  check('a step opened is kept as done, once', JSON.stringify(r.data.portals.finance) === '{"done":["ledger","video"],"hidden":false}', r.data);
  const acct = fakeModels.StaffUser._docs.find(a => a.username === 'fin.one');
  check('on the account itself, so it follows them to another phone', acct.firstRun && acct.firstRun.finance && acct.firstRun.finance.done.includes('ledger'), acct.firstRun);
  r = await call('two', 'GET', '/api/portal/first-run');
  check('another account\'s list is its own', JSON.stringify(r.data.portals) === '{}', r.data);
  r = await call('one', 'POST', '/api/portal/first-run', { portal: 'finance', hidden: true });
  check('hiding it is kept too', r.status === 200 && r.data.portals.finance.hidden === true && r.data.portals.finance.done.length === 2, r.data);
  r = await call('one', 'POST', '/api/portal/first-run', { portal: 'executive', done: 'profile' });
  check('and each portal has its own list (one person, two offices)', r.data.portals.executive.done[0] === 'profile' && r.data.portals.finance.hidden === true, r.data);
  r = await call('one', 'POST', '/api/portal/first-run', { portal: 'national-secrets', done: 'x' });
  check('a portal it does not know is refused', r.status === 400);
  r = await call('one', 'POST', '/api/portal/first-run', { portal: 'finance', done: '<img src=x>' });
  check('as is a step that is not a plain name', r.status === 400);
  for (let i = 0; i < 30; i += 1) await call('two', 'POST', '/api/portal/first-run', { portal: 'publicity', done: `step${i}` });
  r = await call('two', 'GET', '/api/portal/first-run');
  check('and the list cannot grow without end', r.data.portals.publicity.done.length === 20, r.data.portals.publicity.done.length);
  r = await call('admin', 'POST', '/api/portal/first-run', { portal: 'admin', done: 'staff' });
  const row = fakeModels.SystemState._docs.find(d => d.singleton === 'firstRun:admin');
  check('the main admin, who has no account record, has one kept on a row of its own', r.status === 200 && row && row.firstRun.admin.done[0] === 'staff', row);
  r = await call('admin', 'GET', '/api/portal/first-run');
  check('and gets it back', r.data.portals.admin && r.data.portals.admin.done[0] === 'staff', r.data);
  r = await call('one', 'GET', '/api/portal/me');
  check('what an account can do is untouched: Finance is still Finance', r.status === 200 && r.data.access.finance.edit === true && r.data.access.coordinator.view === false, r.data.access);

  console.log(failures ? `\n${failures} FAILURES` : '\nall today checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
