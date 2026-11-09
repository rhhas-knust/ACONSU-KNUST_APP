// Fingerprint and face sign-in (passkeys). The phone's own unlock does the
// work: this asks it to make a key for ACONSU, or to sign with one, and passes
// the answer to the server (routes/passkeys.js). Nothing here sees the
// fingerprint or the face; they never leave the phone.
(function () {
  const b64urlToBuf = (s) => {
    const pad = '='.repeat((4 - (s.length % 4)) % 4);
    const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  };
  const bufToB64url = (buf) => {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const post = (url, body) => fetchJSON(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

  function supported() {
    return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create && window.isSecureContext);
  }
  // Is there a fingerprint reader or face unlock on this device itself?
  async function hasBuiltIn() {
    if (!supported()) return false;
    try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch (e) { return false; }
  }

  // The phone said no, or was closed: say so in words.
  function plainError(err) {
    const name = err && err.name;
    if (name === 'NotAllowedError') return new Error('Cancelled, or it took too long. Try again.');
    if (name === 'InvalidStateError') return new Error('This phone is set up already.');
    if (name === 'SecurityError') return new Error('Fingerprint and face sign-in only works on the app\'s own web address.');
    return err instanceof Error ? err : new Error('That did not work. Try again.');
  }

  async function setUp(deviceName) {
    const o = await post('/api/passkeys/register/options');
    let cred;
    try {
      cred = await navigator.credentials.create({ publicKey: {
        ...o,
        challenge: b64urlToBuf(o.challenge),
        user: { ...o.user, id: b64urlToBuf(o.user.id) },
        excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: b64urlToBuf(c.id) }))
      } });
    } catch (err) { throw plainError(err); }
    const r = cred.response;
    return post('/api/passkeys/register/verify', {
      deviceName,
      response: {
        id: cred.id, rawId: bufToB64url(cred.rawId), type: cred.type,
        clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
        authenticatorAttachment: cred.authenticatorAttachment || undefined,
        response: {
          clientDataJSON: bufToB64url(r.clientDataJSON),
          attestationObject: bufToB64url(r.attestationObject),
          transports: r.getTransports ? r.getTransports() : []
        }
      }
    });
  }

  // opts.portal: the office's portal to open (leave out for the app itself);
  // opts.chapterId: the chapter chosen on the sign-in form.
  async function signIn(opts) {
    const o = await post('/api/passkeys/login/options');
    let cred;
    try {
      cred = await navigator.credentials.get({ publicKey: {
        ...o,
        challenge: b64urlToBuf(o.challenge),
        allowCredentials: (o.allowCredentials || []).map((c) => ({ ...c, id: b64urlToBuf(c.id) }))
      } });
    } catch (err) { throw plainError(err); }
    const r = cred.response;
    return post('/api/passkeys/login/verify', {
      ...(opts && opts.portal ? { portal: opts.portal } : {}),
      ...(opts && opts.chapterId ? { chapterId: opts.chapterId } : {}),
      response: {
        id: cred.id, rawId: bufToB64url(cred.rawId), type: cred.type,
        clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
        authenticatorAttachment: cred.authenticatorAttachment || undefined,
        response: {
          clientDataJSON: bufToB64url(r.clientDataJSON),
          authenticatorData: bufToB64url(r.authenticatorData),
          signature: bufToB64url(r.signature),
          userHandle: r.userHandle ? bufToB64url(r.userHandle) : undefined
        }
      }
    });
  }

  // The "Fingerprint or face sign-in" card for a profile or My Account page:
  // the phones and computers set up, and a button to add this one.
  async function renderCard(el) {
    if (!el) return;
    let keys = [];
    // An account with no member behind it (the main admin's own login) has
    // nobody to make a passkey for: no card.
    try { keys = await fetchJSON('/api/passkeys'); } catch (e) { el.innerHTML = ''; return; }
    if (!supported()) {
      el.innerHTML = '<section class="form-card passkey-card"><h2>Fingerprint or face sign-in</h2><p class="muted">This browser cannot do it. Open the app in Chrome, Safari or Edge on your phone to set it up.</p></section>';
      return;
    }
    const built = await hasBuiltIn();
    el.innerHTML = `
      <section class="form-card passkey-card" aria-labelledby="passkeyTitle">
        <h2 id="passkeyTitle">Fingerprint or face sign-in</h2>
        <p class="muted">Sign in to the app, and to your office's portal if you hold one, with this phone's fingerprint or face instead of typing your password. Your fingerprint and face stay on your phone; ACONSU never sees them.</p>
        ${keys.length ? `<ul class="passkey-list">${keys.map((k) => `<li><span><strong>${escapeHtml(k.deviceName || 'Device')}</strong><small class="muted">Set up ${escapeHtml(formatDate(k.createdAt))}${k.lastUsedAt ? `, last used ${escapeHtml(formatDate(k.lastUsedAt))}` : ''}</small></span><button type="button" class="btn btn-outline btn-sm" data-remove-passkey="${escapeHtml(k.id)}">Remove</button></li>`).join('')}</ul>` : ''}
        <button type="button" class="btn btn-primary" id="addPasskeyBtn">${keys.length ? 'Set up on this device too' : 'Set up on this phone'}</button>
        ${built ? '' : '<p class="tiny muted">This device may not have a fingerprint reader or face unlock. It can still use a phone nearby or a security key.</p>'}
        <p class="form-msg" id="passkeyMsg" role="status"></p>
      </section>`;
    const msg = el.querySelector('#passkeyMsg');
    el.querySelector('#addPasskeyBtn').addEventListener('click', async () => {
      msg.textContent = ''; msg.className = 'form-msg';
      try { await setUp(); showToast('Done. Next time, sign in with your fingerprint or face.', 'success'); renderCard(el); }
      catch (err) { msg.textContent = err.message; msg.className = 'form-msg error'; }
    });
    el.querySelectorAll('[data-remove-passkey]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remove fingerprint or face sign-in for this device? You can set it up again.')) return;
      try { await fetchJSON(`/api/passkeys/${encodeURIComponent(b.dataset.removePasskey)}`, { method: 'DELETE' }); renderCard(el); }
      catch (err) { msg.textContent = err.message; msg.className = 'form-msg error'; }
    }));
  }

  // The same, as one row on the profile: "Fingerprint sign-in  On" that opens
  // to the devices and the button. No paragraph to read first.
  const CHEVRON = '<svg class="prow-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  async function renderRow(el) {
    if (!el) return;
    let keys = [];
    try { keys = await fetchJSON('/api/passkeys'); } catch (e) { el.innerHTML = ''; return; }
    const can = supported();
    const built = can ? await hasBuiltIn() : false;
    const value = !can ? 'Not in this browser' : keys.length ? `On, ${keys.length} device${keys.length === 1 ? '' : 's'}` : 'Not set up';
    const wasOpen = !!el.querySelector('details[open]');
    el.innerHTML = `
      <details class="prow-box"${wasOpen ? ' open' : ''}>
        <summary class="prow"><span class="prow-label">Fingerprint sign-in</span><span class="prow-value">${escapeHtml(value)}</span>${CHEVRON}</summary>
        <div class="prow-body">
          ${!can ? '<p class="muted">Open the app in Chrome, Safari or Edge on your phone to set it up.</p>' : `
          ${keys.length ? `<ul class="passkey-list">${keys.map((k) => `<li><span><strong>${escapeHtml(k.deviceName || 'Device')}</strong><small class="muted">Set up ${escapeHtml(formatDate(k.createdAt))}${k.lastUsedAt ? `, last used ${escapeHtml(formatDate(k.lastUsedAt))}` : ''}</small></span><button type="button" class="btn btn-outline btn-sm" data-remove-passkey="${escapeHtml(k.id)}">Remove</button></li>`).join('')}</ul>` : ''}
          <button type="button" class="btn btn-primary" id="addPasskeyBtn">${keys.length ? 'Set up on this device too' : 'Set up on this phone'}</button>
          ${built ? '' : '<p class="tiny muted">This device may not have a fingerprint reader or face unlock.</p>'}
          <p class="form-msg" id="passkeyMsg" role="status"></p>`}
        </div>
      </details>`;
    if (!can) return;
    const msg = el.querySelector('#passkeyMsg');
    el.querySelector('#addPasskeyBtn').addEventListener('click', async () => {
      msg.textContent = ''; msg.className = 'form-msg';
      try { await setUp(); showToast('Done. Next time, sign in with your fingerprint or face.', 'success'); renderRow(el); }
      catch (err) { msg.textContent = err.message; msg.className = 'form-msg error'; }
    });
    el.querySelectorAll('[data-remove-passkey]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Remove fingerprint or face sign-in for this device? You can set it up again.')) return;
      try { await fetchJSON(`/api/passkeys/${encodeURIComponent(b.dataset.removePasskey)}`, { method: 'DELETE' }); renderRow(el); }
      catch (err) { msg.textContent = err.message; msg.className = 'form-msg error'; }
    }));
  }

  window.AconsuPasskey = { supported, hasBuiltIn, setUp, signIn, renderCard, renderRow };
})();
