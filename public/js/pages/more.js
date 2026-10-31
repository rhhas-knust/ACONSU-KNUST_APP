// The script of more.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
(async function () {
  await initLayout('/more.html');

  const [customPages, member, unread] = await Promise.all([
    fetchJSON('/api/pages').catch(() => []),
    fetchJSON('/api/auth/me').then(r => r.member).catch(() => null),
    getUnreadNotificationCount()
  ]);

  // The account strip at the top: who you are, or a nudge to sign in.
  document.getElementById('moreAccountCard').innerHTML = member ? `
    <a href="/profile.html" class="more-account-inner">
      <span class="more-avatar">${member.profileImageFileId
        ? `<img src="/api/files/${member.profileImageFileId}" alt="">`
        : escapeHtml(member.name.charAt(0).toUpperCase())}</span>
      <span class="more-account-text">
        <strong>${escapeHtml(member.name)}</strong>
        <small>${escapeHtml(member.email)}</small>
      </span>
      <span class="more-chevron">&rsaquo;</span>
    </a>
  ` : `
    <div class="more-account-inner">
      <span class="more-avatar"></span>
      <span class="more-account-text">
        <strong>You're browsing as a guest</strong>
        <small>Sign in to track your streak, save your details and get birthday wishes.</small>
      </span>
      <a href="/login.html" class="btn btn-primary btn-sm" style="flex:none;">Log In</a>
    </div>
  `;

  const custom = customPages.filter(p => p.showInNav).map(p => ({
    href: `/page.html?slug=${encodeURIComponent(p.slug)}`,
    label: p.navLabel || p.title,
    desc: p.description || (p.type === 'gallery' ? 'Photos from the family' : p.type === 'bookshelf' ? 'Books and resources' : 'Read more'),
    icon: p.type === 'gallery' ? ICON_EVENTS : p.type === 'bookshelf' ? ICON_BIBLE : ICON_MORE
  }));

  const groups = [
    {
      title: 'Stay Connected',
      links: [
        { href: '/visit.html', label: 'Plan your visit', desc: 'When we meet, where, and what to expect', icon: ICON_PIN },
        { href: '/notifications.html', label: 'Notifications', desc: 'Announcements, events and birthdays', icon: ICON_BELL, badge: unread },
        { href: '/discover.html', label: 'Discover', desc: 'Find your way around the union', icon: ICON_MORE },
        { href: '/how-to.html', label: 'How to use the app', desc: 'A short video and the steps in writing', icon: ICON_VIDEO },
        { href: '/events.html', label: 'Events', desc: "What's coming up next", icon: ICON_EVENTS }
      ]
    },
    {
      title: 'Grow',
      links: [
        { href: '/bible.html', label: 'Bible', desc: 'Read a chapter, keep your streak', icon: ICON_BIBLE },
        { href: '/bible-study.html', label: 'Bible Study', desc: 'Structured studies, linked to scripture', icon: ICON_BIBLE },
        { href: '/content.html?kind=live_service', label: 'Live Services', desc: 'Join services and streams online', icon: ICON_HEADPHONES },
        { href: '/media.html', label: 'Sermons & Media', desc: 'Catch up on the word', icon: ICON_HEADPHONES },
        { href: '/content.html?kind=ebook', label: 'E-Book Library', desc: 'Read and download approved resources', icon: ICON_BIBLE },
        { href: '/content.html?kind=seminar', label: 'Seminars', desc: 'Watch previews and full sessions', icon: ICON_HEADPHONES },
        { href: '/prayer.html', label: 'Prayer Wall', desc: 'Send a request, pray for others', icon: ICON_PRAYER }
      ]
    },
    {
      title: 'Belong',
      links: [
        { href: '/departments.html', label: 'Departments', desc: 'Find where you serve, and ask to join', icon: ICON_USERS },
        { href: '/alumni.html', label: 'Alumni Connect', desc: 'Members who have graduated, and what they do now', icon: ICON_USERS },
        { href: '/meet.html', label: 'ACONSU Rooms', desc: 'Small meetings, inside the app', icon: ICON_USERS },
        { href: '/groups.html', label: 'Groups', desc: 'Bible study, prayer, fellowship and cell groups', icon: ICON_USERS },
        { href: '/chat.html', label: 'Community', desc: 'Ask questions, share, discuss respectfully', icon: ICON_MORE },
        { href: '/about.html', label: 'About ACONSU', desc: 'Who we are and what we believe', icon: ICON_HOME },
        { href: '/content.html?kind=church_info', label: 'Our Church', desc: 'About The Apostles Continuation Church', icon: ICON_HOME },
        { href: '/content.html?kind=founder', label: 'Founders', desc: 'The people who shaped this work', icon: ICON_USERS },
        { href: '/content.html?kind=weekly_highlight', label: 'This Week at ACONSU', desc: 'Activities, outreach and moments', icon: ICON_EVENTS },
        { href: '/contact.html', label: 'Contact Us', desc: 'Reach the leadership directly', icon: ICON_MORE }
      ]
    },
    {
      title: 'Give & Care',
      links: [
        { href: '/give.html', label: 'Give', desc: 'Support your chapter. Tithes, offerings, welfare', icon: ICON_HOME },
        { href: '/welfare.html', label: 'Welfare', desc: 'Need support? Let us know, confidentially', icon: ICON_PRAYER }
      ]
    }
  ];
  if (custom.length) groups.push({ title: 'More from ACONSU', links: custom });

  document.getElementById('moreGroups').innerHTML = groups.map(g => `
    <div class="more-group">
      <p class="meta">${escapeHtml(g.title)}</p>
      <div class="more-tile-grid">
        ${g.links.map(l => `
          <a href="${l.href}" class="more-tile">
            <span class="more-tile-icon">${svgIcon(l.icon)}</span>
            <span class="more-tile-text">
              <strong>${escapeHtml(l.label)}${l.badge ? `<span class="more-tile-badge">${l.badge > 9 ? '9+' : l.badge}</span>` : ''}</strong>
              <small>${escapeHtml(l.desc)}</small>
            </span>
            <span class="more-chevron">&rsaquo;</span>
          </a>
        `).join('')}
      </div>
    </div>
  `).join('') + `
    <div class="more-group">
      <div class="more-tile-grid">
        ${member ? `
          <a href="/profile.html" class="more-tile">
            <span class="more-tile-icon">${svgIcon(ICON_USERS)}</span>
            <span class="more-tile-text"><strong>My Profile</strong><small>Details, badges and alert settings</small></span>
            <span class="more-chevron">&rsaquo;</span>
          </a>
          <a href="/card.html" class="more-tile">
            <span class="more-tile-icon">${svgIcon(ICON_USERS)}</span>
            <span class="more-tile-text"><strong>Membership Card</strong><small>Your digital ACONSU ID + QR code</small></span>
            <span class="more-chevron">&rsaquo;</span>
          </a>
          <a href="/sermon-notes.html" class="more-tile">
            <span class="more-tile-icon">${svgIcon(ICON_HEADPHONES)}</span>
            <span class="more-tile-text"><strong>Sermon Notes</strong><small>Private notes only you can see</small></span>
            <span class="more-chevron">&rsaquo;</span>
          </a>
          <button type="button" class="more-tile" id="moreLogoutBtn" style="text-align:left; border:none; font-family:inherit;">
            <span class="more-tile-icon">${svgIcon(ICON_MORE)}</span>
            <span class="more-tile-text"><strong>Log Out</strong><small>Sign out of this device</small></span>
            <span class="more-chevron">&rsaquo;</span>
          </button>
        ` : `
          <a href="/login.html" class="more-tile">
            <span class="more-tile-icon">${svgIcon(ICON_USERS)}</span>
            <span class="more-tile-text"><strong>Log In</strong><small>Access your ACONSU account</small></span>
            <span class="more-chevron">&rsaquo;</span>
          </a>
          <a href="/register.html" class="more-tile">
            <span class="more-tile-icon">${svgIcon(ICON_MORE)}</span>
            <span class="more-tile-text"><strong>Create an Account</strong><small>Join the union on the app</small></span>
            <span class="more-chevron">&rsaquo;</span>
          </a>
        `}
      </div>
    </div>
  `;

  const logoutBtn = document.getElementById('moreLogoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await fetchJSON('/api/auth/logout', { method: 'POST' }).catch(() => {});
      await clearCachedAccountData();
      window.location.href = '/index.html';
    });
  }

  initScrollReveal('.more-tile');
})();
