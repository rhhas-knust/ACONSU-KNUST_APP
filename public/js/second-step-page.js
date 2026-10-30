/* ============================================================
   Setting up the second step, for a leader who signed in on a
   page without the portal around it (the admin pages). The
   portals show the same screen in place (portal.js).
   Requires main.js, portal.js and account.js.
   ============================================================ */
(function () {
  const host = document.getElementById('ssHost');
  // Back where they came from once it is done; only a path on this site.
  const back = (() => {
    const b = new URLSearchParams(location.search).get('back') || '/admin.html';
    return /^\/[A-Za-z0-9/_-]*(\.html)?$/.test(b) ? b : '/admin.html';
  })();
  document.getElementById('ssSignOut').addEventListener('click', async () => {
    await fetchJSON('/api/portal/logout', { method: 'POST' }).catch(() => {});
    location.href = back;
  });
  fetchJSON('/api/portal/me').then((me) => {
    if (!me.staff) {
      host.innerHTML = `<p>Sign in first, then come back here.</p><p><a class="btn btn-primary" href="${back}">Sign in</a></p>`;
      return;
    }
    PortalAccount.setupScreen(host, () => { location.href = back; });
  }).catch(() => {
    host.innerHTML = '<p>Could not check your sign-in. Please try again.</p>';
  });
})();
