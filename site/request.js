/* The alumni form page.

   Two things can be sent from here, and the second is optional:
     1. the person's details, for the alumni team and Alumni Connect;
     2. a request to appear on the public Alumni wall, with a photo.
   Each goes to the app only when somebody presses Send, and nothing at all is
   sent while the page is being looked at. */
(function () {
  'use strict';
  var C = window.CHAPTER || {};
  var A = C.alumni || {};
  var requestUrl = String(A.requestUrl || '').replace(/\/+$/, '');

  // name, location and year in the footer
  document.querySelectorAll('[data-bind]').forEach(function (el) {
    var v = C[el.getAttribute('data-bind')];
    if (v) el.textContent = v; else el.remove();
  });
  var y = document.getElementById('year');
  if (y) y.textContent = String(new Date().getFullYear());

  var $ = function (id) { return document.getElementById(id); };
  var form = $('alumniForm');
  if (!form) return;
  var msg = $('alMsg');
  var btn = $('alSubmit');

  // No address for the app means there is nowhere to send it to: say so, plainly.
  if (!requestUrl) {
    form.hidden = true;
    var none = document.createElement('p');
    none.textContent = 'This form is not switched on yet. Please contact us instead.';
    form.parentNode.insertBefore(none, form);
    return;
  }

  // ---- sharing the link ---------------------------------------------------
  function share() {
    var url = location.origin + location.pathname;
    var note = $('shareNote');
    var tell = function (t) { if (note) { note.textContent = t; setTimeout(function () { note.textContent = ''; }, 4000); } };
    if (navigator.share) {
      navigator.share({ title: 'ACONSU alumni form', text: 'ACONSU alumni, please tell us where you are now:', url: url }).catch(function () { /* closed without sharing */ });
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { tell('Link copied.'); }, function () { tell(url); });
    } else {
      tell(url);
    }
  }
  ['shareBtn', 'shareBtn2'].forEach(function (id) { var b = $(id); if (b) b.addEventListener('click', share); });

  // ---- the public wall is a choice, so its fields stay out of the way ------
  var wall = $('alWall');
  var wallFields = $('wallFields');
  function showWall(on) {
    wall.checked = on;
    wall.setAttribute('aria-expanded', on ? 'true' : 'false');
    wallFields.hidden = !on;
  }
  wall.addEventListener('change', function () { showWall(wall.checked); });
  // A link can open the form with the wall already chosen: ?for=wall
  if (/(?:^|[?&])for=wall(?:&|$)/.test(location.search)) showWall(true);

  // Showing contact details only makes sense as part of being shown at all.
  var share1 = $('alShare'), show2 = $('alShowContact');
  share1.addEventListener('change', function () {
    show2.disabled = !share1.checked;
    if (!share1.checked) show2.checked = false;
  });

  // ---- the photo ------------------------------------------------------------
  var photoInput = $('alPhoto');
  var preview = $('alPreview');
  var about = $('alAbout');
  photoInput.addEventListener('change', function () {
    var f = photoInput.files[0];
    if (!f) { preview.hidden = true; return; }
    preview.src = URL.createObjectURL(f);
    preview.hidden = false;
  });
  about.addEventListener('input', function () { $('alCount').textContent = about.value.length; });

  // Shrunk here first: a 6MB phone photo should not cross a mobile connection
  // to an app that may still be waking up.
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
      im.onerror = function () { URL.revokeObjectURL(url); resolve(file); };   // the app decides what it can read
      im.src = url;
    });
  }

  // ---- messages: said in words, and focus goes to the field they are about --
  var fields = form.querySelectorAll('input, textarea');
  function clearInvalid() { Array.prototype.forEach.call(fields, function (f) { f.removeAttribute('aria-invalid'); }); }
  function say(text, bad, field) {
    clearInvalid();
    msg.textContent = text;
    msg.className = 'ask-msg' + (bad ? ' is-error' : '');
    if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
  }

  var detailsSent = false;   // if the wall request fails, a retry does not send the details again
  function post(path, fd, signal) {
    return fetch(requestUrl + path, { method: 'POST', body: fd, signal: signal }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
        return data;
      });
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    say('');
    var name = $('alName'), email = $('alEmail'), phone = $('alPhone');
    var emailOk = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(email.value.trim());
    if (!name.value.trim()) return say('Enter your name.', true, name);
    if (!email.value.trim() && !phone.value.trim()) return say('Give an email address or a phone number so we can reach you.', true, email);
    if (email.value.trim() && !emailOk) return say('That email address does not look right.', true, email);
    if (phone.value.trim() && phone.value.replace(/[^0-9]/g, '').length < 7) return say('That phone number does not look right.', true, phone);
    if (!$('alConsent').checked) return say('Tick the first box under "What you agree to" so we may keep your details.', true, $('alConsent'));
    var wantsWall = wall.checked;
    if (wantsWall) {
      if (!photoInput.files[0]) return say('Add a photo of you, or untick the Alumni wall box.', true, photoInput);
      if (about.value.trim().length < 15) return say('Write at least a sentence about you (15 characters or more), or untick the Alumni wall box.', true, about);
      if (!$('alWallConsent').checked) return say('Tick the box to agree that your photo and words are shown publicly, or untick the Alumni wall box.', true, $('alWallConsent'));
    }

    btn.disabled = true; btn.textContent = 'Sending...';
    // The app sleeps when nobody has used it for a while and takes up to a
    // minute to wake. Say so, rather than leave a button that looks dead.
    var waking = setTimeout(function () { say('The app is starting up. This can take up to a minute, so please keep this page open.'); }, 6000);
    var ctl = window.AbortController ? new AbortController() : null;
    var giveUp = setTimeout(function () { if (ctl) ctl.abort(); }, 100000);
    var signal = ctl ? ctl.signal : undefined;
    var chapterId = String(A.chapterId || '');
    var first = name.value.trim().split(/\s+/)[0];

    var sendDetails = function () {
      if (detailsSent) return Promise.resolve();
      var fd = new FormData();
      fd.append('name', name.value); fd.append('chapterId', chapterId); fd.append('via', 'site');
      fd.append('classOf', $('alClass').value); fd.append('programme', $('alProgramme').value);
      fd.append('profession', $('alProfession').value); fd.append('organisation', $('alOrg').value);
      fd.append('industry', $('alIndustry').value); fd.append('city', $('alCity').value); fd.append('country', $('alCountry').value);
      fd.append('openToMentoring', $('alMentor').checked ? 'true' : 'false');
      fd.append('email', email.value); fd.append('phone', phone.value);
      fd.append('shareWithMembers', share1.checked ? 'true' : 'false');
      fd.append('showContact', show2.checked ? 'true' : 'false');
      fd.append('consent', 'true');
      fd.append('company', $('alCompany').value);
      return post('/api/public/alumni-details', fd, signal).then(function () { detailsSent = true; });
    };
    var sendWall = function () {
      if (!wantsWall) return Promise.resolve(null);
      return shrink(photoInput.files[0], 1000).then(function (photo) {
        var fd = new FormData();
        fd.append('name', name.value); fd.append('chapterId', chapterId); fd.append('via', 'site');
        fd.append('about', about.value);
        fd.append('currentWork', [$('alProfession').value.trim(), $('alOrg').value.trim()].filter(Boolean).join(' at '));
        fd.append('classOf', $('alClass').value);
        fd.append('contact', email.value.trim() || phone.value.trim());
        fd.append('company', $('alCompany').value);
        fd.append('consent', 'true');
        fd.append('photo', photo, 'me.jpg');
        return post('/api/public/alumni-requests', fd, signal);
      });
    };

    sendDetails().then(sendWall).then(function (wallReply) {
      var text = 'Thank you' + (first ? ', ' + first : '') + '. Your details have reached the ACONSU alumni team.'
        + (wallReply ? ' Your request for the Alumni wall has gone to the admins for review. Once it is approved you will appear there.' : '');
      $('alDoneText').textContent = text;
      form.hidden = true;
      $('alDone').hidden = false;
      $('alDone').scrollIntoView();
    }).catch(function (err) {
      // A thrown TypeError / AbortError is "could not reach the app"; an
      // Error we made from the app's own reply carries its own words.
      var unreachable = err && (err.name === 'TypeError' || err.name === 'AbortError');
      var prefix = detailsSent ? 'Your details were sent, but the Alumni wall request was not. ' : '';
      say(prefix + (unreachable ? 'The app could not be reached. Try again in a minute.' : err.message), true);
    }).then(function () {
      clearTimeout(waking); clearTimeout(giveUp);
      btn.disabled = false; btn.textContent = 'Send';
    });
  });
})();
