/* Measures the colour pairs from the live stylesheet and fills the page. */
(function () {
  'use strict';
  var cs = getComputedStyle(document.documentElement);
  var v = function (n) { return cs.getPropertyValue(n).trim(); };

  function parse(c) {
    var m = c.match(/^#([0-9a-f]{6})$/i);
    if (m) { var n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    m = c.match(/rgba?\(([^)]+)\)/);
    return m ? m[1].split(',').slice(0, 3).map(Number) : [0, 0, 0];
  }
  function lum(rgb) {
    var a = rgb.map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }
  function ratio(fg, bg) {
    var l1 = lum(parse(fg)), l2 = lum(parse(bg));
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  // [label, text token, background token]
  var PAIRS = [
    ['Body text', '--ink', '--bg'], ['Secondary text', '--ink-soft', '--bg'], ['Muted text, hints', '--ink-faint', '--bg'],
    ['Headings', '--heading', '--bg'], ['Links and brand text', '--brand', '--bg'], ['Gold as text', '--accent', '--bg'],
    ['Body on a tinted band', '--ink', '--surface-2'], ['Muted on a tinted band', '--ink-faint', '--surface-2'],
    ['Button label', '#FFFFFF', '--purple-deep'], ['Light button', '--purple-ink', '#FFFFFF'],
    ['OK', '--ok', '--ok-bg'], ['Waiting', '--warn', '--warn-bg'], ['Error', '--bad', '--bad-bg'], ['Information', '--info', '--info-bg']
  ];
  var pairsEl = document.getElementById('pairs');
  PAIRS.forEach(function (p) {
    var fg = p[1].charAt(0) === '#' ? p[1] : v(p[1]);
    var bg = p[2].charAt(0) === '#' ? p[2] : v(p[2]);
    var r = ratio(fg, bg);
    var el = document.createElement('div');
    el.className = 'pair';
    el.innerHTML = '<div class="pair-sample" style="color:' + fg + ';background:' + bg + '">' + p[0] + '</div>' +
      '<div class="pair-meta"><span>' + fg + ' on ' + bg + '</span><span class="' + (r >= 4.5 ? 'ok' : 'bad') + '">' + r.toFixed(1) + ':1 ' + (r >= 4.5 ? 'passes' : 'fails') + '</span></div>';
    pairsEl.appendChild(el);
  });

  var STATUS = [['ok', 'Approved'], ['warn', 'Waiting'], ['bad', 'Declined'], ['info', 'Pinned']];
  var html = STATUS.map(function (s) { return '<span class="badge" style="color:var(--' + s[0] + ');background:var(--' + s[0] + '-bg)">' + s[1] + '</span>'; }).join('');
  document.getElementById('statusRow').innerHTML = html;
  document.getElementById('badges').innerHTML = html;

  // Replay the arrival animation
  var demo = document.getElementById('motionDemo');
  function play() {
    [].slice.call(demo.children).forEach(function (el, i) {
      el.classList.remove('in');
      el.classList.add('reveal');
      el.style.setProperty('--i', String(i * 1));
    });
    document.documentElement.classList.add('js');
    requestAnimationFrame(function () { requestAnimationFrame(function () { [].slice.call(demo.children).forEach(function (el) { el.classList.add('in'); }); }); });
  }
  document.getElementById('replay').addEventListener('click', play);

  // Screens, if they have been captured
  var SCREENS = [
    ['site-home-mobile.png', 'Website home on a phone'], ['site-home-desktop.png', 'Website home on a desktop'],
    ['site-alumni-form-error.png', 'Alumni request, with an error: focus moves to the field'], ['site-alumni-form-done.png', 'Alumni request, after sending'],
    ['site-alumni-wall.png', 'Alumni wall and this week\'s spotlight'], ['site-dark-mobile.png', 'Website in dark mode'],
    ['app-approvals-queue.png', 'App: National approvals queue'], ['app-alumni-form-mobile.png', 'App: alumni request on a phone']
  ];
  var list = document.getElementById('screenList');
  SCREENS.forEach(function (s) {
    var fig = document.createElement('figure');
    var img = new Image(); img.src = 'screens/' + s[0]; img.alt = s[1];
    img.onerror = function () { fig.remove(); };
    var cap = document.createElement('figcaption'); cap.textContent = s[1] + (/wall|queue|form|done/.test(s[0]) ? ' (sample content)' : '');
    fig.appendChild(img); fig.appendChild(cap); list.appendChild(fig);
  });
})();
