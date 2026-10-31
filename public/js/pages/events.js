// The script of events.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
let CURRENT_EVENTS = [];
let ACTIVE_EVENT_ID = null;
let CURRENT_MEMBER = null;
const eventParams = new URLSearchParams(location.search);
const selectedEventId = eventParams.get('event') || '';
const searchQuery = eventParams.get('q') || '';

function spotsBadge(e) {
  if (!e.registrationEnabled) return '';
  if (e.deadlinePassed) return '<span class="spots-badge closed">Registration closed</span>';
  if (e.spotsLeft === null) return '<span class="spots-badge plenty">Registration open</span>';
  if (e.spotsLeft <= 0) return '<span class="spots-badge full">Fully booked</span>';
  if (e.spotsLeft <= 10) return `<span class="spots-badge low">Only ${e.spotsLeft} spots left</span>`;
  return `<span class="spots-badge plenty">${e.spotsLeft} spots left</span>`;
}

function canRegister(e) {
  return e.registrationEnabled && !e.deadlinePassed && (e.spotsLeft === null || e.spotsLeft > 0);
}

(async function () {
  await initLayout('/events.html');
  try {
    const authRes = await fetchJSON('/api/auth/me');
    CURRENT_MEMBER = authRes.member;
  } catch (e) { /* fine to stay logged out - form just starts blank */ }
  try {
    const events = await fetchJSON('/api/events');
    CURRENT_EVENTS = events;
    const sorted = [...events].sort((a, b) => {
      if (a.id === selectedEventId) return -1;
      if (b.id === selectedEventId) return 1;
      return new Date(`${a.date}T${a.time || '00:00'}`) - new Date(`${b.date}T${b.time || '00:00'}`);
    });
    if (selectedEventId || searchQuery) {
      document.getElementById('searchContext').innerHTML = `
        <div class="search-context">
          ${selectedEventId ? 'Showing your selected event result.' : 'Showing event results.'}
          ${searchQuery ? ` Search: <strong>${escapeHtml(searchQuery)}</strong>.` : ''}
        </div>
      `;
    }

    const wrap = document.getElementById('eventList');
    wrap.innerHTML = sorted.map(e => {
      const d = new Date(`${e.date}T00:00:00`);
      return `
      <div class="card event-card ${e.id === selectedEventId ? 'search-focus-card' : ''}" data-event-id="${escapeHtml(e.id)}">
        ${e.flyerFileId ? `<img src="/api/files/${e.flyerFileId}" alt="" loading="lazy" style="width:100%; max-width:140px; border-radius:10px; object-fit:cover; align-self:flex-start;">` : `
        <div class="event-date-badge">
          <div class="day">${d.getDate()}</div>
          <div class="mon">${d.toLocaleDateString('en-US', { month: 'short' })}</div>
        </div>`}
        <div style="flex:1;">
          <h2 style="margin-bottom:6px; font-size:1.2rem;">${escapeHtml(e.title)}</h2>
          <p style="font-size:0.9rem; color:var(--ink-soft); margin-bottom:6px;">${formatDate(e.date)} · ${e.time}, ${escapeHtml(e.location)}</p>
          <p style="font-size:0.92rem; color:var(--ink-soft); margin-bottom:8px;">${escapeHtml(e.description || '')}</p>
          ${e.mapUrl ? mapBlockHtml({ url: e.mapUrl, place: e.mapPlace, label: e.location || e.title }) : ''}
          <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
            ${e.category ? `<span class="badge">${escapeHtml(e.category)}</span>` : ''}
            ${e.recurring ? `<span class="badge">${escapeHtml(e.recurring)}</span>` : ''}
            ${e.isNational ? `<span class="badge">National</span>` : ''}
            ${spotsBadge(e)}
          </div>
          <div style="margin-top:10px;">${AconsuShare.button({ kind: 'event', title: e.title,
            text: `${e.title}, ${formatDate(e.date)}${e.time ? `, ${e.time}` : ''}${e.location ? `, ${e.location}` : ''}. Come with me!`,
            path: `/events.html?event=${encodeURIComponent(e.id)}` })}</div>
          ${e.videoUrl ? `<p style="margin-top:8px;"><a href="${escapeHtml(e.videoUrl)}" target="_blank" rel="noopener" style="color:var(--brand); font-weight:700; font-size:0.85rem;">Watch video</a></p>` : ''}
          ${e.registrationEnabled ? `
            <div style="margin-top:12px;">
              <button class="btn btn-flame btn-sm" data-register="${e.id}" ${canRegister(e) ? '' : 'disabled style="opacity:0.5;cursor:not-allowed;"'}>
                ${canRegister(e) ? 'Register Now' : (e.deadlinePassed ? 'Registration Closed' : 'Fully Booked')}
              </button>
            </div>
          ` : ''}
        </div>
      </div>`;
    }).join('') || '<p class="empty-state">No events scheduled yet.</p>';

    wrap.querySelectorAll('[data-register]').forEach(btn => {
      btn.addEventListener('click', () => openRegModal(btn.dataset.register));
    });
    if (selectedEventId) {
      const selectedCard = wrap.querySelector(`[data-event-id="${CSS.escape(selectedEventId)}"]`);
      if (selectedCard) selectedCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    const next = nextUpcomingEvent(events);
    const countWrap = document.getElementById('countdownWrap');
    if (next) {
      countWrap.innerHTML = `
        <div class="countdown" id="countdown">
          <div class="countdown-unit"><div class="countdown-num" data-d>00</div><div class="countdown-label">Days</div></div>
          <div class="countdown-unit"><div class="countdown-num" data-h>00</div><div class="countdown-label">Hrs</div></div>
          <div class="countdown-unit"><div class="countdown-num" data-m>00</div><div class="countdown-label">Min</div></div>
          <div class="countdown-unit"><div class="countdown-num" data-s>00</div><div class="countdown-label">Sec</div></div>
        </div>
        <div class="countdown-caption">Until ${escapeHtml(next.title)}</div>
      `;
      startCountdown(next.date, next.time, 'countdown');
    }
  } catch (e) {
    document.getElementById('eventList').innerHTML = '<p class="empty-state">Could not load events right now.</p>';
  }
})();

function openRegModal(eventId) {
  const event = CURRENT_EVENTS.find(e => e.id === eventId);
  if (!event) return;
  ACTIVE_EVENT_ID = eventId;
  document.getElementById('regModalTitle').textContent = `Register: ${event.title}`;
  document.getElementById('regMsg').textContent = '';
  document.getElementById('regMsg').className = 'form-msg';
  document.getElementById('regForm').reset();

  const noteEl = document.getElementById('regAutofillNote');
  if (CURRENT_MEMBER) {
    document.getElementById('regName').value = CURRENT_MEMBER.name || '';
    document.getElementById('regEmail').value = CURRENT_MEMBER.email || '';
    document.getElementById('regPhone').value = CURRENT_MEMBER.phone || '';
    if (noteEl) {
      noteEl.style.display = 'block';
      noteEl.innerHTML = `Registering as <strong>${escapeHtml(CURRENT_MEMBER.name)}</strong>. <a href="#" id="regClearBtn" style="color:var(--brand); font-weight:700;">Not you? Clear the form</a>`;
      document.getElementById('regClearBtn').addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('regForm').reset();
        noteEl.style.display = 'none';
      });
    }
  } else if (noteEl) {
    noteEl.style.display = 'none';
  }

  document.getElementById('regModalBackdrop').classList.add('open');
}
document.getElementById('regCancelBtn').addEventListener('click', () => {
  document.getElementById('regModalBackdrop').classList.remove('open');
});
document.getElementById('regModalBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'regModalBackdrop') document.getElementById('regModalBackdrop').classList.remove('open');
});
document.getElementById('regForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('regSubmitBtn');
  const msg = document.getElementById('regMsg');
  btn.disabled = true; btn.textContent = 'Registering...';
  try {
    await fetchJSON(`/api/events/${ACTIVE_EVENT_ID}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('regName').value,
        email: document.getElementById('regEmail').value,
        phone: document.getElementById('regPhone').value
      })
    });
    msg.textContent = "You're registered! We'll see you there.";
    msg.className = 'form-msg success';
    showToast("You're registered! See you there.", 'success');
    setTimeout(() => { document.getElementById('regModalBackdrop').classList.remove('open'); location.reload(); }, 1400);
  } catch (err) {
    msg.textContent = err.message || 'Could not complete registration.';
    msg.className = 'form-msg error';
  } finally {
    btn.disabled = false; btn.textContent = 'Confirm Registration';
  }
});
