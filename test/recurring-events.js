// Events that happen again: every week, every other week, or monthly. The
// event moves on to its next date by itself, registrations start afresh for
// each one, and one time can be called off or moved without touching the rest.
//
//   node test/recurring-events.js     (also run by `npm test`)
const { fakeModels } = require('./harness.js');
const rec = require('../lib/recurrence');

(async () => {
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/aconsu_recurring', PORT: '4382', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 'test', LOGIN_RATE_LIMIT_MAX: '500' });
  delete process.env.SHEPHERD_USERNAME;
  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 600)}` : ''}`); }
  }
  const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  const today = day(0);

  console.log('\n== the rules ==');
  const at = (s) => new Date(`${s}T10:00:00Z`);
  const weekly = { date: '2026-11-04', time: '18:30', repeat: { every: 'week' }, seriesStart: '2026-11-04', occurrence: '2026-11-04', seriesTime: '18:30' };
  check('a weekly event whose day has gone moves to the next week', JSON.stringify(rec.rollForward(weekly, at('2026-11-12'))) === JSON.stringify({ date: '2026-11-18', occurrence: '2026-11-18', time: '18:30' }), rec.rollForward(weekly, at('2026-11-12')));
  check('not before its day has gone', rec.rollForward({ ...weekly, date: '2026-11-12', occurrence: '2026-11-12' }, at('2026-11-12')) === null);
  check('every other week keeps to its own weeks', rec.rollForward({ ...weekly, repeat: { every: '2weeks' }, seriesStart: '2026-10-28', occurrence: '2026-10-28', date: '2026-10-28' }, at('2026-11-12')).date === '2026-11-25');
  check('monthly on the 31st falls on the 30th in a 30-day month', rec.nextAfter({ date: '2026-10-31', repeat: { every: 'month', monthBy: 'date' }, seriesStart: '2026-01-31' }, '2026-10-31') === '2026-11-30');
  check('the first Saturday of the month', rec.nextAfter({ date: '2026-11-07', repeat: { every: 'month', monthBy: 'weekday' }, seriesStart: '2026-11-07' }, '2026-11-07') === '2026-12-05'
    && rec.describe({ every: 'month', monthBy: 'weekday' }, '2026-11-07') === 'First Saturday of every month');
  check('the last Friday of the month', rec.nextAfter({ date: '2026-10-30', repeat: { every: 'month', monthBy: 'weekday' }, seriesStart: '2026-10-30' }, '2026-10-30') === '2026-11-27');
  check('a series with an end date stops there', rec.rollForward({ ...weekly, repeat: { every: 'week', until: '2026-11-10' } }, at('2026-11-12')) === null);
  check('the series in words', rec.describe({ every: 'week' }, '2026-11-04') === 'Every Wednesday' && rec.describe({ every: '2weeks' }, '2026-11-07') === 'Every other Saturday'
    && rec.describe({ every: 'month' }, '2026-11-22') === 'Monthly on the 22nd');
  const moved = { ...weekly, date: '2026-11-17', occurrence: '2026-11-18' };
  check('once a moved one has passed, the series carries on after the date it replaced', rec.rollForward(moved, at('2026-11-18')).date === '2026-11-25', rec.rollForward(moved, at('2026-11-18')));
  check('a choice that is not one of the choices is ignored', rec.cleanRepeat({ every: 'daily' }).every === '' && rec.cleanRepeat({ every: 'week', until: 'soon' }).until === '');

  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4382';
  const jars = {};
  async function call(jar, method, p, body, headers) {
    const h = { 'X-Chapter-Id': 'aconsu-knust', ...(headers || {}) };
    if (jars[jar]) h.cookie = jars[jar];
    if (body) h['content-type'] = 'application/json';
    const res = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.getSetCookie();
    if (sc.length) jars[jar] = sc.map(c => c.split(';')[0]).join('; ');
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }
  const C = 'aconsu-knust';
  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  await call('admin', 'POST', '/api/national/chapters', { id: C, name: 'ACONSU-KNUST', institution: 'KNUST' });
  const doc = (id) => fakeModels.Event._docs.find(e => e.id === id);
  const listed = async (id) => ((await call(null, 'GET', '/api/events')).data || []).find(e => e.id === id);

  console.log('\n== an event that repeats ==');
  // It began three weeks ago, on today's weekday.
  const start = day(-21);
  let r = await call('admin', 'POST', '/api/admin/events', {
    title: 'Midweek Fellowship', date: start, time: '18:30', location: 'Great Hall', chapterId: C,
    repeat: { every: 'week' }, registrationEnabled: true, capacity: 2,
    skipped: ['1999-01-01'], occurrence: '1999-01-01'
  });
  check('it is saved with its series', r.status === 200 && r.data.item.repeat.every === 'week' && r.data.item.seriesStart === start, r.data);
  const id = r.data.item.id;
  check('where the series stands is the app\'s own, never taken from the form', doc(id).skipped.length === 0 && doc(id).occurrence === start, doc(id));
  check('it is described in words', /^Every [A-Z][a-z]+day$/.test(doc(id).recurring), doc(id).recurring);
  let ev = await listed(id);
  check('once its day has gone it shows its next date: today, the same weekday', ev && ev.date === today && ev.repeats === true, ev);
  check('the stored event has moved on too, for the counts that read it', doc(id).date === today && doc(id).occurrence === today);
  check('and the next few dates are listed', ev.nextDates.length === 4 && ev.nextDates[1] === day(7) && ev.nextDates[3] === day(21), ev.nextDates);

  console.log('\n== registrations start afresh each time ==');
  r = await call(null, 'POST', `/api/events/${id}/register`, { name: 'Ama', email: 'ama@example.com' });
  await call(null, 'POST', `/api/events/${id}/register`, { name: 'Kofi', email: 'kofi@example.com' });
  r = await call(null, 'POST', `/api/events/${id}/register`, { name: 'Esi', email: 'esi@example.com' });
  check('this time fills up', r.status === 400 && /fully booked/.test(r.data.error), r.data);
  check('each registration says which date it is for', fakeModels.EventRegistration._docs.every(g => g.occurrenceDate === today));

  console.log('\n== calling one off, and moving one ==');
  r = await call('admin', 'POST', `/api/admin/events/${id}/move-next`, { date: day(1), time: '17:00' });
  check('this one moves to tomorrow at 5pm', r.status === 200 && doc(id).date === day(1) && doc(id).time === '17:00' && doc(id).occurrence === today, r.data);
  ev = await listed(id);
  check('it shows as moved, and keeps the people already signed up for it', ev.moved === true && ev.registrationCount === 2 && ev.spotsLeft === 0, ev);
  check('the chapter is told', fakeModels.Notification._docs.some(n => /Midweek Fellowship: moved to/.test(n.title)));
  r = await call('admin', 'POST', `/api/admin/events/${id}/move-next`, { date: day(7) });
  check('it cannot be moved onto or past the next one', r.status === 400, r.data);
  r = await call('admin', 'POST', `/api/admin/events/${id}/move-next`, { date: day(-1) });
  check('nor into the past', r.status === 400, r.data);
  r = await call('admin', 'POST', `/api/admin/events/${id}/skip-next`);
  check('this one is called off, and the event moves to next week at the usual time', r.status === 200 && doc(id).date === day(7) && doc(id).time === '18:30' && doc(id).skipped.includes(today), doc(id));
  check('(with a notice saying so)', fakeModels.Notification._docs.some(n => /Midweek Fellowship: not on/.test(n.title)));
  ev = await listed(id);
  check('next week\'s registrations start from nothing', ev.registrationCount === 0 && ev.spotsLeft === 2 && ev.moved === false, ev);
  r = await call(null, 'POST', `/api/events/${id}/register`, { name: 'Esi', email: 'esi@example.com' });
  check('and are open', r.status === 200 && fakeModels.EventRegistration._docs.some(g => g.name === 'Esi' && g.occurrenceDate === day(7)), r.data);

  console.log('\n== editing it ==');
  r = await call('admin', 'PUT', `/api/admin/events/${id}`, { title: 'Midweek Service', location: 'Room 12' });
  check('changing its name or place keeps the series as it is', doc(id).title === 'Midweek Service' && doc(id).skipped.includes(today) && doc(id).seriesStart === start, doc(id));
  r = await call('admin', 'PUT', `/api/admin/events/${id}`, { date: doc(id).date, time: '18:30', repeat: { every: 'week', until: day(14) } });
  check('an end date can be added', doc(id).repeat.until === day(14) && /until/.test(doc(id).recurring), doc(id));
  r = await call('admin', 'PUT', `/api/admin/events/${id}`, { date: doc(id).date, time: '18:30', repeat: { every: '' } });
  check('turning the repeat off makes it a one-off again, and its words go', doc(id).repeat.every === '' && doc(id).recurring === '' && (await listed(id)).repeats === false, doc(id));
  r = await call('admin', 'POST', `/api/admin/events/${id}/skip-next`);
  check('a one-off cannot be "called off this time"', r.status === 400, r.data);

  console.log('\n== a series that ends ==');
  r = await call('admin', 'POST', '/api/admin/events', { title: 'Revival Week', date: day(-14), time: '19:00', chapterId: C, repeat: { every: 'week', until: day(-7) } });
  const ended = r.data.item.id;
  ev = await listed(ended);
  check('once its last date has gone it stays in the past', ev.date < today && ev.repeats === true, ev);

  console.log('\n== Publicity ==');
  // The Publicity Head runs Publicity, signing in with their app password.
  const f = new FormData();
  f.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'me.png');
  Object.entries({ name: 'Abena Publicity', email: 'pub@example.com', phone: '0244700001', password: 'a-good-long-password', chapterId: C, consent: 'true' }).forEach(([k, v]) => f.append(k, v));
  const pubMember = (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: f })).json()).member.id;
  await call('admin', 'POST', '/api/admin/staff', { role: 'executive', positionKey: 'publicity_head', memberId: pubMember, chapterId: C });
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; a.mustSetUpSecondStep = false; });
  r = await call('pub', 'POST', '/api/portal/login', { username: 'pub@example.com', password: 'a-good-long-password', portal: 'publicity' });
  check('(the Publicity Head signs in)', r.status === 200, r.data);
  r = await call('pub', 'POST', '/api/publicity/events', { title: 'Prayer Night', date: day(3), time: '20:00', repeat: { every: 'month', monthBy: 'weekday' } });
  check('Publicity makes a monthly one', r.status === 200 && r.data.item.repeat.monthBy === 'weekday' && / of every month$/.test(r.data.item.recurring), r.data);
  r = await call('pub', 'POST', `/api/publicity/events/${(r.data.item || {}).id}/skip-next`);
  check('and can call one off', r.status === 200 && r.data.item.date > day(3), r.data);

  console.log(failures ? `\n${failures} FAILURES` : '\nall recurring event checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
