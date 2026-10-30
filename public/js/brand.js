/* The app's colour. /theme.css carries the palette (lib/brand.js); this picks
   which chapter's to ask for, as early as the page allows, so a chapter that has
   chosen its own colour does not flash the national one first. It is loaded in the
   <head>, straight after the link it adjusts, and is small on purpose. */
(function () {
  var KEY = 'aconsu_chapter_id';
  var link = document.getElementById('brandTheme');
  var meta = document.querySelector('meta[name="theme-color"]');
  var chapter = '';
  try { chapter = localStorage.getItem(KEY) || ''; } catch (e) { /* private window */ }

  function href(id) { return '/theme.css' + (id ? '?chapter=' + encodeURIComponent(id) : ''); }
  function use(id) {
    id = id || '';
    if (!link || id === chapter) return;
    chapter = id;
    link.setAttribute('href', href(id));
  }
  // The browser's address bar and the phone's status bar take the same colour.
  function color(hex) {
    if (meta && /^#[0-9a-fA-F]{6}$/.test(hex || '')) meta.setAttribute('content', hex);
  }
  // What /api/settings says, once a page has it.
  function fromSettings(s) {
    if (!s) return;
    if (s.chapterId) use(s.chapterId);
    color(s.brandColor);
  }

  if (link && chapter) link.setAttribute('href', href(chapter));
  window.ACONSU_BRAND = { use: use, color: color, fromSettings: fromSettings };
})();
