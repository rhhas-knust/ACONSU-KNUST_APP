// The script of alumni.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
/* Public parts of this page: they work signed out, and one failing never
   stops the other (or the members' directory above). */
(function () {
  function img(id, alt) { return '<img src="/api/files/' + escapeHtml(id) + '" alt="' + escapeHtml(alt || '') + '" loading="lazy">'; }

  // ---- this week's celebrated alumnus ----
  fetch('/api/public/alumni/spotlight').then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
    var a = data && data.alumnus;
    if (!a) return;
    var el = document.getElementById('spotlight');
    var meta = [a.classOf ? 'Class of ' + a.classOf : '', a.chapterName].filter(Boolean).join(' · ');
    el.innerHTML = '<div class="spot-photo">' + (a.imageFileId ? img(a.imageFileId, a.name) : escapeHtml((a.name || '?').charAt(0))) + '</div>'
      + '<div><p class="meta">Celebrating this week</p>'
      + '<h2>' + escapeHtml(a.name) + '</h2>'
      + (a.currentWork ? '<p class="job">' + escapeHtml(a.currentWork) + '</p>' : '')
      + '<p>' + escapeHtml(a.about) + '</p>'
      + (meta ? '<p class="small">' + escapeHtml(meta) + '</p>' : '')
      + '</div>';
    el.hidden = false;
  }).catch(function () {});

  // ---- chapters for the request form ----
  var chapterSel = document.getElementById('alChapter');
  fetch('/api/chapters').then(function (r) { return r.json(); }).then(function (list) {
    list = (list || []).filter(function (c) { return c && c.id; });
    var chosen = '';
    try { chosen = (typeof getSelectedChapterId === 'function' && getSelectedChapterId()) || ''; } catch (e) {}
    chapterSel.innerHTML = (list.length === 1 ? '' : '<option value="">Choose your chapter</option>')
      + list.map(function (c) { return '<option value="' + escapeHtml(c.id) + '"' + (c.id === chosen ? ' selected' : '') + '>' + escapeHtml(c.name || c.id) + '</option>'; }).join('');
  }).catch(function () { chapterSel.innerHTML = '<option value="">Could not load chapters</option>'; });

  // ---- the photo: shrunk here, so a 6MB phone photo does not cross a mobile connection ----
  var photoInput = document.getElementById('alPhoto');
  var preview = document.getElementById('alPreview');
  function shrink(file, max) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var im = new Image();
      im.onload = function () {
        try {
          var scale = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(im.naturalWidth * scale));
          c.height = Math.max(1, Math.round(im.naturalHeight * scale));
          var ctx = c.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(im, 0, 0, c.width, c.height);
          c.toBlob(function (blob) { URL.revokeObjectURL(url); resolve(blob || file); }, 'image/jpeg', 0.85);
        } catch (e) { URL.revokeObjectURL(url); resolve(file); }
      };
      im.onerror = function () { URL.revokeObjectURL(url); resolve(file); }; // the server decides what it can read
      im.src = url;
    });
  }
  photoInput.addEventListener('change', function () {
    var f = photoInput.files[0];
    if (!f) { preview.hidden = true; return; }
    preview.src = URL.createObjectURL(f);
    preview.hidden = false;
  });

  var about = document.getElementById('alAbout');
  about.addEventListener('input', function () { document.getElementById('alCount').textContent = about.value.length; });

  document.getElementById('alumniForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var msg = document.getElementById('alMsg');
    var btn = document.getElementById('alSubmit');
    function fail(t) { msg.textContent = t; msg.className = 'form-msg error'; }
    msg.textContent = ''; msg.className = 'form-msg';
    if (!document.getElementById('alName').value.trim()) return fail('Please tell us your name.');
    if (!chapterSel.value) return fail('Please choose the chapter you were part of.');
    if (!photoInput.files[0]) return fail('Please add a photo of you.');
    if (about.value.trim().length < 15) return fail('Please add a few words about you.');
    if (!document.getElementById('alConsent').checked) return fail('Please tick the box to say you are happy for this to be shown publicly.');

    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      var fd = new FormData();
      fd.append('name', document.getElementById('alName').value);
      fd.append('chapterId', chapterSel.value);
      fd.append('about', about.value);
      fd.append('currentWork', document.getElementById('alWork').value);
      fd.append('classOf', document.getElementById('alClass').value);
      fd.append('contact', document.getElementById('alContact').value);
      fd.append('company', document.getElementById('alCompany').value);
      fd.append('consent', 'true');
      fd.append('via', 'app');
      fd.append('photo', await shrink(photoInput.files[0], 1000), 'me.jpg');
      var data = await fetchJSON('/api/public/alumni-requests', { method: 'POST', body: fd });
      document.getElementById('alDoneText').textContent = data.message || 'Your request has gone to the admins for review.';
      document.getElementById('alumniForm').hidden = true;
      document.getElementById('alDone').hidden = false;
      showToast('Request sent', 'success');
    } catch (err) {
      fail(err.message || 'Something went wrong. Please try again.');
    } finally {
      btn.disabled = false; btn.textContent = 'Send my request';
    }
  });
})();
