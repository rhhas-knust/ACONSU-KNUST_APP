/* The Alumni wall and the monthly theme, for the two places that run them:
   the National portal (every chapter) and a chapter admin's dashboard (their own
   chapter). One set of screens behind two doors, so what a chapter admin sees is
   exactly what National sees, narrowed. Which door is decided by `cfg`, and the
   server decides what each door may actually do - nothing here is the lock.

   Needs, from the page it is loaded into: fetchJSON, escapeHtml, showToast,
   showModal, closeModal (main.js and portal.js / admin.js). */
(function () {
  'use strict';

  var STATUS = { pending: 'Waiting', approved: 'On the wall', unlisted: 'Unlisted', declined: 'Declined' };

  function monthName(key) {
    var p = String(key || '').split('-'), y = +p[0], m = +p[1];
    return y && m ? new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
  }
  function say(id, text, type) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'form-msg ' + (type || '');
  }
  function thumb(e) {
    return e.imageFileId
      ? '<img class="al-thumb" src="/api/files/' + encodeURIComponent(e.imageFileId) + '" alt="">'
      : '<span class="al-thumb al-initial">' + escapeHtml((e.name || '?').charAt(0)) + '</span>';
  }
  function when(d) { return d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; }
  async function sendForm(url, method, body) {
    var res = await fetch(url, { method: method, body: body });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || 'Could not save.');
    return data;
  }
  function wireCancel() {
    var c = document.getElementById('cancelModalBtn');
    if (c) c.addEventListener('click', closeModal);
  }

  // ---------------------------------------------------------------- alumni
  function alumniForm(person, chapters, cfg) {
    var isEdit = !!person;
    showModal(
      '<h3>' + (isEdit ? 'Edit alumnus' : 'Add an alumnus') + '</h3>'
      + '<p class="hint">' + (isEdit
          ? 'Fix a spelling or change the photo. Leave the photo empty to keep the current one.'
          : 'Added straight onto the wall - there is nothing to approve. For someone you know who will never fill in a form.') + '</p>'
      + '<form id="alumniEditForm">'
      + '<div class="field"><label>Name</label><input type="text" id="aeName" maxlength="80" value="' + escapeHtml(person && person.name || '') + '" required></div>'
      + (cfg.national
          ? '<div class="field"><label>Chapter</label><select id="aeChapter" required>' + chapters.map(function (c) {
              return '<option value="' + escapeHtml(c.id) + '"' + (person && c.id === person.chapterId ? ' selected' : '') + '>' + escapeHtml(c.name || c.id) + '</option>';
            }).join('') + '</select></div>'
          : '')
      + '<div class="field"><label>A few words about them</label><textarea id="aeAbout" rows="4" maxlength="400" required>' + escapeHtml(person && person.about || '') + '</textarea></div>'
      + '<div class="field-row">'
      + '<div class="field"><label>What they do now</label><input type="text" id="aeWork" maxlength="120" value="' + escapeHtml(person && person.currentWork || '') + '"></div>'
      + '<div class="field"><label>Class of</label><input type="number" id="aeClass" min="1950" max="2100" value="' + escapeHtml(person && person.classOf || '') + '"></div>'
      + '</div>'
      + '<div class="field"><label>Photo</label><input type="file" id="aePhoto" accept="image/*">'
      + '<small class="muted">Resized on the way in. Their phone\'s location data is removed.</small></div>'
      + '<div style="display:flex; gap:10px; margin-top:20px;">'
      + '<button type="submit" class="btn btn-primary">Save</button>'
      + '<button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button></div>'
      + '<div class="form-msg" id="aeMsg"></div></form>'
    );
    wireCancel();
    document.getElementById('alumniEditForm').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var body = new FormData();
      body.append('name', document.getElementById('aeName').value);
      var ch = document.getElementById('aeChapter');
      if (ch) body.append('chapterId', ch.value);
      body.append('about', document.getElementById('aeAbout').value);
      body.append('currentWork', document.getElementById('aeWork').value);
      body.append('classOf', document.getElementById('aeClass').value);
      var file = document.getElementById('aePhoto').files[0];
      if (file) body.append('photo', file);
      try {
        await sendForm(isEdit ? cfg.base + '/' + person.id : cfg.base, isEdit ? 'PUT' : 'POST', body);
        closeModal();
        showToast(isEdit ? 'Saved' : 'Added to the wall', 'success');
        cfg.reopen();
      } catch (err) { say('aeMsg', err.message || 'Could not save.', 'error'); }
    });
  }

  function decide(cfg, id, decision, reason) {
    return fetchJSON(cfg.base + '/' + id + '/decision', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: decision, reason: reason })
    });
  }

  // cfg: { base, national, reopen }
  async function alumniPanel(el, cfg) {
    var loaded = await Promise.all([fetchJSON(cfg.base), cfg.national ? fetchJSON('/api/chapters') : Promise.resolve([])]);
    var data = loaded[0], chapters = loaded[1];
    var by = function (s) { return data.items.filter(function (e) { return e.status === s; }); };
    var pending = by('pending'), wall = by('approved'), other = by('unlisted').concat(by('declined'));
    var celebrated = cfg.national ? data.items.find(function (e) { return e.id === data.spotlight.entryId; }) : null;

    el.innerHTML =
      '<div class="panel-head"><div><h2>Alumni</h2>'
      + '<p class="sub">' + (cfg.national
          ? 'Alumni ask to be listed from the website or the app. Approve a request and they appear on the website and in the app\'s Alumni Connect. Every week one of them is celebrated, the same person in both places.'
          : 'Alumni of your chapter ask to be listed from the website or the app. Approve a request and they appear on the website and in the app\'s Alumni Connect. You see and decide on your own chapter\'s requests only.')
      + '</p></div><div class="panel-actions"><button class="btn btn-primary btn-sm" id="newAlumnusBtn">+ Add an alumnus</button></div></div>'

      + (cfg.national
          ? '<div class="al-celebrate">' + (celebrated ? thumb(celebrated) : '') + '<div>'
            + '<small class="muted">Celebrating this week (' + escapeHtml(data.spotlight.weekKey) + ')' + (data.spotlight.pinned ? ' · chosen by you' : ' · chosen automatically') + '</small>'
            + '<strong>' + (celebrated ? escapeHtml(celebrated.name) : 'Nobody yet - approve someone to start the rotation') + '</strong></div>'
            + (data.spotlight.pinned ? '<button class="btn btn-outline btn-sm" id="releaseSpotBtn" style="margin-left:auto;">Back to automatic</button>' : '')
            + '</div>'
          : '')

      + '<h3>Waiting for you (' + pending.length + ')</h3><div class="al-queue">'
      + (pending.length ? pending.map(function (e) {
          return '<div class="al-request">' + thumb(e) + '<div style="flex:1; min-width:0;">'
            + '<h4>' + escapeHtml(e.name) + '</h4>'
            + '<p class="meta">' + escapeHtml(e.chapterName || e.chapterId) + ' · asked ' + escapeHtml(when(e.createdAt)) + ' · from the ' + (e.via === 'site' ? 'website' : 'app') + (e.classOf ? ' · class of ' + escapeHtml(e.classOf) : '') + '</p>'
            + (e.currentWork ? '<p><strong>' + escapeHtml(e.currentWork) + '</strong></p>' : '')
            + '<p>' + escapeHtml(e.about) + '</p>'
            + (e.contact ? '<p class="private">To check it is them (private): ' + escapeHtml(e.contact) + '</p>' : '<p class="private">No contact left to check with.</p>')
            + '<div class="row-actions" style="margin-top:10px;">'
            + '<button data-approve="' + e.id + '">Approve</button><button data-edit-alumnus="' + e.id + '">Edit</button><button data-decline="' + e.id + '" class="danger">Decline</button>'
            + '</div></div></div>';
        }).join('') : '<p class="muted">Nobody is waiting. New requests appear here' + (cfg.national ? ', and you get an email when one arrives.' : '.') + '</p>')
      + '</div>'

      + '<h3>On the wall (' + wall.length + ')</h3><div class="table-wrap" tabindex="0" style="margin-bottom:26px;"><table class="portal-table"><thead><tr><th></th><th>Name</th><th>Chapter</th><th></th></tr></thead><tbody>'
      + (wall.length ? wall.map(function (e) {
          var isNow = cfg.national && e.id === data.spotlight.entryId;
          return '<tr><td style="width:64px;">' + thumb(e) + '</td>'
            + '<td><strong>' + escapeHtml(e.name) + '</strong>' + (isNow ? ' <span class="badge-soft">This week</span>' : '') + '<br><small class="muted">' + escapeHtml(e.currentWork || '') + '</small></td>'
            + '<td>' + escapeHtml(e.chapterName || e.chapterId) + '</td>'
            + '<td><div class="row-actions">'
            + (cfg.national && !isNow ? '<button data-pin="' + e.id + '">Celebrate this week</button>' : '')
            + '<button data-edit-alumnus="' + e.id + '">Edit</button><button data-unlist="' + e.id + '">Unlist</button><button data-remove-alumnus="' + e.id + '" class="danger">Remove</button>'
            + '</div></td></tr>';
        }).join('') : '<tr><td colspan="4" class="muted">Nobody on the wall yet.</td></tr>')
      + '</tbody></table></div>'

      + (other.length ? '<details><summary>Unlisted and declined (' + other.length + ')</summary><div class="table-wrap" style="margin-top:12px;"><table class="portal-table"><tbody>'
          + other.map(function (e) {
              return '<tr><td><strong>' + escapeHtml(e.name) + '</strong><br><small class="muted">' + STATUS[e.status] + (e.declineReason ? ' · ' + escapeHtml(e.declineReason) : '') + '</small></td>'
                + '<td><div class="row-actions">' + (e.status === 'unlisted' ? '<button data-approve="' + e.id + '">Put back</button>' : '')
                + '<button data-remove-alumnus="' + e.id + '" class="danger">Remove</button></div></td></tr>';
            }).join('')
          + '</tbody></table></div></details>' : '');

    var find = function (id) { return data.items.find(function (e) { return e.id === id; }); };
    var act = async function (fn, done) {
      try { await fn(); showToast(done, 'success'); cfg.reopen(); }
      catch (err) { showToast(err.message || 'Could not do that.', 'error'); }
    };
    var each = function (sel, fn) { el.querySelectorAll(sel).forEach(function (b) { b.addEventListener('click', function () { fn(b); }); }); };

    document.getElementById('newAlumnusBtn').addEventListener('click', function () { alumniForm(null, chapters, cfg); });
    var release = document.getElementById('releaseSpotBtn');
    if (release) release.addEventListener('click', function () { act(function () { return fetchJSON(cfg.base + '/spotlight/pin', { method: 'DELETE' }); }, 'Back to automatic'); });
    each('[data-approve]', function (b) { act(function () { return decide(cfg, b.dataset.approve, 'approve'); }, 'Approved. They are on the wall.'); });
    each('[data-edit-alumnus]', function (b) { alumniForm(find(b.dataset.editAlumnus), chapters, cfg); });
    each('[data-pin]', function (b) {
      act(function () {
        return fetchJSON(cfg.base + '/spotlight/pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entryId: b.dataset.pin }) });
      }, 'Celebrating them this week');
    });
    each('[data-unlist]', function (b) {
      if (confirm('Take them off the wall? You can put them back.')) act(function () { return decide(cfg, b.dataset.unlist, 'unlist'); }, 'Unlisted');
    });
    each('[data-remove-alumnus]', function (b) {
      if (confirm('Remove them for good, and delete their photo?')) act(function () { return fetchJSON(cfg.base + '/' + b.dataset.removeAlumnus, { method: 'DELETE' }); }, 'Removed');
    });
    each('[data-decline]', function (b) {
      var e = find(b.dataset.decline);
      showModal(
        '<h3>Decline ' + escapeHtml(e.name) + '?</h3>'
        + '<p class="hint">Their photo is deleted. You can say why, for your own records; it is not sent to them.</p>'
        + '<form id="declineForm"><div class="field"><label>Reason (optional)</label><input type="text" id="dcReason" maxlength="200" placeholder="We could not place you"></div>'
        + '<div style="display:flex; gap:10px; margin-top:18px;"><button type="submit" class="btn btn-primary">Decline</button>'
        + '<button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button></div></form>'
      );
      wireCancel();
      document.getElementById('declineForm').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var reason = document.getElementById('dcReason').value;
        closeModal();
        act(function () { return decide(cfg, e.id, 'decline', reason); }, 'Declined');
      });
    });

    var dv = document.createElement('div');
    el.appendChild(dv);
    try { await detailsPanel(dv, cfg); }
    catch (err) { dv.innerHTML = '<p class="muted">The details sent through the alumni link could not be loaded.</p>'; }
  }

  // ------------------------------------- what alumni sent through the shared link
  // Not the wall: nothing here is public. It is the list the alumni team builds
  // Alumni Connect from, so it can be downloaded, and each person marked as they
  // are invited and then added.
  var DETAIL_STATUS = { new: 'New', invited: 'Invited', added: 'Added to Alumni Connect', dismissed: 'Dismissed' };
  async function detailsPanel(el, cfg) {
    var data = await fetchJSON(cfg.base + '/details');
    var yes = function (v) { return v ? 'Yes' : 'No'; };
    el.innerHTML =
      '<h3 style="margin-top:34px;">Details for Alumni Connect (' + data.counts.new + ' new)</h3>'
      + '<p class="hint">Sent through the shared alumni form. Nothing here is public. Use it to invite people into Alumni Connect, then mark them as you go.'
      + ' What they agreed to is in the last column: only people who agreed to be shown may be listed for members, and their email or phone only if they said so.</p>'
      + '<p><a class="btn btn-outline btn-sm" href="' + cfg.base + '/details.csv">Download as a spreadsheet</a></p>'
      + '<div class="table-wrap" tabindex="0"><table class="portal-table"><thead><tr><th>Name</th><th>Work</th><th>Where</th><th>Reach them</th><th>Agreed</th><th>Status</th><th></th></tr></thead><tbody>'
      + (data.items.length ? data.items.map(function (d) {
          return '<tr><td><strong>' + escapeHtml(d.name) + '</strong><br><small class="muted">' + escapeHtml(d.chapterName || d.chapterId)
            + (d.classOf ? ' · class of ' + escapeHtml(d.classOf) : '') + (d.programme ? '<br>' + escapeHtml(d.programme) : '') + '<br>' + escapeHtml(when(d.createdAt)) + '</small></td>'
            + '<td>' + escapeHtml([d.profession, d.organisation].filter(Boolean).join(' at ')) + (d.industry ? '<br><small class="muted">' + escapeHtml(d.industry) + '</small>' : '')
            + (d.openToMentoring ? '<br><small>Open to mentoring</small>' : '') + '</td>'
            + '<td>' + escapeHtml([d.city, d.country].filter(Boolean).join(', ')) + '</td>'
            + '<td>' + (d.email ? escapeHtml(d.email) : '') + (d.email && d.phone ? '<br>' : '') + (d.phone ? escapeHtml(d.phone) : '') + '</td>'
            + '<td><small>Shown to members: ' + yes(d.shareWithMembers) + '<br>Contact shown: ' + yes(d.showContact) + '</small></td>'
            + '<td><label class="sr-only" for="ds-' + d.id + '">Status of ' + escapeHtml(d.name) + '</label><select id="ds-' + d.id + '" data-detail-status="' + d.id + '">'
            + Object.keys(DETAIL_STATUS).map(function (k) { return '<option value="' + k + '"' + (d.status === k ? ' selected' : '') + '>' + DETAIL_STATUS[k] + '</option>'; }).join('') + '</select></td>'
            + '<td><button class="btn btn-outline btn-sm" data-detail-remove="' + d.id + '">Delete</button></td></tr>';
        }).join('') : '<tr><td colspan="7" class="muted">Nothing yet. Share the alumni form link and what people send appears here.</td></tr>')
      + '</tbody></table></div>';
    el.querySelectorAll('[data-detail-status]').forEach(function (sel) {
      sel.addEventListener('change', async function () {
        try {
          await fetchJSON(cfg.base + '/details/' + sel.dataset.detailStatus + '/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: sel.value }) });
          showToast('Marked as ' + DETAIL_STATUS[sel.value].toLowerCase(), 'success');
        } catch (err) { showToast(err.message || 'Could not do that.', 'error'); cfg.reopen(); }
      });
    });
    el.querySelectorAll('[data-detail-remove]').forEach(function (b) {
      b.addEventListener('click', async function () {
        if (!confirm('Delete these details for good?')) return;
        try { await fetchJSON(cfg.base + '/details/' + b.dataset.detailRemove, { method: 'DELETE' }); showToast('Deleted', 'success'); cfg.reopen(); }
        catch (err) { showToast(err.message || 'Could not do that.', 'error'); }
      });
    });
  }

  // ------------------------------------------------- a chapter proposes a theme
  // cfg: { reopen }
  async function themeProposalPanel(el, cfg) {
    var data = await fetchJSON('/api/admin/themes');
    var editing = null;

    function draw() {
      var t = editing;
      var month = t ? t.month : data.nextMonth;
      var chip = function (x) {
        return x.status === 'approved' ? '<span class="cl-chip live">Approved · live</span>'
          : x.status === 'declined' ? '<span class="cl-chip no">Declined</span>' : '<span class="cl-chip wait">Waiting for National</span>';
      };
      el.innerHTML =
        '<div class="panel-head"><div><h2>Monthly Theme</h2>'
        + '<p class="sub">The church has one theme a month, with its meditative prayer flyers. Send the one for an upcoming month here. It does not show anywhere until National approves it.</p></div></div>'
        + (data.live.length ? '<div class="cl-card"><h3>Already approved</h3>' + data.live.map(function (x) {
            return '<p style="margin:0 0 4px;"><strong>' + escapeHtml(monthName(x.month)) + '</strong> · ' + escapeHtml(x.title) + '</p>';
          }).join('') + '<p class="cl-note">You can still send a different one for these months; National chooses.</p></div>' : '')
        + '<form class="cl-card" id="proposeForm"><h3>' + (t ? 'Edit your proposal' : 'Send a theme for approval') + '</h3>'
        + '<div class="field"><label>Month</label><input type="month" id="thMonth" value="' + escapeHtml(month) + '" min="' + escapeHtml(data.month) + '" required ' + (t ? 'disabled' : '') + '></div>'
        + '<div class="field"><label>Theme</label><input type="text" id="thTitle" maxlength="120" value="' + escapeHtml(t && t.title || '') + '" required></div>'
        + '<div class="field"><label>Scripture (optional)</label><input type="text" id="thScripture" maxlength="200" value="' + escapeHtml(t && t.scripture || '') + '"></div>'
        + '<div class="field"><label>A few lines (optional)</label><textarea id="thBlurb" rows="3" maxlength="1200">' + escapeHtml(t && t.blurb || '') + '</textarea></div>'
        + '<div class="field"><label>Prayer flyers (optional, up to 6 pictures)</label>'
        + (t && t.flyerFileIds.length ? '<div class="flyer-keep">' + t.flyerFileIds.map(function (id) {
            return '<label><img src="/api/files/' + encodeURIComponent(id) + '" alt=""><input type="checkbox" data-keep="' + escapeHtml(id) + '" checked> keep</label>';
          }).join('') + '</div>' : '')
        + '<input type="file" id="thFlyers" accept="image/*" multiple></div>'
        + '<div style="margin-top:18px;"><button class="btn btn-primary">' + (t ? 'Send again' : 'Send for approval') + '</button>'
        + (t ? '<button type="button" class="btn btn-outline" id="thNew" style="margin-left:8px;">Cancel</button>' : '')
        + ' <span class="form-msg" id="thMsg"></span></div></form>'
        + '<h3>Your proposals</h3>'
        + (data.items.length ? '<div class="cl-proposals">' + data.items.map(function (x) {
            return '<div class="cl-proposal">'
              + (x.flyerFileIds.length ? '<div class="cl-flyers">' + x.flyerFileIds.slice(0, 3).map(function (id) { return '<img src="/api/files/' + encodeURIComponent(id) + '" alt="">'; }).join('') + '</div>' : '')
              + '<div style="flex:1; min-width:0;"><h4>' + escapeHtml(x.title) + ' ' + chip(x) + '</h4>'
              + '<p class="meta">' + escapeHtml(monthName(x.month)) + (x.scripture ? ' · ' + escapeHtml(x.scripture) : '') + '</p>'
              + (x.status === 'declined' && x.declineReason ? '<p><strong>Why:</strong> ' + escapeHtml(x.declineReason) + '</p>' : '')
              + (x.status === 'approved' ? '<p class="cl-note">It is live. Ask National if it needs to change.</p>'
                  : '<div class="row-actions"><button data-edit-theme="' + x.id + '">Edit</button><button data-withdraw="' + x.id + '" class="danger">Withdraw</button></div>')
              + '</div></div>';
          }).join('') + '</div>' : '<p class="muted">You have not sent one yet.</p>');

      document.getElementById('proposeForm').addEventListener('submit', async function (ev) {
        ev.preventDefault();
        var body = new FormData();
        body.append('title', document.getElementById('thTitle').value);
        body.append('scripture', document.getElementById('thScripture').value);
        body.append('blurb', document.getElementById('thBlurb').value);
        body.append('keepFlyers', JSON.stringify([].slice.call(el.querySelectorAll('[data-keep]')).filter(function (c) { return c.checked; }).map(function (c) { return c.dataset.keep; })));
        [].slice.call(document.getElementById('thFlyers').files).forEach(function (f) { body.append('flyers', f); });
        var m = t ? t.month : document.getElementById('thMonth').value;
        try {
          await sendForm('/api/admin/themes/' + encodeURIComponent(m), 'PUT', body);
          showToast('Sent to National for approval', 'success');
          cfg.reopen();
        } catch (err) { say('thMsg', err.message || 'Could not send.', 'error'); }
      });
      var cancel = document.getElementById('thNew');
      if (cancel) cancel.addEventListener('click', function () { editing = null; draw(); });
      el.querySelectorAll('[data-edit-theme]').forEach(function (b) {
        b.addEventListener('click', function () {
          editing = data.items.find(function (x) { return x.id === b.dataset.editTheme; });
          draw();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });
      el.querySelectorAll('[data-withdraw]').forEach(function (b) {
        b.addEventListener('click', async function () {
          if (!confirm('Withdraw this proposal, and delete its flyers?')) return;
          try { await fetchJSON('/api/admin/themes/' + encodeURIComponent(b.dataset.withdraw), { method: 'DELETE' }); showToast('Withdrawn', 'success'); cfg.reopen(); }
          catch (err) { showToast(err.message || 'Could not withdraw.', 'error'); }
        });
      });
    }
    draw();
  }

  window.ChurchLifeUI = { alumniPanel: alumniPanel, themeProposalPanel: themeProposalPanel, monthName: monthName, thumb: thumb, when: when, sendForm: sendForm, say: say, wireCancel: wireCancel };
})();
