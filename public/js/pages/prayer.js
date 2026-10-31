// The script of prayer.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
let currentMember = null;

async function loadPrayerWall() {
  const list = document.getElementById('prayerWallList');
  try {
    const items = await fetchJSON('/api/prayer-wall');
    if (!items.length) {
      list.innerHTML = '<p class="empty-state">No public prayer requests right now. Be the first to share one above.</p>';
      return;
    }
    list.innerHTML = items.map((p) => `
      <div class="prayer-card" data-id="${p.id}">
        ${p.answered ? '<span class="answered-badge">Answered</span>' : ''}
        <p class="request-text">${escapeHtml(p.request)}</p>
        <div class="row">
          <span class="who">${escapeHtml(p.name || 'Anonymous')}</span>
          <div style="display:flex; align-items:center; gap:10px;">
            <span class="pray-count">${p.prayingCount} praying</span>
            <button type="button" class="pray-btn" data-pray="${p.id}">I'm praying</button>
          </div>
        </div>
        <div style="margin-top:8px;">${AconsuShare.button({ kind: 'prayer', title: 'Pray with us | ACONSU',
          text: `Pray with us: "${p.request.length > 200 ? `${p.request.slice(0, 199)}…` : p.request}"`, path: '/prayer.html', label: 'Ask others to pray' })}</div>
        ${p.testimony ? `<div class="testimony-box">"${escapeHtml(p.testimony)}"</div>` : ''}
        ${p.isMine && !p.answered ? `
          <div class="mine-actions">
            <button type="button" class="btn btn-outline btn-sm" data-mark-answered="${p.id}">Mark as answered</button>
          </div>
        ` : ''}
      </div>
    `).join('');

    list.querySelectorAll('[data-pray]').forEach(btn => btn.addEventListener('click', async () => {
      if (!currentMember) { showToast('Log in to let them know you\'re praying.', 'error'); return; }
      try {
        await fetchJSON(`/api/prayer-requests/${btn.dataset.pray}/pray`, { method: 'POST' });
        btn.classList.add('done');
        btn.textContent = 'Praying';
        showToast('They\'ll be encouraged to know you\'re praying.', 'success');
      } catch (err) { showToast(err.message || 'Could not record this.', 'error'); }
    }));
    list.querySelectorAll('[data-mark-answered]').forEach(btn => btn.addEventListener('click', async () => {
      const testimony = prompt('Want to share how God answered this? (optional, leave blank to skip)');
      try {
        await fetchJSON(`/api/prayer-requests/${btn.dataset.markAnswered}/answered`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ testimony: testimony || '' })
        });
        showToast('Marked as answered, thank you for sharing!', 'success');
        loadPrayerWall();
      } catch (err) { showToast(err.message || 'Could not update this.', 'error'); }
    }));
  } catch (e) {
    list.innerHTML = '<p class="empty-state">Could not load the prayer wall right now.</p>';
  }
}

(async function () {
  await initLayout('/prayer.html');
  const authRes = await fetchJSON('/api/auth/me').catch(() => ({ member: null }));
  currentMember = authRes.member;
  loadPrayerWall();
})();

document.getElementById('prayerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('prayerSubmitBtn');
  const msg = document.getElementById('prayerMsg');
  btn.disabled = true; btn.textContent = 'Sending...';
  try {
    // No signal: kept on the phone and sent by itself when it is back
    // (outbox.js), so a request typed on a weak connection is never lost.
    const out = await AconsuOutbox.send({
      url: '/api/prayer-requests', label: 'Prayer request',
      body: {
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        request: document.getElementById('request').value,
        visibility: document.getElementById('visibility').value
      }
    });
    msg.textContent = out.queued
      ? 'No signal right now. Your request is saved on this phone and will be sent by itself when you are back online.'
      : 'We received your request. The prayer team is praying with you.';
    msg.className = 'form-msg success';
    if (!out.queued) showToast('Prayer request received, praying with you.', 'success');
    document.getElementById('prayerForm').reset();
    if (!out.queued) loadPrayerWall();
  } catch (err) {
    msg.textContent = err.message || 'Something went wrong. Please try again.';
    msg.className = 'form-msg error';
  } finally {
    btn.disabled = false; btn.textContent = 'Submit Prayer Request';
  }
});

document.getElementById('testimonyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('testimonySubmitBtn');
  const msg = document.getElementById('testimonyMsg');
  btn.disabled = true; btn.textContent = 'Sending...';
  try {
    await fetchJSON('/api/testimonies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('tName').value,
        testimony: document.getElementById('tTestimony').value
      })
    });
    msg.textContent = 'Thank you for sharing! It will be reviewed before appearing publicly.';
    msg.className = 'form-msg success';
    showToast('Thank you for sharing your testimony!', 'success');
    document.getElementById('testimonyForm').reset();
  } catch (err) {
    msg.textContent = err.message || 'Something went wrong. Please try again.';
    msg.className = 'form-msg error';
  } finally {
    btn.disabled = false; btn.textContent = 'Share Testimony';
  }
});
