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

/* ---------- the purse ----------
   Welfare collects the tithe and the semester dues into its own MoMo account
   and answers for that money to the Coordinator and the executive body. This
   is where it is recorded. It is a separate book from the chapter ledger the
   Financial Secretary keeps, because it is a separate account. */
const WELFARE_INCOME_CATEGORIES = [
  ['tithe', 'Tithe'],
  ['semester_dues', 'Semester welfare dues'],
  ['donation', 'Donation'],
  ['other', 'Other']
];
const WELFARE_EXPENSE_CATEGORIES = [
  ['member_support', 'Support paid to a member'],
  ['medical', 'Medical'],
  ['bereavement', 'Bereavement'],
  ['transport', 'Transport'],
  ['supplies', 'Supplies'],
  ['other', 'Other']
];
const WELFARE_CAT_LABEL = Object.fromEntries([...WELFARE_INCOME_CATEGORIES, ...WELFARE_EXPENSE_CATEGORIES]);

const cedis = (n) => `GHS ${(Number(n) || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function renderWelfarePurse(el) {
  const { totals, entries } = await fetchJSON('/api/welfare/ledger');

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>The Welfare Purse</h2>
        <p class="sub">Tithe and semester dues collected into Welfare's own account \u2014 and what has gone out of it.
          The Coordinator and the executive body can read this whole book at any time.</p>
      </div>
      <div class="panel-actions"><button class="btn btn-primary btn-sm" id="welAddBtn">+ Record money</button></div>
    </div>

    <div class="stat-grid">
      ${statCard('Collected', cedis(totals.income), { tone: 'good' })}
      ${statCard('Paid out', cedis(totals.expense))}
      ${statCard('Balance', cedis(totals.balance), { tone: totals.balance < 0 ? 'red' : 'gold' })}
      ${statCard('Entries', totals.entryCount)}
    </div>

    <div class="portal-card" style="margin-top:16px;">
      <h3>What came in</h3>
      <div class="row-actions" style="flex-wrap:wrap; gap:8px; margin-top:8px;">
        ${WELFARE_INCOME_CATEGORIES.map(([key, label]) =>
          `<span class="tiny muted">${escapeHtml(label)}: <strong>${cedis(totals.byCategory[key])}</strong></span>`).join('')}
      </div>
    </div>

    <div class="table-wrap" style="margin-top:16px;">
      <table class="portal-table">
        <thead><tr><th>Date</th><th>What</th><th>Who</th><th>Amount</th><th>Evidence</th><th></th></tr></thead>
        <tbody>
          ${entries.map(e => `
            <tr>
              <td class="tiny muted">${escapeHtml(e.date || '')}</td>
              <td>
                <strong>${escapeHtml(WELFARE_CAT_LABEL[e.category] || e.category)}</strong>
                ${e.description ? `<br><small class="muted">${escapeHtml(e.description)}</small>` : ''}
              </td>
              <td class="tiny muted">${escapeHtml(e.memberName || e.payee || '\u2014')}</td>
              <td><strong style="color:${e.entryType === 'income' ? '#2E7D4F' : 'var(--flame-red)'}">
                ${e.entryType === 'income' ? '+' : '\u2212'}${cedis(e.amount)}</strong></td>
              <td>${e.receiptFileId
                ? `<a href="/api/files/${escapeHtml(e.receiptFileId)}" target="_blank" rel="noopener">View</a>`
                : '<span class="tiny muted">\u2014</span>'}</td>
              <td><div class="row-actions"><button class="danger" data-del-wel="${escapeHtml(e.id)}">Remove</button></div></td>
            </tr>
          `).join('') || emptyRow(6, 'Nothing recorded yet.')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('welAddBtn').addEventListener('click', openWelfareEntryForm);
  el.querySelectorAll('[data-del-wel]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Remove this entry? The figures the Coordinator sees will change.')) return;
    try {
      await fetchJSON(`/api/welfare/ledger/${btn.dataset.delWel}`, { method: 'DELETE' });
      showToast('Entry removed.', 'success');
      openPanel('purse');
    } catch (err) { showToast(err.message || 'Could not remove that.', 'error'); }
  }));
}

function openWelfareEntryForm() {
  showModal(`
    <h3>Record money</h3>
    <form id="welForm">
      <div class="field"><label>Was this money in or out?</label>
        <select id="welType">
          <option value="income">Money received</option>
          <option value="expense">Money paid out</option>
        </select>
      </div>
      <div class="field"><label>What for?</label>
        <select id="welCategory"></select>
      </div>
      <div class="field"><label>Amount (GHS)</label>
        <input type="number" id="welAmount" min="0.01" step="0.01" required></div>
      <div class="field"><label>Date</label>
        <input type="date" id="welDate" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div class="field"><label>How</label>
        <select id="welMethod">
          <option value="momo">MoMo</option><option value="cash">Cash</option>
          <option value="bank">Bank</option><option value="other">Other</option>
        </select>
      </div>
      <div class="field"><label>MoMo / transfer reference (optional)</label>
        <input type="text" id="welReference"></div>

      <div class="field" id="welMemberWrap">
        <label>Which member paid? (optional)</label>
        <select id="welMemberId"><option value="">\u2014 not tied to one member \u2014</option></select>
      </div>
      <div class="field" id="welTermWrap">
        <label>Term (for dues, optional)</label>
        <input type="text" id="welTerm" placeholder="e.g. 2026/27 Semester 1"></div>

      <div class="field" id="welPayeeWrap" hidden>
        <label>Paid to</label>
        <input type="text" id="welPayee" placeholder="Who received it"></div>
      <div class="field" id="welReceiptWrap" hidden>
        <label>Evidence</label>
        <input type="file" id="welReceipt" accept="image/*,application/pdf">
        <small class="hint">Money going out needs a receipt or transfer screenshot \u2014 it cannot be recorded without one.</small>
      </div>

      <div class="field"><label>Note (optional)</label>
        <input type="text" id="welDescription"></div>

      <div style="display:flex; gap:10px; margin-top:20px;">
        <button type="submit" class="btn btn-primary">Record it</button>
        <button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button>
      </div>
      <div class="form-msg" id="welMsg"></div>
    </form>
  `);
  document.getElementById('cancelModalBtn').addEventListener('click', closeModal);

  const typeSel = document.getElementById('welType');
  const catSel = document.getElementById('welCategory');

  // The form only ever offers what the server will accept for that direction,
  // so it cannot be submitted in a shape the server has to refuse.
  const syncType = () => {
    const income = typeSel.value === 'income';
    const list = income ? WELFARE_INCOME_CATEGORIES : WELFARE_EXPENSE_CATEGORIES;
    catSel.innerHTML = list.map(([k, label]) => `<option value="${k}">${escapeHtml(label)}</option>`).join('');
    document.getElementById('welMemberWrap').hidden = !income;
    document.getElementById('welTermWrap').hidden = !income;
    document.getElementById('welPayeeWrap').hidden = income;
    document.getElementById('welReceiptWrap').hidden = income;
    document.getElementById('welReceipt').required = !income;
  };
  typeSel.addEventListener('change', syncType);
  syncType();

  fetchJSON('/api/admin/members')
    .then(members => {
      document.getElementById('welMemberId').innerHTML =
        '<option value="">\u2014 not tied to one member \u2014</option>' +
        members.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name || m.email || m.id)}</option>`).join('');
    })
    .catch(() => { /* the roster is a convenience here, not a requirement */ });

  document.getElementById('welForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData();
    fd.append('entryType', typeSel.value);
    fd.append('category', catSel.value);
    fd.append('amount', document.getElementById('welAmount').value);
    fd.append('date', document.getElementById('welDate').value);
    fd.append('method', document.getElementById('welMethod').value);
    fd.append('reference', document.getElementById('welReference').value);
    fd.append('description', document.getElementById('welDescription').value);
    if (typeSel.value === 'income') {
      fd.append('memberId', document.getElementById('welMemberId').value);
      fd.append('term', document.getElementById('welTerm').value);
    } else {
      fd.append('payee', document.getElementById('welPayee').value);
      const file = document.getElementById('welReceipt').files[0];
      if (file) fd.append('receipt', file);
    }
    try {
      const res = await fetch('/api/welfare/ledger', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not record that.');
      closeModal();
      showToast('Recorded.', 'success');
      openPanel('purse');
    } catch (err) {
      setFormMsg('welMsg', err.message || 'Could not record that.', 'error');
    }
  });
}

initPortal({
  role: 'welfare',
  label: 'Welfare',
  panels: [
    { key: 'overview', label: 'Overview', render: renderWelfareOverview },
    { key: 'queue', label: 'Requests', render: renderWelfareQueue },
    { key: 'purse', label: 'The Purse', render: renderWelfarePurse }
  ]
});
