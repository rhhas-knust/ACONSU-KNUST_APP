// The script of how-to.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
(async function () {
  await initLayout('/how-to.html');

  // The page's own address is what is worth sending: the video is a few
  // megabytes, and whoever opens the link gets it from here when they press play.
  const share = document.getElementById('shareBtn');
  if (navigator.share) {
    share.hidden = false;
    share.addEventListener('click', function () {
      navigator.share({ title: 'How to use the ACONSU app', url: location.origin + '/how-to.html' })
        .catch(function () { /* closed without sharing */ });
    });
  }
})();
