/* ============================================================
   The smaller desks:
     - Committees and task forces (Vice President)
     - Follow-up on what the executive resolved (Vice President, President, secretaries)
     - The alumni desk (Alumni President)
     - Key offices: who holds each office, renewing, and handing over (Chapter Coordinator)
   Requires office-ui.js.
   ============================================================ */
window.OfficeBodies = (function () {
  const U = OfficeUI;
  const esc = U.esc;

  // ================= committees and task forces =================
  async function renderCommittees(el) {
    const data = await fetchJSON('/api/executive/committees');
    const items = data.items || [];
    el.innerHTML = `
      <div class="panel-head"><div>
        <h2>Committees and task forces</h2>
        <p class="sub">Set up a committee or a task force for a job, name who chairs it and who is on it, and note how it is going. A task force is for one job with a date; a committee carries on.</p>
      </div><div class="panel-actions"><button class="btn btn-primary btn-sm" id="newCommittee">Set one up</button></div></div>
      ${items.length ? items.map(c => `
        <section class="portal-card">
          <div class="of-card-head"><div>
            <h3>${esc(c.name)}</h3>
            <p class="muted">${c.kind === 'task_force' ? 'Task force' : 'Committee'}${c.chairName ? ` &middot; chaired by ${esc(c.chairName)}` : ''}${c.dueDate ? ` &middot; due ${esc(U.dayLabel(c.dueDate))}` : ''}</p>
          </div><div>${U.chip(c.status === 'done' ? 'Finished' : 'Active', c.status === 'done' ? 'grey' : 'green')}</div></div>
          ${c.mandate ? `<p>${U.lines(c.mandate)}</p>` : ''}
          ${(c.memberNames || []).length ? `<p><strong>Members:</strong> ${c.memberNames.map(esc).join(', ')}</p>` : ''}
          ${c.progressNote ? `<p><strong>How it is going:</strong> ${U.lines(c.progressNote)}</p>` : ''}
          <div class="of-actions">
            <button class="btn btn-outline btn-sm" data-edit="${esc(c.id)}">Change</button>
            <button class="btn btn-outline btn-sm danger" data-del="${esc(c.id)}">Remove</button>
          </div>
        </section>`).join('') : '<div class="portal-card"><p class="empty-state">No committees or task forces yet.</p></div>'}`;

    const form = (c) => {
      showModal(`
        <h3>${c ? 'Change' : 'Set up'} a committee or task force</h3>
        <form id="cmForm" novalidate>
          ${U.field({ id: 'cmName', label: 'Name', value: c ? c.name : '', required: true, placeholder: 'For example: Retreat task force' })}
          ${U.field({ id: 'cmKind', label: 'What kind', type: 'select', value: c ? c.kind : 'committee', options: [['committee', 'Committee, carries on'], ['task_force', 'Task force, one job']] })}
          ${U.field({ id: 'cmMandate', label: 'What it is for', type: 'textarea', rows: 3, value: c ? c.mandate : '' })}
          <div class="field-row">
            ${U.field({ id: 'cmChair', label: 'Chaired by', value: c ? c.chairName : '', list: data.executives })}
            ${U.field({ id: 'cmStatus', label: 'Where it stands', type: 'select', value: c ? c.status : 'active', options: [['active', 'Active'], ['done', 'Finished']] })}
          </div>
          ${U.field({ id: 'cmMembers', label: 'Who is on it', type: 'textarea', rows: 3, value: c ? (c.memberNames || []).join('\n') : '', hint: 'One name on each line.' })}
          <div class="field-row">
            ${U.field({ id: 'cmStart', label: 'Starts', type: 'date', value: c ? c.startDate : '' })}
            ${U.field({ id: 'cmDue', label: 'Due', type: 'date', value: c ? c.dueDate : '' })}
          </div>
          ${U.field({ id: 'cmProgress', label: 'How it is going', type: 'textarea', rows: 3, value: c ? c.progressNote : '' })}
          <div class="of-actions">
            <button class="btn btn-primary" type="submit">Save</button>
            <button class="btn btn-outline" type="button" id="cancelModalBtn">Cancel</button>
          </div>
          <div class="form-msg" id="cmMsg" role="alert"></div>
        </form>`, true);
      document.getElementById('cmForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = (id) => document.getElementById(id).value;
        const body = {
          name: v('cmName'), kind: v('cmKind'), mandate: v('cmMandate'), chairName: v('cmChair'), status: v('cmStatus'),
          memberNames: v('cmMembers'), startDate: v('cmStart'), dueDate: v('cmDue'), progressNote: v('cmProgress')
        };
        try {
          await U.send(c ? `/api/executive/committees/${c.id}` : '/api/executive/committees', c ? 'PUT' : 'POST', body);
          closeModal(); showToast('Saved.', 'success'); renderCommittees(el);
        } catch (err) { setFormMsg('cmMsg', err.message || 'Could not save.', 'error'); }
      });
    };
    el.querySelector('#newCommittee').addEventListener('click', () => form(null));
    el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => form(items.find(c => c.id === b.dataset.edit))));
    el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Remove this committee? This cannot be undone.')) return;
      try { await U.send(`/api/executive/committees/${b.dataset.del}`, 'DELETE'); renderCommittees(el); }
      catch (err) { showToast(err.message || 'Could not remove it.', 'error'); }
    }));
  }

  // ================= follow-up =================
  async function renderFollowUp(el) {
    const data = await fetchJSON('/api/executive/followups');
    const actions = data.actions || [];
    el.innerHTML = `
      <div class="panel-head"><div>
        <h2>Follow-up</h2>
        <p class="sub">The jobs the executive gave itself in its meetings, and who has them. Tick one off when it is done. Anything past its date is marked.</p>
      </div></div>
      <div class="stat-grid">
        ${statCard('Still to do', data.open, { tone: data.open ? 'gold' : 'good' })}
        ${statCard('Past their date', data.overdue, { tone: data.overdue ? 'bad' : 'good' })}
      </div>
      <div class="portal-card">
        ${actions.length ? `<div class="table-wrap"><table class="portal-table">
          <thead><tr><th>Done</th><th>What</th><th>Who</th><th>By when</th><th>From</th></tr></thead>
          <tbody>${actions.map(a => `
            <tr>
              <td><label class="of-check-line"><input type="checkbox" data-done="${esc(a.minuteId)}|${esc(a.actionId)}"${a.done ? ' checked' : ''} aria-label="Mark done: ${esc(a.task)}"></label></td>
              <td>${a.done ? `<s>${esc(a.task)}</s>` : esc(a.task)}</td>
              <td>${esc(a.owner || '')}</td>
              <td>${a.dueDate ? esc(U.dayLabel(a.dueDate)) : ''}${a.overdue ? ` ${U.chip('Past its date', 'red')}` : ''}</td>
              <td class="tiny muted">${esc(a.minuteTitle)}<br>${esc(U.dayLabel(a.minuteDate))}</td>
            </tr>`).join('')}</tbody>
        </table></div>` : '<p class="empty-state">No jobs have been recorded in the shared minutes yet.</p>'}
      </div>
      ${(data.committees || []).length ? `<div class="portal-card"><h3>Committees and task forces still working</h3>
        ${data.committees.map(c => `<p><strong>${esc(c.name)}</strong> <span class="muted">${c.kind === 'task_force' ? 'task force' : 'committee'}${c.chairName ? `, chaired by ${esc(c.chairName)}` : ''}${c.dueDate ? `, due ${esc(U.dayLabel(c.dueDate))}` : ''}</span>${c.overdue ? ` ${U.chip('Past its date', 'red')}` : ''}</p>`).join('')}</div>` : ''}`;
    el.querySelectorAll('[data-done]').forEach(box => box.addEventListener('change', async () => {
      const [minuteId, actionId] = box.dataset.done.split('|');
      try { await U.send(`/api/executive/followups/${minuteId}/${actionId}`, 'PATCH', { done: box.checked }); renderFollowUp(el); }
      catch (err) { box.checked = !box.checked; showToast(err.message || 'Could not update it.', 'error'); }
    }));
  }

  // ================= the alumni desk =================
  async function renderAlumni(el) {
    const data = await fetchJSON('/api/executive/alumni');
    const items = data.items || [];
    el.innerHTML = `
      <div class="panel-head"><div>
        <h2>The alumni</h2>
        <p class="sub">The alumni of this chapter. You see a name for everyone. You see more only where an alumnus has chosen to list themselves in Alumni Connect, and a phone number or email only where they ticked that too.</p>
      </div></div>
      <div class="stat-grid">
        ${statCard('Alumni in the chapter', data.count)}
        ${statCard('Listed in Alumni Connect', data.listed, { foot: 'chose to share more' })}
        ${statCard('Open to mentoring', data.mentors, { tone: data.mentors ? 'good' : '' })}
      </div>
      <div class="portal-card">
        ${items.length ? `<div class="table-wrap"><table class="portal-table">
          <thead><tr><th>Name</th><th>Class of</th><th>Work</th><th>Where</th><th>Reach them</th></tr></thead>
          <tbody>${items.map(a => `
            <tr>
              <td><strong>${esc(a.name)}</strong>${a.openToMentoring ? `<br>${U.chip('Open to mentoring', 'green')}` : ''}</td>
              <td>${esc(a.graduationYear || '')}</td>
              <td>${esc([a.profession, a.organisation].filter(Boolean).join(', '))}</td>
              <td>${esc([a.city, a.country].filter(Boolean).join(', '))}</td>
              <td>${a.email ? `<a href="mailto:${esc(a.email)}">${esc(a.email)}</a>` : ''}${a.email && a.phone ? '<br>' : ''}${a.phone ? esc(a.phone) : ''}${!a.email && !a.phone ? '<span class="muted">Not shared</span>' : ''}</td>
            </tr>`).join('')}</tbody>
        </table></div>` : '<p class="empty-state">No member of this chapter has been marked as an alumnus yet. Shepherding marks a member as alumni when they finish their studies.</p>'}
      </div>`;
  }

  // ================= key offices (Chapter Coordinator) =================
  // The office login, shown once to be passed on (president.knust / president123).
  function issuedHtml(title, issued) {
    return `
      <h3>${esc(title)}</h3>
      <p>Give them these. They sign in on the Executive Portal with them once, and must then choose their own password before anything else opens.</p>
      <dl class="of-dl"><dt>Username</dt><dd><code>${esc(issued.username)}</code></dd><dt>Starting password</dt><dd><code>${esc(issued.password)}</code></dd></dl>
      <p class="tiny muted">The starting password stops working after 14 days if it is not used. You can put it back from here with Reset password.</p>
      <div class="of-actions"><button class="btn btn-primary" id="hoDone">Done</button></div>`;
  }

  async function renderKeyOffices(el) {
    const data = await fetchJSON('/api/coordinator/offices');
    const items = data.items || [];
    const officers = items.filter(o => o.kind === 'officer');
    const heads = items.filter(o => o.kind !== 'officer');
    const row = (o) => {
      const h = o.holder;
      return `<tr>
        <td><strong>${esc(o.label)}</strong>${o.departmentName ? `<br><span class="tiny muted">${esc(o.departmentName)}</span>` : ''}</td>
        <td>${h && h.name ? esc(h.name) : '<span class="muted">Nobody</span>'}${h && h.username ? `<br><span class="tiny muted">${esc(h.username)}</span>` : ''}${h && h.awaitingFirstSignIn ? `<br>${U.chip(h.startingPasswordExpired ? 'Starting password expired' : 'Has not chosen a password yet', h.startingPasswordExpired ? 'red' : 'amber')}` : ''}</td>
        <td>${U.statusChip('seat', o.status)}<br><span class="tiny muted">${h && h.termYear ? esc(h.termYear) : ''}${h && h.daysLeft !== null && h.daysLeft > 0 && o.status !== 'ended' ? `, ${h.daysLeft} days left` : ''}</span></td>
        <td class="tiny muted">${(o.before || []).length ? `Before: ${o.before.map(b => esc(b.name)).join(', ')}` : ''}</td>
        <td><div class="row-actions of-row-actions">
          ${h && h.staffId && o.status !== 'vacant' ? `<button data-renew="${esc(h.staffId)}">Renew</button>` : ''}
          ${h && h.staffId && o.status !== 'vacant' && o.status !== 'ended' ? `<button data-reset="${esc(h.staffId)}" data-name="${esc(h.name)}">Reset password</button>` : ''}
          <button data-handover="${esc(o.key)}|${esc(o.cardId)}">${o.status === 'vacant' ? 'Appoint' : 'Hand over'}</button>
        </div></td>
      </tr>`;
    };
    const table = (rows) => `<div class="table-wrap"><table class="portal-table">
      <thead><tr><th>Office</th><th>Held by</th><th>Term</th><th>History</th><th></th></tr></thead>
      <tbody>${rows.map(row).join('')}</tbody></table></div>`;

    el.innerHTML = `
      <div class="panel-head"><div>
        <h2>Key offices</h2>
        <p class="sub">Who holds each office this year (${esc(data.academicYear)}). Everyone who holds an office is a member of this chapter first. When a year ends, <strong>renew</strong> the same person, or <strong>hand over</strong> to the next: the old login stops at once and the new holder gets one of their own, with all the office's drafts and records waiting for them.</p>
      </div></div>
      ${data.needsAttention ? U.notice(`<strong>${data.needsAttention} office${data.needsAttention === 1 ? ' needs' : 's need'} your attention.</strong> They are empty, ended, or about to end.`, 'warn') : U.notice('Every key office is filled and in term.', 'good')}
      <div class="portal-card"><h3>Officers of the chapter</h3>${table(officers)}<div class="form-msg" id="officesMsg" role="alert"></div></div>
      ${heads.length ? `<div class="portal-card"><h3>Department heads</h3>${table(heads)}</div>` : ''}`;

    el.querySelectorAll('[data-renew]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Renew this person for the new academic year?')) return;
      try { await U.busy(b, () => U.send(`/api/admin/staff/${b.dataset.renew}`, 'PUT', { renewTerm: true })); showToast('Renewed for the year.', 'success'); renderKeyOffices(el); }
      catch (err) { setFormMsg('officesMsg', err.message || 'Could not renew.', 'error'); }
    }));
    el.querySelectorAll('[data-reset]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm(`Put ${b.dataset.name || 'their'} password back to the office's starting password? They will have to choose a new one when they next sign in, and every device they are signed in on is signed out.`)) return;
      try {
        const out = await U.busy(b, () => U.send('/api/coordinator/offices/reset-password', 'POST', { staffId: b.dataset.reset }));
        showModal(issuedHtml(`New starting password for ${b.dataset.name || 'this office'}`, out.issued));
        document.getElementById('hoDone').addEventListener('click', () => { closeModal(); renderKeyOffices(el); });
      } catch (err) { setFormMsg('officesMsg', err.message || 'Could not reset it.', 'error'); }
    }));
    el.querySelectorAll('[data-handover]').forEach(b => b.addEventListener('click', () => {
      const [key, cardId] = b.dataset.handover.split('|');
      openHandover(items.find(o => o.key === key && (o.cardId || '') === cardId), data.departments || [], () => renderKeyOffices(el));
    }));
  }

  async function openHandover(office, departments, done) {
    let members = [];
    try { members = await fetchJSON('/api/admin/members'); } catch (e) { members = []; }
    const wantsAlumnus = office.mustBeAlumnus;
    const pool = members.filter(m => wantsAlumnus ? m.membershipStage === 'alumni' : true);
    const vacant = office.status === 'vacant';
    showModal(`
      <h3>${vacant ? 'Appoint' : 'Hand over'}: ${esc(office.label)}</h3>
      ${!vacant && office.holder ? `<p>${esc(office.holder.name)} stops being ${esc(office.label)} the moment you do this, and their login stops working.</p>` : ''}
      ${wantsAlumnus ? '<p class="tiny muted">The Alumni President is elected by the alumni, so only members marked as alumni are listed.</p>' : ''}
      <form id="hoForm" novalidate>
        ${U.field({ id: 'hoFind', label: 'Find the member taking over', placeholder: 'Start typing a name' })}
        <div class="field"><label for="hoMember">Member</label><select id="hoMember" size="6" required></select></div>
        <p class="tiny muted">They get the office's own login: its username and a starting password are shown when you finish, to pass on. They must choose their own password the first time they sign in.</p>
        ${office.requiresDepartment && !office.department ? U.field({ id: 'hoDept', label: 'Which department', type: 'select', required: true, options: [['', 'Choose a department'], ...departments.map(d => [d.id, d.name])] }) : ''}
        <div class="of-actions">
          <button class="btn btn-primary" type="submit">${vacant ? 'Appoint' : 'Hand over'}</button>
          <button class="btn btn-outline" type="button" id="cancelModalBtn">Cancel</button>
        </div>
        <div class="form-msg" id="hoMsg" role="alert"></div>
      </form>`);
    const form = document.getElementById('hoForm');
    const select = form.querySelector('#hoMember');
    const fill = () => {
      const q = form.querySelector('#hoFind').value.trim().toLowerCase();
      const shown = pool.filter(m => !q || String(m.name || '').toLowerCase().includes(q)).slice(0, 50);
      select.innerHTML = shown.length ? shown.map(m => `<option value="${esc(m.id)}">${esc(m.name || m.email)}${m.programme ? ` (${esc(m.programme)})` : ''}</option>`).join('')
        : '<option value="" disabled>No member matches</option>';
    };
    fill();
    form.querySelector('#hoFind').addEventListener('input', fill);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const memberId = select.value;
      if (!memberId) return setFormMsg('hoMsg', 'Choose the member taking over.', 'error');
      const deptField = form.querySelector('#hoDept');
      try {
        const out = await U.busy(form.querySelector('[type="submit"]'), () => U.send('/api/coordinator/offices/handover', 'POST', {
          positionKey: office.key, cardId: office.cardId || undefined, memberId,
          ...(deptField ? { department: deptField.value } : {})
        }));
        document.getElementById('modalContent').innerHTML = issuedHtml(`${office.label} is now ${out.item.name}`, out.issued);
        document.getElementById('hoDone').addEventListener('click', () => { closeModal(); done(); });
      } catch (err) { setFormMsg('hoMsg', err.message || 'Could not do that.', 'error'); }
    });
  }

  return { renderCommittees, renderFollowUp, renderAlumni, renderKeyOffices };
})();
