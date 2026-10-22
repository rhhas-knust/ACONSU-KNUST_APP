/* ============================================================
   The semester outline.
   The President (and the Alumni President, for the alumni body)
   writes it in a guided form. The Chapter Coordinator approves or
   sends it back. Approval shares it with the whole executive body.
   Requires office-ui.js.
   ============================================================ */
window.OfficeOutline = (function () {
  const U = OfficeUI;
  const esc = U.esc;
  const KIND_LABELS = {
    service: 'Service', outreach: 'Outreach', training: 'Training', fellowship: 'Fellowship',
    social: 'Social', prayer: 'Prayer', other: 'Other'
  };
  const bodyLabel = (b) => (b === 'alumni' ? 'Alumni body' : 'Chapter');

  // ---- the outline as a document (read-only) ----
  function view(o) {
    const total = (o.programmes || []).reduce((n, p) => n + (Number(p.estimatedCost) || 0), 0);
    const list = (items) => (items && items.length ? `<ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : '');
    return `
      <article class="of-doc">
        <header>
          <h3>${esc(o.title)}</h3>
          <p class="muted">${esc(bodyLabel(o.body))}${o.semesterLabel ? ` &middot; ${esc(o.semesterLabel)}` : ''}${o.startDate ? ` &middot; ${esc(U.dayLabel(o.startDate))} to ${esc(U.dayLabel(o.endDate))}` : ''}</p>
        </header>
        ${o.theme ? `<p><strong>Theme:</strong> ${esc(o.theme)}${o.scripture ? ` (${esc(o.scripture)})` : ''}</p>` : ''}
        ${o.vision ? `<h4>Vision</h4><p>${U.lines(o.vision)}</p>` : ''}
        ${(o.goals || []).length ? `<h4>Goals</h4>${list(o.goals)}` : ''}
        ${(o.priorities || []).length ? `<h4>Priorities</h4>${list(o.priorities)}` : ''}
        ${(o.programmes || []).length ? `
          <h4>Programmes</h4>
          <div class="table-wrap"><table class="portal-table">
            <thead><tr><th>Date</th><th>Programme</th><th>Type</th><th>Department</th><th>Venue</th><th class="num">Estimated cost</th></tr></thead>
            <tbody>${o.programmes.map(p => `
              <tr>
                <td>${p.date ? esc(U.dayLabel(p.date)) : '<span class="muted">Date to be set</span>'}</td>
                <td><strong>${esc(p.title)}</strong>${p.notes ? `<br><span class="tiny muted">${esc(p.notes)}</span>` : ''}</td>
                <td>${esc(KIND_LABELS[p.kind] || 'Other')}</td>
                <td>${esc(p.departmentName || '')}</td>
                <td>${esc(p.venue || '')}</td>
                <td class="num">${p.estimatedCost ? esc(U.cedi(p.estimatedCost)) : ''}</td>
              </tr>`).join('')}
              <tr><td colspan="5"><strong>Estimated cost of all programmes</strong></td><td class="num"><strong>${esc(U.cedi(total))}</strong></td></tr>
            </tbody>
          </table></div>` : ''}
        ${(o.departmentFocus || []).length ? `
          <h4>What each department will focus on</h4>
          <dl class="of-dl">${o.departmentFocus.map(d => `<dt>${esc(d.departmentName)}</dt><dd>${U.lines(d.focus)}</dd>`).join('')}</dl>` : ''}
        ${o.needs ? `<h4>What the executive needs</h4><p>${U.lines(o.needs)}</p>` : ''}
        ${o.risks ? `<h4>What could get in the way</h4><p>${U.lines(o.risks)}</p>` : ''}
      </article>`;
  }

  // ---- the writer's side ----
  function suggestedTitle(academicYear) {
    const month = new Date().getMonth() + 1;
    return `${academicYear} ${month >= 8 || month === 1 ? 'first' : 'second'} semester`;
  }

  // What the Coordinator will look for, checked as the form is filled in.
  function gaps(o) {
    const out = [];
    if (!o.semesterLabel) out.push('Say which semester it is for');
    if (!o.startDate || !o.endDate) out.push('Give the start and end dates');
    if (!o.theme && !o.vision) out.push('Add a theme or a vision');
    if (!(o.goals || []).length) out.push('Add at least one goal');
    if (!(o.programmes || []).length) out.push('Add at least one programme');
    (o.programmes || []).forEach(p => {
      if (p.date && o.startDate && o.endDate && (p.date < o.startDate || p.date > o.endDate)) out.push(`"${p.title}" is dated outside the semester`);
    });
    return out;
  }

  async function renderEditor(el) {
    const data = await fetchJSON('/api/executive/outline');
    const items = data.items || [];
    const alumni = data.body === 'alumni';
    const heading = alumni ? 'Alumni semester plan' : 'Semester outline';
    const open = items.find(i => ['draft', 'returned', 'submitted'].includes(i.status));
    const approved = items.filter(i => i.status === 'approved');
    const departments = data.departments || [];

    const head = (sub) => `
      <div class="panel-head"><div>
        <h2>${heading}</h2>
        <p class="sub">${sub}</p>
      </div></div>`;
    const pastList = approved.length ? `
      <div class="portal-card">
        <h3>Approved outlines</h3>
        ${approved.map(o => `<details class="of-past"><summary>${esc(o.title)} <span class="muted">approved ${esc(U.dayLabel(o.sharedAt))}</span></summary>${view(o)}</details>`).join('')}
      </div>` : '';

    // Nothing in progress: start one.
    if (!open) {
      const last = approved[0];
      el.innerHTML = `${head(alumni
        ? 'Write the alumni body\'s plan for the semester. The Chapter Coordinator approves it, and once approved it is shared with the executive body.'
        : 'Write the plan for the semester. The Chapter Coordinator approves it, and once approved it is shared with every executive.')}
        ${U.steps(['Write it', 'Chapter Coordinator approves', 'Shared with the executive body'], 0)}
        <div class="portal-card">
          <form id="startOutline">
            ${U.field({ id: 'oTitle', label: 'What is this outline called?', value: suggestedTitle(data.academicYear), required: true, hint: 'For example: 2026/2027 first semester.' })}
            ${U.field({ id: 'oLabel', label: 'Which semester is it for?', value: suggestedTitle(data.academicYear), hint: 'Shown beside the dates.' })}
            <div class="of-actions">
              <button class="btn btn-primary" type="submit">Start the outline</button>
              ${last ? '<button class="btn btn-outline" type="button" id="startFromLast">Start from the last approved one</button>' : ''}
            </div>
            <div class="form-msg" id="startMsg" role="alert"></div>
          </form>
        </div>${pastList}`;
      const create = async (extra) => {
        await U.send('/api/executive/outline', 'POST', {
          title: document.getElementById('oTitle').value, semesterLabel: document.getElementById('oLabel').value, ...(extra || {})
        });
        showToast('Outline started.', 'success');
        renderEditor(el);
      };
      el.querySelector('#startOutline').addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await create(); } catch (err) { setFormMsg('startMsg', err.message || 'Could not start the outline.', 'error'); }
      });
      const copy = el.querySelector('#startFromLast');
      if (copy) copy.addEventListener('click', async () => {
        try {
          await create({ vision: last.vision, goals: last.goals, priorities: last.priorities, departmentFocus: last.departmentFocus, needs: last.needs, risks: last.risks });
        } catch (err) { setFormMsg('startMsg', err.message || 'Could not start the outline.', 'error'); }
      });
      return;
    }

    // With the Coordinator: look, don't touch.
    if (open.status === 'submitted') {
      el.innerHTML = `${head('It is with the Chapter Coordinator. You will see here whether it is approved or sent back.')}
        ${U.steps(['Write it', 'Chapter Coordinator approves', 'Shared with the executive body'], 1)}
        <div class="portal-card">
          ${U.notice(`<strong>Waiting for the Chapter Coordinator.</strong> Sent ${esc(U.dayLabel(open.submittedAt))}${open.submittedBy ? ` by ${esc(open.submittedBy)}` : ''}. If you need to change something first, take it back.`)}
          <div class="of-actions"><button class="btn btn-outline" id="withdrawOutline">Take it back to keep editing</button></div>
          <div class="form-msg" id="withdrawMsg" role="alert"></div>
        </div>
        <div class="portal-card">${view(open)}</div>${pastList}`;
      el.querySelector('#withdrawOutline').addEventListener('click', async (e) => {
        try { await U.busy(e.currentTarget, () => U.send(`/api/executive/outline/${open.id}/withdraw`, 'POST')); renderEditor(el); }
        catch (err) { setFormMsg('withdrawMsg', err.message || 'Could not take it back.', 'error'); }
      });
      return;
    }

    // Draft or sent back: the form.
    const o = open;
    const deptOptions = [['', 'Whole chapter'], ...departments.map(d => [d.id, d.name])];
    const focusOptions = [['', 'Choose a department'], ...departments.map(d => [d.id, d.name])];
    const kindOptions = Object.entries(KIND_LABELS);

    const rowFns = {
      oGoals: (v) => U.cell('Goal', 'v', v, { wide: true, placeholder: 'For example: Double the Sunday attendance' }),
      oPriorities: (v) => U.cell('Priority', 'v', v, { wide: true, placeholder: 'What comes first if time runs short' }),
      oProgrammes: (p) => [
        U.cell('Date', 'date', p.date, { type: 'date' }),
        U.cell('Programme', 'title', p.title, { wide: true, placeholder: 'For example: Choir concert' }),
        U.cell('Type', 'kind', p.kind || 'other', { type: 'select', options: kindOptions }),
        U.cell('Run by', 'departmentId', p.departmentId, { type: 'select', options: deptOptions }),
        U.cell('Venue', 'venue', p.venue),
        U.cell('Estimated cost (GH₵)', 'estimatedCost', p.estimatedCost || '', { type: 'number', min: 0, step: '0.01' }),
        U.cell('Notes', 'notes', p.notes, { wide: true })
      ].join(''),
      oFocus: (f) => U.cell('Department', 'departmentId', f.departmentId, { type: 'select', options: focusOptions })
        + U.cell('Where it will put its effort this semester', 'focus', f.focus, { type: 'textarea', wide: true })
    };
    const blanks = { oGoals: '', oPriorities: '', oProgrammes: { kind: 'other' }, oFocus: {} };

    el.innerHTML = `${head(alumni
      ? 'Fill this in section by section. Save as often as you like; nothing goes to the Chapter Coordinator until you send it.'
      : 'Fill this in section by section. Save as often as you like; nothing goes to the Chapter Coordinator until you send it.')}
      ${U.steps(['Write it', 'Chapter Coordinator approves', 'Shared with the executive body'], 0)}
      ${o.status === 'returned' ? U.notice(`<strong>The Chapter Coordinator sent this back.</strong><br>${U.lines(o.returnNote)}`, 'warn') : ''}
      <form id="outlineForm" novalidate>
        <div class="portal-card">
          ${U.section(1, 'The semester', 'Which semester this plan covers.', `
            ${U.field({ id: 'oTitle', label: 'Title', value: o.title, required: true })}
            <div class="field-row">
              ${U.field({ id: 'oLabel', label: 'Which semester', value: o.semesterLabel, hint: 'For example: 2026/2027 first semester.' })}
              ${U.field({ id: 'oStart', label: 'Starts', type: 'date', value: o.startDate })}
              ${U.field({ id: 'oEnd', label: 'Ends', type: 'date', value: o.endDate })}
            </div>`)}
          ${U.section(2, 'Theme and vision', 'What the executive is aiming at, in a few sentences.', `
            <div class="field-row">
              ${U.field({ id: 'oTheme', label: 'Theme', value: o.theme })}
              ${U.field({ id: 'oScripture', label: 'Scripture for the theme', value: o.scripture, placeholder: 'For example: Colossians 2:7' })}
            </div>
            ${U.field({ id: 'oVision', label: 'Vision for the semester', type: 'textarea', rows: 4, value: o.vision })}`)}
          ${U.section(3, 'Goals and priorities', 'What you want to have done by the end of the semester, and what comes first.', `
            <h4>Goals</h4>${U.repeater('oGoals', o.goals || [], rowFns.oGoals, { addLabel: 'Add a goal', blank: '' })}
            <h4>Priorities</h4>${U.repeater('oPriorities', o.priorities || [], rowFns.oPriorities, { addLabel: 'Add a priority' })}`)}
          ${U.section(4, 'Programmes', 'Everything planned for the semester: services, outreaches, trainings, socials. Keep the dates inside the semester.', `
            ${U.repeater('oProgrammes', o.programmes || [], rowFns.oProgrammes, { addLabel: 'Add a programme', blank: { kind: 'other' } })}
            <p class="of-total" id="oTotal" aria-live="polite"></p>`)}
          ${U.section(5, 'Departments', 'Optional. Say what each department will concentrate on.', `
            ${U.repeater('oFocus', o.departmentFocus || [], rowFns.oFocus, { addLabel: 'Add a department' })}`)}
          ${U.section(6, 'What you need', 'What you are asking the Chapter Coordinator and the members for, and what could get in the way.', `
            ${U.field({ id: 'oNeeds', label: 'What the executive needs', type: 'textarea', rows: 3, value: o.needs })}
            ${U.field({ id: 'oRisks', label: 'What could get in the way', type: 'textarea', rows: 3, value: o.risks })}`)}
        </div>
        <div class="portal-card">
          <h3>Before you send it</h3>
          <ul class="of-check" id="oChecklist" aria-live="polite"></ul>
          <div class="of-actions">
            <button class="btn btn-outline" type="button" id="saveOutline">Save draft</button>
            <button class="btn btn-primary" type="submit" id="sendOutline">Send to the Chapter Coordinator</button>
            <button class="btn btn-outline danger" type="button" id="deleteOutline">Delete this draft</button>
          </div>
          <div class="form-msg" id="outlineMsg" role="alert"></div>
        </div>
      </form>${pastList}`;

    const form = el.querySelector('#outlineForm');
    U.wireRepeaters(form, (id, row) => rowFns[id](row), (id) => blanks[id]);

    const read = () => {
      const val = (id) => form.querySelector(`#${id}`).value;
      return {
        title: val('oTitle'), semesterLabel: val('oLabel'), startDate: val('oStart'), endDate: val('oEnd'),
        theme: val('oTheme'), scripture: val('oScripture'), vision: val('oVision'),
        goals: U.collectRows(form, 'oGoals').map(r => r.v).filter(Boolean),
        priorities: U.collectRows(form, 'oPriorities').map(r => r.v).filter(Boolean),
        programmes: U.collectRows(form, 'oProgrammes').map(r => ({ ...r, estimatedCost: r.estimatedCost === '' ? 0 : Number(r.estimatedCost) })),
        departmentFocus: U.collectRows(form, 'oFocus'),
        needs: val('oNeeds'), risks: val('oRisks')
      };
    };

    const refresh = () => {
      const now = read();
      const live = { ...now, programmes: now.programmes.filter(p => p.title) };
      const total = live.programmes.reduce((n, p) => n + (p.estimatedCost || 0), 0);
      form.querySelector('#oTotal').innerHTML = live.programmes.length ? `Estimated cost of all programmes: <strong>${esc(U.cedi(total))}</strong>` : '';
      const missing = gaps(live);
      form.querySelector('#oChecklist').innerHTML = missing.length
        ? missing.map(m => `<li><span class="of-todo">Still needed</span> ${esc(m)}</li>`).join('')
        : '<li><span class="of-done">Ready</span> Everything the Chapter Coordinator looks for is here.</li>';
    };
    form.addEventListener('input', refresh);
    form.addEventListener('change', refresh);
    refresh();

    const save = async () => { await U.send(`/api/executive/outline/${o.id}`, 'PUT', read()); };
    form.querySelector('#saveOutline').addEventListener('click', async (e) => {
      try { await U.busy(e.currentTarget, save); setFormMsg('outlineMsg', 'Saved.', 'success'); showToast('Draft saved.', 'success'); }
      catch (err) { setFormMsg('outlineMsg', err.message || 'Could not save.', 'error'); }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!confirm('Send this outline to the Chapter Coordinator? You will not be able to change it unless you take it back.')) return;
      try {
        await U.busy(form.querySelector('#sendOutline'), async () => {
          await save();
          await U.send(`/api/executive/outline/${o.id}/submit`, 'POST');
        });
        showToast('Sent to the Chapter Coordinator.', 'success');
        renderEditor(el);
      } catch (err) { setFormMsg('outlineMsg', err.message || 'Could not send it.', 'error'); }
    });
    form.querySelector('#deleteOutline').addEventListener('click', async () => {
      if (!confirm('Delete this draft? This cannot be undone.')) return;
      try { await U.send(`/api/executive/outline/${o.id}`, 'DELETE'); renderEditor(el); }
      catch (err) { setFormMsg('outlineMsg', err.message || 'Could not delete it.', 'error'); }
    });
  }

  // ---- what everyone reads ----
  async function renderShared(el) {
    const data = await fetchJSON('/api/executive/outline/shared');
    const items = data.items || [];
    el.innerHTML = `
      <div class="panel-head"><div>
        <h2>Semester outline</h2>
        <p class="sub">The plan for the semester, once the Chapter Coordinator has approved it. Everything the executive does this semester starts here.</p>
      </div></div>
      ${items.length ? items.map((o, i) => `
        <div class="portal-card">
          <p class="muted">${esc(bodyLabel(o.body))} plan &middot; approved ${esc(U.dayLabel(o.sharedAt))}${o.reviewedBy ? ` by ${esc(o.reviewedBy)}` : ''}</p>
          ${i === 0 ? view(o) : `<details class="of-past"><summary>${esc(o.title)}</summary>${view(o)}</details>`}
        </div>`).join('')
        : '<div class="portal-card"><p class="empty-state">No outline has been approved yet. It will appear here as soon as the Chapter Coordinator approves it.</p></div>'}`;
  }

  // ---- the Coordinator's side ----
  async function renderReview(el) {
    const data = await fetchJSON('/api/coordinator/outlines');
    const items = data.items || [];
    const waiting = items.filter(i => i.status === 'submitted');
    const returned = items.filter(i => i.status === 'returned');
    const approved = items.filter(i => i.status === 'approved');
    el.innerHTML = `
      <div class="panel-head"><div>
        <h2>Semester outlines</h2>
        <p class="sub">The President and the Alumni President send their plans here. Approving one shares it with the whole executive body. Sending it back tells them what to change.</p>
      </div></div>
      <div class="portal-card">
        <h3>Waiting for you${waiting.length ? ` (${waiting.length})` : ''}</h3>
        ${waiting.length ? waiting.map(o => `
          <div class="of-review">
            ${view(o)}
            <p class="tiny muted">Sent ${esc(U.dayLabel(o.submittedAt))}${o.submittedBy ? ` by ${esc(o.submittedBy)}` : ''}.</p>
            <div class="of-actions">
              <button class="btn btn-primary" data-approve="${esc(o.id)}">Approve and share</button>
              <button class="btn btn-outline" data-return="${esc(o.id)}">Send back</button>
            </div>
          </div>`).join('') : '<p class="empty-state">Nothing is waiting for you.</p>'}
        <div class="form-msg" id="reviewMsg" role="alert"></div>
      </div>
      ${returned.length ? `<div class="portal-card"><h3>Sent back, being fixed</h3>${returned.map(o => `<p><strong>${esc(o.title)}</strong> (${esc(bodyLabel(o.body))}). <span class="muted">${esc(o.returnNote)}</span></p>`).join('')}</div>` : ''}
      ${approved.length ? `<div class="portal-card"><h3>Approved</h3>${approved.map(o => `<details class="of-past"><summary>${esc(o.title)} <span class="muted">${esc(bodyLabel(o.body))}, approved ${esc(U.dayLabel(o.sharedAt))}</span></summary>${view(o)}</details>`).join('')}</div>` : ''}`;

    el.querySelectorAll('[data-approve]').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Approve this outline and share it with the whole executive body?')) return;
      try { await U.busy(btn, () => U.send(`/api/coordinator/outlines/${btn.dataset.approve}/approve`, 'POST')); showToast('Approved and shared.', 'success'); renderReview(el); }
      catch (err) { setFormMsg('reviewMsg', err.message || 'Could not approve it.', 'error'); }
    }));
    el.querySelectorAll('[data-return]').forEach(btn => btn.addEventListener('click', () => {
      showModal(`
        <h3>Send this outline back</h3>
        <form id="returnForm">
          ${U.field({ id: 'rNote', label: 'What needs changing?', type: 'textarea', rows: 4, required: true, hint: 'They will see this exactly as you write it.' })}
          <div class="of-actions">
            <button class="btn btn-primary" type="submit">Send it back</button>
            <button class="btn btn-outline" type="button" id="cancelModalBtn">Cancel</button>
          </div>
          <div class="form-msg" id="returnMsg" role="alert"></div>
        </form>`);
      document.getElementById('returnForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await U.send(`/api/coordinator/outlines/${btn.dataset.return}/return`, 'POST', { note: document.getElementById('rNote').value });
          closeModal(); showToast('Sent back.', 'success'); renderReview(el);
        } catch (err) { setFormMsg('returnMsg', err.message || 'Could not send it back.', 'error'); }
      });
    }));
  }

  return { renderEditor, renderShared, renderReview, view };
})();
