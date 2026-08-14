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
      <thead><tr>${fields.slice(0, 3).map(f => `<th>${f.label}</th>`).join('')}${resource === 'events' ? '<th>Registrations</th>' : ''}<th>Actions</th></tr></thead>
      <tbody>
        ${pageItems.map(item => `
          <tr>
            ${fields.slice(0, 3).map(f => `<td>${escapeHtml(String(item[f.key] || ''))}</td>`).join('')}
            ${resource === 'events' ? `<td>${item.registrationEnabled ? `<button data-view-regs="${item.id}" data-title="${escapeHtml(item.title)}">View (${item.capacity > 0 ? `cap ${item.capacity}` : 'unlimited'})</button>` : '—'}</td>` : ''}
            <td class="row-actions">
              <button data-edit="${item.id}">Edit</button>
              <button class="danger" data-delete="${item.id}">Delete</button>
            </td>
          </tr>
        `).join('') || `<tr><td colspan="${fields.length + (resource === 'events' ? 2 : 1)}">No ${singular.toLowerCase()}s yet.</td></tr>`}
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
async function renderMediaLibrary() {
  const el = document.getElementById('panel-media');
  el.innerHTML = '<p class="empty-state">Loading...</p>';
  const [files, pages] = await Promise.all([
    fetchJSON('/api/files'),
    fetchJSON('/api/pages')
  ]);
  const galleryBookPages = pages.filter(p => p.type === 'gallery' || p.type === 'bookshelf');

  el.innerHTML = `
    <h2 style="margin-bottom:20px;">Media Library</h2>
    <div class="upload-form">
      <h3 style="margin-bottom:14px;">Upload a File</h3>
      <form id="uploadForm">
        <div class="field-row">
          <div class="field">
            <label>File Type</label>
            <select id="uploadCategory">
              <option value="photo">Photo (Sunday service pictures, etc.)</option>
              <option value="book">E-Book / Document</option>
            </select>
          </div>
          <div class="field">
            <label>Which page does this belong to?</label>
            <select id="uploadPageSlug">
              <option value="">— Not tied to a page —</option>
              ${galleryBookPages.map(p => `<option value="${p.slug}">${escapeHtml(p.title)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field">
          <label>Title</label>
          <input type="text" id="uploadTitle" placeholder="e.g. Sunday Service — July 12">
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
      ${!galleryBookPages.length ? '<small class="hint">Tip: create a Gallery or Bookshelf page under "Custom Pages" first, so uploads here can be tied to it and show up on the public site.</small>' : ''}
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

  document.getElementById('uploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('uploadSubmitBtn');
    const msg = document.getElementById('uploadMsg');
    const fileInput = document.getElementById('uploadFile');
    if (!fileInput.files.length) return;
    btn.disabled = true; btn.textContent = 'Uploading...';
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('category', document.getElementById('uploadCategory').value);
    formData.append('pageSlug', document.getElementById('uploadPageSlug').value);
    formData.append('title', document.getElementById('uploadTitle').value);
    formData.append('description', document.getElementById('uploadDescription').value);
    try {
      const res = await fetch('/api/admin/uploads', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      msg.textContent = 'Uploaded!';
      msg.className = 'form-msg success';
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

function mediaCardHtml(f) {
  const isImage = (f.contentType || '').startsWith('image/');
  return `
    <div class="media-card">
      <div class="thumb ${isImage ? '' : 'doc'}">
        ${isImage ? `<img src="/api/files/${f.id}" alt="${escapeHtml(f.title)}">` : (f.contentType.includes('pdf') ? 'PDF' : 'FILE')}
      </div>
      <div class="info">
        <h4>${escapeHtml(f.title)}</h4>
        <small>${f.category} · ${formatFileSize(f.length)}${f.pageSlug ? ` · ${escapeHtml(f.pageSlug)}` : ''}</small>
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
    { key: 'email', label: 'Contact Email' },
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
