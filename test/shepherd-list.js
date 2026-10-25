// Shepherding on its own: the chapter's list brought in from a CSV file, and
// Sunday check-in at the door. Checks the file reading in lib/peopleImport.js,
// the three import steps, that nobody is added twice, check-in by name, by
// newcomer and taken back, several phones at once, that the register is never
// saved over newer check-ins, attendance rates that count a missed Sunday, and
// that one chapter never sees or touches another's list.
//
//   node test/shepherd-list.js     (also run by `npm test`)
const { fakeModels } = require('./harness.js');
const peopleImport = require('../lib/peopleImport');

(async () => {
  process.env.MONGODB_URI = 'mongodb://stub/aconsu_shepherd_list';
  process.env.PORT = '4336';
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
  const file = (text) => peopleImport.readFile(Buffer.from(text));

  console.log('\n== reading a list ==');
  let f = file('Timestamp,Full Name,Phone Number,Email Address,Level,Programme,Hall/Hostel,Department,Date of Birth,Gender,No.\n2026/09/01,Ama,0244000001,,,,,,,,1\n');
  check('a Google Form\'s headings are recognised', JSON.stringify(peopleImport.guessMapping(f.headers)) === JSON.stringify(['skip', 'name', 'phone', 'email', 'level', 'programme', 'address', 'department', 'birthday', 'note', 'skip']), peopleImport.guessMapping(f.headers));
  f = file('Surname;Other Names;Contact\nMensah;Kwame;0201234567\n');
  check('so are Surname and Other names, in a file saved with semicolons', JSON.stringify(peopleImport.guessMapping(f.headers)) === JSON.stringify(['lastName', 'firstName', 'phone']), f.headers);
  check('and the two make one name', peopleImport.planImport(f, peopleImport.guessMapping(f.headers)).plan[0].name === 'Kwame Mensah');
  check('two columns that both look like the phone: the surer one gets it, the other goes to the notes', JSON.stringify(peopleImport.guessMapping(['Contact', 'Phone Number'])) === JSON.stringify(['note', 'phone']), peopleImport.guessMapping(['Contact', 'Phone Number']));
  f = file('"Name","Notes"\r\n"Ama ""Pinky"" Owusu","line one\nline two"\r\n\r\nYaw,ok\r\n');
  check('quoted cells keep their commas, quotes and line breaks', f.rows[0].cells[0] === 'Ama "Pinky" Owusu' && f.rows[0].cells[1] === 'line one\nline two', f.rows);
  check('blank rows are passed over, and rows keep their spreadsheet numbers', f.rows.length === 2 && f.rows[1].rowNumber === 4, f.rows);
  const windows = peopleImport.readFile(Buffer.concat([Buffer.from('Name\nAma'), Buffer.from([0x92]), Buffer.from('s')]));
  check('a file saved by Excel on Windows (not UTF-8) keeps its curly apostrophe', windows.rows[0].cells[0] === 'Ama’s', windows.rows);
  check('so does one with a byte-order mark', peopleImport.readFile(Buffer.from('﻿Name\nAma\n')).headers[0] === 'Name');
  check('an Excel file is turned away, with how to save it as CSV', /Save As/.test(peopleImport.readFile(Buffer.from('PK\u0003\u0004rest')).error || ''));
  check('so is a file that is not text', !!peopleImport.readFile(Buffer.from([0x4e, 0x00, 0x61])).error);
  check('and an empty one', !!peopleImport.readFile(Buffer.from('\n\n')).error);
  check(`more than ${peopleImport.MAX_ROWS} people at once is refused, with what to do`, /split the list/.test(peopleImport.readFile(Buffer.from(`Name\n${'Ama\n'.repeat(peopleImport.MAX_ROWS + 1)}`)).error || ''));
  for (const [raw, want] of [['244123456', '0244123456'], ['+233 24 412 3456', '0244123456'], ['00233244123456', '0244123456'], ['024-412-3456', '0244123456'], ['+44 7700 900123', '+44 7700 900123']]) {
    check(`phone ${raw} is kept as ${want}`, peopleImport.tidyPhone(raw).value === want, peopleImport.tidyPhone(raw));
  }
  const two = peopleImport.tidyPhone('0244123456 / 0201234567');
  check('two numbers in one cell: the first is the phone, the other is kept', two.value === '0244123456' && two.extra === '0201234567', two);
  check('a number Excel has turned into 2.44E+08 is never guessed at', peopleImport.tidyPhone('2.44123E+08').value === '' && !!peopleImport.tidyPhone('2.44123E+08').unreadable);
  for (const [raw, order, want] of [['13/05/2004', 'dmy', [5, 13]], ['05/13/2004', 'mdy', [5, 13]], ['2004-05-13', 'dmy', [5, 13]], ['13th May', 'dmy', [5, 13]], ['May 13, 2004', 'dmy', [5, 13]], ['13-May-04', 'dmy', [5, 13]]]) {
    const b = peopleImport.parseBirthday(raw, order);
    check(`birthday ${raw} is ${want.join('/')}`, b && b.month === want[0] && b.day === want[1], b);
  }
  check('31 February is not a birthday', peopleImport.parseBirthday('31/02/2004', 'dmy') === null);
  check('a column of US-style dates is read month first', peopleImport.detectDateOrder(['01/02/2004', '05/13/2004']) === 'mdy');
  check('and day first otherwise, as Ghana writes them', peopleImport.detectDateOrder(['01/02/2004', '03/04/2005']) === 'dmy');
  check('names typed in capitals are tidied', peopleImport.tidyName('ABENA O. MENSAH') === 'Abena O. Mensah');
  check('and in small letters', peopleImport.tidyName('kwame de-graft') === 'Kwame De-Graft');
  check('a name typed in mixed case is left as typed', peopleImport.tidyName('Kwesi McCarthy') === 'Kwesi McCarthy');
  check('"Level 200" and "L200" are level 200', peopleImport.tidyLevel('Level 200') === '200' && peopleImport.tidyLevel('L200') === '200');
  const depts = [{ id: 'd1', name: 'Music Department' }];
  check('"music" is the Music Department', peopleImport.matchDepartment('music', depts) === 'd1');
  check('a department the chapter does not have is not guessed at', peopleImport.matchDepartment('Computer Science', depts) === '');

  console.log('\n== who is new ==');
  f = file([
    'Name,Phone,Email,Gender',
    'Kofi Mensah,0244000001,kofi@x.com,Male',      // new
    'Esi Arthur,0244000001,,Female',               // shares Kofi's phone, a different person
    'KOFI MENSAH,244000001,,',                     // Kofi again
    ',0200000000,,',                               // no name
    'Akua Sarpong,0209999999,,',                   // already has an account
    'Yaw Boateng,0277777777,,',                    // on the list with no phone yet
    'Abena Owusu,0266666666,,'                     // on the list already, nothing new
  ].join('\n'));
  let p = peopleImport.planImport(f, peopleImport.guessMapping(f.headers), {
    existing: [
      { kind: 'member', id: 'm1', name: 'Akua Sarpong', phone: '+233 20 999 9999', email: '' },
      { kind: 'record', id: 'r1', name: 'Yaw Boateng', phone: '', email: '' },
      { kind: 'record', id: 'r2', name: 'Abena Owusu', phone: '0266666666', email: '' },
      { kind: 'record', id: 'r3', name: 'Kofi Annan', phone: '', email: '' }
    ]
  });
  const act = (row) => p.plan.find(x => x.row === row);
  check('someone new is added', act(2).action === 'add' && act(2).person.pastoralNotes === 'Gender: Male', act(2));
  check('a second person sharing a phone is still added, with a note to check', act(3).action === 'add' && /same phone number as Kofi Mensah/.test(act(3).warnings.join(' ')), act(3));
  check('the same person twice in the file is brought in once', act(4).action === 'skip' && act(4).reason === 'Same person as row 2', act(4));
  check('a row with no name is left out, and says so', act(5).action === 'skip' && /No name/.test(act(5).reason), act(5));
  check('someone with an app account is not added again', act(6).action === 'account' && act(6).matchId === 'm1', act(6));
  check('someone on the list has their blanks filled', act(7).action === 'fill' && act(7).changes.phone === '0277777777', act(7));
  check('and someone the file adds nothing to is left alone', act(8).action === 'same', act(8));
  check('a different person with a similar name is not mistaken for them', !p.plan.some(x => x.matchId === 'r3'));
  check('names agree when one is the other, in any order or with more to it', peopleImport.namesAgree('Kofi Mensah', 'MENSAH KOFI Jnr') && peopleImport.namesAgree('Bro. Kofi Mensah', 'Kofi Mensah'));
  check('sisters sharing a surname do not', !peopleImport.namesAgree('Esi Owusu', 'Ama Owusu'));
  const sistersFile = file('Name,Phone\nAma Owusu,0201112222\nEsi Owusu,0201112222\n');
  const sisters = peopleImport.planImport(sistersFile, peopleImport.guessMapping(sistersFile.headers));
  check('so a list with two sisters on one phone number brings in both, with a note to check', sisters.counts.add === 2 && /same phone number as Ama Owusu/.test(sisters.plan[1].warnings.join(' ')), sisters.plan);
  check('the counts add up', JSON.stringify(p.counts) === JSON.stringify({ add: 2, fill: 1, same: 1, account: 1, skip: 2 }), p.counts);

  // ------------------------------------------------------------------ the app --
  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4336';
  const jars = {};
  async function call(jar, method, path, body, headers) {
    const h = { ...(headers || {}) };
    if (jars[jar]) h.cookie = jars[jar];
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + path, { method, headers: h, body: payload });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (sc.length) jars[jar] = sc.map(c => c.split(';')[0]).join('; ');
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  const upload = (jar, csv, step, extra, headers) => {
    const fd = new FormData();
    fd.append('file', new Blob([Buffer.isBuffer(csv) ? csv : Buffer.from(csv)], { type: 'text/csv' }), 'list.csv');
    fd.append('step', step);
    Object.entries(extra || {}).forEach(([k, v]) => fd.append(k, typeof v === 'string' ? v : JSON.stringify(v)));
    return call(jar, 'POST', '/api/shepherd/import', fd, headers);
  };

  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  for (const [id, name] of [['knust', 'ACONSU KNUST'], ['legon', 'ACONSU Legon']]) {
    await call('admin', 'POST', '/api/national/chapters', { id, name, institution: name });
  }
  const music = (await call('admin', 'POST', '/api/admin/departments', { name: 'Music', tagline: 'x', chapterId: 'knust' })).data.item.id;
  let n = 0;
  async function member(name, chapterId, phone) {
    n += 1;
    const fd = new FormData();
    fd.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
    Object.entries({ name, email: `sl${n}@example.com`, password: 'secret123', chapterId, phone: phone || '', consent: 'true' }).forEach(([k, v]) => fd.append(k, v));
    return (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd })).json()).member.id;
  }
  const akua = await member('Akua Sarpong', 'knust', '0209999999');
  for (const [username, role, chapterId] of [['shep.k', 'shepherding', 'knust'], ['pub.k', 'publicity', 'knust'], ['fin.k', 'finance', 'knust'], ['shep.l', 'shepherding', 'legon']]) {
    const r = await call('admin', 'POST', '/api/admin/staff', { username, name: username, role, password: 'Start-Pass-1', chapterId, memberId: await member(username, chapterId) });
    check(`${username} account`, r.status === 200, r.data);
  }
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; });
  for (const who of ['shep.k', 'pub.k', 'fin.k', 'shep.l']) await call(who, 'POST', '/api/portal/login', { username: who, password: 'Start-Pass-1' });

  console.log('\n== bringing the list in ==');
  const LIST = [
    'Timestamp,Full Name,Phone Number,Email Address,Level,Programme,Hall/Hostel,Department,Date of Birth,Gender',
    '2026/09/01,KOFI MENSAH,244000001,kofi@x.com,Level 200,BSc Computer Science,Unity Hall,Music,13/05/2004,Male',
    '2026/09/01,Ama Owusu,"+233 20 111 2222 / 0551234567",,300,"Nursing, BSc","Hall 7, Room 12",Computer Science,March 3rd,Female',
    '2026/09/01,,0201111111,,,,,,,',
    '2026/09/01,Kofi Mensah,0244000001,,,,,,,',
    '2026/09/01,Akua Sarpong,0209999999,,,,,,,',
    '2026/09/01,Yaw Boateng,,,100,,,,,'
  ].join('\n');
  let r = await upload('anon', LIST, 'read');
  check('nobody signed out can bring a list in', r.status === 401, r.data);
  r = await upload('fin.k', LIST, 'read');
  check('nor another office', r.status === 401, r.data);
  r = await upload('shep.k', LIST, 'read');
  check('reading the file says what is in each column', r.status === 200 && r.data.rowCount === 6 && r.data.columns[1].field === 'name' && r.data.columns[1].samples[0] === 'KOFI MENSAH', r.data);
  check('and offers every field to choose from', r.data.fields.some(x => x.key === 'emergencyContact') && r.data.fields.some(x => x.key === 'skip'));
  const before = fakeModels.ShepherdingRecord._docs.length;
  r = await upload('shep.k', LIST, 'check', { mapping: r.data.columns.map(c => c.field) });
  check('checking says who would be added, and why others are not', r.status === 200 && JSON.stringify(r.data.counts) === JSON.stringify({ add: 3, fill: 0, same: 0, account: 1, skip: 2 }), r.data.counts);
  check('with the rows left out and the reason for each', r.data.notAdding.some(x => x.row === 4 && /No name/.test(x.reason)) && r.data.notAdding.some(x => x.row === 5 && x.reason === 'Same person as row 2'), r.data.notAdding);
  check('and the person who already has an account named', r.data.notAdding.some(x => x.action === 'account' && x.matchName === 'Akua Sarpong'), r.data.notAdding);
  check('checking writes nothing', fakeModels.ShepherdingRecord._docs.length === before);
  r = await upload('shep.k', LIST, 'import', { mapping: ['skip', 'name', 'phone', 'email', 'level', 'programme', 'address', 'department', 'birthday', 'note'] });
  check('bringing it in adds them', r.status === 200 && r.data.done.added === 3, r.data);
  const kofi = fakeModels.ShepherdingRecord._docs.find(x => x.name === 'Kofi Mensah');
  check('tidied: the name, the phone Excel dropped the 0 from, the level', kofi && kofi.phone === '0244000001' && kofi.level === '200', kofi);
  check('the department is the chapter\'s own Music department', kofi.department === music, kofi.department);
  check('the birthday month and day are kept', kofi.birthdayMonth === 5 && kofi.birthdayDay === 13, kofi);
  check('a column with no place of its own is kept in the notes', kofi.pastoralNotes === 'Gender: Male', kofi.pastoralNotes);
  check('they are marked as from the chapter\'s list, regular, in this chapter', kofi.origin === 'import' && kofi.attendanceStatus === 'regular' && kofi.chapterId === 'knust' && kofi.memberId === '', kofi);
  const ama = fakeModels.ShepherdingRecord._docs.find(x => x.name === 'Ama Owusu');
  check('an academic department goes to the notes, and so does a second phone', /Department: Computer Science/.test(ama.pastoralNotes) && /Other phone: 0551234567/.test(ama.pastoralNotes), ama.pastoralNotes);
  check('every new person has an id of their own', new Set(fakeModels.ShepherdingRecord._docs.map(x => x.id)).size === fakeModels.ShepherdingRecord._docs.length);
  r = await upload('shep.k', LIST, 'import');
  check('bringing the same file in again adds nobody', r.status === 200 && r.data.done.added === 0 && r.data.counts.same === 3, r.data.counts);
  r = await upload('shep.k', 'Name,Phone,Hall\nYaw Boateng,0277777777,Unity Hall\n', 'import');
  check('a later file fills in what was missing', r.data.done.filled === 1 && fakeModels.ShepherdingRecord._docs.find(x => x.name === 'Yaw Boateng').phone === '0277777777', r.data);
  r = await upload('shep.k', 'Name,Phone\nYaw Boateng,0200000000\n', 'import');
  check('but never changes what is already there', fakeModels.ShepherdingRecord._docs.find(x => x.name === 'Yaw Boateng').phone === '0277777777' && r.data.counts.add === 1, r.data.counts);
  fakeModels.ShepherdingRecord._docs.splice(fakeModels.ShepherdingRecord._docs.findIndex(x => x.phone === '0200000000'), 1);
  r = await upload('shep.k', LIST, 'check', { mapping: ['skip', 'note', 'phone'] });
  check('without a column of names, it asks which one it is', r.status === 400 && /names/.test(r.data.error), r.data);
  r = await upload('shep.k', Buffer.from('PK\u0003\u0004xlsx'), 'read');
  check('an Excel file is sent back with how to save it as CSV', r.status === 400 && /CSV/.test(r.data.error), r.data);
  r = await upload('shep.k', Buffer.alloc(peopleImport.MAX_BYTES + 10, 'a'), 'read');
  check('a file over 1 MB is refused', r.status === 400 && /1 MB/.test(r.data.error), r.data);
  r = await upload('shep.k', 'Name,Phone\n', 'read');
  check('a file of headings and nobody says so', r.status === 400 && /nobody/.test(r.data.error), r.data);
  r = await call('shep.k', 'GET', '/api/shepherd/import/template.csv');
  check('a sample list can be downloaded to start from', r.status === 200 && /^Full name,Phone/.test(r.data) && /attachment/.test(r.headers.get('content-disposition')), r.data);

  r = await call('shep.k', 'GET', '/api/shepherd/members');
  const people = r.data;
  const kofiRow = people.find(x => x.name === 'Kofi Mensah');
  check('the people list shows them, with what the file said', kofiRow && kofiRow.source === 'visitor' && kofiRow.origin === 'import' && kofiRow.level === '200' && kofiRow.programme === 'BSc Computer Science' && kofiRow.department === music, kofiRow);

  r = await upload('shep.l', LIST, 'check');
  check('another chapter\'s list is its own: none of these people are known there', r.data.counts.add === 4 && r.data.counts.account === 0, r.data.counts);
  r = await call('shep.l', 'GET', '/api/shepherd/members');
  check('and it sees none of this chapter\'s people', !r.data.some(x => x.name === 'Kofi Mensah'), r.data.map(x => x.name));

  console.log('\n== Sunday check-in ==');
  const day = '2026-11-01';
  const at = { date: day, serviceType: 'sunday' };
  const ids = Object.fromEntries(people.map(x => [x.name, x.source === 'member' ? { memberId: x.memberId } : { recordId: x.recordId }]));
  r = await call('shep.k', 'POST', '/api/attendance/mark', { ...ids['Kofi Mensah'], ...at });
  check('someone on the list is checked in with one tap', r.status === 200 && r.data.present === 1 && r.data.person.name === 'Kofi Mensah' && !r.data.alreadyMarked, r.data);
  r = await call('shep.k', 'POST', '/api/attendance/mark', { ...ids['Kofi Mensah'], ...at });
  check('a second tap does not count them twice', r.data.alreadyMarked === true && r.data.present === 1, r.data);
  r = await call('pub.k', 'POST', '/api/attendance/mark', { memberId: akua, ...at });
  check('someone with an account too, by anyone on the door', r.status === 200 && r.data.present === 2, r.data);
  r = await call('fin.k', 'POST', '/api/attendance/mark', { ...ids['Ama Owusu'], ...at });
  check('an office that does not take attendance cannot', r.status === 401, r.data);
  const legonPerson = (await call('shep.l', 'POST', '/api/attendance/newcomer', { name: 'Legon Visitor', phone: '0240000099', ...at })).data.person;
  r = await call('shep.k', 'POST', '/api/attendance/mark', { recordId: legonPerson.recordId, ...at });
  check('someone from another chapter is not found here', r.status === 404, r.data);
  r = await call('shep.k', 'POST', '/api/attendance/unmark', { recordId: legonPerson.recordId, ...at });
  check('nor can their check-in be taken back from here', r.status === 404, r.data);
  r = await call('shep.k', 'GET', `/api/attendance/checkins?date=${day}&serviceType=sunday`);
  check('who is in so far, newest first, with the time', r.data.count === 2 && r.data.present[0].name === 'Akua Sarpong' && !!r.data.present[0].at, r.data);
  r = await call('shep.k', 'POST', '/api/attendance/unmark', { memberId: akua, ...at });
  check('a check-in can be taken back', r.status === 200 && r.data.present === 1, r.data);
  r = await call('shep.k', 'POST', '/api/attendance/unmark', { memberId: akua, ...at });
  check('taking it back twice changes nothing', r.data.alreadyMarked === true && r.data.present === 1, r.data);
  r = await call('shep.k', 'POST', '/api/attendance/newcomer', { name: 'efua nyarko', phone: '+233 24 555 0000', ...at });
  check('someone new is added and checked in, in one go', r.status === 200 && r.data.wasOnList === false && r.data.person.name === 'Efua Nyarko' && r.data.present === 2, r.data);
  const efua = fakeModels.ShepherdingRecord._docs.find(x => x.name === 'Efua Nyarko');
  check('as new at the door, for the team to follow up', efua && efua.origin === 'checkin' && efua.attendanceStatus === 'new' && efua.phone === '0245550000' && efua.chapterId === 'knust', efua);
  r = await call('shep.k', 'POST', '/api/attendance/newcomer', { name: 'Kofi Mensah', phone: '0244 000 001', date: '2026-11-08' });
  check('"someone new" with a phone already on the list is that person, not a second one', r.data.wasOnList === true && r.data.person.recordId === ids['Kofi Mensah'].recordId, r.data);
  check('so nobody is added', fakeModels.ShepherdingRecord._docs.filter(x => x.name === 'Kofi Mensah').length === 1);
  r = await call('shep.k', 'POST', '/api/attendance/newcomer', { name: ' ', ...at });
  check('a newcomer needs a name', r.status === 400, r.data);

  // Twelve phones tapping at the same moment: every check-in lands, on one register.
  const crowd = [];
  for (let i = 0; i < 12; i++) {
    crowd.push((await call('shep.k', 'POST', '/api/attendance/newcomer', { name: `Crowd Person ${i}`, date: '2026-10-25' })).data.person);
  }
  await call('shep.k', 'POST', '/api/attendance/unmark', { recordId: crowd[0].recordId, date: '2026-10-25' });
  const sunday = '2026-11-15';
  // Each phone reads the register over a network, so their reads and writes overlap.
  fakeModels.AttendanceRecord.findDelayMs = 15;
  const results = await Promise.all(crowd.map((c, i) => call(i % 2 ? 'pub.k' : 'shep.k', 'POST', '/api/attendance/mark', { recordId: c.recordId, date: sunday })));
  fakeModels.AttendanceRecord.findDelayMs = 0;
  check('twelve check-ins sent at the same moment all land', results.every(x => x.status === 200), results.map(x => x.status));
  const registers = fakeModels.AttendanceRecord._docs.filter(x => x.date === sunday && x.chapterId === 'knust');
  check('on one register, with nobody lost', registers.length === 1 && registers[0].marks.filter(m => m.status === 'present').length === 12, registers.map(x => x.marks.length));

  console.log('\n== the register is never saved over newer check-ins ==');
  r = await call('shep.k', 'GET', `/api/shepherd/attendance/${day}?serviceType=sunday`);
  const opened = r.data.record;
  check('the register opened carries its version', typeof opened.rev === 'number' && opened.rev > 0, opened);
  await call('pub.k', 'POST', '/api/attendance/mark', { ...ids['Ama Owusu'], ...at });
  const asOpened = opened.marks.map(m => ({ ...m }));
  r = await call('shep.k', 'POST', '/api/shepherd/attendance', { ...at, rev: opened.rev, marks: asOpened });
  check('saving a register opened before someone was checked in is refused, with why', r.status === 409 && /checked in since/.test(r.data.error), r.data);
  r = await call('shep.k', 'GET', '/api/attendance/checkins?date=2026-11-01');
  check('and the check-in made meanwhile is still there', r.data.present.some(x => x.name === 'Ama Owusu'), r.data.present);
  const fresh = (await call('shep.k', 'GET', `/api/shepherd/attendance/${day}?serviceType=sunday`)).data.record;
  const corrected = fresh.marks.map(m => (m.name === 'Efua Nyarko' ? { ...m, status: 'excused' } : m));
  r = await call('shep.k', 'POST', '/api/shepherd/attendance', { ...at, rev: fresh.rev, marks: corrected });
  check('opened again, the correction saves', r.status === 200 && r.data.item.rev === fresh.rev + 1, r.data);
  check('and the check-in times are kept through it', r.data.item.marks.find(m => m.name === 'Kofi Mensah').at, r.data.item.marks);
  r = await call('shep.k', 'POST', '/api/shepherd/attendance', { date: '2026-12-06', serviceType: 'sunday', marks: [{ recordId: ids['Kofi Mensah'].recordId, name: 'Kofi Mensah', status: 'present' }] });
  check('a register saved without a version (an older screen) still saves', r.status === 200 && r.data.item.rev === 1, r.data);

  console.log('\n== attendance rates count the Sundays missed ==');
  // Kofi has been on the list since September; registers on 1, 15 and 22 November.
  fakeModels.ShepherdingRecord._docs.find(x => x.name === 'Kofi Mensah').createdAt = '2026-09-01T10:00:00.000Z';
  await call('shep.k', 'POST', '/api/attendance/mark', { ...ids['Ama Owusu'], date: '2026-11-22' });
  r = await call('shep.k', 'GET', `/api/shepherd/attendance-history/${ids['Kofi Mensah'].recordId}`);
  const kh = r.data;
  check('a Sunday he was not checked in at counts as missed', kh.history.some(h => h.date === '2026-11-15' && h.status === 'absent' && h.notCheckedIn), kh.history);
  check('so his rate is honest, not 100%', kh.servicesRecorded >= 4 && kh.attended === 3 && kh.rate < 100, kh);
  r = await call('shep.k', 'GET', `/api/shepherd/attendance-history/${efua.id}`);
  check('Sundays before someone was on the list are not held against them', !r.data.history.some(h => h.date < efua.createdAt.slice(0, 10)), r.data.history);
  r = await call('shep.k', 'GET', '/api/shepherd/attendance-summary.pdf');
  check('the attendance % report still builds, with the list in it', r.status === 200 && String(r.headers.get('content-type')).includes('pdf'), r.status);

  console.log('\n== the dashboards ==');
  r = await call('admin', 'GET', '/api/national/dashboard');
  const k = r.data.chapters.find(c => c.id === 'knust');
  const imported = fakeModels.ShepherdingRecord._docs.filter(x => x.chapterId === 'knust' && x.origin === 'import').length;
  const others = fakeModels.ShepherdingRecord._docs.filter(x => x.chapterId === 'knust' && !x.memberId && x.origin !== 'import').length;
  const waiting = fakeModels.Member._docs.filter(m => m.chapterId === 'knust' && ['visitor', 'under_review', 'accepted'].includes(m.membershipStage)).length;
  check('people from the chapter\'s list count as members, not visitors', k.visitorCount === waiting + others && k.memberCount >= imported, { k, imported, others, waiting });

  console.log('\n== someone on the list opens an app account ==');
  const kofiRecordId = ids['Kofi Mensah'].recordId;
  const kofiSundays = (await call('shep.k', 'GET', `/api/shepherd/attendance-history/${kofiRecordId}`)).data.attended;
  const kofiAccount = await member('Kofi Mensah', 'knust', '+233 24 400 0001');
  let rec = fakeModels.ShepherdingRecord._docs.find(x => x.id === kofiRecordId);
  check('registering with the phone number on the list links them at once', rec.memberId === kofiAccount && rec.linkedHow === 'phone' && rec.linkedBy === 'registration', rec);
  const acct = fakeModels.Member._docs.find(x => x.id === kofiAccount);
  check('and nothing from the list is put on their account (they see only what they typed)', acct.level === '' && acct.programme === '' && !acct.birthdayMonth, acct);
  r = await call('shep.k', 'GET', `/api/shepherd/attendance-history/${kofiAccount}`);
  check('the Sundays he was checked in at as a list person are now his account\'s', r.data.attended === kofiSundays && kofiSundays >= 3, { now: r.data.attended, before: kofiSundays });
  check('and Sundays from when he was on the list still count, not only from when he registered', r.data.history.some(h => h.date === '2026-11-15' && h.status === 'absent'), r.data.history);
  r = await call('shep.k', 'GET', '/api/shepherd/members');
  const kofiRows = r.data.filter(x => x.name === 'Kofi Mensah');
  check('the people list has him once, as the account, saying how he was linked', kofiRows.length === 1 && kofiRows[0].source === 'member' && kofiRows[0].linkedHow === 'phone' && kofiRows[0].canUnlink, kofiRows);
  check('with what the list said filling what his account leaves blank, for Shepherding only', kofiRows[0].level === '200' && kofiRows[0].department === music, kofiRows[0]);
  r = await call('shep.k', 'POST', '/api/attendance/mark', { memberId: kofiAccount, ...at });
  check('checking him in by his account on a Sunday he was checked in by name does not count him twice', r.data.alreadyMarked === true, r.data);
  const reg1101 = fakeModels.AttendanceRecord._docs.find(x => x.date === day && x.chapterId === 'knust');
  check('one mark for him on that register', reg1101.marks.filter(m => m.memberId === kofiAccount).length === 1, reg1101.marks);

  const otherYaw = await member('Yaw Boateng', 'knust', '0200000077');
  rec = fakeModels.ShepherdingRecord._docs.find(x => x.name === 'Yaw Boateng' && x.chapterId === 'knust');
  check('the same name with a different phone is not linked on its own', rec.memberId === '', rec);
  r = await call('shep.k', 'GET', '/api/shepherd/members');
  const yawList = r.data.find(x => x.source === 'visitor' && x.name === 'Yaw Boateng');
  check('but Shepherding sees the account suggested beside him', yawList.suggestion && yawList.suggestion.memberId === otherYaw && yawList.suggestion.how === 'name', yawList);
  await member('Esi Owusu', 'knust', '0201112222');
  check('her sister registering with the same phone number is not linked to her', !fakeModels.ShepherdingRecord._docs.find(x => x.name === 'Ama Owusu' && x.chapterId === 'knust').memberId);

  r = await call('shep.l', 'POST', `/api/shepherd/records/${yawList.recordId}/link`, { memberId: otherYaw });
  check('another chapter cannot link this chapter\'s people', r.status === 404, r.data);
  r = await call('fin.k', 'POST', `/api/shepherd/records/${yawList.recordId}/link`, { memberId: otherYaw });
  check('nor can another office', r.status === 401, r.data);
  r = await call('shep.k', 'POST', `/api/shepherd/records/${yawList.recordId}/link`, { memberId: kofiAccount });
  check('an account already linked to someone on the list is not linked to a second', r.status === 409, r.data);
  r = await call('shep.k', 'POST', `/api/shepherd/records/${yawList.recordId}/link`, { memberId: otherYaw });
  check('Shepherding links them by hand', r.status === 200 && r.data.record.memberId === otherYaw && r.data.record.linkedHow === 'hand', r.data);

  r = await call('shep.k', 'POST', `/api/shepherd/records/${kofiRecordId}/unlink`);
  check('a link that was wrong can be undone', r.status === 200 && r.data.record.memberId === '', r.data);
  r = await call('shep.k', 'GET', `/api/shepherd/attendance-history/${kofiRecordId}`);
  check('and the Sundays go back to the list person', r.data.attended === kofiSundays, r.data);
  r = await call('shep.k', 'POST', `/api/shepherd/records/${kofiRecordId}/unlink`);
  check('unlinking twice says there is nothing to undo', r.status === 404, r.data);

  // An account Shepherding already keeps care notes on, then matched to the list.
  const fd = new FormData();
  fd.append('memberId', otherYaw); fd.append('pastoralNotes', 'Prays for his mother.');
  await call('shep.k', 'POST', '/api/shepherd/records', fd);
  await call('shep.k', 'POST', `/api/shepherd/records/${(await call('shep.k', 'GET', '/api/shepherd/members')).data.find(x => x.memberId === otherYaw).recordId}/unlink`);
  const efuaAcct = await member('Efua Nyarko', 'knust', '');
  const care = new FormData();
  care.append('memberId', efuaAcct); care.append('pastoralNotes', 'Met her at the hall.');
  await call('shep.k', 'POST', '/api/shepherd/records', care);
  r = await call('shep.k', 'POST', `/api/shepherd/records/${efua.id}/link`, { memberId: efuaAcct });
  check('linking to an account that already has care notes folds the two together', r.status === 200 && r.data.merged === true && /Met her at the hall/.test(r.data.record.pastoralNotes) && /First checked in/.test(r.data.record.pastoralNotes), r.data);
  check('leaving one record for her', fakeModels.ShepherdingRecord._docs.filter(x => x.memberId === efuaAcct || x.id === efua.id).length === 1);
  r = await call('shep.k', 'POST', `/api/shepherd/records/${r.data.record.id}/unlink`);
  check('and that link says why it cannot be undone', r.status === 409 && /folded/.test(r.data.error), r.data);

  console.log('\n== the main admin and a chapter that runs itself ==');
  await call('admin', 'POST', '/api/admin/staff', { username: 'coord.k', name: 'coord.k', role: 'coordinator', password: 'Start-Pass-1', chapterId: 'knust', memberId: await member('coord.k', 'knust') });
  r = await upload('admin', 'Name\nSomeone From Above\n', 'import', {}, { 'X-Chapter-Id': 'knust' });
  check('the main admin cannot bring a list into a chapter that has not asked', r.status === 403 && r.data.needsChapterRequest === true, r.data);
  r = await upload('admin', 'Name\nSomeone From Above\n', 'import');
  check('nor into no chapter in particular', r.status === 403 && !fakeModels.ShepherdingRecord._docs.some(x => x.name === 'Someone From Above'), r.data);
  r = await call('admin', 'POST', `/api/shepherd/records/${kofiRecordId}/link`, { memberId: kofiAccount }, { 'X-Chapter-Id': 'knust' });
  check('nor link its people to accounts', r.status === 403 && r.data.needsChapterRequest === true, r.data);

  console.log(failures ? `\n${failures} FAILURES` : '\nall shepherd-list checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
