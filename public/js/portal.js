/* ============================================================
   Shared behaviour for the leadership portals.
   Each portal page supplies its own panels; everything else,
   signing in, the shell, the side nav, modals, formatting. Is
   handled here so the four portals stay consistent.
   Requires main.js (fetchJSON, escapeHtml, showToast) first.
   ============================================================ */

const PORTAL = {
  role: '',
  label: '',
  panels: [],
  user: null,
  isAdmin: false,
  canEdit: false,
  active: '',
  chapter: null // {id, name}. Which chapter this account belongs to, if any (see renderPortalChrome)
};

// ---------- formatting ----------
function money(n) {
  const value = Number(n || 0);
  const formatted = Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value < 0 ? '-' : ''}GH₵ ${formatted}`;
}

function shortDate(value) {
  if (!value) return '-';
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (isNaN(d.getTime())) return escapeHtml(String(value));
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function dateTimeLabel(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// The Sunday just gone (or today, if today is Sunday) - the date the
// shepherding team almost always wants when they open the register.
function lastSundayISO() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}

// A datetime-local input needs local time, not the UTC that toISOString gives.
function toLocalInputValue(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------- modal ----------
function showModal(html, wide) {
  const content = document.getElementById('modalContent');
  content.className = wide ? 'modal modal-wide' : 'modal';
  content.innerHTML = html;
  document.getElementById('modalBackdrop').classList.add('open');
  const cancel = document.getElementById('cancelModalBtn');
  if (cancel) cancel.addEventListener('click', closeModal);
}

function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('open');
}

function setFormMsg(id, text, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = `form-msg ${type || ''}`;
}

// ---------- small render helpers shared by the portals ----------
function statCard(label, value, opts) {
  const o = opts || {};
  return `
    <div class="stat-card ${o.tone || ''}">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="value">${o.raw ? value : escapeHtml(String(value))}</div>
      ${o.foot ? `<div class="foot">${escapeHtml(o.foot)}</div>` : ''}
    </div>
  `;
}

function pill(text, tone) {
  return `<span class="pill ${tone || String(text || '').toLowerCase()}">${escapeHtml(String(text || ''))}</span>`;
}

function emptyRow(colspan, message) {
  return `<tr><td colspan="${colspan}"><div class="empty-state">${escapeHtml(message)}</div></td></tr>`;
}

// A dependency-free bar chart. Real charting libraries are lovely, but this app
// ships no bundler and works offline, so a few divs do the job.
function barChart(series, opts) {
  const o = opts || {};
  if (!series.length) return `<p class="empty-state">${escapeHtml(o.emptyMessage || 'Nothing to chart yet.')}</p>`;
  const max = Math.max(...series.map(s => Math.max(s.value || 0, s.value2 || 0)), 1);
  const fmt = o.format || ((v) => v);
  return `
    <div class="bar-chart">
      ${series.map(s => `
        <div class="bar-col">
          <div class="bar-value">${escapeHtml(String(fmt(s.value)))}</div>
          <div class="bar" style="height:${Math.max(3, Math.round((s.value / max) * 120))}px" title="${escapeHtml(s.label)}"></div>
          ${s.value2 !== undefined ? `<div class="bar alt" style="height:${Math.max(3, Math.round((s.value2 / max) * 120))}px" title="${escapeHtml(s.label)}"></div>` : ''}
          <div class="bar-label">${escapeHtml(s.label)}</div>
        </div>
      `).join('')}
    </div>
    ${o.legend ? `<div class="chart-legend">${o.legend.map(l => `<span><i style="background:${l.color}"></i>${escapeHtml(l.label)}</span>`).join('')}</div>` : ''}
  `;
}

// ---------- session ----------
async function refreshPortalSession() {
  try {
    const data = await fetchJSON('/api/portal/me');
    PORTAL.user = data.staff;
    PORTAL.isAdmin = data.isAdmin;
    PORTAL.chapter = data.chapter;
    if (window.ACONSU_BRAND) window.ACONSU_BRAND.use(data.chapter ? data.chapter.id : '');
    const access = (data.access && data.access[PORTAL.role]) || { view: false, edit: false };
    PORTAL.canEdit = access.edit;
    return access.view;
  } catch (e) {
    PORTAL.canEdit = false;
    return false;
  }
}

// The menu on a phone. It lies over the page just under the header, which
// stays put, and scrolls on its own: in the page, scrolling down slid its first
// items under the header, out of reach.
function setPortalMenu(open) {
  const nav = document.getElementById('portalNav');
  const toggle = document.getElementById('portalMenuToggle');
  if (open) {
    const bar = document.querySelector('.portal-topbar');
    if (bar) document.documentElement.style.setProperty('--portal-top', `${Math.round(bar.getBoundingClientRect().bottom)}px`);
  }
  nav.classList.toggle('open', open);
  if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function renderPortalChrome() {
  const user = PORTAL.user;
  const whoLabel = user ? `${user.name} · ${user.role}` : (PORTAL.isAdmin ? 'Signed in as Admin' : '');
  document.getElementById('portalWho').textContent = whoLabel;
  document.getElementById('portalRoleLabel').textContent = PORTAL.label;
  // Which chapter this portal belongs to, front and center in the header -
  // this account's chapter is the identity of the whole portal, not a detail
  // buried in a badge. Pages with no chapter concept of their own (national)
  // simply have no #portalBrandName element, so this is a no-op there.
  const brand = document.getElementById('portalBrandName');
  // A chapter called "ACONSU-KNUST" is not "ACONSU: ACONSU-KNUST": saying it
  // twice wrapped the header onto three lines on a phone.
  const chapterName = PORTAL.chapter ? PORTAL.chapter.name : '';
  if (brand) brand.textContent = !chapterName ? 'ACONSU' : /^aconsu\b/i.test(chapterName) ? chapterName : `ACONSU: ${chapterName}`;

  const nav = document.getElementById('portalNav');
  // A panel can open a group of its own in the menu (`groupLabel`): the
  // Treasurer's money first, then "Everything else".
  nav.innerHTML = PORTAL.panels.map(p => `${p.groupLabel ? `<p class="side-label">${escapeHtml(p.groupLabel)}</p>` : ''}
    <button type="button" data-panel="${p.key}" class="${p.key === PORTAL.active ? 'active' : ''}">${escapeHtml(p.label)}</button>
  `).join('');
  nav.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      openPanel(btn.dataset.panel);
      setPortalMenu(false); // collapse the mobile drawer after a choice
    });
  });

  const main = document.getElementById('portalMain');
  main.innerHTML = PORTAL.panels.map(p => `<div class="portal-panel" id="panel-${p.key}"></div>`).join('')
    + '<div style="text-align:center; padding:24px 12px 8px; font-size:0.75rem; color:var(--ink-faint);">Powered by HasTech Solutions</div>';

  // A coordinator (or anyone else read-only) should be told why the buttons
  // they expect are missing, rather than left wondering.
  if (!PORTAL.canEdit) {
    main.insertAdjacentHTML('afterbegin', `
      <div class="portal-card" style="border-color: var(--flame-gold); background:#FFF8EC;">
        <strong>View-only access.</strong>
        <span class="muted"> You can read everything in this office, but changes are made by the ${escapeHtml(PORTAL.label)} team.</span>
      </div>
    `);
  }
}

async function openPanel(key) {
  const panel = PORTAL.panels.find(p => p.key === key);
  if (!panel) return;
  PORTAL.active = key;
  if (window.AconsuToday) AconsuToday.visited(PORTAL.role, key);
  document.querySelectorAll('#portalNav button').forEach(b => b.classList.toggle('active', b.dataset.panel === key));
  document.querySelectorAll('.portal-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${key}`));
  const el = document.getElementById(`panel-${key}`);
  el.innerHTML = skeletonHtml();
  try {
    await panel.render(el);
  } catch (err) {
    el.innerHTML = `<p class="empty-state">${escapeHtml(err.message || 'Could not load this section.')}</p>`;
  }
}

// The first sign-in with a starting password (president123 and the like). The
// portal shows this one screen and nothing else until the person has chosen a
// password of their own: the server would refuse everything else anyway.
async function showFirstPassword() {
  const wrap = document.getElementById('portalLoginWrap');
  document.getElementById('portalShell').style.display = 'none';
  wrap.style.display = 'flex';
  const loginForm = document.getElementById('portalLoginForm');
  if (loginForm) loginForm.style.display = 'none';
  let account = {};
  try { account = await fetchJSON('/api/portal/account'); } catch (e) { account = {}; }
  const who = PORTAL.user || {};
  let form = document.getElementById('firstPwForm');
  if (!form) {
    form = document.createElement('form');
    form.id = 'firstPwForm';
    form.className = 'portal-login-card';
    form.noValidate = true;
    wrap.appendChild(form);
  }
  form.innerHTML = `
    <img class="mark" src="/images/logo.jpg" alt="ACONSU">
    <h1>Choose your own password</h1>
    <p class="sub">Welcome, ${escapeHtml(account.name || who.name || '')}. You signed in with the starting password${account.office ? ` for ${escapeHtml(account.office)}` : ''}. It follows a pattern others could guess, so before you go on, choose a password only you know.</p>
    ${account.hasMemberEmail ? `
    <div class="field">
      <label for="fpEmail">The email on your member profile</label>
      <input type="email" id="fpEmail" autocomplete="email" required aria-describedby="fpEmailHint">
      <small class="hint" id="fpEmailHint">So we know it is really you who was appointed.</small>
    </div>` : ''}
    <div class="field">
      <label for="fpNew">Your new password</label>
      <input type="password" id="fpNew" autocomplete="new-password" required aria-describedby="fpNewHint">
      <small class="hint" id="fpNewHint">At least 12 characters. A short phrase you will remember works well. Very common passwords are turned away.</small>
    </div>
    <div class="field">
      <label for="fpAgain">Type it again</label>
      <input type="password" id="fpAgain" autocomplete="new-password" required>
    </div>
    <button type="submit" class="btn btn-primary btn-block">Save and continue</button>
    <div class="form-msg" id="fpMsg" role="alert"></div>
    <p class="tiny muted" style="text-align:center; margin-top:16px;">Not you? <button type="button" class="link-btn" id="fpSignOut">Sign out</button></p>`;
  const msg = (text) => setFormMsg('fpMsg', text, 'error');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const next = form.querySelector('#fpNew').value;
    if (next !== form.querySelector('#fpAgain').value) return msg('The two passwords do not match.');
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const emailInput = form.querySelector('#fpEmail');
      await fetchJSON('/api/portal/first-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailInput ? emailInput.value : '', newPassword: next })
      });
      showToast('Your password is set. Welcome.', 'success');
      window.location.reload();
    } catch (err) {
      msg(err.message || 'Could not save your password.');
      button.disabled = false;
    }
  };
  form.querySelector('#fpSignOut').onclick = async () => {
    await fetchJSON('/api/portal/logout', { method: 'POST' }).catch(() => {});
    window.location.reload();
  };
  const first = form.querySelector('input');
  if (first) first.focus();
}

// The leader's account needs a second step at sign-in and their days to set
// it up are over: signing in still works, and opens only this (account.js
// does the setting up).
function showSecondStepSetup() {
  const wrap = document.getElementById('portalLoginWrap');
  document.getElementById('portalShell').style.display = 'none';
  wrap.style.display = 'flex';
  const loginForm = document.getElementById('portalLoginForm');
  if (loginForm) loginForm.style.display = 'none';
  let card = document.getElementById('secondStepSetup');
  if (!card) {
    card = document.createElement('div');
    card.id = 'secondStepSetup';
    card.className = 'portal-login-card';
    wrap.appendChild(card);
  }
  card.innerHTML = `
    <img class="mark" src="/images/logo.jpg" alt="ACONSU">
    <h1>One more step</h1>
    <p class="sub">Your account needs a second step at sign-in before it can be used. It takes two minutes, with your phone.</p>
    <div id="ssHost"></div>
    <p class="tiny muted" style="text-align:center; margin-top:16px;">Not you? <button type="button" class="link-btn" id="ssSignOut">Sign out</button></p>`;
  if (window.PortalAccount) PortalAccount.setupScreen(card.querySelector('#ssHost'), () => window.location.reload());
  card.querySelector('#ssSignOut').onclick = async () => {
    await fetchJSON('/api/portal/logout', { method: 'POST' }).catch(() => {});
    window.location.reload();
  };
}

// After the password, the six digits from their authenticator app, or one of
// their recovery codes. `done` carries on exactly as a password-only sign-in.
function askSecondStep(done) {
  const loginForm = document.getElementById('portalLoginForm');
  loginForm.style.display = 'none';
  let form = document.getElementById('secondStepForm');
  if (!form) {
    form = document.createElement('form');
    form.id = 'secondStepForm';
    form.className = 'portal-login-card';
    form.noValidate = true;
    loginForm.parentNode.appendChild(form);
  }
  let recovery = false;
  const paint = () => {
    form.innerHTML = `
      <img class="mark" src="/images/logo.jpg" alt="ACONSU">
      <h1>${recovery ? 'Use a recovery code' : 'Type the code from your phone'}</h1>
      <p class="sub">${recovery ? 'One of the ten codes you saved when you set up your second step. Each works once.' : 'Open your authenticator app and type the six digits it shows for ACONSU.'}</p>
      <div class="field">
        <label for="ssLoginCode">${recovery ? 'Recovery code' : 'Six-digit code'}</label>
        <input type="text" id="ssLoginCode" ${recovery ? 'autocomplete="off" autocapitalize="characters" spellcheck="false"' : 'inputmode="numeric" autocomplete="one-time-code" maxlength="7"'} required>
      </div>
      <button type="submit" class="btn btn-primary btn-block" id="ssLoginBtn">Sign In</button>
      <div class="form-msg" id="ssLoginMsg" role="alert"></div>
      <p class="tiny muted" style="text-align:center; margin-top:16px;">
        <button type="button" class="link-btn" id="ssToggle">${recovery ? 'Use the code from my phone' : 'Lost your phone? Use a recovery code'}</button>
      </p>`;
    form.querySelector('#ssToggle').onclick = () => { recovery = !recovery; paint(); };
    form.querySelector('#ssLoginCode').focus();
  };
  paint();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('#ssLoginBtn');
    const value = form.querySelector('#ssLoginCode').value;
    btn.disabled = true;
    try {
      const r = await fetchJSON('/api/portal/login/second-step', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recovery ? { recoveryCode: value } : { code: value })
      });
      if (r.recoveryCodesLeft !== undefined) {
        showToast(`Signed in with a recovery code. ${r.recoveryCodesLeft} left: make new ones on My Account.`, 'info');
      }
      form.remove();
      loginForm.style.display = '';
      await done();
    } catch (err) {
      setFormMsg('ssLoginMsg', err.message || 'That code did not work.', 'error');
      btn.disabled = false;
      // Too long since the password: back to it.
      if (/password again/i.test(err.message || '')) { form.remove(); loginForm.style.display = ''; }
    }
  };
}

async function showPortalOrLogin() {
  const allowed = await refreshPortalSession();
  if (PORTAL.user && PORTAL.user.mustChangePassword) return showFirstPassword();
  if (PORTAL.user && PORTAL.user.mustSetUpSecondStep) return showSecondStepSetup();
  document.getElementById('portalLoginWrap').style.display = allowed ? 'none' : 'flex';
  document.getElementById('portalShell').style.display = allowed ? 'block' : 'none';
  if (allowed) {
    // A portal can narrow its own panels once it knows who is signed in - the
    // executive portal uses this to show only the panels the holder's position
    // is actually granted. It runs here, after the session is confirmed,
    // because until then there is nobody to decide about.
    if (typeof PORTAL.resolvePanels === 'function') {
      try {
        const narrowed = await PORTAL.resolvePanels(PORTAL.allPanels);
        if (Array.isArray(narrowed) && narrowed.length) PORTAL.panels = withToday(narrowed);
      } catch (err) {
        // Falling back to the full list would show panels the server will
        // refuse; showing the profile alone at least leaves a usable portal.
        PORTAL.panels = PORTAL.allPanels.slice(0, 1);
      }
      // The narrowed list says where they land (Today, or a panel it marks
      // `landing`), unless a link chose the panel.
      if (!PORTAL.fromLink) PORTAL.active = (PORTAL.panels.find(p => p.landing) || PORTAL.panels[0]).key;
    }
    if (!PORTAL.panels.some(p => p.key === PORTAL.active)) PORTAL.active = PORTAL.panels[0].key;
    renderPortalChrome();
    openPanel(PORTAL.active || PORTAL.panels[0].key);
  }
}

// ---------- Today ----------
// A portal that brings a `today` (its weekly actions and first steps, see
// today.js) opens on it, with every other panel after it under "All tools".
// Nothing is taken away: the same panels, in the same order, one tap further.
function withToday(panels) {
  if (!PORTAL.today || !window.AconsuToday || panels.some(p => p.key === 'today')) return panels;
  const pick = (v) => (typeof v === 'function' ? v() : v);
  const today = {
    key: 'today',
    label: 'Today',
    // The reminder about a starting password or a missing second step goes
    // on the screen every leader sees first.
    render: (el) => AconsuToday.render(el, {
      portal: PORTAL.role,
      intro: pick(PORTAL.today.intro),
      actions: pick(PORTAL.today.actions),
      checklist: pick(PORTAL.today.checklist),
      has: (key) => PORTAL.panels.some(p => p.key === key),
      open: (key) => { openPanel(key); window.scrollTo(0, 0); },
      menuId: 'portalNav',
      allTools: () => {
        const nav = document.getElementById('portalNav');
        nav.classList.add('open');
        const first = nav.querySelector('button:not([data-panel="today"])');
        nav.scrollIntoView({ block: 'start' });
        if (first) first.focus();
      }
    }).then(() => { if (window.PortalAccount) PortalAccount.nudge(el); })
  };
  // A portal that groups its own menu (the money offices) keeps its headings.
  const grouped = panels.some(p => p.groupLabel);
  return [today, ...panels.map((p, i) => (i === 0 && !grouped ? { ...p, groupLabel: 'All tools' } : p))];
}

// ---------- entry point ----------
async function initPortal(config) {
  PORTAL.role = config.role;
  PORTAL.label = config.label;
  PORTAL.today = config.today || null;
  PORTAL.panels = withToday(config.panels);
  PORTAL.allPanels = config.panels;
  PORTAL.resolvePanels = config.resolvePanels || null;
  PORTAL.active = PORTAL.panels[0].key;
  // A link can open one panel straight away: shepherding.html#checkin is the
  // Sunday check-in, kept as a bookmark on the phones at the door, and
  // executive.html#treasury and #ledger are the Treasurer's and the Financial
  // Secretary's.
  const fromLink = window.location.hash.slice(1);
  if (PORTAL.panels.some(p => p.key === fromLink)) { PORTAL.active = fromLink; PORTAL.fromLink = true; }

  document.getElementById('modalBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modalBackdrop') closeModal();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// Fix for public/js/portal.js - Update the login form submission handler
// Replace lines 207-231 with this:

  // "Your chapter" above the username, when there is more than one to choose from.
  const chapterPick = window.LeaderChapter
    ? LeaderChapter.attach(document.getElementById('portalLoginForm'), 'portalUsername')
    : Promise.resolve({ value: () => undefined });

  // Signed in (by password, or password and code): check this account opens
  // this portal, then show it.
  async function afterSignIn() {
    const btn = document.getElementById('portalLoginBtn');
    // Wait a brief moment for the session cookie to be set
    await new Promise(resolve => setTimeout(resolve, 100));
    const allowed = await refreshPortalSession();
    if (!allowed && !(PORTAL.user && (PORTAL.user.mustChangePassword || PORTAL.user.mustSetUpSecondStep))) {
      setFormMsg('portalLoginMsg', `That account is not part of the ${PORTAL.label}. Check with the admin about which portal it opens.`, 'error');
      btn.disabled = false;
      return;
    }
    showPortalOrLogin();
  }

  document.getElementById('portalLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('portalLoginBtn');
    btn.disabled = true;
    try {
      const chapterId = (await chapterPick).value();
      const loginResponse = await fetchJSON('/api/portal/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('portalUsername').value,
          password: document.getElementById('portalPassword').value,
          ...(chapterId ? { chapterId } : {})
        })
      });
      
      // A second step set up: the code first, then on as usual.
      if (loginResponse && loginResponse.needsSecondStep) {
        btn.disabled = false;
        return askSecondStep(afterSignIn);
      }

      // Verify login was successful
      if (!loginResponse || !loginResponse.success) {
        setFormMsg('portalLoginMsg', 'Login failed. Please try again.', 'error');
        btn.disabled = false;
        return;
      }

      await afterSignIn();
    } catch (err) {
      setFormMsg('portalLoginMsg', err.message || 'Invalid username or password.', 'error');
      btn.disabled = false;
    }
  });
  document.getElementById('portalLogoutBtn').addEventListener('click', async () => {
    await fetchJSON('/api/portal/logout', { method: 'POST' }).catch(() => {});
    await clearCachedAccountData();
    PORTAL.user = null;
    window.location.reload();
  });

  const menuToggle = document.getElementById('portalMenuToggle');
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.addEventListener('click', () => setPortalMenu(!document.getElementById('portalNav').classList.contains('open')));
  // A tap anywhere else, or Escape, closes it, as a menu over the page should.
  document.addEventListener('click', (e) => {
    const nav = document.getElementById('portalNav');
    if (nav.classList.contains('open') && !nav.contains(e.target) && !menuToggle.contains(e.target)) setPortalMenu(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('portalNav').classList.contains('open')) { setPortalMenu(false); menuToggle.focus(); }
  });

  showPortalOrLogin();
}

// A button in a panel that opens another panel (data-open-panel), in place of
// an onclick written into the page.
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-open-panel]');
  if (b && typeof openPanel === 'function') openPanel(b.dataset.openPanel);
});
