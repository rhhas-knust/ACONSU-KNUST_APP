/* ============================================================
   My Account: the page every leader has for their own sign-in.
   Who the account is, when its term ends, and changing the password.
   Shared by every portal (executive, coordinator, finance, shepherding,
   publicity, welfare, national, council), so it stands on its own: it needs
   only main.js and portal.js, and everything lives inside PortalAccount.
   ============================================================ */
window.PortalAccount = (function () {
  const esc = (v) => escapeHtml(String(v == null ? '' : v));
  const MIN = 8;

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

  // A line at the top of a leader's first page while they are still on the
  // password someone else chose, with a way straight to changing it.
  async function nudge(el) {
    try {
      const a = await fetchJSON('/api/portal/account');
      if (!a.editable || !a.usingStartingPassword) return;
      const note = document.createElement('div');
      note.className = 'of-notice warn';
      note.setAttribute('role', 'status');
      note.innerHTML = `<strong>You are still using the starting password.</strong> Your Chapter Coordinator chose it, so they know it. <button type="button" class="link-btn">Choose your own now</button>`;
      note.querySelector('button').addEventListener('click', () => openPanel('account'));
      el.insertBefore(note, el.firstChild);
    } catch (e) { /* the page is fine without the reminder */ }
  }

  return { render, nudge };
})();
