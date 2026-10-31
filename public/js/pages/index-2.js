// The script of index.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
(async function () {
  const settings = await initLayout('/index.html');

  // Merge header image into hero section as background with low contrast overlay
  const heroBackgroundEl = document.getElementById('heroBackgroundImage');
  // Artwork uploaded for the home page's hero is the more deliberate choice of
  // the two, so it wins; the weekly banner still works for a chapter that has
  // not set one.
  const homeHeaderId = settings.homeHeaderImageFileId || '';
  if (homeHeaderId && !((settings.heroArt || {}).home || {}).fileId) {
    heroBackgroundEl.style.backgroundImage = `url('/api/files/${homeHeaderId}')`;
  }
  if (settings.verseOfTheWeek) {
    const verseStripEl = document.getElementById('verseStrip');
    if (verseStripEl) verseStripEl.textContent = settings.verseOfTheWeek;
  }
  if (settings.tagline) {
    const ledeEl = document.querySelector('#homeHero .lede');
    if (ledeEl && settings.tagline.trim()) ledeEl.textContent = settings.tagline;
  }
  // Join us: the chapter's meeting times and place, in the hero itself, so a
  // newcomer sees when and where before anything else. Left out entirely when
  // the chapter has not said.
  {
    const times = (settings.serviceTimes || []).filter(Boolean);
    const place = (settings.meetingPlace || settings.address || '').trim();
    const card = document.getElementById('joinUsCard');
    if (card && (times.length || place)) {
      card.innerHTML = `
        <div class="join-card">
          <p class="join-eyebrow">Join us</p>
          ${times.length ? `<ul class="join-times">${times.slice(0, 3).map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : ''}
          ${place ? `<p class="join-place">${svgIcon(ICON_PIN)}<span>${escapeHtml(place)}</span></p>` : ''}
          <div class="join-links">
            ${safeMapUrl(settings.mapUrl) ? `<a class="join-link" href="${escapeHtml(safeMapUrl(settings.mapUrl))}" target="_blank" rel="noopener noreferrer">Open in Maps</a>` : ''}
            <a class="join-link" href="/visit.html">${safeMapUrl(settings.mapUrl) ? 'What to expect' : 'Directions and what to expect'}</a>
          </div>
        </div>`;
    }
  }

  // Hide the separate banner since it's now merged into hero
  const homeHeaderEl = document.getElementById('homeHeaderBanner');
  if (homeHeaderEl) homeHeaderEl.style.display = 'none';

  // Add social icons prominently to the hero section
  const heroSocialEl = document.getElementById('heroSocialIcons');
  if (heroSocialEl && settings) {
    const socialHtml = socialLinksHtml(settings);
    heroSocialEl.innerHTML = socialHtml ? `<div class="social-row" style="justify-content:center;">${socialHtml}</div>` : '';
    heroSocialEl.querySelectorAll('.social-icon-link').forEach(a => a.classList.add('on-light'));
  }

  // 1. Live stream broadcast alert
  try {
    const liveItems = await fetchJSON('/api/content/live_service').catch(() => []);
    const activeStream = liveItems.find(i => i.isLive || i.featured) || liveItems[0];
    if (activeStream) {
      document.getElementById('liveBannerWrap').innerHTML = `
        <div class="live-stream-banner">
          <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
            <span class="live-pill"><span class="live-dot"></span>LIVE SERVICE</span>
            <strong style="font-size:0.96rem;">${escapeHtml(activeStream.title)}</strong>
          </div>
          <a href="/content.html?kind=live_service" class="btn btn-sm" style="background:#fff; color:#C0392B; font-weight:800; border:none; text-decoration:none; padding:6px 14px; border-radius:6px; white-space:nowrap;">Watch Stream &rarr;</a>
        </div>
      `;
    }
  } catch (e) { /* non-critical */ }

  // 2. Greeting bar & member streak
  let member = null;
  try {
    const authRes = await fetchJSON('/api/auth/me');
    member = authRes.member;
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const firstName = member ? member.name.split(' ')[0] : '';
    const unread = await getUnreadNotificationCount();

    let streakHtml = '';
    if (member) {
      try {
        const badgeData = await fetchJSON('/api/member/badges');
        if (badgeData.currentStreak > 0) {
          streakHtml = `<span class="streak-pill">${badgeData.currentStreak}-day streak</span>`;
        }
      } catch (e) { /* non-critical */ }
    }

    document.getElementById('greetingBar').innerHTML = `
      <h2 style="margin-bottom:0;">${greeting}${firstName ? ', ' + escapeHtml(firstName) : ''}</h2>
      <div class="greeting-icons">
        ${streakHtml}
        <a href="/notifications.html" class="bell-link" style="position:relative; color:var(--brand);" aria-label="Notifications">
          ${svgIcon(ICON_BELL)}
          ${unread > 0 ? `<span style="position:absolute; top:-3px; right:-3px; width:9px; height:9px; border-radius:50%; background:var(--flame-red); border:2px solid var(--paper);"></span>` : ''}
        </a>
      </div>
    `;
  } catch (e) { /* non-critical */ }

  // 3. Birthday Celebrations
  try {
    const celebrants = await fetchJSON('/api/birthdays/today');
    if (celebrants.length) {
      document.getElementById('birthdayBanner').innerHTML = `
        <div class="birthday-banner">
          <div>
            <strong style="display:block; margin-bottom:6px;">Happy Birthday!</strong>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              ${celebrants.map(c => `
                <span class="bday-pill">
                  <span class="avatar">${c.profileImageFileId ? `<img src="/api/files/${c.profileImageFileId}" alt="">` : ''}</span>
                  ${escapeHtml(c.displayName)}
                </span>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    }
  } catch (e) { /* non-critical */ }

  // 4. Verse of the Day Share button
  document.getElementById('shareVerseBtn').addEventListener('click', async () => {
    const verseText = document.getElementById('verseStrip').textContent;
    
    // Show a small menu with share options
    const menu = document.createElement('div');
    menu.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
      z-index: 9999;
      padding: 12px 0;
      min-width: 200px;
    `;
    
    menu.innerHTML = `
      <button style="width:100%; padding:12px 16px; text-align:left; border:none; background:none; cursor:pointer; font-size:1rem; transition:background 0.2s;" class="share-menu-btn">Share as Text</button>
      <button style="width:100%; padding:12px 16px; text-align:left; border:none; background:none; cursor:pointer; font-size:1rem; transition:background 0.2s;" class="share-menu-btn">Share as Image</button>
    `;
    
    document.body.appendChild(menu);
    
    // Add hover effect
    menu.querySelectorAll('.share-menu-btn').forEach(btn => {
      btn.addEventListener('mouseenter', () => btn.style.background = '#f5f5f5');
      btn.addEventListener('mouseleave', () => btn.style.background = 'none');
    });
    
    // Share as text
    menu.querySelector('.share-menu-btn:nth-child(1)').addEventListener('click', () => {
      AconsuShare.share({ kind: 'verse', title: 'Verse of the Day | ACONSU', text: `${verseText}\n\nRead more on the ACONSU App`, path: '/bible.html' });
      menu.remove();
    });
    
    // Download as image
    menu.querySelector('.share-menu-btn:nth-child(2)').addEventListener('click', async () => {
      menu.remove();
      const strip = document.getElementById('verseStrip');
      await shareVerseCard({
        text: strip.dataset.text || verseText,
        reference: strip.dataset.reference || '',
        filename: 'verse-of-the-day'
      });
    });
    
    // Close menu on outside click
    const closeHandler = (e) => {
      if (!menu.contains(e.target) && e.target.id !== 'shareVerseBtn') {
        menu.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  });

  // 5. Quick Access Tiles (connected to all Union services)
  try {
    const [customPages, unreadCount] = await Promise.all([
      fetchJSON('/api/pages').catch(() => []),
      getUnreadNotificationCount()
    ]);
    // Six, not eleven. Bible, Events and Prayer are already one tap away in the
    // bottom bar and Notifications has the bell, so repeating them here only
    // made the choice slower. Everything else is still under More.
    void unreadCount;
    const coreTiles = [
      { href: '/content.html?kind=live_service', label: 'Watch Live', icon: ICON_VIDEO },
      { href: '/media.html', label: 'Sermons', icon: ICON_HEADPHONES },
      { href: '/bible-study.html', label: 'Bible Study', icon: ICON_BOOK },
      { href: '/groups.html', label: 'Groups', icon: ICON_USERS },
      { href: '/give.html', label: 'Give', icon: ICON_GIVE },
      member
        ? { href: '/card.html', label: 'My Card', icon: ICON_CARD }
        : { href: '/visit.html', label: 'Plan a Visit', icon: ICON_PIN }
    ];

    const customTiles = customPages.filter(p => p.showInNav).map(p => ({
      href: `/page.html?slug=${encodeURIComponent(p.slug)}`,
      label: p.navLabel || p.title,
      icon: p.type === 'gallery' ? ICON_EVENTS : p.type === 'bookshelf' ? ICON_BIBLE : ICON_MORE
    }));
    const allTiles = [...coreTiles, ...customTiles];

    document.getElementById('dashboardTiles').innerHTML = allTiles.map(t => `
      <a href="${t.href}" class="tile">
        ${t.badge ? `<span class="tile-badge">${t.badge > 9 ? '9+' : t.badge}</span>` : ''}
        <div class="tile-icon">${svgIcon(t.icon)}</div>
        <span class="tile-label">${escapeHtml(t.label)}</span>
      </a>
    `).join('');
  } catch (e) { /* non-critical */ }

  // 6. Weekly Highlights (Moments)
  try {
    const highlights = await fetchJSON('/api/content/weekly_highlight').catch(() => []);
    if (highlights.length) {
      document.getElementById('highlightsSection').style.display = 'block';
      document.getElementById('highlightsStrip').innerHTML = highlights.map(h => `
        <a href="/content.html?kind=weekly_highlight" class="highlight-card">
          <div class="highlight-thumb">
            ${h.coverImageFileId
              ? `<img src="/api/files/${h.coverImageFileId}" alt="${escapeHtml(h.title)}" loading="lazy">`
              : '<span class="dept-thumb-fallback"></span>'}
          </div>
          <div class="highlight-body">
            <h4 style="margin:0 0 4px; font-size:0.95rem; color:var(--brand);">${escapeHtml(h.title)}</h4>
            <p style="margin:0; font-size:0.84rem; color:#6b527b; line-height:1.4;">${escapeHtml(h.summary || '')}</p>
          </div>
        </a>
      `).join('');
    }
  } catch (e) { /* non-critical */ }

  // 7. Departments, Upcoming Events & Flyers
  try {
    const [departments, events, groups] = await Promise.all([
      fetchJSON('/api/departments').catch(() => []),
      fetchJSON('/api/events').catch(() => []),
      fetchJSON('/api/groups').catch(() => [])
    ]);

    // Departments preview (first 4)
    const deptWrap = document.getElementById('deptPreview');
    deptWrap.innerHTML = departments.slice(0, 4).map(d => `
      <a href="/department.html?id=${d.id}" class="card dept-card${d.headerImageFileId ? '' : ' no-photo'}">
        ${d.headerImageFileId
          ? `<div class="dept-thumb"><img src="/api/files/${d.headerImageFileId}" alt="" loading="lazy"></div>`
          : `<span class="dept-monogram" aria-hidden="true">${escapeHtml(String(d.name || '?').trim().charAt(0).toUpperCase())}</span>`}
        <h3>${escapeHtml(d.name)}</h3>
        <p style="color:var(--ink-soft); font-size:0.92rem;">${escapeHtml(d.tagline)}</p>
        <div class="dept-meta">${escapeHtml(d.meetingDay)} · ${escapeHtml(d.meetingTime)}</div>
      </a>
    `).join('') || '<p class="empty-state">Departments coming soon.</p>';

    // Events preview (next 3 upcoming)
    const now = new Date();
    const upcoming = events
      .filter(e => new Date(`${e.date}T${e.time || '00:00'}:00`) >= now)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 3);
    const eventWrap = document.getElementById('eventPreview');
    eventWrap.innerHTML = upcoming.map(e => {
      const d = new Date(`${e.date}T00:00:00`);
      return `
      <div class="card event-card">
        <div class="event-date-badge">
          <div class="day">${d.getDate()}</div>
          <div class="mon">${d.toLocaleDateString('en-US', { month: 'short' })}</div>
        </div>
        <div>
          <h3 style="margin-bottom:4px;">${escapeHtml(e.title)}</h3>
          <p style="font-size:0.88rem; color:var(--ink-soft); margin-bottom:4px;">${escapeHtml(e.location)}</p>
          <span class="badge">${e.time}</span>
        </div>
      </div>`;
    }).join('') || '<p class="empty-state">No upcoming events yet. Check back soon.</p>';

    // Event Flyers Strip
    const flyerEvents = upcoming.filter(e => e.flyerFileId);
    if (flyerEvents.length) {
      document.getElementById('flyerSection').style.display = 'block';
      document.getElementById('flyerStrip').innerHTML = flyerEvents.map(e => `
        <a href="/events.html" style="flex:none; width:220px; display:block; text-decoration:none;">
          <img src="/api/files/${e.flyerFileId}" alt="${escapeHtml(e.title)}" loading="lazy" style="width:100%; height:280px; object-fit:cover; border-radius:14px; box-shadow:0 12px 28px rgba(0,0,0,0.18);">
          <p style="margin-top:8px; font-weight:700; font-size:0.88rem; color:var(--brand);">${escapeHtml(e.title)}</p>
        </a>
      `).join('');
    }

    // Small Groups Preview (first 3)
    if (groups.length) {
      document.getElementById('groupsSection').style.display = 'block';
      document.getElementById('groupsPreview').innerHTML = groups.slice(0, 3).map(g => `
        <a href="/group.html?id=${g.id}" class="card" style="text-decoration:none; color:inherit;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
            <h3 style="margin:0; font-size:1.1rem; color:var(--brand);">${escapeHtml(g.name)}</h3>
            <span class="badge" style="background:var(--lilac-light); color:var(--brand);">${escapeHtml(g.type || 'Fellowship')}</span>
          </div>
          <p style="color:var(--ink-soft); font-size:0.9rem; margin-bottom:12px;">${escapeHtml(g.description || 'Join this group for fellowship and spiritual growth.')}</p>
          <div style="font-size:0.82rem; color:var(--ink-faint); display:flex; gap:12px; flex-wrap:wrap;">
            ${g.meetingDay ? `<span>${escapeHtml(g.meetingDay)}</span>` : ''}
            ${g.meetingTime ? `<span>${escapeHtml(g.meetingTime)}</span>` : ''}
            <span>${g.memberCount || 0} members</span>
          </div>
        </a>
      `).join('');
    }

    // Countdown to next gathering
    const next = nextUpcomingEvent(events);
    const wrap = document.getElementById('countdownWrap');
    if (next) {
      wrap.innerHTML = `
        <div class="countdown" id="countdown">
          <div class="countdown-unit"><div class="countdown-num" data-d>00</div><div class="countdown-label">Days</div></div>
          <div class="countdown-unit"><div class="countdown-num" data-h>00</div><div class="countdown-label">Hrs</div></div>
          <div class="countdown-unit"><div class="countdown-num" data-m>00</div><div class="countdown-label">Min</div></div>
          <div class="countdown-unit"><div class="countdown-num" data-s>00</div><div class="countdown-label">Sec</div></div>
        </div>
        <div class="countdown-caption">Until ${escapeHtml(next.title)}</div>
      `;
      startCountdown(next.date, next.time, 'countdown');
    }
  } catch (e) {
    console.error(e);
  }

  initScrollReveal('.card, .tile, .highlight-card');

  // This month's theme, and this week's celebrated alumnus. Both are public
  // and both are optional: a failure or an empty answer leaves the page as it was.
  try {
    const t = await fetch('/api/public/theme').then(r => r.ok ? r.json() : null);
    const theme = t && t.theme;
    if (theme && theme.title) {
      const [y, m] = String(theme.month).split('-').map(Number);
      document.getElementById('themeMonth').textContent =
        new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) + ' · Our theme';
      document.getElementById('themeTitle').textContent = theme.title;
      const sc = document.getElementById('themeScripture');
      if (theme.scripture) sc.textContent = theme.scripture; else sc.remove();
      const bl = document.getElementById('themeBlurb');
      if (theme.blurb) bl.textContent = theme.blurb; else bl.remove();
      const fl = document.getElementById('themeFlyers');
      if (theme.flyerFileIds.length) {
        fl.innerHTML = theme.flyerFileIds.map(id =>
          `<a href="/api/files/${encodeURIComponent(id)}" target="_blank" rel="noopener"><img src="/api/files/${encodeURIComponent(id)}" alt="Flyer for the theme ${escapeHtml(theme.title)}" loading="lazy"></a>`
        ).join('');
      } else fl.remove();

      // The month's daily meditative prayer: typed words to read, and the flyer it was designed as.
      const prayerFlyers = theme.prayerFlyerFileIds || [];
      if (theme.prayer || prayerFlyers.length) {
        const note = document.getElementById('prayerNote');
        if (theme.prayerNote) note.textContent = theme.prayerNote; else note.remove();
        const det = document.getElementById('prayerDetails');
        if (theme.prayer) {
          document.getElementById('prayerText').innerHTML = theme.prayer.split(/\n{2,}/)
            .map(par => '<p>' + escapeHtml(par).replace(/\n/g, '<br>') + '</p>').join('');
        } else det.remove();
        const pf = document.getElementById('prayerFlyers');
        if (prayerFlyers.length) {
          pf.innerHTML = prayerFlyers.map(id =>
            `<a href="/api/files/${encodeURIComponent(id)}" target="_blank" rel="noopener"><img src="/api/files/${encodeURIComponent(id)}" alt="Daily meditative prayer flyer for ${escapeHtml(theme.title)}" loading="lazy"></a>`
          ).join('');
        } else pf.remove();
        document.getElementById('themePrayer').hidden = false;
      }
      document.getElementById('themeSection').style.display = 'block';
    }
  } catch (e) { /* non-critical */ }

  try {
    const sp = await fetch('/api/public/alumni/spotlight').then(r => r.ok ? r.json() : null);
    const a = sp && sp.alumnus;
    if (a) {
      document.getElementById('atPhoto').innerHTML = a.imageFileId
        ? `<img src="/api/files/${encodeURIComponent(a.imageFileId)}" alt="" loading="lazy">`
        : escapeHtml((a.name || '?').charAt(0));
      document.getElementById('atName').textContent = a.name;
      const w = document.getElementById('atWork');
      if (a.currentWork) w.textContent = a.currentWork; else w.remove();
      document.getElementById('alumniTeaser').style.display = 'block';
    }
  } catch (e) { /* non-critical */ }

  // Floating background photos
  try {
    const photos = await fetchJSON('/api/files?category=photo');
    const general = photos.filter(p => !p.pageSlug).slice(0, 4);
    if (general.length) {
      document.getElementById('homeHero').style.overflow = 'visible';
      renderFloatingImages('homeHero', general.map(p => p.id));
    }
  } catch (e) { /* non-critical */ }
})();
