// Map links: the chapter's meeting place, an event's venue, where a department
// or a group meets. Checks the link rules in lib/maps.js, that every way of
// saving a link goes through them, that ACONSU-KNUST starts from the link its
// website already uses, and that a short share link is followed to the spot it
// points at, only ever to a map service. Nothing here reaches the internet: the
// app's requests to map services are answered by the stand-in below.
//
//   node test/maps.js     (also run by `npm test`)
const { fakeModels } = require('./harness.js');
const maps = require('../lib/maps');

// Stand-in for Google: a short link answers with a redirect, as the real one
// does. Every request the app makes outside this machine is written down.
const WEBSITE_LINK = 'https://maps.app.goo.gl/UzeXchSvjjCmi3nH9?g_st=aw';
const FULL_LINK = 'https://www.google.com/maps/place/Acci+Ayeduase+Auditorium/@6.6745,-1.5716,17z/data=!3m1!4b1!4m6!3m5!8m2!3d6.674512!4d-1.571634';
const REDIRECTS = {
  [WEBSITE_LINK]: FULL_LINK,
  'https://maps.app.goo.gl/LeadsAway': 'https://evil.example/collect',
  'https://maps.app.goo.gl/TwoHops': 'https://goo.gl/maps/second',
  'https://goo.gl/maps/second': 'https://www.google.com/maps?q=6.68,-1.57'
};
const outside = [];
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  const u = new URL(String(url));
  if (u.hostname === '127.0.0.1') return realFetch(url, opts);
  outside.push(u.toString());
  const to = REDIRECTS[u.toString()];
  if (to) return new Response(null, { status: 302, headers: { location: to } });
  return new Response('not found', { status: 404 });
};

(async () => {
  process.env.MONGODB_URI = 'mongodb://stub/aconsu_maps';
  process.env.PORT = '4325';
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'admin123';
  process.env.SESSION_SECRET = 'test';
  process.env.LOGIN_RATE_LIMIT_MAX = '200';
  delete process.env.MAP_LINK_RESOLVE;
  delete process.env.SHEPHERD_USERNAME;

  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail ? ` - ${JSON.stringify(detail).slice(0, 300)}` : ''}`); }
  }

  console.log('\n== what counts as a map link ==');
  check('blank stays blank', maps.cleanMapUrl('').value === '' && maps.cleanMapUrl(null).value === '');
  check('the Share link from Google Maps', maps.cleanMapUrl(WEBSITE_LINK).value === WEBSITE_LINK);
  check('without https:// in front', maps.cleanMapUrl('maps.app.goo.gl/abc').value === 'https://maps.app.goo.gl/abc');
  check('http is made https', maps.cleanMapUrl('http://maps.google.com/?q=Kumasi').value === 'https://maps.google.com/?q=Kumasi');
  check('a pasted "Embed a map" snippet gives its link',
    maps.cleanMapUrl('<iframe src="https://www.google.com/maps/embed?pb=!1m18&amp;x=1" width="600"></iframe>').value === 'https://www.google.com/maps/embed?pb=!1m18&x=1');
  check('Apple Maps and OpenStreetMap too', !!maps.cleanMapUrl('https://maps.apple.com/?q=KNUST').value && !!maps.cleanMapUrl('https://www.openstreetmap.org/#map=17/6.67/-1.57').value);
  for (const [label, bad] of [
    ['script', 'javascript:alert(1)'],
    ['a page that is not a map', 'https://evil.example/maps'],
    ['the rest of Google', 'https://www.google.com/search?q=church'],
    ['a look-alike address', 'https://maps.google.com.evil.example/'],
    ['a link carrying a sign-in', 'https://user:pw@maps.google.com/'],
    ['plain text', 'behind the library'],
    ['a link too long to be one', `https://maps.google.com/?q=${'a'.repeat(1300)}`]
  ]) check(`refused: ${label}`, !!maps.cleanMapUrl(bad).error, maps.cleanMapUrl(bad));

  console.log('\n== where a link points ==');
  check('Google\'s place marker', JSON.stringify(maps.placeFromMapUrl(FULL_LINK)) === JSON.stringify({ lat: 6.674512, lng: -1.571634 }));
  check('Google\'s map view', JSON.stringify(maps.placeFromMapUrl('https://www.google.com/maps/@6.67,-1.57,15z')) === JSON.stringify({ lat: 6.67, lng: -1.57 }));
  check('coordinates in the query', JSON.stringify(maps.placeFromMapUrl('https://maps.google.com/?q=6.6745,-1.5716')) === JSON.stringify({ lat: 6.6745, lng: -1.5716 }));
  check('OpenStreetMap\'s marker', JSON.stringify(maps.placeFromMapUrl('https://www.openstreetmap.org/?mlat=6.67&mlon=-1.57')) === JSON.stringify({ lat: 6.67, lng: -1.57 }));
  check('a place searched by name', maps.placeFromMapUrl('https://maps.google.com/?q=Great+Hall+KNUST').query === 'Great Hall KNUST');
  check('a place page by name', maps.placeFromMapUrl('https://www.google.com/maps/place/Great+Hall/').query === 'Great Hall');
  check('an embed link is used as it is', !!maps.placeFromMapUrl('https://www.google.com/maps/embed?pb=!1m18').embed);
  check('a short link says nothing until it is followed', maps.placeFromMapUrl(WEBSITE_LINK) === null);
  check('impossible coordinates are not a place', maps.placeFromMapUrl('https://maps.google.com/?q=200,500') === null);

  console.log('\n== following a short link ==');
  let place = await maps.resolveMapPlace(WEBSITE_LINK);
  check('a short link is followed to the spot', place && place.lat === 6.674512, place);
  place = await maps.resolveMapPlace('https://maps.app.goo.gl/TwoHops');
  check('through more than one hop', place && place.lat === 6.68, place);
  outside.length = 0;
  place = await maps.resolveMapPlace('https://maps.app.goo.gl/LeadsAway');
  check('a link that leads off the map services is dropped', place === null, place);
  check('and the place it leads to is never asked for', !outside.some(u => u.includes('evil.example')), outside);
  let asked = 0;
  place = await maps.resolveMapPlace('https://maps.app.goo.gl/Loop', { fetchImpl: async () => { asked++; return new Response(null, { status: 302, headers: { location: 'https://maps.app.goo.gl/Loop' } }); } });
  check('a link that goes round in circles is given up on', place === null && asked <= 6, { place, asked });
  place = await maps.resolveMapPlace('https://maps.app.goo.gl/Page', { fetchImpl: async () => new Response(`<a href="${FULL_LINK}">`, { status: 200 }) });
  check('a short link that answers with a page: the full link is read from it', place && place.lat === 6.674512, place);

  // ACONSU-KNUST as it stood before map links: its own address, no link.
  await fakeModels.Chapter.create({ id: 'aconsu-knust', name: 'ACONSU-KNUST', status: 'active', address: 'Main gate, KNUST' });
  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));

  const BASE = 'http://127.0.0.1:4325';
  const jars = {};
  async function call(jar, method, path, body, headers, kind) {
    const h = { ...(headers || {}) };
    if (jars[jar]) h.cookie = jars[jar];
    let payload;
    if (body && kind === 'form') payload = body;
    else if (body && kind === 'urlencoded') { h['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(body).toString(); }
    else if (body) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await realFetch(BASE + path, { method, headers: h, body: payload });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (sc.length) jars[jar] = sc.map(c => c.split(';')[0]).join('; ');
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: res.status, data };
  }
  const waitFor = async (fn) => { for (let i = 0; i < 40; i++) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 50)); } return null; };
  const refused = (r) => r.status === 400 && r.data && r.data.field === 'mapUrl';

  console.log('\n== ACONSU-KNUST starts from its website\'s link ==');
  let r = await call('anon', 'GET', '/api/settings');
  check('the app uses the link the website\'s "Open in Maps" uses', r.data.mapUrl === WEBSITE_LINK, r.data.mapUrl);
  check('and the hall the website names', r.data.meetingPlace === 'Acci Ayeduase Auditorium', r.data.meetingPlace);
  check('the chapter\'s own address is kept, not replaced by the website\'s', r.data.address === 'Main gate, KNUST', r.data.address);
  const settled = await waitFor(async () => { const s = (await call('anon', 'GET', '/api/settings')).data; return s.mapPlace && s.mapPlace.lat ? s : null; });
  check('the short link is followed in the background, so the app can show the map', settled && settled.mapPlace.lat === 6.674512, settled && settled.mapPlace);

  console.log('\n== every way of saving a link is checked ==');
  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  r = await call('admin', 'PUT', '/api/admin/chapter-settings', { mapUrl: 'javascript:alert(document.cookie)' });
  check('a script is refused, with a reason to show beside the box', refused(r) && /Google Maps/.test(r.data.error), r.data);
  r = await call('admin', 'PUT', '/api/admin/chapter-settings', { mapUrl: 'https://evil.example/maps' });
  check('so is a page that is not a map', refused(r), r.data);
  r = await call('admin', 'PUT', '/api/admin/chapter-settings', { mapUrl: 'http://maps.google.com/?q=6.6745,-1.5716', mapPlace: { embed: 'https://evil.example/' } });
  r = (await call('anon', 'GET', '/api/settings')).data;
  check('a good link is saved as https', r.mapUrl === 'https://maps.google.com/?q=6.6745,-1.5716', r.mapUrl);
  check('and the spot is worked out by the server, never taken from the request', r.mapPlace && r.mapPlace.lat === 6.6745 && !r.mapPlace.embed, r.mapPlace);
  await call('admin', 'PUT', '/api/admin/chapter-settings', { tagline: 'Welcome', mapPlace: { embed: 'https://evil.example/' } });
  r = (await call('anon', 'GET', '/api/settings')).data;
  check('a save without a link leaves the link alone, whatever else it sends', r.mapUrl === 'https://maps.google.com/?q=6.6745,-1.5716' && r.mapPlace.lat === 6.6745, r);
  await call('admin', 'PUT', '/api/admin/chapter-settings', { mapUrl: '' });
  r = (await call('anon', 'GET', '/api/settings')).data;
  check('clearing the box clears the map', r.mapUrl === '' && !r.mapPlace, r);
  await call('admin', 'PUT', '/api/admin/chapter-settings', { mapUrl: WEBSITE_LINK });
  r = (await call('anon', 'GET', '/api/settings')).data;
  check('a short link already followed keeps its spot when saved again, without asking Google again', r.mapPlace && r.mapPlace.lat === 6.674512, r.mapPlace);
  outside.length = 0;
  r = await call('admin', 'POST', '/api/admin/events', { title: 'Hall prayer', date: '2026-12-03', location: 'Acci Ayeduase Auditorium', mapUrl: WEBSITE_LINK });
  check('and an event in the same hall gets the spot at once', r.data.item && r.data.item.mapPlace && r.data.item.mapPlace.lat === 6.674512 && outside.length === 0, { item: r.data.item, outside });

  r = await call('admin', 'POST', '/api/admin/events', {
    title: 'Revival night', date: '2026-12-01', location: 'Great Hall',
    mapUrl: '<iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12" width="600" height="450"></iframe>'
  });
  check('an event keeps the link from a pasted "Embed a map" snippet', r.status === 200 && r.data.item.mapUrl === 'https://www.google.com/maps/embed?pb=!1m18!1m12' && !!r.data.item.mapPlace.embed, r.data);
  const events = (await call('anon', 'GET', '/api/events')).data;
  const revival = events.find(e => e.title === 'Revival night');
  check('and visitors are given it with the event', revival && revival.mapPlace && revival.mapPlace.embed, revival);
  r = await call('admin', 'PUT', `/api/admin/events/${revival.id}`, { ...revival, mapUrl: 'https://evil.example/' });
  check('an event\'s link is checked when it is changed too', refused(r), r.data);
  const { mapUrl: keptLink, ...withoutLink } = revival;
  r = await call('admin', 'PUT', `/api/admin/events/${revival.id}`, { ...withoutLink, title: 'Revival night (moved)', mapPlace: { embed: 'https://evil.example/' } });
  const moved = (await call('anon', 'GET', '/api/events')).data.find(e => e.id === revival.id);
  check('an edit that sends a spot of its own, without a link, cannot change where the map points',
    r.status === 200 && moved.title === 'Revival night (moved)' && moved.mapUrl === keptLink && moved.mapPlace && /^https:\/\/www\.google\.com\/maps\/embed/.test(moved.mapPlace.embed || ''), moved);

  r = await call('admin', 'POST', '/api/admin/departments', { name: 'Choir', meetingLocation: 'Room 4', mapUrl: 'maps.app.goo.gl/LeadsAway' });
  check('a department takes a short link as it is given', r.status === 200 && r.data.item.mapUrl === 'https://maps.app.goo.gl/LeadsAway', r.data);
  const deptId = r.data.item.id;
  await new Promise(res => setTimeout(res, 300));
  const dept = (await call('anon', 'GET', `/api/departments/${deptId}`)).data;
  check('a short link that leads off the map services shows no map, only the link', dept.mapPlace === null, dept.mapPlace);
  check('and the app never asked the place it led to', !outside.some(u => u.includes('evil.example')), outside);

  r = await call('admin', 'POST', '/api/admin/groups', { name: 'Hall cell', type: 'cell', meetingLocation: 'Unity Hall', mapUrl: 'https://www.openstreetmap.org/?mlat=6.68&mlon=-1.56#map=18/6.68/-1.56' });
  check('a group takes an OpenStreetMap link, and the spot in it', r.status === 200 && r.data.item.mapPlace && r.data.item.mapPlace.lat === 6.68, r.data);

  r = await call('admin', 'POST', '/api/admin/events', { title: 'x', date: '2026-12-02', mapUrl: 'javascript:alert(1)' }, null, 'urlencoded');
  check('a link sent as a plain form is checked too', refused(r), r);
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0])], { type: 'image/jpeg' }), 'x.jpg');
  fd.append('mapUrl', 'javascript:alert(1)');
  r = await call('admin', 'POST', '/api/admin/uploads', fd, null, 'form');
  check('and one sent alongside a file upload', refused(r), r);

  console.log(failures ? `\n${failures} map check(s) FAILED` : '\nall map checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
