// The script of notifications.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
(async function () {
  await initLayout('/notifications.html');
  markNotificationsSeen();

  try {
    const items = await fetchNotificationsShared();
    const wrap = document.getElementById('notifList');
    if (!items.length) {
      wrap.innerHTML = '<p class="empty-state">No notifications yet. Check back soon.</p>';
    } else {
      wrap.innerHTML = `<div class="card" style="padding:8px 20px;">${items.map(n => `
        <a href="${n.url || '/index.html'}" class="notif-item" style="text-decoration:none; color:inherit;">
          <div class="notif-icon" aria-hidden="true"></div>
          <div>
            <strong style="display:block;">${escapeHtml(n.title)}</strong>
            <span style="color:var(--ink-soft); font-size:0.9rem;">${escapeHtml(n.body)}</span>
            <div class="notif-time">${timeAgo(n.createdAt)}</div>
          </div>
        </a>
      `).join('')}</div>`;
    }
  } catch (e) {
    document.getElementById('notifList').innerHTML = '<p class="empty-state">Could not load notifications right now.</p>';
  }

  // No prompt or button here: if this device has already allowed alerts, quietly
  // make sure the server still knows about it. Turning alerts on or off lives in
  // the member's profile settings.
  resubscribePushIfAlreadyAllowed();
})();

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
