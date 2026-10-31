// The script of bible-study.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
let STUDIES = [];

function scriptureLinkHref(ref) {
  if (!ref) return '/bible.html';
  const m = String(ref).match(/^(\d?\s?[A-Za-z]+(?:\s[A-Za-z]+)?)\s+(\d+)/);
  if (!m) return '/bible.html';
  return `/bible.html?book=${encodeURIComponent(m[1].trim())}&chapter=${m[2]}`;
}

function renderList() {
  const el = document.getElementById('studyList');
  if (!STUDIES.length) {
    el.innerHTML = '<p class="empty-state">No Bible studies posted yet. Check back soon.</p>';
    return;
  }
  el.innerHTML = STUDIES.map(s => `
    <div class="study-card" data-id="${s.id}">
      <h3>${escapeHtml(s.topic)}</h3>
      <div class="meta">${[s.date, s.scriptureReference].filter(Boolean).map(escapeHtml).join(' · ') || 'ACONSU Bible Study'}</div>
      <p style="color:var(--ink-soft); font-size:0.9rem;">${escapeHtml((s.studyMaterial || '').slice(0, 140))}${(s.studyMaterial || '').length > 140 ? '…' : ''}</p>
    </div>
  `).join('');
  el.querySelectorAll('[data-id]').forEach(card => card.addEventListener('click', () => showDetail(card.dataset.id)));
}

function showDetail(id) {
  const s = STUDIES.find(x => x.id === id);
  if (!s) return;
  document.getElementById('studyListView').style.display = 'none';
  document.getElementById('studyDetailView').style.display = 'block';
  document.getElementById('studyDetail').innerHTML = `
    <div class="study-detail">
      <p class="meta">${escapeHtml(s.date || '')}</p>
      <h2>${escapeHtml(s.topic)}</h2>
      ${s.scriptureReference ? `<a class="scripture-link" href="${scriptureLinkHref(s.scriptureReference)}">Read ${escapeHtml(s.scriptureReference)}</a>` : ''}
      ${s.studyMaterial ? `<h4>Study Material</h4><p style="white-space:pre-wrap; line-height:1.6;">${escapeHtml(s.studyMaterial)}</p>` : ''}
      ${(s.questions || []).length ? `<h4>Questions for Reflection</h4><ul>${s.questions.map(q => `<li>${escapeHtml(q)}</li>`).join('')}</ul>` : ''}
      ${s.notes ? `<h4>Notes</h4><p style="white-space:pre-wrap; line-height:1.6;">${escapeHtml(s.notes)}</p>` : ''}
      ${(s.resources || []).length ? `<h4>Additional Resources</h4><ul>${s.resources.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : ''}
    </div>
  `;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.getElementById('backToListBtn').addEventListener('click', () => {
  document.getElementById('studyDetailView').style.display = 'none';
  document.getElementById('studyListView').style.display = 'block';
});

(async function () {
  await initLayout('/bible-study.html');
  try {
    STUDIES = await fetchJSON('/api/bible-studies');
    renderList();
  } catch (e) {
    document.getElementById('studyList').innerHTML = '<p class="empty-state">Could not load Bible studies right now.</p>';
  }
})();
