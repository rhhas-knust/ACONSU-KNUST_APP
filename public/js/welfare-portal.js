/* ============================================================
   Welfare Portal — member requests and Shepherding's referrals
   (section 33). Sensitive by design: only this role and Chapter
   Admin/Coordinator can ever open this data.
   ============================================================ */

const WELFARE_STATUSES = ['submitted', 'under_review', 'approved', 'declined', 'fulfilled'];
const WELFARE_CATEGORY_LABELS = { financial: 'Financial', medical: 'Medical', bereavement: 'Bereavement', academic: 'Academic', other: 'Other' };

async function renderWelfareOverview(el) {
  const items = await fetchJSON('/api/welfare/requests');
  const byStatus = (s) => items.filter(w => w.status === s).length;

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Welfare Overview</h2>
        <p class="sub">Confidential — visible only to Welfare and Chapter leadership.</p>
      </div>
    </div>
    <div class="stat-grid">
      ${statCard('New', byStatus('submitted'), { tone: byStatus('submitted') ? 'gold' : '' })}
      ${statCard('Under Review', byStatus('under_review'))}
      ${statCard('Approved', byStatus('approved'), { tone: 'good' })}
      ${statCard('Fulfilled', byStatus('fulfilled'), { tone: 'good' })}
    </div>
  `;
}

async function renderWelfareQueue(el) {
  const items = await fetchJSON('/api/welfare/requests');
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Requests (${items.length})</h2>
        <p class="sub">Includes both self-submitted requests and Shepherding referrals.</p>
      </div>
    </div>
    <div class="table-wrap">
      <table class="portal-table">
        <thead><tr><th>Member</th><th>Category</th><th>Description</th><th>Status</th><th>Source</th><th></th></tr></thead>
        <tbody>
          ${items.map(w => `
            <tr>
              <td>${escapeHtml(w.memberName || 'Unknown')}</td>
              <td>${WELFARE_CATEGORY_LABELS[w.category] || w.category}</td>
              <td style="max-width:260px;">${escapeHtml((w.description || '').slice(0, 120))}</td>
              <td>${pill(w.status.replace('_', ' '), w.status === 'fulfilled' || w.status === 'approved' ? 'green' : w.status === 'declined' ? 'red' : 'amber')}</td>
              <td class="tiny muted">${w.referredBy ? `Referred by ${escapeHtml(w.referredBy)}` : 'Self-submitted'}</td>
              <td><button data-manage="${w.id}">Manage</button></td>
            </tr>
          `).join('') || emptyRow(6, 'No welfare requests right now.')}
        </tbody>
      </table>
    </div>
  `;

  el.querySelectorAll('[data-manage]').forEach(btn => btn.addEventListener('click', () => {
    const item = items.find(w => w.id === btn.dataset.manage);
    showModal(`
      <h3>${escapeHtml(item.memberName || 'Unknown')} — ${WELFARE_CATEGORY_LABELS[item.category] || item.category}</h3>
      <p class="hint">${escapeHtml(item.description)}</p>
      ${item.amountRequested ? `<p class="tiny muted">Amount requested: ${money(item.amountRequested)}</p>` : ''}
      <form id="manageForm">
        <div class="field"><label>Status</label>
          <select id="wStatus">${WELFARE_STATUSES.map(s => `<option value="${s}" ${item.status === s ? 'selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Internal Case Notes (never shown to the member)</label><textarea id="wNotes">${escapeHtml(item.notes || '')}</textarea></div>
        <div style="display:flex; gap:10px;">
          <button type="submit" class="btn btn-primary">Save</button>
          <button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button>
        </div>
        <div class="form-msg" id="manageMsg"></div>
      </form>
    `);
    document.getElementById('manageForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await fetchJSON(`/api/welfare/requests/${item.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: document.getElementById('wStatus').value, notes: document.getElementById('wNotes').value })
        });
        closeModal();
        showToast('Request updated.', 'success');
        openPanel('queue');
      } catch (err) {
        setFormMsg('manageMsg', err.message || 'Could not save.', 'error');
      }
    });
  }));
}

initPortal({
  role: 'welfare',
  label: 'Welfare',
  panels: [
    { key: 'overview', label: 'Overview', render: renderWelfareOverview },
    { key: 'queue', label: 'Requests', render: renderWelfareQueue }
  ]
});
