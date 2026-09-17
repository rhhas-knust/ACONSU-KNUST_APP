/* ============================================================
   The National Council.

   The one body where the whole union sits together: the
   National Coordinator, every Chapter Coordinator, every
   Chapter President, and the Patrons.

   A seat here grants exactly two things — reading the council
   and speaking in it. It grants nothing about another chapter,
   so a Chapter President on this page still cannot see another
   chapter's members, money or welfare cases. There is simply
   nothing chapter-scoped on it.
   ============================================================ */

let COUNCIL = null;

function seatBadge(seat) {
  return `<span class="tiny muted">${escapeHtml(seat || '')}</span>`;
}

function authorLine(p) {
  const where = p.authorChapterName ? ` · ${escapeHtml(p.authorChapterName)}` : '';
  return `<strong>${escapeHtml(p.authorName || 'Someone')}</strong>
    <span class="tiny muted">${escapeHtml(p.authorRole || '')}${where} · ${shortDate(p.createdAt)}</span>`;
}

async function loadCouncil() {
  COUNCIL = await fetchJSON('/api/council');
  return COUNCIL;
}

// ---------- the meeting ----------
async function renderCouncilMeeting(el) {
  const d = await loadCouncil();
  const m = d.meeting || {};
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>The Council Meeting</h2>
        <p class="sub">Where the union meets. ${d.isChair ? 'You set this link — everyone on the council sees it.' : 'Set by the National Coordinator.'}</p>
      </div>
    </div>
    ${m.notice ? `
      <div class="portal-card" style="border-color: var(--flame-gold); background:#FFF8EC;">
        ${escapeHtml(m.notice)}
      </div>` : ''}
    <div class="portal-card" style="max-width:560px;">
      ${m.url ? `
        <h4 style="margin-top:0;">${escapeHtml(m.label || 'Council Meeting')}</h4>
        ${m.at ? `<p class="muted" style="margin:0 0 14px;">${escapeHtml(m.at)}</p>` : ''}
        <a class="btn btn-primary" href="${escapeHtml(m.url)}" target="_blank" rel="noopener">Join the Meeting</a>
        <p class="tiny muted" style="margin-top:12px; word-break:break-all;">${escapeHtml(m.url)}</p>
      ` : '<p class="empty-state">No meeting link has been set yet.</p>'}
    </div>
    ${d.isChair ? `
    <div class="portal-card" style="max-width:560px;">
      <h4 style="margin-top:0;">Set the Meeting</h4>
      <form id="meetingForm">
        <div class="field"><label>Meeting link</label>
          <input type="url" id="mUrl" value="${escapeHtml(m.url || '')}" placeholder="https://zoom.us/j/...">
          <small class="hint">A full https:// link — Zoom, Meet, whatever the council uses.</small>
        </div>
        <div class="field-row">
          <div class="field"><label>What it is called</label>
            <input type="text" id="mLabel" value="${escapeHtml(m.label || '')}" placeholder="e.g. Monthly Council Meeting"></div>
          <div class="field"><label>When it sits</label>
            <input type="text" id="mAt" value="${escapeHtml(m.at || '')}" placeholder="e.g. First Saturday, 7:00 PM"></div>
        </div>
        <div class="field"><label>Standing notice</label>
          <textarea id="mNotice" rows="2" placeholder="Shown above the discussion">${escapeHtml(m.notice || '')}</textarea></div>
        <button type="submit" class="btn btn-primary">Save Meeting</button>
        <div class="form-msg" id="meetingMsg"></div>
      </form>
    </div>` : ''}
  `;

  const form = document.getElementById('meetingForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await fetchJSON('/api/council/meeting', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meetingUrl: document.getElementById('mUrl').value,
          meetingLabel: document.getElementById('mLabel').value,
          meetingAt: document.getElementById('mAt').value,
          notice: document.getElementById('mNotice').value
        })
      });
      showToast('Meeting saved.', 'success');
      openPanel('meeting');
    } catch (err) {
      setFormMsg('meetingMsg', err.message || 'Could not save the meeting.', 'error');
    }
  });
}

// ---------- the discussion ----------
async function renderCouncilDiscussion(el) {
  const d = await loadCouncil();
  const threads = d.threads || [];
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Council Discussion</h2>
        <p class="sub">Matters before the council. Everyone with a seat sees every post here.</p>
      </div>
      <div class="panel-actions">${seatBadge(`You sit as ${d.seat}`)}</div>
    </div>
    <div class="portal-card" style="max-width:640px;">
      <form id="councilPostForm">
        <div class="field"><label>Raise a matter</label>
          <textarea id="cpBody" rows="3" required placeholder="What should the council consider?"></textarea></div>
        <button type="submit" class="btn btn-primary">Post to the Council</button>
        <div class="form-msg" id="councilPostMsg"></div>
      </form>
    </div>
    ${threads.length ? threads.map(t => `
      <div class="portal-card" ${t.pinned ? 'style="border-color: var(--flame-gold);"' : ''}>
        ${t.pinned ? '<div class="tiny muted" style="margin-bottom:6px;">📌 Pinned</div>' : ''}
        <div>${authorLine(t)}</div>
        <p style="white-space:pre-wrap; margin:10px 0 12px;">${escapeHtml(t.body)}</p>
        <div class="row-actions" style="margin-bottom:10px;">
          <button data-reply="${escapeHtml(t.id)}">Reply</button>
          ${d.isChair ? `<button data-pin="${escapeHtml(t.id)}">${t.pinned ? 'Unpin' : 'Pin'}</button>` : ''}
          ${(d.isChair || t.authorStaffId === (PORTAL.user && PORTAL.user.id))
            ? `<button class="danger" data-remove="${escapeHtml(t.id)}">Remove</button>` : ''}
        </div>
        ${(t.replies || []).length ? `
          <div style="border-left:3px solid var(--line); padding-left:12px;">
            ${t.replies.map(r => `
              <div style="margin-bottom:12px;">
                <div>${authorLine(r)}</div>
                <p style="white-space:pre-wrap; margin:6px 0 4px;">${escapeHtml(r.body)}</p>
                ${(d.isChair || r.authorStaffId === (PORTAL.user && PORTAL.user.id))
                  ? `<div class="row-actions"><button class="danger" data-remove="${escapeHtml(r.id)}">Remove</button></div>` : ''}
              </div>`).join('')}
          </div>` : ''}
        <div id="replyBox-${escapeHtml(t.id)}"></div>
      </div>`).join('')
      : '<p class="empty-state">Nothing before the council yet.</p>'}
  `;

  const post = async (body, parentId) => {
    await fetchJSON('/api/council/posts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, parentId: parentId || '' })
    });
    openPanel('discussion');
  };

  document.getElementById('councilPostForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await post(document.getElementById('cpBody').value, '');
      showToast('Posted to the council.', 'success');
    } catch (err) {
      setFormMsg('councilPostMsg', err.message || 'Could not post that.', 'error');
    }
  });

  el.querySelectorAll('[data-reply]').forEach(btn => btn.addEventListener('click', () => {
    const box = document.getElementById(`replyBox-${btn.dataset.reply}`);
    if (!box || box.dataset.open === '1') return;
    box.dataset.open = '1';
    box.innerHTML = `
      <form class="reply-form" style="margin-top:8px;">
        <div class="field"><textarea rows="2" required placeholder="Reply to the council"></textarea></div>
        <button type="submit" class="btn btn-primary btn-sm">Reply</button>
      </form>`;
    box.querySelector('form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await post(box.querySelector('textarea').value, btn.dataset.reply);
      } catch (err) {
        showToast(err.message || 'Could not reply.', 'error');
      }
    });
  }));

  el.querySelectorAll('[data-pin]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await fetchJSON(`/api/council/posts/${btn.dataset.pin}/pin`, { method: 'PATCH' });
      openPanel('discussion');
    } catch (err) { showToast(err.message || 'Could not pin that.', 'error'); }
  }));

  el.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Remove this post?')) return;
    try {
      await fetchJSON(`/api/council/posts/${btn.dataset.remove}`, { method: 'DELETE' });
      openPanel('discussion');
    } catch (err) { showToast(err.message || 'Could not remove that.', 'error'); }
  }));
}

// ---------- who sits on it ----------
async function renderCouncilRoster(el) {
  const d = await loadCouncil();
  const roster = d.roster || [];
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Who Sits on the Council</h2>
        <p class="sub">Built from the offices people actually hold, so it is never out of date.</p>
      </div>
      <div class="panel-actions"><span class="tiny muted">${roster.length} seat${roster.length === 1 ? '' : 's'}</span></div>
    </div>
    <div class="portal-card">
      ${roster.length ? `
        <div class="table-wrap"><table class="portal-table">
          <thead><tr><th>Name</th><th>Seat</th><th>Chapter</th></tr></thead>
          <tbody>${roster.map(r => `
            <tr>
              <td>${escapeHtml(r.name || '—')}</td>
              <td>${escapeHtml(r.seat)}</td>
              <td>${escapeHtml(r.chapterName || '—')}</td>
            </tr>`).join('')}</tbody>
        </table></div>` : '<p class="empty-state">No seats filled yet.</p>'}
    </div>
  `;
}

initPortal({
  role: 'council',
  label: 'National Council',
  panels: [
    { key: 'discussion', label: 'Discussion', render: renderCouncilDiscussion },
    { key: 'meeting', label: 'The Meeting', render: renderCouncilMeeting },
    { key: 'roster', label: 'Who Sits Here', render: renderCouncilRoster }
  ]
});
