// Fingerprint and face sign-in (passkeys). A software authenticator stands in
// for the phone: it makes a P-256 key and signs exactly as a phone does, so the
// server's checks run for real. Covered: setting one up (signed in only), signing
// in to the app with it, signing in to an office's portal with it (and the
// second step it stands in for), a signature without the fingerprint or face,
// a replayed or cloned sign-in, a removed passkey, and that it is the person's
// own, from the app or from a portal.
//
//   node test/passkey.js     (also run by `npm test`)
const crypto = require('crypto');
const { fakeModels } = require('./harness.js');
const { isoCBOR } = require('@simplewebauthn/server/helpers');

(async () => {
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/aconsu_passkey', PORT: '4374', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 'test', LOGIN_RATE_LIMIT_MAX: '500' });
  ['SHEPHERD_USERNAME', 'PUBLIC_BASE_URL', 'RENDER_EXTERNAL_URL'].forEach(k => delete process.env[k]);

  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 600)}` : ''}`); }
  }
  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4374';
  const ORIGIN = BASE;
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

  // ---------- a phone, in software ----------
  const b64u = (buf) => Buffer.from(buf).toString('base64url');
  const sha = (b) => crypto.createHash('sha256').update(b).digest();
  function phone() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const credId = crypto.randomBytes(32);
    let counter = 0;
    const cose = isoCBOR.encode(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
    const head = (rpId, flags) => { const c = Buffer.alloc(4); c.writeUInt32BE(counter); return Buffer.concat([sha(rpId), Buffer.from([flags]), c]); };
    return {
      credId,
      create(options, { verified = true } = {}) {
        const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin: ORIGIN }));
        const idLen = Buffer.alloc(2); idLen.writeUInt16BE(credId.length);
        const authData = Buffer.concat([head(options.rp.id, 0x41 | (verified ? 0x04 : 0)), Buffer.alloc(16), idLen, credId, Buffer.from(cose)]);
        const attestationObject = isoCBOR.encode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
        return { id: b64u(credId), rawId: b64u(credId), type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: b64u(clientData), attestationObject: b64u(attestationObject), transports: ['internal'] } };
      },
      get(options, { verified = true, sameCounter = false } = {}) {
        if (!sameCounter) counter += 1;
        const clientData = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: ORIGIN }));
        const authData = head(options.rpId, 0x01 | (verified ? 0x04 : 0));
        const signature = crypto.sign('sha256', Buffer.concat([authData, sha(clientData)]), privateKey);
        return { id: b64u(credId), rawId: b64u(credId), type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: b64u(clientData), authenticatorData: b64u(authData), signature: b64u(signature) } };
      }
    };
  }
  const setUp = async (jar, device, opts) => {
    const o = await call(jar, 'POST', '/api/passkeys/register/options');
    if (o.status !== 200) return o;
    return call(jar, 'POST', '/api/passkeys/register/verify', { response: device.create(o.data, opts), deviceName: 'Test phone' });
  };
  const signIn = async (jar, device, body, opts) => {
    const o = await call(jar, 'POST', '/api/passkeys/login/options');
    return call(jar, 'POST', '/api/passkeys/login/verify', { ...(body || {}), response: device.get(o.data, opts) });
  };

  // ---------- people ----------
  const C = 'aconsu-knust';
  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  await call('admin', 'POST', '/api/national/chapters', { id: C, name: 'ACONSU-KNUST', institution: 'KNUST' });
  async function member(jar, name, email, phoneNo) {
    const f = new FormData();
    f.append('profileImage', new Blob([Buffer.from(name)], { type: 'image/png' }), 'me.png');
    Object.entries({ name, email, phone: phoneNo, password: 'a-good-long-password', chapterId: C, consent: 'true' }).forEach(([k, v]) => f.append(k, v));
    const res = await fetch(BASE + '/api/auth/register', { method: 'POST', body: f });
    jars[jar] = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    return (await res.json()).member.id;
  }
  const abena = await member('abena', 'Abena Mensah', 'abena@example.com', '0244700100');
  const kwame = await member('kwameApp', 'Kwame Asante', 'kwame@example.com', '0244700200');
  await call('admin', 'POST', '/api/admin/staff', { username: 'pres.knust', name: 'Kwame Asante', role: 'executive', positionKey: 'president', password: 'Office-Pass-12345', memberId: kwame, chapterId: C });
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; a.mustSetUpSecondStep = false; });

  console.log('\n== setting one up ==');
  const abenaPhone = phone();
  let r = await setUp(null, abenaPhone);
  check('nobody signed out can set one up', r.status === 401, r.data);
  r = await setUp('abena', abenaPhone, { verified: false });
  check('a phone that did not check the fingerprint or face is refused', r.status === 400, r.data);
  r = await setUp('abena', abenaPhone);
  check('a member sets up fingerprint sign-in from the app', r.status === 200 && r.data.success, r.data);
  r = await call('abena', 'GET', '/api/passkeys');
  check('and sees it listed by device, with no key in the answer', r.status === 200 && r.data.length === 1 && r.data[0].deviceName === 'Test phone' && !JSON.stringify(r.data).includes('publicKey'), r.data);
  const saved = fakeModels.Passkey._docs[0];
  check('only the public half is kept, for that member', saved && saved.memberId === abena && saved.publicKey && !('privateKey' in saved));

  console.log('\n== signing in to the app ==');
  r = await signIn('fresh1', abenaPhone);
  check('the fingerprint signs the member in to the app', r.status === 200 && r.data.success && r.data.member.id === abena, r.data);
  r = await call('fresh1', 'GET', '/api/auth/me');
  check('as themself', r.data.member && r.data.member.id === abena);
  r = await signIn('fresh2', abenaPhone, {}, { verified: false });
  check('a signature without the fingerprint or face is refused', r.status === 401, r.data);
  const o = await call('fresh3', 'POST', '/api/passkeys/login/options');
  const once = abenaPhone.get(o.data);
  r = await call('fresh3', 'POST', '/api/passkeys/login/verify', { response: once });
  check('(a sign-in)', r.status === 200);
  r = await call('fresh3', 'POST', '/api/passkeys/login/verify', { response: once });
  check('the same answer sent twice does not sign in twice', r.status === 400, r.data);
  r = await signIn('fresh4', abenaPhone, {}, { sameCounter: true });
  check('a copied key (its count does not move on) is refused', r.status === 401, r.data);

  console.log('\n== signing in to an office ==');
  r = await call('pres', 'POST', '/api/portal/login', { username: 'pres.knust', password: 'Office-Pass-12345', portal: 'executive' });
  const kwamePhone = phone();
  r = await setUp('pres', kwamePhone);
  check('an executive sets one up from My Account in their portal', r.status === 200, r.data);
  check('and it is theirs as a member, the person, not the office', fakeModels.Passkey._docs.some(k => k.memberId === kwame));
  const presAccount = fakeModels.StaffUser._docs.find(a => a.username === 'pres.knust');
  presAccount.totpEnabledAt = new Date().toISOString();
  r = await signIn('p1', kwamePhone, { portal: 'executive' });
  check('the fingerprint opens the Executive Portal, without the authenticator code: it was both steps', r.status === 200 && r.data.success && r.data.staff.username === 'pres.knust' && !r.data.needsSecondStep, r.data);
  r = await call('p1', 'GET', '/api/portal/me');
  check('the portal opens', r.data.access && r.data.access.executive && r.data.access.executive.view, r.data.access && r.data.access.executive);
  r = await signIn('p2', kwamePhone);
  check('the same fingerprint signs them in to the app too', r.status === 200 && r.data.member.id === kwame, r.data);
  r = await signIn('p3', kwamePhone, { portal: 'finance' });
  check('but not into an office they do not hold', r.status === 403, r.data);
  r = await signIn('p4', abenaPhone, { portal: 'executive' });
  check('and a member with no office gets no portal', r.status === 403, r.data);
  r = await signIn('p5', kwamePhone, { portal: 'executive', chapterId: 'aconsu-ucc' });
  check('nor a chapter that is not theirs', r.status === 403, r.data);
  presAccount.endedAt = new Date().toISOString();
  r = await signIn('p6', kwamePhone, { portal: 'executive' });
  check('an ended term opens nothing', r.status === 403, r.data);
  presAccount.endedAt = null;

  console.log('\n== removing one ==');
  r = await call('kwameApp', 'GET', '/api/passkeys');
  const kwameKey = r.data[0];
  r = await call('abena', 'DELETE', `/api/passkeys/${kwameKey.id}`);
  check('nobody can remove another person\'s', r.status === 404);
  r = await call('kwameApp', 'DELETE', `/api/passkeys/${kwameKey.id}`);
  check('the member removes their own', r.status === 200);
  r = await signIn('p7', kwamePhone);
  check('and that phone no longer signs in, saying how to set it up again', r.status === 401 && /set it up again/.test(r.data.error), r.data);

  console.log(failures ? `\n${failures} FAILURES` : '\nall passkey checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
