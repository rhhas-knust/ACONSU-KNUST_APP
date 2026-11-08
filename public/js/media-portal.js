/* ============================================================
   Media Portal. The live stream of the service, and the sermons.
   The service is streamed on YouTube (see "How to stream"); this is
   the control room around it: say it is on, end it, keep the
   recording as the sermon. Server: routes/media.js.
   ============================================================ */

const MEDIA = { overview: null };
const isoDay = (d) => { const x = new Date(d); const p = (n) => String(n).padStart(2, '0'); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`; };
const whenText = (d) => new Date(d).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const timeText = (d) => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const appLiveLink = () => `${location.origin}/content.html?kind=live_service`;
const sendJSON = (url, method, body) => fetchJSON(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
const readOnlyNote = () => (PORTAL.canEdit ? '' : '<div class="flag-warn">You can look here, but only the Media office can make changes.</div>');

async function loadOverview() {
  MEDIA.overview = await fetchJSON('/api/media/overview');
  return MEDIA.overview;
}

// A picture and a title for each of the channel's latest videos, to pick one.
async function channelPicker(boxId, onPick, opts) {
  const box = document.getElementById(boxId);
  box.innerHTML = '<p class="muted">Looking at the channel...</p>';
  try {
    const data = await fetchJSON('/api/media/youtube/recent');
    if (data.error) { box.innerHTML = `<p class="muted">${escapeHtml(data.error)}</p>`; return; }
    const items = (opts && opts.hideSermons) ? data.items.filter(v => !v.isSermon) : data.items;
    if (!items.length) { box.innerHTML = '<p class="muted">Nothing new on the channel.</p>'; return; }
    box.innerHTML = `<div class="yt-pick">${items.map((v, i) => `
      <button type="button" class="yt-pick-item" data-pick="${i}">
        <img src="${escapeHtml(v.thumbnailUrl)}" alt="" loading="lazy">
        <span><strong>${escapeHtml(v.title)}</strong><small class="muted">${escapeHtml(formatDate(v.published))}${v.isSermon ? ' · already a sermon' : ''}</small></span>
      </button>`).join('')}</div>`;
    box.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => { onPick(items[Number(b.dataset.pick)]); box.innerHTML = ''; }));
  } catch (err) { box.innerHTML = `<p class="muted">${escapeHtml(err.message || 'Could not read the channel.')}</p>`; }
}

// Paste a link: show what it is, so a wrong one is caught before Sunday's
// members are sent to it.
function wireLinkPreview(inputId, previewId, onTitle) {
  const input = document.getElementById(inputId);
  const show = async () => {
    const box = document.getElementById(previewId);
    const v = input.value.trim();
    if (!v) { box.innerHTML = ''; return; }
    try {
      const info = await fetchJSON(`/api/media/youtube/lookup?url=${encodeURIComponent(v)}`);
      box.innerHTML = `<div class="yt-preview"><img src="${escapeHtml(info.thumbnailUrl)}" alt=""><div><strong>${escapeHtml(info.title || 'A YouTube video')}</strong>${info.channel ? `<small class="muted">${escapeHtml(info.channel)}</small>` : ''}${info.note ? `<small>${escapeHtml(info.note)}</small>` : ''}</div></div>`;
      if (info.title && onTitle) onTitle(info);
    } catch (err) { box.innerHTML = `<p class="form-msg error">${escapeHtml(err.message)}</p>`; }
  };
  input.addEventListener('change', show);
  return show;
}

// ---------- Go Live ----------
async function renderLive(el) {
  const o = await loadOverview();
  const today = new Date();
  const defaultTitle = `${o.setup.serviceTitle} · ${today.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`;
  const live = o.live;
  const shareText = live ? `We are live: ${live.title}. Join the service here: ${appLiveLink()}` : '';

  el.innerHTML = `
    <div class="panel-head"><div>
      <h2>Go Live</h2>
      <p class="sub">Start the stream on YouTube first (see How to stream). Then press Go live here: the app shows a Live now banner and members get an alert.</p>
    </div></div>
    ${readOnlyNote()}
    ${!o.setup.youtubeChannelId ? '<div class="flag-warn">Add the church\'s YouTube channel in <button type="button" class="link-btn" data-open="setup">Media Setup</button> so you can pick the stream instead of pasting its link.</div>' : ''}

    ${live ? `
    <section class="portal-card media-on-air" aria-live="polite">
      <p class="media-state"><span class="live-dot"></span> Live now, since ${escapeHtml(timeText(live.wentLiveAt))}</p>
      <h3>${escapeHtml(live.title)}</h3>
      ${live.summary ? `<p class="muted">${escapeHtml(live.summary)}</p>` : ''}
      <div class="media-actions">
        <a class="btn btn-outline" href="${escapeHtml(live.previewUrl)}" target="_blank" rel="noopener">Open on YouTube</a>
        <a class="btn btn-outline" href="https://wa.me/?text=${encodeURIComponent(shareText)}" target="_blank" rel="noopener">Share on WhatsApp</a>
        <button type="button" class="btn btn-outline" id="copyLiveLink">Copy the link</button>
        ${PORTAL.canEdit ? '<button type="button" class="btn btn-outline danger" id="endLive">End the stream</button>' : ''}
      </div>
      <p class="tiny muted">End it here once you have ended it on YouTube. The recording stays on YouTube, and you can keep it as the sermon.</p>
    </section>` : (PORTAL.canEdit ? `
    <form class="portal-card" id="goLiveForm">
      <h3>Go live</h3>
      <div class="field"><label for="glTitle">Title</label><input type="text" id="glTitle" maxlength="120" value="${escapeHtml(defaultTitle)}" required></div>
      <div class="field"><label for="glUrl">The stream's YouTube link</label>
        <input type="url" id="glUrl" placeholder="https://youtube.com/live/..." required inputmode="url">
        <div id="glPreview"></div>
        ${o.setup.youtubeChannelId ? '<button type="button" class="btn btn-outline btn-sm" id="glPick" style="margin-top:8px;">Pick it from the channel</button><div id="glPicker"></div>' : ''}
        <small class="tiny muted">In YouTube Studio: the stream, then Share, then Copy. A stream set to Private cannot be watched; use Public or Unlisted.</small>
      </div>
      <div class="field"><label for="glPreacher">Preaching (optional)</label><input type="text" id="glPreacher" maxlength="120" placeholder="Rev. Mensah"></div>
      <div class="field-check"><input type="checkbox" id="glNotify" checked><label for="glNotify">Send members an alert that the service is live</label></div>
      <div class="field" id="glLaterWrap" hidden><label for="glStartsAt">Starts at</label><input type="datetime-local" id="glStartsAt"></div>
      <div class="media-actions">
        <button class="btn btn-primary" id="glNow">Go live now</button>
        <button type="button" class="btn btn-outline" id="glLater">Set it up for later</button>
      </div>
      <span class="form-msg" id="glMsg"></span>
    </form>` : '<div class="portal-card"><p class="muted">Nothing is live right now.</p></div>')}

    ${o.toKeep.length ? `<h3>Keep the recording as a sermon</h3>
      ${o.toKeep.map(s => `<form class="portal-card keep-form" data-keep="${escapeHtml(s.id)}">
        <p class="muted">${escapeHtml(formatDate(s.startsAt || s.createdAt))}: ${escapeHtml(s.title)}</p>
        <div class="field"><label>Sermon title</label><input type="text" name="title" maxlength="160" value="${escapeHtml(s.title)}" required></div>
        <div class="field"><label>Preacher</label><input type="text" name="speaker" maxlength="120" value="${escapeHtml(s.summary || '')}"></div>
        <div class="field-check"><input type="checkbox" name="notify" id="kn-${escapeHtml(s.id)}"><label for="kn-${escapeHtml(s.id)}">Tell members the sermon is up</label></div>
        ${PORTAL.canEdit ? '<button class="btn btn-primary">Keep as sermon</button>' : ''}
        <span class="form-msg"></span>
      </form>`).join('')}` : ''}

    ${o.upcoming.length ? `<h3>Coming up</h3>
      <div class="table-wrap"><table class="portal-table"><thead><tr><th>When</th><th>Stream</th><th></th></tr></thead><tbody>
      ${o.upcoming.map(s => `<tr><td>${escapeHtml(whenText(s.startsAt))}</td><td>${escapeHtml(s.title)}${s.summary ? `<br><small class="muted">${escapeHtml(s.summary)}</small>` : ''}</td>
        <td><div class="row-actions">${PORTAL.canEdit ? `<button data-start="${escapeHtml(s.id)}">Go live</button><button class="danger" data-remove="${escapeHtml(s.id)}">Remove</button>` : ''}</div></td></tr>`).join('')}
      </tbody></table></div>` : ''}`;

  el.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openPanel(b.dataset.open)));
  const copy = document.getElementById('copyLiveLink');
  if (copy) copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(appLiveLink()); copy.textContent = 'Copied'; } catch (e) { copy.textContent = appLiveLink(); }
  });
  const end = document.getElementById('endLive');
  if (end) end.addEventListener('click', async () => {
    if (!confirm('End the stream in the app? End it on YouTube too.')) return;
    try { await sendJSON(`/api/media/live/${encodeURIComponent(live.id)}/end`, 'POST'); showToast('Stream ended', 'success'); openPanel('live'); }
    catch (err) { showToast(err.message, 'error'); }
  });

  const form = document.getElementById('goLiveForm');
  if (form) {
    wireLinkPreview('glUrl', 'glPreview');
    const pick = document.getElementById('glPick');
    if (pick) pick.addEventListener('click', () => channelPicker('glPicker', (v) => {
      document.getElementById('glUrl').value = v.url;
      document.getElementById('glUrl').dispatchEvent(new Event('change'));
    }));
    let later = false;
    const send = async () => {
      const body = {
        title: document.getElementById('glTitle').value,
        url: document.getElementById('glUrl').value,
        preacher: document.getElementById('glPreacher').value,
        notify: document.getElementById('glNotify').checked,
        when: later ? 'later' : 'now'
      };
      if (later) {
        const at = document.getElementById('glStartsAt').value;
        if (!at) { setFormMsg('glMsg', 'Choose when it starts.', 'error'); return; }
        body.startsAt = new Date(at).toISOString();
      }
      try {
        await sendJSON('/api/media/live', 'POST', body);
        showToast(later ? 'Set up. Press Go live when the service starts.' : 'You are live in the app', 'success');
        openPanel('live');
      } catch (err) { setFormMsg('glMsg', err.message, 'error'); }
    };
    document.getElementById('glLater').addEventListener('click', () => {
      if (!later) {
        later = true;
        document.getElementById('glLaterWrap').hidden = false;
        document.getElementById('glNow').textContent = 'Save for later';
        document.getElementById('glLater').hidden = true;
        document.getElementById('glNotify').closest('.field-check').hidden = true;
        const next = new Date(); next.setDate(next.getDate() + ((7 - next.getDay()) % 7 || 7)); next.setHours(9, 0, 0, 0);
        document.getElementById('glStartsAt').value = toLocalInputValue(next);
      }
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); send(); });
  }

  el.querySelectorAll('.keep-form').forEach(f => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = f.querySelector('.form-msg');
    try {
      await sendJSON(`/api/media/live/${encodeURIComponent(f.dataset.keep)}/sermon`, 'POST', {
        title: f.elements.title.value, speaker: f.elements.speaker.value, notify: f.elements.notify.checked
      });
      showToast('Kept as a sermon', 'success');
      openPanel('live');
    } catch (err) { msg.textContent = err.message; msg.className = 'form-msg error'; }
  }));
  el.querySelectorAll('[data-start]').forEach(b => b.addEventListener('click', async () => {
    const notify = confirm('Send members an alert that the service is live? (Cancel goes live without one.)');
    try { await sendJSON(`/api/media/live/${encodeURIComponent(b.dataset.start)}/start`, 'POST', { notify }); showToast('You are live in the app', 'success'); openPanel('live'); }
    catch (err) { showToast(err.message, 'error'); }
  }));
  el.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Remove this stream from the app?')) return;
    try { await fetchJSON(`/api/media/live/${encodeURIComponent(b.dataset.remove)}`, { method: 'DELETE' }); showToast('Removed', 'success'); openPanel('live'); }
    catch (err) { showToast(err.message, 'error'); }
  }));
}

// ---------- Sermons ----------
async function renderSermons(el) {
  const [items, o] = await Promise.all([fetchJSON('/api/media/sermons'), MEDIA.overview ? Promise.resolve(MEDIA.overview) : loadOverview()]);
  let editing = null;

  function draw() {
    const s = editing;
    el.innerHTML = `
      <div class="panel-head"><div>
        <h2>Sermons</h2>
        <p class="sub">What members find on the Sermons page. A stream you kept is already here. Add a sermon from a YouTube video, or a link to an audio recording.</p>
      </div></div>
      ${readOnlyNote()}
      ${PORTAL.canEdit ? `<form class="portal-card" id="sermonForm">
        <h3>${s ? 'Edit the sermon' : 'Add a sermon'}</h3>
        ${!s && o.setup.youtubeChannelId ? '<button type="button" class="btn btn-outline btn-sm" id="smPick">Add from the channel</button><div id="smPicker"></div>' : ''}
        <div class="field"><label for="smUrl">Link</label><input type="url" id="smUrl" inputmode="url" value="${escapeHtml(s?.url || '')}" placeholder="https://youtu.be/... or a link to the audio"><div id="smPreview"></div></div>
        <div class="field"><label for="smTitle">Title</label><input type="text" id="smTitle" maxlength="160" value="${escapeHtml(s?.title || '')}" required></div>
        <div class="field-row">
          <div class="field"><label for="smSpeaker">Preacher</label><input type="text" id="smSpeaker" maxlength="120" value="${escapeHtml(s?.speaker || '')}"></div>
          <div class="field"><label for="smDate">Date</label><input type="date" id="smDate" value="${escapeHtml(s?.date || isoDay(Date.now()))}"></div>
        </div>
        <div class="field"><label for="smType">Kind</label><select id="smType"><option value="video"${s?.type !== 'audio' ? ' selected' : ''}>Video</option><option value="audio"${s?.type === 'audio' ? ' selected' : ''}>Audio</option></select></div>
        <div class="field"><label for="smDesc">A few lines (optional)</label><textarea id="smDesc" rows="3" maxlength="2000">${escapeHtml(s?.description || '')}</textarea></div>
        ${!s ? '<div class="field-check"><input type="checkbox" id="smNotify" checked><label for="smNotify">Tell members the sermon is up</label></div>' : ''}
        <div class="media-actions">
          <button class="btn btn-primary">${s ? 'Save' : 'Add the sermon'}</button>
          ${s ? '<button type="button" class="btn btn-outline" id="smCancel">Cancel</button>' : ''}
        </div>
        <span class="form-msg" id="smMsg"></span>
      </form>` : ''}
      <div class="table-wrap"><table class="portal-table"><thead><tr><th>Date</th><th>Sermon</th><th></th></tr></thead><tbody>
        ${items.length ? items.map(x => `<tr>
          <td>${escapeHtml(x.date ? formatDate(x.date) : '')}</td>
          <td><strong>${escapeHtml(x.title)}</strong>${x.speaker ? `<br><small class="muted">${escapeHtml(x.speaker)}</small>` : ''}${x.url ? '' : '<br><small class="muted">No link yet</small>'}</td>
          <td><div class="row-actions">${x.url ? `<a href="${escapeHtml(x.url)}" target="_blank" rel="noopener">Open</a>` : ''}${PORTAL.canEdit ? `<button data-edit="${escapeHtml(x.id)}">Edit</button><button class="danger" data-del="${escapeHtml(x.id)}">Remove</button>` : ''}</div></td>
        </tr>`).join('') : '<tr><td colspan="3" class="muted">No sermons yet.</td></tr>'}
      </tbody></table></div>`;

    const form = document.getElementById('sermonForm');
    if (form) {
      wireLinkPreview('smUrl', 'smPreview', (info) => {
        const t = document.getElementById('smTitle');
        if (!t.value) t.value = info.title;
        document.getElementById('smType').value = 'video';
      });
      const pick = document.getElementById('smPick');
      if (pick) pick.addEventListener('click', () => channelPicker('smPicker', (v) => {
        document.getElementById('smUrl').value = v.url;
        document.getElementById('smTitle').value = v.title;
        if (v.published) document.getElementById('smDate').value = isoDay(v.published);
        document.getElementById('smUrl').dispatchEvent(new Event('change'));
      }, { hideSermons: true }));
      const cancel = document.getElementById('smCancel');
      if (cancel) cancel.addEventListener('click', () => { editing = null; draw(); });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = {
          title: document.getElementById('smTitle').value,
          url: document.getElementById('smUrl').value,
          speaker: document.getElementById('smSpeaker').value,
          date: document.getElementById('smDate').value,
          type: document.getElementById('smType').value,
          description: document.getElementById('smDesc').value
        };
        if (!s) body.notify = document.getElementById('smNotify').checked;
        try {
          await sendJSON(s ? `/api/media/sermons/${encodeURIComponent(s.id)}` : '/api/media/sermons', s ? 'PUT' : 'POST', body);
          showToast(s ? 'Saved' : 'Sermon added', 'success');
          openPanel('sermons');
        } catch (err) { setFormMsg('smMsg', err.message, 'error'); }
      });
    }
    el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
      editing = items.find(x => x.id === b.dataset.edit); draw(); window.scrollTo({ top: 0, behavior: 'smooth' });
    }));
    el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Remove this sermon from the app? The video stays on YouTube.')) return;
      try { await fetchJSON(`/api/media/sermons/${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' }); showToast('Removed', 'success'); openPanel('sermons'); }
      catch (err) { showToast(err.message, 'error'); }
    }));
  }
  draw();
}

// ---------- This Sunday's checklist ----------
// Shared: whoever ticks a step, the rest of the team sees it ticked.
const CHECKLIST = [
  { head: 'Before the service', steps: [
    ['internet', 'Data bundle bought, and the upload speed checked (at least 5 Mbps for 720p)'],
    ['battery', 'Phone or laptop charged, and the charger plugged in'],
    ['audio', 'Sound from the desk reaches the stream: listened to with headphones'],
    ['camera', 'Camera steady on a tripod, framed on the pulpit, not on a bright window'],
    ['slides', 'Song words and Bible readings ready'],
    ['title', 'Stream title and picture set on YouTube, set to Public or Unlisted'],
    ['golive', 'Stream started on YouTube a few minutes early, then Go live pressed here']
  ] },
  { head: 'During the service', steps: [
    ['share', 'Link shared in the chapter WhatsApp groups'],
    ['watch', 'Someone watches the stream on another phone, with headphones, and says if sound or picture drops'],
    ['chat', 'Someone welcomes people and answers the comments']
  ] },
  { head: 'After the service', steps: [
    ['end', 'Stream ended on YouTube, and here'],
    ['sermon', 'Recording kept as the sermon'],
    ['pack', 'Equipment packed away, batteries on charge, anything broken told to the Media Head']
  ] }
];

async function renderChecklist(el) {
  const o = await loadOverview();
  const done = new Set(o.checklist.done);
  const total = CHECKLIST.reduce((n, g) => n + g.steps.length, 0);
  el.innerHTML = `
    <div class="panel-head"><div>
      <h2>Sunday Checklist</h2>
      <p class="sub">Today's list, shared by the whole team: a step one of you ticks is ticked for everyone. It starts clear each day.</p>
    </div></div>
    <p class="media-progress" id="clCount">${done.size} of ${total} done</p>
    ${CHECKLIST.map(g => `<section class="portal-card"><h3>${escapeHtml(g.head)}</h3>
      <ul class="media-checklist">${g.steps.map(([k, label]) => `<li><input type="checkbox" id="cl-${k}" data-step="${k}"${done.has(k) ? ' checked' : ''}${PORTAL.canEdit ? '' : ' disabled'}><label for="cl-${k}">${escapeHtml(label)}</label></li>`).join('')}</ul>
    </section>`).join('')}`;
  el.querySelectorAll('[data-step]').forEach(c => c.addEventListener('change', async () => {
    const now = [...el.querySelectorAll('[data-step]:checked')].map(x => x.dataset.step);
    document.getElementById('clCount').textContent = `${now.length} of ${total} done`;
    try { await sendJSON('/api/media/checklist', 'PUT', { done: now }); }
    catch (err) { showToast(err.message || 'Not saved', 'error'); c.checked = !c.checked; }
  }));
}

// ---------- How to stream ----------
function renderGuide(el) {
  el.innerHTML = `
    <div class="panel-head"><div>
      <h2>How to stream</h2>
      <p class="sub">Everything here is free. The service goes out on the church's YouTube channel; the app shows it and keeps it.</p>
    </div></div>

    <section class="portal-card media-guide">
      <h3>Once, a day or more before the first stream</h3>
      <ol>
        <li>Sign in to YouTube with the church's Google account (not a personal one, so the channel stays with the church when the team changes).</li>
        <li>Open YouTube Studio and choose Create, then Go live. YouTube switches live streaming on for the channel. The first time it can take up to 24 hours, so do this well before Sunday.</li>
        <li>Find the channel ID: YouTube Studio, Settings, Channel, Advanced settings. It starts with UC. Put it in Media Setup.</li>
      </ol>
      <button type="button" class="btn btn-outline" data-open="setup">Open Media Setup</button>
    </section>

    <section class="portal-card media-guide">
      <h3>From a laptop (the best picture)</h3>
      <p>A laptop can stream from a brand-new channel, with no subscribers needed.</p>
      <ol>
        <li>Install <a href="https://obsproject.com" target="_blank" rel="noopener">OBS Studio</a> (free, Windows, Mac and Linux).</li>
        <li>In YouTube Studio, Go live, Stream: copy the stream key. In OBS: Settings, Stream, choose YouTube, and paste the key (or connect the account).</li>
        <li>In OBS add the camera (a webcam, a camera through a capture card, or a phone used as a camera) and the sound from the desk as the audio.</li>
        <li>Settings, Output: 1280 by 720 at 30 frames, video bitrate 2500 to 3000 kbps. If the internet is weak, 854 by 480 at 1000 to 1500 kbps.</li>
        <li>Press Start Streaming in OBS. When YouTube shows the picture, press Go live in this portal.</li>
      </ol>
    </section>

    <section class="portal-card media-guide">
      <h3>From a phone</h3>
      <ul>
        <li><strong>The YouTube app</strong> (Create, Go live) is the easiest, but YouTube asks for at least 50 subscribers on the channel first.</li>
        <li><strong>Before that</strong>, use <a href="https://softvelum.com/larix/" target="_blank" rel="noopener">Larix Broadcaster</a> (free, iPhone and Android). In YouTube Studio, Go live, Stream, copy the stream URL (rtmp://a.rtmp.youtube.com/live2) and the stream key into Larix.</li>
        <li>Put the phone on a tripod, sideways, plugged into a charger. Turn on Do not disturb so a call does not stop the stream.</li>
        <li>The phone's own microphone hears the room, not the preacher. A cable from the sound desk into the phone (through a small audio adapter) sounds far better.</li>
      </ul>
    </section>

    <section class="portal-card media-guide">
      <h3>Internet and data</h3>
      <ul>
        <li>An hour at 720p uses about 1.3 GB of upload; at 480p about 0.6 GB. Buy the bundle before Sunday, with some to spare.</li>
        <li>Check the upload speed at the venue (<a href="https://fast.com" target="_blank" rel="noopener">fast.com</a>, show more info). You want at least 5 Mbps up for 720p, 2 Mbps for 480p.</li>
        <li>Wi-Fi or a router is steadier than a phone's own data. Start a test stream (Unlisted) the week before, in the same spot.</li>
      </ul>
    </section>

    <section class="portal-card media-guide">
      <h3>Songs on screen, and music rights</h3>
      <ul>
        <li>Free software for song words and Bible verses on the screen and in the stream: <a href="https://freeshow.app" target="_blank" rel="noopener">FreeShow</a> and <a href="https://openlp.org" target="_blank" rel="noopener">OpenLP</a>.</li>
        <li>YouTube may mute or take down a stream that plays recorded music (a CD or a backing track). Live singing is safer, but worship songs are still owned by their writers: <a href="https://ccli.com" target="_blank" rel="noopener">CCLI</a> sells a streaming licence. Ask them whether it covers Ghana before relying on it.</li>
        <li>A picture for each stream and sermon can be made free in <a href="https://www.canva.com" target="_blank" rel="noopener">Canva</a> (1280 by 720).</li>
      </ul>
    </section>

    <section class="portal-card media-guide">
      <h3>On Sunday</h3>
      <ol>
        <li>Work down the Sunday Checklist with the team.</li>
        <li>Start the stream on YouTube a few minutes before the service.</li>
        <li>Here: Go Live, pick or paste the stream, Go live now. Members get the alert and see Live now on the home page.</li>
        <li>After the service: end it on YouTube, then End the stream here, then Keep as sermon.</li>
      </ol>
      <button type="button" class="btn btn-outline" data-open="checklist">Open the Sunday Checklist</button>
    </section>`;
  el.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openPanel(b.dataset.open)));
}

// ---------- Setup ----------
async function renderSetup(el) {
  const o = await loadOverview();
  el.innerHTML = `
    <div class="panel-head"><div>
      <h2>Media Setup</h2>
      <p class="sub">The church's YouTube channel, so streams and sermons can be picked from it instead of pasted.</p>
    </div></div>
    ${readOnlyNote()}
    <form class="portal-card" id="setupForm">
      <div class="field"><label for="suChannel">YouTube channel ID</label>
        <input type="text" id="suChannel" value="${escapeHtml(o.setup.youtubeChannelId)}" placeholder="UC..." autocomplete="off" spellcheck="false"${PORTAL.canEdit ? '' : ' disabled'}>
        <small class="tiny muted">YouTube Studio, Settings, Channel, Advanced settings. It starts with UC. The channel's address (youtube.com/channel/UC...) works too; an @name does not.</small>
      </div>
      <div class="field"><label for="suTitle">Usual name of the service</label>
        <input type="text" id="suTitle" maxlength="80" value="${escapeHtml(o.setup.serviceTitle)}"${PORTAL.canEdit ? '' : ' disabled'}>
        <small class="tiny muted">Go Live starts with this and the date, for example "${escapeHtml(o.setup.serviceTitle)} · 8 November".</small>
      </div>
      ${PORTAL.canEdit ? '<button class="btn btn-primary">Save</button>' : ''}
      <span class="form-msg" id="suMsg"></span>
    </form>
    ${o.setup.youtubeChannelId ? '<h3>The channel\'s latest videos</h3><div id="suRecent"></div>' : ''}`;
  if (o.setup.youtubeChannelId) channelPicker('suRecent', (v) => window.open(v.url, '_blank', 'noopener'));
  document.getElementById('setupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await sendJSON('/api/media/setup', 'PUT', { youtubeChannel: document.getElementById('suChannel').value, serviceTitle: document.getElementById('suTitle').value });
      showToast('Saved', 'success');
      openPanel('setup');
    } catch (err) { setFormMsg('suMsg', err.message, 'error'); }
  });
}

initPortal({
  role: 'media',
  label: 'Media',
  today: {
    intro: 'The live stream and the sermons.',
    actions: [
      { panel: 'live', label: 'Go live' },
      { panel: 'live', label: 'Recordings', count: async (get) => (await get('/api/media/overview')).toKeep.length, one: 'to keep as a sermon', many: 'to keep as sermons' },
      { panel: 'checklist', label: 'Sunday Checklist' },
      { panel: 'sermons', label: 'Sermons' }
    ],
    checklist: [
      { key: 'setup', label: 'Add the church\'s YouTube channel' },
      { key: 'guide', label: 'Read How to stream' },
      { key: 'sermons', label: 'Add a sermon' }
    ]
  },
  panels: [
    { key: 'live', label: 'Go Live', render: renderLive },
    { key: 'sermons', label: 'Sermons', render: renderSermons },
    { key: 'checklist', label: 'Sunday Checklist', render: renderChecklist },
    { key: 'guide', label: 'How to stream', render: renderGuide },
    { key: 'setup', label: 'Media Setup', render: renderSetup },
    { key: 'account', label: 'My Account', render: (el) => PortalAccount.render(el) }
  ]
});
