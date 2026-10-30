// Giving (Phase 6): anyone can give, with or without an account. The chapter's
// own account is shown, the giver says what they sent and from which number,
// gets a receipt and a link to it, and Finance (or Welfare, for tithe)
// confirms what actually arrived. Manual only: no payment provider is used.
// The provider's side (webhooks) is checked with a stand-in provider that
// exists only in this test.
//
//   node test/giving.js     (also run by `npm test`)
const crypto = require('crypto');
const { fakeModels } = require('./harness.js');
const payments = require('../lib/payments');

(async () => {
  process.env.MONGODB_URI = 'mongodb://stub/aconsu_giving';
  process.env.PORT = '4348';
  process.env.ADMIN_USERNAME = 'admin';
  process.env.ADMIN_PASSWORD = 'admin123';
  process.env.SESSION_SECRET = 'test';
  process.env.LOGIN_RATE_LIMIT_MAX = '300';
  process.env.GIVING_GUEST_LIMIT_MAX = '50';
  ['SHEPHERD_USERNAME', 'MNOTIFY_API_KEY', 'SMS_SENDER_ID', 'PAYMENT_PROVIDER', 'PAYMENT_MODE'].forEach(k => delete process.env[k]);

  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 500)}` : ''}`); }
  }
  // The SMS provider, answered here.
  const texts = [];
  const passOn = global.fetch;
  global.fetch = (url, opts) => {
    if (String(url).startsWith('https://apps.mnotify.net/')) {
      const q = new URL(String(url)).searchParams;
      texts.push({ to: q.get('to'), msg: q.get('msg') });
      return Promise.resolve(new Response('1000', { status: 200 }));
    }
    return passOn(url, opts);
  };
  const settle = () => new Promise(r => setTimeout(r, 80));

  console.log('\n== how giving is paid ==');
  check('manual, unless the server says otherwise', payments.current({}).name === 'manual' && payments.mode({}) === 'manual');
  check('a provider the app does not have is not used: giving stays manual, and it says so', payments.current({ PAYMENT_PROVIDER: 'paystack' }).name === 'manual' && /stays manual/.test(payments.problem({ PAYMENT_PROVIDER: 'paystack' })));
  check('the manual way takes no notifications from outside', payments.manual.verifyWebhook({ rawBody: Buffer.from('{}'), headers: {} }) === false && !payments.manual.takesWebhooks);

  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4348';
  const jars = {};
  async function call(jar, method, p, body, headers) {
    const h = { ...(headers || {}) };
    if (jar && jars[jar]) h.cookie = jars[jar];
    let payload = body;
    if (body && !(body instanceof Buffer) && typeof body !== 'string') { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + p, { method, headers: h, body: payload });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (jar && sc.length) jars[jar] = sc.map(c => c.split(';')[0]).join('; ');
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: res.status, data };
  }
  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  for (const [id, name] of [['aconsu-knust', 'KNUST'], ['aconsu-ucc', 'UCC']]) {
    await call('admin', 'POST', '/api/national/chapters', { id, name: `ACONSU ${name}`, institution: name });
  }
  const knust = fakeModels.Chapter._docs.find(c => c.id === 'aconsu-knust');
  knust.payment = { provider: 'MoMo', momoNumber: '0240000001', momoName: 'ACONSU KNUST', welfareMomoNumber: '0240000002', welfareMomoName: 'ACONSU Welfare', bankName: '', bankAccountName: '', bankAccountNumber: '' };
  knust.sms = { apiKey: 'knust-key', senderId: 'ACONSU' };
  const fd = new FormData();
  Object.entries({ name: 'Fin Lead', email: 'fin@example.com', password: 'secret123', chapterId: 'aconsu-knust', consent: 'true' }).forEach(([k, v]) => fd.append(k, v));
  const finMember = (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd })).json()).member.id;
  await call('admin', 'POST', '/api/admin/staff', { username: 'fin.knust', name: 'Fin Lead', role: 'finance', password: 'Counting-Faithfully-26', chapterId: 'aconsu-knust', memberId: finMember });
  const fd2 = new FormData();
  Object.entries({ name: 'Wel Lead', email: 'wel@example.com', password: 'secret123', chapterId: 'aconsu-knust', consent: 'true' }).forEach(([k, v]) => fd2.append(k, v));
  const welMember = (await (await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd2 })).json()).member.id;
  await call('admin', 'POST', '/api/admin/staff', { username: 'wel.knust', name: 'Wel Lead', role: 'welfare', password: 'Counting-Faithfully-26', chapterId: 'aconsu-knust', memberId: welMember });
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; });
  await call('fin', 'POST', '/api/portal/login', { username: 'fin.knust', password: 'Counting-Faithfully-26' });
  await call('wel', 'POST', '/api/portal/login', { username: 'wel.knust', password: 'Counting-Faithfully-26' });

  console.log('\n== where to give, for anyone ==');
  let r = await call(null, 'GET', '/api/giving/info?chapterId=aconsu-knust');
  check('the chapter\'s own account, and Welfare\'s for tithe', r.status === 200 && r.data.configured && r.data.general.momoNumber === '0240000001' && r.data.welfare.momoNumber === '0240000002' && r.data.mode === 'manual', r.data);
  check('and none of its other settings (no SMS key)', !JSON.stringify(r.data).includes('knust-key'));
  r = await call(null, 'GET', '/api/giving/info?chapterId=aconsu-ucc');
  check('a chapter that has not set giving up says so', r.status === 200 && r.data.configured === false);

  console.log('\n== giving without an account ==');
  const give = (body) => call(null, 'POST', '/api/giving/guest', { chapterId: 'aconsu-knust', name: 'Kwame Visitor', payerNumber: '024 555 1234', payerNetwork: 'mtn', amount: '50', purpose: 'offertory', consent: true, ...body });
  r = await give({ name: '' });
  check('a name is needed', r.status === 400);
  r = await give({ amount: '-5' });
  check('and an amount that is an amount', r.status === 400);
  r = await give({ amount: '999999' });
  check('within reason', r.status === 400);
  r = await give({ payerNumber: '12' });
  check('and the number it was sent from', r.status === 400);
  r = await give({ consent: false });
  check('and agreement to keep them with the gift', r.status === 400);
  r = await give({ chapterId: 'aconsu-ucc' });
  check('not to a chapter that has not set giving up', r.status === 400);
  r = await give({ website: 'http://spam' });
  check('a form filled in by a script is thanked, and nothing kept', r.status === 200 && r.data.receipt === null && fakeModels.GivingIntent._docs.length === 0);
  r = await give({ reference: 'MP2410.1234' });
  const offering = fakeModels.GivingIntent._docs.find(g => g.memberName === 'Kwame Visitor');
  check('a gift is recorded, as a guest\'s, with the number and network', r.status === 200 && offering && offering.source === 'guest' && offering.memberId === '' && offering.payerNumber === '024 555 1234' && offering.payerNetwork === 'mtn' && offering.status === 'pending', offering);
  const token = r.data.receipt && r.data.receipt.token;
  check('and the receipt comes back at once, with a link of its own', /^[A-Za-z0-9_-]{20,}$/.test(token || '') && r.data.receipt.status === 'pending' && r.data.receipt.firstName === 'Kwame' && r.data.nextStep.momoNumber === '0240000001', r.data);
  r = await call(null, 'GET', `/api/giving/receipt/${token}`);
  check('the link shows where it stands, and not the number it came from', r.status === 200 && r.data.status === 'pending' && r.data.amount === 50 && !JSON.stringify(r.data).includes('555'), r.data);
  r = await call(null, 'GET', '/api/giving/receipt/not-a-real-receipt-token-xx');
  check('a link that is not one shows nothing', r.status === 404);
  r = await give({ purpose: 'tithe', name: 'Ama Tithe', payerNumber: '0205551111' });
  const tithe = fakeModels.GivingIntent._docs.find(g => g.memberName === 'Ama Tithe');
  check('a tithe is told to send to Welfare\'s account', r.data.nextStep.toWelfare === true && r.data.nextStep.momoNumber === '0240000002');

  console.log('\n== Finance and Welfare confirm what arrived ==');
  r = await call('fin', 'GET', '/api/finance/giving-queue');
  check('the guest\'s offering is in Finance\'s queue, marked as a guest\'s', r.data.some(g => g.id === offering.id && g.source === 'guest' && g.payerNumber), r.data);
  check('the tithe is not (it is Welfare\'s)', !r.data.some(g => g.id === tithe.id));
  texts.length = 0;
  r = await call('fin', 'PATCH', `/api/finance/giving/${offering.id}/confirm`, { receivedOn: new Date().toISOString().slice(0, 10), amountReceived: 'abc' });
  check('an amount received that is not an amount is refused', r.status === 400);
  r = await call('fin', 'PATCH', `/api/finance/giving/${offering.id}/confirm`, { receivedOn: new Date().toISOString().slice(0, 10), amountReceived: '45' });
  await settle();
  const entry = fakeModels.FinanceEntry._docs.find(e => e.id === r.data.entry && r.data.entry.id) || fakeModels.FinanceEntry._docs.find(e => /Kwame Visitor/.test(e.description));
  check('the books hold what arrived (45), not what was typed (50)', r.status === 200 && entry && entry.amount === 45 && /no account/.test(entry.description), entry);
  check('the gift keeps both', fakeModels.GivingIntent._docs.find(g => g.id === offering.id).amountReceived === 45);
  check('and the guest gets a receipt by text, on the chapter\'s own account', texts.length === 1 && texts[0].to === '233245551234' && /received your GH₵ 45\.00 offering/.test(texts[0].msg) && texts[0].msg.includes(`/give.html?receipt=${token}`), texts);
  r = await call(null, 'GET', `/api/giving/receipt/${token}`);
  check('the receipt link now says it was received, and how much', r.data.status === 'confirmed' && r.data.amountReceived === 45 && r.data.receivedOn, r.data);
  r = await call('wel', 'GET', '/api/welfare/giving-queue');
  check('the tithe is in Welfare\'s queue', r.data.some(g => g.id === tithe.id));
  texts.length = 0;
  r = await call('wel', 'PATCH', `/api/welfare/giving/${tithe.id}/reject`, { notes: 'Nothing from that number this week.' });
  await settle();
  check('turned down, the guest is told by text too', r.status === 200 && texts.length === 1 && /could not find your GH₵ 50\.00 tithe/.test(texts[0].msg), texts);
  r = await call(null, 'GET', `/api/giving/receipt/${tithe.receiptToken}`);
  check('and the receipt says why', r.data.status === 'rejected' && /Nothing from that number/.test(r.data.note), r.data);
  r = await give({ name: 'Yaw Ucc', chapterId: 'aconsu-knust', payerNumber: '+44 7700 900123' });
  check('a number from another country is refused (it cannot get a receipt)', r.status === 400);

  console.log('\n== members ==');
  await call('ama', 'POST', '/api/auth/register', { name: 'Ama Member', phone: '0201234567', chapterId: 'aconsu-knust', password: 'secret123', consent: 'true' });
  r = await call('ama', 'POST', '/api/giving/intents', { amount: '20', purpose: 'harvest', payerNumber: '0201234567', payerNetwork: 'telecel' });
  check('a member\'s gift is theirs, with the number and network', r.status === 200 && r.data.item.source === 'member' && r.data.item.payerNetwork === 'telecel' && r.data.item.memberId);

  console.log('\n== a payment provider, later (a stand-in, here only) ==');
  r = await call(null, 'POST', '/api/payments/webhook/manual', '{}', { 'content-type': 'application/json' });
  check('the manual way accepts nothing from outside', r.status === 404);
  const SECRET = 'whsec_test_only';
  payments.register({
    name: 'standin', takesWebhooks: true,
    createCharge: () => ({ kind: 'redirect' }),
    verifyWebhook: ({ rawBody, headers }) => {
      const want = crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
      const got = String(headers['x-standin-signature'] || '');
      return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
    },
    parseEvent: ({ rawBody }) => { const d = JSON.parse(rawBody.toString('utf8')); return { providerRef: d.reference, status: d.status, amount: d.amount, currency: d.currency, chapterId: d.chapterId }; }
  });
  const intent = (id, amount, extra) => fakeModels.GivingIntent.create({ id, chapterId: 'aconsu-knust', memberId: '', memberName: 'Online Giver', source: 'guest', amount, purpose: 'offertory', status: 'pending', provider: 'standin', providerRef: `ref_${id}`, needsReview: false, ...(extra || {}) });
  await intent('on1', 30); await intent('on2', 30); await intent('on3', 30);
  const send = (event, sign = true) => {
    const raw = JSON.stringify(event);
    return call(null, 'POST', '/api/payments/webhook/standin', raw, { 'content-type': 'application/json', 'x-standin-signature': sign ? crypto.createHmac('sha256', SECRET).update(raw).digest('hex') : 'nope' });
  };
  r = await send({ reference: 'ref_on1', status: 'paid', amount: 30, currency: 'GHS', chapterId: 'aconsu-knust' }, false);
  check('a notification with the wrong signature is refused, and changes nothing', r.status === 401 && fakeModels.GivingIntent._docs.find(g => g.id === 'on1').status === 'pending');
  r = await send({ reference: 'ref_nobody', status: 'paid', amount: 30, currency: 'GHS' });
  check('a reference the app never gave out is refused', r.status === 404);
  r = await send({ reference: 'ref_on1', status: 'paid', amount: 30, currency: 'GHS', chapterId: 'aconsu-ucc' });
  check('one for another chapter is refused', r.status === 400 && fakeModels.GivingIntent._docs.find(g => g.id === 'on1').status === 'pending');
  const before = fakeModels.FinanceEntry._docs.length;
  r = await send({ reference: 'ref_on1', status: 'paid', amount: 30, currency: 'GHS', chapterId: 'aconsu-knust' });
  const online = fakeModels.FinanceEntry._docs.find(e => e.reference === 'ref_on1');
  check('a genuine one: the gift is confirmed, and the books get it as pending, marked online, for a person to approve', r.status === 200
    && fakeModels.GivingIntent._docs.find(g => g.id === 'on1').status === 'confirmed' && online && online.approvalStatus === 'pending' && online.source === 'online' && online.amount === 30, online);
  r = await send({ reference: 'ref_on1', status: 'paid', amount: 30, currency: 'GHS', chapterId: 'aconsu-knust' });
  check('the same notification again (providers retry) records nothing more', r.status === 200 && r.data.already && fakeModels.FinanceEntry._docs.length === before + 1);
  r = await send({ reference: 'ref_on2', status: 'paid', amount: 3, currency: 'GHS', chapterId: 'aconsu-knust' });
  const odd = fakeModels.GivingIntent._docs.find(g => g.id === 'on2');
  check('a different amount is never counted: it waits for a person', r.status === 200 && odd.status === 'pending' && odd.needsReview && /not GH₵ 30\.00/.test(odd.reviewNotes) && fakeModels.FinanceEntry._docs.length === before + 1, odd);
  r = await send({ reference: 'ref_on3', status: 'failed', amount: 30, currency: 'GHS', chapterId: 'aconsu-knust' });
  check('a failed payment is marked so', fakeModels.GivingIntent._docs.find(g => g.id === 'on3').status === 'rejected');

  console.log('\n== payments setup, for the chapter admin ==');
  r = await call('admin', 'GET', '/api/admin/payments-setup');
  check('manual, with nothing to connect', r.status === 200 && r.data.provider === 'manual' && r.data.mode === 'manual' && r.data.webhookUrl === '', r.data);
  process.env.PAYMENT_PROVIDER = 'standin';
  r = await call('admin', 'GET', '/api/admin/payments-setup');
  check('with a provider: the address to paste into it, built from the app\'s own address, in sandbox', r.data.provider === 'standin' && r.data.mode === 'sandbox' && r.data.webhookUrl === `${BASE}/api/payments/webhook/standin`, r.data);
  process.env.PAYMENT_MODE = 'live';
  r = await call('admin', 'GET', '/api/admin/payments-setup');
  check('live only when PAYMENT_MODE=live is set on purpose', r.data.mode === 'live');
  delete process.env.PAYMENT_PROVIDER; delete process.env.PAYMENT_MODE;
  r = await call('fin', 'GET', '/api/admin/payments-setup');
  check('not for Finance (the chapter admin\'s)', r.status === 401 || r.status === 403, r.status);
  r = await call(null, 'GET', '/api/health');
  check('and the health report says giving is manual', r.data.giving && r.data.giving.provider === 'manual');

  console.log(failures ? `\n${failures} FAILURES` : '\nall giving checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
