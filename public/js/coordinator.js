/* ============================================================
   Chapter Coordinator — the highest local authority in one
   ACONSU chapter (section 4). Mostly a read-only view across
   every office in the chapter — each office still owns its own
   work — plus the powers that genuinely belong at this level:
   approving sensitive operations and chapter-wide announcements.
   ============================================================ */

const OFFICE_LINKS = [
  { role: 'chapterAdmin', href: '/admin.html', label: 'Chapter Admin', blurb: 'Day-to-day chapter administration' },
  { role: 'finance', href: '/finance.html', label: 'Finance Office', blurb: 'Budgets, ledger and reports' },
  { role: 'shepherding', href: '/shepherding.html', label: 'Shepherding', blurb: 'Attendance, member care, messages' },
  { role: 'publicity', href: '/publicity.html', label: 'Publicity', blurb: 'Announcements, SMS, testimonies' }
];

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
      <p class="tiny muted" style="margin-top:12px;">Accounts are created by the ACONSU admin under Leadership Accounts.</p>
    </div>
  `;
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
    { key: 'approvals', label: 'Approvals', render: renderApprovals },
    { key: 'announcements', label: 'Chapter Announcement', render: renderChapterAnnouncements }
  ]
});
