// The script of media.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
const mediaParams = new URLSearchParams(location.search);
const selectedSermonId = mediaParams.get('sermon') || '';
const searchQuery = mediaParams.get('q') || '';

(async function () {
  await initLayout('/media.html');
  try {
    const sermons = await fetchJSON('/api/sermons');
    const sorted = [...sermons].sort((a, b) => {
      if (a.id === selectedSermonId) return -1;
      if (b.id === selectedSermonId) return 1;
      return new Date(b.date) - new Date(a.date);
    });
    if (selectedSermonId || searchQuery) {
      document.getElementById('searchContext').innerHTML = `
        <div class="search-context">
          ${selectedSermonId ? 'Showing your selected sermon result.' : 'Showing sermon results.'}
          ${searchQuery ? ` Search: <strong>${escapeHtml(searchQuery)}</strong>.` : ''}
        </div>
      `;
    }
    const wrap = document.getElementById('sermonList');
    wrap.innerHTML = sorted.map(s => `
      <div class="card ${s.id === selectedSermonId ? 'search-focus-card' : ''}" data-sermon-id="${escapeHtml(s.id)}">
        <span class="badge">${s.type === 'video' ? 'Video' : 'Audio'}</span>
        <h3 style="margin:12px 0 4px;">${escapeHtml(s.title)}</h3>
        <p style="font-size:0.88rem; color:var(--ink-soft); margin-bottom:8px;">${escapeHtml(s.speaker || '')} ${s.date ? '· ' + formatDate(s.date) : ''}</p>
        <p style="color:var(--ink-soft); margin-bottom:12px;">${escapeHtml(s.description || '')}</p>
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
          ${s.url ? `<a href="${s.url}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">Listen / Watch</a>` : '<span style="font-size:0.85rem; color:var(--ink-faint);">Link coming soon</span>'}
          ${AconsuShare.button({ kind: 'sermon', title: s.title, text: `${s.title}${s.speaker ? `, ${s.speaker}` : ''}. Worth hearing.`, path: `/media.html?sermon=${encodeURIComponent(s.id)}` })}
        </div>
      </div>
    `).join('') || '<p class="empty-state">No sermons uploaded yet. Check back soon.</p>';
    if (selectedSermonId) {
      const selectedCard = wrap.querySelector(`[data-sermon-id="${CSS.escape(selectedSermonId)}"]`);
      if (selectedCard) selectedCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (e) {
    document.getElementById('sermonList').innerHTML = '<p class="empty-state">Could not load sermons right now.</p>';
  }
})();
