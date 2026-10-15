/* The "which chapter?" step when a leader signs in.

   Every leadership sign-in (the office portals, the admin page and the chapter
   admin page) calls LeaderChapter.attach(form, usernameInputId). It puts a
   "Your chapter" list above the username, filled with the chapters that exist
   right now, plus "National office" for national officers. A chapter created
   tomorrow is in the list tomorrow; nothing here names a chapter.

   With fewer than two chapters there is nothing to choose between, so no list
   is shown and nothing is sent: the app's one-chapter rule is no extra steps.

   attach() resolves to { value() } where value() is the chosen chapter's id,
   'national', or undefined when no list was shown. The server checks the account
   belongs to what was chosen, after it has checked the password. */
(function () {
  'use strict';
  var KEY = 'aconsu.leaderChapter';
  var NATIONAL = 'national';

  function remembered() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function remember(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* storage blocked: the choice is just not kept */ } }

  function chapters() {
    return fetch('/api/chapters', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (list) { return Array.isArray(list) ? list : []; })
      .catch(function () { return []; });
  }

  function option(value, label) {
    var o = document.createElement('option');
    o.value = value; o.textContent = label;
    return o;
  }

  function attach(form, usernameId) {
    var nothing = { value: function () { return undefined; } };
    var username = document.getElementById(usernameId);
    if (!form || !username) return Promise.resolve(nothing);
    return chapters().then(function (list) {
      if (list.length < 2 || document.getElementById('leaderChapter')) return nothing;

      var field = document.createElement('div');
      field.className = 'field';
      field.id = 'leaderChapterField';
      var label = document.createElement('label');
      label.setAttribute('for', 'leaderChapter');
      label.textContent = 'Your chapter';
      var select = document.createElement('select');
      select.id = 'leaderChapter';
      select.required = true;
      select.setAttribute('aria-describedby', 'leaderChapterHint');
      select.appendChild(option('', 'Choose your chapter'));
      list.forEach(function (c) { select.appendChild(option(c.id, c.name + (c.institution ? ': ' + c.institution : ''))); });
      select.appendChild(option(NATIONAL, 'National office'));
      var hint = document.createElement('small');
      hint.id = 'leaderChapterHint';
      hint.className = 'hint';
      hint.textContent = 'National officers choose National office.';
      field.appendChild(label); field.appendChild(select); field.appendChild(hint);

      var before = username.closest('.field') || username.parentNode;
      before.parentNode.insertBefore(field, before);

      // Last time's choice, if that chapter is still in the list.
      var saved = remembered();
      if (saved && Array.prototype.some.call(select.options, function (o) { return o.value === saved; })) select.value = saved;
      select.addEventListener('change', function () { if (select.value) remember(select.value); });

      return { value: function () { return select.value || undefined; } };
    });
  }

  window.LeaderChapter = { attach: attach };
})();
