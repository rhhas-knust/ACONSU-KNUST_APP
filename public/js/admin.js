let CURRENT_SETTINGS = {};
// Who's actually driving this dashboard — the legacy env admin (national-
// equivalent, sees a chapter switcher on resource forms) or a chapter-scoped
// Chapter Admin/Coordinator account (auto-scoped, no switcher needed). Set
// by checkAuth() before the shell ever renders.
let ADMIN_SCOPE = { isNational: true, chapterId: '', role: 'admin', access: {} };
const ADMIN_NAV_STATE_KEY = 'aconsu_admin_nav_state';
// The chapter a NATIONAL actor has deliberately chosen to look into, kept
// separate from the public site's chapter picker. Without this separation a
// national officer who had browsed the public KNUST site would arrive at the
// dashboard silently scoped to KNUST, which is exactly the kind of invisible
// scoping this change exists to remove. Empty means national scope.
const ADMIN_SCOPE_KEY = 'aconsu_admin_scope_chapter';
let ADMIN_CHAPTERS = [];
// The only panels a true-national actor keeps once chapter operations are
// pruned from the nav (see applyNavScopeVisibility).
const NATIONAL_VISIBLE_PANEL_KEYS = ['overview', 'settings'];
let OVERVIEW_REFRESH_TIMER = null;

function showModal(html, { bottomSheet = false } = {}) {
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalContent').classList.toggle('bottom-sheet', !!bottomSheet);
  document.getElementById('modalBackdrop').classList.add('open');
}
function closeModal() {
  document.getElementById('modalContent').classList.remove('bottom-sheet');
  document.getElementById('modalBackdrop').classList.remove('open');
}
document.getElementById('modalBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'modalBackdrop') closeModal();
});

// ---------- auth ----------
// Two accounts can open this dashboard: the original env-based admin login
// (kept working unchanged — see /api/admin/login), and, going forward, a
// Chapter Admin or Chapter Coordinator account created under Leadership
// Accounts (signed in the same way every other portal does). Both are
// checked here so nothing about the legacy login has to change.
async function checkAuth() {
  try {
    const { isAdmin } = await fetchJSON('/api/admin/check');
    if (isAdmin) {
      ADMIN_SCOPE = { isNational: true, chapterId: '', role: 'admin', access: {} };
      return showAdminShell();
    }
  } catch (e) { /* fall through to the portal-login check below */ }
  try {
    const me = await fetchJSON('/api/portal/me');
    const role = me.staff && me.staff.role;
    if (me.isNational || role === 'coordinator' || role === 'chapterAdmin' || role === 'executive') {
      ADMIN_SCOPE = {
        isNational: !!me.isNational,
        chapterId: (me.staff && me.staff.chapterId) || '',
        role: role || '',
        access: me.access || {}
      };
      return showAdminShell();
    }
  } catch (e) { /* not signed in either way */ }
  document.getElementById('loginWrap').style.display = 'flex';
  document.getElementById('adminShell').style.display = 'none';
}

function readAdminScopeChapter() {
  try { return localStorage.getItem(ADMIN_SCOPE_KEY) || ''; } catch (e) { return ''; }
}
function writeAdminScopeChapter(id) {
  try {
    if (id) localStorage.setItem(ADMIN_SCOPE_KEY, id);
    else localStorage.removeItem(ADMIN_SCOPE_KEY);
  } catch (e) { /* private browsing — scope simply resets to national */ }
}
// fetchJSON attaches X-Chapter-Id from the shared chapter store, so the
// admin's own choice is pushed into it on every load. That way the dashboard
// never inherits a chapter left behind by the public site's picker.
function applyAdminScope() {
  if (!ADMIN_SCOPE.isNational) return;
  setSelectedChapterId(readAdminScopeChapter());
}
function currentAdminScopeChapter() {
  return ADMIN_SCOPE.isNational ? readAdminScopeChapter() : ADMIN_SCOPE.chapterId;
}

// "National by default, chapter by selection" (GOVERNANCE_TIER_REVIEW.md).
// True only once there is a real choice to make — deliberately inert with a
// single active chapter (ADMIN_CHAPTERS.length !== 1), the same "single
// chapter, zero friction" rule the server applies.
function isTrueNationalScope() {
  return ADMIN_SCOPE.isNational && !currentAdminScopeChapter() && ADMIN_CHAPTERS.length !== 1;
}

// Phase D — the national actor's admin nav is a wall of 22 chapter-operations
// panels that were never national's to begin with (see Finding 1). Panels
// tagged data-scope="chapter" in admin.html are hidden at true national
// scope; a group collapses entirely once every one of its panels is hidden.
// Global Settings and the National Portal link are untagged and always
// follow their own national-only visibility, set in showAdminShell.
function applyNavScopeVisibility() {
  const pruned = isTrueNationalScope();
  document.querySelectorAll('#adminNav [data-scope="chapter"]').forEach(el => {
    el.style.display = pruned ? 'none' : '';
  });
  document.querySelectorAll('#adminNav .nav-group').forEach(group => {
    const body = group.querySelector('.nav-group-body');
    if (!body) return;
    const anyVisible = Array.from(body.children).some(child => child.style.display !== 'none');
    group.style.display = anyVisible ? '' : 'none';
  });
  const hint = document.getElementById('adminNavScopeHint');
  if (hint) hint.hidden = !pruned;
  return pruned;
}

async function initChapterScopeSelector() {
  const wrap = document.getElementById('adminScopeWrap');
  const select = document.getElementById('adminScopeSelect');
  const badge = document.getElementById('adminChapterBadge');
  if (!wrap || !select || !ADMIN_SCOPE.isNational) return;

  try {
    ADMIN_CHAPTERS = await fetchJSON('/api/national/chapters');
  } catch (e) {
    ADMIN_CHAPTERS = [];
  }
  const chosen = readAdminScopeChapter();
  select.innerHTML = `
    <option value="">🌐 ACONSU National</option>
    ${ADMIN_CHAPTERS.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === chosen ? 'selected' : ''}>📍 ${escapeHtml(c.name)}</option>`).join('')}
  `;
  wrap.style.display = 'inline-flex';
  if (badge) {
    const found = ADMIN_CHAPTERS.find(c => c.id === chosen);
    badge.textContent = found ? `Viewing ${found.name}` : 'National scope';
  }

  select.addEventListener('change', () => {
    writeAdminScopeChapter(select.value);
    applyAdminScope();
    const found = ADMIN_CHAPTERS.find(c => c.id === select.value);
    if (badge) badge.textContent = found ? `Viewing ${found.name}` : 'National scope';
    showToast(found ? `Now viewing ${found.name}` : 'Back to national scope', 'success');
    const pruned = applyNavScopeVisibility();
    const active = document.querySelector('.admin-panel.active');
    const activeKey = active ? active.id.replace('panel-', '') : 'overview';
    // If scope just went national and the panel being viewed is chapter-only
    // (now hidden from the nav), don't leave the admin stranded on it.
    loadPanel(pruned && !NATIONAL_VISIBLE_PANEL_KEYS.includes(activeKey) ? 'overview' : activeKey);
  });
}

async function showAdminShell() {
  document.getElementById('loginWrap').style.display = 'none';
  document.getElementById('adminShell').style.display = 'block';

  // Chapter badge display in topbar
  const badge = document.getElementById('adminChapterBadge');
  if (badge) {
    if (ADMIN_SCOPE.isNational) {
      badge.textContent = 'National scope';
      const natBtn = document.getElementById('navNationalBtn');
      const globBtn = document.getElementById('navGlobalSettingsBtn');
      if (natBtn) natBtn.style.display = 'flex';
      if (globBtn) globBtn.style.display = 'flex';
    } else if (ADMIN_SCOPE.chapterId) {
      fetchJSON('/api/admin/chapter-settings')
        .then(cs => { badge.textContent = `📍 ${cs.name || ADMIN_SCOPE.chapterId}`; })
        .catch(() => { badge.textContent = `📍 ${ADMIN_SCOPE.chapterId}`; });
    }
  }

  applyAdminScope();
  initAdminNav();
  initMobileAdminUi();
  initCommandPalette();
  // Awaited so ADMIN_CHAPTERS is populated before the nav is pruned and the
  // first panel loads — otherwise both would briefly judge scope off an
  // empty chapter list and mis-render on the very first paint.
  await initChapterScopeSelector();
  applyNavScopeVisibility();
  loadPanel('overview');
}

function readAdminNavState() {
  try { return JSON.parse(localStorage.getItem(ADMIN_NAV_STATE_KEY) || '{}'); } catch (e) { return {}; }
}

function writeAdminNavState(state) {
  try { localStorage.setItem(ADMIN_NAV_STATE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

function setNavGroupOpen(groupName, isOpen) {
  const group = document.querySelector(`.nav-group[data-nav-group="${groupName}"]`);
  if (!group) return;
  group.classList.toggle('open', isOpen);
  const state = readAdminNavState();
  state[groupName] = !!isOpen;
  writeAdminNavState(state);
}

function expandGroupForPanel(name) {
  const btn = document.querySelector(`#adminNav button[data-panel="${name}"]`);
  const group = btn && btn.closest('.nav-group');
  if (group && group.dataset.navGroup) setNavGroupOpen(group.dataset.navGroup, true);
}

function openAdminPanel(name) {
  const btn = document.querySelector(`#adminNav button[data-panel="${name}"]`);
  if (btn) {
    document.getElementById('adminNav').querySelectorAll('button[data-panel]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    expandGroupForPanel(name);
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById(`panel-${name}`);
    if (panel) panel.classList.add('active');
    closeMobileNav();
    loadPanel(name);
  }
}

function closeMobileNav() {
  const nav = document.getElementById('adminNav');
  const backdrop = document.getElementById('adminSideBackdrop');
  if (nav) nav.classList.remove('open');
  if (backdrop) backdrop.classList.remove('open');
}

function initMobileAdminUi() {
  const navBtn = document.getElementById('mobileNavBtn');
  const actionsBtn = document.getElementById('mobileQuickActionsBtn');
  const nav = document.getElementById('adminNav');
  const backdrop = document.getElementById('adminSideBackdrop');
  if (navBtn && nav && backdrop) {
    navBtn.addEventListener('click', () => {
      nav.classList.toggle('open');
      backdrop.classList.toggle('open', nav.classList.contains('open'));
    });
    backdrop.addEventListener('click', closeMobileNav);
  }
  if (actionsBtn) {
    actionsBtn.addEventListener('click', () => {
      showModal(`
        <h3 style="margin-top:0;">Quick Actions</h3>
        <div class="sheet-list">
          <div class="sheet-item"><button class="btn btn-primary btn-sm" data-mobile-action="members">Open Members</button></div>
          <div class="sheet-item"><button class="btn btn-primary btn-sm" data-mobile-action="events">Create Event</button></div>
          <div class="sheet-item"><button class="btn btn-primary btn-sm" data-mobile-action="notifications">Send Notification</button></div>
          <div class="sheet-item"><button class="btn btn-primary btn-sm" data-mobile-action="chapterSettings">Chapter Settings</button></div>
        </div>
      `, { bottomSheet: true });
      document.querySelectorAll('[data-mobile-action]').forEach(btn => {
        btn.addEventListener('click', () => {
          const panel = btn.dataset.mobileAction;
          closeModal();
          openAdminPanel(panel);
          if (panel === 'events') whenElementReady('#addBtn-events', (el) => el.click());
          if (panel === 'notifications') whenElementReady('#notifTitle', (el) => el.focus());
        });
      });
    });
  }
}

// ---------- nav ----------
function initAdminNav() {
  const navState = readAdminNavState();
  document.getElementById('adminNav').querySelectorAll('[data-toggle-group]').forEach(btn => {
    const groupName = btn.dataset.toggleGroup;
    const group = btn.closest('.nav-group');
    const initialOpen = navState[groupName] !== undefined ? !!navState[groupName] : group.classList.contains('open');
    group.classList.toggle('open', initialOpen);
    btn.addEventListener('click', () => setNavGroupOpen(groupName, !group.classList.contains('open')));
  });
  document.getElementById('adminNav').querySelectorAll('button[data-panel]').forEach(btn => {
    btn.addEventListener('click', () => {
      openAdminPanel(btn.dataset.panel);
    });
  });
}

async function loadPanel(name) {
  const handlers = {
    overview: renderOverview,
    departments: () => renderResourcePanel('departments', DEPARTMENT_FIELDS, 'Department'),
    executives: renderExecutives,
    members: renderMembers,
    notifications: renderNotifications,
    events: () => renderResourcePanel('events', EVENT_FIELDS, 'Event'),
    sermons: () => renderResourcePanel('sermons', SERMON_FIELDS, 'Sermon'),
    bibleStudies: renderBibleStudies,
    groups: renderGroupsAdmin,
    welfare: renderWelfareAdmin,
    chatModeration: renderChatModeration,
    forms: renderFormsAdmin,
    pages: () => renderResourcePanel('pages', PAGE_FIELDS, 'Page'),
    media: renderMediaLibrary,
    reports: renderReportsPanel,
    staff: renderStaffAccounts,
    joinRequests: renderJoinRequests,
    prayerRequests: renderPrayerRequests,
    testimonies: renderTestimonies,
    contactMessages: renderContactMessages,
    chapterSettings: renderChapterSettings,
    settings: renderSettings
  };
  if (handlers[name]) handlers[name]();
}

// ---------- overview ----------
async function renderOverview() {
  const el = document.getElementById('panel-overview');
  el.innerHTML = '<p class="empty-state">Loading...</p>';
  // The operational dashboard is a chapter's dashboard — there is no
  // meaningful cross-chapter version of "this week's attendance". A national
  // actor picks a chapter for it, or goes to the National Portal for the
  // aggregate view, rather than being shown a raw error.
  if (isTrueNationalScope()) {
    el.innerHTML = `
      <div class="panel-head">
        <div>
          <h2>Operational Dashboard</h2>
          <p class="hint" style="margin:4px 0 0;">This dashboard belongs to a chapter.</p>
        </div>
      </div>
      <p class="empty-state">
        You are viewing at <strong>national scope</strong>. Choose a chapter from the selector in the top bar to see its
        dashboard, or open the <a href="/national.html">National Portal</a> for the cross-chapter picture.
      </p>`;
    return;
  }
  try {
    const data = await fetchJSON('/api/admin/overview');
    if (OVERVIEW_REFRESH_TIMER) clearTimeout(OVERVIEW_REFRESH_TIMER);
    OVERVIEW_REFRESH_TIMER = setTimeout(() => {
      const panel = document.getElementById('panel-overview');
      if (panel && panel.classList.contains('active')) renderOverview();
    }, Math.max(10, Number(data.refreshEverySeconds || 30)) * 1000);

    const trendLabel = (trend = {}) => {
      const symbol = trend.direction === 'up' ? '▲' : (trend.direction === 'down' ? '▼' : '•');
      const pct = Math.abs(Number(trend.percent || 0));
      const detail = pct ? `${pct}%` : 'no change';
      return `${symbol} ${detail} vs previous week`;
    };
    const formatActivityTime = (value) => {
      if (!value) return 'Unknown time';
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return 'Unknown time';
      return d.toLocaleString();
    };

    el.innerHTML = `
      <div class="panel-head">
        <div>
          <h2 style="margin:0;">Operational Dashboard</h2>
          <p class="hint" style="margin:4px 0 0;">${escapeHtml((data.chapter && data.chapter.name) || 'Chapter')} • Last refresh ${formatActivityTime(data.generatedAt)}</p>
        </div>
        <div class="hint">Rule of 4 KPI view</div>
      </div>
      <div class="kpi-grid">
        ${data.kpis.map((kpi, idx) => `
          <button type="button" class="kpi-card" data-kpi-index="${idx}">
            <div class="kpi-label">${escapeHtml(kpi.label)}</div>
            <div class="kpi-value">${escapeHtml(String(kpi.value))}</div>
            <div class="kpi-trend ${escapeHtml(kpi.trend.direction || 'flat')}">${escapeHtml(trendLabel(kpi.trend))}</div>
          </button>
        `).join('')}
      </div>
      <div class="overview-stream">
        <div class="panel-head" style="margin-bottom:10px;">
          <h3 style="margin:0;">Live Pastoral Care &amp; Activity Stream</h3>
          <small class="hint">${data.activity.length} recent updates</small>
        </div>
        <ul>
          ${data.activity.map((item) => `
            <li>
              <strong>${escapeHtml(item.label || 'Activity')}</strong> — ${escapeHtml(item.title || '')}<br>
              <small>${escapeHtml(item.detail || '')}</small><br>
              <small class="hint">${escapeHtml(formatActivityTime(item.at))}</small><br>
              ${item.panel ? `<button type="button" data-activity-panel="${escapeHtml(item.panel)}">Open ${escapeHtml(item.panel)}</button>` : ''}
            </li>
          `).join('') || '<li><span class="hint">No recent updates yet.</span></li>'}
        </ul>
      </div>
    `;
    el.querySelectorAll('[data-kpi-index]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const kpi = data.kpis[Number(btn.dataset.kpiIndex)];
        const list = Array.isArray(kpi.drilldown) ? kpi.drilldown : [];
        showModal(`
          <h3 style="margin-top:0;">${escapeHtml(kpi.label)}</h3>
          <p class="hint" style="margin-top:4px;">Current value: <strong>${escapeHtml(String(kpi.value))}</strong></p>
          <div class="sheet-list">
            ${list.map((row) => `
              <div class="sheet-item">
                <h4>${escapeHtml(row.title || row.name || row.date || 'Item')}</h4>
                <p>${escapeHtml(row.detail || row.location || row.serviceType || row.level || '')}</p>
              </div>
            `).join('') || '<p class="hint">No drill-down rows yet.</p>'}
          </div>
          ${kpi.drilldownPanel ? `<button class="btn btn-primary btn-sm" data-open-kpi-panel="${escapeHtml(kpi.drilldownPanel)}" style="margin-top:12px;">Open ${escapeHtml(kpi.drilldownPanel)}</button>` : ''}
        `, { bottomSheet: true });
        const openBtn = document.querySelector('[data-open-kpi-panel]');
        if (openBtn) {
          openBtn.addEventListener('click', () => {
            closeModal();
            openAdminPanel(openBtn.dataset.openKpiPanel);
          });
        }
      });
    });
    el.querySelectorAll('[data-activity-panel]').forEach((btn) => {
      btn.addEventListener('click', () => openAdminPanel(btn.dataset.activityPanel));
    });
  } catch (e) {
    el.innerHTML = `<p class="empty-state">Could not load overview. ${escapeHtml(e.message || '')}</p>`;
  }
}

// ---------- resource field configs ----------
const DEPARTMENT_FIELDS = [
  { key: 'name', label: 'Department Name', type: 'text', required: true },
  { key: 'tagline', label: 'Tagline', type: 'text' },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'meetingDay', label: 'Meeting Day', type: 'text' },
  { key: 'meetingTime', label: 'Meeting Time', type: 'text' },
  { key: 'meetingLocation', label: 'Meeting Location', type: 'text' },
  { key: 'leader', label: 'Department Leader', type: 'text' }
];
const EVENT_FIELDS = [
  { key: 'title', label: 'Event Title', type: 'text', required: true },
  { key: 'date', label: 'Date', type: 'date', required: true },
  { key: 'time', label: 'Time', type: 'time', required: true },
  { key: 'location', label: 'Location', type: 'text' },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'recurring', label: 'Recurring Label (optional)', type: 'text' },
  { key: 'registrationEnabled', label: 'Enable registration for this event', type: 'checkbox' },
  { key: 'capacity', label: 'Capacity (0 = unlimited)', type: 'number' },
  { key: 'registrationDeadline', label: 'Registration Deadline', type: 'datetime-local' }
];
const SERMON_FIELDS = [
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'speaker', label: 'Speaker', type: 'text' },
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'type', label: 'Type (audio/video)', type: 'text' },
  { key: 'url', label: 'Link URL', type: 'text' },
  { key: 'description', label: 'Description', type: 'textarea' }
];
const PAGE_FIELDS = [
  { key: 'title', label: 'Page Title', type: 'text', required: true },
  { key: 'slug', label: 'URL Slug (e.g. ebook-store)', type: 'text', required: true },
  { key: 'navLabel', label: 'Label Shown in Menu', type: 'text' },
  { key: 'type', label: 'Page Type', type: 'select', options: [
    { value: 'gallery', label: 'Photo Gallery (e.g. Sunday Service Pictures)' },
    { value: 'bookshelf', label: 'E-Book / Resource Shelf' },
    { value: 'text', label: 'Plain Info Page' }
  ], required: true },
  { key: 'description', label: 'Short Description (shown under the title)', type: 'text' },
  { key: 'content', label: 'Page Content (only used for "Plain Info Page" — separate paragraphs with a blank line)', type: 'textarea' },
  { key: 'showInNav', label: 'Show this page in the main menu', type: 'checkbox' }
];

// ---------- generic CRUD panel ----------
const resourcePageState = {};

async function renderResourcePanel(resource, fields, singular) {
  const el = document.getElementById(`panel-${resource}`);
  el.innerHTML = '<p class="empty-state">Loading...</p>';
  const items = await fetchJSON(`/api/${resource}`);
  const page = resourcePageState[resource] || 1;
  const pageItems = paginate(items, page, ROWS_PER_PAGE);

  el.innerHTML = `
    <div class="panel-head">
      <h2>${singular}s (${items.length})</h2>
      <button class="btn btn-primary btn-sm" id="addBtn-${resource}">+ Add ${singular}</button>
    </div>
    <table>
      <thead><tr>${resource === 'departments' ? '<th>Header</th>' : ''}${fields.slice(0, 3).map(f => `<th>${f.label}</th>`).join('')}${resource === 'events' ? '<th>Registrations</th>' : ''}<th>Actions</th></tr></thead>
      <tbody>
        ${pageItems.map(item => `
          <tr>
            ${resource === 'departments' ? `<td>
              <div style="width:74px; height:44px; border-radius:8px; overflow:hidden; background:var(--lilac-light); display:flex; align-items:center; justify-content:center; font-size:0.7rem; color:#8a7595;">
                ${item.headerImageFileId ? `<img src="/api/files/${item.headerImageFileId}" alt="" style="width:100%; height:100%; object-fit:cover;">` : 'none'}
              </div>
            </td>` : ''}
            ${fields.slice(0, 3).map(f => `<td>${escapeHtml(String(item[f.key] || ''))}</td>`).join('')}
            ${resource === 'events' ? `<td>${item.registrationEnabled ? `<button data-view-regs="${item.id}" data-title="${escapeHtml(item.title)}">View (${item.capacity > 0 ? `cap ${item.capacity}` : 'unlimited'})</button>` : '—'}</td>` : ''}
            <td class="row-actions">
              ${resource === 'departments' ? `<button data-header-image="${item.id}">Header Image</button>` : ''}
              <button data-edit="${item.id}">Edit</button>
              <button class="danger" data-delete="${item.id}">Delete</button>
            </td>
          </tr>
        `).join('') || `<tr><td colspan="${fields.length + (resource === 'events' ? 2 : 1) + (resource === 'departments' ? 1 : 0)}">No ${singular.toLowerCase()}s yet.</td></tr>`}
      </tbody>
    </table>
    <div id="resourcePagination-${resource}"></div>
  `;

  renderPaginationControls(`resourcePagination-${resource}`, items.length, ROWS_PER_PAGE, page, (p) => {
    resourcePageState[resource] = p;
    renderResourcePanel(resource, fields, singular);
  });

  if (resource === 'events') {
    el.querySelectorAll('[data-view-regs]').forEach(btn => {
      btn.addEventListener('click', () => openRegistrationsModal(btn.dataset.viewRegs, btn.dataset.title));
    });
  }
  if (resource === 'departments') {
    el.querySelectorAll('[data-header-image]').forEach(btn => {
      btn.addEventListener('click', () => openDepartmentImageModal(items.find(i => i.id === btn.dataset.headerImage)));
    });
  }

  document.getElementById(`addBtn-${resource}`).addEventListener('click', () => openResourceForm(resource, fields, singular));
  el.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = items.find(i => i.id === btn.dataset.edit);
      openResourceForm(resource, fields, singular, item);
    });
  });
  el.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Delete this ${singular.toLowerCase()}? This can't be undone.`)) return;
      await fetchJSON(`/api/admin/${resource}/${btn.dataset.delete}`, { method: 'DELETE' });
      renderResourcePanel(resource, fields, singular);
    });
  });
}

function openResourceForm(resource, fields, singular, item) {
  const isEdit = !!item;
  const formHtml = `
    <h3>${isEdit ? 'Edit' : 'Add'} ${singular}</h3>
    <form id="resourceForm">
      ${fields.map(f => {
        const val = item ? item[f.key] : undefined;
        if (f.type === 'textarea') {
          return `<div class="field"><label>${f.label}</label><textarea data-key="${f.key}">${escapeHtml(val || '')}</textarea></div>`;
        }
        if (f.type === 'select') {
          return `<div class="field"><label>${f.label}</label>
            <select data-key="${f.key}" ${f.required ? 'required' : ''}>
              ${f.options.map(o => `<option value="${o.value}" ${val === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
            </select></div>`;
        }
        if (f.type === 'checkbox') {
          return `<div class="field checkbox-field">
            <input type="checkbox" data-key="${f.key}" id="field-${f.key}" ${val ? 'checked' : ''}>
            <label for="field-${f.key}" style="margin:0;">${f.label}</label></div>`;
        }
        return `<div class="field"><label>${f.label}</label>
          <input type="${f.type}" data-key="${f.key}" value="${escapeHtml(val !== undefined ? val : '')}" ${f.required ? 'required' : ''}></div>`;
      }).join('')}
      <div style="display:flex; gap:10px;">
        <button type="submit" class="btn btn-primary">Save</button>
        <button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button>
      </div>
      <div class="form-msg" id="resourceFormMsg"></div>
    </form>
  `;
  showModal(formHtml);
  document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
  document.getElementById('resourceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {};
    fields.forEach(f => {
      const el = document.querySelector(`[data-key="${f.key}"]`);
      if (f.type === 'checkbox') {
        payload[f.key] = el.checked;
      } else if (f.type === 'number') {
        payload[f.key] = Number(el.value || 0);
      } else {
        payload[f.key] = el.value;
      }
    });
    try {
      if (isEdit) {
        await fetchJSON(`/api/admin/${resource}/${item.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
      } else {
        await fetchJSON(`/api/admin/${resource}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
      }
      closeModal();
      renderResourcePanel(resource, fields, singular);
    } catch (err) {
      document.getElementById('resourceFormMsg').textContent = err.message || 'Could not save.';
      document.getElementById('resourceFormMsg').className = 'form-msg error';
    }
  });
}

// ---------- leadership accounts ----------
// One portal account per leader, so access follows the person holding the office
// rather than a password everybody knows.
const PORTAL_ROLES = [
  { value: 'nationalCoordinator', label: 'National Coordinator', blurb: 'Oversight across every ACONSU chapter — dashboard, chapters, announcements.', href: '/national.html' },
  { value: 'coordinator', label: 'Chapter Coordinator', blurb: 'Highest chapter authority — oversight, approvals, chapter-wide announcements.', href: '/coordinator.html' },
  { value: 'chapterAdmin', label: 'Chapter Admin', blurb: 'Day-to-day chapter administration — chapter-scoped dashboard.', href: '/chapter.html' },
  { value: 'executive', label: 'Executive', blurb: 'Executive profile and event submissions.', href: '/executive.html' },
  { value: 'finance', label: 'Finance', blurb: 'Budgets, ledger, financial reports.', href: '/finance.html' },
  { value: 'shepherding', label: 'Shepherding', blurb: 'Attendance, member care, contact messages.', href: '/shepherding.html' },
  { value: 'publicity', label: 'Publicity', blurb: 'Announcements, SMS, events, testimonies.', href: '/publicity.html' },
  { value: 'welfare', label: 'Welfare', blurb: 'Welfare requests and referrals.', href: '/welfare-portal.html' },
  { value: 'departmentLeader', label: 'Department Leader', blurb: 'Leads one department.', href: '/department.html' }
];
// Only a National Coordinator may hand out these two — see /api/admin/staff.
const NATIONAL_ONLY_STAFF_ROLES = ['nationalCoordinator', 'coordinator'];

async function renderStaffAccounts() {
  const el = document.getElementById('panel-staff');
  el.innerHTML = '<p class="empty-state">Loading...</p>';
  const users = await fetchJSON('/api/admin/staff');

  el.innerHTML = `
    <div class="panel-head">
      <h2 style="margin:0;">Leadership Accounts (${users.length})</h2>
      <button class="btn btn-primary btn-sm" id="addStaffBtn">+ Add Account</button>
    </div>
    <p style="font-size:0.85rem; color:#8a7595; margin-bottom:18px;">
      Each account opens one portal. Give the leader their username and password, then send them the portal link below —
      they sign in there, not here.
    </p>

    <div class="media-grid" style="grid-template-columns: repeat(auto-fill, minmax(220px,1fr)); margin-bottom:26px;">
      ${PORTAL_ROLES.map(r => `
        <div class="media-card" style="padding:14px;">
          <h4 style="margin:0 0 4px;">${r.label}</h4>
          <small class="hint" style="margin:0 0 8px;">${r.blurb}</small>
          <a href="${r.href}" target="_blank" rel="noopener" style="font-size:0.8rem; font-weight:700; color:var(--purple-deep);">${r.href}</a>
          <div style="margin-top:6px; font-size:0.78rem; color:#8a7595;">${users.filter(u => u.role === r.value).length} account(s)</div>
        </div>
      `).join('')}
    </div>

    <table>
      <thead><tr><th>Name</th><th>Username</th><th>Portal</th><th>Status</th><th>Last Sign-In</th><th>Actions</th></tr></thead>
      <tbody>
        ${users.map(u => `
          <tr>
            <td>${escapeHtml(u.name || '—')}</td>
            <td>${escapeHtml(u.username)}</td>
            <td>${escapeHtml((PORTAL_ROLES.find(r => r.value === u.role) || {}).label || u.role)}</td>
            <td><span class="status-pill ${u.active ? 'done' : ''}">${u.active ? 'active' : 'disabled'}</span></td>
            <td>${u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'never'}</td>
            <td class="row-actions">
              <button data-edit-staff="${u.id}">Edit</button>
              <button class="danger" data-delete-staff="${u.id}">Delete</button>
            </td>
          </tr>
        `).join('') || '<tr><td colspan="6">No leadership accounts yet — add one to give a leader their portal.</td></tr>'}
      </tbody>
    </table>
  `;

  document.getElementById('addStaffBtn').addEventListener('click', () => openStaffForm(null));
  el.querySelectorAll('[data-edit-staff]').forEach(btn => {
    btn.addEventListener('click', () => openStaffForm(users.find(u => u.id === btn.dataset.editStaff)));
  });
  el.querySelectorAll('[data-delete-staff]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this account? That leader will lose access to their portal immediately.')) return;
      await fetchJSON(`/api/admin/staff/${btn.dataset.deleteStaff}`, { method: 'DELETE' });
      showToast('Account deleted.', 'success');
      renderStaffAccounts();
    });
  });
}

async function openStaffForm(user) {
  const isEdit = !!user;
  // A chapter-scoped admin can't hand out Chapter Coordinator (only National
  // can — see NATIONAL_ONLY_STAFF_ROLES) and never needs a chapter picker,
  // since the server always scopes their accounts to their own chapter.
  const roleOptions = PORTAL_ROLES.filter(r => ADMIN_SCOPE.isNational || !NATIONAL_ONLY_STAFF_ROLES.includes(r.value));
  let chapters = [];
  if (ADMIN_SCOPE.isNational) {
    chapters = await fetchJSON('/api/national/chapters').catch(() => []);
  }

  showModal(`
    <h3>${isEdit ? 'Edit' : 'New'} Leadership Account</h3>
    <form id="staffForm">
      <div class="field"><label>Full Name</label>
        <input type="text" id="stName" value="${escapeHtml(user?.name || '')}" placeholder="e.g. Ama Mensah" required></div>
      <div class="field"><label>Username</label>
        ${isEdit
          ? `<input type="text" value="${escapeHtml(user.username)}" disabled>`
          : '<input type="text" id="stUsername" placeholder="e.g. finance.ama" required>'}
        ${isEdit ? '<small class="hint">Usernames cannot be changed — delete and recreate the account if it must change.</small>' : ''}
      </div>
      <div class="field"><label>Which portal does this account open?</label>
        <select id="stRole" ${isEdit ? '' : 'required'}>
          ${roleOptions.map(r => `<option value="${r.value}" ${user?.role === r.value ? 'selected' : ''}>${r.label} — ${r.blurb}</option>`).join('')}
        </select>
      </div>
      ${ADMIN_SCOPE.isNational ? `
        <div class="field"><label>Chapter</label>
          <select id="stChapter">
            ${chapters.map(c => `<option value="${c.id}" ${(user?.chapterId || ADMIN_SCOPE.chapterId) === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
          </select>
          <small class="hint">Ignored for National Coordinator accounts.</small>
        </div>
      ` : ''}
      <div class="field"><label>${isEdit ? 'New Password (leave blank to keep the current one)' : 'Password'}</label>
        <input type="text" id="stPassword" ${isEdit ? '' : 'required'} placeholder="At least 8 characters">
        <small class="hint">Shown in plain text so you can copy it to the leader — it is stored hashed and can never be read back.</small>
      </div>
      ${isEdit ? `
        <div class="field checkbox-field">
          <input type="checkbox" id="stActive" ${user.active ? 'checked' : ''}>
          <label for="stActive" style="margin:0;">Account is active</label>
        </div>` : ''}
      <div style="display:flex; gap:10px;">
        <button type="submit" class="btn btn-primary">Save Account</button>
        <button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button>
      </div>
      <div class="form-msg" id="staffFormMsg"></div>
    </form>
  `);
  document.getElementById('cancelModalBtn').addEventListener('click', closeModal);

  document.getElementById('staffForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('stName').value,
      role: document.getElementById('stRole').value
    };
    if (ADMIN_SCOPE.isNational && document.getElementById('stChapter')) {
      payload.chapterId = document.getElementById('stChapter').value;
    }
    const password = document.getElementById('stPassword').value;
    if (password) payload.password = password;
    if (isEdit) payload.active = document.getElementById('stActive').checked;
    else payload.username = document.getElementById('stUsername').value;

    try {
      await fetchJSON(isEdit ? `/api/admin/staff/${user.id}` : '/api/admin/staff', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      closeModal();
      showToast('Account saved.', 'success');
      renderStaffAccounts();
    } catch (err) {
      document.getElementById('staffFormMsg').textContent = err.message || 'Could not save this account.';
      document.getElementById('staffFormMsg').className = 'form-msg error';
    }
  });
}

// ---------- department header images ----------
// A department's header is the banner across the top of its page, so it gets a
// dedicated screen: see what is there now, replace it, or pick something already
// in the library.
async function openDepartmentImageModal(dept) {
  showModal(`<h3>Header Image — ${escapeHtml(dept.name)}</h3><p class="empty-state">Loading library...</p>`);
  const files = await fetchJSON('/api/files?category=photo').catch(() => []);
  const images = files.filter(f => (f.contentType || '').startsWith('image/'));

  document.getElementById('modalContent').innerHTML = `
    <h3>Header Image — ${escapeHtml(dept.name)}</h3>
    <p class="hint" style="margin-bottom:16px;">
      This photo appears as the banner across the top of the ${escapeHtml(dept.name)} page, and on its card in the departments list.
      Landscape photos work best — anything wider than it is tall.
    </p>

    <div style="aspect-ratio:16/6; border-radius:12px; overflow:hidden; background:var(--lilac-light); display:flex; align-items:center; justify-content:center; margin-bottom:18px;">
      ${dept.headerImageFileId
        ? `<img src="/api/files/${dept.headerImageFileId}" alt="" style="width:100%; height:100%; object-fit:cover;">`
        : '<span style="color:#8a7595; font-weight:700;">No header image yet</span>'}
    </div>

    <form id="deptImageForm">
      <div class="field"><label>Upload a new header</label><input type="file" id="deptImageFile" accept="image/*"></div>
      <button type="submit" class="btn btn-primary btn-sm" id="deptImageBtn">Upload &amp; Set as Header</button>
      <div class="form-msg" id="deptImageMsg"></div>
    </form>

    <h4 style="margin:22px 0 10px;">…or pick one already in the library</h4>
    <div class="media-grid" style="grid-template-columns: repeat(auto-fill, minmax(110px,1fr));">
      ${images.slice(0, 24).map(f => `
        <div class="media-card" style="cursor:pointer;" data-pick="${f.id}">
          <div class="thumb"><img src="/api/files/${f.id}" alt="${escapeHtml(f.title)}"></div>
        </div>
      `).join('') || '<p class="hint">Nothing in the library yet.</p>'}
    </div>

    <div style="display:flex; gap:10px; margin-top:22px;">
      ${dept.headerImageFileId ? '<button type="button" class="btn btn-outline btn-sm" id="clearHeaderBtn">Remove header</button>' : ''}
      <button type="button" class="btn btn-outline btn-sm" id="cancelModalBtn">Close</button>
    </div>
  `;
  document.getElementById('cancelModalBtn').addEventListener('click', closeModal);

  async function setHeader(fileId) {
    await fetchJSON(`/api/admin/departments/${dept.id}/header-image`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headerImageFileId: fileId })
    });
    closeModal();
    showToast(fileId ? 'Header image set.' : 'Header image removed.', 'success');
    renderResourcePanel('departments', DEPARTMENT_FIELDS, 'Department');
  }

  document.querySelectorAll('[data-pick]').forEach(card => {
    card.addEventListener('click', () => setHeader(card.dataset.pick));
  });
  const clearBtn = document.getElementById('clearHeaderBtn');
  if (clearBtn) clearBtn.addEventListener('click', () => setHeader(''));

  document.getElementById('deptImageForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('deptImageFile');
    if (!input.files.length) return;
    const btn = document.getElementById('deptImageBtn');
    btn.disabled = true; btn.textContent = 'Uploading...';
    const formData = new FormData();
    formData.append('file', input.files[0]);
    formData.append('category', 'photo');
    formData.append('placement', 'department-header');
    formData.append('targetId', dept.id);
    formData.append('title', `${dept.name} header`);
    try {
      const res = await fetch('/api/admin/uploads', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      closeModal();
      showToast(`Header set for ${dept.name}.`, 'success');
      renderResourcePanel('departments', DEPARTMENT_FIELDS, 'Department');
    } catch (err) {
      document.getElementById('deptImageMsg').textContent = err.message;
      document.getElementById('deptImageMsg').className = 'form-msg error';
    } finally {
      btn.disabled = false; btn.textContent = 'Upload & Set as Header';
    }
  });
}

// ---------- join requests ----------
let joinReqPage = 1;
const ROWS_PER_PAGE = 15;

async function renderJoinRequests() {
  const el = document.getElementById('panel-joinRequests');
  el.innerHTML = '<p class="empty-state">Loading...</p>';
  const [items, departments] = await Promise.all([
    fetchJSON('/api/admin/join-requests'),
    fetchJSON('/api/departments')
  ]);
  const deptName = (id) => (departments.find(d => d.id === id) || {}).name || id;
  const pageItems = paginate(items, joinReqPage, ROWS_PER_PAGE);
  el.innerHTML = `
    <h2 style="margin-bottom:20px;">Join Requests (${items.length})</h2>
    <table>
      <thead><tr><th>Name</th><th>Department</th><th>Contact</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>
        ${pageItems.map(r => `
          <tr>
            <td>${escapeHtml(r.name)}${r.message ? `<br><small class="hint">${escapeHtml(r.message)}</small>` : ''}</td>
            <td>${escapeHtml(deptName(r.departmentId))}</td>
            <td>${escapeHtml(r.email)}${r.phone ? `<br>${escapeHtml(r.phone)}` : ''}</td>
            <td>${new Date(r.createdAt).toLocaleDateString()}</td>
            <td><span class="status-pill ${r.status === 'contacted' ? 'done' : ''}">${r.status}</span></td>
            <td class="row-actions">
              ${r.status !== 'contacted' ? `<button data-mark="${r.id}">Mark Contacted</button>` : ''}
            </td>
          </tr>
        `).join('') || `<tr><td colspan="6">No join requests yet.</td></tr>`}
      </tbody>
    </table>
    <div id="joinReqPagination"></div>
  `;
  renderPaginationControls('joinReqPagination', items.length, ROWS_PER_PAGE, joinReqPage, (p) => {
    joinReqPage = p;
    renderJoinRequests();
  });
  el.querySelectorAll('[data-mark]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetchJSON(`/api/admin/join-requests/${btn.dataset.mark}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'contacted' })
      });
      renderJoinRequests();
    });
  });
}

// ---------- prayer requests ----------
let prayerReqPage = 1;
async function renderPrayerRequests() {
  const el = document.getElementById('panel-prayerRequests');
  el.innerHTML = '<p class="empty-state">Loading...</p>';
  const items = await fetchJSON('/api/admin/prayer-requests');
  const pageItems = paginate(items, prayerReqPage, ROWS_PER_PAGE);
  el.innerHTML = `
    <h2 style="margin-bottom:20px;">Prayer Requests (${items.length})</h2>
    <table>
      <thead><tr><th>Name</th><th>Request</th><th>Contact</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>
        ${pageItems.map(r => `
          <tr>
            <td>${escapeHtml(r.name)} ${r.isPrivate ? '<span class="badge">Private</span>' : ''}</td>
            <td>${escapeHtml(r.request)}</td>
            <td>${escapeHtml(r.email || '—')}</td>
            <td>${new Date(r.createdAt).toLocaleDateString()}</td>
            <td><span class="status-pill ${r.status === 'prayed' ? 'done' : ''}">${r.status}</span></td>
            <td class="row-actions">
              ${r.status !== 'prayed' ? `<button data-mark="${r.id}">Mark Prayed</button>` : ''}
            </td>
          </tr>
        `).join('') || `<tr><td colspan="6">No prayer requests yet.</td></tr>`}
      </tbody>
    </table>
    <div id="prayerReqPagination"></div>
  `;
  renderPaginationControls('prayerReqPagination', items.length, ROWS_PER_PAGE, prayerReqPage, (p) => {
    prayerReqPage = p;
    renderPrayerRequests();
  });
  el.querySelectorAll('[data-mark]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetchJSON(`/api/admin/prayer-requests/${btn.dataset.mark}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'prayed' })
      });
      renderPrayerRequests();
    });
  });
}

// ---------- testimonies ----------
let testimoniesPage = 1;
async function renderTestimonies() {
  const el = document.getElementById('panel-testimonies');
  el.innerHTML = '<p class="empty-state">Loading...</p>';
  const items = await fetchJSON('/api/admin/testimonies');
  const pageItems = paginate(items, testimoniesPage, ROWS_PER_PAGE);
  el.innerHTML = `
    <h2 style="margin-bottom:20px;">Testimonies (${items.length})</h2>
    <table>
      <thead><tr><th>Name</th><th>Testimony</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>
        ${pageItems.map(t => `
          <tr>
            <td>${escapeHtml(t.name)}</td>
            <td>${escapeHtml(t.testimony)}</td>
            <td>${new Date(t.createdAt).toLocaleDateString()}</td>
            <td><span class="status-pill ${t.published ? 'done' : ''}">${t.published ? 'published' : 'pending'}</span></td>
            <td class="row-actions">
              <button data-toggle="${t.id}" data-current="${t.published}">${t.published ? 'Unpublish' : 'Publish'}</button>
            </td>
          </tr>
        `).join('') || `<tr><td colspan="5">No testimonies yet.</td></tr>`}
      </tbody>
    </table>
    <div id="testimoniesPagination"></div>
  `;
  renderPaginationControls('testimoniesPagination', items.length, ROWS_PER_PAGE, testimoniesPage, (p) => {
    testimoniesPage = p;
    renderTestimonies();
  });
  el.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newVal = btn.dataset.current !== 'true';
      await fetchJSON(`/api/admin/testimonies/${btn.dataset.toggle}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ published: newVal })
      });
      renderTestimonies();
    });
  });
}

// ---------- contact messages ----------
let contactMsgPage = 1;
async function renderContactMessages() {
  const el = document.getElementById('panel-contactMessages');
  el.innerHTML = '<p class="empty-state">Loading...</p>';
  const items = await fetchJSON('/api/admin/contact-messages');
  const pageItems = paginate(items, contactMsgPage, ROWS_PER_PAGE);
  el.innerHTML = `
    <h2 style="margin-bottom:20px;">Contact Messages (${items.length})</h2>
    <table>
      <thead><tr><th>Name</th><th>Email</th><th>Message</th><th>Date</th></tr></thead>
      <tbody>
        ${pageItems.map(m => `
          <tr>
            <td>${escapeHtml(m.name)}</td>
            <td>${escapeHtml(m.email)}</td>
            <td>${escapeHtml(m.message)}</td>
            <td>${new Date(m.createdAt).toLocaleDateString()}</td>
          </tr>
        `).join('') || `<tr><td colspan="4">No messages yet.</td></tr>`}
      </tbody>
    </table>
    <div id="contactMsgPagination"></div>
  `;
  renderPaginationControls('contactMsgPagination', items.length, ROWS_PER_PAGE, contactMsgPage, (p) => {
    contactMsgPage = p;
    renderContactMessages();
  });
}

// ---------- notifications ----------
let notifHistoryPage = 1;
async function renderNotifications() {
  const el = document.getElementById('panel-notifications');
  el.innerHTML = '<p class="empty-state">Loading...</p>';
  const items = await fetchJSON('/api/notifications');

  el.innerHTML = `
    <h2 style="margin-bottom:20px;">Notifications</h2>
    <div class="upload-form">
      <h3 style="margin-bottom:14px;">Send an Announcement</h3>
      <p style="font-size:0.85rem; color:#8a7595; margin-bottom:14px;">This posts to everyone's in-app notification feed and sends a real push alert to anyone who has enabled push notifications.</p>
      <form id="notifForm">
        <div class="field"><label>Title</label><input type="text" id="notifTitle" required placeholder="e.g. Service moved to 9AM"></div>
        <div class="field"><label>Message</label><textarea id="notifBody" required placeholder="Short, clear message..."></textarea></div>
        <div class="field"><label>Link (optional — where tapping the notification should go)</label>
          <select id="notifUrl">
            <option value="/index.html">Home</option>
            <option value="/events.html">Events</option>
            <option value="/media.html">Sermons & Media</option>
            <option value="/prayer.html">Prayer Wall</option>
            <option value="/bible.html">Bible</option>
            <option value="/departments.html">Departments</option>
          </select>
        </div>
        <button type="submit" class="btn btn-primary" id="notifSubmitBtn">Send Announcement</button>
        <div class="form-msg" id="notifMsg"></div>
      </form>
    </div>

    <h3 style="margin-bottom:14px;">History (${items.length})</h3>
    <table>
      <thead><tr><th>Title</th><th>Message</th><th>Source</th><th>Sent</th></tr></thead>
      <tbody>
        ${paginate(items, notifHistoryPage, ROWS_PER_PAGE).map(n => `
          <tr>
            <td>${escapeHtml(n.title)}</td>
            <td>${escapeHtml(n.body)}</td>
            <td><span class="status-pill ${n.source === 'system' ? 'done' : ''}">${n.source}</span></td>
            <td>${new Date(n.createdAt).toLocaleString()}</td>
          </tr>
        `).join('') || '<tr><td colspan="4">No notifications sent yet.</td></tr>'}
      </tbody>
    </table>
    <div id="notifHistoryPagination"></div>
  `;
  renderPaginationControls('notifHistoryPagination', items.length, ROWS_PER_PAGE, notifHistoryPage, (p) => {
    notifHistoryPage = p;
    renderNotifications();
  });

  document.getElementById('notifForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('notifSubmitBtn');
    const msg = document.getElementById('notifMsg');
    btn.disabled = true; btn.textContent = 'Sending...';
    try {
      await fetchJSON('/api/admin/notifications', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: document.getElementById('notifTitle').value,
          body: document.getElementById('notifBody').value,
          url: document.getElementById('notifUrl').value
        })
      });
      msg.textContent = 'Announcement sent!';
      msg.className = 'form-msg success';
      renderNotifications();
    } catch (err) {
      msg.textContent = err.message || 'Could not send';
      msg.className = 'form-msg error';
    } finally {
      btn.disabled = false; btn.textContent = 'Send Announcement';
    }
  });
}


// ---------- Bible Study (section 16) ----------
async function renderBibleStudies() {
  const el = document.getElementById('panel-bibleStudies');
  el.innerHTML = '<p class="empty-state">Loading...</p>';
  const studies = await fetchJSON('/api/bible-studies');

  el.innerHTML = `
    <h2 style="margin-bottom:20px;">Bible Study</h2>
    <div class="upload-form">
      <h3 style="margin-bottom:14px;">New Bible Study</h3>
      <form id="studyForm">
        <div class="field-row">
          <div class="field"><label>Topic</label><input type="text" id="stTopic" required></div>
          <div class="field"><label>Date</label><input type="date" id="stDate"></div>
        </div>
        <div class="field"><label>Scripture Reference</label><input type="text" id="stScripture" placeholder="e.g. John 3:1-21 — links straight into the Bible reader"></div>
        <div class="field"><label>Study Material</label><textarea id="stMaterial" placeholder="The main teaching content"></textarea></div>
        <div class="field"><label>Questions (one per line)</label><textarea id="stQuestions"></textarea></div>
        <div class="field"><label>Notes</label><textarea id="stNotes"></textarea></div>
        <div class="field"><label>Additional Resources (one per line)</label><textarea id="stResources"></textarea></div>
        <button type="submit" class="btn btn-primary" id="studySubmitBtn">Save Bible Study</button>
        <div class="form-msg" id="studyMsg"></div>
      </form>
    </div>
    <table>
      <thead><tr><th>Topic</th><th>Date</th><th>Scripture</th><th>Actions</th></tr></thead>
      <tbody>
        ${studies.map(s => `
          <tr>
            <td>${escapeHtml(s.topic)}</td>
            <td>${escapeHtml(s.date || '—')}</td>
            <td>${escapeHtml(s.scriptureReference || '—')}</td>
            <td class="row-actions"><button class="danger" data-delete-study="${s.id}">Delete</button></td>
          </tr>
        `).join('') || '<tr><td colspan="4">No Bible studies posted yet.</td></tr>'}
      </tbody>
    </table>
  `;

  document.getElementById('studyForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('studySubmitBtn');
    const msg = document.getElementById('studyMsg');
    btn.disabled = true;
    try {
      await fetchJSON('/api/admin/bible-studies', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: document.getElementById('stTopic').value,
          date: document.getElementById('stDate').value,
          scriptureReference: document.getElementById('stScripture').value,
          studyMaterial: document.getElementById('stMaterial').value,
          questions: document.getElementById('stQuestions').value.split('\n').map(s => s.trim()).filter(Boolean),
          notes: document.getElementById('stNotes').value,
          resources: document.getElementById('stResources').value.split('\n').map(s => s.trim()).filter(Boolean)
        })
      });
      msg.textContent = 'Bible study saved.';
      msg.className = 'form-msg success';
      renderBibleStudies();
    } catch (err) {
      msg.textContent = err.message || 'Could not save.';
      msg.className = 'form-msg error';
    } finally {
      btn.disabled = false;
    }
  });

  el.querySelectorAll('[data-delete-study]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this Bible study?')) return;
      await fetchJSON(`/api/admin/bible-studies/${btn.dataset.deleteStudy}`, { method: 'DELETE' });
      renderBibleStudies();
    });
  });
}

// ---------- Groups (section 20) ----------
const GROUP_TYPE_LABELS = { bible_study: 'Bible Study', prayer: 'Prayer', fellowship: 'Fellowship', department: 'Department', cell: 'Cell', other: 'Other' };

async function renderGroupsAdmin() {
  const el = document.getElementById('panel-groups');
  el.innerHTML = '<p class="empty-state">Loading...</p>';
  const [groups, members] = await Promise.all([fetchJSON('/api/groups'), fetchJSON('/api/admin/members')]);

  el.innerHTML = `
    <div class="panel-head">
      <h2 style="margin:0;">Groups (${groups.length})</h2>
      <button class="btn btn-primary btn-sm" id="newGroupBtn">+ New Group</button>
    </div>
    <p style="font-size:0.85rem; color:#8a7595; margin:8px 0 18px;">The group's own leader can update meeting details and resources from the group's page — this is for creating groups and reassigning leadership.</p>
    <table>
      <thead><tr><th>Name</th><th>Type</th><th>Leader</th><th>Members</th><th>Actions</th></tr></thead>
      <tbody>
        ${groups.map(g => `
          <tr>
            <td>${escapeHtml(g.name)}</td>
            <td>${GROUP_TYPE_LABELS[g.type] || g.type}</td>
            <td>${escapeHtml(g.leaderName || '—')}</td>
            <td>${g.memberCount}</td>
            <td class="row-actions">
              <button data-edit-group="${g.id}">Edit</button>
              <button class="danger" data-delete-group="${g.id}">Delete</button>
            </td>
          </tr>
        `).join('') || '<tr><td colspan="5">No groups yet.</td></tr>'}
      </tbody>
    </table>
  `;

  function openGroupForm(group) {
    const isEdit = !!group;
    showModal(`
      <h3>${isEdit ? 'Edit' : 'New'} Group</h3>
      <form id="groupForm">
        <div class="field"><label>Name</label><input type="text" id="gName" value="${escapeHtml(group?.name || '')}" required></div>
        <div class="field"><label>Type</label>
          <select id="gType">${Object.entries(GROUP_TYPE_LABELS).map(([v, l]) => `<option value="${v}" ${group?.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Description</label><textarea id="gDescription">${escapeHtml(group?.description || '')}</textarea></div>
        <div class="field"><label>Leader</label>
          <select id="gLeader">
            <option value="">No leader assigned</option>
            ${members.map(m => `<option value="${m.id}" ${group?.leaderMemberId === m.id ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field-row">
          <div class="field"><label>Meeting Day</label><input type="text" id="gDay" value="${escapeHtml(group?.meetingDay || '')}"></div>
          <div class="field"><label>Meeting Time</label><input type="text" id="gTime" value="${escapeHtml(group?.meetingTime || '')}"></div>
        </div>
        <div class="field"><label>Meeting Location</label><input type="text" id="gLocation" value="${escapeHtml(group?.meetingLocation || '')}"></div>
        <div style="display:flex; gap:10px;">
          <button type="submit" class="btn btn-primary">Save Group</button>
          <button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button>
        </div>
        <div class="form-msg" id="groupFormMsg"></div>
      </form>
    `);
    document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
    document.getElementById('groupForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        name: document.getElementById('gName').value,
        type: document.getElementById('gType').value,
        description: document.getElementById('gDescription').value,
        leaderMemberId: document.getElementById('gLeader').value,
        meetingDay: document.getElementById('gDay').value,
        meetingTime: document.getElementById('gTime').value,
        meetingLocation: document.getElementById('gLocation').value
      };
      try {
        await fetchJSON(isEdit ? `/api/admin/groups/${group.id}` : '/api/admin/groups', {
          method: isEdit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        closeModal();
        showToast('Group saved.', 'success');
        renderGroupsAdmin();
      } catch (err) {
        document.getElementById('groupFormMsg').textContent = err.message || 'Could not save.';
        document.getElementById('groupFormMsg').className = 'form-msg error';
      }
    });
  }

  document.getElementById('newGroupBtn').addEventListener('click', () => openGroupForm(null));
  el.querySelectorAll('[data-edit-group]').forEach(btn => btn.addEventListener('click', () => openGroupForm(groups.find(g => g.id === btn.dataset.editGroup))));
  el.querySelectorAll('[data-delete-group]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Delete this group? Its posts and meeting logs go with it.')) return;
    await fetchJSON(`/api/admin/groups/${btn.dataset.deleteGroup}`, { method: 'DELETE' });
    renderGroupsAdmin();
  }));
}

// ---------- Welfare (section 33) ----------
const WELFARE_STATUS_LABELS = { submitted: 'Submitted', under_review: 'Under Review', approved: 'Approved', declined: 'Declined', fulfilled: 'Fulfilled' };

async function renderWelfareAdmin() {
  const el = document.getElementById('panel-welfare');
  el.innerHTML = '<p class="empty-state">Loading...</p>';
  try {
    const items = await fetchJSON('/api/welfare/requests');
    el.innerHTML = `
      <h2 style="margin-bottom:8px;">Welfare Requests (${items.length})</h2>
      <p style="font-size:0.85rem; color:#8a7595; margin-bottom:18px;">Sensitive — visible only to Welfare Officers and Chapter Admin/Coordinator.</p>
      <table>
        <thead><tr><th>Member</th><th>Category</th><th>Description</th><th>Status</th><th>Referred By</th><th>Actions</th></tr></thead>
        <tbody>
          ${items.map(w => `
            <tr>
              <td>${escapeHtml(w.memberName || 'Unknown')}</td>
              <td>${escapeHtml(w.category)}</td>
              <td style="max-width:220px;">${escapeHtml((w.description || '').slice(0, 100))}</td>
              <td>
                <select data-status-for="${w.id}">
                  ${Object.entries(WELFARE_STATUS_LABELS).map(([v, l]) => `<option value="${v}" ${w.status === v ? 'selected' : ''}>${l}</option>`).join('')}
                </select>
              </td>
              <td>${escapeHtml(w.referredBy || '—')}</td>
              <td class="row-actions"><button data-add-note="${w.id}">Case Notes</button></td>
            </tr>
          `).join('') || '<tr><td colspan="6">No welfare requests right now.</td></tr>'}
        </tbody>
      </table>
    `;
    el.querySelectorAll('[data-status-for]').forEach(sel => sel.addEventListener('change', async () => {
      await fetchJSON(`/api/welfare/requests/${sel.dataset.statusFor}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: sel.value })
      });
      showToast('Status updated.', 'success');
    }));
    el.querySelectorAll('[data-add-note]').forEach(btn => btn.addEventListener('click', () => {
      const item = items.find(w => w.id === btn.dataset.addNote);
      showModal(`
        <h3>Case Notes — ${escapeHtml(item.memberName || 'Unknown')}</h3>
        <p style="font-size:0.85rem; color:#8a7595; margin-bottom:12px;">${escapeHtml(item.description)}</p>
        <form id="noteForm">
          <div class="field"><label>Internal Notes (never shown to the member)</label><textarea id="wNotes">${escapeHtml(item.notes || '')}</textarea></div>
          <div style="display:flex; gap:10px;">
            <button type="submit" class="btn btn-primary">Save</button>
            <button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button>
          </div>
        </form>
      `);
      document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
      document.getElementById('noteForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        await fetchJSON(`/api/welfare/requests/${item.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: document.getElementById('wNotes').value })
        });
        closeModal();
        showToast('Notes saved.', 'success');
        renderWelfareAdmin();
      });
    }));
  } catch (e) {
    el.innerHTML = `<p class="empty-state">${escapeHtml(e.message || 'Could not load welfare requests — you may not have access to this office.')}</p>`;
  }
}

// ---------- Community Chat moderation (section 19) ----------
async function renderChatModeration() {
  const el = document.getElementById('panel-chatModeration');
  el.innerHTML = '<p class="empty-state">Loading...</p>';
  const topics = await fetchJSON('/api/chat/topics');
  el.innerHTML = `
    <h2 style="margin-bottom:8px;">Community Chat Moderation</h2>
    <p style="font-size:0.85rem; color:#8a7595; margin-bottom:18px;">Lock a discussion, hide a message (never destroyed, just stops showing), or restrict a member from posting further from the Members tab.</p>
    <table>
      <thead><tr><th>Discussion</th><th>Started By</th><th>Messages</th><th>Actions</th></tr></thead>
      <tbody>
        ${topics.map(t => `
          <tr>
            <td>${escapeHtml(t.title)}</td>
            <td>${escapeHtml(t.createdByName || 'Unknown')}</td>
            <td>${t.messageCount}</td>
            <td class="row-actions">
              <button data-view-topic="${t.id}">View Messages</button>
              <button data-lock-topic="${t.id}" data-locked="${t.locked}">${t.locked ? 'Unlock' : 'Lock'}</button>
            </td>
          </tr>
        `).join('') || '<tr><td colspan="4">No discussions started yet.</td></tr>'}
      </tbody>
    </table>
  `;

  el.querySelectorAll('[data-lock-topic]').forEach(btn => btn.addEventListener('click', async () => {
    await fetchJSON(`/api/chat/topics/${btn.dataset.lockTopic}/lock`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locked: btn.dataset.locked !== 'true' })
    });
    renderChatModeration();
  }));
  el.querySelectorAll('[data-view-topic]').forEach(btn => btn.addEventListener('click', async () => {
    const messages = await fetchJSON(`/api/chat/topics/${btn.dataset.viewTopic}/messages`);
    showModal(`
      <h3>Messages</h3>
      <div class="media-grid" style="grid-template-columns:1fr;">
        ${messages.map(m => `
          <div style="border:1px solid var(--line); border-radius:8px; padding:10px 12px;">
            <strong>${escapeHtml(m.authorName || 'Unknown')}</strong>
            <p style="margin:4px 0;">${escapeHtml(m.body)}</p>
            ${m.reportCount ? `<span class="status-pill" style="background:#FBDFDA; color:#A93226;">${m.reportCount} report(s)</span>` : ''}
            <button data-hide-msg="${m.id}" style="margin-top:6px;">Hide This Message</button>
          </div>
        `).join('') || '<p class="empty-state">No messages yet.</p>'}
      </div>
      <button type="button" class="btn btn-outline" id="cancelModalBtn" style="margin-top:14px;">Close</button>
    `, true);
    document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
    document.querySelectorAll('[data-hide-msg]').forEach(hideBtn => hideBtn.addEventListener('click', async () => {
      await fetchJSON(`/api/chat/messages/${hideBtn.dataset.hideMsg}/moderate`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hidden: true })
      });
      showToast('Message hidden.', 'success');
      closeModal();
      renderChatModeration();
    }));
  }));
}

let membersPage = 1;
const MEMBERS_PER_PAGE = 15;

async function renderMembers() {
  const el = document.getElementById('panel-members');
  el.innerHTML = '<p class="empty-state">Loading...</p>';
  const members = await fetchJSON('/api/admin/members');
  const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const bday = (m) => m.birthdayMonth && m.birthdayDay ? `${monthNames[m.birthdayMonth]} ${m.birthdayDay}` : '—';
  const pageItems = paginate(members, membersPage, MEMBERS_PER_PAGE);

  el.innerHTML = `
    <h2 style="margin-bottom:20px;">Members (${members.length})</h2>
    <p style="font-size:0.85rem; color:#8a7595; margin:-12px 0 18px;">Membership status (visitor → active) is moved forward by Shepherding, not from here.</p>
    <table>
      <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Level</th><th>Status</th><th>Birthday</th><th>Joined</th><th>Actions</th></tr></thead>
      <tbody>
        ${pageItems.map(m => `
          <tr>
            <td>${escapeHtml(m.name)}</td>
            <td>${escapeHtml(m.email)}</td>
            <td>${escapeHtml(m.phone || '—')}</td>
            <td>${escapeHtml(m.level || '—')}</td>
            <td><span class="status-pill ${m.membershipStage === 'active' ? 'done' : ''}">${escapeHtml(m.membershipStage || 'visitor')}</span></td>
            <td>${bday(m)}</td>
            <td>${new Date(m.createdAt).toLocaleDateString()}</td>
            <td class="row-actions">
              <button data-edit-member="${m.id}">Edit</button>
              <button class="danger" data-delete-member="${m.id}">Delete</button>
            </td>
          </tr>
        `).join('') || '<tr><td colspan="8">No members have signed up yet.</td></tr>'}
      </tbody>
    </table>
    <div id="membersPagination"></div>
  `;

  renderPaginationControls('membersPagination', members.length, MEMBERS_PER_PAGE, membersPage, (p) => {
    membersPage = p;
    renderMembers();
  });

  el.querySelectorAll('[data-edit-member]').forEach(btn => {
    btn.addEventListener('click', () => {
      const member = members.find(m => m.id === btn.dataset.editMember);
      openMemberEditForm(member);
    });
  });
  el.querySelectorAll('[data-delete-member]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm("Delete this member's account? This can't be undone.")) return;
      await fetchJSON(`/api/admin/members/${btn.dataset.deleteMember}`, { method: 'DELETE' });
      renderMembers();
    });
  });
}

function openMemberEditForm(member) {
  showModal(`
    <h3>Edit Member</h3>
    <p style="font-size:0.85rem; color:#8a7595; margin-bottom:14px;">Email and password can only be changed by the member themselves, from their own account.</p>
    <form id="memberEditForm">
      <div class="field"><label>Full Name</label><input type="text" id="editMemberName" value="${escapeHtml(member.name || '')}" required></div>
      <div class="field"><label>Phone</label><input type="tel" id="editMemberPhone" value="${escapeHtml(member.phone || '')}"></div>
      <div class="field-row">
        <div class="field"><label>Level / Year of Study</label><input type="text" id="editMemberLevel" value="${escapeHtml(member.level || '')}"></div>
        <div class="field"><label>Programme</label><input type="text" id="editMemberProgramme" value="${escapeHtml(member.programme || '')}"></div>
      </div>
      <div class="field"><label>Hostel / Residence</label><input type="text" id="editMemberHostel" value="${escapeHtml(member.hostel || '')}"></div>
      <div class="field checkbox-field">
        <input type="checkbox" id="editMemberChatRestricted" ${member.chatRestricted ? 'checked' : ''}>
        <label for="editMemberChatRestricted" style="margin:0;">Restrict from Community Chat (can still read, can't post)</label>
      </div>
      <div style="display:flex; gap:10px;">
        <button type="submit" class="btn btn-primary">Save</button>
        <button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button>
      </div>
      <div class="form-msg" id="memberEditMsg"></div>
    </form>
  `);
  document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
  document.getElementById('memberEditForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await fetchJSON(`/api/admin/members/${member.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('editMemberName').value,
          phone: document.getElementById('editMemberPhone').value,
          level: document.getElementById('editMemberLevel').value,
          programme: document.getElementById('editMemberProgramme').value,
          hostel: document.getElementById('editMemberHostel').value
        })
      });
      const chatRestricted = document.getElementById('editMemberChatRestricted').checked;
      if (chatRestricted !== !!member.chatRestricted) {
        await fetchJSON(`/api/admin/members/${member.id}/chat-restriction`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatRestricted })
        });
      }
      closeModal();
      showToast('Member updated.', 'success');
      renderMembers();
    } catch (err) {
      document.getElementById('memberEditMsg').textContent = err.message || 'Could not save.';
      document.getElementById('memberEditMsg').className = 'form-msg error';
    }
  });
}


async function renderExecutives() {
  const el = document.getElementById('panel-executives');
  el.innerHTML = '<p class="empty-state">Loading...</p>';
  const [execs, applications] = await Promise.all([
    fetchJSON('/api/executives'),
    fetchJSON('/api/admin/executive-applications').catch(() => [])
  ]);

  el.innerHTML = `
    <h2 style="margin-bottom:20px;">Executives</h2>
    <div class="portal-card" style="margin-bottom:22px;">
      <h3>Executive Applications (${applications.length})</h3>
      <p class="hint">Review these the same way you review members. Approving verifies the member and activates their executive identity.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Contact</th><th>Role</th><th>Department</th><th>Scope</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${applications.map(a => `
          <tr>
            <td>${escapeHtml(a.name || '—')}</td>
            <td>${escapeHtml(a.email || '—')}</td>
            <td>${escapeHtml(a.role || '—')}</td>
            <td>${escapeHtml(a.department || '—')}</td>
            <td>${escapeHtml(a.scope || '—')}</td>
            <td><span class="status-pill ${a.executiveStatus === 'verified' ? 'done' : ''}">${escapeHtml(a.executiveStatus || 'pending')}</span></td>
            <td class="row-actions">${a.executiveStatus === 'pending' ? `
              <button data-verify-exec="${a.memberId}">Verify</button>
              <button class="danger" data-reject-exec="${a.memberId}">Reject</button>` : '—'}</td>
          </tr>`).join('') || '<tr><td colspan="7">No executive applications yet.</td></tr>'}
        </tbody>
      </table></div>
    </div>
    <div class="upload-form">
      <h3 style="margin-bottom:14px;">Add an Executive</h3>
      <form id="execForm">
        <div class="field-row">
          <div class="field"><label>Full Name</label><input type="text" id="execName" required></div>
          <div class="field"><label>Role / Position</label><input type="text" id="execRole" placeholder="e.g. President" required></div>
        </div>
        <div class="field"><label>Bio / Credentials</label><textarea id="execBio" placeholder="Short bio, course of study, achievements..."></textarea></div>
        <div class="field-row">
          <div class="field"><label>Display Order (lower shows first)</label><input type="number" id="execOrder" value="0"></div>
          <div class="field"><label>Photo</label><input type="file" id="execImage" accept="image/*"></div>
        </div>
        <button type="submit" class="btn btn-primary" id="execSubmitBtn">Add Executive</button>
        <div class="form-msg" id="execMsg"></div>
      </form>
    </div>
    <div class="media-grid" id="execGridAdmin">
      ${execs.map(e => execCardHtml(e)).join('') || '<p class="empty-state">No executives added yet.</p>'}
    </div>
  `;

  el.querySelectorAll('[data-verify-exec], [data-reject-exec]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const decision = btn.dataset.verifyExec ? 'approve' : 'reject';
      if (decision === 'reject' && !confirm('Reject this executive application?')) return;
      await fetchJSON(`/api/admin/executive-applications/${btn.dataset.verifyExec || btn.dataset.rejectExec}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision })
      });
      showToast(decision === 'approve' ? 'Executive verified.' : 'Application rejected.', 'success');
      renderExecutives();
    });
  });

  document.getElementById('execForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('execSubmitBtn');
    const msg = document.getElementById('execMsg');
    btn.disabled = true; btn.textContent = 'Saving...';
    const formData = new FormData();
    formData.append('name', document.getElementById('execName').value);
    formData.append('role', document.getElementById('execRole').value);
    formData.append('bio', document.getElementById('execBio').value);
    formData.append('order', document.getElementById('execOrder').value);
    const fileInput = document.getElementById('execImage');
    if (fileInput.files.length) formData.append('image', fileInput.files[0]);
    try {
      const res = await fetch('/api/admin/executives', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save');
      msg.textContent = 'Executive added.';
      msg.className = 'form-msg success';
      renderExecutives();
    } catch (err) {
      msg.textContent = err.message;
      msg.className = 'form-msg error';
    } finally {
      btn.disabled = false; btn.textContent = 'Add Executive';
    }
  });

  document.querySelectorAll('[data-delete-exec]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this executive?')) return;
      await fetchJSON(`/api/admin/executives/${btn.dataset.deleteExec}`, { method: 'DELETE' });
      renderExecutives();
    });
  });
  document.querySelectorAll('[data-edit-exec]').forEach(btn => {
    btn.addEventListener('click', () => {
      const exec = execs.find(x => x.id === btn.dataset.editExec);
      openExecEditForm(exec);
    });
  });
}

function execCardHtml(e) {
  return `
    <div class="media-card">
      <div class="thumb">${e.imageFileId ? `<img src="/api/files/${e.imageFileId}" alt="${escapeHtml(e.name)}">` : '<span style="font-family:var(--font-display); font-size:1.4rem; color:var(--purple-deep);">' + escapeHtml((e.name || '?').charAt(0)) + '</span>'}</div>
      <div class="info">
        <h4>${escapeHtml(e.name)}</h4>
        <small>${escapeHtml(e.role || '')}</small>
        <div class="row-actions" style="margin-top:8px;">
          <button data-edit-exec="${e.id}">Edit</button>
          <button class="danger" data-delete-exec="${e.id}">Delete</button>
        </div>
      </div>
    </div>
  `;
}

function openExecEditForm(exec) {
  showModal(`
    <h3>Edit Executive</h3>
    <form id="execEditForm">
      <div class="field"><label>Full Name</label><input type="text" id="editExecName" value="${escapeHtml(exec.name || '')}" required></div>
      <div class="field"><label>Role / Position</label><input type="text" id="editExecRole" value="${escapeHtml(exec.role || '')}" required></div>
      <div class="field"><label>Bio / Credentials</label><textarea id="editExecBio">${escapeHtml(exec.bio || '')}</textarea></div>
      <div class="field"><label>Display Order</label><input type="number" id="editExecOrder" value="${exec.order || 0}"></div>
      <div class="field"><label>Replace Photo (optional)</label><input type="file" id="editExecImage" accept="image/*"></div>
      <div style="display:flex; gap:10px;">
        <button type="submit" class="btn btn-primary">Save</button>
        <button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button>
      </div>
      <div class="form-msg" id="editExecMsg"></div>
    </form>
  `);
  document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
  document.getElementById('execEditForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData();
    formData.append('name', document.getElementById('editExecName').value);
    formData.append('role', document.getElementById('editExecRole').value);
    formData.append('bio', document.getElementById('editExecBio').value);
    formData.append('order', document.getElementById('editExecOrder').value);
    const fileInput = document.getElementById('editExecImage');
    if (fileInput.files.length) formData.append('image', fileInput.files[0]);
    try {
      const res = await fetch(`/api/admin/executives/${exec.id}`, { method: 'PUT', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save');
      closeModal();
      renderExecutives();
    } catch (err) {
      document.getElementById('editExecMsg').textContent = err.message;
      document.getElementById('editExecMsg').className = 'form-msg error';
    }
  });
}


async function openRegistrationsModal(eventId, title) {
  showModal(`<h3>Registrations — ${escapeHtml(title)}</h3><p class="empty-state">Loading...</p>`);
  try {
    const regs = await fetchJSON(`/api/admin/events/${eventId}/registrations`);
    document.getElementById('modalContent').innerHTML = `
      <h3>Registrations — ${escapeHtml(title)}</h3>
      <p style="color:#8a7595; font-size:0.85rem; margin-bottom:14px;">${regs.length} ${regs.length === 1 ? 'person' : 'people'} registered</p>
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Phone</th></tr></thead>
        <tbody>
          ${regs.map(r => `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.email)}</td><td>${escapeHtml(r.phone || '—')}</td></tr>`).join('') || '<tr><td colspan="3">No registrations yet.</td></tr>'}
        </tbody>
      </table>
      <button type="button" class="btn btn-outline" id="cancelModalBtn" style="margin-top:16px;">Close</button>
    `;
    document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
  } catch (e) {
    document.getElementById('modalContent').innerHTML = '<p class="empty-state">Could not load registrations.</p>';
  }
}

// ---------- media library ----------
let mediaLibraryPage = 1;
const MEDIA_PER_PAGE = 12;
// Placement options and their targets, loaded with the panel and reused by the
// cards so each one can say where its image actually ended up.
let MEDIA_PLACEMENTS = { placements: [], departments: [], pages: [] };
async function renderMediaLibrary() {
  const el = document.getElementById('panel-media');
  el.innerHTML = '<p class="empty-state">Loading...</p>';
  const [files, pages, placementData] = await Promise.all([
    fetchJSON('/api/files'),
    fetchJSON('/api/pages'),
    fetchJSON('/api/admin/image-placements')
  ]);
  const galleryBookPages = pages.filter(p => p.type === 'gallery' || p.type === 'bookshelf');
  MEDIA_PLACEMENTS = placementData;

  el.innerHTML = `
    <h2 style="margin-bottom:20px;">Media Library</h2>
    <div class="upload-form">
      <h3 style="margin-bottom:6px;">Upload a File</h3>
      <p style="font-size:0.85rem; color:#8a7595; margin-bottom:16px;">
        Say where the image is going and the app puts it there for you — no second step, and no guessing later about
        which picture is doing what.
      </p>
      <form id="uploadForm">
        <div class="field">
          <label>Where will this image be used?</label>
          <select id="uploadPlacement">
            ${placementData.placements.map(p => `<option value="${p.value}">${escapeHtml(p.label)}</option>`).join('')}
          </select>
        </div>

        <div class="field" id="targetFieldWrap" style="display:none;">
          <label id="targetLabel">Which one?</label>
          <select id="uploadTarget"></select>
        </div>

        <div id="placementExplain" style="background:var(--lilac-light); border-left:3px solid var(--flame-gold); border-radius:8px; padding:12px 14px; font-size:0.85rem; color:var(--purple-rich); margin-bottom:18px;"></div>

        <div class="field-row">
          <div class="field">
            <label>File Type</label>
            <select id="uploadCategory">
              <option value="photo">Photo (Sunday service pictures, etc.)</option>
              <option value="book">E-Book / Document</option>
            </select>
          </div>
          <div class="field">
            <label>Title</label>
            <input type="text" id="uploadTitle" placeholder="e.g. Sunday Service — July 12">
          </div>
        </div>
        <div class="field">
          <label>Description (optional)</label>
          <input type="text" id="uploadDescription">
        </div>
        <div class="field">
          <label>File (images or PDF, up to 30MB)</label>
          <input type="file" id="uploadFile" required>
        </div>
        <button type="submit" class="btn btn-primary" id="uploadSubmitBtn">Upload</button>
        <div class="form-msg" id="uploadMsg"></div>
      </form>
      ${!galleryBookPages.length ? '<small class="hint">Tip: create a Gallery or Bookshelf page under "Custom Pages" first, so photos can be placed on it.</small>' : ''}
    </div>

    <h3 style="margin-bottom:14px;">All Files (${files.length})</h3>
    <div class="media-grid" id="mediaGrid">
      ${paginate(files, mediaLibraryPage, MEDIA_PER_PAGE).map(f => mediaCardHtml(f)).join('') || '<p class="empty-state">No files uploaded yet.</p>'}
    </div>
    <div id="mediaPagination"></div>
  `;
  renderPaginationControls('mediaPagination', files.length, MEDIA_PER_PAGE, mediaLibraryPage, (p) => {
    mediaLibraryPage = p;
    renderMediaLibrary();
  });

  // The whole point of the picker: as soon as a placement is chosen, say in plain
  // words where the image will show up — and, when it needs one, ask which
  // department or page it belongs to.
  function refreshPlacementUI() {
    const value = document.getElementById('uploadPlacement').value;
    const spec = placementData.placements.find(p => p.value === value);
    const wrap = document.getElementById('targetFieldWrap');
    const targetSelect = document.getElementById('uploadTarget');
    const explain = document.getElementById('placementExplain');

    if (spec.needsTarget) {
      const list = spec.needsTarget === 'department' ? placementData.departments : placementData.pages;
      document.getElementById('targetLabel').textContent =
        spec.needsTarget === 'department' ? 'Which department?' : 'Which page?';
      targetSelect.innerHTML = list.length
        ? list.map(t => `<option value="${t.id}">${escapeHtml(t.name)}${t.hasHeader ? ' (replaces current header)' : ''}</option>`).join('')
        : `<option value="">— no ${spec.needsTarget}s exist yet —</option>`;
      wrap.style.display = 'block';
    } else {
      wrap.style.display = 'none';
      targetSelect.innerHTML = '';
    }

    const targetName = spec.needsTarget
      ? (targetSelect.options[targetSelect.selectedIndex] || {}).text || ''
      : '';
    const messages = {
      'department-header': `This image becomes the banner across the top of the <strong>${escapeHtml(targetName.replace(' (replaces current header)', '') || 'selected')}</strong> department page, and appears on its card in the departments list. Landscape photos work best.`,
      'page-gallery': `This image is added to the <strong>${escapeHtml(targetName || 'selected')}</strong> page, where members will see it in that page's gallery.`,
      'home-header': 'This image becomes the large weekly header banner at the top of the home page. It is different from the floating decorative photo.',
      'home-floating': 'This image drifts around the hero area on the home page and department pages as a decorative photo. Only the first few uploaded are used, and they are hidden on small phones.',
      'executive-photo': 'This image is kept in the library ready to use as an executive portrait. Attach it to a person from the <strong>Executives</strong> panel.',
      'library': 'Nothing on the public site changes. The image simply sits in the library until you place it somewhere.'
    };
    explain.innerHTML = `<strong>Where this goes:</strong> ${messages[value] || spec.description}`;
    // A department header is always a photo, never a document.
    if (value === 'department-header' || value === 'home-header' || value === 'home-floating' || value === 'executive-photo') {
      document.getElementById('uploadCategory').value = 'photo';
    }
  }

  document.getElementById('uploadPlacement').addEventListener('change', refreshPlacementUI);
  document.getElementById('uploadTarget').addEventListener('change', refreshPlacementUI);
  refreshPlacementUI();

  document.getElementById('uploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('uploadSubmitBtn');
    const msg = document.getElementById('uploadMsg');
    const fileInput = document.getElementById('uploadFile');
    if (!fileInput.files.length) return;
    btn.disabled = true; btn.textContent = 'Uploading...';
    const placement = document.getElementById('uploadPlacement').value;
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('category', document.getElementById('uploadCategory').value);
    formData.append('placement', placement);
    formData.append('targetId', document.getElementById('uploadTarget').value || '');
    formData.append('title', document.getElementById('uploadTitle').value);
    formData.append('description', document.getElementById('uploadDescription').value);
    try {
      const res = await fetch('/api/admin/uploads', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      msg.textContent = data.message ? `Uploaded — ${data.message}` : 'Uploaded!';
      msg.className = 'form-msg success';
      showToast('Image uploaded and placed.', 'success');
      renderMediaLibrary();
    } catch (err) {
      msg.textContent = err.message || 'Upload failed.';
      msg.className = 'form-msg error';
    } finally {
      btn.disabled = false; btn.textContent = 'Upload';
    }
  });

  document.querySelectorAll('[data-delete-file]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this file? This cannot be undone.')) return;
      await fetchJSON(`/api/admin/files/${btn.dataset.deleteFile}`, { method: 'DELETE' });
      renderMediaLibrary();
    });
  });
}

// Where each file ended up, in the admin's own words rather than a raw key.
function placementSummary(f) {
  const data = MEDIA_PLACEMENTS;
  const name = (list, id) => ((list || []).find(t => t.id === id) || {}).name || id;
  switch (f.placement) {
    case 'department-header': return `Header for ${name(data.departments, f.targetId)}`;
    case 'page-gallery': return `On the ${name(data.pages, f.targetId || f.pageSlug)} page`;
    case 'home-header': return 'Home page header banner';
    case 'home-floating': return 'Floating photo on the home page';
    case 'executive-photo': return 'Executive portrait';
    default: return f.pageSlug ? `On the ${escapeHtml(f.pageSlug)} page` : 'In the library only';
  }
}

function mediaCardHtml(f) {
  const isImage = (f.contentType || '').startsWith('image/');
  return `
    <div class="media-card">
      <div class="thumb ${isImage ? '' : 'doc'}">
        ${isImage ? `<img src="/api/files/${f.id}" alt="${escapeHtml(f.title)}">` : (f.contentType.includes('pdf') ? 'PDF' : 'FILE')}
      </div>
      <div class="info">
        <h4>${escapeHtml(f.title)}</h4>
        <small style="display:block; color:var(--purple-deep); font-weight:700;">${escapeHtml(placementSummary(f))}</small>
        <small>${f.category} · ${formatFileSize(f.length)}</small>
        <div class="row-actions" style="margin-top:8px;">
          <button class="danger" data-delete-file="${f.id}">Delete</button>
        </div>
      </div>
    </div>
  `;
}

// ---------- form builder ----------
const FORM_FIELD_TYPE_LABELS = {
  short_text: 'Short text', long_text: 'Long text', multiple_choice: 'Multiple choice',
  checkboxes: 'Checkboxes', dropdown: 'Dropdown', date: 'Date', time: 'Time',
  phone: 'Phone', email: 'Email', file: 'File upload'
};
const FORM_CATEGORY_LABELS = {
  event_registration: 'Event Registration', travelling_event: 'Travelling Event',
  executive: 'Executive Info', department: 'Department Activity', welfare: 'Welfare', custom: 'Custom'
};

function formFieldRow(field) {
  const f = field || { id: '', label: '', type: 'short_text', required: false, options: [] };
  const needsOptions = ['multiple_choice', 'checkboxes', 'dropdown'].includes(f.type);
  return `
    <div class="media-card" data-field-row style="padding:14px; margin-bottom:10px;">
      <input type="hidden" data-field-id value="${escapeHtml(f.id || '')}">
      <div class="field-row">
        <div class="field"><label>Question</label><input type="text" data-field-label value="${escapeHtml(f.label || '')}" required></div>
        <div class="field"><label>Type</label>
          <select data-field-type>
            ${Object.entries(FORM_FIELD_TYPE_LABELS).map(([value, label]) => `<option value="${value}" ${f.type === value ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field" data-options-field style="${needsOptions ? '' : 'display:none;'}">
        <label>Options (one per line)</label>
        <textarea data-field-options rows="3">${escapeHtml((f.options || []).join('\n'))}</textarea>
      </div>
      <label style="display:flex; align-items:center; gap:8px; font-size:0.85rem; font-weight:700; color:var(--purple-rich);">
        <input type="checkbox" data-field-required style="width:auto;" ${f.required ? 'checked' : ''}> Required
      </label>
      <button type="button" class="btn btn-outline btn-sm" data-remove-field style="margin-top:8px;">Remove Question</button>
    </div>
  `;
}

function wireFormFieldRows(host) {
  host.querySelectorAll('[data-field-type]').forEach((select) => {
    select.onchange = () => {
      const row = select.closest('[data-field-row]');
      row.querySelector('[data-options-field]').style.display = ['multiple_choice', 'checkboxes', 'dropdown'].includes(select.value) ? '' : 'none';
    };
  });
  host.querySelectorAll('[data-remove-field]').forEach((btn) => {
    btn.onclick = () => {
      if (host.querySelectorAll('[data-field-row]').length === 1) return;
      btn.closest('[data-field-row]').remove();
    };
  });
}

function collectFormFields(host) {
  return [...host.querySelectorAll('[data-field-row]')].map((row, i) => ({
    id: row.querySelector('[data-field-id]').value || undefined,
    label: row.querySelector('[data-field-label]').value.trim(),
    type: row.querySelector('[data-field-type]').value,
    required: row.querySelector('[data-field-required]').checked,
    options: row.querySelector('[data-field-options]').value.split('\n').map(s => s.trim()).filter(Boolean),
    order: i
  })).filter(field => field.label);
}

async function openFormBuilder(form) {
  const isEdit = !!form;
  const fields = form ? form.fields : [{}];
  const chapters = ADMIN_SCOPE.isNational ? await fetchJSON('/api/national/chapters').catch(() => []) : [];
  const defaultChapterId = form?.chapterId || ADMIN_SCOPE.chapterId || (chapters[0] && chapters[0].id) || '';
  showModal(`
    <h3>${isEdit ? 'Edit' : 'New'} Form</h3>
    <form id="formBuilderForm">
      <div class="field"><label>Title</label><input type="text" id="fTitle" value="${escapeHtml(form?.title || '')}" required></div>
      <div class="field"><label>Description</label><textarea id="fDescription" rows="2">${escapeHtml(form?.description || '')}</textarea></div>
      <div class="field-row">
        <div class="field"><label>Category</label>
          <select id="fCategory">${Object.entries(FORM_CATEGORY_LABELS).map(([value, label]) => `<option value="${value}" ${form?.category === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Closes At (optional)</label><input type="datetime-local" id="fClosesAt" value="${escapeHtml((form?.closesAt || '').slice(0, 16))}"></div>
      </div>
      ${ADMIN_SCOPE.isNational ? `
        <div class="field"><label>Chapter</label>
          <select id="fChapterId" ${chapters.length ? '' : 'disabled'}>
            ${chapters.map(c => `<option value="${c.id}" ${defaultChapterId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>
      ` : ''}
      <label style="display:block; font-weight:700; font-size:0.85rem; margin:14px 0 8px; color:var(--purple-rich);">Questions</label>
      <div id="fieldRows">${fields.map((field) => formFieldRow(field)).join('')}</div>
      <button type="button" class="btn btn-outline btn-sm" id="addFieldBtn">+ Add Question</button>
      <div style="display:flex; gap:10px; margin-top:20px;">
        <button type="submit" class="btn btn-primary">Save Form</button>
        <button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button>
      </div>
      <div class="form-msg" id="formBuilderMsg"></div>
    </form>
  `);
  const rowsHost = document.getElementById('fieldRows');
  wireFormFieldRows(rowsHost);
  document.getElementById('addFieldBtn').addEventListener('click', () => {
    rowsHost.insertAdjacentHTML('beforeend', formFieldRow(null));
    wireFormFieldRows(rowsHost);
  });
  document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
  document.getElementById('formBuilderForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      title: document.getElementById('fTitle').value,
      description: document.getElementById('fDescription').value,
      category: document.getElementById('fCategory').value,
      closesAt: document.getElementById('fClosesAt').value || '',
      fields: collectFormFields(rowsHost)
    };
    const chapterField = document.getElementById('fChapterId');
    if (chapterField && chapterField.value) payload.chapterId = chapterField.value;
    try {
      await fetchJSON(isEdit ? `/api/admin/forms/${form.id}` : '/api/admin/forms', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      closeModal();
      showToast('Form saved.', 'success');
      renderFormsAdmin();
    } catch (err) {
      document.getElementById('formBuilderMsg').textContent = err.message || 'Could not save this form.';
      document.getElementById('formBuilderMsg').className = 'form-msg error';
    }
  });
}

async function viewFormSubmissions(formId) {
  const { form, submissions } = await fetchJSON(`/api/admin/forms/${formId}/submissions`);
  showModal(`
    <h3>${escapeHtml(form.title)} — Submissions (${submissions.length})</h3>
    <div style="overflow:auto; max-height:60vh;">
      <table>
        <thead><tr><th>Submitted By</th><th>When</th>${form.fields.map(field => `<th>${escapeHtml(field.label)}</th>`).join('')}</tr></thead>
        <tbody>
          ${submissions.map(item => `
            <tr>
              <td>${escapeHtml(item.submitterName || 'Anonymous')}${item.submitterEmail ? `<br><small class="hint">${escapeHtml(item.submitterEmail)}</small>` : ''}</td>
              <td>${new Date(item.createdAt).toLocaleString()}</td>
              ${form.fields.map(field => `<td>${escapeHtml(String(item.answers?.[field.id] ?? '—'))}</td>`).join('')}
            </tr>
          `).join('') || `<tr><td colspan="${form.fields.length + 2}">No submissions yet.</td></tr>`}
        </tbody>
      </table>
    </div>
    <div style="margin-top:18px;"><button type="button" class="btn btn-outline" id="cancelModalBtn">Close</button></div>
  `);
  document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
}

async function renderFormsAdmin() {
  const el = document.getElementById('panel-forms');
  el.innerHTML = '<p class="empty-state">Loading...</p>';
  try {
    const forms = await fetchJSON('/api/admin/forms');
    el.innerHTML = `
      <div class="panel-head">
        <div>
          <h2 style="margin:0 0 4px;">Dynamic Form Builder</h2>
          <p style="color:#7a6288; font-size:0.88rem; margin:0;">Create reusable forms for registrations, executive info, department workflows, and welfare follow-up.</p>
        </div>
        <button class="btn btn-primary btn-sm" id="newFormBtn">+ New Form</button>
      </div>
      <table>
        <thead><tr><th>Title</th><th>Category</th><th>Questions</th><th>Status</th><th>Submissions</th><th>Actions</th></tr></thead>
        <tbody>
          ${forms.map(form => `
            <tr>
              <td><strong>${escapeHtml(form.title)}</strong>${form.description ? `<br><small class="hint">${escapeHtml(form.description)}</small>` : ''}</td>
              <td>${escapeHtml(FORM_CATEGORY_LABELS[form.category] || form.category || 'Custom')}</td>
              <td>${Array.isArray(form.fields) ? form.fields.length : (form.fieldCount || 0)}</td>
              <td><span class="status-pill ${form.isOpen ? 'done' : ''}">${form.isOpen ? 'open' : 'closed'}</span></td>
              <td><button type="button" data-view-form-subs="${form.id}">View</button></td>
              <td class="row-actions">
                <button type="button" data-edit-form="${form.id}">Edit</button>
                <button type="button" data-toggle-form="${form.id}">${form.isOpen ? 'Close' : 'Reopen'}</button>
                <button type="button" class="danger" data-delete-form="${form.id}">Delete</button>
              </td>
            </tr>
          `).join('') || '<tr><td colspan="6">No forms created yet.</td></tr>'}
        </tbody>
      </table>
    `;
    document.getElementById('newFormBtn').addEventListener('click', () => openFormBuilder(null));
    el.querySelectorAll('[data-edit-form]').forEach((btn) => btn.addEventListener('click', () => openFormBuilder(forms.find(form => form.id === btn.dataset.editForm))));
    el.querySelectorAll('[data-view-form-subs]').forEach((btn) => btn.addEventListener('click', () => viewFormSubmissions(btn.dataset.viewFormSubs)));
    el.querySelectorAll('[data-toggle-form]').forEach((btn) => btn.addEventListener('click', async () => {
      const form = forms.find(item => item.id === btn.dataset.toggleForm);
      await fetchJSON(`/api/admin/forms/${form.id}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isOpen: !form.isOpen })
      });
      showToast(form.isOpen ? 'Form closed.' : 'Form reopened.', 'success');
      renderFormsAdmin();
    }));
    el.querySelectorAll('[data-delete-form]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!confirm('Delete this form and its submissions? This cannot be undone.')) return;
      await fetchJSON(`/api/admin/forms/${btn.dataset.deleteForm}`, { method: 'DELETE' });
      showToast('Form deleted.', 'success');
      renderFormsAdmin();
    }));
  } catch (err) {
    el.innerHTML = `<p class="empty-state">${escapeHtml(err.message || 'Could not load forms.')}</p>`;
  }
}

async function renderReportsPanel() {
  const el = document.getElementById('panel-reports');
  const cards = [
    { title: 'Membership Report', desc: 'Download the latest membership PDF from the shepherding tools.', href: '/api/shepherd/members/report.pdf', cta: 'Download PDF' },
    { title: 'Attendance Summary', desc: 'Export chapter attendance percentage summaries as PDF.', href: '/api/shepherd/attendance-summary.pdf', cta: 'Download PDF' },
    { title: 'Finance Ledger PDF', desc: 'Generate a printable PDF version of the finance ledger.', href: '/api/finance/export.pdf', cta: 'Download PDF' },
    { title: 'Finance Ledger CSV', desc: 'Download the finance ledger as CSV for spreadsheets and reporting.', href: '/api/finance/export.csv', cta: 'Download CSV' },
    { title: 'Open Shepherding Portal', desc: 'Use the shepherding portal for attendance registers and pastoral care workflows.', href: '/shepherding.html', cta: 'Open Portal' },
    { title: 'Open Finance Portal', desc: 'Use the finance portal for budgets, entries, and ledger filtering before export.', href: '/finance.html', cta: 'Open Portal' }
  ];
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2 style="margin:0 0 4px;">Reports &amp; PDF Export</h2>
        <p style="color:#7a6288; font-size:0.88rem; margin:0;">Quick access to the existing membership, attendance, and finance exports. Some links require coordinator or office-level permissions.</p>
      </div>
    </div>
    <div class="media-grid" style="grid-template-columns: repeat(auto-fit, minmax(220px,1fr));">
      ${cards.map(card => `
        <div class="media-card" style="padding:18px;">
          <h4 style="margin:0 0 8px;">${escapeHtml(card.title)}</h4>
          <p style="font-size:0.84rem; color:#7a6288; margin:0 0 14px;">${escapeHtml(card.desc)}</p>
          <a class="btn btn-outline btn-sm" href="${card.href}" ${card.href.endsWith('.html') ? '' : 'target="_blank" rel="noopener"'}>${escapeHtml(card.cta)}</a>
        </div>
      `).join('')}
    </div>
  `;
}


async function renderSettings() {
  const el = document.getElementById('panel-settings');
  el.innerHTML = '<p class="empty-state">Loading...</p>';
  const settings = await fetchJSON('/api/settings?global=1');
  CURRENT_SETTINGS = settings;
  const fields = [
    { key: 'fellowshipName', label: 'Short Name' },
    { key: 'fullName', label: 'Full Name' },
    { key: 'tagline', label: 'Tagline' },
    { key: 'verseOfTheWeek', label: 'Verse of the Week' },
    { key: 'address', label: 'Address' },
    { key: 'email', label: 'Contact Email (everything goes here unless an office address is set below)' },
    { key: 'shepherdingEmail', label: 'Shepherding Email (contact-form messages)' },
    { key: 'publicityEmail', label: 'Publicity Email (new testimonies)' },
    { key: 'financeEmail', label: 'Finance Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'whatsapp', label: 'WhatsApp Number (digits only, with country code)' },
    { key: 'instagram', label: 'Instagram URL' },
    { key: 'facebook', label: 'Facebook URL' },
    { key: 'youtube', label: 'YouTube URL' },
    { key: 'twitter', label: 'X / Twitter URL' },
    { key: 'tiktok', label: 'TikTok URL' },
    { key: 'telegram', label: 'Telegram URL' },
    { key: 'spotify', label: 'Spotify Playlist or Profile URL' },
    { key: 'homeHeaderImageFileId', label: 'Home Header Image File ID (recommended: set via Media Library > Home page header banner)' }
  ];
  el.innerHTML = `
    <h2 style="margin-bottom:20px;">Site Settings</h2>
    <form class="form-card" id="settingsForm" style="max-width:640px; margin:0;">
      ${fields.map(f => `
        <div class="field">
          <label>${f.label}</label>
          <input type="text" data-key="${f.key}" value="${escapeHtml(settings[f.key] || '')}">
        </div>
      `).join('')}
      <button type="submit" class="btn btn-primary btn-block">Save Settings</button>
      <div class="form-msg" id="settingsMsg"></div>
    </form>
  `;
  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = { ...settings };
    fields.forEach(f => { payload[f.key] = document.querySelector(`[data-key="${f.key}"]`).value; });
    try {
      await fetchJSON('/api/admin/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      document.getElementById('settingsMsg').textContent = 'Settings saved.';
      document.getElementById('settingsMsg').className = 'form-msg success';
    } catch (err) {
      document.getElementById('settingsMsg').textContent = err.message || 'Could not save.';
      document.getElementById('settingsMsg').className = 'form-msg error';
    }
  });
}

// ---------- Chapter-Scoped Site Settings (Phase 1) ----------
async function renderChapterSettings() {
  const el = document.getElementById('panel-chapterSettings');
  el.innerHTML = '<p class="empty-state">Loading Chapter Settings...</p>';
  try {
    const data = await fetchJSON('/api/admin/chapter-settings');
    const contact = data.contact || {};
    const payment = data.payment || {};
    const about = data.about || {};
    const serviceTimesStr = (data.serviceTimes || []).join('\n');

    el.innerHTML = `
      <div class="panel-head">
        <div>
          <h2 style="margin:0 0 4px;">Chapter Site Settings</h2>
          <p style="color:#7a6288; font-size:0.88rem; margin:0;">
            Manage your chapter's site branding, scripture theme, service times, contacts, and home banner.
          </p>
        </div>
      </div>

      <div class="portal-card" style="margin-bottom:24px; background:#fff; border-radius:12px; padding:20px; border:1px solid var(--line);">
        <h3 style="margin-bottom:8px;">Chapter Homepage Banner</h3>
        <p class="hint">Upload a high-resolution hero photo for your chapter's homepage. It will be compressed and displayed across the app and web.</p>
        <div style="display:flex; gap:20px; align-items:center; flex-wrap:wrap; margin-top:14px;">
          <div style="width:260px; height:120px; border-radius:10px; overflow:hidden; background:#eee; display:flex; align-items:center; justify-content:center; border:1px solid var(--line);">
            ${data.homeHeaderImageFileId ? `<img src="/api/files/${data.homeHeaderImageFileId}" style="width:100%; height:100%; object-fit:cover;" alt="Chapter Banner">` : '<span style="color:#888; font-size:0.85rem;">No banner set</span>'}
          </div>
          <div>
            <input type="file" id="chapterBannerFile" accept="image/*" style="margin-bottom:10px; display:block;">
            <button type="button" class="btn btn-outline btn-sm" id="uploadChapterBannerBtn">Upload New Banner</button>
            <span id="bannerUploadMsg" style="margin-left:10px; font-size:0.85rem; font-weight:700;"></span>
          </div>
        </div>
      </div>

      <form class="form-card" id="chapterSettingsForm" style="max-width:780px; margin:0;">
        <h3 style="margin-bottom:16px;">General &amp; Branding</h3>
        <div class="field-row">
          <div class="field">
            <label>Chapter Display Name</label>
            <input type="text" id="csName" value="${escapeHtml(data.name || '')}" required>
            <small class="hint">e.g. ACONSU-KNUST</small>
          </div>
          <div class="field">
            <label>Full Name</label>
            <input type="text" id="csFullName" value="${escapeHtml(data.fullName || '')}">
            <small class="hint">e.g. Apostles' Continuation Students Union — KNUST</small>
          </div>
        </div>

        <div class="field-row">
          <div class="field">
            <label>Institution / University</label>
            <input type="text" id="csInstitution" value="${escapeHtml(data.institution || '')}">
          </div>
          <div class="field">
            <label>Meeting Venue / Location</label>
            <input type="text" id="csLocation" value="${escapeHtml(data.location || '')}">
          </div>
        </div>

        <div class="field">
          <label>Campus Address / Directions</label>
          <input type="text" id="csAddress" value="${escapeHtml(data.address || '')}">
        </div>

        <div class="field">
          <label>Chapter Tagline / Annual Theme</label>
          <input type="text" id="csTagline" value="${escapeHtml(data.tagline || '')}" placeholder="e.g. Carrying the fire. Continuing the pattern.">
        </div>

        <div class="field">
          <label>Verse of the Week / Scripture Theme</label>
          <textarea id="csVerse" rows="2" placeholder="e.g. Acts 2:42 — And they continued steadfastly...">${escapeHtml(data.verseOfTheWeek || '')}</textarea>
          <small class="hint">Powers the homepage daily scripture banner and the downloadable PNG card generator.</small>
        </div>

        <div class="field">
          <label>Weekly Fellowship &amp; Service Times (one schedule per line)</label>
          <textarea id="csServiceTimes" rows="3" placeholder="Sundays 8:00 AM - 11:00 AM (Main Fellowship Auditorium)&#10;Wednesdays 6:30 PM - 8:00 PM (Midweek Service)">${escapeHtml(serviceTimesStr)}</textarea>
        </div>

        <h3 style="margin:24px 0 16px;">Official Contacts &amp; Social Channels</h3>
        <div class="field-row">
          <div class="field">
            <label>Chapter Email</label>
            <input type="email" id="csEmail" value="${escapeHtml(contact.email || '')}">
          </div>
          <div class="field">
            <label>Chapter Phone</label>
            <input type="tel" id="csPhone" value="${escapeHtml(contact.phone || '')}">
          </div>
        </div>

        <div class="field-row">
          <div class="field">
            <label>WhatsApp Group Link or Number</label>
            <input type="text" id="csWhatsapp" value="${escapeHtml(contact.whatsapp || '')}" placeholder="https://chat.whatsapp.com/... or 233...">
          </div>
          <div class="field">
            <label>YouTube Channel URL</label>
            <input type="text" id="csYoutube" value="${escapeHtml(contact.youtube || '')}">
          </div>
        </div>

        <div class="field-row">
          <div class="field">
            <label>Instagram URL</label>
            <input type="text" id="csInstagram" value="${escapeHtml(contact.instagram || '')}">
          </div>
          <div class="field">
            <label>Facebook URL</label>
            <input type="text" id="csFacebook" value="${escapeHtml(contact.facebook || '')}">
          </div>
        </div>

        <div class="field-row">
          <div class="field">
            <label>Telegram URL</label>
            <input type="text" id="csTelegram" value="${escapeHtml(contact.telegram || '')}">
          </div>
          <div class="field">
            <label>TikTok URL</label>
            <input type="text" id="csTiktok" value="${escapeHtml(contact.tiktok || '')}">
          </div>
          <div class="field">
            <label>X / Twitter URL</label>
            <input type="text" id="csTwitter" value="${escapeHtml(contact.twitter || '')}">
          </div>
        </div>

        <h3 style="margin:24px 0 16px;">Giving &amp; Mobile Money (For Member Claims)</h3>
        <div class="field-row">
          <div class="field">
            <label>Payment Method Label</label>
            <input type="text" id="csProvider" value="${escapeHtml(payment.provider || '')}" placeholder="e.g. Manual MoMo, Paystack, Bank Transfer">
          </div>
          <div class="field">
            <label>Mobile Money (MoMo) Number</label>
            <input type="text" id="csMomoNumber" value="${escapeHtml(payment.momoNumber || '')}">
          </div>
          <div class="field">
            <label>MoMo Account Name / Merchant Name</label>
            <input type="text" id="csMomoName" value="${escapeHtml(payment.momoName || '')}">
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Bank Name</label>
            <input type="text" id="csBankName" value="${escapeHtml(payment.bankName || '')}">
          </div>
          <div class="field">
            <label>Bank Account Name</label>
            <input type="text" id="csBankAccountName" value="${escapeHtml(payment.bankAccountName || '')}">
          </div>
          <div class="field">
            <label>Bank Account Number</label>
            <input type="text" id="csBankAccountNumber" value="${escapeHtml(payment.bankAccountNumber || '')}">
          </div>
        </div>

        <div class="field-row">
          <div class="field">
            <label>Donation Destination Label</label>
            <input type="text" id="csDonationDestination" value="${escapeHtml(payment.donationDestination || '')}" placeholder="e.g. General Fund">
          </div>
          <div class="field">
            <label>Welfare Destination Label</label>
            <input type="text" id="csWelfareDestination" value="${escapeHtml(payment.welfareDestination || '')}" placeholder="e.g. Welfare Fund">
          </div>
        </div>

        <h3 style="margin:24px 0 16px;">About, Vision &amp; History</h3>
        <div class="field">
          <label>Chapter Vision</label>
          <textarea id="csVision" rows="2">${escapeHtml(about.vision || '')}</textarea>
        </div>
        <div class="field">
          <label>Chapter Mission</label>
          <textarea id="csMission" rows="2">${escapeHtml(about.mission || '')}</textarea>
        </div>
        <div class="field">
          <label>Chapter Values</label>
          <textarea id="csValues" rows="2">${escapeHtml(about.values || '')}</textarea>
        </div>
        <div class="field">
          <label>Chapter History</label>
          <textarea id="csHistory" rows="3">${escapeHtml(about.history || '')}</textarea>
        </div>
        <div class="field">
          <label>Chapter Leadership Bio</label>
          <textarea id="csLeadership" rows="3">${escapeHtml(about.leadership || '')}</textarea>
        </div>

        <button type="submit" class="btn btn-primary btn-block" id="saveChapterSettingsBtn" style="margin-top:20px;">Save Chapter Settings</button>
        <div class="form-msg" id="chapterSettingsMsg"></div>
      </form>
    `;

    // Banner upload handler
    document.getElementById('uploadChapterBannerBtn').addEventListener('click', async () => {
      const fileInput = document.getElementById('chapterBannerFile');
      const file = fileInput.files[0];
      const msg = document.getElementById('bannerUploadMsg');
      if (!file) {
        msg.textContent = 'Please choose an image file first.';
        msg.style.color = 'var(--flame-red)';
        return;
      }
      const formData = new FormData();
      formData.append('image', file);
      msg.textContent = 'Uploading banner...';
      msg.style.color = 'var(--purple-deep)';
      try {
        await fetchJSON('/api/admin/chapter-settings/banner', {
          method: 'POST',
          body: formData
        });
        showToast('Banner uploaded successfully.', 'success');
        renderChapterSettings();
      } catch (err) {
        msg.textContent = err.message || 'Upload failed.';
        msg.style.color = 'var(--flame-red)';
      }
    });

    // Chapter settings save handler
    document.getElementById('chapterSettingsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('saveChapterSettingsBtn');
      const msg = document.getElementById('chapterSettingsMsg');
      btn.disabled = true;
      btn.textContent = 'Saving...';
      msg.textContent = '';
      msg.className = 'form-msg';

      const payload = {
        name: document.getElementById('csName').value,
        fullName: document.getElementById('csFullName').value,
        institution: document.getElementById('csInstitution').value,
        location: document.getElementById('csLocation').value,
        address: document.getElementById('csAddress').value,
        tagline: document.getElementById('csTagline').value,
        verseOfTheWeek: document.getElementById('csVerse').value,
        serviceTimes: document.getElementById('csServiceTimes').value.split('\n').map(s => s.trim()).filter(Boolean),
        contact: {
          email: document.getElementById('csEmail').value,
          phone: document.getElementById('csPhone').value,
          whatsapp: document.getElementById('csWhatsapp').value,
          youtube: document.getElementById('csYoutube').value,
          instagram: document.getElementById('csInstagram').value,
          facebook: document.getElementById('csFacebook').value,
          telegram: document.getElementById('csTelegram').value,
          tiktok: document.getElementById('csTiktok').value,
          twitter: document.getElementById('csTwitter').value
        },
        payment: {
          provider: document.getElementById('csProvider').value,
          momoNumber: document.getElementById('csMomoNumber').value,
          momoName: document.getElementById('csMomoName').value,
          bankName: document.getElementById('csBankName').value,
          bankAccountName: document.getElementById('csBankAccountName').value,
          donationDestination: document.getElementById('csDonationDestination').value,
          welfareDestination: document.getElementById('csWelfareDestination').value,
          bankAccountNumber: document.getElementById('csBankAccountNumber').value
        },
        about: {
          vision: document.getElementById('csVision').value,
          mission: document.getElementById('csMission').value,
          values: document.getElementById('csValues').value,
          history: document.getElementById('csHistory').value,
          leadership: document.getElementById('csLeadership').value
        }
      };

      try {
        await fetchJSON('/api/admin/chapter-settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        msg.textContent = 'Chapter site settings saved successfully.';
        msg.className = 'form-msg success';
        showToast('Chapter settings saved.', 'success');
      } catch (err) {
        msg.textContent = err.message || 'Could not save chapter settings.';
        msg.className = 'form-msg error';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save Chapter Settings';
      }
    });

  } catch (err) {
    el.innerHTML = `<p class="empty-state">Could not load chapter settings: ${escapeHtml(err.message)}</p>`;
  }
}

function whenElementReady(selector, callback, tries = 20) {
  const el = document.querySelector(selector);
  if (el) return callback(el);
  if (tries <= 0) return null;
  return setTimeout(() => whenElementReady(selector, callback, tries - 1), 120);
}

// ---------- Universal Command Palette (Ctrl + K) ----------
function initCommandPalette() {
  const backdrop = document.getElementById('cmdPaletteBackdrop');
  const input = document.getElementById('cmdInput');
  const list = document.getElementById('cmdList');
  const trigger = document.getElementById('cmdPaletteBtn');

  if (!backdrop || !input || !list) return;

  const COMMANDS = [
    { title: '+ New Member', group: 'Quick Actions', icon: '➕', keywords: 'register member sign up', action: () => window.open('/register.html', '_blank', 'noopener') },
    { title: '+ Create Event', group: 'Quick Actions', icon: '➕', keywords: 'new event calendar', action: () => { openAdminPanel('events'); whenElementReady('#addBtn-events', (el) => el.click()); } },
    { title: '+ Send Notification', group: 'Quick Actions', icon: '➕', keywords: 'announcement broadcast push', action: () => { openAdminPanel('notifications'); whenElementReady('#notifTitle', (el) => el.focus()); } },
    { title: '+ Upload Banner', group: 'Quick Actions', icon: '➕', keywords: 'chapter banner hero image', action: () => { openAdminPanel('chapterSettings'); whenElementReady('#chapterBannerFile', (el) => el.focus()); } },
    { title: '+ New Form', group: 'Quick Actions', icon: '➕', keywords: 'dynamic form builder', action: () => { openAdminPanel('forms'); whenElementReady('#newFormBtn', (el) => el.click()); } },
    { title: 'Overview Dashboard', group: 'Dashboard', panel: 'overview', icon: '📊', keywords: 'home summary' },
    { title: 'Chapter Site Settings (Branding & Banner)', group: 'Settings', panel: 'chapterSettings', icon: '🏢', keywords: 'settings banner branding' },
    { title: 'Members Roster & Profiles', group: 'People & Leadership', panel: 'members', icon: '👥', keywords: 'directory people' },
    { title: 'Executive Applications & Verification', group: 'People & Leadership', panel: 'executives', icon: '🎓', keywords: 'executives roster approvals' },
    { title: 'Leadership Accounts & Roles', group: 'People & Leadership', panel: 'staff', icon: '🔑', keywords: 'staff roles portal accounts' },
    { title: 'Join Requests (New Visitors)', group: 'People & Leadership', panel: 'joinRequests', icon: '📥', keywords: 'new converts visitors' },
    { title: 'Bible Studies & Outlines', group: 'Ministry & Discipleship', panel: 'bibleStudies', icon: '📖', keywords: 'study scripture' },
    { title: 'Small Groups & Fellowship Cells', group: 'Ministry & Discipleship', panel: 'groups', icon: '👨‍👩‍👦', keywords: 'cells groups' },
    { title: 'Prayer Requests Wall', group: 'Ministry & Discipleship', panel: 'prayerRequests', icon: '🙏', keywords: 'prayer wall' },
    { title: 'Testimonies Moderation', group: 'Ministry & Discipleship', panel: 'testimonies', icon: '✨', keywords: 'testimony review' },
    { title: 'Sermons & Audio/Video Media', group: 'Ministry & Discipleship', panel: 'sermons', icon: '🎧', keywords: 'media sermons' },
    { title: 'Events & Gathering Calendar', group: 'Operations & Gatherings', panel: 'events', icon: '🗓️', keywords: 'events calendar service schedules' },
    { title: 'Departments & Ministries', group: 'Operations & Gatherings', panel: 'departments', icon: '🚪', keywords: 'departments ministries' },
    { title: 'Push Notifications Broadcast', group: 'Operations & Gatherings', panel: 'notifications', icon: '🔔', keywords: 'notifications broadcast' },
    { title: 'Dynamic Form Builder', group: 'Operations & Gatherings', panel: 'forms', icon: '🧩', keywords: 'forms builder registrations' },
    { title: 'Welfare Requests & Support Cases', group: 'Care & Community', panel: 'welfare', icon: '❤️', keywords: 'welfare care' },
    { title: 'Community Chat Moderation', group: 'Care & Community', panel: 'chatModeration', icon: '💬', keywords: 'chat moderation community' },
    { title: 'Contact Form Inquiries', group: 'Care & Community', panel: 'contactMessages', icon: '✉️', keywords: 'contact messages' },
    { title: 'Custom Pages Builder', group: 'System & Chapter Settings', panel: 'pages', icon: '📄', keywords: 'pages custom' },
    { title: 'Media Library & Uploads', group: 'System & Chapter Settings', panel: 'media', icon: '📁', keywords: 'files uploads gridfs' },
    { title: 'Reports & PDF Export', group: 'System & Chapter Settings', panel: 'reports', icon: '📑', keywords: 'reports pdf export' }
  ];

  function executeCommand(command) {
    if (command.action) command.action();
    else if (command.panel) openAdminPanel(command.panel);
    closePalette();
  }

  function openPalette() {
    backdrop.classList.add('open');
    input.value = '';
    renderList(COMMANDS);
    setTimeout(() => input.focus(), 50);
  }

  function closePalette() {
    backdrop.classList.remove('open');
  }

  function renderList(items) {
    if (!items.length) {
      list.innerHTML = '<div style="padding:18px; text-align:center; color:#888;">No matching panels found</div>';
      return;
    }
    let lastGroup = '';
    list.innerHTML = items.map((cmd, idx) => {
      let groupHeader = '';
      if (cmd.group !== lastGroup) {
        lastGroup = cmd.group;
        groupHeader = `<div class="cmd-item-group">${escapeHtml(cmd.group)}</div>`;
      }
      return `
        ${groupHeader}
        <div class="cmd-item ${idx === 0 ? 'selected' : ''}" data-index="${idx}">
          <span>${cmd.icon} &nbsp;${escapeHtml(cmd.title)}</span>
          <span style="font-size:0.75rem; color:#9b86a8;">${cmd.action ? 'Run' : 'Jump'} &rsaquo;</span>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.cmd-item').forEach(item => {
      item.addEventListener('click', () => {
        executeCommand(items[Number(item.dataset.index)]);
      });
    });
  }

  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    const filtered = COMMANDS.filter(c =>
      c.title.toLowerCase().includes(q) ||
      c.group.toLowerCase().includes(q) ||
      (c.panel || '').toLowerCase().includes(q) ||
      (c.keywords || '').toLowerCase().includes(q)
    );
    renderList(filtered);
  });

  input.addEventListener('keydown', (e) => {
    const items = Array.from(list.querySelectorAll('.cmd-item'));
    if (!items.length) return;
    const currentIdx = items.findIndex(i => i.classList.contains('selected'));
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIdx = (currentIdx + 1) % items.length;
      items.forEach(i => i.classList.remove('selected'));
      items[nextIdx].classList.add('selected');
      items[nextIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIdx = (currentIdx - 1 + items.length) % items.length;
      items.forEach(i => i.classList.remove('selected'));
      items[prevIdx].classList.add('selected');
      items[prevIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (currentIdx >= 0 && items[currentIdx]) {
        const commands = input.value.toLowerCase().trim()
          ? COMMANDS.filter(c =>
            c.title.toLowerCase().includes(input.value.toLowerCase().trim()) ||
            c.group.toLowerCase().includes(input.value.toLowerCase().trim()) ||
            (c.panel || '').toLowerCase().includes(input.value.toLowerCase().trim()) ||
            (c.keywords || '').toLowerCase().includes(input.value.toLowerCase().trim())
          )
          : COMMANDS;
        executeCommand(commands[currentIdx]);
      }
    } else if (e.key === 'Escape') {
      closePalette();
    }
  });

  if (trigger) trigger.addEventListener('click', openPalette);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closePalette();
  });

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (backdrop.classList.contains('open')) {
        closePalette();
      } else {
        openPalette();
      }
    }
  });
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const msg = document.getElementById('loginMsg');
  btn.disabled = true; btn.textContent = 'Logging in...';
  msg.textContent = ''; msg.className = 'form-msg';
  try {
    await fetchJSON('/api/portal/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value
      })
    });
    await checkAuth();
  } catch (err) {
    msg.textContent = err.message || 'Could not log in.';
    msg.className = 'form-msg error';
  } finally {
    btn.disabled = false; btn.textContent = 'Log In';
  }
});

checkAuth();
