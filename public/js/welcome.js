/* The visitor QR code's form (public/welcome.html, routes/door-checkin.js).
   On its own, without main.js: a visitor's phone at the door loads this
   page and nothing else. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var token = new URLSearchParams(location.search).get('c') || '';
  // The day's name follows, so a Sunday service is just "Service, Sunday 2 November".
  var SERVICE = { sunday: 'Service', midweek: 'Midweek service', special: 'Special service' };

  function show(id) {
    ['wcLoading', 'wcClosed', 'wcForm', 'wcDone'].forEach(function (x) { $(x).hidden = x !== id; });
  }
  function closed(text) {
    $('wcClosedText').textContent = text;
    show('wcClosed');
  }
  function say(text, kind) {
    var m = $('wcMsg');
    m.textContent = text;
    m.className = 'form-msg ' + (kind || '');
  }
  function api(method, body) {
    return fetch('/api/door/' + encodeURIComponent(token), {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'omit'
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) { var e = new Error(data.error || 'Something went wrong.'); e.status = res.status; throw e; }
        return data;
      });
    });
  }
  function dayLabel(day) {
    var d = new Date(day + 'T12:00:00Z');
    return isNaN(d.getTime()) ? day : d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  }

  if (!token) { closed('This link is missing its code. Please scan the QR code at the door again.'); return; }

  api('GET').then(function (info) {
    $('wcChapter').textContent = info.chapter.name;
    $('wcWhen').textContent = (SERVICE[info.serviceType] || 'Service') + ', ' + dayLabel(info.date) + '. Tell us who you are and you are checked in.';
    var heard = $('wcHeard');
    Object.keys(info.heard || {}).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k;
      o.textContent = info.heard[k].charAt(0).toUpperCase() + info.heard[k].slice(1);
      heard.appendChild(o);
    });
    // The rest of the website opens on this chapter after this.
    try { localStorage.setItem('aconsu_chapter_id', info.chapter.id); } catch (e) { /* fine without */ }
    show('wcForm');
  }).catch(function (e) {
    closed(e.message || 'This code could not be opened. Please ask someone at the door.');
  });

  $('wcForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var name = $('wcName').value.trim();
    var phone = $('wcPhone').value.trim();
    if (name.length < 2) { say('Type your name.', 'error'); $('wcName').focus(); return; }
    if (phone.replace(/\D/g, '').length < 9) { say('Type your phone number.', 'error'); $('wcPhone').focus(); return; }
    if (!$('wcConsent').checked) { say('Tick the box to say we may keep your details.', 'error'); $('wcConsent').focus(); return; }
    var btn = $('wcSend');
    btn.disabled = true;
    say('');
    api('POST', {
      name: name, phone: phone,
      programme: $('wcProgramme').value, hall: $('wcHall').value, heard: $('wcHeard').value,
      consent: true, website: $('wcWebsite').value
    }).then(function (out) {
      $('wcThanks').textContent = 'Thank you' + (out.firstName ? ', ' + out.firstName : '') + '. You are checked in.';
      show('wcDone');
      $('wcDone').focus();
    }).catch(function (e) {
      btn.disabled = false;
      if (e.status === 404 || e.status === 410) { closed(e.message); return; }
      say(e.message || 'Could not check you in. Please see someone at the door.', 'error');
    });
  });
})();
