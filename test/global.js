// What the Global Settings page held was ACONSU-KNUST's. On the first start it is
// moved into the ACONSU-KNUST chapter (only where the chapter has not set its
// own), Global goes back to the national app's plain defaults, and a chapter's
// page shows only its own details, never Global's or another chapter's.
// Boots the real app on the in-memory data layer, with the database as it
// stood before the move.
//
//   node test/global.js     (also run by `npm test`)
const { fakeModels } = require('./harness.js');
const mailer = require('../lib/mailer');
const { moveGlobalSetupToChapter } = require('../lib/globalMove');
const repo = require('../lib/repo');

const sent = [];
mailer.sendMail = async (mail) => { sent.push(mail); };

(async () => {
  process.env.MONGODB_URI = 'mongodb://stub/aconsu_global';
  process.env.MAP_LINK_RESOLVE = 'off'; // map links are never followed out to Google from a test
  process.env.PORT = '4326';
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'admin123';
  process.env.SESSION_SECRET = 'test';
  process.env.LOGIN_RATE_LIMIT_MAX = '200';
  delete process.env.SHEPHERD_USERNAME;

  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail ? ` - ${JSON.stringify(detail).slice(0, 300)}` : ''}`); }
  }

  console.log('\n== before there is an ACONSU-KNUST to move it to ==');
  await fakeModels.Settings.create({ singleton: 'main', fellowshipName: 'ACONSU', email: 'early@example.org' });
  let done = await moveGlobalSetupToChapter({ repo, chapterId: 'aconsu-knust' });
  check('nothing moves, and nothing is marked, so it is tried again on the next start',
    done.skipped && !(await repo.getSettings()).movedToChapter && (await repo.getSettings()).email === 'early@example.org', done);
  fakeModels.Settings._docs.length = 0;

  // The database as it stood: Global filled in for KNUST, the KNUST chapter with
  // a few things of its own, and a second chapter with nothing set yet.
  await fakeModels.Settings.create({
    singleton: 'main',
    fellowshipName: 'ACONSU', fullName: "The Apostles' Continuation Students Union - KNUST",
    tagline: 'Carrying the fire. Continuing the pattern.', verseOfTheWeek: 'Acts 2:42',
    address: 'Campus Fellowship Auditorium', email: 'knust@aconsu.org', phone: '0240000000',
    whatsapp: '233240000000', instagram: 'https://instagram.com/aconsuknust', spotify: 'https://open.spotify.com/aconsuknust',
    homeHeaderImageFileId: 'banner-file-1', nextServiceLabel: 'Next Sunday Service',
    shepherdingEmail: 'shepherding@aconsu-knust.org', publicityEmail: 'publicity@aconsu-knust.org', financeEmail: 'finance@aconsu-knust.org',
    council: { meetingUrl: 'https://meet.example/council', meetingLabel: 'Monthly Council' },
    church: { name: "The Apostles' Continuation Church" }
  });
  await fakeModels.Chapter.create({ id: 'aconsu-knust', name: 'ACONSU-KNUST', status: 'active', tagline: 'Our own words', contact: { email: '' }, about: {} });
  await fakeModels.Chapter.create({ id: 'aconsu-ucc', name: 'ACONSU-UCC', status: 'active', contact: {}, about: {} });
  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));

  const BASE = 'http://127.0.0.1:4326';
  const jars = {};
  async function call(jar, method, path, body, headers) {
    const h = { ...(headers || {}) };
    if (jars[jar]) h.cookie = jars[jar];
    if (body) h['content-type'] = 'application/json';
    const res = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (sc.length) jars[jar] = sc.map(c => c.split(';')[0]).join('; ');
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: res.status, data };
  }
  let r;
  const KNUST = { 'X-Chapter-Id': 'aconsu-knust' };
  const UCC = { 'X-Chapter-Id': 'aconsu-ucc' };

  console.log('\n== ACONSU-KNUST keeps everything that was set for it ==');
  let k = (await call('anon', 'GET', '/api/settings', null, KNUST)).data;
  check('its contacts', k.email === 'knust@aconsu.org' && k.phone === '0240000000' && k.whatsapp === '233240000000', k);
  check('its social links, Spotify included', k.instagram === 'https://instagram.com/aconsuknust' && k.spotify === 'https://open.spotify.com/aconsuknust', k);
  check('its full name, verse and home banner', k.fullName === "The Apostles' Continuation Students Union - KNUST" && k.verseOfTheWeek === 'Acts 2:42' && k.homeHeaderImageFileId === 'banner-file-1', k);
  check('what it had already set for itself is not replaced', k.tagline === 'Our own words', k.tagline);
  check('a value the app shipped with is not taken as its own: the address comes from its website instead', k.address !== 'Campus Fellowship Auditorium' && /Acci Ayeduase/.test(k.address), k.address);
  const knustDoc = fakeModels.Chapter._docs.find(c => c.id === 'aconsu-knust');
  check('its office email addresses move to its own settings', knustDoc.officeEmails && knustDoc.officeEmails.shepherding === 'shepherding@aconsu-knust.org'
    && knustDoc.officeEmails.publicity === 'publicity@aconsu-knust.org' && knustDoc.officeEmails.finance === 'finance@aconsu-knust.org', knustDoc.officeEmails);

  console.log('\n== Global is back to the national app\'s defaults ==');
  let g = (await call('anon', 'GET', '/api/settings')).data;
  check('the national app has the union\'s plain name and nothing of KNUST\'s', g.fellowshipName === 'ACONSU' && g.fullName === "The Apostles' Continuation Students Union"
    && !g.email && !g.phone && !g.tagline && !g.homeHeaderImageFileId && !g.spotify, g);
  check('and a visitor is never handed the council\'s meeting link, the office addresses or the record of the move',
    !g.council && !g.shepherdingEmail && !g.movedToChapter && !k.council && !k.financeEmail, { g, k });
  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  g = (await call('admin', 'GET', '/api/settings?global=1')).data;
  check('the main admin sees when it moved, and to which chapter', g.movedToChapter && g.movedToChapter.chapterId === 'aconsu-knust' && g.movedToChapter.moved.includes('email'), g.movedToChapter);
  check('and what Global held is kept, so nothing is lost', g.movedToChapter.previous.email === 'knust@aconsu.org' && g.movedToChapter.previous.address === 'Campus Fellowship Auditorium', g.movedToChapter.previous);
  check('the wider church and the national council are the whole union\'s, and stay', g.church.name === "The Apostles' Continuation Church" && g.council.meetingUrl === 'https://meet.example/council', g);

  console.log('\n== every other chapter shows only its own ==');
  const u = (await call('anon', 'GET', '/api/settings', null, UCC)).data;
  check('a chapter with nothing set shows no one else\'s contacts', !u.email && !u.phone && !u.whatsapp && !u.instagram, u);
  check('no one else\'s banner, verse or tagline', !u.homeHeaderImageFileId && !u.verseOfTheWeek && !u.tagline, u);
  check('and no one else\'s Mobile Money number', !u.momoNumber && !u.payment.momoNumber, u.payment);
  check('its own name stands, with the union\'s full name until it writes its own', u.fellowshipName === 'ACONSU-UCC' && u.fullName === "The Apostles' Continuation Students Union", u);

  console.log('\n== a chapter\'s messages go to that chapter ==');
  // With a national address on Global, so a chapter's mail could go there if
  // it were allowed to.
  await call('admin', 'PUT', '/api/admin/settings', { email: 'national@aconsu.org' });
  sent.length = 0;
  await call('anon', 'POST', '/api/contact', { name: 'Kofi', email: 'kofi@test.com', message: 'When do you meet?' }, KNUST);
  await call('anon', 'POST', '/api/contact', { name: 'Esi', email: 'esi@test.com', message: 'Hello UCC' }, UCC);
  await new Promise(r => setTimeout(r, 200));
  check('a message to ACONSU-KNUST reaches its Shepherding office and its contact address', sent.length === 1
    && sent[0].to.split(',').sort().join(',') === 'knust@aconsu.org,shepherding@aconsu-knust.org' && /Kofi/.test(sent[0].html), sent);
  check('one to a chapter with no address set goes to nobody, rather than to KNUST or National', !sent.some(m => /Esi/.test(m.html)), sent);
  r = await call('admin', 'PUT', '/api/admin/chapter-settings', { contact: { email: 'hello@aconsu-ucc.org' }, officeEmails: { shepherding: 'care@aconsu-ucc.org' } }, UCC);
  check('a chapter sets its own office addresses in its settings', r.status === 200 && r.data.item.officeEmails.shepherding === 'care@aconsu-ucc.org', r.data);
  sent.length = 0;
  await call('anon', 'POST', '/api/contact', { name: 'Ama', email: 'ama@test.com', message: 'Hello again' }, UCC);
  await new Promise(r => setTimeout(r, 200));
  check('and its messages go there', sent.length === 1 && sent[0].to.split(',').sort().join(',') === 'care@aconsu-ucc.org,hello@aconsu-ucc.org', sent);

  console.log('\n== it happens once ==');
  r = await call('admin', 'PUT', '/api/admin/settings', { email: 'national@aconsu.org', tagline: 'One union', council: { meetingUrl: 'https://evil.example/' }, movedToChapter: null, church: {} });
  g = (await call('admin', 'GET', '/api/settings?global=1')).data;
  check('the national app fills Global for itself', r.status === 200 && g.email === 'national@aconsu.org' && g.tagline === 'One union', g);
  check('and saving the page never touches the council, the church or the record of the move',
    g.council.meetingUrl === 'https://meet.example/council' && g.church.name === "The Apostles' Continuation Church" && g.movedToChapter && g.movedToChapter.chapterId === 'aconsu-knust', g);
  done = await moveGlobalSetupToChapter({ repo, chapterId: 'aconsu-knust' });
  k = (await call('anon', 'GET', '/api/settings', null, KNUST)).data;
  check('a later start moves nothing: what the national app sets stays national', done.skipped === 'already moved' && k.email === 'knust@aconsu.org' && k.tagline === 'Our own words', { done, email: k.email });
  const ucc = (await call('anon', 'GET', '/api/settings', null, UCC)).data;
  check('and no chapter borrows it', ucc.tagline === '' && ucc.email === 'hello@aconsu-ucc.org', ucc);

  console.log(failures ? `\n${failures} global check(s) FAILED` : '\nall global checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
