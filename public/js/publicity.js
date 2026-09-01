/* ============================================================
   Publicity Portal — everything the union says to its people.
   In-app announcements, push alerts, SMS, scheduled sends,
   event updates, and the testimony inbox.
   ============================================================ */

const PUB_ROWS_PER_PAGE = 15;
const LINK_TARGETS = [
  { value: '/index.html', label: 'Home' },
  { value: '/events.html', label: 'Events' },
  { value: '/media.html', label: 'Sermons & Media' },
  { value: '/prayer.html', label: 'Prayer Wall' },
  { value: '/bible.html', label: 'Bible' },
  { value: '/departments.html', label: 'Departments' },
  { value: '/notifications.html', label: 'Notifications' }
];

// SMS is charged per 160-character segment, so publicity should always be able
// to see what a message is going to cost before they send it.
function smsSegments(text) {
  return Math.max(1, Math.ceil((text || '').length / 160));
}

// The composer is shared by "send now" and "schedule", because the only real
// difference between them is when it goes out.
function composerFields(audiences, opts) {
  const o = opts || {};
  return `
    <div class="field"><label>Title</label>
      <input type="text" id="cTitle" placeholder="e.g. Service moves to 9:00am this Sunday" required></div>
    <div class="field"><label>Message</label>
      <textarea id="cBody" placeholder="Keep it short and clear — this is what lands on someone's lock screen." required></textarea>
      <small class="tiny muted" id="cCounter"></small>
    </div>
    <div class="field-row">
      <div class="field"><label>Tapping the alert opens</label>
        <select id="cUrl">${LINK_TARGETS.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Who should get it</label>
        <select id="cAudience">
          ${audiences.map(a => `<option value="${a.value}">${escapeHtml(a.label)} — ${a.reachable} reachable by SMS</option>`).join('')}
        </select>
      </div>
    </div>
    <label style="display:block; font-weight:700; font-size:0.85rem; margin-bottom:8px; color:var(--purple-rich);">Channels</label>
    <div class="choice-grid" style="margin-bottom:18px;">
      <label class="choice selected">
        <input type="checkbox" id="chApp" checked>
        <span><strong>In the app</strong><small>Posts to the notifications feed and pushes an alert to phones that allowed it.</small></span>
      </label>
      <label class="choice">
        <input type="checkbox" id="chSms">
        <span><strong>SMS</strong><small>Text message to everyone in the audience with a phone number on file.</small></span>
      </label>
    </div>
    ${o.scheduled ? `
      <div class="field"><label>Send at</label>
        <input type="datetime-local" id="cWhen" value="${toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000))}" required>
        <small class="tiny muted">Uses this device's clock. The server checks for due announcements every minute.</small>
      </div>` : ''}
  `;
}

function wireComposer() {
  const body = document.getElementById('cBody');
  const counter = document.getElementById('cCounter');
  const update = () => {
    const len = (body.value || '').length;
    counter.textContent = document.getElementById('chSms').checked
      ? `${len} characters · ${smsSegments(body.value)} SMS segment${smsSegments(body.value) > 1 ? 's' : ''} per recipient`
      : `${len} characters`;
  };
  body.addEventListener('input', update);
  document.querySelectorAll('.choice input').forEach(cb => {
    cb.addEventListener('change', () => {
      cb.closest('.choice').classList.toggle('selected', cb.checked);
      update();
    });
  });
  update();
}

function readComposer() {
  const channels = [];
  if (document.getElementById('chApp').checked) channels.push('app');
  if (document.getElementById('chSms').checked) channels.push('sms');
  return {
    title: document.getElementById('cTitle').value,
    body: document.getElementById('cBody').value,
    url: document.getElementById('cUrl').value,
    audience: document.getElementById('cAudience').value,
    channels
  };
}

// ---------- overview ----------
async function renderPublicityOverview(el) {
  const overview = await fetchJSON('/api/publicity/overview');

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Publicity Overview</h2>
        <p class="sub">What the union has been saying, and what is queued to go out next.</p>
      </div>
    </div>

    <div class="stat-grid">
      ${statCard('Announcements Sent', overview.notificationsSent)}
      ${statCard('Scheduled', overview.scheduledPending, { tone: 'gold', foot: 'waiting to go out' })}
      ${statCard('SMS Delivered', overview.smsSent, { tone: overview.smsFailed ? 'bad' : 'good', foot: overview.smsFailed ? `${overview.smsFailed} failed` : 'no failures' })}
      ${statCard('Testimonies Waiting', overview.testimoniesPending, { tone: overview.testimoniesPending ? 'gold' : '' })}
    </div>

    <div class="card-split">
      <div class="portal-card">
        <h3>Channel Status</h3>
        <p class="hint">What can actually reach people right now.</p>
        <div class="table-wrap">
          <table class="portal-table" style="min-width:0;">
            <tbody>
              <tr>
                <td><strong>App notifications</strong><br><small class="muted">In-app feed always works</small></td>
                <td>${pill('active', 'green')}</td>
              </tr>
              <tr>
                <td><strong>Push alerts</strong><br><small class="muted">Alerts on phones with the app closed</small></td>
                <td>${overview.pushConfigured ? pill('active', 'green') : pill('not configured', 'grey')}</td>
              </tr>
              <tr>
                <td><strong>SMS</strong><br><small class="muted">Text messages through mNotify</small></td>
                <td>${overview.smsConfigured ? pill('active', 'green') : pill('not configured', 'grey')}</td>
              </tr>
            </tbody>
          </table>
        </div>
        ${!overview.smsConfigured ? '<p class="tiny muted" style="margin-top:12px;">Ask the admin to set MNOTIFY_API_KEY and SMS_SENDER_ID on the server. Until then, SMS sends are logged but nothing leaves.</p>' : ''}
      </div>

      <div class="portal-card">
        <h3>Recently Sent</h3>
        <div class="table-wrap">
          <table class="portal-table" style="min-width:0;">
            <tbody>
              ${overview.recent.map(n => `
                <tr>
                  <td><strong>${escapeHtml(n.title)}</strong><br><small class="muted">${escapeHtml(n.body)}</small></td>
                  <td class="tiny muted">${dateTimeLabel(n.createdAt)}</td>
                </tr>
              `).join('') || '<tr><td class="muted">Nothing sent yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

// ---------- compose & send ----------
async function renderCompose(el) {
  if (!PORTAL.canEdit) {
    el.innerHTML = '<div class="portal-card"><p class="empty-state">Sending announcements is done by the publicity team.</p></div>';
    return;
  }
  const { audiences, smsConfigured } = await fetchJSON('/api/publicity/audiences');

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Send an Announcement</h2>
        <p class="sub">Goes out immediately on whichever channels you pick.</p>
      </div>
    </div>

    <div class="portal-card">
      <form id="sendForm">
        ${composerFields(audiences)}
        ${!smsConfigured ? '<p class="tiny muted" style="margin-bottom:14px;">SMS is not configured on the server yet — ticking it will log the send without delivering anything.</p>' : ''}
        <button type="submit" class="btn btn-primary" id="sendBtn">Send Now</button>
        <div class="form-msg" id="sendMsg"></div>
      </form>
    </div>
  `;

  wireComposer();
  document.getElementById('sendForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = readComposer();
    if (!payload.channels.length) {
      setFormMsg('sendMsg', 'Pick at least one channel.', 'error');
      return;
    }
    const btn = document.getElementById('sendBtn');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const res = await fetchJSON('/api/publicity/notifications', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      setFormMsg('sendMsg', `Sent — ${res.result}`, 'success');
      showToast('Announcement sent.', 'success');
      document.getElementById('sendForm').reset();
      wireComposer();
    } catch (err) {
      setFormMsg('sendMsg', err.message || 'Could not send this announcement.', 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Send Now';
    }
  });
}

// ---------- scheduled ----------
async function renderScheduled(el) {
  const [items, { audiences }] = await Promise.all([
    fetchJSON('/api/publicity/scheduled'),
    fetchJSON('/api/publicity/audiences')
  ]);
  const upcoming = items.filter(i => i.status === 'scheduled');
  const past = items.filter(i => i.status !== 'scheduled');

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Scheduled Announcements</h2>
        <p class="sub">Write it now, let it go out at the right moment — the night before a programme, or first thing on Sunday.</p>
      </div>
    </div>

    ${PORTAL.canEdit ? `
      <div class="portal-card">
        <h3>Schedule a New One</h3>
        <form id="scheduleForm">
          ${composerFields(audiences, { scheduled: true })}
          <button type="submit" class="btn btn-primary" id="scheduleBtn">Schedule It</button>
          <div class="form-msg" id="scheduleMsg"></div>
        </form>
      </div>
    ` : ''}

    <div class="portal-card">
      <h3>Queued (${upcoming.length})</h3>
      <div class="table-wrap">
        <table class="portal-table">
          <thead><tr><th>Going out</th><th>Announcement</th><th>Channels</th><th>Audience</th>${PORTAL.canEdit ? '<th>Actions</th>' : ''}</tr></thead>
          <tbody>
            ${upcoming.map(i => `
              <tr>
                <td><strong>${dateTimeLabel(i.scheduledFor)}</strong></td>
                <td>${escapeHtml(i.title)}<br><small class="muted">${escapeHtml(i.body)}</small></td>
                <td>${i.channels.map(c => pill(c === 'app' ? 'app' : 'SMS', 'grey')).join(' ')}</td>
                <td class="tiny muted">${escapeHtml(i.audience)}</td>
                ${PORTAL.canEdit ? `<td class="row-actions"><button class="danger" data-cancel="${i.id}">Cancel</button></td>` : ''}
              </tr>
            `).join('') || emptyRow(PORTAL.canEdit ? 5 : 4, 'Nothing is queued.')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="portal-card">
      <h3>Already Handled (${past.length})</h3>
      <div class="table-wrap">
        <table class="portal-table">
          <thead><tr><th>Time</th><th>Announcement</th><th>Status</th><th>Outcome</th>${PORTAL.canEdit ? '<th></th>' : ''}</tr></thead>
          <tbody>
            ${paginate(past, 1, PUB_ROWS_PER_PAGE).map(i => `
              <tr>
                <td class="tiny muted">${dateTimeLabel(i.sentAt || i.scheduledFor)}</td>
                <td>${escapeHtml(i.title)}</td>
                <td>${pill(i.status)}</td>
                <td class="tiny muted">${escapeHtml(i.result || '—')}</td>
                ${PORTAL.canEdit ? `<td class="row-actions"><button class="danger" data-remove="${i.id}">Remove</button></td>` : ''}
              </tr>
            `).join('') || emptyRow(PORTAL.canEdit ? 5 : 4, 'Nothing here yet.')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  if (PORTAL.canEdit) {
    wireComposer();
    document.getElementById('scheduleForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = readComposer();
      payload.scheduledFor = new Date(document.getElementById('cWhen').value).toISOString();
      if (!payload.channels.length) {
        setFormMsg('scheduleMsg', 'Pick at least one channel.', 'error');
        return;
      }
      try {
        await fetchJSON('/api/publicity/scheduled', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        showToast('Announcement scheduled.', 'success');
        openPanel('scheduled');
      } catch (err) {
        setFormMsg('scheduleMsg', err.message || 'Could not schedule this.', 'error');
      }
    });
  }

  el.querySelectorAll('[data-cancel]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Cancel this scheduled announcement?')) return;
      await fetchJSON(`/api/publicity/scheduled/${btn.dataset.cancel}/cancel`, { method: 'PATCH' });
      openPanel('scheduled');
    });
  });
  el.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetchJSON(`/api/publicity/scheduled/${btn.dataset.remove}`, { method: 'DELETE' });
      openPanel('scheduled');
    });
  });
}

// ---------- events ----------
async function renderPublicityEvents(el) {
  const events = await fetchJSON('/api/events');
  const now = new Date();
  const sorted = [...events].sort((a, b) => new Date(`${b.date}T${b.time || '00:00'}`) - new Date(`${a.date}T${a.time || '00:00'}`));

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Events (${events.length})</h2>
        <p class="sub">Keep the calendar right, and tell everyone when something moves.</p>
      </div>
      ${PORTAL.canEdit ? '<div class="panel-actions"><button class="btn btn-primary btn-sm" id="addEventBtn">+ Add Event</button></div>' : ''}
    </div>

    <div class="table-wrap">
      <table class="portal-table">
        <thead><tr><th>Event</th><th>When</th><th>Where</th><th>Status</th>${PORTAL.canEdit ? '<th>Actions</th>' : ''}</tr></thead>
        <tbody>
          ${sorted.map(e => {
            const upcoming = new Date(`${e.date}T${e.time || '00:00'}:00`) >= now;
            const statusTone = e.status === 'published' ? (upcoming ? 'green' : 'grey') : e.status === 'rejected' ? 'red' : 'amber';
            return `
              <tr>
                <td><strong>${escapeHtml(e.title)}</strong>${e.recurring ? `<br><small class="muted">${escapeHtml(e.recurring)}</small>` : ''}${e.flyerFileId ? ' 🖼️' : ''}</td>
                <td>${shortDate(e.date)}<br><small class="muted">${escapeHtml(e.time || '')}</small></td>
                <td>${escapeHtml(e.location || '—')}</td>
                <td>${pill(e.status === 'published' ? (upcoming ? 'upcoming' : 'past') : e.status, statusTone)}</td>
                ${PORTAL.canEdit ? `<td class="row-actions"><button data-edit-event="${e.id}">Edit &amp; Announce</button><button data-volunteers="${e.id}">Volunteers</button></td>` : ''}
              </tr>
            `;
          }).join('') || emptyRow(PORTAL.canEdit ? 5 : 4, 'No events on the calendar.')}
        </tbody>
      </table>
    </div>
  `;

  const addBtn = document.getElementById('addEventBtn');
  if (addBtn) addBtn.addEventListener('click', () => openEventForm(null));
  el.querySelectorAll('[data-edit-event]').forEach(btn => {
    btn.addEventListener('click', () => openEventForm(events.find(e => e.id === btn.dataset.editEvent)));
  });
  el.querySelectorAll('[data-volunteers]').forEach(btn => {
    btn.addEventListener('click', () => openVolunteersModal(events.find(e => e.id === btn.dataset.volunteers)));
  });
}

// ---------- volunteer / service scheduling (section 23) ----------
const VOLUNTEER_ROLE_LABELS = { usher: 'Usher', prayer_team: 'Prayer Team', media: 'Media', musician: 'Musician', protocol: 'Protocol', publicity: 'Publicity', transport: 'Transport', other: 'Other' };

async function openVolunteersModal(event) {
  const [assignments, members] = await Promise.all([
    fetchJSON(`/api/events/${event.id}/volunteers`),
    fetchJSON('/api/admin/members')
  ]);
  showModal(`
    <h3>Volunteers — ${escapeHtml(event.title)}</h3>
    <form id="assignForm" class="inline-form">
      <div class="field"><label>Member</label>
        <select id="volMember">${members.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Role</label>
        <select id="volRole">${Object.entries(VOLUNTEER_ROLE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      </div>
      <button type="submit" class="btn btn-primary btn-sm">Assign</button>
    </form>
    <div class="table-wrap">
      <table class="portal-table" style="min-width:0;">
        <thead><tr><th>Member</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${assignments.map(a => `
            <tr>
              <td>${escapeHtml(a.memberName)}</td>
              <td>${VOLUNTEER_ROLE_LABELS[a.role] || a.role}</td>
              <td>${pill(a.status, a.status === 'confirmed' ? 'green' : a.status === 'declined' ? 'red' : 'amber')}</td>
              <td><button data-remove-vol="${a.id}" class="danger">Remove</button></td>
            </tr>
          `).join('') || emptyRow(4, 'No one assigned yet.')}
        </tbody>
      </table>
    </div>
    <div style="margin-top:14px;"><button type="button" class="btn btn-outline" id="cancelModalBtn">Close</button></div>
    <div class="form-msg" id="volMsg"></div>
  `, true);

  document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
  document.getElementById('assignForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await fetchJSON(`/api/events/${event.id}/volunteers`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: document.getElementById('volMember').value, role: document.getElementById('volRole').value })
      });
      openVolunteersModal(event);
    } catch (err) {
      setFormMsg('volMsg', err.message || 'Could not assign this volunteer.', 'error');
    }
  });
  document.querySelectorAll('[data-remove-vol]').forEach(btn => btn.addEventListener('click', async () => {
    await fetchJSON(`/api/events/${event.id}/volunteers/${btn.dataset.removeVol}`, { method: 'DELETE' });
    openVolunteersModal(event);
  }));
}

// ---------- event review queue (section 9) ----------
async function renderEventQueue(el) {
  const queue = await fetchJSON('/api/publicity/events/queue');
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Event Review Queue</h2>
        <p class="sub">Events executives have submitted. Approve, then publish when the flyer (if any) is ready — nothing here is public yet.</p>
      </div>
    </div>
    <div class="table-wrap">
      <table class="portal-table">
        <thead><tr><th>Event</th><th>Submitted By</th><th>When</th><th></th></tr></thead>
        <tbody>
          ${queue.map(e => `
            <tr>
              <td><strong>${escapeHtml(e.title)}</strong>${e.description ? `<br><small class="muted">${escapeHtml(e.description.slice(0, 80))}</small>` : ''}</td>
              <td>${escapeHtml(e.submittedBy || '—')}</td>
              <td>${shortDate(e.date)} ${escapeHtml(e.time || '')}</td>
              <td class="row-actions">
                <button data-approve="${e.id}">Approve</button>
                <button data-reject="${e.id}" class="danger">Reject</button>
              </td>
            </tr>
          `).join('') || emptyRow(4, 'Nothing waiting on review right now.')}
        </tbody>
      </table>
    </div>
    ${PORTAL.canEdit ? `
      <div class="portal-card" style="margin-top:20px;">
        <h3>Approved — Ready to Publish</h3>
        <p class="hint">Add a flyer from the Events tab first if you want one, then publish.</p>
        <div id="approvedList"><p class="empty-state">Loading...</p></div>
      </div>
    ` : ''}
  `;

  el.querySelectorAll('[data-approve]').forEach(btn => btn.addEventListener('click', () => reviewEvent(btn.dataset.approve, 'approved')));
  el.querySelectorAll('[data-reject]').forEach(btn => btn.addEventListener('click', () => {
    const notes = prompt('Optional note for the executive about why this was rejected:') || '';
    reviewEvent(btn.dataset.reject, 'rejected', notes);
  }));

  const approvedHost = document.getElementById('approvedList');
  if (approvedHost) {
    const all = await fetchJSON('/api/events');
    const approved = all.filter(e => e.status === 'approved');
    approvedHost.innerHTML = approved.length ? `
      <div class="table-wrap"><table class="portal-table" style="min-width:0;">
        <tbody>
          ${approved.map(e => `
            <tr>
              <td>${escapeHtml(e.title)}${e.flyerFileId ? ' 🖼️' : ' <small class="muted">(no flyer yet)</small>'}</td>
              <td class="row-actions"><button data-publish="${e.id}">Publish</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table></div>
    ` : '<p class="empty-state">Nothing approved yet.</p>';
    approvedHost.querySelectorAll('[data-publish]').forEach(btn => btn.addEventListener('click', async () => {
      try {
        await fetchJSON(`/api/publicity/events/${btn.dataset.publish}/publish`, { method: 'PATCH' });
        showToast('Event published!', 'success');
        openPanel('eventQueue');
      } catch (err) { showToast(err.message || 'Could not publish this event.', 'error'); }
    }));
  }
}

async function reviewEvent(id, decision, notes) {
  try {
    await fetchJSON(`/api/publicity/events/${id}/review`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, notes })
    });
    showToast(decision === 'approved' ? 'Event approved.' : 'Event rejected.', 'success');
    openPanel('eventQueue');
  } catch (err) {
    showToast(err.message || 'Could not review this event.', 'error');
  }
}

function openEventForm(event) {
  const isEdit = !!event;
  showModal(`
    <h3>${isEdit ? 'Edit' : 'Add'} Event</h3>
    <form id="eventForm">
      <div class="field"><label>Title</label><input type="text" id="evTitle" value="${escapeHtml(event?.title || '')}" required></div>
      <div class="field-row">
        <div class="field"><label>Date</label><input type="date" id="evDate" value="${event?.date || ''}" required></div>
        <div class="field"><label>Time</label><input type="time" id="evTime" value="${event?.time || ''}" required></div>
      </div>
      <div class="field"><label>Location</label><input type="text" id="evLocation" value="${escapeHtml(event?.location || '')}"></div>
      <div class="field"><label>Description</label><textarea id="evDescription">${escapeHtml(event?.description || '')}</textarea></div>
      <div class="field"><label>Recurring label (optional)</label><input type="text" id="evRecurring" value="${escapeHtml(event?.recurring || '')}" placeholder="e.g. Every Wednesday"></div>
      ${isEdit ? `
        <div class="field">
          <label>Flyer</label>
          ${event?.flyerFileId ? `<img src="/api/files/${event.flyerFileId}" alt="" style="max-width:160px; border-radius:8px; display:block; margin-bottom:8px;">` : ''}
          <input type="file" id="evFlyer" accept="image/*">
          <small class="hint">Uploading replaces the current flyer. Shown on the event page and, once published, the homepage.</small>
        </div>
      ` : ''}
      ${isEdit ? `
        <label class="choice selected" style="margin-bottom:18px;">
          <input type="checkbox" id="evAnnounce" checked>
          <span><strong>Announce this change</strong><small>Posts an "Event Update" to the app so people know it moved.</small></span>
        </label>` : '<p class="tiny muted" style="margin-bottom:18px;">Adding an event automatically announces it in the app.</p>'}
      <div style="display:flex; gap:10px;">
        <button type="submit" class="btn btn-primary">Save Event</button>
        <button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button>
      </div>
      <div class="form-msg" id="eventFormMsg"></div>
    </form>
  `);

  document.getElementById('eventForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      title: document.getElementById('evTitle').value,
      date: document.getElementById('evDate').value,
      time: document.getElementById('evTime').value,
      location: document.getElementById('evLocation').value,
      description: document.getElementById('evDescription').value,
      recurring: document.getElementById('evRecurring').value
    };
    if (isEdit) {
      // Keep the registration settings the admin configured — publicity edits
      // the details of an event, not whether people can sign up for it.
      payload.registrationEnabled = event.registrationEnabled;
      payload.capacity = event.capacity;
      payload.registrationDeadline = event.registrationDeadline;
      payload.announceUpdate = document.getElementById('evAnnounce').checked;
    }
    try {
      await fetchJSON(isEdit ? `/api/publicity/events/${event.id}` : '/api/publicity/events', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const flyerFile = isEdit && document.getElementById('evFlyer') ? document.getElementById('evFlyer').files[0] : null;
      if (flyerFile) {
        const formData = new FormData();
        formData.append('file', flyerFile);
        formData.append('placement', 'event-flyer');
        formData.append('targetId', event.id);
        await fetchJSON('/api/admin/uploads', { method: 'POST', body: formData });
      }
      closeModal();
      showToast('Event saved.', 'success');
      openPanel('events');
    } catch (err) {
      setFormMsg('eventFormMsg', err.message || 'Could not save this event.', 'error');
    }
  });
}

// ---------- testimonies ----------
let testimonyFilter = 'pending';

async function renderTestimonies(el) {
  const items = await fetchJSON('/api/publicity/testimonies');
  const shown = testimonyFilter === 'all'
    ? items
    : items.filter(t => (testimonyFilter === 'pending' ? !t.published : t.published));

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Testimonies</h2>
        <p class="sub">What members send in through the app. Publishing one puts it on the public wall.</p>
      </div>
      <div class="panel-actions">
        ${['pending', 'published', 'all'].map(f => `
          <button class="btn ${testimonyFilter === f ? 'btn-primary' : 'btn-outline'} btn-sm" data-filter="${f}">
            ${f === 'pending' ? `Awaiting review (${items.filter(t => !t.published).length})` : f === 'published' ? 'Published' : 'All'}
          </button>
        `).join('')}
      </div>
    </div>

    <div class="table-wrap">
      <table class="portal-table">
        <thead><tr><th>From</th><th>Testimony</th><th>Received</th><th>Status</th>${PORTAL.canEdit ? '<th>Actions</th>' : ''}</tr></thead>
        <tbody>
          ${shown.map(t => `
            <tr>
              <td>${escapeHtml(t.name || 'Anonymous')}</td>
              <td>${escapeHtml(t.testimony)}</td>
              <td class="tiny muted">${dateTimeLabel(t.createdAt)}</td>
              <td>${pill(t.published ? 'published' : 'pending', t.published ? 'green' : 'amber')}</td>
              ${PORTAL.canEdit ? `<td class="row-actions">
                <button data-toggle="${t.id}" data-published="${t.published}">${t.published ? 'Unpublish' : 'Publish'}</button>
                <button class="danger" data-delete="${t.id}">Delete</button>
              </td>` : ''}
            </tr>
          `).join('') || emptyRow(PORTAL.canEdit ? 5 : 4, 'Nothing here.')}
        </tbody>
      </table>
    </div>
  `;

  el.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      testimonyFilter = btn.dataset.filter;
      openPanel('testimonies');
    });
  });
  el.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetchJSON(`/api/publicity/testimonies/${btn.dataset.toggle}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ published: btn.dataset.published !== 'true' })
      });
      showToast('Testimony updated.', 'success');
      openPanel('testimonies');
    });
  });
  el.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this testimony permanently?')) return;
      await fetchJSON(`/api/publicity/testimonies/${btn.dataset.delete}`, { method: 'DELETE' });
      openPanel('testimonies');
    });
  });
}

// ---------- SMS log ----------
async function renderSmsLog(el) {
  const logs = await fetchJSON('/api/publicity/sms-logs');
  const sent = logs.filter(l => l.status === 'sent').length;
  const failed = logs.filter(l => l.status === 'failed').length;
  const skipped = logs.filter(l => l.status === 'skipped').length;

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>SMS Log</h2>
        <p class="sub">The last 200 text messages this app tried to send, and what happened to each one.</p>
      </div>
    </div>

    <div class="stat-grid">
      ${statCard('Delivered to provider', sent, { tone: 'good' })}
      ${statCard('Failed', failed, { tone: failed ? 'bad' : '' })}
      ${statCard('Skipped', skipped, { foot: 'SMS was not configured at the time' })}
    </div>

    <div class="table-wrap">
      <table class="portal-table">
        <thead><tr><th>Number</th><th>Message</th><th>Status</th><th>Detail</th><th>When</th></tr></thead>
        <tbody>
          ${paginate(logs, 1, 50).map(l => `
            <tr>
              <td>${escapeHtml(l.to)}</td>
              <td class="tiny">${escapeHtml((l.body || '').slice(0, 80))}${(l.body || '').length > 80 ? '…' : ''}</td>
              <td>${pill(l.status)}</td>
              <td class="tiny muted">${escapeHtml(l.detail || '—')}</td>
              <td class="tiny muted">${dateTimeLabel(l.createdAt)}</td>
            </tr>
          `).join('') || emptyRow(5, 'No SMS has been sent yet.')}
        </tbody>
      </table>
    </div>
  `;
}

// ---------- Form Builder (section 11) ----------
const FORM_FIELD_TYPE_LABELS = {
  short_text: 'Short text', long_text: 'Long text', multiple_choice: 'Multiple choice',
  checkboxes: 'Checkboxes', dropdown: 'Dropdown', date: 'Date', time: 'Time',
  phone: 'Phone', email: 'Email', file: 'File upload'
};
const FORM_CATEGORY_LABELS = {
  event_registration: 'Event Registration', travelling_event: 'Travelling Event',
  executive: 'Executive Info', department: 'Department Activity', welfare: 'Welfare', custom: 'Custom'
};

function formFieldRow(field, i) {
  const f = field || { id: '', label: '', type: 'short_text', required: false, options: [] };
  const needsOptions = ['multiple_choice', 'checkboxes', 'dropdown'].includes(f.type);
  return `
    <div class="portal-card" data-field-row style="padding:14px; margin-bottom:10px;">
      <input type="hidden" data-field-id value="${escapeHtml(f.id)}">
      <div class="field-row">
        <div class="field"><label>Question</label><input type="text" data-field-label value="${escapeHtml(f.label)}" required></div>
        <div class="field"><label>Type</label>
          <select data-field-type>
            ${Object.entries(FORM_FIELD_TYPE_LABELS).map(([v, l]) => `<option value="${v}" ${f.type === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field" data-options-field style="${needsOptions ? '' : 'display:none;'}">
        <label>Options (one per line)</label>
        <textarea data-field-options rows="3">${escapeHtml((f.options || []).join('\n'))}</textarea>
      </div>
      <label style="display:flex; align-items:center; gap:8px; font-size:0.85rem; font-weight:700; color:var(--purple-rich);">
        <input type="checkbox" data-field-required style="width:auto;" ${f.required ? 'checked' : ''}> Required
      </label>
      <button type="button" class="btn btn-outline btn-sm" data-remove-field style="margin-top:8px;">Remove Question</button>
    </div>
  `;
}

function wireFormFieldRows(host) {
  host.querySelectorAll('[data-field-type]').forEach((sel) => {
    sel.onchange = () => {
      const row = sel.closest('[data-field-row]');
      row.querySelector('[data-options-field]').style.display = ['multiple_choice', 'checkboxes', 'dropdown'].includes(sel.value) ? '' : 'none';
    };
  });
  host.querySelectorAll('[data-remove-field]').forEach((btn) => {
    btn.onclick = () => {
      if (host.querySelectorAll('[data-field-row]').length === 1) return;
      btn.closest('[data-field-row]').remove();
    };
  });
}

function collectFormFields(host) {
  return [...host.querySelectorAll('[data-field-row]')].map((row, i) => ({
    id: row.querySelector('[data-field-id]').value || undefined,
    label: row.querySelector('[data-field-label]').value.trim(),
    type: row.querySelector('[data-field-type]').value,
    required: row.querySelector('[data-field-required]').checked,
    options: row.querySelector('[data-field-options]').value.split('\n').map(s => s.trim()).filter(Boolean),
    order: i
  })).filter(f => f.label);
}

function openFormBuilder(form) {
  const isEdit = !!form;
  const fields = form ? form.fields : [{}];
  showModal(`
    <h3>${isEdit ? 'Edit' : 'New'} Form</h3>
    <form id="formBuilderForm">
      <div class="field"><label>Title</label><input type="text" id="fTitle" value="${escapeHtml(form?.title || '')}" required></div>
      <div class="field"><label>Description</label><textarea id="fDescription" rows="2">${escapeHtml(form?.description || '')}</textarea></div>
      <div class="field"><label>Category</label>
        <select id="fCategory">${Object.entries(FORM_CATEGORY_LABELS).map(([v, l]) => `<option value="${v}" ${form?.category === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      <label style="display:block; font-weight:700; font-size:0.85rem; margin:14px 0 8px; color:var(--purple-rich);">Questions</label>
      <div id="fieldRows">${fields.map((f, i) => formFieldRow(f, i)).join('')}</div>
      <button type="button" class="btn btn-outline btn-sm" id="addFieldBtn">+ Add Question</button>
      <div style="display:flex; gap:10px; margin-top:20px;">
        <button type="submit" class="btn btn-primary">Save Form</button>
        <button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button>
      </div>
      <div class="form-msg" id="formBuilderMsg"></div>
    </form>
  `, true);

  const rowsHost = document.getElementById('fieldRows');
  wireFormFieldRows(rowsHost);
  document.getElementById('addFieldBtn').addEventListener('click', () => {
    rowsHost.insertAdjacentHTML('beforeend', formFieldRow(null, rowsHost.children.length));
    wireFormFieldRows(rowsHost);
  });

  document.getElementById('formBuilderForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      title: document.getElementById('fTitle').value,
      description: document.getElementById('fDescription').value,
      category: document.getElementById('fCategory').value,
      fields: collectFormFields(rowsHost)
    };
    try {
      await fetchJSON(isEdit ? `/api/admin/forms/${form.id}` : '/api/admin/forms', {
        method: isEdit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      closeModal();
      showToast('Form saved.', 'success');
      openPanel('forms');
    } catch (err) {
      setFormMsg('formBuilderMsg', err.message || 'Could not save this form.', 'error');
    }
  });
}

async function viewFormSubmissions(formId) {
  const { form, submissions } = await fetchJSON(`/api/admin/forms/${formId}/submissions`);
  showModal(`
    <h3>${escapeHtml(form.title)} — Submissions (${submissions.length})</h3>
    <div class="table-wrap">
      <table class="portal-table" style="min-width:0;">
        <thead><tr><th>Submitted By</th><th>When</th>${form.fields.map(f => `<th>${escapeHtml(f.label)}</th>`).join('')}</tr></thead>
        <tbody>
          ${submissions.map(s => `
            <tr>
              <td>${escapeHtml(s.submitterName || 'Anonymous')}<br><small class="muted">${escapeHtml(s.submitterEmail || '')}</small></td>
              <td class="tiny muted">${dateTimeLabel(s.createdAt)}</td>
              ${form.fields.map(f => `<td>${escapeHtml(String(s.answers[f.id] ?? '—'))}</td>`).join('')}
            </tr>
          `).join('') || emptyRow(2 + form.fields.length, 'No submissions yet.')}
        </tbody>
      </table>
    </div>
    <div style="margin-top:18px;"><button type="button" class="btn btn-outline" id="cancelModalBtn">Close</button></div>
  `, true);
  document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
}

async function renderForms(el) {
  const forms = await fetchJSON('/api/admin/forms');
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Forms (${forms.length})</h2>
        <p class="sub">Build once, reuse for event registration, travelling events, executive info, department activities and welfare.</p>
      </div>
      <div class="panel-actions"><button class="btn btn-primary btn-sm" id="newFormBtn">+ New Form</button></div>
    </div>
    <div class="table-wrap">
      <table class="portal-table">
        <thead><tr><th>Title</th><th>Category</th><th>Questions</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${forms.map(f => `
            <tr>
              <td><strong>${escapeHtml(f.title)}</strong></td>
              <td>${escapeHtml(FORM_CATEGORY_LABELS[f.category] || f.category)}</td>
              <td>${f.fields.length}</td>
              <td>${pill(f.isOpen ? 'open' : 'closed', f.isOpen ? 'green' : 'grey')}</td>
              <td class="row-actions">
                <button data-view="${f.id}">Submissions</button>
                <button data-edit="${f.id}">Edit</button>
                <button data-toggle="${f.id}" data-open="${f.isOpen}">${f.isOpen ? 'Close' : 'Reopen'}</button>
                <button data-delete="${f.id}" class="danger">Delete</button>
              </td>
            </tr>
          `).join('') || emptyRow(5, 'No forms yet — create one to start collecting responses.')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('newFormBtn').addEventListener('click', () => openFormBuilder(null));
  el.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => viewFormSubmissions(btn.dataset.view)));
  el.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () => openFormBuilder(forms.find(f => f.id === btn.dataset.edit))));
  el.querySelectorAll('[data-toggle]').forEach(btn => btn.addEventListener('click', async () => {
    await fetchJSON(`/api/admin/forms/${btn.dataset.toggle}/toggle`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isOpen: btn.dataset.open !== 'true' })
    });
    openPanel('forms');
  }));
  el.querySelectorAll('[data-delete]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Delete this form and all of its submissions? This cannot be undone.')) return;
    await fetchJSON(`/api/admin/forms/${btn.dataset.delete}`, { method: 'DELETE' });
    showToast('Form deleted.', 'success');
    openPanel('forms');
  }));
}

async function renderContentManagerLink(el) {
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Media &amp; Content Hub</h2>
        <p class="sub">Publish and manage livestreams, seminars, e-books, weekly highlights, founder profiles, and church history.</p>
      </div>
      <div class="panel-actions">
        <a href="/content-manager.html" class="btn btn-primary btn-sm">Open Content Manager &nearr;</a>
      </div>
    </div>
    <div class="portal-card" style="text-align:center; padding:40px 20px;">
      <p style="font-size:1.1rem; font-weight:700; color:var(--purple-rich); margin-bottom:8px;">Manage Multimedia &amp; Chapter Resources</p>
      <p class="muted" style="max-width:500px; margin:0 auto 20px;">Upload e-book PDFs, publish YouTube/Facebook livestreams, post seminar previews, and curate "This Week at ACONSU" photo highlights.</p>
      <a href="/content-manager.html" class="btn btn-primary">Go to Content Manager</a>
    </div>
  `;
}

initPortal({
  role: 'publicity',
  label: 'Publicity',
  panels: [
    { key: 'overview', label: 'Overview', render: renderPublicityOverview },
    { key: 'compose', label: 'Send Announcement', render: renderCompose },
    { key: 'scheduled', label: 'Scheduled', render: renderScheduled },
    { key: 'eventQueue', label: 'Event Review Queue', render: renderEventQueue },
    { key: 'events', label: 'Events', render: renderPublicityEvents },
    { key: 'forms', label: 'Forms', render: renderForms },
    { key: 'content', label: 'Media & Content', render: renderContentManagerLink },
    { key: 'testimonies', label: 'Testimonies', render: renderTestimonies },
    { key: 'sms', label: 'SMS Log', render: renderSmsLog }
  ]
});
