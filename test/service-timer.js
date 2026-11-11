// The Technical Head runs the Church Timer (its own app) from the Executive
// Portal: the chapter keeps the timer's link, and the portal opens its phone
// controller, TV screen and settings.
//
//   node test/service-timer.js     (also run by `npm test`)
const { fakeModels } = require('./harness.js');
const positions = require('../lib/positions');
const { cleanTimerUrl, screensOf } = require('../lib/serviceTimer');

(async () => {
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/aconsu_timer', PORT: '4384', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 'test', LOGIN_RATE_LIMIT_MAX: '500' });
  delete process.env.SHEPHERD_USERNAME;
  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 600)}` : ''}`); }
  }

  console.log('\n== the link ==');
  check('a bare address becomes https', cleanTimerUrl('church-timer.example.org') === 'https://church-timer.example.org');
  check('a link to one of its screens goes back to the timer itself', cleanTimerUrl('https://church-timer.example.org/tv') === 'https://church-timer.example.org'
    && cleanTimerUrl('https://church-timer.example.org/settings/') === 'https://church-timer.example.org');
  check('one church among several keeps its /c/<code>', cleanTimerUrl('https://Church-Timer.example.org/c/KNUST/display') === 'https://church-timer.example.org/c/knust');
  check('not https, sign-in details or not an address at all: refused', cleanTimerUrl('http://church-timer.example.org') === null
    && cleanTimerUrl('https://user:pw@church-timer.example.org') === null && cleanTimerUrl('javascript:alert(1)') === null && cleanTimerUrl('just words') === null);
  check('empty clears it', cleanTimerUrl('  ') === '');
  const sc = screensOf('https://church-timer.example.org/c/knust');
  check('its screens', sc.tv === 'https://church-timer.example.org/c/knust/tv' && sc.settings === 'https://church-timer.example.org/c/knust/settings' && sc.apk === 'church-timer.example.org/apk', sc);
  check('the Technical Head runs it, and other heads do not', positions.hasCapability(positions.positionByKey('technical_head'), positions.CAPABILITIES.SERVICE_TIMER)
    && !positions.hasCapability(positions.positionByKey('media_head'), positions.CAPABILITIES.SERVICE_TIMER));

  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4384';
  const jars = {};
  async function call(jar, method, p, body) {
    const h = {};
    if (jars[jar]) h.cookie = jars[jar];
    if (body) h['content-type'] = 'application/json';
    const res = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const sc2 = res.headers.getSetCookie();
    if (sc2.length) jars[jar] = sc2.map(c => c.split(';')[0]).join('; ');
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }
  const C = 'aconsu-knust';
  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  await call('admin', 'POST', '/api/national/chapters', { id: C, name: 'ACONSU-KNUST', institution: 'KNUST' });
  let n = 0;
  async function exec(name, positionKey) {
    n += 1;
    const f = new FormData();
    f.append('profileImage', new Blob([Buffer.from(name)], { type: 'image/png' }), 'me.png');
    Object.entries({ name, email: `t${n}@example.com`, phone: `02449000${String(n).padStart(2, '0')}`, password: 'a-good-long-password', chapterId: C, consent: 'true' }).forEach(([k, v]) => f.append(k, v));
    const id = (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: f })).json()).member.id;
    await call('admin', 'POST', '/api/admin/staff', { role: 'executive', positionKey, memberId: id, chapterId: C });
    fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; a.mustSetUpSecondStep = false; });
    await call(positionKey, 'POST', '/api/portal/login', { username: `t${n}@example.com`, password: 'a-good-long-password', portal: 'executive' });
  }
  await exec('Yaw Technical', 'technical_head');
  await exec('Kofi Media', 'media_head');

  console.log('\n== in the Technical Head\'s portal ==');
  let r = await call('technical_head', 'GET', '/api/executive/service-timer');
  check('it starts with no link', r.status === 200 && r.data.url === '' && r.data.screens === null, r.data);
  r = await call('technical_head', 'PUT', '/api/executive/service-timer', { url: 'http://not-secure.example.org' });
  check('a link that is not https is refused, saying why', r.status === 400 && r.data.field === 'url', r.data);
  r = await call('technical_head', 'PUT', '/api/executive/service-timer', { url: 'church-timer.example.org/c/knust/tv' });
  check('the Technical Head saves the chapter\'s timer link', r.status === 200 && r.data.url === 'https://church-timer.example.org/c/knust', r.data);
  check('it is kept on the chapter', fakeModels.Chapter._docs.find(c => c.id === C).serviceTimerUrl === 'https://church-timer.example.org/c/knust');
  r = await call('technical_head', 'GET', '/api/executive/service-timer');
  check('and the portal gets the controller, the TV screen and the settings', r.data.screens && r.data.screens.tv === 'https://church-timer.example.org/c/knust/tv', r.data);
  r = await call('media_head', 'GET', '/api/executive/service-timer');
  check('another head does not have it', r.status === 403, r.data);
  r = await call(null, 'PUT', '/api/executive/service-timer', { url: 'https://evil.example.org' });
  check('nor does anyone signed out', r.status === 401 || r.status === 403);
  r = await call('technical_head', 'GET', '/api/executive/me');
  check('the portal lists Service Timer for them', JSON.stringify(r.data).includes('serviceTimer'), r.data.capabilities || r.data);

  console.log(failures ? `\n${failures} FAILURES` : '\nall service timer checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
