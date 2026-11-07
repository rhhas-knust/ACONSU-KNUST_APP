// Email: Brevo's web API when BREVO_API_KEY is set (the way that works on
// Render's free plan, which blocks the email ports), SMTP otherwise; a forgot
// password sends the reset link that way; and the main admin's test email
// says why it failed, in words they can act on. Brevo is answered here.
//
//   node test/mailer.js     (also run by `npm test`)
require('./harness.js');

(async () => {
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/aconsu_mail', PORT: '4363', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 'test', LOGIN_RATE_LIMIT_MAX: '300', PUBLIC_BASE_URL: 'https://app.aconsu.org' });
  ['SHEPHERD_USERNAME', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'BREVO_API_KEY', 'MAIL_FROM'].forEach(k => delete process.env[k]);
  const mailer = require('../lib/mailer');

  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 500)}` : ''}`); }
  }

  // Brevo, answered here.
  const sent = [];
  let brevoAnswer = { status: 201, body: { messageId: '<1@brevo>' } };
  const passOn = global.fetch;
  global.fetch = (url, opts) => {
    if (String(url) === 'https://api.brevo.com/v3/smtp/email') {
      sent.push({ headers: opts.headers, body: JSON.parse(opts.body) });
      return Promise.resolve(new Response(JSON.stringify(brevoAnswer.body), { status: brevoAnswer.status, headers: { 'content-type': 'application/json' } }));
    }
    return passOn(url, opts);
  };

  console.log('\n== which way ==');
  check('nothing set: no email, and nothing breaks', mailer.via() === '' && (await mailer.sendMail({ to: 'a@b.co', subject: 's', html: 'h' })).skipped === true);
  check('SMTP details alone: SMTP', mailer.via({ SMTP_HOST: 'smtp-relay.brevo.com', SMTP_USER: 'u', SMTP_PASS: 'p' }) === 'smtp');
  check('a Brevo API key: the web API, even with SMTP details too', mailer.via({ BREVO_API_KEY: 'xkeysib-1', SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p' }) === 'brevo');
  check('MAIL_FROM is read as a name and an address', JSON.stringify(mailer.sender({ MAIL_FROM: 'ACONSU KNUST <noreply@aconsu.org>' })) === JSON.stringify({ name: 'ACONSU KNUST', email: 'noreply@aconsu.org' }) && mailer.sender({ MAIL_FROM: 'noreply@aconsu.org' }).email === 'noreply@aconsu.org');
  check('a blocked port says what to do about it', /BREVO_API_KEY/.test(mailer.explain('smtp', 'Connection timeout')) && /free plan/.test(mailer.explain('smtp', 'connect ETIMEDOUT 1.2.3.4:587')));
  check('a refused SMTP login says it wants the SMTP key, not the API key', /SMTP key, not the API key/.test(mailer.explain('smtp', 'Invalid login: 535 5.7.8 Authentication failed')));

  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4363';
  const jars = {};
  async function call(jar, method, p, body) {
    const h = {};
    if (jar && jars[jar]) h.cookie = jars[jar];
    if (body) h['content-type'] = 'application/json';
    const res = await fetch(BASE + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (jar && sc.length) jars[jar] = sc.map(c => c.split(';')[0]).join('; ');
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }
  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  await call('admin', 'POST', '/api/national/chapters', { id: 'aconsu-knust', name: 'ACONSU-KNUST', institution: 'KNUST' });
  const fd = new FormData();
  fd.append('profileImage', new Blob([Buffer.from('p')], { type: 'image/png' }), 'p.png');
  Object.entries({ name: 'Ama Owusu', email: 'ama@example.com', phone: '0244555666', password: 'secret123', chapterId: 'aconsu-knust', consent: 'true' }).forEach(([k, v]) => fd.append(k, v));
  await fetch(BASE + '/api/auth/register', { method: 'POST', body: fd });

  console.log('\n== the test email, before email is set up ==');
  let r = await call('admin', 'POST', '/api/admin/test-email', { to: 'admin@example.com' });
  check('it says email is not set up, and what to add on Render', r.status === 200 && r.data.sent === false && /BREVO_API_KEY/.test(r.data.error), r.data);
  r = await call(null, 'POST', '/api/admin/test-email', { to: 'admin@example.com' });
  check('nobody signed out can use it (it would send email for anyone)', r.status === 401);

  console.log('\n== with Brevo ==');
  process.env.BREVO_API_KEY = 'xkeysib-test-key';
  process.env.MAIL_FROM = 'ACONSU <noreply@aconsu.org>';
  r = await call(null, 'POST', '/api/auth/forgot-password', { email: 'Ama@Example.com' });
  await new Promise(res => setTimeout(res, 200));
  const reset = sent.find(m => m.body.to[0].email === 'ama@example.com');
  check('forgot password sends the reset link through Brevo\'s web API', r.status === 200 && reset && /reset-password\.html\?token=[0-9a-f]{64}/.test(reset.body.htmlContent) && reset.body.htmlContent.includes('https://app.aconsu.org/'), reset && reset.body);
  check('with the key in Brevo\'s api-key header, and the sender from MAIL_FROM', reset && reset.headers['api-key'] === 'xkeysib-test-key' && reset.body.sender.email === 'noreply@aconsu.org' && reset.body.sender.name === 'ACONSU' && reset.body.subject === 'Reset your ACONSU password');
  const before = sent.length;
  r = await call(null, 'POST', '/api/auth/forgot-password', { email: 'nobody@example.com' });
  check('an address with no account gets the same answer, and nothing is sent', r.status === 200 && /If an account exists/.test(r.data.message) && sent.length === before);
  r = await call('admin', 'POST', '/api/admin/test-email', { to: 'admin@example.com' });
  check('the test email goes through Brevo and says so, with the sender it used', r.data.sent === true && r.data.via === 'brevo' && r.data.from === 'noreply@aconsu.org', r.data);
  check('and never sends the key back', !JSON.stringify(r.data).includes('xkeysib'));

  brevoAnswer = { status: 401, body: { code: 'unauthorized', message: 'Key not found' } };
  r = await call('admin', 'POST', '/api/admin/test-email', { to: 'admin@example.com' });
  check('a wrong key is reported in words: which setting to check', r.data.sent === false && /BREVO_API_KEY/.test(r.data.error) && /401/.test(r.data.error), r.data);
  brevoAnswer = { status: 400, body: { code: 'invalid_parameter', message: 'Sender is not valid' } };
  r = await call('admin', 'POST', '/api/admin/test-email', { to: 'admin@example.com' });
  check('an unverified sender too: verify the MAIL_FROM address in Brevo', r.data.sent === false && /MAIL_FROM/.test(r.data.error) && /verified/.test(r.data.error), r.data);
  r = await call('admin', 'POST', '/api/admin/test-email', { to: 'not-an-address' });
  check('a test needs an address to go to', r.status === 400);

  console.log(failures ? `\n${failures} FAILURES` : '\nall email checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
