/* A little movement, and only where it helps somebody follow the page.
   - Sections and cards ease in once, the first time they scroll into view.
   - The link for the section you are reading is marked in the top bar.
   - The top bar gets a hairline once the page has moved under it.

   Everything here is a nicety. The page is complete without this file: nothing is
   hidden until a script has said it can be shown, and a reader who asked their
   device for less motion gets a plain fade or nothing. */
(function () {
  'use strict';
  var root = document.documentElement;
  root.classList.add('js');

  var SELECTORS = [
    '.times li', '.card', '.lead-card', '.exec-card', '.founder-card', '.alumnus',
    '.spotlight', '.church-mark', '.founder-heading', '.exec-heading', '.theme-flyers',
    '.ask', '.verse', '.facts > div', 'main section > .wrap > h2'
  ].join(',');

  // ---- ease in on first sight -------------------------------------------
  if ('IntersectionObserver' in window) {
    var seen = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        seen.unobserve(el);
        el.classList.add('in');
        // Once it has arrived it goes back to being an ordinary element, so the
        // hover and press states are not slowed by the entrance delay.
        var done = function () { el.classList.remove('reveal', 'in'); el.style.removeProperty('--i'); el.removeEventListener('transitionend', done); };
        el.addEventListener('transitionend', done);
        setTimeout(done, 900);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });

    var register = function (scope) {
      if (!scope || !scope.querySelectorAll) return;
      var nodes = scope.matches && scope.matches(SELECTORS) ? [scope] : [];
      nodes = nodes.concat([].slice.call(scope.querySelectorAll(SELECTORS)));
      nodes.forEach(function (el) {
        if (el.__reveal) return;
        el.__reveal = true;
        if (el.closest('.hero') || el.closest('footer') || el.closest('.top')) return;
        var r = el.getBoundingClientRect();
        // Already on screen when the page opened: leave it alone. Fading in
        // what is already there reads as the page loading slowly.
        if (r.height > 0 && r.top < window.innerHeight * 0.9 && r.bottom > 0) return;
        var siblings = el.parentNode ? [].slice.call(el.parentNode.children) : [];
        el.style.setProperty('--i', String(Math.min(siblings.indexOf(el), 5)));
        el.classList.add('reveal');
        seen.observe(el);
      });
    };
    register(document.body);
    // Sections that arrive later (the alumni wall, the month's theme) are registered as they appear.
    new MutationObserver(function (list) {
      list.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) register(n); }); });
    }).observe(document.body, { childList: true, subtree: true });
    // Printing, or a reader that never scrolls: show everything.
    window.addEventListener('beforeprint', function () {
      [].slice.call(document.querySelectorAll('.reveal')).forEach(function (el) { el.classList.remove('reveal'); });
    });

    // ---- which section am I in ------------------------------------------
    var links = {};
    [].slice.call(document.querySelectorAll('.top nav a[href^="#"]')).forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        Object.keys(links).forEach(function (id) { links[id].removeAttribute('aria-current'); });
        var a = links[entry.target.id];
        if (a) a.setAttribute('aria-current', 'true');
      });
    }, { rootMargin: '-35% 0px -60% 0px' });
    Object.keys(links).forEach(function (id) { var s = document.getElementById(id); if (s) spy.observe(s); });
  }

  // ---- the top bar once the page has moved ----------------------------------
  var bar = document.querySelector('.top');
  if (bar) {
    var ticking = false;
    var update = function () { bar.classList.toggle('is-scrolled', window.scrollY > 6); ticking = false; };
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    update();
  }
})();
