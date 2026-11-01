// Giving cards: one for everyone who gives, offerings left out. Finance sees
// a card for each giver to the treasury, Welfare one for each who gives
// tithe, a member their own (tithe included), and someone without an account
// theirs through their receipt link. Confirmed gifts count at what arrived;
// claims still waiting are on the card, marked so; a turned-down claim is not.
//
//   node test/giving-cards.js     (also run by `npm test`)
const { fakeModels } = require('./harness.js');
const givingCards = require('../lib/givingCards');

(async () => {
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/aconsu_cards', PORT: '4357', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 'test', LOGIN_RATE_LIMIT_MAX: '300', GIVING_GUEST_LIMIT_MAX: '50' });
  ['SHEPHERD_USERNAME', 'MNOTIFY_API_KEY', 'SMS_SENDER_ID', 'PAYMENT_PROVIDER', 'PAYMENT_MODE'].forEach(k => delete process.env[k]);

  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 600)}` : ''}`); }
  }

  console.log('\n== the cards, worked out ==');
  const at = (d) => new Date(`${d}T10:00:00Z`);
  const sample = [
    { id: 'a', memberId: 'm1', memberName: 'Kofi Mensah', purpose: 'harvest', status: 'confirmed', amount: 100, amountReceived: 90, receivedOn: '2025-12-02', createdAt: at('2025-12-01') },
    { id: 'b', memberId: 'm1', memberName: 'Kofi Mensah', purpose: 'offertory', status: 'confirmed', amount: 20, amountReceived: 20, receivedOn: '2026-01-05', createdAt: at('2026-01-05') },
    { id: 'c', memberId: 'm1', memberName: 'Kofi Mensah', purpose: 'tithe', status: 'confirmed', amount: 50, receivedOn: '2026-01-06', createdAt: at('2026-01-06') },
    { id: 'd', memberId: 'm1', memberName: 'Kofi Mensah', purpose: 'momo', status: 'pending', amount: 30, createdAt: at('2026-02-01') },
    { id: 'e', memberId: 'm1', memberName: 'Kofi Mensah', purpose: 'other', status: 'rejected', amount: 40, createdAt: at('2026-02-02') },
    { id: 'f', memberId: '', memberName: 'Ama Owusu', payerNumber: '0244111222', purpose: 'harvest', status: 'confirmed', amount: 25, receivedOn: '2026-01-10', createdAt: at('2026-01-10') },
    { id: 'g', memberId: '', memberName: 'Ama O.', payerNumber: '+233 24 411 1222', purpose: 'other', status: 'pending', amount: 10, createdAt: at('2026-01-11') }
  ];
  const all = givingCards.buildCards(sample);
  const kofi = all.find(c => c.memberId === 'm1');
  check('one card per giver: an account is one card, a number one card', all.length === 2 && kofi && all.some(c => c.source === 'guest'), all.map(c => c.key));
  check('no offering on a card, and no turned-down claim', !kofi.gifts.some(g => g.purpose === 'offertory' || g.id === 'e'), kofi.gifts);
  check('a confirmed gift counts at what arrived (90, not 100)', kofi.gifts.find(g => g.id === 'a').amount === 90 && kofi.totals.confirmed === 140, kofi.totals);
  check('a claim still waiting is on the card, marked so, and kept out of the received total', kofi.gifts.find(g => g.id === 'd').status === 'waiting' && kofi.totals.waiting === 30, kofi.totals);
  check('totals by purpose and by year, newest first', JSON.stringify(kofi.byYear) === JSON.stringify([{ year: '2026', total: 50 }, { year: '2025', total: 90 }]) && kofi.byPurpose.some(p => p.purpose === 'tithe' && p.total === 50), { y: kofi.byYear, p: kofi.byPurpose });
  const guestCard = all.find(c => c.source === 'guest');
  check('someone without an account is one card across the ways they wrote the same number, under the name they gave last', guestCard.count === 2 && guestCard.name === 'Ama O.', guestCard);
  check('Finance\'s cards keep only Finance\'s purposes', givingCards.buildCards(sample, { purposes: ['harvest', 'momo', 'other'] }).find(c => c.memberId === 'm1').gifts.every(g => g.purpose !== 'tithe'));

  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4357';
  const jars = {};
  async function call(jar, method, p, body) {
    const h = {};
    if (jar && jars[jar]) h.cookie = jars[jar];
    if (body) h['content-type'] = 'application/json';
    const res = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (jar && sc.length) jars[jar] = sc.map(c => c.split(';')[0]).join('; ');
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: res.status, data };
  }
  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  for (const [id, name] of [['aconsu-knust', 'KNUST'], ['aconsu-ucc', 'UCC']]) await call('admin', 'POST', '/api/national/chapters', { id, name: `ACONSU ${name}`, institution: name });
  for (const c of fakeModels.Chapter._docs) c.payment = { provider: 'MoMo', momoNumber: '0240000001', momoName: 'ACONSU', welfareMomoNumber: '0240000002', welfareMomoName: 'Welfare', bankName: '', bankAccountName: '', bankAccountNumber: '' };
  let n = 0;
  const leader = async (role, chapterId, username) => {
    n += 1;
    const fd = new FormData();
    Object.entries({ name: `Leader ${n}`, email: `lead${n}@example.com`, password: 'secret123', chapterId, consent: 'true', phone: `02099900${String(n).padStart(2, '0')}` }).forEach(([k, v]) => fd.append(k, v));
    const memberId = (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd })).json()).member.id;
    await call('admin', 'POST', '/api/admin/staff', { username, name: `Leader ${n}`, role, password: 'Counting-Faithfully-26', chapterId, memberId });
  };
  await leader('finance', 'aconsu-knust', 'fin.knust');
  await leader('welfare', 'aconsu-knust', 'wel.knust');
  await leader('finance', 'aconsu-ucc', 'fin.ucc');
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; a.mustSetUpSecondStep = false; });
  for (const [jar, username] of [['fin', 'fin.knust'], ['wel', 'wel.knust'], ['finU', 'fin.ucc']]) await call(jar, 'POST', '/api/portal/login', { username, password: 'Counting-Faithfully-26' });

  console.log('\n== a member\'s gifts ==');
  await call('kofi', 'POST', '/api/auth/register', { name: 'Kofi Mensah', phone: '0201234567', chapterId: 'aconsu-knust', password: 'secret123', consent: 'true' });
  const gift = async (purpose, amount) => (await call('kofi', 'POST', '/api/giving/intents', { amount: String(amount), purpose, payerNumber: '0201234567', payerNetwork: 'mtn' })).data.item.id;
  const harvest = await gift('harvest', 100);
  const offering = await gift('offertory', 20);
  const tithe = await gift('tithe', 50);
  await gift('momo', 30);
  const refused = await gift('other', 40);
  const today = new Date().toISOString().slice(0, 10);
  let r = await call('fin', 'PATCH', `/api/finance/giving/${harvest}/confirm`, { receivedOn: today, amountReceived: '90' });
  check('Finance confirms the harvest gift (90 arrived)', r.status === 200, r.data);
  await call('fin', 'PATCH', `/api/finance/giving/${offering}/confirm`, { receivedOn: today, amountReceived: '20' });
  await call('fin', 'PATCH', `/api/finance/giving/${refused}/reject`, { notes: 'Not on the statement.' });
  r = await call('wel', 'POST', `/api/welfare/giving/${tithe}/confirm`, { receivedOn: today, amountReceived: '50' });
  check('Welfare confirms the tithe', r.status === 200, r.data);

  console.log('\n== without an account ==');
  const guest = (body) => call(null, 'POST', '/api/giving/guest', { chapterId: 'aconsu-knust', payerNetwork: 'mtn', consent: true, ...body });
  r = await guest({ name: 'Ama Owusu', payerNumber: '0244111222', amount: '25', purpose: 'harvest' });
  const token = r.data.receiptToken || (fakeModels.GivingIntent._docs.find(g => g.memberName === 'Ama Owusu') || {}).receiptToken;
  await guest({ name: 'Ama Owusu', payerNumber: '024 411 1222', amount: '10', purpose: 'other' });
  await guest({ name: 'Yaw Visitor', payerNumber: '0277000111', amount: '15', purpose: 'offertory' });

  console.log('\n== Finance ==');
  r = await call('fin', 'GET', '/api/finance/giving-cards');
  const cards = r.data.cards || [];
  const kofiCard = cards.find(c => c.name === 'Kofi Mensah');
  check('a card for the member, with the harvest gift as it arrived and the MoMo gift waiting', r.status === 200 && kofiCard && kofiCard.totals.confirmed === 90 && kofiCard.totals.waiting === 30, kofiCard);
  check('no offering, no tithe (Welfare\'s) and no turned-down claim on Finance\'s cards', cards.every(c => c.gifts.every(g => !['offertory', 'tithe'].includes(g.purpose))) && !kofiCard.gifts.some(g => g.id === refused), kofiCard.gifts);
  const amaCard = cards.find(c => c.name === 'Ama Owusu');
  check('one card for the guest, both gifts from the one number, with the number for Finance', amaCard && amaCard.count === 2 && amaCard.source === 'guest' && amaCard.phone, amaCard);
  check('someone who only gave an offering has no card', !cards.some(c => c.name === 'Yaw Visitor'));
  r = await call('finU', 'GET', '/api/finance/giving-cards');
  check('another chapter\'s Finance sees none of this chapter\'s givers', r.status === 200 && r.data.cards.length === 0, r.data);
  r = await call(null, 'GET', '/api/finance/giving-cards');
  check('and nobody signed out sees any', r.status === 401);
  r = await call('kofi', 'GET', '/api/finance/giving-cards');
  check('nor does a member', r.status === 401);

  console.log('\n== Welfare ==');
  r = await call('wel', 'GET', '/api/welfare/giving-cards');
  check('Welfare\'s cards are tithe only', r.status === 200 && r.data.cards.length === 1 && r.data.cards[0].totals.confirmed === 50 && r.data.cards[0].gifts.every(g => g.purpose === 'tithe'), r.data);

  console.log('\n== the giver\'s own ==');
  r = await call('kofi', 'GET', '/api/giving/my-card');
  check('a member\'s own card has everything they gave but the offering, tithe included', r.status === 200 && r.data.totals.confirmed === 140 && r.data.totals.waiting === 30 && !r.data.gifts.some(g => g.purpose === 'offertory'), r.data);
  check('and nothing that is anyone else\'s, nor their number', !JSON.stringify(r.data).includes('Ama') && !('phone' in r.data), r.data);
  r = await call(null, 'GET', '/api/giving/my-card');
  check('signed out, there is no "my card"', r.status === 401);
  r = await call(null, 'GET', `/api/giving/receipt/${token}/card`);
  check('a guest\'s receipt link opens their card: both gifts from their number', r.status === 200 && r.data.count === 2 && r.data.totals.waiting === 35, r.data);
  check('with their first name only, and never the number', r.data.name === 'Ama' && !JSON.stringify(r.data).includes('0244111222') && !JSON.stringify(r.data).includes('244111222'), r.data);
  r = await call(null, 'GET', '/api/giving/receipt/not-a-real-token-at-all-000/card');
  check('a made-up link opens nothing', r.status === 404);

  console.log(failures ? `\n${failures} FAILURES` : '\nall giving card checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
