// The script of sermon-notes.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
let NOTES = [];

function showModal(html) {
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modalBackdrop').style.display = 'flex';
}
function closeModal() { document.getElementById('modalBackdrop').style.display = 'none'; }
document.getElementById('modalBackdrop').addEventListener('click', (e) => { if (e.target.id === 'modalBackdrop') closeModal(); });

function noteForm(note) {
  const isEdit = !!note;
  showModal(`
    <h3>${isEdit ? 'Edit' : 'New'} Sermon Note</h3>
    <form id="noteForm">
      <div class="field"><label>Sermon Title</label><input type="text" id="nTitle" value="${escapeHtml(note?.sermonTitle || '')}"></div>
      <div class="field"><label>Preacher</label><input type="text" id="nPreacher" value="${escapeHtml(note?.preacher || '')}"></div>
      <div class="field"><label>Date</label><input type="date" id="nDate" value="${note?.date || ''}"></div>
      <div class="field"><label>Scripture</label><input type="text" id="nScripture" value="${escapeHtml(note?.scripture || '')}" placeholder="e.g. Romans 8:28"></div>
      <div class="field"><label>Notes</label><textarea id="nNotes" rows="5">${escapeHtml(note?.notes || '')}</textarea></div>
      <div class="field"><label>Summary</label><textarea id="nSummary" rows="2">${escapeHtml(note?.summary || '')}</textarea></div>
      <div class="field"><label>Key Lessons</label><textarea id="nKeyLessons" rows="2">${escapeHtml(note?.keyLessons || '')}</textarea></div>
      <div class="field"><label>Personal Reflections</label><textarea id="nReflections" rows="2">${escapeHtml(note?.reflections || '')}</textarea></div>
      <div style="display:flex; gap:10px;">
        <button type="submit" class="btn btn-primary">Save Note</button>
        <button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button>
      </div>
      <div class="form-msg" id="noteFormMsg"></div>
    </form>
  `);
  document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
  document.getElementById('noteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      sermonTitle: document.getElementById('nTitle').value,
      preacher: document.getElementById('nPreacher').value,
      date: document.getElementById('nDate').value,
      scripture: document.getElementById('nScripture').value,
      notes: document.getElementById('nNotes').value,
      summary: document.getElementById('nSummary').value,
      keyLessons: document.getElementById('nKeyLessons').value,
      reflections: document.getElementById('nReflections').value
    };
    try {
      await fetchJSON(isEdit ? `/api/member/sermon-notes/${note.id}` : '/api/member/sermon-notes', {
        method: isEdit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      closeModal();
      showToast('Sermon note saved.', 'success');
      loadNotes();
    } catch (err) {
      const msg = document.getElementById('noteFormMsg');
      msg.textContent = err.message || 'Could not save this note.';
      msg.className = 'form-msg error';
    }
  });
}

async function loadNotes() {
  const list = document.getElementById('notesList');
  try {
    NOTES = await fetchJSON('/api/member/sermon-notes');
    if (!NOTES.length) {
      list.innerHTML = '<p class="empty-state">No sermon notes yet. Add your first one above.</p>';
      return;
    }
    list.innerHTML = NOTES.map(n => `
      <div class="note-card">
        <h4>${escapeHtml(n.sermonTitle || 'Untitled sermon')}</h4>
        <div class="meta">${[n.preacher, n.date, n.scripture].filter(Boolean).map(escapeHtml).join(' · ') || 'No details added'}</div>
        ${n.summary ? `<p class="body-text">${escapeHtml(n.summary)}</p>` : ''}
        <div class="row-actions">
          <button data-edit="${n.id}">Edit</button>
          <button class="danger" data-delete="${n.id}">Delete</button>
        </div>
      </div>
    `).join('');
    list.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => noteForm(NOTES.find(n => n.id === btn.dataset.edit))));
    list.querySelectorAll('[data-delete]').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Delete this sermon note?')) return;
      await fetchJSON(`/api/member/sermon-notes/${btn.dataset.delete}`, { method: 'DELETE' });
      loadNotes();
    }));
  } catch (e) {
    list.innerHTML = '<p class="empty-state">Could not load your sermon notes.</p>';
  }
}

document.getElementById('newNoteBtn').addEventListener('click', () => noteForm(null));

(async function () {
  await initLayout('/sermon-notes.html');
  const authRes = await fetchJSON('/api/auth/me').catch(() => ({ member: null }));
  if (!authRes.member) { window.location.href = '/login.html'; return; }
  loadNotes();
})();
