/* ============================================================
   Finance Office — budgets, ledger and reporting.
   Money is only ever summed from the ledger, never stored as a
   total, so what this screen shows is always the books.
   ============================================================ */

const INCOME_CATEGORIES = [
  { value: 'momo', label: 'Mobile Money (MoMo)' },
  { value: 'tithe', label: 'Tithe' },
  { value: 'harvest', label: 'Harvest' },
  { value: 'offertory', label: 'Offertory' },
  { value: 'other', label: 'Other Income' }
];
const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'momo', label: 'Mobile Money' },
  { value: 'bank', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' }
];
const ROWS_PER_PAGE = 15;

const incomeLabel = (value) => (INCOME_CATEGORIES.find(c => c.value === value) || {}).label || value;
const monthLabel = (key) => {
  const [y, m] = String(key).split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
};

// ---------- overview ----------
async function renderFinanceOverview(el) {
  const [summary, budgets] = await Promise.all([
    fetchJSON('/api/finance/summary'),
    fetchJSON('/api/finance/budgets')
  ]);
  const activeBudget = budgets.find(b => b.status === 'active') || budgets[0] || null;
  const thisMonth = summary.monthly[summary.monthly.length - 1];

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Finance Overview</h2>
        <p class="sub">Everything ACONSU has received and spent, straight from the ledger.</p>
      </div>
    </div>

    <div class="stat-grid">
      ${statCard('Total Income', money(summary.totalIncome), { tone: 'good', foot: `${summary.entryCount} entries recorded` })}
      ${statCard('Total Expenses', money(summary.totalExpense), { tone: 'bad' })}
      ${statCard('Balance in Hand', money(summary.balance), { tone: summary.balance < 0 ? 'bad' : '' })}
      ${statCard('This Month', thisMonth ? money(thisMonth.income - thisMonth.expense) : money(0), {
        tone: 'gold',
        foot: thisMonth ? `${money(thisMonth.income)} in · ${money(thisMonth.expense)} out` : 'Nothing recorded yet this month'
      })}
    </div>

    <div class="portal-card">
      <h3>Income &amp; Expenditure by Month</h3>
      <p class="hint">The last twelve months of movement, oldest on the left.</p>
      ${barChart(
        summary.monthly.slice(-12).map(m => ({ label: monthLabel(m.month), value: m.income, value2: m.expense })),
        {
          format: (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v)),
          emptyMessage: 'No entries recorded yet — add one from the Ledger.',
          legend: [
            { label: 'Income', color: 'var(--purple-deep)' },
            { label: 'Expenses', color: 'var(--flame-gold)' }
          ]
        }
      )}
    </div>

    <div class="card-split">
      <div class="portal-card">
        <h3>Income by Source</h3>
        <p class="hint">Where the union's money comes from.</p>
        <div class="table-wrap">
          <table class="portal-table" style="min-width:0;">
            <tbody>
              ${INCOME_CATEGORIES.map(c => `
                <tr>
                  <td>${escapeHtml(c.label)}</td>
                  <td class="num">${money(summary.byIncomeCategory[c.value] || 0)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="portal-card">
        <h3>Biggest Expense Areas</h3>
        <p class="hint">Where it goes.</p>
        <div class="table-wrap">
          <table class="portal-table" style="min-width:0;">
            <tbody>
              ${Object.entries(summary.byExpenseCategory)
                .sort((a, b) => b[1] - a[1]).slice(0, 8)
                .map(([cat, amt]) => `<tr><td>${escapeHtml(cat)}</td><td class="num">${money(amt)}</td></tr>`)
                .join('') || '<tr><td class="muted">No expenses recorded yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    ${activeBudget ? `
      <div class="portal-card">
        <h3>${escapeHtml(activeBudget.name)} ${pill(activeBudget.status)}</h3>
        <p class="hint">${shortDate(activeBudget.startDate)} — ${shortDate(activeBudget.endDate)}</p>
        <div class="stat-grid" style="margin-bottom:0;">
          ${statCard('Planned Income', money(activeBudget.plannedIncome), { foot: `${money(activeBudget.actualIncome)} received so far` })}
          ${statCard('Planned Spending', money(activeBudget.plannedExpense), { foot: `${money(activeBudget.actualExpense)} spent so far` })}
          ${statCard('Planned Balance', money(activeBudget.plannedBalance), { foot: `Actual: ${money(activeBudget.actualBalance)}` })}
        </div>
      </div>
    ` : `
      <div class="portal-card">
        <h3>No budget set up yet</h3>
        <p class="hint">A budget lets you plan income and spending for a term or academic year, then track what actually happens against the plan.</p>
        ${PORTAL.canEdit ? '<button class="btn btn-primary btn-sm" onclick="openPanel(\'budgets\')">Create the first budget</button>' : ''}
      </div>
    `}
  `;
}

// ---------- budgets ----------
async function renderBudgets(el) {
  const budgets = await fetchJSON('/api/finance/budgets');

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Budgets (${budgets.length})</h2>
        <p class="sub">Plan a period's income and spending, then watch the actual figures fill in against it automatically.</p>
      </div>
      ${PORTAL.canEdit ? '<div class="panel-actions"><button class="btn btn-primary btn-sm" id="addBudgetBtn">+ New Budget</button></div>' : ''}
    </div>
    ${budgets.map(b => budgetCard(b)).join('') || '<div class="portal-card"><p class="empty-state">No budgets yet. Create one to start planning.</p></div>'}
  `;

  const addBtn = document.getElementById('addBudgetBtn');
  if (addBtn) addBtn.addEventListener('click', () => openBudgetForm(null));

  el.querySelectorAll('[data-edit-budget]').forEach(btn => {
    btn.addEventListener('click', () => openBudgetForm(budgets.find(b => b.id === btn.dataset.editBudget)));
  });
  el.querySelectorAll('[data-delete-budget]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this budget? Ledger entries stay, they just stop being linked to a plan.')) return;
      await fetchJSON(`/api/finance/budgets/${btn.dataset.deleteBudget}`, { method: 'DELETE' });
      showToast('Budget deleted.', 'success');
      openPanel('budgets');
    });
  });
}

function budgetLineRow(line) {
  // Income does well by exceeding its plan; spending does well by staying under.
  const over = line.lineType === 'expense' && line.usedPercent !== null && line.usedPercent > 100;
  const healthy = line.lineType === 'income' && line.usedPercent !== null && line.usedPercent >= 100;
  const width = Math.min(100, line.usedPercent === null ? 0 : line.usedPercent);
  return `
    <tr>
      <td>${escapeHtml(line.category)}${line.notes ? `<br><small class="muted">${escapeHtml(line.notes)}</small>` : ''}</td>
      <td>${pill(line.lineType)}</td>
      <td class="num">${money(line.plannedAmount)}</td>
      <td class="num">${money(line.actual)}</td>
      <td class="num" style="color:${line.variance < 0 ? 'var(--flame-red)' : '#2E7D4F'}; font-weight:700;">
        ${money(line.variance)}
      </td>
      <td>
        ${line.usedPercent === null ? '<span class="muted tiny">no plan set</span>' : `
          <span class="tiny">${line.usedPercent}%</span>
          <div class="meter"><span class="${over ? 'over' : healthy ? 'good' : ''}" style="width:${width}%"></span></div>
        `}
      </td>
    </tr>
  `;
}

function budgetCard(b) {
  return `
    <div class="portal-card">
      <div class="panel-head" style="margin-bottom:14px;">
        <div>
          <h3 style="margin:0;">${escapeHtml(b.name)} ${pill(b.status)}</h3>
          <p class="sub">${shortDate(b.startDate)} — ${shortDate(b.endDate)}${b.notes ? ` · ${escapeHtml(b.notes)}` : ''}</p>
        </div>
        ${PORTAL.canEdit ? `
          <div class="row-actions">
            <button data-edit-budget="${b.id}">Edit</button>
            <button class="danger" data-delete-budget="${b.id}">Delete</button>
          </div>` : ''}
      </div>
      <div class="stat-grid" style="margin-bottom:18px;">
        ${statCard('Income vs Plan', `${money(b.actualIncome)}`, { tone: 'good', foot: `planned ${money(b.plannedIncome)}` })}
        ${statCard('Spending vs Plan', `${money(b.actualExpense)}`, { tone: b.actualExpense > b.plannedExpense ? 'bad' : '', foot: `planned ${money(b.plannedExpense)}` })}
        ${statCard('Balance', money(b.actualBalance), { tone: b.actualBalance < 0 ? 'bad' : '', foot: `planned ${money(b.plannedBalance)}` })}
      </div>
      <div class="table-wrap">
        <table class="portal-table">
          <thead>
            <tr><th>Line</th><th>Type</th><th class="num">Planned</th><th class="num">Actual</th><th class="num">Variance</th><th>Progress</th></tr>
          </thead>
          <tbody>
            ${b.lines.map(budgetLineRow).join('') || emptyRow(6, 'This budget has no lines yet.')}
          </tbody>
        </table>
      </div>
      ${b.unallocated ? `<p class="tiny muted" style="margin-top:10px;">${money(b.unallocated)} booked to this budget without a line.</p>` : ''}
    </div>
  `;
}

function budgetLineFormRow(line, index) {
  const l = line || { lineId: '', lineType: 'expense', category: '', plannedAmount: '', notes: '' };
  return `
    <tr data-line-row>
      <td><input type="hidden" data-line-id value="${escapeHtml(l.lineId)}">
        <select data-line-type>
          <option value="income" ${l.lineType === 'income' ? 'selected' : ''}>Income</option>
          <option value="expense" ${l.lineType === 'expense' ? 'selected' : ''}>Expense</option>
        </select>
      </td>
      <td><input type="text" data-line-category value="${escapeHtml(l.category)}" placeholder="e.g. Offertory, Outreach, Refreshments"></td>
      <td><input type="number" step="0.01" min="0" data-line-amount value="${l.plannedAmount}" placeholder="0.00"></td>
      <td><button type="button" class="danger" data-remove-line="${index}">Remove</button></td>
    </tr>
  `;
}

function openBudgetForm(budget) {
  const isEdit = !!budget;
  const lines = isEdit && budget.lines.length ? budget.lines : [null];
  showModal(`
    <h3>${isEdit ? 'Edit' : 'New'} Budget</h3>
    <form id="budgetForm">
      <div class="field"><label>Budget Name</label>
        <input type="text" id="bName" value="${escapeHtml(budget?.name || '')}" placeholder="e.g. 2025/26 Academic Year" required></div>
      <div class="field-row">
        <div class="field"><label>Starts</label><input type="date" id="bStart" value="${budget?.startDate || todayISO()}" required></div>
        <div class="field"><label>Ends</label><input type="date" id="bEnd" value="${budget?.endDate || ''}" required></div>
      </div>
      <div class="field"><label>Status</label>
        <select id="bStatus">
          <option value="draft" ${budget?.status === 'draft' ? 'selected' : ''}>Draft — still being planned</option>
          <option value="active" ${budget?.status === 'active' ? 'selected' : ''}>Active — currently in use</option>
          <option value="closed" ${budget?.status === 'closed' ? 'selected' : ''}>Closed — period finished</option>
        </select>
      </div>
      <div class="field"><label>Notes</label><input type="text" id="bNotes" value="${escapeHtml(budget?.notes || '')}" placeholder="Optional"></div>

      <label style="display:block; font-weight:700; font-size:0.85rem; margin-bottom:6px; color:var(--purple-rich);">Budget Lines</label>
      <p class="tiny muted" style="margin-bottom:10px;">Each line is one planned income source or spending area. Ledger entries booked to a line fill in the actual figure by themselves.</p>
      <div class="table-wrap" style="margin-bottom:12px;">
        <table class="portal-table" style="min-width:440px;">
          <thead><tr><th>Type</th><th>Category</th><th>Planned (GH₵)</th><th></th></tr></thead>
          <tbody id="budgetLines">${lines.map((l, i) => budgetLineFormRow(l, i)).join('')}</tbody>
        </table>
      </div>
      <button type="button" class="btn btn-outline btn-sm" id="addLineBtn">+ Add another line</button>

      <div style="display:flex; gap:10px; margin-top:22px;">
        <button type="submit" class="btn btn-primary">Save Budget</button>
        <button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button>
      </div>
      <div class="form-msg" id="budgetFormMsg"></div>
    </form>
  `, true);

  const linesBody = document.getElementById('budgetLines');
  const wireRemove = () => {
    linesBody.querySelectorAll('[data-remove-line]').forEach(btn => {
      btn.onclick = () => {
        if (linesBody.querySelectorAll('[data-line-row]').length === 1) return; // always keep one row
        btn.closest('tr').remove();
      };
    });
  };
  wireRemove();
  document.getElementById('addLineBtn').addEventListener('click', () => {
    linesBody.insertAdjacentHTML('beforeend', budgetLineFormRow(null, linesBody.children.length));
    wireRemove();
  });

  document.getElementById('budgetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('bName').value,
      startDate: document.getElementById('bStart').value,
      endDate: document.getElementById('bEnd').value,
      status: document.getElementById('bStatus').value,
      notes: document.getElementById('bNotes').value,
      lines: [...linesBody.querySelectorAll('[data-line-row]')].map(row => ({
        lineId: row.querySelector('[data-line-id]').value,
        lineType: row.querySelector('[data-line-type]').value,
        category: row.querySelector('[data-line-category]').value.trim(),
        plannedAmount: Number(row.querySelector('[data-line-amount]').value || 0)
      })).filter(l => l.category)
    };
    try {
      await fetchJSON(isEdit ? `/api/finance/budgets/${budget.id}` : '/api/finance/budgets', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      closeModal();
      showToast('Budget saved.', 'success');
      openPanel('budgets');
    } catch (err) {
      setFormMsg('budgetFormMsg', err.message || 'Could not save this budget.', 'error');
    }
  });
}

// ---------- ledger ----------
const ledgerFilters = { from: '', to: '', entryType: '', budgetId: '' };
let ledgerPage = 1;

async function renderLedger(el) {
  const query = new URLSearchParams(Object.entries(ledgerFilters).filter(([, v]) => v)).toString();
  const [entries, budgets] = await Promise.all([
    fetchJSON(`/api/finance/entries${query ? `?${query}` : ''}`),
    fetchJSON('/api/finance/budgets')
  ]);
  const budgetName = (id) => (budgets.find(b => b.id === id) || {}).name || '';
  const totals = entries.reduce((acc, e) => {
    acc[e.entryType] += e.amount;
    return acc;
  }, { income: 0, expense: 0 });
  const pageItems = paginate(entries, ledgerPage, ROWS_PER_PAGE);

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Ledger</h2>
        <p class="sub">Every cedi in and out, with how it moved and who recorded it.</p>
      </div>
      ${PORTAL.canEdit ? '<div class="panel-actions"><button class="btn btn-primary btn-sm" id="addEntryBtn">+ Record Entry</button></div>' : ''}
    </div>

    <div class="portal-card">
      <div class="inline-form" style="margin-bottom:0;">
        <div class="field"><label>From</label><input type="date" id="fFrom" value="${ledgerFilters.from}"></div>
        <div class="field"><label>To</label><input type="date" id="fTo" value="${ledgerFilters.to}"></div>
        <div class="field"><label>Type</label>
          <select id="fType">
            <option value="">All</option>
            <option value="income" ${ledgerFilters.entryType === 'income' ? 'selected' : ''}>Income only</option>
            <option value="expense" ${ledgerFilters.entryType === 'expense' ? 'selected' : ''}>Expenses only</option>
          </select>
        </div>
        <div class="field"><label>Budget</label>
          <select id="fBudget">
            <option value="">All</option>
            ${budgets.map(b => `<option value="${b.id}" ${ledgerFilters.budgetId === b.id ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('')}
          </select>
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="applyFiltersBtn">Apply</button>
        <button type="button" class="btn btn-outline btn-sm" id="clearFiltersBtn">Clear</button>
      </div>
    </div>

    <div class="stat-grid">
      ${statCard('Income (filtered)', money(totals.income), { tone: 'good' })}
      ${statCard('Expenses (filtered)', money(totals.expense), { tone: 'bad' })}
      ${statCard('Net (filtered)', money(totals.income - totals.expense), { tone: totals.income - totals.expense < 0 ? 'bad' : '' })}
      ${statCard('Entries', entries.length)}
    </div>

    <div class="table-wrap">
      <table class="portal-table">
        <thead>
          <tr>
            <th>Date</th><th>Type</th><th>Category</th><th class="num">Amount</th>
            <th>Method</th><th>Details</th><th>Budget</th>${PORTAL.canEdit ? '<th>Actions</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${pageItems.map(e => `
            <tr>
              <td>${shortDate(e.date)}</td>
              <td>${pill(e.entryType)}</td>
              <td>${escapeHtml(e.entryType === 'income' ? incomeLabel(e.category) : e.category)}</td>
              <td class="num" style="font-weight:700; color:${e.entryType === 'income' ? '#2E7D4F' : 'var(--flame-red)'};">
                ${e.entryType === 'income' ? '+' : '−'}${money(e.amount).replace('GH₵ ', 'GH₵ ')}
              </td>
              <td>${escapeHtml(e.method || 'cash')}${e.reference ? `<br><small class="muted">${escapeHtml(e.reference)}</small>` : ''}</td>
              <td>${escapeHtml(e.description || '—')}${e.payee ? `<br><small class="muted">${escapeHtml(e.payee)}</small>` : ''}
                  ${e.approvalStatus && e.approvalStatus !== 'recorded' ? `<br>${pill(e.approvalStatus)}` : ''}</td>
              <td class="tiny muted">${escapeHtml(budgetName(e.budgetId) || '—')}</td>
              ${PORTAL.canEdit ? `
                <td class="row-actions">
                  <button data-edit-entry="${e.id}">Edit</button>
                  <button class="danger" data-delete-entry="${e.id}">Delete</button>
                </td>` : ''}
            </tr>
          `).join('') || emptyRow(PORTAL.canEdit ? 8 : 7, 'No entries match these filters yet.')}
        </tbody>
      </table>
    </div>
    <div id="ledgerPagination"></div>
  `;

  renderPaginationControls('ledgerPagination', entries.length, ROWS_PER_PAGE, ledgerPage, (p) => {
    ledgerPage = p;
    openPanel('ledger');
  });

  document.getElementById('applyFiltersBtn').addEventListener('click', () => {
    ledgerFilters.from = document.getElementById('fFrom').value;
    ledgerFilters.to = document.getElementById('fTo').value;
    ledgerFilters.entryType = document.getElementById('fType').value;
    ledgerFilters.budgetId = document.getElementById('fBudget').value;
    ledgerPage = 1;
    openPanel('ledger');
  });
  document.getElementById('clearFiltersBtn').addEventListener('click', () => {
    Object.keys(ledgerFilters).forEach(k => { ledgerFilters[k] = ''; });
    ledgerPage = 1;
    openPanel('ledger');
  });

  const addBtn = document.getElementById('addEntryBtn');
  if (addBtn) addBtn.addEventListener('click', () => openEntryForm(null, budgets));
  el.querySelectorAll('[data-edit-entry]').forEach(btn => {
    btn.addEventListener('click', () => openEntryForm(entries.find(e => e.id === btn.dataset.editEntry), budgets));
  });
  el.querySelectorAll('[data-delete-entry]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this entry? This cannot be undone.')) return;
      await fetchJSON(`/api/finance/entries/${btn.dataset.deleteEntry}`, { method: 'DELETE' });
      showToast('Entry deleted.', 'success');
      openPanel('ledger');
    });
  });
}

function openEntryForm(entry, budgets) {
  const isEdit = !!entry;
  showModal(`
    <h3>${isEdit ? 'Edit' : 'Record'} Entry</h3>
    <form id="entryForm">
      <div class="field-row">
        <div class="field"><label>Type</label>
          <select id="eType">
            <option value="income" ${entry?.entryType === 'income' ? 'selected' : ''}>Money In (Income)</option>
            <option value="expense" ${entry?.entryType === 'expense' ? 'selected' : ''}>Money Out (Expense)</option>
          </select>
        </div>
        <div class="field"><label>Date</label><input type="date" id="eDate" value="${entry?.date || todayISO()}" required></div>
      </div>
      <div class="field" id="categoryWrap"></div>
      <div class="field-row">
        <div class="field"><label>Amount (GH₵)</label><input type="number" id="eAmount" step="0.01" min="0.01" value="${entry?.amount || ''}" required></div>
        <div class="field"><label>How did the money move?</label>
          <select id="eMethod">
            ${PAYMENT_METHODS.map(m => `<option value="${m.value}" ${entry?.method === m.value ? 'selected' : ''}>${m.label}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>Reference</label><input type="text" id="eReference" value="${escapeHtml(entry?.reference || '')}" placeholder="MoMo ID, receipt no."></div>
        <div class="field"><label id="payeeLabel">Paid to / Received from</label><input type="text" id="ePayee" value="${escapeHtml(entry?.payee || '')}" placeholder="Optional"></div>
      </div>
      <div class="field"><label>Description</label><input type="text" id="eDescription" value="${escapeHtml(entry?.description || '')}" placeholder="What was this for?"></div>
      <div class="field-row">
        <div class="field"><label>Budget</label>
          <select id="eBudget">
            <option value="">Not part of a budget</option>
            ${budgets.map(b => `<option value="${b.id}" ${entry?.budgetId === b.id ? 'selected' : ''}>${escapeHtml(b.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Budget Line</label><select id="eBudgetLine"><option value="">—</option></select></div>
      </div>
      <div class="field"><label>Approval</label>
        <select id="eApproval">
          <option value="recorded" ${(entry?.approvalStatus || 'recorded') === 'recorded' ? 'selected' : ''}>Recorded — no approval needed</option>
          <option value="pending" ${entry?.approvalStatus === 'pending' ? 'selected' : ''}>Awaiting approval</option>
          <option value="approved" ${entry?.approvalStatus === 'approved' ? 'selected' : ''}>Approved</option>
          <option value="rejected" ${entry?.approvalStatus === 'rejected' ? 'selected' : ''}>Rejected</option>
        </select>
      </div>
      <div style="display:flex; gap:10px;">
        <button type="submit" class="btn btn-primary">Save Entry</button>
        <button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button>
      </div>
      <div class="form-msg" id="entryFormMsg"></div>
    </form>
  `, true);

  // Income sources are a fixed list the union already uses; expenses vary too
  // much to constrain, so they stay free text.
  function renderCategoryField() {
    const type = document.getElementById('eType').value;
    const wrap = document.getElementById('categoryWrap');
    document.getElementById('payeeLabel').textContent = type === 'income' ? 'Received from' : 'Paid to';
    if (type === 'income') {
      wrap.innerHTML = `<label>Income Source</label>
        <select id="eCategory">
          ${INCOME_CATEGORIES.map(c => `<option value="${c.value}" ${entry?.category === c.value ? 'selected' : ''}>${c.label}</option>`).join('')}
        </select>`;
    } else {
      wrap.innerHTML = `<label>Expense Category</label>
        <input type="text" id="eCategory" value="${escapeHtml(entry?.entryType === 'expense' ? entry.category : '')}" placeholder="e.g. Refreshments, Transport, Sound" required>`;
    }
  }

  // Only lines belonging to the chosen budget, and only lines of the same
  // type — booking an expense against a planned income line makes no sense.
  function renderBudgetLines() {
    const budgetId = document.getElementById('eBudget').value;
    const type = document.getElementById('eType').value;
    const select = document.getElementById('eBudgetLine');
    const budget = budgets.find(b => b.id === budgetId);
    const lines = budget ? budget.lines.filter(l => l.lineType === type) : [];
    select.innerHTML = `<option value="">${budget ? 'Not tied to a line' : '— choose a budget first —'}</option>` +
      lines.map(l => `<option value="${l.lineId}" ${entry?.budgetLineId === l.lineId ? 'selected' : ''}>${escapeHtml(l.category)} (${money(l.plannedAmount)})</option>`).join('');
    select.disabled = !budget;
  }

  renderCategoryField();
  renderBudgetLines();
  document.getElementById('eType').addEventListener('change', () => { renderCategoryField(); renderBudgetLines(); });
  document.getElementById('eBudget').addEventListener('change', renderBudgetLines);

  document.getElementById('entryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      entryType: document.getElementById('eType').value,
      category: document.getElementById('eCategory').value,
      amount: document.getElementById('eAmount').value,
      date: document.getElementById('eDate').value,
      method: document.getElementById('eMethod').value,
      reference: document.getElementById('eReference').value,
      payee: document.getElementById('ePayee').value,
      description: document.getElementById('eDescription').value,
      budgetId: document.getElementById('eBudget').value,
      budgetLineId: document.getElementById('eBudgetLine').value,
      approvalStatus: document.getElementById('eApproval').value
    };
    try {
      await fetchJSON(isEdit ? `/api/finance/entries/${entry.id}` : '/api/finance/entries', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      closeModal();
      showToast('Entry saved.', 'success');
      openPanel('ledger');
    } catch (err) {
      setFormMsg('entryFormMsg', err.message || 'Could not save this entry.', 'error');
    }
  });
}

// ---------- reports ----------
const reportRange = { from: '', to: '' };

async function renderReports(el) {
  const query = new URLSearchParams(Object.entries(reportRange).filter(([, v]) => v)).toString();
  const summary = await fetchJSON(`/api/finance/summary${query ? `?${query}` : ''}`);
  const rangeLabel = reportRange.from || reportRange.to
    ? `${reportRange.from ? shortDate(reportRange.from) : 'the beginning'} to ${reportRange.to ? shortDate(reportRange.to) : 'today'}`
    : 'all time';

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Reports</h2>
        <p class="sub">A statement for any period, ready to read out at a meeting or hand over at an audit.</p>
      </div>
    </div>

    <div class="portal-card">
      <div class="inline-form" style="margin-bottom:0;">
        <div class="field"><label>From</label><input type="date" id="rFrom" value="${reportRange.from}"></div>
        <div class="field"><label>To</label><input type="date" id="rTo" value="${reportRange.to}"></div>
        <button type="button" class="btn btn-primary btn-sm" id="runReportBtn">Run Report</button>
        <a class="btn btn-outline btn-sm" id="exportCsvBtn" href="/api/finance/export.csv${query ? `?${query}` : ''}">Download CSV</a>
      </div>
    </div>

    <div class="portal-card">
      <h3>Statement — ${escapeHtml(rangeLabel)}</h3>
      <p class="hint">${summary.entryCount} entries in this period.</p>
      <div class="table-wrap">
        <table class="portal-table" style="min-width:0;">
          <tbody>
            ${INCOME_CATEGORIES.map(c => `
              <tr><td>Income — ${escapeHtml(c.label)}</td><td class="num">${money(summary.byIncomeCategory[c.value] || 0)}</td></tr>
            `).join('')}
            <tr style="background:var(--lilac-light);">
              <td><strong>Total Income</strong></td><td class="num"><strong>${money(summary.totalIncome)}</strong></td>
            </tr>
            ${Object.entries(summary.byExpenseCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => `
              <tr><td>Expense — ${escapeHtml(cat)}</td><td class="num">${money(amt)}</td></tr>
            `).join('') || '<tr><td class="muted">No expenses in this period</td><td class="num">—</td></tr>'}
            <tr style="background:var(--lilac-light);">
              <td><strong>Total Expenditure</strong></td><td class="num"><strong>${money(summary.totalExpense)}</strong></td>
            </tr>
            <tr style="background:var(--purple-deep); color:#fff;">
              <td><strong>Net for the period</strong></td><td class="num"><strong>${money(summary.balance)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="tiny muted" style="margin-top:12px;">Balance across all records to date: <strong>${money(summary.overallBalance)}</strong>.</p>
    </div>

    <div class="portal-card">
      <h3>Monthly Movement</h3>
      ${barChart(
        summary.monthly.map(m => ({ label: monthLabel(m.month), value: m.income, value2: m.expense })),
        {
          format: (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v)),
          emptyMessage: 'No entries in this period.',
          legend: [
            { label: 'Income', color: 'var(--purple-deep)' },
            { label: 'Expenses', color: 'var(--flame-gold)' }
          ]
        }
      )}
    </div>
  `;

  document.getElementById('runReportBtn').addEventListener('click', () => {
    reportRange.from = document.getElementById('rFrom').value;
    reportRange.to = document.getElementById('rTo').value;
    openPanel('reports');
  });
}

initPortal({
  role: 'finance',
  label: 'Finance Office',
  panels: [
    { key: 'overview', label: 'Overview', render: renderFinanceOverview },
    { key: 'budgets', label: 'Budgets', render: renderBudgets },
    { key: 'ledger', label: 'Ledger', render: renderLedger },
    { key: 'reports', label: 'Reports', render: renderReports }
  ]
});
