const INCOME_CATEGORIES = [
  { value: 'momo', label: 'Mobile Money (MoMo)' },
  { value: 'tithe', label: 'Tithe' },
  { value: 'harvest', label: 'Harvest' },
  { value: 'offertory', label: 'Offertory' },
  { value: 'other', label: 'Other Income' }
];

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
  const { isShepherd } = await fetchJSON('/api/shepherd/check');
  if (isShepherd) {
    document.getElementById('loginWrap').style.display = 'none';
    document.getElementById('shepShell').style.display = 'block';
    initNav();
    loadPanel('overview');
  } else {
    document.getElementById('loginWrap').style.display = 'flex';
    document.getElementById('shepShell').style.display = 'none';
  }
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('loginMsg');
  try {
    await fetchJSON('/api/shepherd/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value
      })
    });
    checkAuth();
  } catch (err) {
    msg.textContent = err.message || 'Invalid username or password.';
    msg.className = 'form-msg error';
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetchJSON('/api/shepherd/logout', { method: 'POST' });
  checkAuth();
});

// ---------- nav ----------
function initNav() {
  document.getElementById('shepNav').querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('shepNav').querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.shep-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(`panel-${btn.dataset.panel}`).classList.add('active');
      loadPanel(btn.dataset.panel);
    });
  });
}

function loadPanel(name) {
  const handlers = { overview: renderOverview, members: renderMembers, finance: renderFinance };
  if (handlers[name]) handlers[name]();
}

// ---------- overview ----------
async function renderOverview() {
  const el = document.getElementById('panel-overview');
  el.innerHTML = '<p class="empty-state">Loading...</p>';
  try {
    const [summary, members] = await Promise.all([
      fetchJSON('/api/shepherd/finance/summary'),
      fetchJSON('/api/shepherd/members')
    ]);
    const fmt = (n) => `GH₵ ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    el.innerHTML = `
      <h2 style="margin-bottom:20px;">Overview</h2>
      <div class="summary-cards">
        <div class="summary-card income"><div class="eyebrow">Total Income</div><h2>${fmt(summary.totalIncome)}</h2></div>
        <div class="summary-card expense"><div class="eyebrow">Total Expenses</div><h2>${fmt(summary.totalExpense)}</h2></div>
        <div class="summary-card balance"><div class="eyebrow">Net Balance</div><h2>${fmt(summary.balance)}</h2></div>
        <div class="summary-card"><div class="eyebrow">People Tracked</div><h2>${members.length}</h2></div>
      </div>
      <h3 style="margin-bottom:14px;">Income by Source</h3>
      <table>
        <thead><tr>${INCOME_CATEGORIES.map(c => `<th>${c.label}</th>`).join('')}</tr></thead>
        <tbody><tr>${INCOME_CATEGORIES.map(c => `<td>${fmt(summary.byIncomeCategory[c.value] || 0)}</td>`).join('')}</tr></tbody>
      </table>
    `;
  } catch (e) {
    el.innerHTML = '<p class="empty-state">Could not load overview.</p>';
  }
}

// ---------- members ----------
let shepMembersPage = 1;
const SHEP_ROWS_PER_PAGE = 15;

async function renderMembers() {
  const el = document.getElementById('panel-members');
  el.innerHTML = '<p class="empty-state">Loading...</p>';
  const people = await fetchJSON('/api/shepherd/members');
  const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const bday = (p) => p.birthdayMonth && p.birthdayDay ? `${monthNames[p.birthdayMonth]} ${p.birthdayDay}` : '—';
  const pageItems = paginate(people, shepMembersPage, SHEP_ROWS_PER_PAGE);

  el.innerHTML = `
    <div class="panel-head">
      <h2>Members (${people.length})</h2>
      <button class="btn btn-primary btn-sm" id="addVisitorBtn">+ Add Visitor Record</button>
    </div>
    <p style="font-size:0.85rem; color:#8a7595; margin-bottom:16px;">Name, email, phone, birthday and photo are pulled automatically from each person's ACONSU account. Address, attendance and pastoral notes are entered here.</p>
    <table>
      <thead><tr><th>Name</th><th>Contact</th><th>Birthday</th><th>Attendance</th><th>Last Contact</th><th>Actions</th></tr></thead>
      <tbody>
        ${pageItems.map(p => `
          <tr>
            <td>
              <span class="member-thumb">${p.imageFileId ? `<img src="/api/files/${p.imageFileId}" alt="">` : escapeHtml((p.name || '?').charAt(0))}</span>
              ${escapeHtml(p.name)} ${p.source === 'visitor' ? '<span class="badge">Visitor</span>' : ''}
            </td>
            <td>${escapeHtml(p.email || '—')}${p.phone ? `<br>${escapeHtml(p.phone)}` : ''}</td>
            <td>${bday(p)}</td>
            <td><span class="status-pill ${p.attendanceStatus}">${p.attendanceStatus}</span></td>
            <td>${p.lastContactDate || '—'}</td>
            <td class="row-actions">
              <button data-edit="${p.memberId || p.recordId}" data-visitor="${p.source === 'visitor' ? p.recordId : ''}">Edit</button>
              ${p.recordId ? `<button class="danger" data-delete="${p.recordId}">Delete Record</button>` : ''}
            </td>
          </tr>
        `).join('') || '<tr><td colspan="6">No members yet.</td></tr>'}
      </tbody>
    </table>
    <div id="shepMembersPagination"></div>
  `;

  renderPaginationControls('shepMembersPagination', people.length, SHEP_ROWS_PER_PAGE, shepMembersPage, (p) => {
    shepMembersPage = p;
    renderMembers();
  });

  document.getElementById('addVisitorBtn').addEventListener('click', () => openMemberForm(null));
  el.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.visitor || btn.dataset.edit;
      const person = people.find(p => (p.source === 'visitor' ? p.recordId : p.memberId) === key);
      openMemberForm(person);
    });
  });
  el.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this shepherding record? This cannot be undone.')) return;
      await fetchJSON(`/api/shepherd/records/${btn.dataset.delete}`, { method: 'DELETE' });
      renderMembers();
    });
  });
}

function openMemberForm(person) {
  const isVisitor = !person || person.source === 'visitor';
  showModal(`
    <h3>${person ? 'Edit Record' : 'Add Visitor Record'}</h3>
    <form id="memberForm">
      ${isVisitor ? `
        <div class="field"><label>Full Name</label><input type="text" id="mName" value="${escapeHtml(person?.name || '')}" required></div>
        <div class="field"><label>Phone</label><input type="tel" id="mPhone" value="${escapeHtml(person?.phone || '')}"></div>
      ` : `<p style="margin-bottom:14px; color:#5a4468;"><strong>${escapeHtml(person.name)}</strong> — contact info comes from their account.</p>`}
      <div class="field"><label>Address</label><input type="text" id="mAddress" value="${escapeHtml(person?.address || '')}"></div>
      <div class="field"><label>Emergency Contact</label><input type="text" id="mEmergency" value="${escapeHtml(person?.emergencyContact || '')}"></div>
      <div class="field"><label>Attendance</label>
        <select id="mAttendance">
          <option value="new" ${person?.attendanceStatus === 'new' ? 'selected' : ''}>New</option>
          <option value="regular" ${person?.attendanceStatus === 'regular' ? 'selected' : ''}>Regular</option>
          <option value="irregular" ${person?.attendanceStatus === 'irregular' ? 'selected' : ''}>Irregular</option>
          <option value="inactive" ${person?.attendanceStatus === 'inactive' ? 'selected' : ''}>Inactive</option>
        </select>
      </div>
      <div class="field"><label>Last Contact Date</label><input type="date" id="mLastContact" value="${person?.lastContactDate || ''}"></div>
      <div class="field"><label>Pastoral Notes</label><textarea id="mNotes">${escapeHtml(person?.pastoralNotes || '')}</textarea></div>
      <div class="field"><label>Photo${isVisitor ? '' : ' (overrides their profile photo here only)'}</label><input type="file" id="mImage" accept="image/*"></div>
      <div style="display:flex; gap:10px;">
        <button type="submit" class="btn btn-primary">Save</button>
        <button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button>
      </div>
      <div class="form-msg" id="memberFormMsg"></div>
    </form>
  `);
  document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
  document.getElementById('memberForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData();
    if (isVisitor) {
      formData.append('name', document.getElementById('mName').value);
      formData.append('phone', document.getElementById('mPhone').value);
      if (person?.recordId) formData.append('recordId', person.recordId); // editing an existing visitor record
    } else {
      formData.append('memberId', person.memberId);
    }
    formData.append('address', document.getElementById('mAddress').value);
    formData.append('emergencyContact', document.getElementById('mEmergency').value);
    formData.append('attendanceStatus', document.getElementById('mAttendance').value);
    formData.append('lastContactDate', document.getElementById('mLastContact').value);
    formData.append('pastoralNotes', document.getElementById('mNotes').value);
    const fileInput = document.getElementById('mImage');
    if (fileInput.files.length) formData.append('image', fileInput.files[0]);

    try {
      const res = await fetch('/api/shepherd/records', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save');
      closeModal();
      showToast('Record saved.', 'success');
      renderMembers();
    } catch (err) {
      document.getElementById('memberFormMsg').textContent = err.message;
      document.getElementById('memberFormMsg').className = 'form-msg error';
    }
  });
}

// ---------- finance ----------
let financePage = 1;

async function renderFinance() {
  const el = document.getElementById('panel-finance');
  el.innerHTML = '<p class="empty-state">Loading...</p>';
  const entries = await fetchJSON('/api/shepherd/finance');
  const fmt = (n) => `GH₵ ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pageItems = paginate(entries, financePage, SHEP_ROWS_PER_PAGE);

  el.innerHTML = `
    <div class="panel-head">
      <h2>Finance (${entries.length})</h2>
      <button class="btn btn-primary btn-sm" id="addEntryBtn">+ Add Entry</button>
    </div>
    <table>
      <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Amount</th><th>Description</th><th>Actions</th></tr></thead>
      <tbody>
        ${pageItems.map(e => `
          <tr>
            <td>${e.date}</td>
            <td><span class="status-pill ${e.entryType === 'income' ? 'regular' : 'inactive'}">${e.entryType}</span></td>
            <td>${escapeHtml(e.category)}</td>
            <td>${fmt(e.amount)}</td>
            <td>${escapeHtml(e.description || '—')}</td>
            <td class="row-actions">
              <button data-edit-entry="${e.id}">Edit</button>
              <button class="danger" data-delete-entry="${e.id}">Delete</button>
            </td>
          </tr>
        `).join('') || '<tr><td colspan="6">No finance entries yet.</td></tr>'}
      </tbody>
    </table>
    <div id="financePagination"></div>
  `;

  renderPaginationControls('financePagination', entries.length, SHEP_ROWS_PER_PAGE, financePage, (p) => {
    financePage = p;
    renderFinance();
  });

  document.getElementById('addEntryBtn').addEventListener('click', () => openFinanceForm(null));
  el.querySelectorAll('[data-edit-entry]').forEach(btn => {
    btn.addEventListener('click', () => {
      const entry = entries.find(e => e.id === btn.dataset.editEntry);
      openFinanceForm(entry);
    });
  });
  el.querySelectorAll('[data-delete-entry]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this entry? This cannot be undone.')) return;
      await fetchJSON(`/api/shepherd/finance/${btn.dataset.deleteEntry}`, { method: 'DELETE' });
      renderFinance();
    });
  });
}

function openFinanceForm(entry) {
  const isEdit = !!entry;
  showModal(`
    <h3>${isEdit ? 'Edit' : 'Add'} Finance Entry</h3>
    <form id="financeForm">
      <div class="field"><label>Type</label>
        <select id="fType">
          <option value="income" ${entry?.entryType === 'income' ? 'selected' : ''}>Income</option>
          <option value="expense" ${entry?.entryType === 'expense' ? 'selected' : ''}>Expense</option>
        </select>
      </div>
      <div class="field" id="categoryFieldWrap"></div>
      <div class="field"><label>Amount (GH₵)</label><input type="number" id="fAmount" step="0.01" min="0" value="${entry?.amount || ''}" required></div>
      <div class="field"><label>Date</label><input type="date" id="fDate" value="${entry?.date || new Date().toISOString().slice(0, 10)}" required></div>
      <div class="field"><label>Description (optional)</label><input type="text" id="fDescription" value="${escapeHtml(entry?.description || '')}"></div>
      <div style="display:flex; gap:10px;">
        <button type="submit" class="btn btn-primary">Save</button>
        <button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button>
      </div>
      <div class="form-msg" id="financeFormMsg"></div>
    </form>
  `);

  function renderCategoryField() {
    const type = document.getElementById('fType').value;
    const wrap = document.getElementById('categoryFieldWrap');
    if (type === 'income') {
      wrap.innerHTML = `
        <label>Income Source</label>
        <select id="fCategory">
          ${INCOME_CATEGORIES.map(c => `<option value="${c.value}" ${entry?.category === c.value ? 'selected' : ''}>${c.label}</option>`).join('')}
        </select>
      `;
    } else {
      wrap.innerHTML = `<label>Expense Category</label><input type="text" id="fCategory" value="${escapeHtml(entry?.category || '')}" placeholder="e.g. Utilities, Maintenance, Outreach" required>`;
    }
  }
  renderCategoryField();
  document.getElementById('fType').addEventListener('change', renderCategoryField);
  document.getElementById('cancelModalBtn').addEventListener('click', closeModal);

  document.getElementById('financeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      entryType: document.getElementById('fType').value,
      category: document.getElementById('fCategory').value,
      amount: document.getElementById('fAmount').value,
      date: document.getElementById('fDate').value,
      description: document.getElementById('fDescription').value
    };
    try {
      if (isEdit) {
        await fetchJSON(`/api/shepherd/finance/${entry.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
      } else {
        await fetchJSON('/api/shepherd/finance', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
      }
      closeModal();
      showToast('Finance entry saved.', 'success');
      renderFinance();
    } catch (err) {
      document.getElementById('financeFormMsg').textContent = err.message || 'Could not save.';
      document.getElementById('financeFormMsg').className = 'form-msg error';
    }
  });
}

checkAuth();
