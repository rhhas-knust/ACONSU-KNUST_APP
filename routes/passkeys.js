// Signing in with a fingerprint or a face: passkeys (WebAuthn).
//
// A passkey belongs to the person (the member), like their app password, so
// one set up on a phone signs them in to the app and to their office's portal.
// The phone keeps the private half and asks for the fingerprint or face before
// it will use it; this server keeps only the public half, and checks each
// sign-in was signed by it. Nothing is sent to any other company.
//
// Setting one up needs the person already signed in (their profile in the app,
// or My Account in a portal). For a portal, a passkey stands in for both the
// password and the second step: it is something they have (the phone) unlocked
// by something they are (the fingerprint or face), and user verification is
// required, so a phone that merely holds it is not enough.
//
// The address the passkey was made for is part of it: one made on
// aconsu-knust-app.onrender.com does not work on a new web address. After a
// move, people set one up again.

const { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } = require('@simplewebauthn/server');
const { isoBase64URL, isoUint8Array } = require('@simplewebauthn/server/helpers');
const crypto = require('crypto');
const baseUrl = require('../lib/baseUrl');

const CHALLENGE_MS = 5 * 60 * 1000;
const MAX_PER_PERSON = 10;
const RP_NAME = 'ACONSU';

function registerPasskeyRoutes(app, deps) {
  const {
    models, loginLimiter, freshSession, currentStaff, startStaffSession, officeOpenedBy,
    chosenChapter, fitsChosenChapter, WRONG_CHAPTER, secondStep, restingMessage
  } = deps;

  // The web addresses passkeys are made for: the app's chosen address and
  // Render's own; on a developer's machine, whatever it is reached on.
  // Never built from what the request says its address is, in production
  // (baseUrl.forLinks only falls back to it on a developer's machine).
  function origins(req) {
    const list = [baseUrl.clean(process.env.PUBLIC_BASE_URL), baseUrl.clean(process.env.RENDER_EXTERNAL_URL), baseUrl.forLinks(req)].filter(Boolean);
    return [...new Set(list)];
  }
  function siteFor(req) {
    const all = origins(req);
    // Of the allowed addresses, the one this visit is on; the hostname only
    // chooses between them, it never adds one.
    const origin = all.find((o) => new URL(o).hostname === req.hostname) || all[0];
    return { origin, rpID: origin ? new URL(origin).hostname : '', all, rpIDs: [...new Set(all.map((o) => new URL(o).hostname))] };
  }
  const deviceNameOf = (req) => {
    const ua = String(req.get('user-agent') || '');
    const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows computer' : 'Device';
    const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
    return browser ? `${os}, ${browser}` : os;
  };
  // Who is setting one up: the member signed in to the app, or the member
  // behind the office signed in to a portal.
  async function whoIsSignedIn(req) {
    const staff = currentStaff(req);
    const memberId = (req.session && req.session.memberId) || (staff && staff.memberId) || '';
    if (!memberId) return null;
    return models.Member.findOne({ id: memberId }).lean();
  }
  const fresh = (stash) => stash && Date.now() - stash.at < CHALLENGE_MS;

  // ---------- setting one up ----------
  app.post('/api/passkeys/register/options', async (req, res) => {
    try {
      const member = await whoIsSignedIn(req);
      if (!member) return res.status(401).json({ error: 'Sign in first, then set up fingerprint or face sign-in.' });
      const site = siteFor(req);
      if (!site.origin) return res.status(503).json({ error: 'The app\'s web address is not set, so a passkey cannot be made yet.' });
      const have = await models.Passkey.find({ memberId: member.id }).lean();
      if (have.length >= MAX_PER_PERSON) return res.status(400).json({ error: `You have ${MAX_PER_PERSON} already. Remove one you no longer use first.` });
      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: site.rpID,
        userID: isoUint8Array.fromUTF8String(member.id),
        userName: member.email || member.phone || member.name,
        userDisplayName: member.name,
        attestationType: 'none',
        excludeCredentials: have.map((k) => ({ id: k.credentialId, transports: k.transports })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        supportedAlgorithmIDs: [-7, -257]
      });
      req.session.passkeySetup = { challenge: options.challenge, memberId: member.id, at: Date.now() };
      res.json(options);
    } catch (e) { res.status(500).json({ error: 'Could not start setting it up. Please try again.' }); }
  });

  app.post('/api/passkeys/register/verify', async (req, res) => {
    try {
      const stash = req.session && req.session.passkeySetup;
      const member = await whoIsSignedIn(req);
      if (!member || !fresh(stash) || stash.memberId !== member.id) return res.status(400).json({ error: 'That took too long. Try again.' });
      delete req.session.passkeySetup;
      const site = siteFor(req);
      let out;
      try {
        out = await verifyRegistrationResponse({
          response: req.body && req.body.response,
          expectedChallenge: stash.challenge,
          expectedOrigin: site.all,
          expectedRPID: site.rpIDs,
          requireUserVerification: true
        });
      } catch (e) { return res.status(400).json({ error: 'Your phone\'s answer could not be checked. Try again.' }); }
      if (!out.verified || !out.registrationInfo) return res.status(400).json({ error: 'It was not set up. Try again.' });
      const cred = out.registrationInfo.credential;
      if (await models.Passkey.findOne({ credentialId: cred.id }).lean()) return res.status(409).json({ error: 'This one is set up already.' });
      const name = String((req.body && req.body.deviceName) || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60) || deviceNameOf(req);
      const key = await models.Passkey.create({
        id: `pk_${crypto.randomUUID()}`, memberId: member.id, credentialId: cred.id,
        publicKey: isoBase64URL.fromBuffer(cred.publicKey), counter: cred.counter || 0,
        transports: (req.body.response && req.body.response.response && req.body.response.response.transports) || cred.transports || [],
        rpId: site.rpID, deviceName: name
      });
      res.json({ success: true, item: { id: key.id, deviceName: key.deviceName, createdAt: key.createdAt } });
    } catch (e) { res.status(500).json({ error: 'Could not save it. Please try again.' }); }
  });

  app.get('/api/passkeys', async (req, res) => {
    const member = await whoIsSignedIn(req).catch(() => null);
    if (!member) return res.status(401).json({ error: 'Not signed in' });
    const keys = await models.Passkey.find({ memberId: member.id }).lean();
    res.json(keys.map((k) => ({ id: k.id, deviceName: k.deviceName, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
  });

  app.delete('/api/passkeys/:id', async (req, res) => {
    try {
      const member = await whoIsSignedIn(req);
      if (!member) return res.status(401).json({ error: 'Not signed in' });
      const r = await models.Passkey.deleteOne({ id: req.params.id, memberId: member.id });
      if (!r.deletedCount) return res.status(404).json({ error: 'Not found' });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Could not remove it' }); }
  });

  // ---------- signing in ----------
  app.post('/api/passkeys/login/options', loginLimiter, async (req, res) => {
    try {
      const site = siteFor(req);
      if (!site.origin) return res.status(503).json({ error: 'Fingerprint and face sign-in is not available yet.' });
      // No list of keys: the phone offers the ones it holds for this site, so
      // nobody has to type who they are first.
      const options = await generateAuthenticationOptions({ rpID: site.rpID, userVerification: 'required', allowCredentials: [] });
      req.session.passkeySignIn = { challenge: options.challenge, at: Date.now() };
      res.json(options);
    } catch (e) { res.status(500).json({ error: 'Could not start. Please try again.' }); }
  });

  app.post('/api/passkeys/login/verify', loginLimiter, async (req, res) => {
    try {
      const stash = req.session && req.session.passkeySignIn;
      if (!fresh(stash)) return res.status(400).json({ error: 'That took too long. Try again.' });
      delete req.session.passkeySignIn;
      const response = req.body && req.body.response;
      const key = response && typeof response.id === 'string' ? await models.Passkey.findOne({ credentialId: response.id }).lean() : null;
      if (!key) return res.status(401).json({ error: 'This phone\'s fingerprint or face sign-in is not set up for ACONSU, or was removed. Sign in with your password, then set it up again from your profile.' });
      const site = siteFor(req);
      let out;
      try {
        out = await verifyAuthenticationResponse({
          response,
          expectedChallenge: stash.challenge,
          expectedOrigin: site.all,
          expectedRPID: site.rpIDs,
          credential: { id: key.credentialId, publicKey: isoBase64URL.toBuffer(key.publicKey), counter: key.counter || 0, transports: key.transports },
          requireUserVerification: true
        });
      } catch (e) { return res.status(401).json({ error: 'Your phone\'s answer could not be checked. Try again.' }); }
      if (!out.verified) return res.status(401).json({ error: 'That did not work. Try again, or use your password.' });
      await models.Passkey.updateOne({ id: key.id }, { $set: { counter: out.authenticationInfo.newCounter, lastUsedAt: new Date() } });
      const member = await models.Member.findOne({ id: key.memberId }).lean();
      if (!member) return res.status(401).json({ error: 'That account no longer exists.' });

      // Into the app.
      if (!req.body.portal) {
        await freshSession(req);
        req.session.memberId = member.id;
        req.session.issuedAt = Date.now();
        return res.json({ success: true, needsPhoto: !member.profileImageFileId, member: { id: member.id, name: member.name } });
      }
      // Into an office's portal: the same office rules as the app password.
      const found = await officeOpenedBy([member.id], String(req.body.portal).slice(0, 40));
      if (found.error) return res.status(found.status).json({ error: found.error });
      const user = found.user;
      const resting = secondStep.lockedFor(user);
      if (resting) return res.status(429).json({ error: restingMessage(resting) });
      if (!fitsChosenChapter(chosenChapter(req.body), { national: user.role === 'nationalCoordinator', chapterId: user.chapterId })) {
        return res.status(403).json({ error: WRONG_CHAPTER });
      }
      await startStaffSession(req, user);
      // The passkey was both steps (the phone, and the fingerprint or face), so
      // this sign-in is not sent to set up an authenticator app as well.
      req.session.staff.mustSetUpSecondStep = false;
      req.session.staff.viaPasskey = true;
      res.json({ success: true, staff: req.session.staff, mustChangePassword: !!user.mustChangePassword });
    } catch (e) { res.status(500).json({ error: 'Could not sign you in right now. Please try again.' }); }
  });
}

module.exports = { registerPasskeyRoutes };
