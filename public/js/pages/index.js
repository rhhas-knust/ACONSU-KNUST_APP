// The script of index.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
// Runs while the head is still parsing, so the decision is made before the
// overlay is ever painted - no flash of a splash we meant to skip.
try {
  if (sessionStorage.getItem('aconsu.splashShown')) document.documentElement.dataset.splash = 'skip';
  else sessionStorage.setItem('aconsu.splashShown', '1');
} catch (e) { /* private mode: showing it again is the harmless outcome */ }
