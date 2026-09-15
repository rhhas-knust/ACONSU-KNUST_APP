/* ============================================================
   Chapter Coordinator — the highest local authority in one
   ACONSU chapter (section 4). Mostly a read-only view across
   every office in the chapter — each office still owns its own
   work — plus the powers that genuinely belong at this level:
   approving sensitive operations and chapter-wide announcements.
   ============================================================ */

const OFFICE_LINKS = [
  { role: 'chapterAdmin', href: '/chapter.html', label: 'Chapter Admin', blurb: 'Day-to-day chapter administration' },
  { role: 'finance', href: '/finance.html', label: 'Finance Office', blurb: 'Budgets, ledger and reports' },
  { role: 'shepherding', href: '/shepherding.html', label: 'Shepherding', blurb: 'Attendance, member care, messages' },
  { role: 'publicity', href: '/publicity.html', label: 'Publicity', blurb: 'Announcements, SMS, testimonies' },
  { role: 'welfare', href: '/welfare-portal.html', label: 'Welfare Office', blurb: 'Welfare requests and case notes' }
];

// The roles a Chapter Coordinator may appoint. Deliberately excludes
// nationalCoordinator and coordinator — those stay with National, and the
// server enforces it regardless of what this list says (NATIONAL_ONLY_ROLES
// in server.js). Every account created here is stamped with this
// coordinator's own chapter by the server, never by the browser.
const APPOINTABLE_ROLES = [
  { value: 'chapterAdmin', label: 'Chapter Admin', blurb: 'Runs the chapter day to day — members, events, content, reports' },
  { value: 'finance', label: 'Finance Officer', blurb: 'Budgets, ledger, giving reconciliation' },
  { value: 'shepherding', label: 'Shepherding', blurb: 'Attendance registers, member care, contact inbox' },
  { value: 'publicity', label: 'Publicity Officer', blurb: 'Announcements, SMS, testimonies' },
  { value: 'welfare', label: 'Welfare Officer', blurb: 'Welfare requests and confidential case notes' },
  { value: 'executive', label: 'Executive', blurb: 'An executive with their own portal account' },
  { value: 'departmentLeader', label: 'Department Leader', blurb: 'Leads one department' }
];
const ROLE_LABEL = APPOINTABLE_ROLES.reduce((acc, r) => { acc[r.value] = r.label; return acc; },
  { coordinator: 'Chapter Coordinator', nationalCoordinator: 'National Coordinator' });

// ---------- dashboard ----------
async function renderCoordinatorDashboard(el) {
  const data = await fetchJSON('/api/coordinator/overview');
  const { finance, shepherding, publicity, engagement } = data;
  const budget = finance.activeBudget;

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>${data.chapter ? escapeHtml(data.chapter.name) : 'Your Chapter'}, at a Glance</h2>
        <p class="sub">Every office in your chapter, on one screen. Updated live — last read ${dateTimeLabel(data.generatedAt)}.</p>
      </div>
    </div>

    <div class="stat-grid">
      ${statCard('Balance in Hand', money(finance.balance), {
        tone: finance.balance < 0 ? 'bad' : 'good',
        foot: `${money(finance.thisMonth.totalIncome)} in this month`
      })}
      ${statCard('Average Attendance', shepherding.averageAttendance, {
        foot: shepherding.lastService ? `last service ${shortDate(shepherding.lastService.date)}` : 'no register taken yet'
      })}
      ${statCard('Active Members', shepherding.activeMembers, { foot: `${shepherding.awaitingReview} awaiting shepherding review` })}
      ${statCard('Needs Attention', engagement.newJoinRequests + engagement.newPrayerRequests + engagement.unreadMessages + finance.pendingApprovals, {
        tone: (engagement.newJoinRequests + engagement.newPrayerRequests + engagement.unreadMessages + finance.pendingApprovals) ? 'gold' : '',
        foot: 'join requests, prayers, messages and approvals waiting'
      })}
    </div>

    <div class="portal-card">
      <h3>Attendance Trend</h3>
      <p class="hint">People counted at the most recent services, oldest on the left.</p>
      ${barChart(shepherding.attendanceTrend.map(a => ({ label: shortDate(a.date).replace(/ \d{4}$/, ''), value: a.present })), {
        emptyMessage: 'Shepherding has not recorded a register yet.'
      })}
    </div>

    <div class="card-split">
      <div class="portal-card">
        <h3>Finance</h3>
        <p class="hint">${finance.entryCount} entries across ${finance.budgetCount} budget${finance.budgetCount === 1 ? '' : 's'}.</p>
        <div class="table-wrap">
          <table class="portal-table" style="min-width:0;">
            <tbody>
              <tr><td>Total income</td><td class="num">${money(finance.totalIncome)}</td></tr>
              <tr><td>Total expenditure</td><td class="num">${money(finance.totalExpense)}</td></tr>
              <tr><td>This month, net</td><td class="num">${money(finance.thisMonth.balance)}</td></tr>
              <tr style="background:var(--lilac-light);"><td><strong>Balance</strong></td><td class="num"><strong>${money(finance.balance)}</strong></td></tr>
            </tbody>
          </table>
        </div>
        ${budget ? `
          <h4 style="margin:18px 0 8px;">${escapeHtml(budget.name)} ${pill(budget.status)}</h4>
          <div class="table-wrap">
            <table class="portal-table" style="min-width:0;">
              <thead><tr><th>Line</th><th class="num">Planned</th><th class="num">Actual</th><th>Progress</th></tr></thead>
              <tbody>
                ${budget.lines.slice(0, 6).map(l => `
                  <tr>
                    <td>${escapeHtml(l.category)} ${pill(l.lineType)}</td>
                    <td class="num">${money(l.plannedAmount)}</td>
                    <td class="num">${money(l.actual)}</td>
                    <td><div class="meter"><span class="${l.lineType === 'expense' && l.usedPercent > 100 ? 'over' : ''}" style="width:${Math.min(100, l.usedPercent || 0)}%"></span></div></td>
                  </tr>
                `).join('') || emptyRow(4, 'This budget has no lines yet.')}
              </tbody>
            </table>
          </div>
        ` : '<p class="tiny muted" style="margin-top:14px;">No active budget — finance can create one in their portal.</p>'}
      </div>

      <div class="portal-card">
        <h3>Shepherding</h3>
        <div class="table-wrap">
          <table class="portal-table" style="min-width:0;">
            <tbody>
              <tr><td>Services recorded</td><td class="num">${shepherding.servicesRecorded}</td></tr>
              <tr><td>Last service turnout</td><td class="num">${shepherding.lastService ? shepherding.lastService.marks.filter(m => m.status === 'present').length + (shepherding.lastService.visitorCount || 0) : '—'}</td></tr>
              <tr><td>People needing follow-up</td><td class="num">${shepherding.followUpNeeded}</td></tr>
              <tr><td>Unanswered messages</td><td class="num">${engagement.unreadMessages}</td></tr>
            </tbody>
          </table>
        </div>

        <h3 style="margin-top:22px;">Publicity</h3>
        <div class="table-wrap">
          <table class="portal-table" style="min-width:0;">
            <tbody>
              <tr><td>Announcements sent</td><td class="num">${publicity.notificationsSent}</td></tr>
              <tr><td>SMS delivered</td><td class="num">${publicity.smsSent}</td></tr>
              <tr><td>Scheduled to go out</td><td class="num">${publicity.scheduledPending}</td></tr>
              <tr><td>Testimonies awaiting review</td><td class="num">${publicity.testimoniesPending}</td></tr>
            </tbody>
          </table>
        </div>
        ${publicity.nextScheduled ? `
          <p class="tiny muted" style="margin-top:12px;">
            Next out: <strong>${escapeHtml(publicity.nextScheduled.title)}</strong> at ${dateTimeLabel(publicity.nextScheduled.scheduledFor)}.
          </p>` : ''}
      </div>
    </div>

    <div class="portal-card">
      <h3>Union Life</h3>
      <div class="stat-grid" style="margin-bottom:0;">
        ${statCard('Departments', engagement.departments)}
        ${statCard('Upcoming Events', engagement.upcomingEvents)}
        ${statCard('New Join Requests', engagement.newJoinRequests, { tone: engagement.newJoinRequests ? 'gold' : '' })}
        ${statCard('New Prayer Requests', engagement.newPrayerRequests, { tone: engagement.newPrayerRequests ? 'gold' : '' })}
      </div>
    </div>
  `;
}

// ---------- offices ----------
async function renderOffices(el) {
  const data = await fetchJSON('/api/coordinator/overview');
  const byRole = data.team.reduce((acc, s) => {
    (acc[s.role] = acc[s.role] || []).push(s);
    return acc;
  }, {});

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Offices &amp; Leaders</h2>
        <p class="sub">Who holds which portal, and a way straight into each one. Your coordinator sign-in opens all of them in read-only mode.</p>
      </div>
    </div>

    <div class="card-split">
      ${OFFICE_LINKS.map(o => `
        <div class="portal-card">
          <h3>${escapeHtml(o.label)}</h3>
          <p class="hint">${escapeHtml(o.blurb)}</p>
          <div class="table-wrap" style="margin-bottom:16px;">
            <table class="portal-table" style="min-width:0;">
              <tbody>
                ${(byRole[o.role] || []).map(s => `
                  <tr>
                    <td><strong>${escapeHtml(s.name || s.username)}</strong><br><small class="muted">${escapeHtml(s.username)}</small></td>
                    <td>${pill(s.active ? 'active' : 'disabled', s.active ? 'green' : 'grey')}</td>
                    <td class="tiny muted">${s.lastLoginAt ? `last in ${dateTimeLabel(s.lastLoginAt)}` : 'never signed in'}</td>
                  </tr>
                `).join('') || '<tr><td class="muted">No account created for this office yet.</td></tr>'}
              </tbody>
            </table>
          </div>
          <a class="btn btn-outline btn-sm" href="${o.href}">Open ${escapeHtml(o.label)}</a>
        </div>
      `).join('')}
    </div>

    <div class="portal-card">
      <h3>Coordinators</h3>
      <div class="table-wrap">
        <table class="portal-table" style="min-width:0;">
          <tbody>
            ${(byRole.coordinator || []).map(s => `
              <tr>
                <td><strong>${escapeHtml(s.name || s.username)}</strong><br><small class="muted">${escapeHtml(s.username)}</small></td>
                <td>${pill(s.active ? 'active' : 'disabled', s.active ? 'green' : 'grey')}</td>
                <td class="tiny muted">${s.lastLoginAt ? `last in ${dateTimeLabel(s.lastLoginAt)}` : 'never signed in'}</td>
              </tr>
            `).join('') || '<tr><td class="muted">No coordinator accounts yet.</td></tr>'}
          </tbody>
        </table>
      </div>
      <p class="tiny muted" style="margin-top:12px;">Coordinator accounts are assigned by the National Coordinator. Everyone else in your chapter, you appoint yourself under Leadership Accounts.</p>
    </div>
  `;
}

// ---------- leadership accounts ----------
// The Chapter Coordinator is the top local authority, so staffing the chapter
// belongs here rather than in the national inbox. The server already allowed
// this; until now nothing in the interface offered it, so every appointment
// in every chapter had to be requested from National.
function staffForm(existing) {
  const isEdit = !!existing;
  showModal(`
    <h3>${isEdit ? `Edit ${escapeHtml(existing.name || existing.username)}` : 'Appoint Chapter Leader'}</h3>
    <p class="hint">${isEdit
      ? 'Change their role, rename them, or set a new password. Leave the password blank to keep the current one.'
      : 'The account is created inside your own chapter automatically.'}</p>
    <form id="staffForm">
      ${isEdit ? '' : `
        <div class="field"><label>Username</label>
          <input type="text" id="sfUsername" autocomplete="off" required>
          <small class="hint">They sign in with this. Lowercase, no spaces.</small>
        </div>`}
      <div class="field"><label>Full Name</label>
        <input type="text" id="sfName" value="${escapeHtml(existing?.name || '')}" required></div>
      <div class="field"><label>Role</label>
        <select id="sfRole">
          ${APPOINTABLE_ROLES.map(r => `<option value="${r.value}" ${existing?.role === r.value ? 'selected' : ''}>${escapeHtml(r.label)}</option>`).join('')}
        </select>
        <small class="hint" id="sfRoleBlurb"></small>
      </div>
      <div class="field"><label>${isEdit ? 'New Password (optional)' : 'Password'}</label>
        <input type="password" id="sfPassword" minlength="8" autocomplete="new-password" ${isEdit ? '' : 'required'}>
        <small class="hint">At least 8 characters.</small>
      </div>
      <div style="display:flex; gap:10px; margin-top:22px;">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Save Changes' : 'Create Account'}</button>
        <button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button>
      </div>
      <div class="form-msg" id="staffFormMsg"></div>
    </form>
  `);

  const roleSelect = document.getElementById('sfRole');
  const blurb = document.getElementById('sfRoleBlurb');
  const showBlurb = () => {
    const found = APPOINTABLE_ROLES.find(r => r.value === roleSelect.value);
    blurb.textContent = found ? found.blurb : '';
  };
  roleSelect.addEventListener('change', showBlurb);
  showBlurb();

  document.getElementById('staffForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = document.getElementById('sfPassword').value;
    const payload = {
      name: document.getElementById('sfName').value,
      role: roleSelect.value
    };
    if (password) payload.password = password;
    if (!isEdit) payload.username = document.getElementById('sfUsername').value;
    try {
      await fetchJSON(isEdit ? `/api/admin/staff/${existing.id}` : '/api/admin/staff', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      closeModal();
      showToast(isEdit ? 'Account updated' : 'Chapter leader appointed', 'success');
      openPanel('accounts');
    } catch (err) {
      setFormMsg('staffFormMsg', err.message || 'Could not save this account.', 'error');
    }
  });
}

async function renderLeadershipAccounts(el) {
  const staff = await fetchJSON('/api/admin/staff');
  const appointable = staff.filter(s => s.role !== 'nationalCoordinator');
  const filled = new Set(appointable.filter(s => s.active).map(s => s.role));
  const unfilled = APPOINTABLE_ROLES.filter(r => !filled.has(r.value) && r.value !== 'departmentLeader' && r.value !== 'executive');

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Leadership Accounts</h2>
        <p class="sub">Appoint the people who run your chapter. These accounts belong to your chapter and are yours to manage — National is not involved.</p>
      </div>
      <div class="panel-actions"><button class="btn btn-primary btn-sm" id="newStaffBtn">+ Appoint Leader</button></div>
    </div>

    ${unfilled.length ? `
      <div class="portal-card" style="border-left:4px solid var(--flame-gold, #E8971E);">
        <h3>Offices still to fill</h3>
        <p class="hint">Your chapter runs on these. Appoint someone to each and they take the work from there.</p>
        <div class="row-actions" style="flex-wrap:wrap; gap:8px; margin-top:10px;">
          ${unfilled.map(r => `<button data-quick-role="${r.value}">+ ${escapeHtml(r.label)}</button>`).join('')}
        </div>
      </div>
    ` : ''}

    <div class="table-wrap">
      <table class="portal-table">
        <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead>
        <tbody>
          ${appointable.map(s => `
            <tr>
              <td><strong>${escapeHtml(s.name || s.username)}</strong><br><small class="muted">${escapeHtml(s.username)}</small></td>
              <td>${escapeHtml(ROLE_LABEL[s.role] || s.role)}</td>
              <td>${pill(s.active ? 'active' : 'disabled', s.active ? 'green' : 'grey')}</td>
              <td class="tiny muted">${s.lastLoginAt ? dateTimeLabel(s.lastLoginAt) : 'never'}</td>
              <td>
                <div class="row-actions">
                  ${s.role === 'coordinator' ? '<span class="tiny muted">assigned by National</span>' : `
                    <button data-edit-staff="${s.id}">Edit</button>
                    <button data-toggle-staff="${s.id}" data-active="${s.active ? '1' : '0'}">${s.active ? 'Disable' : 'Enable'}</button>
                    <button data-delete-staff="${s.id}" class="danger">Remove</button>
                  `}
                </div>
              </td>
            </tr>
          `).join('') || emptyRow(5, 'No chapter accounts yet — appoint your Chapter Admin first.')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('newStaffBtn').addEventListener('click', () => staffForm(null));
  el.querySelectorAll('[data-quick-role]').forEach(btn => btn.addEventListener('click', () => {
    staffForm(null);
    const select = document.getElementById('sfRole');
    if (select) { select.value = btn.dataset.quickRole; select.dispatchEvent(new Event('change')); }
  }));
  el.querySelectorAll('[data-edit-staff]').forEach(btn => btn.addEventListener('click', () =>
    staffForm(appointable.find(s => s.id === btn.dataset.editStaff))
  ));
  el.querySelectorAll('[data-toggle-staff]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await fetchJSON(`/api/admin/staff/${btn.dataset.toggleStaff}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: btn.dataset.active !== '1' })
      });
      showToast('Account updated', 'success');
      openPanel('accounts');
    } catch (err) { showToast(err.message || 'Could not update this account.', 'error'); }
  }));
  el.querySelectorAll('[data-delete-staff]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Remove this account? Their sign-in stops working immediately.')) return;
    try {
      await fetchJSON(`/api/admin/staff/${btn.dataset.deleteStaff}`, { method: 'DELETE' });
      showToast('Account removed', 'success');
      openPanel('accounts');
    } catch (err) { showToast(err.message || 'Could not remove this account.', 'error'); }
  }));
}

// ---------- approvals ----------
// "Approve sensitive chapter operations" (section 4) — today that means
// finance entries flagged pending. Approving here uses the same endpoint
// Finance itself uses; the Coordinator is simply also allowed to call it.
async function renderApprovals(el) {
  // The ledger route has no server-side approvalStatus filter, so this
  // filters client-side from the full (chapter-scoped) ledger.
  const all = await fetchJSON('/api/finance/entries');
  const pending = all.filter(e => e.approvalStatus === 'pending');

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Approvals</h2>
        <p class="sub">Finance entries waiting for a second pair of eyes before they're final.</p>
      </div>
    </div>
    <div class="table-wrap">
      <table class="portal-table">
        <thead><tr><th>Date</th><th>Type</th><th>Category</th><th class="num">Amount</th><th>Recorded By</th><th></th></tr></thead>
        <tbody>
          ${pending.map(e => `
            <tr>
              <td>${shortDate(e.date)}</td>
              <td>${pill(e.entryType)}</td>
              <td>${escapeHtml(e.category)}</td>
              <td class="num">${money(e.amount)}</td>
              <td>${escapeHtml(e.recordedBy || '—')}</td>
              <td>
                <div class="row-actions">
                  <button data-approve="${e.id}">Approve</button>
                  <button data-reject="${e.id}" class="danger">Reject</button>
                </div>
              </td>
            </tr>
          `).join('') || emptyRow(6, 'Nothing waiting on approval right now.')}
        </tbody>
      </table>
    </div>
  `;

  const act = async (id, approvalStatus) => {
    try {
      await fetchJSON(`/api/finance/entries/${id}/approval`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approvalStatus })
      });
      showToast(approvalStatus === 'approved' ? 'Entry approved' : 'Entry rejected', 'success');
      openPanel('approvals');
    } catch (err) {
      showToast(err.message || 'Could not update this entry.', 'error');
    }
  };
  el.querySelectorAll('[data-approve]').forEach(btn => btn.addEventListener('click', () => act(btn.dataset.approve, 'approved')));
  el.querySelectorAll('[data-reject]').forEach(btn => btn.addEventListener('click', () => act(btn.dataset.reject, 'rejected')));
}

// ---------- chapter-wide announcements ----------
async function renderChapterAnnouncements(el) {
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Chapter-Wide Announcement</h2>
        <p class="sub">Reaches everyone in your chapter. For finer control over channel, audience and timing, Publicity has the full composer.</p>
      </div>
    </div>
    <div class="portal-card" style="max-width:560px;">
      <form id="chapterAnnounceForm">
        <div class="field"><label>Title</label><input type="text" id="caTitle" required></div>
        <div class="field"><label>Message</label><textarea id="caBody" rows="4" required></textarea></div>
        <div class="field">
          <label><input type="checkbox" id="caSms" style="width:auto; margin-right:8px;">Also send as SMS</label>
        </div>
        <button type="submit" class="btn btn-primary">Send to the Chapter</button>
        <div class="form-msg" id="caMsg"></div>
      </form>
    </div>
  `;

  document.getElementById('chapterAnnounceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const channels = ['app'];
      if (document.getElementById('caSms').checked) channels.push('sms');
      const { result } = await fetchJSON('/api/coordinator/announcements', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: document.getElementById('caTitle').value, body: document.getElementById('caBody').value, channels })
      });
      setFormMsg('caMsg', result, 'success');
      document.getElementById('chapterAnnounceForm').reset();
      showToast('Sent to the chapter', 'success');
    } catch (err) {
      setFormMsg('caMsg', err.message || 'Could not send this announcement.', 'error');
    }
  });
}

initPortal({
  role: 'coordinator',
  label: 'Chapter Coordinator',
  panels: [
    { key: 'dashboard', label: 'Dashboard', render: renderCoordinatorDashboard },
    { key: 'offices', label: 'Offices & Leaders', render: renderOffices },
    { key: 'accounts', label: 'Leadership Accounts', render: renderLeadershipAccounts },
    { key: 'approvals', label: 'Approvals', render: renderApprovals },
    { key: 'announcements', label: 'Chapter Announcement', render: renderChapterAnnouncements }
  ]
});
