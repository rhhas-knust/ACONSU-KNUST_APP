// The script of discover.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
let ALL_SERMONS = [], ALL_PAGES = [];
let SEARCH_TIMER = null;
let SEARCH_CONTROLLER = null;
let LAST_SEARCH_TOKEN = 0;
const INITIAL_QUERY = new URLSearchParams(location.search).get('q') || '';

(async function () {
  await initLayout('/discover.html');

  const [sermons, pages] = await Promise.all([
    fetchJSON('/api/sermons').catch(() => []),
    fetchJSON('/api/pages').catch(() => [])
  ]);
  ALL_SERMONS = sermons;
  ALL_PAGES = pages;

  const coreTiles = [
    { href: '/media.html', label: 'Sermons & Media', icon: ICON_HEADPHONES },
    { href: '/bible.html', label: 'Bible', icon: ICON_BIBLE },
    { href: '/content.html?kind=ebook', label: 'E-Book Library', icon: ICON_BIBLE },
    { href: '/content.html?kind=seminar', label: 'Seminars & Workshops', icon: ICON_HEADPHONES },
    { href: '/departments.html', label: 'Departments', icon: ICON_USERS },
    { href: '/alumni.html', label: 'Alumni Connect', icon: ICON_USERS },
    { href: '/meet.html', label: 'ACONSU Rooms', icon: ICON_USERS },
    { href: '/events.html', label: 'Events', icon: ICON_EVENTS }
  ];
  const pageTiles = pages.filter(p => p.showInNav).map(p => ({
    href: `/page.html?slug=${encodeURIComponent(p.slug)}`,
    label: p.navLabel || p.title,
    icon: p.type === 'gallery' ? ICON_EVENTS : p.type === 'bookshelf' ? ICON_BIBLE : ICON_MORE
  }));
  document.getElementById('discoverTiles').innerHTML = [...coreTiles, ...pageTiles].map(t => `
    <a href="${t.href}" class="discover-tile"><span class="dt-icon">${svgIcon(t.icon)}</span>${escapeHtml(t.label)}</a>
  `).join('');

  const sortedSermons = [...sermons].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 4);
  document.getElementById('sermonPreview').innerHTML = sortedSermons.map(s => `
    <a href="/media.html" class="discover-result">
      <div class="dr-type">${s.type === 'video' ? 'Video' : 'Audio'}</div>
      <strong>${escapeHtml(s.title)}</strong>
      <div style="font-size:0.85rem; color:var(--ink-soft);">${escapeHtml(s.speaker || '')}</div>
    </a>
  `).join('') || '<p class="empty-state">No sermons uploaded yet.</p>';

  const input = document.getElementById('searchInput');
  input.value = INITIAL_QUERY;
  input.addEventListener('input', (e) => scheduleSearch(e.target.value));
  if (INITIAL_QUERY.trim()) runSearch(INITIAL_QUERY.trim());
})();

function setSearchUrl(query) {
  const url = new URL(window.location.href);
  if (query) url.searchParams.set('q', query);
  else url.searchParams.delete('q');
  history.replaceState({}, '', url.pathname + (url.search || ''));
}

function setSearchState(message, showResults) {
  document.getElementById('searchStatus').textContent = message;
  document.getElementById('searchResults').style.display = showResults ? 'block' : 'none';
  document.getElementById('browseSection').style.display = showResults ? 'none' : 'block';
}

function scheduleSearch(query) {
  clearTimeout(SEARCH_TIMER);
  SEARCH_TIMER = setTimeout(() => runSearch(query), 220);
}

async function runSearch(query) {
  const q = query.trim();
  const resultsEl = document.getElementById('searchResults');
  if (!q) {
    setSearchUrl('');
    setSearchState('Type at least 2 characters to search across sermons, events, pages, and resources.', false);
    return;
  }

  if (q.length < 2) {
    setSearchUrl(q);
    setSearchState('Type at least 2 characters to start searching.', false);
    return;
  }

  setSearchUrl(q);
  setSearchState(`Searching for “${q}”…`, true);
  resultsEl.innerHTML = '<p class="empty-state">Searching…</p>';

  if (SEARCH_CONTROLLER) SEARCH_CONTROLLER.abort();
  SEARCH_CONTROLLER = new AbortController();
  const token = ++LAST_SEARCH_TOKEN;

  try {
    const payload = await fetchJSON(`/api/search?q=${encodeURIComponent(q)}`, { signal: SEARCH_CONTROLLER.signal });
    if (token !== LAST_SEARCH_TOKEN) return;
    renderSearchResults(q, payload.results || []);
  } catch (e) {
    if (e.name === 'AbortError') return;
    if (token !== LAST_SEARCH_TOKEN) return;
    resultsEl.innerHTML = `<p class="empty-state">Could not search for “${escapeHtml(q)}” right now.</p>`;
    setSearchState(`Search is temporarily unavailable for “${q}”.`, true);
  }
}

function renderSearchResults(query, results) {
  const resultsEl = document.getElementById('searchResults');
  if (!results.length) {
    resultsEl.innerHTML = `<p class="empty-state">No results found for “${escapeHtml(query)}”. Try another word or phrase.</p>`;
    setSearchState(`No results found for “${query}”.`, true);
    return;
  }

  const grouped = results.reduce((acc, item) => {
    const key = item.typeLabel || item.type || 'Result';
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  resultsEl.innerHTML = `
    <div class="discover-summary">${results.length} result${results.length === 1 ? '' : 's'} for “${escapeHtml(query)}”.</div>
    ${Object.entries(grouped).map(([label, items]) => `
      <section class="discover-group">
        <h2 style="font-size:1.2rem;">${escapeHtml(label)}${items.length > 1 ? ` <span style="color:var(--ink-faint); font-size:0.85rem; font-weight:600;">(${items.length})</span>` : ''}</h2>
        ${items.map(r => `
          <a href="${r.href}" class="discover-result">
            <div class="dr-type">${escapeHtml(r.typeLabel || r.type || 'Result')}</div>
            <strong>${escapeHtml(r.title)}</strong>
            ${r.subtitle ? `<div style="font-size:0.85rem; color:var(--ink-soft);">${escapeHtml(r.subtitle)}</div>` : ''}
            ${r.description ? `<div style="font-size:0.84rem; color:var(--ink-faint); margin-top:3px;">${escapeHtml(r.description).slice(0, 140)}</div>` : ''}
          </a>
        `).join('')}
      </section>
    `).join('')}
  `;
  setSearchState(`Showing ${results.length} result${results.length === 1 ? '' : 's'} for “${query}”.`, true);
}
