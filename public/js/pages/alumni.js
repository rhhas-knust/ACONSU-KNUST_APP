// The script of alumni.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
(async function () {
  await initLayout('/alumni.html');
  var grid = document.getElementById('alumniGrid');
  var state = { q: '', industry: '', mentoring: false };

  function card(a) {
    var initial = escapeHtml((a.name || '?').charAt(0));
    var pic = a.profileImageFileId
      ? '<img src="/api/files/' + escapeHtml(a.profileImageFileId) + '" alt="">'
      : initial;
    var where = [a.city, a.country].filter(Boolean).join(', ');
    var reach = '';
    if (a.email) reach += '<a href="mailto:' + escapeHtml(a.email) + '">Email</a>';
    if (a.phone) reach += '<a href="tel:' + escapeHtml(a.phone) + '">Call</a>';
    if (a.linkedin) reach += '<a href="' + escapeHtml(a.linkedin) + '" target="_blank" rel="noopener noreferrer">LinkedIn</a>';
    if (!reach) reach = '<span class="tiny muted" style="font-size:0.78rem; color:var(--ink-faint);">Contact details not shared</span>';
    return '<article class="alum">'
      + '<div class="top"><div class="pic">' + pic + '</div><div>'
      + '<h3>' + escapeHtml(a.name) + '</h3>'
      + '<p class="job">' + escapeHtml(a.profession || '') + '</p>'
      + (a.organisation ? '<div class="org">' + escapeHtml(a.organisation) + '</div>' : '')
      + '</div></div>'
      + '<div class="meta">'
      + (a.industry ? '<span class="tagi">' + escapeHtml(a.industry) + '</span>' : '')
      + (a.graduationYear ? '<span class="tagi">Class of ' + escapeHtml(a.graduationYear) + '</span>' : '')
      + (where ? '<span class="tagi">' + escapeHtml(where) + '</span>' : '')
      + (a.chapterName ? '<span class="tagi">' + escapeHtml(a.chapterName) + '</span>' : '')
      + (a.openToMentoring ? '<span class="tagi mentor">Open to mentoring</span>' : '')
      + '</div>'
      + (a.bio ? '<p class="bio">' + escapeHtml(a.bio) + '</p>' : '')
      + '<div class="reach">' + reach + '</div>'
      + '</article>';
  }

  // The scroll-reveal animation parks every card at opacity 0 until it scrolls
  // into view. That is right on first load and wrong after a filter change,
  // where re-running it would fade the whole list out and back in on every
  // keystroke.
  var revealed = false;
  async function load() {
    var qs = [];
    if (state.q) qs.push('q=' + encodeURIComponent(state.q));
    if (state.industry) qs.push('industry=' + encodeURIComponent(state.industry));
    if (state.mentoring) qs.push('mentoring=1');
    try {
      var data = await fetchJSON('/api/alumni' + (qs.length ? '?' + qs.join('&') : ''));
      document.getElementById('filterWrap').hidden = false;
      var sel = document.getElementById('industryFilter');
      if (sel.options.length === 1) {
        (data.industries || []).forEach(function (i) {
          var o = document.createElement('option'); o.value = i; o.textContent = i; sel.appendChild(o);
        });
      }
      document.getElementById('alumniCount').textContent =
        data.count + (data.count === 1 ? ' alumnus listed' : ' alumni listed');
      grid.innerHTML = (data.items || []).map(card).join('')
        || '<p class="empty-state">No alumni match that yet. Try a different profession, or clear the search.</p>';
      if (!revealed) { initScrollReveal('.alum'); revealed = true; }
    } catch (err) {
      // The two refusals mean different things, and a member deserves to be
      // told which one applies to them rather than a flat "no".
      document.getElementById('filterWrap').hidden = true;
      grid.innerHTML = '<div class="locked"><p>' + escapeHtml(err.message
        || 'Could not load Alumni Connect right now.') + '</p></div>';
    }
  }

  var t;
  document.getElementById('alumniSearch').addEventListener('input', function (e) {
    state.q = e.target.value.trim();
    clearTimeout(t); t = setTimeout(load, 260);
  });
  document.getElementById('industryFilter').addEventListener('change', function (e) {
    state.industry = e.target.value; load();
  });
  document.getElementById('mentorToggle').addEventListener('click', function (e) {
    state.mentoring = !state.mentoring;
    e.target.classList.toggle('on', state.mentoring);
    e.target.setAttribute('aria-pressed', state.mentoring ? 'true' : 'false');
    load();
  });

  load();
})();
