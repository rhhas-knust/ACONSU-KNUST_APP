/* ============================================================
   Coordinator Dashboard — one screen for the whole union.
   Read-only on purpose: the coordinator sees how every office
   is doing, and each office still owns its own work.
   ============================================================ */

const OFFICE_LINKS = [
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
        <h2>The Union at a Glance</h2>
        <p class="sub">Every office, on one screen. Updated live — last read ${dateTimeLabel(data.generatedAt)}.</p>
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
      ${statCard('Members', shepherding.memberCount, { foot: `${shepherding.visitorCount} tracked visitors` })}
      ${statCard('Needs Attention', engagement.newJoinRequests + engagement.newPrayerRequests + engagement.unreadMessages, {
        tone: (engagement.newJoinRequests + engagement.newPrayerRequests + engagement.unreadMessages) ? 'gold' : '',
        foot: 'join requests, prayers and messages waiting'
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

initPortal({
  role: 'coordinator',
  label: 'Coordinator',
  panels: [
    { key: 'dashboard', label: 'Dashboard', render: renderCoordinatorDashboard },
    { key: 'offices', label: 'Offices & Leaders', render: renderOffices }
  ]
});
