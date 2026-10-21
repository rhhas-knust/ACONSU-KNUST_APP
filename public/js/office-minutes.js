/* ============================================================
   Minutes of the executive meetings.
   The General Secretary and the Assistant keep them together. One
   writes, using a form that follows the usual order of a meeting;
   the other reads, comments and signs; when both have signed, the
   minutes become the record and every executive can read them.
   Requires office-ui.js.
   ============================================================ */
window.OfficeMinutes = (function () {
  const U = OfficeUI;
  const esc = U.esc;
  const SEAT_LABEL = { general_secretary: 'General Secretary', assistant_general_secretary: 'Assistant General Secretary' };

  // The agenda most executive meetings follow. Offered as a starting point, not imposed.
  const USUAL_ORDER = [
    'Opening prayer and roll call', 'Reading and adopting the last meeting\'s minutes', 'Matters arising',
    'Reports from the officers and department heads', 'New business', 'Any other business', 'Date of the next meeting'
  ];

  const hhmm = (v) => v || '';

  // ---- the minutes as a document ----
  function doc(m) {
    const present = (m.presentNames || []);
    return `
      <article class="of-doc">
        <header>
          <h3>${esc(m.title || 'Executive meeting')}</h3>
          <p class="muted">${esc(U.dayLabel(m.date))}${m.startTime ? `, ${esc(m.startTime)}${m.endTime ? ` to ${esc(m.endTime)}` : ''}` : ''}${m.venue ? ` &middot; ${esc(m.venue)}` : ''}${m.chair ? ` &middot; chaired by ${esc(m.chair)}` : ''}</p>
        </header>
        ${present.length ? `<p><strong>Present:</strong> ${present.map(esc).join(', ')}</p>` : ''}
        ${m.apologies ? `<p><strong>Apologies:</strong> ${U.lines(m.apologies)}</p>` : ''}
        ${m.openingPrayer ? `<p><strong>Opening prayer:</strong> ${esc(m.openingPrayer)}</p>` : ''}
        ${m.announcements ? `<h4>Matters arising and announcements</h4><p>${U.lines(m.announcements)}</p>` : ''}
        ${(m.items || []).length ? `
          <h4>What was discussed</h4>
          ${m.items.map((it, i) => `
            <div class="of-item">
              <p><strong>${i + 1}. ${esc(it.heading || 'Item')}</strong></p>
              ${it.discussion ? `<p>${U.lines(it.discussion)}</p>` : ''}
              ${it.decision ? `<p class="of-decision"><strong>Decided:</strong> ${U.lines(it.decision)}</p>` : ''}
            </div>`).join('')}` : ''}
        ${m.body ? `<h4>Notes</h4><p>${U.lines(m.body)}</p>` : ''}
        ${m.decisions ? `<h4>Decisions</h4><p>${U.lines(m.decisions)}</p>` : ''}
        ${(m.actions || []).length ? `
          <h4>Who is to do what</h4>
          <div class="table-wrap"><table class="portal-table">
            <thead><tr><th>What</th><th>Who</th><th>By when</th></tr></thead>
            <tbody>${m.actions.map(a => `<tr><td>${esc(a.task)}</td><td>${esc(a.owner || '')}</td><td>${a.dueDate ? esc(U.dayLabel(a.dueDate)) : ''}</td></tr>`).join('')}</tbody>
          </table></div>` : ''}
        ${m.nextMeeting ? `<p><strong>Next meeting:</strong> ${esc(m.nextMeeting)}</p>` : ''}
        ${m.closingPrayer ? `<p><strong>Closing prayer:</strong> ${esc(m.closingPrayer)}</p>` : ''}
        ${m.fileId ? `<p><a href="/api/files/${esc(m.fileId)}" target="_blank" rel="noopener">Open the scan of the paper minutes</a></p>` : ''}
        <p class="tiny muted">Recorded by ${esc(m.recordedBy || 'the secretariat')}${m.sharedAt ? `. Shared with the executive body on ${esc(U.dayLabel(m.sharedAt))}` : ''}.</p>
      </article>`;
  }

  // ================= what every executive reads =================
  async function renderShared(el) {
    const items = await fetchJSON('/api/executive/minutes');
    el.innerHTML = `
      <div class="panel-head"><div>
        <h2>Executive minutes</h2>
        <p class="sub">The record of what the executive body decided. Minutes appear here once the General Secretary and the Assistant have both agreed them.</p>
      </div></div>
      ${items.length ? items.map((m, i) => `
        <div class="portal-card">${i === 0 ? doc(m) : `<details class="of-past"><summary>${esc(U.dayLabel(m.date))}: ${esc(m.title || 'Executive meeting')}</summary>${doc(m)}</details>`}</div>`).join('')
        : '<div class="portal-card"><p class="empty-state">No minutes have been shared yet.</p></div>'}`;
  }

  // The Chapter Coordinator reads the record too, but not the secretaries' drafts.
  async function renderForCoordinator(el) {
    const data = await fetchJSON('/api/coordinator/minutes');
    const items = data.items || [];
    el.innerHTML = `
      <div class="panel-head"><div>
        <h2>Executive minutes</h2>
        <p class="sub">The minutes of the executive meetings, once the General Secretary and the Assistant have agreed them.${data.inReview ? ` ${data.inReview} more ${data.inReview === 1 ? 'set is' : 'sets are'} still with the secretaries.` : ''}</p>
      </div></div>
      ${items.length ? items.map((m, i) => `
        <div class="portal-card">${i === 0 ? doc(m) : `<details class="of-past"><summary>${esc(U.dayLabel(m.date))}: ${esc(m.title || 'Executive meeting')}</summary>${doc(m)}</details>`}</div>`).join('')
        : '<div class="portal-card"><p class="empty-state">No minutes have been shared yet.</p></div>'}`;
  }

  // ================= the secretaries' desk =================
  async function renderDesk(el, position, openId) {
    const [items, setup] = await Promise.all([fetchJSON('/api/executive/minutes'), fetchJSON('/api/executive/minutes-setup')]);
    const me = (position && position.key) || '';
    const ctx = { items, setup, me, reload: (id) => renderDesk(el, position, id) };
    if (openId === 'new') return editor(el, null, ctx);
    const current = openId && items.find(m => m.id === openId);
    if (current) return review(el, current, ctx);
    list(el, ctx);
  }

  function signatures(m, seats) {
    return seats.map(seat => `${SEAT_LABEL[seat] || seat}: ${(m.approvedPositions || []).includes(seat) ? '<strong>agreed</strong>' : 'not yet'}`).join(' &middot; ');
  }

  function list(el, ctx) {
    const { items, setup } = ctx;
    const waiting = items.filter(m => m.status === 'in_review' && !(m.approvedPositions || []).includes(ctx.me));
    el.innerHTML = `
      <div class="panel-head"><div>
        <h2>Minutes</h2>
        <p class="sub">Write the minutes of each executive meeting here. Send them to the other secretary to read and agree. When you have both agreed, they are shared with the whole executive body.</p>
      </div><div class="panel-actions"><button class="btn btn-primary btn-sm" id="newMinutes">Write new minutes</button></div></div>
      ${waiting.length ? U.notice(`<strong>${waiting.length} set${waiting.length === 1 ? '' : 's'} of minutes ${waiting.length === 1 ? 'is' : 'are'} waiting for you to read and agree.</strong>`, 'warn') : ''}
      ${setup.seats.length < 2 ? U.notice('Only one of the two secretary seats is filled at the moment, so one signature is enough to share the minutes.') : ''}
      <div class="portal-card">
        ${items.length ? `<div class="table-wrap"><table class="portal-table">
          <thead><tr><th>Meeting</th><th>Where it stands</th><th>Agreed by</th><th></th></tr></thead>
          <tbody>${items.map(m => `
            <tr>
              <td><strong>${esc(m.title || 'Executive meeting')}</strong><br><span class="tiny muted">${esc(U.dayLabel(m.date))}</span></td>
              <td>${U.statusChip('minutes', m.status)}</td>
              <td class="tiny">${m.status === 'draft' ? '' : signatures(m, setup.seats)}</td>
              <td><div class="row-actions of-row-actions"><button data-open="${esc(m.id)}">${m.status === 'draft' ? 'Continue' : m.status === 'in_review' ? 'Read' : 'View'}</button></div></td>
            </tr>`).join('')}</tbody>
        </table></div>` : '<p class="empty-state">No minutes yet. Use “Write new minutes” after your next meeting.</p>'}
      </div>`;
    el.querySelector('#newMinutes').addEventListener('click', () => ctx.reload('new'));
    el.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => ctx.reload(b.dataset.open)));
  }

  // ---- reading, commenting, agreeing ----
  function review(el, m, ctx) {
    const { setup, me } = ctx;
    const shared = m.status === 'approved' || m.status === 'adopted';
    const stepIndex = shared ? 2 : m.status === 'in_review' ? 1 : 0;
    const agreed = (m.approvedPositions || []).includes(me);
    const comments = m.comments || [];
    el.innerHTML = `
      <div class="panel-head"><div>
        <button class="btn btn-outline btn-sm" id="backToList">Back to all minutes</button>
        <h2>${esc(m.title || 'Executive meeting')}</h2>
        <p class="sub">${U.statusChip('minutes', m.status)} ${m.status === 'draft' ? '' : signatures(m, setup.seats)}</p>
      </div></div>
      ${U.steps(['Write the minutes', 'Both secretaries read and agree them', 'Shared with the executive body'], stepIndex)}
      ${shared ? U.notice('<strong>These minutes are the record.</strong> They have been shared with the executive body and can no longer be changed. Put any correction in the next meeting\'s minutes.', 'good') : ''}
      ${m.status === 'in_review' && !agreed ? U.notice('<strong>Your turn.</strong> Read the minutes below. If something is wrong, comment or change it. If they are right, agree them.', 'warn') : ''}
      ${m.status === 'in_review' && agreed ? U.notice('You have agreed these minutes. They are shared as soon as the other secretary agrees too.') : ''}
      <div class="portal-card">${doc(m)}</div>
      <div class="portal-card">
        <h3>Between the two of you</h3>
        <div class="of-thread" aria-live="polite">${comments.length ? comments.map(c => `
          <div class="of-comment">
            <p><strong>${esc(c.byName || 'Secretary')}</strong>${c.position ? ` <span class="muted">${esc(SEAT_LABEL[c.position] || '')}</span>` : ''} <span class="tiny muted">${esc(dateTime(c.at))}</span></p>
            <p>${U.lines(c.text)}</p>
          </div>`).join('') : '<p class="muted">No comments yet.</p>'}</div>
        ${!shared ? `<form id="commentForm" novalidate>
          ${U.field({ id: 'mComment', label: 'Add a comment', type: 'textarea', rows: 2 })}
          <div class="of-actions"><button class="btn btn-outline" type="submit">Post comment</button></div>
        </form>` : ''}
      </div>
      <div class="portal-card">
        <div class="of-actions">
          ${m.status === 'draft' ? '<button class="btn btn-primary" id="sendReview">Send to the other secretary</button>' : ''}
          ${m.status === 'in_review' && !agreed ? '<button class="btn btn-primary" id="agree">Agree these minutes</button>' : ''}
          ${!shared ? '<button class="btn btn-outline" id="editMinutes">Change the minutes</button>' : ''}
          ${m.status === 'in_review' ? '<button class="btn btn-outline" id="sendBack">Send back to draft</button>' : ''}
          ${m.status === 'draft' ? '<button class="btn btn-outline danger" id="deleteMinutes">Delete this draft</button>' : ''}
        </div>
        <div class="form-msg" id="minutesMsg" role="alert"></div>
      </div>`;
    const msg = (t, type) => setFormMsg('minutesMsg', t, type);
    el.querySelector('#backToList').addEventListener('click', () => ctx.reload());
    const bind = (id, fn) => { const b = el.querySelector(id); if (b) b.addEventListener('click', async (e) => { try { await U.busy(e.currentTarget, fn); } catch (err) { msg(err.message || 'Could not do that.', 'error'); } }); };
    bind('#sendReview', async () => { await U.send(`/api/executive/minutes/${m.id}/review`, 'POST'); showToast('Sent to the other secretary.', 'success'); ctx.reload(m.id); });
    bind('#agree', async () => {
      const out = await U.send(`/api/executive/minutes/${m.id}/approve`, 'POST');
      showToast(out.shared ? 'Agreed. The minutes are now shared with the executive body.' : 'Agreed. Waiting for the other secretary.', 'success');
      ctx.reload(m.id);
    });
    bind('#editMinutes', async () => { editor(el, m, ctx); });
    bind('#sendBack', async () => {
      const note = prompt('Anything to tell the writer? (optional)') || '';
      await U.send(`/api/executive/minutes/${m.id}/reopen`, 'POST', { note });
      ctx.reload(m.id);
    });
    bind('#deleteMinutes', async () => {
      if (!confirm('Delete this draft? This cannot be undone.')) return;
      await U.send(`/api/executive/minutes/${m.id}`, 'DELETE'); ctx.reload();
    });
    const form = el.querySelector('#commentForm');
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await U.busy(form.querySelector('button'), () => U.send(`/api/executive/minutes/${m.id}/comments`, 'POST', { text: form.querySelector('#mComment').value })); ctx.reload(m.id); }
      catch (err) { msg(err.message || 'Could not post that.', 'error'); }
    });
  }

  const dateTime = (v) => (typeof dateTimeLabel === 'function' ? dateTimeLabel(v) : String(v || ''));

  // ---- the form for taking the minutes ----
  function editor(el, m, ctx) {
    const existing = m || { date: todayISO(), presentExecutiveIds: [], items: [], actions: [] };
    const { setup } = ctx;
    const rowFns = {
      mItems: (it) => U.cell('Item discussed', 'heading', it.heading, { wide: true, placeholder: 'For example: The semester outline' })
        + U.cell('What was said', 'discussion', it.discussion, { type: 'textarea', rows: 3, wide: true })
        + U.cell('What was decided', 'decision', it.decision, { type: 'textarea', rows: 2, wide: true }),
      mActions: (a) => U.cell('What is to be done', 'task', a.task, { wide: true })
        + U.cell('Who is to do it', 'owner', a.owner, { placeholder: 'A name or an office' })
        + U.cell('By when', 'dueDate', a.dueDate, { type: 'date' })
    };
    el.innerHTML = `
      <div class="panel-head"><div>
        <button class="btn btn-outline btn-sm" id="backFromEditor">Back</button>
        <h2>${m ? 'Change the minutes' : 'Write new minutes'}</h2>
        <p class="sub">Follow the form from the top. Save as often as you like. Nothing is seen by the other secretary until you send it.</p>
      </div></div>
      ${m && m.status === 'in_review' ? U.notice('These minutes are with the other secretary. If you change them, you will both need to agree them again.', 'warn') : ''}
      <form id="minutesForm" novalidate>
        <div class="portal-card">
          ${U.section(1, 'The meeting', 'When and where it was held.', `
            <div class="field-row">
              ${U.field({ id: 'mDate', label: 'Date', type: 'date', value: existing.date, required: true })}
              ${U.field({ id: 'mStart', label: 'Started at', type: 'time', value: hhmm(existing.startTime) })}
              ${U.field({ id: 'mEnd', label: 'Ended at', type: 'time', value: hhmm(existing.endTime) })}
            </div>
            <div class="field-row">
              ${U.field({ id: 'mTitle', label: 'Name of the meeting', value: existing.title, placeholder: 'For example: October executive meeting' })}
              ${U.field({ id: 'mVenue', label: 'Venue', value: existing.venue })}
              ${U.field({ id: 'mChair', label: 'Chaired by', value: existing.chair })}
            </div>`)}
          ${U.section(2, 'Who was there', 'Tick everyone who was in the room. The list is this chapter\'s executive.', `
            <fieldset class="of-fieldset"><legend class="sr-only">Executives present</legend>
              <label class="of-check-line"><input type="checkbox" id="mAll"> Everyone</label>
              <div class="of-checks">${setup.executives.map(x => `<label class="of-check-line"><input type="checkbox" name="present" value="${esc(x.id)}"${(existing.presentExecutiveIds || []).includes(x.id) ? ' checked' : ''}> <span>${esc(x.name)}${x.role ? ` <span class="muted">${esc(x.role)}</span>` : ''}</span></label>`).join('')}</div>
            </fieldset>
            ${U.field({ id: 'mApologies', label: 'Apologies', type: 'textarea', rows: 2, value: existing.apologies, hint: 'Who could not come, and why if it was given.' })}`)}
          ${U.section(3, 'Opening', 'How the meeting began.', `
            <div class="field-row">${U.field({ id: 'mOpening', label: 'Opening prayer by', value: existing.openingPrayer })}</div>
            ${U.field({ id: 'mAnnounce', label: 'Matters arising and announcements', type: 'textarea', rows: 3, value: existing.announcements, hint: 'Anything carried over from the last meeting, and anything announced at the start.' })}`)}
          ${U.section(4, 'What was discussed and decided', 'One block for each item on the agenda. Say what was said and, separately, what was decided.', `
            <button type="button" class="btn btn-outline btn-sm" id="usualOrder">Fill in the usual order of business</button>
            ${U.repeater('mItems', existing.items || [], rowFns.mItems, { addLabel: 'Add an item', blank: {} })}`)}
          ${U.section(5, 'Who is to do what', 'Every job given out, who has it, and when it is due. The Vice President and the President follow these up.', `
            ${U.repeater('mActions', existing.actions || [], rowFns.mActions, { addLabel: 'Add a job', blank: {} })}`)}
          ${U.section(6, 'Closing', 'How the meeting ended.', `
            <div class="field-row">
              ${U.field({ id: 'mNext', label: 'Next meeting', value: existing.nextMeeting, placeholder: 'Date, time and place' })}
              ${U.field({ id: 'mClosing', label: 'Closing prayer by', value: existing.closingPrayer })}
            </div>
            ${U.field({ id: 'mBody', label: 'Anything else worth recording', type: 'textarea', rows: 3, value: existing.body })}
            <div class="field">
              <label for="mFile">Scan or photo of the paper minutes <span class="muted">(optional)</span></label>
              <input type="file" id="mFile" accept="application/pdf,image/*">
              <small class="hint">${existing.fileId ? 'A file is already attached. Choosing another replaces it.' : 'A PDF or a clear photo. Only the secretaries and, once shared, the executive body can open it.'}</small>
            </div>`)}
        </div>
        <div class="portal-card">
          <div class="of-actions">
            <button class="btn btn-primary" type="submit" id="saveMinutes">Save</button>
            <button class="btn btn-outline" type="button" id="saveAndSend">Save and send to the other secretary</button>
          </div>
          <div class="form-msg" id="editorMsg" role="alert"></div>
        </div>
      </form>`;
    const form = el.querySelector('#minutesForm');
    U.wireRepeaters(form, (id, row) => rowFns[id](row), () => ({}));
    form.querySelector('#mAll').addEventListener('change', (e) => form.querySelectorAll('input[name="present"]').forEach(b => { b.checked = e.target.checked; }));
    el.querySelector('#backFromEditor').addEventListener('click', () => ctx.reload(m ? m.id : undefined));

    form.querySelector('#usualOrder').addEventListener('click', () => {
      const host = form.querySelector('#mItems');
      const used = U.collectRows(form, 'mItems').filter(r => r.heading || r.discussion || r.decision);
      if (used.length && !confirm('This replaces the items you have already written. Continue?')) return;
      host.innerHTML = '';
      USUAL_ORDER.forEach(heading => {
        const wrap = document.createElement('div');
        wrap.className = 'of-row'; wrap.setAttribute('data-row', '');
        wrap.innerHTML = rowFns.mItems({ heading }) + '<button type="button" class="of-remove" data-remove aria-label="Remove this row">Remove</button>';
        host.appendChild(wrap);
      });
    });

    const read = () => ({
      date: form.querySelector('#mDate').value, startTime: form.querySelector('#mStart').value, endTime: form.querySelector('#mEnd').value,
      title: form.querySelector('#mTitle').value, venue: form.querySelector('#mVenue').value, chair: form.querySelector('#mChair').value,
      presentExecutiveIds: [...form.querySelectorAll('input[name="present"]:checked')].map(b => b.value),
      apologies: form.querySelector('#mApologies').value, openingPrayer: form.querySelector('#mOpening').value,
      announcements: form.querySelector('#mAnnounce').value,
      items: U.collectRows(form, 'mItems'), actions: U.collectRows(form, 'mActions'),
      nextMeeting: form.querySelector('#mNext').value, closingPrayer: form.querySelector('#mClosing').value, body: form.querySelector('#mBody').value
    });
    const persist = async () => {
      const out = m
        ? await U.send(`/api/executive/minutes/${m.id}`, 'PUT', read())
        : await U.send('/api/executive/minutes', 'POST', read());
      const file = form.querySelector('#mFile').files[0];
      if (file) {
        const data = new FormData();
        data.append('file', file);
        await fetchJSON(`/api/executive/minutes/${out.item.id}/file`, { method: 'POST', body: data });
      }
      return out.item;
    };
    const err = (e) => setFormMsg('editorMsg', e.message || 'Could not save.', 'error');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { const saved = await U.busy(form.querySelector('#saveMinutes'), persist); showToast('Saved.', 'success'); ctx.reload(saved.id); } catch (x) { err(x); }
    });
    form.querySelector('#saveAndSend').addEventListener('click', async (e) => {
      try {
        const saved = await U.busy(e.currentTarget, persist);
        if (saved.status === 'draft') await U.send(`/api/executive/minutes/${saved.id}/review`, 'POST');
        showToast('Saved and sent to the other secretary.', 'success');
        ctx.reload(saved.id);
      } catch (x) { err(x); }
    });
  }

  return { renderShared, renderForCoordinator, renderDesk, doc };
})();
