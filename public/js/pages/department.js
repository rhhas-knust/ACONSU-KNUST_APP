// The script of department.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
(async function () {
  await initLayout('/departments.html');
  const params = new URLSearchParams(window.location.search);
  const chapterId = params.get('chapterId');
  const deptId = params.get('id');
  const detailEl = document.getElementById('deptDetail');

  try {
    if (chapterId) {
      const [chapter, allDepartments, allExecs] = await Promise.all([
        fetchJSON(`/api/chapters/${chapterId}`),
        fetchJSON('/api/departments').catch(() => []),
        fetchJSON('/api/executives').catch(() => [])
      ]);
      const departments = (allDepartments || []).filter(d => d.chapterId === chapterId);
      const executives = (allExecs || []).filter(e => e.chapterId === chapterId);
      document.title = `${chapter.name} | ACONSU`;

      if (chapter.headerImageFileId) {
        document.getElementById('deptBanner').innerHTML = `
          <div class="dept-banner">
            <img src="/api/files/${chapter.headerImageFileId}" alt="${escapeHtml(chapter.name)}">
            <div class="dept-banner-overlay">
              <h1>${escapeHtml(chapter.name)}</h1>
              <p>${escapeHtml(chapter.fullName || chapter.location || '')}</p>
            </div>
          </div>
        `;
      }

      detailEl.innerHTML = `
        ${chapter.headerImageFileId ? '' : `
          <h1>${escapeHtml(chapter.name)}</h1>
          <p style="color:var(--ink-soft); font-size:1.05rem;">${escapeHtml(chapter.fullName || chapter.institution || '')}</p>`}
        <div class="card" style="margin:28px 0;">
          <h2 style="margin-bottom:16px; font-size:1.17rem;">Chapter Overview</h2>
          <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(160px,1fr));">
            <div><div class="field-label">Institution</div><p style="margin:4px 0 0; font-weight:700;">${escapeHtml(chapter.institution || 'Not specified')}</p></div>
            <div><div class="field-label">Location</div><p style="margin:4px 0 0; font-weight:700;">${escapeHtml(chapter.location || 'Not specified')}</p></div>
            <div><div class="field-label">Address</div><p style="margin:4px 0 0; font-weight:700;">${escapeHtml(chapter.address || 'Not specified')}</p></div>
          </div>
          ${mapBlockHtml({ url: chapter.mapUrl, place: chapter.mapPlace, label: chapter.location || chapter.name, fallbackQuery: chapter.address ? [chapter.location, chapter.address].filter(Boolean).join(', ') : '' })}
        </div>

        <div class="card" style="margin:28px 0;">
          <h2 style="margin-bottom:16px; font-size:1.17rem;">Departments</h2>
          ${departments.length ? `<div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(220px,1fr));">
            ${departments.map(d => `
              <a href="/department.html?id=${encodeURIComponent(d.id)}" class="card dept-card" style="padding:0; overflow:hidden;">
                <div class="dept-thumb" style="height:110px;">
                  ${d.headerImageFileId ? `<img src="/api/files/${d.headerImageFileId}" alt="${escapeHtml(d.name)}">` : '<span class="dept-thumb-fallback"></span>'}
                </div>
                <div style="padding:16px;">
                  <h3 style="margin:0 0 8px; font-size:1rem;">${escapeHtml(d.name)}</h3>
                  <p style="margin:0; color:var(--ink-soft); font-size:0.9rem;">${escapeHtml(d.tagline || '')}</p>
                </div>
              </a>
            `).join('')}</div>` : '<p class="empty-state">No departments added for this chapter yet.</p>'}
        </div>

        <div class="card" style="margin:28px 0;">
          <h2 style="margin-bottom:16px; font-size:1.17rem;">Executives</h2>
          ${executives.length ? `<div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(180px,1fr));">
            ${executives.map(e => `
              <div class="card exec-card" style="padding:18px;">
                <div class="exec-photo" style="margin-bottom:12px; width:90px; height:90px;">
                  ${e.imageFileId ? `<img src="/api/files/${e.imageFileId}" alt="${escapeHtml(e.name)}">` : `<span class="initial">${escapeHtml((e.name || '?').charAt(0))}</span>`}
                </div>
                <h3 style="margin:0; font-size:1rem;">${escapeHtml(e.name)}</h3>
                <div class="exec-role">${escapeHtml(e.role || '')}</div>
                ${e.department ? `<p style="margin:8px 0 0; color:var(--ink-soft); font-size:0.82rem; font-weight:700;">${escapeHtml(e.department)}</p>` : ''}
                ${e.contact && e.contact.phone ? `<p style="margin:8px 0 0; color:var(--ink-soft); font-size:0.82rem;"><a href="tel:${escapeHtml(e.contact.phone)}">${escapeHtml(e.contact.phone)}</a></p>` : ''}
                ${e.contact && e.contact.email ? `<p style="margin:6px 0 0; color:var(--ink-soft); font-size:0.82rem;"><a href="mailto:${escapeHtml(e.contact.email)}">${escapeHtml(e.contact.email)}</a></p>` : ''}
              </div>
            `).join('')}</div>` : '<p class="empty-state">No executive profiles for this chapter yet.</p>'}
        </div>
      `;
    } else if (deptId) {
      const dept = await fetchJSON(`/api/departments/${deptId}`);
      document.title = `${dept.name} | ACONSU`;
      if (dept.headerImageFileId) {
        document.getElementById('deptBanner').innerHTML = `
          <div class="dept-banner">
            <img src="/api/files/${dept.headerImageFileId}" alt="${escapeHtml(dept.name)}">
            <div class="dept-banner-overlay">
              <h1>${escapeHtml(dept.name)}</h1>
              <p>${escapeHtml(dept.tagline || '')}</p>
            </div>
          </div>
        `;
      }
      detailEl.innerHTML = `
        ${dept.headerImageFileId ? '' : `
          <h1>${escapeHtml(dept.name)}</h1>
          <p style="color:var(--ink-soft); font-size:1.05rem;">${escapeHtml(dept.tagline || '')}</p>`}
        <div class="card" style="margin:28px 0;">
          <h2 style="margin-bottom:16px; font-size:1.17rem;">Meeting Information</h2>
          <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(160px,1fr));">
            <div><div class="field-label">Day</div><p style="margin:4px 0 0; font-weight:700;">${escapeHtml(dept.meetingDay || 'TBA')}</p></div>
            <div><div class="field-label">Time</div><p style="margin:4px 0 0; font-weight:700;">${escapeHtml(dept.meetingTime || 'TBA')}</p></div>
            <div><div class="field-label">Location</div><p style="margin:4px 0 0; font-weight:700;">${escapeHtml(dept.meetingLocation || 'TBA')}</p></div>
            ${dept.leaderName ? `<div><div class="field-label">Leader</div><p style="margin:4px 0 0; font-weight:700;">${escapeHtml(dept.leaderName)}</p>${dept.leaderRole ? `<p class="tiny muted" style="margin:2px 0 0;">${escapeHtml(dept.leaderRole)}</p>` : ''}</div>` : ''}
          </div>
          ${dept.mapUrl ? mapBlockHtml({ url: dept.mapUrl, place: dept.mapPlace, label: dept.meetingLocation || dept.name }) : ''}
        </div>
        <p style="color:var(--ink-soft);">${escapeHtml(dept.description)}</p>
      `;
    } else {
      detailEl.innerHTML = '<h1 class="sr-only">Department</h1><p class="empty-state">No chapter or department selected.</p>';
      return;
    }

    initScrollReveal('.card, .form-card');
    try {
      const photos = await fetchJSON('/api/files?category=photo');
      const general = photos.filter(p => !p.pageSlug).slice(0, 3);
      if (general.length) {
        document.getElementById('deptDetailHero').style.overflow = 'visible';
        renderFloatingImages('deptDetailHero', general.map(p => p.id), [
          { top: '0%', right: '2%', width: '120px', height: '90px', rotate: '4deg', delay: '0s' },
          { top: '30%', right: '-2%', width: '100px', height: '130px', rotate: '-3deg', delay: '0.15s' },
          { bottom: '0%', right: '10%', width: '110px', height: '80px', rotate: '5deg', delay: '0.3s' }
        ]);
      }
    } catch (e) { /* decorative only */ }
  } catch (e) {
    detailEl.innerHTML = '<h1 class="sr-only">Department</h1><p class="empty-state">Chapter not found.</p>';
  }
})();
