// The script of about.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
(async function () {
  const settings = await initLayout('/about.html');
  const about = settings.about || {};
  const chapterName = settings.chapterName || settings.fellowshipName || 'ACONSU';
  const socialEl = document.getElementById('aboutSocialRow');
  if (socialEl) {
    socialEl.innerHTML = socialLinksHtml(settings);
    socialEl.querySelectorAll('.social-icon-link').forEach(a => a.classList.add('on-light'));
  }
  if (settings.fullName || settings.chapterName) {
    document.getElementById('aboutTitle').textContent = `About ${chapterName}`;
  }
  if (settings.tagline) {
    document.getElementById('aboutLede').textContent = settings.tagline;
  }
  if (about.history) {
    document.getElementById('aboutHistory').textContent = about.history;
  }
  if (about.mission) {
    document.getElementById('aboutMission').textContent = about.mission;
  }
  if (about.vision) {
    document.getElementById('aboutVision').textContent = about.vision;
  }
  if (about.values) {
    document.getElementById('aboutValues').textContent = about.values;
  }
  if (about.leadership) {
    document.getElementById('leadershipBlurb').textContent = about.leadership;
  } else if (settings.chapterName) {
    document.getElementById('leadershipBlurb').textContent = `The team serving and leading ${chapterName} this session.`;
  }

  try {
    const leaders = await fetchJSON('/api/public/leadership');
    const wrap = document.getElementById('execGrid');
    if (!leaders.length) {
      wrap.innerHTML = '<p class="empty-state">Leadership profiles coming soon.</p>';
    } else {
      wrap.innerHTML = leaders.map((person) => `
        <div class="card exec-card">
          <div class="exec-photo">
            ${person.imageFileId ? `<img src="/api/files/${person.imageFileId}" alt="${escapeHtml(person.name)}">` : `<span class="initial">${escapeHtml((person.name || '?').charAt(0))}</span>`}
          </div>
          <h3 style="margin-bottom:2px;">${escapeHtml(person.name)}</h3>
          <div class="exec-role">${escapeHtml(person.role || '')}</div>
          ${person.chapterName ? `<p style="margin:8px 0 0; color:var(--ink-soft); font-size:0.82rem; font-weight:700;">${escapeHtml(person.chapterName)}</p>` : ''}
          ${person.phone ? `<p style="margin:8px 0 0; color:var(--ink-soft); font-size:0.82rem;"><a href="tel:${escapeHtml(person.phone)}">${escapeHtml(person.phone)}</a></p>` : ''}
          ${person.email ? `<p style="margin:6px 0 0; color:var(--ink-soft); font-size:0.82rem;"><a href="mailto:${escapeHtml(person.email)}">${escapeHtml(person.email)}</a></p>` : ''}
        </div>
      `).join('');
    }
    initScrollReveal('#execGrid .card');
    const withPhotos = leaders.filter(person => person.imageFileId).map(person => person.imageFileId);
    if (withPhotos.length) {
      document.getElementById('aboutHero').style.overflow = 'visible';
      renderFloatingImages('aboutHero', withPhotos.slice(0, 2));
    }
  } catch (e) {
    document.getElementById('execGrid').innerHTML = '<p class="empty-state">Could not load leadership right now.</p>';
  }

  // ---- the wider church, and the men who began it ------------------------
  // Read from a national endpoint, not a chapter one: every chapter shows the
  // same men. The whole section stays hidden until there is something real to
  // put in it, so a chapter never displays an empty frame or a bare heading.
  try {
    const church = await fetchJSON('/api/public/church');
    const founders = (church.founders || []).filter(f => f && f.name);
    if (church.logoFileId || founders.length) {
      if (church.logoFileId) {
        const logo = document.getElementById('churchLogo');
        logo.src = `/api/files/${church.logoFileId}`;
        logo.alt = church.name || '';
        logo.hidden = false;
      }
      if (church.name) document.getElementById('churchName').textContent = church.name;
      const blurbEl = document.getElementById('churchBlurb');
      if (church.blurb) blurbEl.textContent = church.blurb; else blurbEl.remove();

      if (founders.length) {
        document.getElementById('foundersGrid').innerHTML = founders.map((man) => `
          <div class="card founder-card">
            ${man.imageFileId
              ? `<img class="founder-face" src="/api/files/${man.imageFileId}" alt="${escapeHtml(man.name)}" loading="lazy">`
              : `<span class="founder-face is-initials">${escapeHtml(initialsOf(man.name))}</span>`}
            <h3 style="margin:0 0 2px;">${escapeHtml(man.name)}</h3>
            ${man.role ? `<div class="exec-role">${escapeHtml(man.role)}</div>` : ''}
            ${man.about ? `<p style="margin:10px 0 0; color:var(--ink-soft); font-size:0.9rem;">${escapeHtml(man.about)}</p>` : ''}
            ${man.inMemoriam ? '<p class="founder-memoriam">In loving memory</p>' : ''}
          </div>
        `).join('');
        document.getElementById('foundersHeading').hidden = false;
      }
      document.getElementById('churchSection').hidden = false;
      initScrollReveal('#foundersGrid .card');
    }
  } catch (e) {
    // The church block is additional to this page, not the point of it. If it
    // cannot be loaded the rest of About still stands, so this stays quiet
    // rather than showing an error for something the reader did not ask for.
  }
})();
