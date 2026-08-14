let CURRENT_SETTINGS = {};

function showModal(html) {
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalBackdrop').classList.add('open');
}
function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('open');
}
document.getElementById('modalBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'modalBackdrop') closeModal();
});

// ---------- auth ----------
async function checkAuth() {
  const { isAdmin } = await fetchJSON('/api/admin/check');
  if (isAdmin) {
    document.getElementById('loginWrap').style.display = 'none';
    document.getElementById('adminShell').style.display = 'block';
    initAdminNav();
    loadPanel('overview');
  } else {
    document.getElementById('loginWrap').style.display = 'flex';
    document.getElementById('adminShell').style.display = 'none';
  }
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('loginMsg');
  try {
    await fetchJSON('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value
      })
    });
    checkAuth();
  } catch (err) {
    msg.textContent = 'Invalid username or password.';
    msg.className = 'form-msg error';
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetchJSON('/api/admin/logout', { method: 'POST' });
  checkAuth();
});

// ---------- nav ----------
function initAdminNav() {
  document.getElementById('adminNav').querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('adminNav').querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(`panel-${btn.dataset.panel}`).classList.add('active');
      loadPanel(btn.dataset.panel);
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
    pages: () => renderResourcePanel('pages', PAGE_FIELDS, 'Page'),
    media: renderMediaLibrary,
    staff: renderStaffAccounts,
    joinRequests: renderJoinRequests,
    prayerRequests: renderPrayerRequests,
    testimonies: renderTestimonies,
    contactMessages: renderContactMessages,
    settings: renderSettings
  };
  if (handlers[name]) handlers[name]();
}

// ---------- overview ----------
async function renderOverview() {
  const el = document.getElementById('panel-overview');
  el.innerHTML = '<p class="empty-state">Loading...</p>';
  try {
    const [departments, events, sermons, joinRequests, prayerRequests, testimonies, contactMessages] = await Promise.all([
      fetchJSON('/api/departments'),
      fetchJSON('/api/events'),
      fetchJSON('/api/sermons'),
      fetchJSON('/api/admin/join-requests'),
      fetchJSON('/api/admin/prayer-requests'),
      fetchJSON('/api/admin/testimonies'),
      fetchJSON('/api/admin/contact-messages')
    ]);
    const stat = (label, val) => `<div class="card"><div class="eyebrow">${label}</div><h2 style="margin:6px 0 0;">${val}</h2></div>`;
    el.innerHTML = `
      <h2 style="margin-bottom:20px;">Overview</h2>
      <div class="grid">
        ${stat('Departments', departments.length)}
        ${stat('Upcoming Events', events.length)}
        ${stat('Sermons', sermons.length)}
        ${stat('New Join Requests', joinRequests.filter(r => r.status === 'new').length)}
        ${stat('New Prayer Requests', prayerRequests.filter(r => r.status === 'new').length)}
        ${stat('Testimonies Awaiting Review', testimonies.filter(t => !t.published).length)}
        ${stat('Contact Messages', contactMessages.length)}
      </div>
    `;
  } catch (e) {
    el.innerHTML = '<p class="empty-state">Could not load overview.</p>';
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
  { value: 'coordinator', label: 'Coordinator', blurb: 'Read-only view of every office, plus the union dashboard.', href: '/coordinator.html' },
  { value: 'finance', label: 'Finance', blurb: 'Budgets, ledger, financial reports.', href: '/finance.html' },
  { value: 'shepherding', label: 'Shepherding', blurb: 'Attendance, member care, contact messages.', href: '/shepherding.html' },
  { value: 'publicity', label: 'Publicity', blurb: 'Announcements, SMS, events, testimonies.', href: '/publicity.html' }
];

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

function openStaffForm(user) {
  const isEdit = !!user;
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
          ${PORTAL_ROLES.map(r => `<option value="${r.value}" ${user?.role === r.value ? 'selected' : ''}>${r.label} — ${r.blurb}</option>`).join('')}
        </select>
      </div>
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
    <table>
      <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Level</th><th>Birthday</th><th>Joined</th><th>Actions</th></tr></thead>
      <tbody>
        ${pageItems.map(m => `
          <tr>
            <td>${escapeHtml(m.name)}</td>
            <td>${escapeHtml(m.email)}</td>
            <td>${escapeHtml(m.phone || '—')}</td>
            <td>${escapeHtml(m.level || '—')}</td>
            <td>${bday(m)}</td>
            <td>${new Date(m.createdAt).toLocaleDateString()}</td>
            <td class="row-actions">
              <button data-edit-member="${m.id}">Edit</button>
              <button class="danger" data-delete-member="${m.id}">Delete</button>
            </td>
          </tr>
        `).join('') || '<tr><td colspan="7">No members have signed up yet.</td></tr>'}
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
      <div class="field"><label>Level / Year of Study</label><input type="text" id="editMemberLevel" value="${escapeHtml(member.level || '')}"></div>
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
          level: document.getElementById('editMemberLevel').value
        })
      });
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
  const execs = await fetchJSON('/api/executives');

  el.innerHTML = `
    <h2 style="margin-bottom:20px;">Executives</h2>
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
      'home-floating': 'This image drifts around the hero area on the home page and department pages as a decorative photo. Only the first few uploaded are used, and they are hidden on small phones.',
      'executive-photo': 'This image is kept in the library ready to use as an executive portrait. Attach it to a person from the <strong>Executives</strong> panel.',
      'library': 'Nothing on the public site changes. The image simply sits in the library until you place it somewhere.'
    };
    explain.innerHTML = `<strong>Where this goes:</strong> ${messages[value] || spec.description}`;
    // A department header is always a photo, never a document.
    if (value === 'department-header' || value === 'home-floating' || value === 'executive-photo') {
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


async function renderSettings() {
  const el = document.getElementById('panel-settings');
  el.innerHTML = '<p class="empty-state">Loading...</p>';
  const settings = await fetchJSON('/api/settings');
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
    { key: 'youtube', label: 'YouTube URL' }
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

checkAuth();
