// The script of page.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
(async function () {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('slug');
  await initLayout(`/page.html?slug=${slug}`);

  const bodyEl = document.getElementById('pageBody');

  if (!slug) {
    document.getElementById('pageTitle').textContent = 'Page not found';
    bodyEl.innerHTML = '<p class="empty-state">No page specified.</p>';
    return;
  }

  try {
    const page = await fetchJSON(`/api/pages/${encodeURIComponent(slug)}`);
    document.title = `${page.title} | ACONSU`;
    (document.getElementById('pageEyebrow') || {}).textContent =
      page.type === 'gallery' ? 'Photo Gallery' : page.type === 'bookshelf' ? 'E-Library' : 'Page';
    document.getElementById('pageTitle').textContent = page.title;
    document.getElementById('pageDescription').textContent = page.description || '';

    if (page.type === 'gallery') {
      await renderGallery(slug, bodyEl);
    } else if (page.type === 'bookshelf') {
      await renderBookshelf(slug, bodyEl);
    } else {
      bodyEl.innerHTML = `<div style="max-width:760px; margin:0 auto; color:var(--ink-soft);">${
        (page.content || '').split('\n\n').map(p => `<p>${escapeHtml(p)}</p>`).join('')
      }</div>`;
    }
  } catch (e) {
    document.getElementById('pageTitle').textContent = 'Page not found';
    bodyEl.innerHTML = '<p class="empty-state">This page doesn\'t exist or was removed.</p>';
  }
})();

async function renderGallery(slug, bodyEl) {
  try {
    const files = await fetchJSON(`/api/files?category=photo&pageSlug=${encodeURIComponent(slug)}`);
    if (!files.length) {
      bodyEl.innerHTML = '<p class="empty-state">No photos uploaded yet. Check back soon.</p>';
      return;
    }
    bodyEl.innerHTML = `<div class="gallery-grid">${files.map(f => `
      <div class="gallery-item" data-src="/api/files/${f.id}" data-title="${escapeHtml(f.title)}">
        <img src="/api/files/${f.id}" alt="${escapeHtml(f.title)}" loading="lazy">
      </div>
    `).join('')}</div>`;

    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightboxImg');
    bodyEl.querySelectorAll('.gallery-item').forEach(item => {
      item.addEventListener('click', () => {
        lightboxImg.src = item.dataset.src;
        lightboxImg.alt = item.dataset.title;
        lightbox.classList.add('open');
      });
    });
    document.getElementById('lightboxClose').addEventListener('click', () => lightbox.classList.remove('open'));
    lightbox.addEventListener('click', (e) => { if (e.target === lightbox) lightbox.classList.remove('open'); });
  } catch (e) {
    bodyEl.innerHTML = '<p class="empty-state">Could not load photos right now.</p>';
  }
}

async function renderBookshelf(slug, bodyEl) {
  try {
    const files = await fetchJSON(`/api/files?category=book&pageSlug=${encodeURIComponent(slug)}`);
    if (!files.length) {
      bodyEl.innerHTML = '<p class="empty-state">No resources uploaded yet. Check back soon.</p>';
      return;
    }
    bodyEl.innerHTML = `<div class="grid">${files.map(f => `
      <div class="card book-card">
        <div class="book-icon">${(f.contentType || '').includes('pdf') ? 'PDF' : 'FILE'}</div>
        <h3 style="margin-bottom:2px;">${escapeHtml(f.title)}</h3>
        <p style="color:var(--ink-soft); font-size:0.9rem;">${escapeHtml(f.description || '')}</p>
        <div class="book-meta">${formatFileSize(f.length)}</div>
        <a href="/api/files/${f.id}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">Open / Download</a>
      </div>
    `).join('')}</div>`;
  } catch (e) {
    bodyEl.innerHTML = '<p class="empty-state">Could not load resources right now.</p>';
  }
}
