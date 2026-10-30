/* ============================================================
   My Account: the page every leader has for their own sign-in.
   Who the account is, when its term ends, and changing the password.
   Shared by every portal (executive, coordinator, finance, shepherding,
   publicity, welfare, national, council), so it stands on its own: it needs
   only main.js and portal.js, and everything lives inside PortalAccount.
   ============================================================ */
window.PortalAccount = (function () {
  const esc = (v) => escapeHtml(String(v == null ? '' : v));
  const MIN = 12;

  const send = (url, body) => fetchJSON(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
  });
  const day = (v) => (typeof shortDate === 'function' ? shortDate(v) : String(v || ''));

  function termLine(a) {
    if (!a.termYear && !a.termEndsAt) return 'No end date. This account is not tied to a year.';
    const ends = a.termEndsAt ? day(a.termEndsAt) : '';
    const left = a.daysLeft !== null && a.daysLeft > 0 ? `, ${a.daysLeft} days left` : '';
    return `${a.termYear || 'This year'}${ends ? `, ends ${ends}${left}` : ''}`;
  }

  // The few things a person can act on while typing. The server has the final
  // say (it also turns away very common passwords), and says why in words.
  function checks(username, current, next, again) {
    const flat = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
    const name = flat(username);
    return [
      [`At least ${MIN} characters`, next.length >= MIN],
      ['Different from your current password', !!next && next !== current],
      ['Does not contain your username', !!next && !(name.length >= 3 && flat(next).includes(name))],
      ['Both new passwords match', !!next && next === again]
    ];
  }

  async function render(el) {
    const a = await fetchJSON('/api/portal/account');
    if (!a.editable) {
      el.innerHTML = `
        <div class="panel-head"><div><h2>My account</h2>
          <p class="sub">${esc(a.name)} (${esc(a.roleLabel)}). This sign-in is set in the server's settings, so its password is changed there, not here.</p></div></div>`;
      return;
    }
    el.innerHTML = `
      <div class="panel-head"><div>
        <h2>My account</h2>
        <p class="sub">Your own sign-in. Your office and your term are set by your Chapter Coordinator. Your password is yours to change.</p>
      </div></div>
      ${a.usingStartingPassword ? `<div class="of-notice warn" role="status"><strong>You are still using the starting password.</strong> Your Chapter Coordinator chose it, so they know it. Choose one of your own below.</div>` : ''}
      <div class="portal-card">
        <h3>Who you are in the system</h3>
        <dl class="of-dl">
          <dt>Name</dt><dd>${esc(a.name)}</dd>
          <dt>Username</dt><dd><code>${esc(a.username)}</code> <span class="muted tiny">what you sign in with</span></dd>
          <dt>${a.office ? 'Office' : 'Role'}</dt><dd>${esc(a.office || a.roleLabel)}${a.department ? `, ${esc(a.department)}` : ''}</dd>
          ${a.chapter ? `<dt>Chapter</dt><dd>${esc(a.chapter.name)}</dd>` : ''}
          <dt>Term</dt><dd>${esc(termLine(a))}</dd>
          <dt>Password</dt><dd>${a.passwordChangedAt ? `Last changed ${esc(day(a.passwordChangedAt))}` : 'Still the starting password'}</dd>
        </dl>
        <p class="tiny muted">When your term ends the account stops working until your Chapter Coordinator renews it or hands the office to the next person.</p>
      </div>
      <div class="portal-card">
        <h3>Change your password</h3>
        <form id="pwForm" novalidate>
          <div class="field"><label for="pwCurrent">Your current password</label>
            <input type="password" id="pwCurrent" autocomplete="current-password" required></div>
          <div class="field"><label for="pwNew">Your new password</label>
            <input type="password" id="pwNew" autocomplete="new-password" required aria-describedby="pwRules">
            <small class="hint">Use a phrase you can remember, with a few words. Anything of ${MIN} characters or more can work; very common passwords are turned away.</small></div>
          <div class="field"><label for="pwAgain">Type the new password again</label>
            <input type="password" id="pwAgain" autocomplete="new-password" required></div>
          <ul class="of-check" id="pwRules" aria-live="polite"></ul>
          <div class="of-actions"><button class="btn btn-primary" type="submit">Change my password</button></div>
          <div class="form-msg" id="pwMsg" role="alert"></div>
        </form>
        <p class="tiny muted">Changing it signs you out of every other phone or computer, so anyone else who had your password loses their way in.</p>
      </div>
      <div class="portal-card" id="secondStepCard" aria-live="polite"></div>
      <div class="portal-card">
        <h3>Signed in somewhere else?</h3>
        <p>If you left a sign-in open on a shared computer, or lost a phone, sign out of everything except this device.</p>
        <div class="of-actions"><button class="btn btn-outline" type="button" id="signOutOthers">Sign out of my other devices</button></div>
        <div class="form-msg" id="othersMsg" role="alert"></div>
      </div>`;

    const form = el.querySelector('#pwForm');
    const val = (id) => form.querySelector(`#${id}`).value;
    const paint = () => {
      const list = checks(a.username, val('pwCurrent'), val('pwNew'), val('pwAgain'));
      form.querySelector('#pwRules').innerHTML = list.map(([label, ok]) =>
        `<li><span class="${ok ? 'of-done' : 'of-todo'}">${ok ? 'Done' : 'Still needed'}</span> ${esc(label)}</li>`).join('');
    };
    form.addEventListener('input', () => { setFormMsg('pwMsg', '', ''); paint(); });
    paint();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const button = form.querySelector('[type="submit"]');
      if (val('pwNew') !== val('pwAgain')) return setFormMsg('pwMsg', 'The two new passwords do not match.', 'error');
      button.disabled = true;
      try {
        await send('/api/portal/password', { currentPassword: val('pwCurrent'), newPassword: val('pwNew') });
        showToast('Password changed. Your other devices have been signed out.', 'success');
        render(el);
      } catch (err) {
        setFormMsg('pwMsg', err.message || 'Could not change your password.', 'error');
        button.disabled = false;
      }
    });

    secondStepCard(el.querySelector('#secondStepCard'));

    el.querySelector('#signOutOthers').addEventListener('click', async (e) => {
      const button = e.currentTarget; // gone by the time the request comes back
      button.disabled = true;
      try {
        await send('/api/portal/sign-out-others');
        setFormMsg('othersMsg', 'Done. Every other device has been signed out.', 'success');
      } catch (err) {
        setFormMsg('othersMsg', err.message || 'Could not do that.', 'error');
      }
      button.disabled = false;
    });
  }

  // ---------- the second step at sign-in ----------
  // A six-digit code from an authenticator app, asked after the password.
  // Server side: routes/second-step.js.
  const stepIntro = 'After your password, the app on your phone (Google Authenticator, Microsoft Authenticator or similar, all free) shows a six-digit code that changes every 30 seconds. Someone who learns your password still cannot get in without your phone.';

  function recoveryList(codes) {
    return `
      <div class="of-notice warn" role="status"><strong>Save these ten recovery codes now.</strong> Each one lets you in once if you lose your phone. Write them down or keep them somewhere safe: they are not shown again.</div>
      <ul class="ss-codes">${codes.map((c) => `<li><code>${esc(c)}</code></li>`).join('')}</ul>
      <div class="of-actions"><button type="button" class="btn btn-outline" data-copy>Copy them</button></div>`;
  }
  function wireCopy(host, codes) {
    const b = host.querySelector('[data-copy]');
    if (!b) return;
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(codes.join('\n')); b.textContent = 'Copied'; } catch (e) { b.textContent = 'Copy did not work: write them down'; }
    });
  }

  // Setting it up, in three steps on one card: password, scan, first code.
  function setupFlow(host, after) {
    host.innerHTML = `
      <h3>Set up your second step</h3>
      <p>${stepIntro}</p>
      <ol class="ss-steps">
        <li>Install an authenticator app on your phone if you do not have one.</li>
        <li>Type your password here, then scan the picture that appears with the app.</li>
        <li>Type the six digits the app shows.</li>
      </ol>
      <form id="ssBegin" novalidate>
        <div class="field"><label for="ssPassword">Your password</label><input type="password" id="ssPassword" autocomplete="current-password" required></div>
        <div class="of-actions"><button class="btn btn-primary" type="submit">Show the code to scan</button></div>
        <div class="form-msg" id="ssMsg" role="alert"></div>
      </form>`;
    host.querySelector('#ssBegin').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('[type="submit"]');
      btn.disabled = true;
      try {
        const r = await send('/api/portal/second-step/begin', { password: host.querySelector('#ssPassword').value });
        host.innerHTML = `
          <h3>Scan this with your authenticator app</h3>
          <img class="ss-qr" src="${r.qr}" alt="A code for your authenticator app to scan" width="240" height="240">
          <p class="tiny muted">Cannot scan it? In the app choose to enter a key and type: <code class="ss-secret">${esc(r.secret)}</code></p>
          <form id="ssConfirm" novalidate>
            <div class="field"><label for="ssCode">The six digits your app shows</label>
              <input type="text" id="ssCode" inputmode="numeric" autocomplete="one-time-code" maxlength="7" pattern="[0-9 ]*" required></div>
            <div class="of-actions"><button class="btn btn-primary" type="submit">Turn it on</button></div>
            <div class="form-msg" id="ssMsg" role="alert"></div>
          </form>`;
        host.querySelector('#ssCode').focus();
        host.querySelector('#ssConfirm').addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const b2 = ev.target.querySelector('[type="submit"]');
          b2.disabled = true;
          try {
            const done = await send('/api/portal/second-step/confirm', { code: host.querySelector('#ssCode').value });
            host.innerHTML = `<h3>Your second step is on</h3>${recoveryList(done.recoveryCodes)}
              <div class="of-actions"><button type="button" class="btn btn-primary" id="ssSaved">I have saved them</button></div>`;
            wireCopy(host, done.recoveryCodes);
            host.querySelector('#ssSaved').addEventListener('click', () => after());
          } catch (err) {
            setFormMsg('ssMsg', err.message, 'error');
            b2.disabled = false;
          }
        });
      } catch (err) {
        setFormMsg('ssMsg', err.message, 'error');
        btn.disabled = false;
      }
    });
  }

  async function secondStepCard(host) {
    if (!host) return;
    let s;
    try { s = await fetchJSON('/api/portal/second-step'); } catch (e) { host.remove(); return; }
    const log = (s.log || []).length ? `
      <details class="ss-log"><summary>What has happened to your sign-in</summary>
        <ul>${s.log.map((l) => `<li>${esc(day(l.at))}: ${esc(l.what)}${l.by && l.by !== 'system' ? `, by ${esc(l.by)}` : ''}</li>`).join('')}</ul></details>` : '';
    if (!s.enrolled) {
      host.innerHTML = `
        <h3>Second step at sign-in</h3>
        ${s.required ? `<div class="of-notice ${s.mustSetUpNow || s.daysLeft !== null ? 'warn' : ''}" role="status">${s.mustSetUpNow
          ? '<strong>Your account needs a second step before it can be used.</strong>'
          : s.daysLeft !== null ? `<strong>Your account needs a second step: ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} left to set it up.</strong> After that, signing in opens only this screen until you do.`
            : '<strong>Your account can reach records that need protecting.</strong> Set up a second step now; it will soon be required.'}</div>` : ''}
        <p>${stepIntro}</p>
        <div class="of-actions"><button type="button" class="btn btn-primary" id="ssStart">Set it up</button></div>${log}`;
      host.querySelector('#ssStart').addEventListener('click', () => setupFlow(host, () => secondStepCard(host)));
      return;
    }
    host.innerHTML = `
      <h3>Second step at sign-in</h3>
      <p><strong>On.</strong> ${s.recoveryCodesLeft} recovery code${s.recoveryCodesLeft === 1 ? '' : 's'} left.${s.recoveryCodesLeft <= 3 ? ' Make new ones soon.' : ''}</p>
      <form id="ssManage" novalidate>
        <div class="field"><label for="ssPw">Your password</label><input type="password" id="ssPw" autocomplete="current-password"></div>
        <div class="field"><label for="ssNow">The six digits your app shows</label><input type="text" id="ssNow" inputmode="numeric" autocomplete="one-time-code" maxlength="7"></div>
        <div class="of-actions">
          <button type="button" class="btn btn-outline" id="ssNewCodes">Make new recovery codes</button>
          ${s.required ? '' : '<button type="button" class="btn btn-outline" id="ssOff">Turn it off</button>'}
        </div>
        <div class="form-msg" id="ssMsg" role="alert"></div>
      </form>
      ${s.required ? '<p class="tiny muted">Your account needs it, so it cannot be turned off. Lost your phone? Use a recovery code to sign in, or ask your Chapter Coordinator to reset it.</p>' : ''}${log}`;
    const both = () => ({ password: host.querySelector('#ssPw').value, code: host.querySelector('#ssNow').value });
    host.querySelector('#ssNewCodes').addEventListener('click', async () => {
      try {
        const r = await send('/api/portal/second-step/recovery-codes', both());
        host.innerHTML = `<h3>New recovery codes</h3><p>The old ones no longer work.</p>${recoveryList(r.recoveryCodes)}
          <div class="of-actions"><button type="button" class="btn btn-primary" id="ssSaved">I have saved them</button></div>`;
        wireCopy(host, r.recoveryCodes);
        host.querySelector('#ssSaved').addEventListener('click', () => secondStepCard(host));
      } catch (err) { setFormMsg('ssMsg', err.message, 'error'); }
    });
    const off = host.querySelector('#ssOff');
    if (off) {
      off.addEventListener('click', async () => {
        try { await send('/api/portal/second-step/off', both()); showToast('Second step turned off.', 'success'); secondStepCard(host); } catch (err) { setFormMsg('ssMsg', err.message, 'error'); }
      });
    }
  }

  // The whole screen, when the account must have a second step and its days
  // are up: nothing else opens until it is set up (portal.js shows this).
  function setupScreen(card, after) {
    card.innerHTML = '';
    const host = document.createElement('div');
    card.appendChild(host);
    setupFlow(host, after);
  }

  // A line at the top of a leader's first page while they are still on the
  // password someone else chose, or still need a second step, with a way
  // straight to fixing it.
  async function nudge(el) {
    try {
      const a = await fetchJSON('/api/portal/account');
      if (!a.editable) return;
      const say = (html) => {
        const note = document.createElement('div');
        note.className = 'of-notice warn';
        note.setAttribute('role', 'status');
        note.innerHTML = html;
        note.querySelector('button').addEventListener('click', () => openPanel('account'));
        el.insertBefore(note, el.firstChild);
      };
      if (a.usingStartingPassword) {
        say('<strong>You are still using the starting password.</strong> Your Chapter Coordinator chose it, so they know it. <button type="button" class="link-btn">Choose your own now</button>');
        return;
      }
      const s = await fetchJSON('/api/portal/second-step');
      if (s.required && !s.enrolled) {
        say(s.daysLeft !== null
          ? `<strong>Set up your second step: ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} left.</strong> <button type="button" class="link-btn">Set it up now</button>`
          : '<strong>Protect your account with a second step at sign-in.</strong> It will soon be required. <button type="button" class="link-btn">Set it up now</button>');
      }
    } catch (e) { /* the page is fine without the reminder */ }
  }

  return { render, nudge, setupScreen };
})();
