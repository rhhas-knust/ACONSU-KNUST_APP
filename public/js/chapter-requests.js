/* ============================================================
   A chapter is its own.
   The chapter side (Chapter Admin, Chapter Coordinator) asks the main admin for
   help with its look (site settings, artwork, pages, department pages), its
   events, its members or its leadership accounts. The main admin sees the
   requests, works on that chapter while one is open, and marks it done. Shared by the admin dashboards and the Coordinator portal, so it
   needs only main.js, and everything lives inside ChapterRequests.
   ============================================================ */
window.ChapterRequests = (function () {
  const esc = (v) => escapeHtml(String(v == null ? '' : v));
  const day = (v) => (v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const send = (url, body) => fetchJSON(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const STATUS = { open: ['Open', 'green'], done: ['Done', 'grey'], withdrawn: ['Withdrawn', 'grey'], expired: ['Expired', 'grey'] };
  const chip = (s) => { const [label, tone] = STATUS[s] || [s, 'grey']; return `<span class="cr-chip cr-${tone}">${esc(label)}</span>`; };
  const msg = (el, text, type) => { el.textContent = text; el.className = `form-msg ${type || ''}`; };

  // ---------------- the chapter asks ----------------
  async function renderAsk(el) {
    const data = await fetchJSON('/api/chapter-requests');
    const items = data.items || [];
    el.innerHTML = `
      <div class="panel-head"><div>
        <h2>Ask National for help</h2>
        <p class="sub">Your chapter is your own: its look (site settings, artwork, media, pages and department pages), its events, its members and its leadership accounts. The main admin can change them only when you ask, and only for as long as your request is open.</p>
      </div></div>
      <form class="cr-card" id="crForm" novalidate>
        <h3>What do you need?</h3>
        <div class="field"><label for="crMessage">Tell National what to change</label>
          <textarea id="crMessage" rows="4" required aria-describedby="crHint" placeholder="For example: Please put the retreat photo on our home page, or: Please reset our Finance officer's password."></textarea>
          <small class="hint" id="crHint">They will see exactly what you write.</small></div>
        <div class="field"><label for="crDays">Keep it open for</label>
          <select id="crDays"><option value="3">3 days</option><option value="7" selected>7 days</option><option value="14">14 days</option><option value="30">30 days</option></select>
          <small class="hint">The main admin can make changes for your chapter only while it is open. You can close it sooner.</small></div>
        <div class="cr-actions"><button class="btn btn-primary" type="submit">Send the request</button></div>
        <div class="form-msg" id="crMsg" role="alert"></div>
      </form>
      <div class="cr-card">
        <h3>Your requests</h3>
        ${items.length ? items.map(r => `
          <div class="cr-row">
            <div>
              <p>${chip(r.status)} <span class="tiny muted">Sent ${esc(day(r.createdAt))} by ${esc(r.requestedByName || r.requestedByRole)}${r.status === 'open' ? `, open until ${esc(day(r.expiresAt))}` : ''}</span></p>
              <p>${esc(r.message)}</p>
              ${r.closedNote ? `<p class="tiny muted">From National: ${esc(r.closedNote)}</p>` : ''}
            </div>
            ${r.status === 'open' ? `<button class="btn btn-outline btn-sm" data-withdraw="${esc(r.id)}">Close it now</button>` : ''}
          </div>`).join('') : '<p class="empty-state">You have not asked for anything yet.</p>'}
      </div>`;
    const form = el.querySelector('#crForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const button = form.querySelector('[type="submit"]');
      button.disabled = true;
      try {
        await send('/api/chapter-requests', { message: form.querySelector('#crMessage').value, days: form.querySelector('#crDays').value });
        showToast('Sent. National can now help your chapter.', 'success');
        renderAsk(el);
      } catch (err) { msg(form.querySelector('#crMsg'), err.message || 'Could not send it.', 'error'); button.disabled = false; }
    });
    el.querySelectorAll('[data-withdraw]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Close this request? National will no longer be able to make changes for your chapter.')) return;
      try { await send(`/api/chapter-requests/${b.dataset.withdraw}/close`); renderAsk(el); }
      catch (err) { showToast(err.message || 'Could not close it.', 'error'); }
    }));
  }

  // ---------------- the main admin's list ----------------
  async function renderInbox(el, opts) {
    const o = opts || {};
    const data = await fetchJSON('/api/chapter-requests');
    const items = data.items || [];
    const open = items.filter(r => r.status === 'open');
    el.innerHTML = `
      <div class="panel-head"><div>
        <h2>Chapter requests</h2>
        <p class="sub">A chapter's look, events, members and leadership accounts belong to that chapter. You can change them only while the chapter has asked you to, here. Mark a request done when the work is finished.</p>
      </div></div>
      <div class="cr-card">
        <h3>Open${open.length ? ` (${open.length})` : ''}</h3>
        ${open.length ? open.map(r => `
          <div class="cr-row">
            <div>
              <p><strong>${esc(r.chapterName)}</strong> <span class="tiny muted">asked ${esc(day(r.createdAt))} (${esc(r.requestedByName || r.requestedByRole)}), open until ${esc(day(r.expiresAt))}</span></p>
              <p>${esc(r.message)}</p>
            </div>
            <div class="cr-actions">
              ${o.onWork ? `<button class="btn btn-primary btn-sm" data-work="${esc(r.chapterId)}">Work on ${esc(r.chapterName)}</button>` : ''}
              <button class="btn btn-outline btn-sm" data-done="${esc(r.id)}">Mark done</button>
            </div>
          </div>`).join('') : '<p class="empty-state">No chapter has asked for help.</p>'}
      </div>
      ${items.length > open.length ? `<div class="cr-card"><h3>Earlier</h3>${items.filter(r => r.status !== 'open').slice(0, 20).map(r => `
        <p>${chip(r.status)} <strong>${esc(r.chapterName)}</strong> <span class="tiny muted">${esc(day(r.createdAt))}</span><br>${esc(r.message)}</p>`).join('')}</div>` : ''}`;
    el.querySelectorAll('[data-work]').forEach(b => b.addEventListener('click', () => o.onWork(b.dataset.work)));
    el.querySelectorAll('[data-done]').forEach(b => b.addEventListener('click', async () => {
      const note = prompt('A short note for the chapter about what was done (optional):') || '';
      try { await send(`/api/chapter-requests/${b.dataset.done}/close`, { note }); showToast('Marked done.', 'success'); renderInbox(el, o); }
      catch (err) { showToast(err.message || 'Could not close it.', 'error'); }
    }));
  }

  return { renderAsk, renderInbox };
})();
