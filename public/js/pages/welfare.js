// The script of welfare.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
// The raw keys are not English. A member reading their own giving should not
// have to work out what "semester_dues" means.
const WELFARE_GIVING_LABELS = {
  tithe: 'Tithe', semester_dues: 'Semester welfare dues',
  donation: 'Donation', other: 'Other'
};
const cedi = (n) => 'GH\u20b5 ' + Number(n || 0).toFixed(2);
const niceDate = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  return isNaN(dt) ? String(d) : dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

async function loadMyWelfareGiving() {
  const wrap = document.getElementById('myWelfareGiving');
  try {
    const { totalReceived, received, awaiting } = await fetchJSON('/api/member/welfare-giving');
    if (!received.length && !awaiting.length) {
      wrap.innerHTML = '<p class="empty-state">Nothing recorded yet. Tithe and semester dues you pay to Welfare will show here once the team confirms them.</p>';
      return;
    }
    wrap.innerHTML = `
      ${received.length ? `
        <p style="margin-bottom:12px;">Welfare has recorded <strong>${cedi(totalReceived)}</strong> from you.</p>
        ${received.map(r => `
          <div class="welfare-card">
            <span class="status-pill approved">received</span>
            <p style="margin:8px 0 4px; font-weight:700;">${escapeHtml(WELFARE_GIVING_LABELS[r.category] || r.category)} \u2014 ${cedi(r.amount)}</p>
            <p style="color:var(--ink-soft); font-size:0.9rem;">
              Received ${escapeHtml(niceDate(r.receivedOn))}${r.recordedBy ? ', confirmed by ' + escapeHtml(r.recordedBy) : ''}${r.reference ? ' \u00b7 ref ' + escapeHtml(r.reference) : ''}
            </p>
          </div>
        `).join('')}
      ` : ''}
      ${awaiting.map(a => `
        <div class="welfare-card">
          <span class="status-pill ${a.kind === 'rejected' ? 'declined' : 'under_review'}">${a.kind === 'rejected' ? 'not confirmed' : 'awaiting confirmation'}</span>
          <p style="margin:8px 0 4px; font-weight:700;">${escapeHtml(WELFARE_GIVING_LABELS[a.category] || a.category)} \u2014 ${cedi(a.amount)}</p>
          <p style="color:var(--ink-soft); font-size:0.9rem;">
            ${a.kind === 'rejected'
              ? 'Welfare could not match this against the account.' + (a.note ? ' ' + escapeHtml(a.note) : '')
              : 'You told us about this on ' + escapeHtml(niceDate(a.loggedOn)) + '. Welfare will confirm it once it shows in the account.'}
          </p>
        </div>
      `).join('')}
    `;
  } catch (e) {
    wrap.innerHTML = '<p class="empty-state">Log in to see what Welfare has received from you.</p>';
  }
}

async function loadMyRequests() {
  const wrap = document.getElementById('myRequests');
  try {
    const items = await fetchJSON('/api/welfare/requests/mine');
    wrap.innerHTML = items.map(w => `
      <div class="welfare-card">
        <span class="status-pill ${w.status}">${w.status.replace('_', ' ')}</span>
        <p style="margin:8px 0 4px; font-weight:700;">${escapeHtml(w.category)}</p>
        <p style="color:var(--ink-soft); font-size:0.9rem;">${escapeHtml(w.description)}</p>
      </div>
    `).join('') || '<p class="empty-state">No requests submitted yet.</p>';
  } catch (e) {
    wrap.innerHTML = '<p class="empty-state">Log in to see your welfare requests.</p>';
  }
}

(async function () {
  await initLayout('/welfare.html');
  const authRes = await fetchJSON('/api/auth/me').catch(() => ({ member: null }));
  if (!authRes.member) {
    document.getElementById('welfareForm').innerHTML = '<p class="empty-state">Please <a href="/login.html">log in</a> to submit a welfare request.</p>';
  }
  loadMyRequests();
  loadMyWelfareGiving();
})();

document.getElementById('welfareForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('welfareSubmitBtn');
  const msg = document.getElementById('welfareMsg');
  btn.disabled = true;
  try {
    await fetchJSON('/api/welfare/requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: document.getElementById('category').value,
        description: document.getElementById('description').value,
        amountRequested: document.getElementById('amountRequested').value
      })
    });
    msg.textContent = 'Your request has been received. The Welfare team will follow up.';
    msg.className = 'form-msg success';
    showToast('Welfare request submitted.', 'success');
    document.getElementById('welfareForm').reset();
    loadMyRequests();
  } catch (err) {
    msg.textContent = err.message || 'Could not submit your request.';
    msg.className = 'form-msg error';
  } finally {
    btn.disabled = false;
  }
});
