// The Financial Secretary and the Treasurer working on their own: their
// accounts, the books the chapter already keeps brought in from a CSV file,
// each Sunday's offering, and the Sundays side by side with their attendance.
//
//   node test/books.js     (also run by `npm test`)
const { fakeModels } = require('./harness.js');
const csvTable = require('../lib/csvTable');
const booksImport = require('../lib/booksImport');

(async () => {
  process.env.MONGODB_URI = 'mongodb://stub/aconsu_books';
  process.env.PORT = '4337';
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
  const plan = (text, existing) => {
    const f = csvTable.readFile(Buffer.from(text));
    return booksImport.planImport(f, booksImport.guessMapping(f.headers), { existing });
  };

  console.log('\n== reading the books ==');
  for (const [raw, want] of [['06/09/2026', '2026-09-06'], ['2026-09-06', '2026-09-06'], ['6 Sept 2026', '2026-09-06'], ['Sep 6, 2026', '2026-09-06'], ['6-Sep-26', '2026-09-06'], ['45000', '2023-03-15']]) {
    check(`the date ${raw} is ${want}`, booksImport.parseDate(raw, 'dmy').value === want, booksImport.parseDate(raw, 'dmy'));
  }
  check('a date with no year is not guessed at', /no year/.test(booksImport.parseDate('6 Sept', 'dmy').error));
  check('31 September is not a date', !booksImport.parseDate('31/09/2026', 'dmy').value);
  for (const [raw, want] of [['GHS 1,200.50', 1200.5], ['GH₵1,200', 1200], ['(200.00)', -200], ['-45.5', -45.5], ['1200', 1200]]) {
    check(`the amount ${raw} is ${want}`, booksImport.parseMoney(raw) === want, booksImport.parseMoney(raw));
  }
  check('words in the amount column are not a number', Number.isNaN(booksImport.parseMoney('two hundred')));
  let p = plan([
    'Date,Particulars,Receipts (GHS),Payments (GHS),Balance',
    '06/09/2026,Sunday offering,"1,250.00",,1250',
    '08/09/2026,Transport for evangelism,,200.00,1050',
    '07/09/2026,Tithe,300,,1350',
    '13/09/2026,Harvest,500,,1850',
    ',Opening balance,,,1000',
    '14/09/2026,Chairs,50,50,',
    '15/09,Offering,20,,'
  ].join('\n'));
  const at = (row) => p.plan.find(x => x.row === row);
  check('a cash book\'s Receipts and Payments are money in and out, and its balance is left out', at(2).entry.entryType === 'income' && at(3).entry.entryType === 'expense', p.plan);
  check('a Sunday offering is the offertory, read from the details when there is no category', at(2).entry.category === 'offertory' && at(5).entry.category === 'harvest', p.plan);
  check('tithe is left out: it is kept in Welfare\'s own book', at(4).action === 'skip' && /Welfare/.test(at(4).reason), at(4));
  check('a row with no date is left out (an opening balance)', at(6).action === 'skip' && /No date/.test(at(6).reason), at(6));
  check('money in and out on one row is left out, and says why', /same row/.test(at(7).reason), at(7));
  check('a date with no year is left out, and says why', /no year/.test(at(8).reason), at(8));
  check('the totals to be added are worked out', p.totals.in === 1750 && p.totals.out === 200 && p.from === '2026-09-06' && p.to === '2026-09-13', p);
  p = plan('Date;Type;Amount;Category;Mode;Received from / paid to\n04/10/2026;Income;GH₵ 980;Offering;MoMo;Congregation\n05/10/2026;Expense;45.50;Printing;Cash;Copy shop\n06/10/2026;;100;Fuel;;\n');
  check('one Amount column with a Type column works, from a semicolon file', p.plan[0].entry.entryType === 'income' && p.plan[0].entry.method === 'momo' && p.plan[1].entry.category === 'Printing' && p.plan[1].entry.payee === 'Copy shop', p.plan);
  check('a row that does not say in or out is left out, and says what to do', /Choose the column/.test(p.plan[2].reason), p.plan[2]);
  p = plan('Date,Amount,Details\n06/09/2026,-20,Water\n');
  check('a negative amount is money out', p.plan[0].entry.entryType === 'expense' && p.plan[0].entry.amount === 20, p.plan);
  p = plan('Date,Details,Money in\n06/09/2026,Offering,100\n06/09/2026,Offering,100\n', [{ date: '2026-09-06', entryType: 'income', amount: 100, description: 'Offering', category: 'offertory', approvalStatus: 'recorded' }]);
  check('an entry already in the books is not added again, but a second identical one is', p.counts.same === 1 && p.counts.add === 1, p.counts);

  // ------------------------------------------------------------------ the app --
  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4337';
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
  const upload = (jar, csv, step, extra) => {
    const fd = new FormData();
    fd.append('file', new Blob([Buffer.from(csv)], { type: 'text/csv' }), 'books.csv');
    fd.append('step', step);
    Object.entries(extra || {}).forEach(([k, v]) => fd.append(k, typeof v === 'string' ? v : JSON.stringify(v)));
    return call(jar, 'POST', '/api/executive/finance/import', fd);
  };
  const offering = (jar, fields, photo = true) => {
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
    if (photo) fd.append('photo', new Blob([Buffer.from('jpeg')], { type: 'image/jpeg' }), 'count.jpg');
    return call(jar, 'POST', '/api/executive/treasury/offering', fd);
  };

  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  const C = 'aconsu-knust';
  await call('admin', 'POST', '/api/national/chapters', { id: C, name: 'ACONSU KNUST', institution: 'KNUST' });
  let n = 0;
  const emails = {};
  async function member(name) {
    n += 1;
    const fd = new FormData();
    fd.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
    emails[name] = `bk${n}@example.com`;
    Object.entries({ name, email: emails[name], password: 'secret123', chapterId: C, consent: 'true' }).forEach(([k, v]) => fd.append(k, v));
    return (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd })).json()).member.id;
  }

  console.log('\n== their accounts ==');
  let r = await call('admin', 'POST', '/api/admin/staff', { role: 'executive', positionKey: 'treasurer', memberId: await member('Kwame Treasurer'), chapterId: C });
  const tr = r.data.issued;
  check('appointing the Treasurer issues the office\'s own login', r.status === 200 && tr && /^treasurer\./.test(tr.username) && tr.password === 'treasurer123', r.data);
  r = await call('admin', 'POST', '/api/admin/staff', { role: 'executive', positionKey: 'financial_secretary', memberId: await member('Abena FinSec'), chapterId: C });
  const fs = r.data.issued;
  check('and the Financial Secretary\'s', r.status === 200 && fs && /^financialsecretary\./.test(fs.username) && fs.password === 'financialsecretary123', r.data);
  await call('admin', 'POST', '/api/admin/staff', { role: 'executive', positionKey: 'president', memberId: await member('Yaw President'), chapterId: C });
  const choir = (await call('admin', 'POST', '/api/admin/departments', { name: 'Choir', tagline: 'x', chapterId: C })).data.item.id;
  await call('admin', 'POST', '/api/admin/staff', { role: 'executive', positionKey: 'music_director', department: choir, memberId: await member('Ama Music'), chapterId: C });
  await call('admin', 'POST', '/api/admin/staff', { username: 'shep', name: 'Shepherding', role: 'shepherding', password: 'Start-Pass-1', memberId: await member('Shep Head'), chapterId: C });
  fakeModels.StaffUser._docs.filter(a => ['shep'].includes(a.username) || /^(president|musicdirector)\./.test(a.username)).forEach(a => { a.mustChangePassword = false; });
  const pres = fakeModels.StaffUser._docs.find(a => /^president\./.test(a.username));
  const music = fakeModels.StaffUser._docs.find(a => /^musicdirector\./.test(a.username));
  r = await call('tr', 'POST', '/api/portal/login', { username: tr.username, password: tr.password });
  check('the Treasurer signs in with it, and is asked to choose a password first', r.status === 200 && r.data.mustChangePassword === true, r.data);
  r = await call('tr', 'GET', '/api/executive/treasury/reports');
  check('until then their work stays shut', r.status === 401, r.data);
  r = await call('tr', 'POST', '/api/portal/first-password', { email: emails['Kwame Treasurer'], newPassword: 'Counted Twice 2026' });
  check('choosing a password opens it', r.status === 200, r.data);
  r = await call('tr', 'GET', '/api/executive/me');
  check('and the portal knows them as the Treasurer', r.data.position && r.data.position.key === 'treasurer' && r.data.position.capabilities.includes('treasury.report'), r.data);
  await call('fs', 'POST', '/api/portal/login', { username: fs.username, password: fs.password });
  r = await call('fs', 'POST', '/api/portal/first-password', { email: emails['Abena FinSec'], newPassword: 'Books Balanced 2026' });
  check('the Financial Secretary the same way', r.status === 200, r.data);
  r = await call('fs', 'GET', '/api/executive/finance/ledger');
  check('and the ledger opens for them', r.status === 200 && Array.isArray(r.data.awaiting), r.data);
  await call('pres', 'POST', '/api/portal/login', { username: pres.username, password: 'president123' });
  await call('music', 'POST', '/api/portal/login', { username: music.username, password: 'musicdirector123' });
  await call('shep', 'POST', '/api/portal/login', { username: 'shep', password: 'Start-Pass-1' });

  console.log('\n== the books brought in ==');
  const BOOKS = [
    'Date,Particulars,Receipts (GHS),Payments (GHS),How,Balance',
    '06/09/2026,Sunday offering,"1,250.00",,Cash,1250',
    '08/09/2026,Transport for evangelism,,200.00,MoMo,1050',
    '07/09/2026,Tithe,300,,Cash,1350',
    '13/09/2026,Harvest,500,,Cash,1850',
    ',Opening balance,,,,1000'
  ].join('\n');
  r = await upload('tr', BOOKS, 'read');
  check('the Treasurer cannot write the books, so cannot bring them in either', r.status === 403, r.data);
  r = await upload('fs', BOOKS, 'read');
  check('the Financial Secretary reads the file, with a guess for each column', r.status === 200 && JSON.stringify(r.data.columns.map(c => c.field)) === JSON.stringify(['date', 'description', 'amountIn', 'amountOut', 'method', 'skip']), r.data.columns);
  const before = fakeModels.FinanceEntry._docs.length;
  r = await upload('fs', BOOKS, 'check');
  check('checking gives the totals to compare with the book, and adds nothing', r.status === 200 && r.data.counts.add === 3 && r.data.totals.in === 1750 && r.data.totals.out === 200 && fakeModels.FinanceEntry._docs.length === before, r.data);
  check('and says why tithe and the opening balance are left out', r.data.notAdding.some(x => /Welfare/.test(x.reason)) && r.data.notAdding.some(x => /No date/.test(x.reason)), r.data.notAdding);
  r = await upload('fs', BOOKS, 'import');
  check('bringing them in adds them to the ledger', r.status === 200 && r.data.done.added === 3, r.data);
  const imported = fakeModels.FinanceEntry._docs.filter(e => e.origin === 'import');
  check('recorded, in this chapter, saying they came from the books kept before', imported.length === 3 && imported.every(e => e.approvalStatus === 'recorded' && e.source === 'finance' && e.chapterId === C && /books kept before/.test(e.recordedBy)), imported);
  check('the offering is the offertory and the transport went by MoMo', imported.some(e => e.category === 'offertory' && e.amount === 1250) && imported.some(e => e.entryType === 'expense' && e.method === 'momo'), imported);
  r = await upload('fs', BOOKS, 'import');
  check('bringing the same books in again adds nothing', r.data.done.added === 0 && r.data.counts.same === 3, r.data.counts);
  r = await upload('fs', BOOKS, 'check', { mapping: ['date', 'description', 'note', 'note', 'method', 'skip'] });
  check('without an amount column, it asks which one it is', r.status === 400 && /amount/.test(r.data.error), r.data);
  r = await call('fs', 'GET', '/api/executive/finance/import/template.csv');
  check('a sample to start from can be downloaded', r.status === 200 && /^Date,Details/.test(r.data), r.data);
  r = await call('fs', 'GET', '/api/executive/finance/ledger');
  check('the ledger shows them', r.data.ledger.filter(e => e.recordedBy && /books kept before/.test(e.recordedBy)).length === 3, r.data.ledger.length);

  console.log('\n== a Sunday\'s offering ==');
  const sunday = '2026-10-18';
  r = await offering('fs', { date: sunday, serviceType: 'sunday', amount: '640' });
  check('the Financial Secretary does not file the offering: the Treasurer holds the money', r.status === 403, r.data);
  r = await offering('tr', { date: sunday, serviceType: 'sunday', amount: '640' }, false);
  check('an offering without a photo of the count is refused, with why', r.status === 400 && /photo/.test(r.data.error), r.data);
  r = await offering('tr', { date: '2099-01-04', serviceType: 'sunday', amount: '640' });
  check('so is a service that has not happened', r.status === 400, r.data);
  r = await offering('tr', { date: sunday, serviceType: 'sunday', amount: '0' });
  check('and an amount of nothing', r.status === 400, r.data);
  r = await offering('tr', { date: sunday, serviceType: 'sunday', amount: '640.50', method: 'cash', countedWith: 'Abena', note: 'Harvest Sunday' });
  const filed = r.data.item;
  check('the Treasurer files the offering, and it waits for the Financial Secretary', r.status === 200 && filed.approvalStatus === 'pending' && filed.category === 'offertory' && filed.amount === 640.5 && filed.serviceDate === sunday && filed.source === 'treasury', r.data);
  check('saying who counted it with them', /counted with Abena/.test(filed.description) && !!filed.receiptFileId, filed);
  r = await offering('tr', { date: sunday, serviceType: 'sunday', amount: '640.50' });
  check('the same service\'s offering cannot be filed twice, and says what to do', r.status === 409 && /send it back/.test(r.data.error), r.data);
  r = await offering('tr', { date: sunday, serviceType: 'midweek', amount: '80' });
  check('the midweek meeting\'s is its own', r.status === 200, r.data);
  r = await call('fs', 'GET', '/api/executive/finance/ledger');
  check('the Financial Secretary sees both waiting', r.data.awaiting.filter(e => e.category === 'offertory').length === 2, r.data.awaiting);
  r = await call('fs', 'PATCH', `/api/executive/finance/ledger/${filed.id}`, { decision: 'record' });
  check('and records the Sunday offering', r.status === 200 && r.data.item.approvalStatus === 'recorded', r.data);
  const midweek = fakeModels.FinanceEntry._docs.find(e => e.serviceType === 'midweek');
  await call('fs', 'PATCH', `/api/executive/finance/ledger/${midweek.id}`, { decision: 'reject', reviewNote: 'Recount, the sheet says 85' });
  r = await offering('tr', { date: sunday, serviceType: 'midweek', amount: '85' });
  check('one sent back can be filed again', r.status === 200, r.data);

  console.log('\n== the Sundays, side by side ==');
  for (const name of ['Kofi', 'Ama', 'Yaw']) await call('shep', 'POST', '/api/attendance/newcomer', { name: `${name} Visitor`, date: sunday });
  await call('shep', 'POST', '/api/shepherd/attendance', { date: sunday, serviceType: 'sunday', rev: (await call('shep', 'GET', `/api/shepherd/attendance/${sunday}?serviceType=sunday`)).data.record.rev, visitorCount: 2, marks: (await call('shep', 'GET', `/api/shepherd/attendance/${sunday}?serviceType=sunday`)).data.record.marks });
  r = await call('tr', 'GET', '/api/executive/finance/sundays');
  const row = r.data.find(s => s.date === sunday && s.serviceType === 'sunday');
  check('the Treasurer sees how many came, with walk-ins, beside the offering recorded', r.status === 200 && row && row.attendance === 5 && row.recorded === 640.5 && row.waiting === 0, r.data);
  const mid = r.data.find(s => s.date === sunday && s.serviceType === 'midweek');
  check('and an offering still waiting, and one sent back', mid && mid.waiting === 85 && mid.sentBack === 1 && mid.attendance === null, mid);
  const old = r.data.find(s => s.date === '2026-09-06');
  check('an offering from the books brought in sits on its Sunday too', old && old.recorded === 1250, r.data);
  check('counts only: nobody\'s name reaches the books', !JSON.stringify(r.data).includes('Visitor'), r.data);
  r = await call('fs', 'GET', '/api/executive/finance/sundays');
  check('the Financial Secretary sees the same', r.status === 200 && r.data.some(s => s.date === sunday), r.data);
  r = await call('pres', 'GET', '/api/executive/finance/sundays');
  check('so does the President, who reads the books', r.status === 200, r.data);
  r = await call('music', 'GET', '/api/executive/finance/sundays');
  check('a department head does not', r.status === 403, r.data);

  console.log(failures ? `\n${failures} FAILURES` : '\nall books checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
