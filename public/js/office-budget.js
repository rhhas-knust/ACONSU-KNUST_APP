/* ============================================================
   Budget requests.
   At the start of the year the Financial Secretary (or the Finance
   office) asks chosen departments for a budget. Each head fills in
   a form of line items. Finance reviews it, the Vice President
   decides, and the approved amounts are added to the chapter budget.
   The Chapter Coordinator can do whatever the Vice President can,
   so one empty seat never stalls the year's money.
   Requires office-ui.js.
   ============================================================ */
window.OfficeBudget = (function () {
  const U = OfficeUI;
  const esc = U.esc;

  const lineTable = (lines) => `
    <div class="table-wrap"><table class="portal-table">
      <thead><tr><th>What for</th><th class="num">Quantity</th><th class="num">Cost each</th><th class="num">Amount</th><th>Note</th></tr></thead>
      <tbody>${(lines || []).map(l => `
        <tr><td>${esc(l.item)}</td><td class="num">${esc(l.quantity)}</td><td class="num">${esc(U.cedi(l.unitCost))}</td><td class="num">${esc(U.cedi(l.amount))}</td><td>${esc(l.note || '')}</td></tr>`).join('')}
      </tbody>
    </table></div>`;

  const overdue = (call, sub) => call.dueDate && call.dueDate < new Date().toISOString().slice(0, 10)
    && (!sub || ['draft', 'returned'].includes(sub.status));

  // ================= the department head's side =================
  async function renderAnswer(el) {
    const data = await fetchJSON('/api/executive/budget-requests');
    const items = data.items || [];
    const head = `
      <div class="panel-head"><div>
        <h2>Budget requests</h2>
        <p class="sub">When Finance asks your department for a budget, you fill it in here. List everything the department will need, with the cost, and say why. Finance reviews it and the Vice President decides.</p>
      </div></div>`;
    if (!data.department) {
      el.innerHTML = `${head}<div class="portal-card"><p class="empty-state">Your Chapter Coordinator has not attached a department to your office yet, so there is no budget to fill in.</p></div>`;
      return;
    }
    if (!items.length) {
      el.innerHTML = `${head}<div class="portal-card"><p class="empty-state">Finance has not asked ${esc(data.department.name)} for a budget yet. When they do, it will appear here.</p></div>`;
      return;
    }
    el.innerHTML = head + items.map(({ call, submission }, i) => {
      const status = submission ? submission.status : 'draft';
      const editable = call.status === 'open' && (!submission || ['draft', 'returned'].includes(submission.status));
      const note = submission && (submission.status === 'returned' ? (submission.reviewNote) : submission.status === 'declined' ? submission.decisionNote : submission.decisionNote);
      return `
        <section class="portal-card" data-call="${esc(call.id)}" aria-labelledby="bq-${i}">
          <div class="of-card-head">
            <div>
              <h3 id="bq-${i}">${esc(call.title)}</h3>
              <p class="muted">${esc(data.department.name)}${call.periodLabel ? ` &middot; ${esc(call.periodLabel)}` : ''}${call.dueDate ? ` &middot; due ${esc(U.dayLabel(call.dueDate))}` : ''}</p>
            </div>
            <div>${call.status === 'closed' ? U.chip('Request closed', 'grey') : U.statusChip('budget', status)}</div>
          </div>
          ${overdue(call, submission) ? U.notice('<strong>This is past its due date.</strong> Please send it to Finance as soon as you can.', 'warn') : ''}
          ${call.instructions ? `<p><strong>From Finance:</strong> ${U.lines(call.instructions)}</p>` : ''}
          ${submission && submission.status === 'returned' ? U.notice(`<strong>Sent back.</strong><br>${U.lines(note)}`, 'warn') : ''}
          ${submission && ['recommended'].includes(submission.status) ? U.notice(`Finance recommends <strong>${esc(U.cedi(submission.recommendedTotal))}</strong>.${submission.reviewNote ? `<br>${U.lines(submission.reviewNote)}` : ''} The Vice President decides next.`) : ''}
          ${submission && submission.status === 'approved' ? U.notice(`<strong>Approved: ${esc(U.cedi(submission.approvedTotal))}.</strong>${submission.decisionNote ? `<br>${U.lines(submission.decisionNote)}` : ''}${submission.postedAt ? '<br>It has been added to the chapter budget.' : ''}`, 'good') : ''}
          ${submission && submission.status === 'declined' ? U.notice(`<strong>Declined.</strong><br>${U.lines(note)}`, 'bad') : ''}
          ${editable ? '<div class="of-form-slot"></div>' : (submission ? `${lineTable(submission.lines)}<p class="of-total">Total asked: <strong>${esc(U.cedi(submission.total))}</strong></p>${submission.justification ? `<p><strong>Why:</strong> ${U.lines(submission.justification)}</p>` : ''}` : '<p class="muted">This request is closed and no budget was sent.</p>')}
        </section>`;
    }).join('');

    items.forEach(({ call, submission }) => {
      const section = el.querySelector(`[data-call="${call.id}"]`);
      const slot = section && section.querySelector('.of-form-slot');
      if (slot) mountLineForm(slot, call, submission, () => renderAnswer(el));
    });
  }

  function mountLineForm(slot, call, submission, reload) {
    const lines = submission && submission.lines && submission.lines.length ? submission.lines : [];
    const rowFn = (l) => [
      U.cell('What for', 'item', l.item, { wide: true, placeholder: 'For example: Microphone stands' }),
      U.cell('Quantity', 'quantity', l.quantity === undefined ? 1 : l.quantity, { type: 'number', min: 0, step: '1' }),
      U.cell('Cost each (GH₵)', 'unitCost', l.unitCost || '', { type: 'number', min: 0, step: '0.01' }),
      `<div class="of-cell"><span>Amount</span><output class="of-amount" data-amount>${esc(U.cedi((Number(l.quantity) || 0) * (Number(l.unitCost) || 0)))}</output></div>`,
      U.cell('Note', 'note', l.note, { wide: true })
    ].join('');
    const id = `bl-${call.id}`;
    slot.innerHTML = `
      <form novalidate>
        <h4>What the department needs</h4>
        <p class="of-intro">One line for each thing. The amount works itself out from the quantity and the cost of one.</p>
        ${U.repeater(id, lines, rowFn, { addLabel: 'Add a line', blank: { quantity: 1 } })}
        <p class="of-total" aria-live="polite">Total: <strong data-total>${esc(U.cedi(0))}</strong></p>
        ${U.field({ id: `bj-${call.id}`, label: 'Why the department needs this', type: 'textarea', rows: 3, value: submission ? submission.justification : '', hint: 'A few sentences are enough. This is what Finance and the Vice President read first.' })}
        <div class="of-actions">
          <button type="button" class="btn btn-outline" data-save>Save draft</button>
          <button type="submit" class="btn btn-primary">Send to Finance</button>
        </div>
        <div class="form-msg" role="alert" data-msg></div>
      </form>`;
    const form = slot.querySelector('form');
    U.wireRepeaters(form, () => rowFn({ quantity: 1 }), () => ({ quantity: 1 }));
    const money2 = (n) => Math.round(n * 100) / 100;
    const recalc = () => {
      let total = 0;
      form.querySelectorAll('[data-row]').forEach(row => {
        const q = parseFloat(row.querySelector('[data-k="quantity"]').value) || 0;
        const c = parseFloat(row.querySelector('[data-k="unitCost"]').value) || 0;
        const amount = money2(q * c);
        row.querySelector('[data-amount]').textContent = U.cedi(amount);
        total += amount;
      });
      form.querySelector('[data-total]').textContent = U.cedi(money2(total));
    };
    form.addEventListener('input', recalc);
    form.addEventListener('change', recalc);
    recalc();
    const payload = (submit) => ({
      lines: U.collectRows(form, id), justification: form.querySelector(`#bj-${call.id}`).value, submit
    });
    const msg = (text, type) => { const m = form.querySelector('[data-msg]'); m.textContent = text; m.className = `form-msg ${type || ''}`; };
    form.querySelector('[data-save]').addEventListener('click', async (e) => {
      try { await U.busy(e.currentTarget, () => U.send(`/api/executive/budget-requests/${call.id}`, 'PUT', payload(false))); msg('Saved.', 'success'); showToast('Draft saved.', 'success'); }
      catch (err) { msg(err.message || 'Could not save.', 'error'); }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!confirm('Send this budget to Finance? You will not be able to change it unless they send it back.')) return;
      try { await U.busy(form.querySelector('[type="submit"]'), () => U.send(`/api/executive/budget-requests/${call.id}`, 'PUT', payload(true))); showToast('Sent to Finance.', 'success'); reload(); }
      catch (err) { msg(err.message || 'Could not send it.', 'error'); }
    });
  }

  // ================= the desk: Finance, the Vice President, the Coordinator =================
  async function renderDesk(el, callId) {
    if (callId) return renderCall(el, callId);
    const data = await fetchJSON('/api/budget/calls');
    const { canCall } = data;
    const items = data.items || [];
    el.innerHTML = `
      <div class="panel-head"><div>
        <h2>Budget requests</h2>
        <p class="sub">${canCall
          ? 'At the start of the year, ask the departments you choose for their budgets. Review what comes back, and when the Vice President has approved it, add it to the chapter budget.'
          : 'Budgets that Finance has reviewed wait here for your decision.'}</p>
      </div>
      ${canCall ? '<div class="panel-actions"><button class="btn btn-primary btn-sm" id="newCallBtn">Ask for budgets</button></div>' : ''}</div>
      <div id="newCallSlot"></div>
      ${items.length ? items.map(c => `
        <section class="portal-card">
          <div class="of-card-head">
            <div>
              <h3>${esc(c.title)}</h3>
              <p class="muted">${esc(c.periodLabel || '')}${c.dueDate ? ` &middot; due ${esc(U.dayLabel(c.dueDate))}` : ''}</p>
            </div>
            <div>${U.statusChip('call', c.status)}</div>
          </div>
          <p>${c.counts.draft + c.counts.returned + c.counts.submitted + c.counts.recommended + c.counts.approved + c.counts.declined} of ${c.asked} departments have started.
            ${c.counts.submitted ? `<strong>${c.counts.submitted} waiting for Finance.</strong> ` : ''}
            ${c.counts.recommended ? `<strong>${c.counts.recommended} waiting for the Vice President.</strong> ` : ''}
            ${c.counts.approved ? `${c.counts.approved} approved (${esc(U.cedi(c.approvedTotal))}). ` : ''}
            ${c.counts.returned ? `${c.counts.returned} sent back. ` : ''}</p>
          <div class="of-actions"><button class="btn btn-outline" data-open="${esc(c.id)}">Open</button></div>
        </section>`).join('') : `<div class="portal-card"><p class="empty-state">${canCall ? 'No budget has been asked for yet. Use “Ask for budgets” to start the year.' : 'Nothing has been asked for yet.'}</p></div>`}`;

    el.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => renderDesk(el, b.dataset.open)));
    const newBtn = el.querySelector('#newCallBtn');
    if (newBtn) newBtn.addEventListener('click', () => mountCallForm(el.querySelector('#newCallSlot'), data, () => renderDesk(el)));
  }

  function mountCallForm(slot, data, done) {
    slot.innerHTML = `
      <form class="portal-card" id="callForm" novalidate>
        <h3>Ask for budgets</h3>
        <div class="field-row">
          ${U.field({ id: 'cTitle', label: 'Title', required: true, value: `Budgets for ${data.defaultPeriod}` })}
          ${U.field({ id: 'cPeriod', label: 'Which year', value: data.defaultPeriod })}
          ${U.field({ id: 'cDue', label: 'Heads must send by', type: 'date' })}
        </div>
        <div class="field-row">
          ${U.field({ id: 'cStart', label: 'Budget year starts', type: 'date', hint: 'Leave blank for 1 August.' })}
          ${U.field({ id: 'cEnd', label: 'Budget year ends', type: 'date', hint: 'Leave blank for 31 July.' })}
        </div>
        ${U.field({ id: 'cNote', label: 'What the heads should know', type: 'textarea', rows: 3, hint: 'For example: use real prices, and give a reason for anything over GH₵ 500.' })}
        <fieldset class="of-fieldset">
          <legend>Which departments are you asking?</legend>
          <label class="of-check-line"><input type="checkbox" id="cAll"> All departments</label>
          <div class="of-checks">${(data.departments || []).map(d => `<label class="of-check-line"><input type="checkbox" name="dept" value="${esc(d.id)}"> ${esc(d.name)}</label>`).join('')}</div>
        </fieldset>
        <div class="of-actions">
          <button class="btn btn-primary" type="submit">Send the request</button>
          <button class="btn btn-outline" type="button" id="cancelCall">Cancel</button>
        </div>
        <div class="form-msg" id="callMsg" role="alert"></div>
      </form>`;
    const form = slot.querySelector('#callForm');
    const boxes = () => [...form.querySelectorAll('input[name="dept"]')];
    form.querySelector('#cAll').addEventListener('change', (e) => boxes().forEach(b => { b.checked = e.target.checked; }));
    form.querySelector('#cancelCall').addEventListener('click', () => { slot.innerHTML = ''; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await U.busy(form.querySelector('[type="submit"]'), () => U.send('/api/budget/calls', 'POST', {
          title: form.querySelector('#cTitle').value, periodLabel: form.querySelector('#cPeriod').value,
          dueDate: form.querySelector('#cDue').value, startDate: form.querySelector('#cStart').value, endDate: form.querySelector('#cEnd').value,
          instructions: form.querySelector('#cNote').value, departmentIds: boxes().filter(b => b.checked).map(b => b.value)
        }));
        showToast('Request sent to the departments.', 'success');
        done();
      } catch (err) { setFormMsg('callMsg', err.message || 'Could not send the request.', 'error'); }
    });
  }

  async function renderCall(el, callId) {
    const data = await fetchJSON(`/api/budget/calls/${callId}`);
    const { call, rows, canCall, canDecide, viaCoordinator } = data;
    const asked = rows.reduce((n, r) => n + (r.submission && r.submission.status !== 'draft' ? r.submission.total : 0), 0);
    el.innerHTML = `
      <div class="panel-head"><div>
        <button class="btn btn-outline btn-sm" id="backToCalls">Back to all requests</button>
        <h2>${esc(call.title)}</h2>
        <p class="sub">${esc(call.periodLabel || '')}${call.dueDate ? ` &middot; due ${esc(U.dayLabel(call.dueDate))}` : ''} &middot; ${U.statusChip('call', call.status)}</p>
      </div></div>
      <div class="stat-grid">
        ${statCard('Departments asked', call.asked)}
        ${statCard('Waiting for Finance', call.counts.submitted, { tone: call.counts.submitted ? 'gold' : '' })}
        ${statCard('Waiting for the Vice President', call.counts.recommended, { tone: call.counts.recommended ? 'gold' : '' })}
        ${statCard('Approved', U.cedi(call.approvedTotal), { raw: false, tone: 'good', foot: `${call.counts.approved} departments` })}
      </div>
      <div class="portal-card">
        <div class="table-wrap"><table class="portal-table">
          <thead><tr><th>Department</th><th>Head</th><th>Where it stands</th><th class="num">Asked</th><th class="num">Recommended</th><th class="num">Approved</th><th></th></tr></thead>
          <tbody>${rows.map(r => {
            const s = r.submission;
            const started = s && s.status !== 'draft';
            return `<tr>
              <td><strong>${esc(r.departmentName)}</strong></td>
              <td>${esc(r.headName || '')}</td>
              <td>${s ? (s.status === 'draft' ? U.chip('Being written', 'grey') : U.statusChip('budget', s.status)) : U.chip('Not started', 'grey')}</td>
              <td class="num">${started ? esc(U.cedi(s.total)) : ''}</td>
              <td class="num">${s && ['recommended', 'approved'].includes(s.status) ? esc(U.cedi(s.recommendedTotal)) : ''}</td>
              <td class="num">${s && s.status === 'approved' ? esc(U.cedi(s.approvedTotal)) : ''}</td>
              <td>${started ? `<div class="row-actions of-row-actions"><button data-view="${esc(s.id)}">${actionLabel(s, canCall, canDecide, viaCoordinator)}</button></div>` : ''}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
        <p class="tiny muted">Total asked so far: ${esc(U.cedi(asked))}.</p>
        <div class="of-actions">
          ${canCall ? `<button class="btn btn-primary" id="postBudget"${call.readyToPost ? '' : ' disabled'}>Add approved budgets to the chapter budget${call.readyToPost ? ` (${call.readyToPost})` : ''}</button>` : ''}
          ${canCall ? `<button class="btn btn-outline" id="toggleCall">${call.status === 'open' ? 'Close this request' : 'Reopen this request'}</button>` : ''}
        </div>
        ${call.budgetId ? '<p class="tiny muted">Approved amounts have been added to a draft in the Finance office\'s Budgets, ready to be activated.</p>' : ''}
        <div class="form-msg" id="deskMsg" role="alert"></div>
      </div>`;

    el.querySelector('#backToCalls').addEventListener('click', () => renderDesk(el));
    el.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
      const row = rows.find(r => r.submission && r.submission.id === b.dataset.view);
      openSubmission(row, { canCall, canDecide, viaCoordinator }, () => renderCall(el, callId));
    }));
    const post = el.querySelector('#postBudget');
    if (post) post.addEventListener('click', async () => {
      try {
        const out = await U.busy(post, () => U.send(`/api/budget/calls/${callId}/post`, 'POST'));
        showToast(`Added ${out.posted} to “${out.budgetName}”.`, 'success');
        renderCall(el, callId);
      } catch (err) { setFormMsg('deskMsg', err.message || 'Could not add them.', 'error'); }
    });
    const toggle = el.querySelector('#toggleCall');
    if (toggle) toggle.addEventListener('click', async () => {
      try { await U.busy(toggle, () => U.send(`/api/budget/calls/${callId}`, 'PUT', { status: call.status === 'open' ? 'closed' : 'open' })); renderCall(el, callId); }
      catch (err) { setFormMsg('deskMsg', err.message || 'Could not change it.', 'error'); }
    });
  }

  function actionLabel(s, canCall, canDecide, viaCoordinator) {
    if (s.status === 'submitted' && canCall) return 'Review';
    if (s.status === 'submitted' && canDecide && viaCoordinator) return 'Decide';
    if (s.status === 'recommended' && canDecide) return 'Decide';
    return 'View';
  }

  // One department's budget, with the actions this person may take on it.
  function openSubmission(row, perms, done) {
    const s = row.submission;
    const mayReview = perms.canCall && s.status === 'submitted';
    const mayDecide = perms.canDecide && (s.status === 'recommended' || (perms.viaCoordinator && s.status === 'submitted'));
    showModal(`
      <h3>${esc(row.departmentName)}</h3>
      <p class="muted">${U.statusChip('budget', s.status)} ${row.headName ? `Sent by ${esc(s.submittedByName || row.headName)} on ${esc(U.dayLabel(s.submittedAt))}.` : ''}</p>
      ${lineTable(s.lines)}
      <p class="of-total">Total asked: <strong>${esc(U.cedi(s.total))}</strong></p>
      ${s.justification ? `<p><strong>Why they need it:</strong> ${U.lines(s.justification)}</p>` : ''}
      ${s.reviewNote ? `<p><strong>Finance said:</strong> ${U.lines(s.reviewNote)}</p>` : ''}
      ${s.status === 'recommended' ? `<p>Finance recommends <strong>${esc(U.cedi(s.recommendedTotal))}</strong>.</p>` : ''}
      ${s.decisionNote ? `<p><strong>Decision:</strong> ${U.lines(s.decisionNote)}</p>` : ''}
      ${mayReview || mayDecide ? `
        <form id="subForm" novalidate>
          ${U.field({ id: 'sAmount', label: mayDecide ? 'Amount to approve (GH₵)' : 'Amount you recommend (GH₵)', type: 'number', min: 0, step: '0.01', value: mayDecide ? (s.status === 'recommended' ? s.recommendedTotal : s.total) : s.total, hint: 'You can give less than was asked, but not more. If it is less, say why below.' })}
          ${U.field({ id: 'sNote', label: 'Note to the department', type: 'textarea', rows: 3, hint: 'Needed when you give less, decline, or send it back.' })}
          <div class="of-actions">
            ${mayReview ? '<button type="button" class="btn btn-primary" data-act="recommend">Recommend</button>' : ''}
            ${mayDecide ? '<button type="button" class="btn btn-primary" data-act="approve">Approve</button>' : ''}
            ${mayDecide ? '<button type="button" class="btn btn-outline danger" data-act="decline">Decline</button>' : ''}
            <button type="button" class="btn btn-outline" data-act="return">Send back</button>
            <button type="button" class="btn btn-outline" id="cancelModalBtn">Close</button>
          </div>
          <div class="form-msg" id="subMsg" role="alert"></div>
        </form>` : '<div class="of-actions"><button type="button" class="btn btn-outline" id="cancelModalBtn">Close</button></div>'}
    `, true);
    const form = document.getElementById('subForm');
    if (!form) return;
    form.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', async () => {
      const act = btn.dataset.act;
      const amount = form.querySelector('#sAmount').value;
      const note = form.querySelector('#sNote').value;
      try {
        await U.busy(btn, () => {
          if (mayReview && (act === 'recommend' || act === 'return')) {
            return U.send(`/api/budget/submissions/${s.id}/review`, 'POST', act === 'recommend' ? { action: 'recommend', recommendedTotal: amount, note } : { action: 'return', note });
          }
          return U.send(`/api/budget/submissions/${s.id}/decide`, 'POST', act === 'approve' ? { action: 'approve', approvedTotal: amount, note } : { action: act, note });
        });
        closeModal();
        showToast('Done.', 'success');
        done();
      } catch (err) { setFormMsg('subMsg', err.message || 'Could not do that.', 'error'); }
    }));
  }

  return { renderAnswer, renderDesk };
})();
