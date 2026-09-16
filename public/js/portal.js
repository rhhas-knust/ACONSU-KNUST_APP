/* ============================================================
   Shared behaviour for the leadership portals.
   Each portal page supplies its own panels; everything else —
   signing in, the shell, the side nav, modals, formatting — is
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
  chapter: null // {id, name} — which chapter this account belongs to, if any (see renderPortalChrome)
};

// ---------- formatting ----------
function money(n) {
  const value = Number(n || 0);
  const formatted = Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value < 0 ? '-' : ''}GH₵ ${formatted}`;
}

function shortDate(value) {
  if (!value) return '—';
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (isNaN(d.getTime())) return escapeHtml(String(value));
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function dateTimeLabel(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// The Sunday just gone (or today, if today is Sunday) — the date the
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
      <div class="eyebrow">${escapeHtml(label)}</div>
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
    const access = (data.access && data.access[PORTAL.role]) || { view: false, edit: false };
    PORTAL.canEdit = access.edit;
    return access.view;
  } catch (e) {
    PORTAL.canEdit = false;
    return false;
  }
}

function renderPortalChrome() {
  const user = PORTAL.user;
  const whoLabel = user ? `${user.name} · ${user.role}` : (PORTAL.isAdmin ? 'Signed in as Admin' : '');
  document.getElementById('portalWho').textContent = whoLabel;
  document.getElementById('portalRoleLabel').textContent = PORTAL.label;
  // Which chapter this portal belongs to, front and center in the header —
  // this account's chapter is the identity of the whole portal, not a detail
  // buried in a badge. Pages with no chapter concept of their own (national)
  // simply have no #portalBrandName element, so this is a no-op there.
  const brand = document.getElementById('portalBrandName');
  if (brand) brand.textContent = PORTAL.chapter ? `ACONSU — ${PORTAL.chapter.name}` : 'ACONSU';

  const nav = document.getElementById('portalNav');
  nav.innerHTML = PORTAL.panels.map(p => `
    <button type="button" data-panel="${p.key}" class="${p.key === PORTAL.active ? 'active' : ''}">${escapeHtml(p.label)}</button>
  `).join('');
  nav.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      openPanel(btn.dataset.panel);
      nav.classList.remove('open'); // collapse the mobile drawer after a choice
    });
  });

  const main = document.getElementById('portalMain');
  main.innerHTML = PORTAL.panels.map(p => `<div class="portal-panel" id="panel-${p.key}"></div>`).join('')
    + '<div style="text-align:center; padding:24px 12px 8px; font-size:0.75rem; color:#a993b3;">Powered by HasTech Solutions</div>';

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
  document.querySelectorAll('#portalNav button').forEach(b => b.classList.toggle('active', b.dataset.panel === key));
  document.querySelectorAll('.portal-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${key}`));
  const el = document.getElementById(`panel-${key}`);
  el.innerHTML = '<p class="empty-state">Loading…</p>';
  try {
    await panel.render(el);
  } catch (err) {
    el.innerHTML = `<p class="empty-state">${escapeHtml(err.message || 'Could not load this section.')}</p>`;
  }
}

async function showPortalOrLogin() {
  const allowed = await refreshPortalSession();
  document.getElementById('portalLoginWrap').style.display = allowed ? 'none' : 'flex';
  document.getElementById('portalShell').style.display = allowed ? 'block' : 'none';
  if (allowed) {
    // A portal can narrow its own panels once it knows who is signed in — the
    // executive portal uses this to show only the panels the holder's position
    // is actually granted. It runs here, after the session is confirmed,
    // because until then there is nobody to decide about.
    if (typeof PORTAL.resolvePanels === 'function') {
      try {
        const narrowed = await PORTAL.resolvePanels(PORTAL.allPanels);
        if (Array.isArray(narrowed) && narrowed.length) PORTAL.panels = narrowed;
      } catch (err) {
        // Falling back to the full list would show panels the server will
        // refuse; showing the profile alone at least leaves a usable portal.
        PORTAL.panels = PORTAL.allPanels.slice(0, 1);
      }
    }
    if (!PORTAL.panels.some(p => p.key === PORTAL.active)) PORTAL.active = PORTAL.panels[0].key;
    renderPortalChrome();
    openPanel(PORTAL.active || PORTAL.panels[0].key);
  }
}

// ---------- entry point ----------
async function initPortal(config) {
  PORTAL.role = config.role;
  PORTAL.label = config.label;
  PORTAL.panels = config.panels;
  PORTAL.allPanels = config.panels;
  PORTAL.resolvePanels = config.resolvePanels || null;
  PORTAL.active = config.panels[0].key;

  document.getElementById('modalBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modalBackdrop') closeModal();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// Fix for public/js/portal.js - Update the login form submission handler
// Replace lines 207-231 with this:

  document.getElementById('portalLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('portalLoginBtn');
    btn.disabled = true;
    try {
      const loginResponse = await fetchJSON('/api/portal/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('portalUsername').value,
          password: document.getElementById('portalPassword').value
        })
      });
      
      // Verify login was successful
      if (!loginResponse || !loginResponse.success) {
        setFormMsg('portalLoginMsg', 'Login failed. Please try again.', 'error');
        btn.disabled = false;
        return;
      }

      // Wait a brief moment for the session cookie to be set
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Now refresh the session to verify access
      const allowed = await refreshPortalSession();
      if (!allowed) {
        setFormMsg('portalLoginMsg', `That account is not part of the ${PORTAL.label}. Check with the admin about which portal it opens.`, 'error');
        btn.disabled = false;
        return;
      }
      
      // Proceed to show the portal
      showPortalOrLogin();
    } catch (err) {
      setFormMsg('portalLoginMsg', err.message || 'Invalid username or password.', 'error');
      btn.disabled = false;
    }
  });
  document.getElementById('portalLogoutBtn').addEventListener('click', async () => {
    await fetchJSON('/api/portal/logout', { method: 'POST' }).catch(() => {});
    PORTAL.user = null;
    window.location.reload();
  });

  document.getElementById('portalMenuToggle').addEventListener('click', () => {
    document.getElementById('portalNav').classList.toggle('open');
  });

  showPortalOrLogin();
}
