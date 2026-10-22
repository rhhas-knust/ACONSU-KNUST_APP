/* ============================================================
   Sunday announcements.
   The General Secretary or the Assistant asks every executive what
   they want announced; each executive answers in a short form; the
   secretaries choose what is read out, tidy the wording, and compile
   the text for the service.
   Requires office-ui.js.
   ============================================================ */
window.OfficeAnnounce = (function () {
  const U = OfficeUI;
  const esc = U.esc;

  function nextSunday() {
    const d = new Date();
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // ================= the secretaries' desk =================
  async function renderDesk(el, callId) {
    if (callId) return renderCall(el, callId);
    const data = await fetchJSON('/api/executive/announcement-calls');
    const items = data.items || [];
    el.innerHTML = `
      <div class="panel-head"><div>
        <h2>Sunday announcements</h2>
        <p class="sub">A few days before the service, ask the executives what they want announced. Their answers come back here, and you choose what is read out.</p>
      </div><div class="panel-actions"><button class="btn btn-primary btn-sm" id="askBtn">Ask for announcements</button></div></div>
      <div id="askSlot"></div>
      ${items.length ? items.map(c => `
        <section class="portal-card">
          <div class="of-card-head"><div>
            <h3>${esc(c.title)}</h3>
            <p class="muted">${c.dueDate ? `Answers wanted by ${esc(U.dayLabel(c.dueDate))}. ` : ''}${c.received} of ${c.expected} have answered.</p>
          </div><div>${U.statusChip('call', c.status)}</div></div>
          <div class="of-actions"><button class="btn btn-outline" data-open="${esc(c.id)}">Open</button></div>
        </section>`).join('') : '<div class="portal-card"><p class="empty-state">You have not asked for any announcements yet.</p></div>'}`;

    el.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => renderDesk(el, b.dataset.open)));
    el.querySelector('#askBtn').addEventListener('click', () => {
      const slot = el.querySelector('#askSlot');
      slot.innerHTML = `
        <form class="portal-card" id="askForm" novalidate>
          <h3>Ask for announcements</h3>
          <div class="field-row">
            ${U.field({ id: 'aDate', label: 'Which service', type: 'date', value: data.suggestedDate || nextSunday(), required: true })}
            ${U.field({ id: 'aDue', label: 'Answers wanted by', type: 'date', hint: 'Must be before the service.' })}
          </div>
          ${U.field({ id: 'aNote', label: 'Anything they should know', type: 'textarea', rows: 2, hint: 'For example: Keep it to two sentences, and say where and when.' })}
          <div class="of-actions">
            <button class="btn btn-primary" type="submit">Send the request</button>
            <button class="btn btn-outline" type="button" id="askCancel">Cancel</button>
          </div>
          <div class="form-msg" id="askMsg" role="alert"></div>
        </form>`;
      slot.querySelector('#askCancel').addEventListener('click', () => { slot.innerHTML = ''; });
      slot.querySelector('#askForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await U.busy(slot.querySelector('[type="submit"]'), () => U.send('/api/executive/announcement-calls', 'POST', {
            serviceDate: slot.querySelector('#aDate').value, dueDate: slot.querySelector('#aDue').value, note: slot.querySelector('#aNote').value
          }));
          showToast('Request sent to the executives.', 'success');
          renderDesk(el);
        } catch (err) { setFormMsg('askMsg', err.message || 'Could not send the request.', 'error'); }
      });
    });
  }

  async function renderCall(el, callId) {
    const data = await fetchJSON(`/api/executive/announcement-calls/${callId}`);
    const { call, items, waitingOn } = data;
    const answered = items.filter(i => !i.nothing);
    const nothing = items.filter(i => i.nothing);
    el.innerHTML = `
      <div class="panel-head"><div>
        <button class="btn btn-outline btn-sm" id="backToAsks">Back to all requests</button>
        <h2>${esc(call.title)}</h2>
        <p class="sub">${U.statusChip('call', call.status)} ${call.dueDate ? `Answers wanted by ${esc(U.dayLabel(call.dueDate))}.` : ''}</p>
      </div></div>
      ${waitingOn.length ? U.notice(`<strong>Still to answer (${waitingOn.length}):</strong> ${waitingOn.map(w => esc(w.name) + (w.role ? ` (${esc(w.role)})` : '')).join(', ')}.`) : ''}
      <div class="portal-card">
        <h3>What came in</h3>
        ${answered.length ? answered.map((i, n) => `
          <div class="of-answer" data-item="${esc(i.id)}">
            <p><strong>${esc(i.fromLabel || i.fromName)}</strong> <span class="muted">${esc(i.fromName || '')}</span></p>
            <p>${U.lines(i.text)}</p>
            ${i.whenWhere || i.contact ? `<p class="tiny muted">${esc([i.whenWhere, i.contact && `Contact: ${i.contact}`].filter(Boolean).join('. '))}</p>` : ''}
            <fieldset class="of-fieldset">
              <legend class="sr-only">What to do with this announcement</legend>
              <label class="of-check-line"><input type="radio" name="d-${esc(i.id)}" value="included"${i.status === 'included' ? ' checked' : ''}> Read it out</label>
              <label class="of-check-line"><input type="radio" name="d-${esc(i.id)}" value="left_out"${i.status === 'left_out' ? ' checked' : ''}> Leave it out</label>
              <label class="of-check-line"><input type="radio" name="d-${esc(i.id)}" value="submitted"${i.status === 'submitted' ? ' checked' : ''}> Not decided yet</label>
            </fieldset>
            <div class="field-row">
              ${U.field({ id: `t-${i.id}`, label: 'Wording to read out', type: 'textarea', rows: 2, value: i.finalText || i.text, hint: 'Tidy it if you need to. Leave it as it is to read it out as sent.' })}
              ${U.field({ id: `o-${i.id}`, label: 'Order', type: 'number', min: 0, step: '1', value: i.order || n + 1, hint: 'Smallest is read first.' })}
            </div>
            <div class="of-actions"><button class="btn btn-outline btn-sm" data-save-item="${esc(i.id)}">Save this one</button></div>
          </div>`).join('<hr class="of-rule">') : '<p class="empty-state">Nothing has come in yet.</p>'}
        ${nothing.length ? `<p class="tiny muted">Nothing for this Sunday from: ${nothing.map(i => esc(i.fromLabel || i.fromName)).join(', ')}.</p>` : ''}
        <div class="form-msg" id="callMsg" role="alert"></div>
      </div>
      <div class="portal-card">
        <h3>The text for Sunday</h3>
        <div class="of-actions">
          <button class="btn btn-primary" id="compileBtn">Put it together from what I chose</button>
          <button class="btn btn-outline" id="compileAll">Read out everything that came in</button>
        </div>
        ${U.field({ id: 'finalText', label: 'Text to read at the service', type: 'textarea', rows: 10, value: call.compiledText, hint: 'You can edit this directly before Sunday. Save it when you are happy.' })}
        <div class="of-actions">
          <button class="btn btn-outline" id="saveFinal">Save this text</button>
          <button class="btn btn-outline" id="copyFinal">Copy it</button>
          <button class="btn btn-outline" id="toggleCall">${call.status === 'open' ? 'Close this request' : 'Reopen this request'}</button>
        </div>
      </div>`;

    const msg = (t, type) => setFormMsg('callMsg', t, type);
    el.querySelector('#backToAsks').addEventListener('click', () => renderDesk(el));
    el.querySelectorAll('[data-save-item]').forEach(b => b.addEventListener('click', async () => {
      const id = b.dataset.saveItem;
      const picked = el.querySelector(`input[name="d-${id}"]:checked`);
      try {
        await U.busy(b, () => U.send(`/api/executive/announcement-calls/${callId}/items/${id}`, 'PUT', {
          status: picked ? picked.value : 'submitted', finalText: el.querySelector(`#t-${id}`).value, order: el.querySelector(`#o-${id}`).value
        }));
        showToast('Saved.', 'success');
      } catch (err) { msg(err.message || 'Could not save.', 'error'); }
    }));
    const compile = async (btn, includeAll) => {
      try {
        const out = await U.busy(btn, () => U.send(`/api/executive/announcement-calls/${callId}/compile`, 'POST', { includeAll }));
        el.querySelector('#finalText').value = out.item.compiledText;
        showToast('Put together. Check it below.', 'success');
      } catch (err) { msg(err.message || 'Could not put it together.', 'error'); }
    };
    el.querySelector('#compileBtn').addEventListener('click', (e) => compile(e.currentTarget, false));
    el.querySelector('#compileAll').addEventListener('click', async (e) => { await compile(e.currentTarget, true); renderCall(el, callId); });
    el.querySelector('#saveFinal').addEventListener('click', async (e) => {
      try { await U.busy(e.currentTarget, () => U.send(`/api/executive/announcement-calls/${callId}`, 'PUT', { compiledText: el.querySelector('#finalText').value })); showToast('Saved.', 'success'); }
      catch (err) { msg(err.message || 'Could not save.', 'error'); }
    });
    el.querySelector('#copyFinal').addEventListener('click', async () => {
      const text = el.querySelector('#finalText').value;
      try { await navigator.clipboard.writeText(text); showToast('Copied.', 'success'); }
      catch (e) { el.querySelector('#finalText').select(); showToast('Select the text and copy it.', 'info'); }
    });
    el.querySelector('#toggleCall').addEventListener('click', async (e) => {
      try { await U.busy(e.currentTarget, () => U.send(`/api/executive/announcement-calls/${callId}`, 'PUT', { status: call.status === 'open' ? 'closed' : 'open' })); renderCall(el, callId); }
      catch (err) { msg(err.message || 'Could not change it.', 'error'); }
    });
  }

  // ================= every executive's side =================
  async function renderAnswer(el) {
    const data = await fetchJSON('/api/executive/announcement-requests');
    const items = data.items || [];
    el.innerHTML = `
      <div class="panel-head"><div>
        <h2>My announcement</h2>
        <p class="sub">When the secretaries ask what you want announced on Sunday, answer here. Keep it short, and say where and when.</p>
      </div></div>
      ${items.length ? items.map(({ call, answer }, i) => `
        <section class="portal-card" aria-labelledby="an-${i}">
          <div class="of-card-head"><div>
            <h3 id="an-${i}">${esc(call.title)}</h3>
            <p class="muted">${call.dueDate ? `Wanted by ${esc(U.dayLabel(call.dueDate))}. ` : ''}${answer ? (answer.nothing ? 'You said you have nothing for this Sunday.' : 'You have answered.') : 'You have not answered yet.'}</p>
          </div><div>${U.statusChip('call', call.status)}</div></div>
          ${call.note ? `<p><strong>From the secretaries:</strong> ${U.lines(call.note)}</p>` : ''}
          ${call.status === 'open' ? `<form data-call="${esc(call.id)}" novalidate>
            ${U.field({ id: `x-${call.id}`, label: 'What do you want announced?', type: 'textarea', rows: 3, value: answer && !answer.nothing ? answer.text : '' })}
            <div class="field-row">
              ${U.field({ id: `w-${call.id}`, label: 'When and where', value: answer ? answer.whenWhere : '' })}
              ${U.field({ id: `c-${call.id}`, label: 'Who to contact', value: answer ? answer.contact : '' })}
            </div>
            <label class="of-check-line"><input type="checkbox" id="n-${call.id}"${answer && answer.nothing ? ' checked' : ''}> I have nothing for this Sunday</label>
            <div class="of-actions"><button class="btn btn-primary" type="submit">${answer ? 'Update my answer' : 'Send my answer'}</button></div>
            <div class="form-msg" role="alert" data-msg></div>
          </form>` : (answer && !answer.nothing ? `<p>${U.lines(answer.text)}</p>` : '')}
        </section>`).join('') : '<div class="portal-card"><p class="empty-state">Nobody has asked for announcements yet.</p></div>'}`;
    el.querySelectorAll('form[data-call]').forEach(form => form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = form.dataset.call;
      const nothing = form.querySelector(`#n-${id}`).checked;
      try {
        await U.busy(form.querySelector('[type="submit"]'), () => U.send(`/api/executive/announcement-requests/${id}`, 'PUT', {
          nothing, text: form.querySelector(`#x-${id}`).value, whenWhere: form.querySelector(`#w-${id}`).value, contact: form.querySelector(`#c-${id}`).value
        }));
        showToast('Sent to the secretaries.', 'success');
        renderAnswer(el);
      } catch (err) { const m = form.querySelector('[data-msg]'); m.textContent = err.message || 'Could not send it.'; m.className = 'form-msg error'; }
    }));
  }

  return { renderDesk, renderAnswer };
})();
