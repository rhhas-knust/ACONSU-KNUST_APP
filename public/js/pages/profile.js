// The script of profile.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
let CURRENT_MEMBER = null;

(async function () {
  const authRes = await fetchJSON('/api/auth/me').catch(() => ({ member: null }));
  if (!authRes.member) { window.location.href = '/login.html'; return; }
  CURRENT_MEMBER = authRes.member;
  await initLayout('/profile.html');
  renderProfileTopRow();
  renderMemberStanding();
  renderMyEvents();
  renderQuickPills();
  fillDetailsForm();
  renderCompleteProfile();
  // No password yet (signed up with a code): choosing the first one asks for no old one.
  if (CURRENT_MEMBER.hasPassword === false) {
    document.getElementById('currentPasswordWrap').hidden = true;
    document.getElementById('currentPassword').required = false;
    document.getElementById('firstPasswordNote').hidden = false;
    document.getElementById('passwordSubmitBtn').textContent = 'Set my password';
  }
  loadBadgesAndStreak();
  loadVolunteerAssignments();
})();

// ---------- volunteer / service scheduling (section 23) ----------
async function loadVolunteerAssignments() {
  const wrap = document.getElementById('volunteerAssignments');
  try {
    const items = await fetchJSON('/api/member/volunteer-assignments');
    const pending = items.filter(i => i.status === 'assigned' && i.event);
    if (!pending.length) { wrap.innerHTML = ''; return; }
    const roleLabels = { usher: 'Usher', prayer_team: 'Prayer Team', media: 'Media', musician: 'Musician', protocol: 'Protocol', publicity: 'Publicity', transport: 'Transport', other: 'Other' };
    wrap.innerHTML = `
      <div class="card" style="padding:16px 18px; margin-bottom:16px;">
        <h4 style="margin:0 0 10px;">You've been asked to serve</h4>
        ${pending.map(a => `
          <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--line);">
            <span style="font-size:0.9rem;"><strong>${roleLabels[a.role] || a.role}</strong>: ${escapeHtml(a.event.title)} (${a.event.date})</span>
            <span style="display:flex; gap:6px; flex-shrink:0;">
              <button type="button" class="btn btn-primary btn-sm" data-vol-respond="${a.id}" data-status="confirmed">Confirm</button>
              <button type="button" class="btn btn-outline btn-sm" data-vol-respond="${a.id}" data-status="declined">Decline</button>
            </span>
          </div>
        `).join('')}
      </div>
    `;
    wrap.querySelectorAll('[data-vol-respond]').forEach(btn => btn.addEventListener('click', async () => {
      await fetchJSON(`/api/member/volunteer-assignments/${btn.dataset.volRespond}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: btn.dataset.status })
      });
      showToast(btn.dataset.status === 'confirmed' ? 'Confirmed, thank you!' : 'Marked as declined.', 'success');
      loadVolunteerAssignments();
    }));
  } catch (e) { /* non-critical - profile page still works without this */ }
}

function renderProfileTopRow() {
  const el = document.getElementById('profileTopRow');
  const m = CURRENT_MEMBER;
  el.innerHTML = `
    <div class="profile-top-row">
      <div class="profile-name">
        <h1>${escapeHtml(m.name)}</h1>
        <p style="color:var(--ink-soft); margin:0;">${escapeHtml(m.email)}</p>
      </div>
      <div class="profile-avatar-wrap">
        <div class="profile-avatar">
          ${m.profileImageFileId ? `<img src="/api/files/${m.profileImageFileId}" alt="${escapeHtml(m.name)}">` : `<span class="initial">${escapeHtml((m.name || '?').charAt(0))}</span>`}
        </div>
        <label class="avatar-camera-btn" for="profileImage" title="Change photo"></label>
      </div>
    </div>
  `;
}

// Where this member stands: which department they belong to, how far along the
// membership journey they are, and who is shepherding them. All of it already
// existed server-side and drove Shepherding's workflow; none of it was ever
// shown to the member it was about.
async function renderMemberStanding() {
  const el = document.getElementById('memberStanding');
  if (!el) return;
  let d;
  try {
    d = await fetchJSON('/api/member/standing');
  } catch (e) {
    el.innerHTML = '';
    return;
  }

  // A member wants to know what they are right now, not to be shown the whole
  // ladder with their rung highlighted. The journey is still what Shepherding
  // works through; this just says where the person reading it stands today.
  el.innerHTML = `
    <div class="form-card" style="margin-bottom:18px;">
      <h2 style="margin:0 0 10px;">Where You Stand</h2>
      <div style="display:flex; align-items:center; gap:11px; margin-bottom:10px;">
        <span style="width:11px; height:11px; border-radius:50%; background:var(--flame-gold); flex:none;
          box-shadow:0 0 0 4px rgba(232,151,30,0.18);"></span>
        <strong style="font-size:1.12rem; color:var(--brand); font-family:var(--font-display);">
          ${escapeHtml(d.stage.label)}
        </strong>
      </div>
      <p style="margin:0 0 ${d.membershipNumber || d.shepherdName ? '14px' : '0'}; color:var(--ink-soft); font-size:0.9rem; line-height:1.55;">${escapeHtml(d.stage.blurb)}</p>
      ${(d.membershipNumber || d.shepherdName) ? `
        <div style="display:flex; flex-wrap:wrap; gap:18px; font-size:0.85rem; color:var(--ink-soft);">
          ${d.membershipNumber ? `<div><strong>Membership no.</strong><br>${escapeHtml(d.membershipNumber)}</div>` : ''}
          ${d.shepherdName ? `<div><strong>Your shepherd</strong><br>${escapeHtml(d.shepherdName)}</div>` : ''}
        </div>` : ''}
    </div>

    <div class="form-card" style="margin-bottom:18px;">
      <h2 style="margin:0 0 10px;">${(d.departments || []).length > 1 ? 'Where You Serve' : 'Your Department'}</h2>
      ${(d.departments || []).length ? `
        ${d.departments.map(dep => `
          <div style="padding:14px 0; border-bottom:1px solid var(--line);">
            <p style="margin:0 0 6px; font-size:1.05rem; font-weight:700; color:var(--brand);">
              ${escapeHtml(dep.name)}
            </p>
            ${dep.tagline ? `<p style="margin:0 0 10px; color:var(--ink-soft); font-size:0.88rem;">${escapeHtml(dep.tagline)}</p>` : ''}
            <div style="display:flex; flex-wrap:wrap; gap:18px; font-size:0.85rem; color:var(--ink-soft);">
              ${(dep.meetingDay || dep.meetingTime) ? `
                <div><strong>Meets</strong><br>${escapeHtml([dep.meetingDay, dep.meetingTime].filter(Boolean).join(', '))}</div>` : ''}
              ${dep.meetingLocation ? `<div><strong>Where</strong><br>${escapeHtml(dep.meetingLocation)}</div>` : ''}
              ${dep.headName ? `<div><strong>Led by</strong><br>${escapeHtml(dep.headName)}${dep.headRole ? `<br><span style="font-size:0.78rem; color:var(--ink-faint);">${escapeHtml(dep.headRole)}</span>` : ''}</div>` : ''}
            </div>
            <a href="/department.html?id=${encodeURIComponent(dep.id)}" class="btn btn-outline btn-sm" style="margin-top:14px;">Open ${escapeHtml(dep.name)}</a>
          </div>
        `).join('')}

        ${(d.pendingRequests || []).length ? `
          <p style="margin:14px 0 0; color:#8A5A12; font-size:0.85rem; font-weight:600;">
            ${d.pendingRequests.length === 1 ? 'One request is' : `${d.pendingRequests.length} requests are`} waiting on a department head.
          </p>` : ''}

        <a href="/departments.html" class="btn btn-outline btn-sm" style="margin-top:14px;">Serve somewhere else too</a>

        ${(d.departmentNotices || []).length ? `
          <div style="margin-top:20px; border-top:1px solid var(--line); padding-top:16px;">
            <h4 style="margin:0 0 12px; font-size:0.95rem;">From your ${(d.departments || []).length > 1 ? 'departments' : 'department'}</h4>
            ${d.departmentNotices.map(n => `
              <div style="margin-bottom:14px;">
                <div style="font-weight:700; color:var(--brand); font-size:0.9rem;">${escapeHtml(n.title)}</div>
                <p style="margin:4px 0 2px; color:var(--ink-soft); font-size:0.87rem; white-space:pre-wrap;">${escapeHtml(n.body)}</p>
                <span style="font-size:0.75rem; color:var(--ink-faint);">${escapeHtml(formatDate(String(n.createdAt).slice(0, 10)))}</span>
              </div>`).join('')}
          </div>` : ''}
      ` : `
        <p style="margin:0 0 12px; color:var(--ink-soft); font-size:0.9rem;">
          You are not in a department yet. It is where most of the friendships and the serving happen ${(d.pendingRequests || []).length ? '\u2014 and you have already asked to join one, so its head just needs to say yes.' : '\u2014 have a look and ask to join the one you want.'}
        </p>
        <a href="/departments.html" class="btn btn-primary btn-sm">${(d.pendingRequests || []).length ? 'See your request' : 'Find Your Department'}</a>
      `}
    </div>
  `;
}

// What this member has signed up for. Registering worked; seeing what you had
// signed up for did not - "My Events" went to the same events page everyone
// else sees.
async function renderMyEvents() {
  const el = document.getElementById('myEvents');
  if (!el) return;
  let events = [];
  try {
    events = await fetchJSON('/api/member/events');
  } catch (e) {
    el.innerHTML = '';
    return;
  }
  if (!events.length) { el.innerHTML = ''; return; }

  const upcoming = events.filter(e => !e.past);
  const past = events.filter(e => e.past);
  const row = (e) => `
    <div style="display:flex; justify-content:space-between; gap:12px; padding:10px 0; border-bottom:1px solid var(--line);">
      <div>
        <div style="font-weight:700; color:var(--brand); font-size:0.92rem;">${escapeHtml(e.title)}</div>
        <div style="font-size:0.8rem; color:var(--ink-soft);">
          ${escapeHtml(formatDate(String(e.date).slice(0, 10)))}${e.time ? ` · ${escapeHtml(e.time)}` : ''}${e.location ? ` · ${escapeHtml(e.location)}` : ''}
        </div>
      </div>
      <a href="/events.html" style="font-size:0.8rem; align-self:center; white-space:nowrap;">Details</a>
    </div>`;

  el.innerHTML = `
    <div class="form-card" style="margin-bottom:18px;">
      <h2 style="margin:0 0 10px;">You Are Signed Up For</h2>
      ${upcoming.length ? upcoming.map(row).join('') : '<p style="margin:0; color:var(--ink-soft); font-size:0.9rem;">Nothing coming up that you have registered for.</p>'}
      ${past.length ? `
        <details style="margin-top:12px;">
          <summary style="cursor:pointer; font-size:0.85rem; color:var(--ink-soft);">${past.length} you have already attended</summary>
          <div style="margin-top:8px; opacity:0.75;">${past.map(row).join('')}</div>
        </details>` : ''}
    </div>
  `;
}

function renderQuickPills() {
  document.getElementById('quickPills').innerHTML = `
    <div class="quick-pills">
      <a href="/card.html" class="quick-pill">Membership Card</a>
      <a href="/events.html" class="quick-pill">My Events</a>
      <a href="/prayer.html" class="quick-pill">Prayer Wall</a>
      <a href="/sermon-notes.html" class="quick-pill">Sermon Notes</a>
      <a href="/departments.html" class="quick-pill">Departments</a>
    </div>
  `;
}

async function loadBadgesAndStreak() {
  try {
    const data = await fetchJSON('/api/member/badges');
    document.getElementById('streakCardWrap').innerHTML = `
      <div class="streak-card">
        <div>
          <div style="font-size:0.8rem; opacity:0.9; font-weight:700;">App Streak</div>
          <div class="streak-num">${data.currentStreak} day${data.currentStreak === 1 ? '' : 's'}</div>
        </div>
        <div style="text-align:right; font-size:0.8rem; opacity:0.9;">
          Longest: ${data.longestStreak} day${data.longestStreak === 1 ? '' : 's'}<br>
          ${data.bibleChaptersRead} chapters read
        </div>
      </div>
    `;
    document.getElementById('badgesGrid').innerHTML = data.badges.map(b => `
      <div class="badge-item">
        <div class="badge-circle ${b.earned ? 'earned' : ''}">${badgeIconSvg(b.icon)}</div>
        <div class="badge-label">${escapeHtml(b.label)}</div>
      </div>
    `).join('');
  } catch (e) {
    document.getElementById('badgesGrid').innerHTML = '<p class="empty-state">Could not load badges.</p>';
  }
}

function fillDetailsForm() {
  document.getElementById('name').value = CURRENT_MEMBER.name || '';
  document.getElementById('email').value = CURRENT_MEMBER.email || '';
  document.getElementById('phone').value = CURRENT_MEMBER.phone || '';
  document.getElementById('level').value = CURRENT_MEMBER.level || '';
  document.getElementById('programme').value = CURRENT_MEMBER.programme || '';
  document.getElementById('hostel').value = CURRENT_MEMBER.hostel || '';
  document.getElementById('graduationYear').value = CURRENT_MEMBER.graduationYear || '';
  const kind = CURRENT_MEMBER.registeredAsAlumni ? 'alumni' : 'student';
  document.querySelector(`input[name="memberKind"][value="${kind}"]`).checked = true;
  showKindFields();
  const daySelect = document.getElementById('birthdayDay');
  for (let d = 1; d <= 31; d++) {
    const opt = document.createElement('option');
    opt.value = d; opt.textContent = d;
    daySelect.appendChild(opt);
  }
  if (CURRENT_MEMBER.birthdayMonth) document.getElementById('birthdayMonth').value = CURRENT_MEMBER.birthdayMonth;
  if (CURRENT_MEMBER.birthdayDay) document.getElementById('birthdayDay').value = CURRENT_MEMBER.birthdayDay;
}

document.querySelectorAll('.profile-tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.profile-tabs button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('detailsForm').style.display = btn.dataset.tab === 'details' ? 'block' : 'none';
    document.getElementById('passwordForm').style.display = btn.dataset.tab === 'password' ? 'block' : 'none';
  });
});

// Studying: level and hall. Finished: the year. Only one set on screen.
function showKindFields() {
  const picked = document.querySelector('input[name="memberKind"]:checked');
  const kind = picked ? picked.value : 'student';
  document.querySelectorAll('[data-for-kind]').forEach((el) => { el.hidden = el.dataset.forKind !== kind; });
}
document.querySelectorAll('input[name="memberKind"]').forEach((r) => r.addEventListener('change', showKindFields));

// Signing up asks only for a name and number; the rest is asked for here,
// gently, and never required. "Not now" puts it away on this phone for a month.
const COMPLETE_LATER_KEY = 'aconsu.profileLater';
function renderCompleteProfile() {
  const card = document.getElementById('completeProfile');
  const m = CURRENT_MEMBER || {};
  const missing = [
    !m.programme && 'What you study',
    !m.registeredAsAlumni && !m.level && 'Your level',
    !m.registeredAsAlumni && !m.hostel && 'Your hall or hostel',
    !(m.birthdayMonth && m.birthdayDay) && 'Your birthday (day and month only)'
  ].filter(Boolean);
  let later = 0;
  try { later = Number(localStorage.getItem(COMPLETE_LATER_KEY)) || 0; } catch (e) { /* fine */ }
  card.hidden = !missing.length || Date.now() - later < 30 * 24 * 60 * 60 * 1000;
  document.getElementById('completeList').innerHTML = missing.map((t) => `<li>${escapeHtml(t)}</li>`).join('');
}
document.getElementById('completeGo').addEventListener('click', () => {
  const first = ['programme', 'level', 'hostel', 'birthdayMonth'].map((id) => document.getElementById(id)).find((el) => el && !el.value && el.offsetParent);
  document.getElementById('detailsForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (first) setTimeout(() => first.focus(), 300);
});
document.getElementById('completeLater').addEventListener('click', () => {
  try { localStorage.setItem(COMPLETE_LATER_KEY, String(Date.now())); } catch (e) { /* fine */ }
  document.getElementById('completeProfile').hidden = true;
});

document.getElementById('profileImage').addEventListener('change', (e) => {
  if (e.target.files.length) document.getElementById('detailsForm').requestSubmit();
});

document.getElementById('detailsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('detailsSubmitBtn');
  const msg = document.getElementById('detailsMsg');
  btn.disabled = true; btn.textContent = 'Saving...';
  const formData = new FormData();
  formData.append('name', document.getElementById('name').value);
  formData.append('phone', document.getElementById('phone').value);
  formData.append('email', document.getElementById('email').value);
  formData.append('level', document.getElementById('level').value);
  formData.append('programme', document.getElementById('programme').value);
  formData.append('hostel', document.getElementById('hostel').value);
  const kindPicked = document.querySelector('input[name="memberKind"]:checked');
  if (kindPicked) formData.append('memberKind', kindPicked.value);
  formData.append('graduationYear', document.getElementById('graduationYear').value);
  formData.append('birthdayMonth', document.getElementById('birthdayMonth').value);
  formData.append('birthdayDay', document.getElementById('birthdayDay').value);
  const fileInput = document.getElementById('profileImage');
  if (fileInput.files.length) formData.append('profileImage', fileInput.files[0]);
  try {
    const res = await fetch('/api/member/profile', { method: 'PUT', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save');
    CURRENT_MEMBER = data.member;
    renderProfileTopRow();
    renderCompleteProfile();
    msg.textContent = 'Profile updated.';
    msg.className = 'form-msg success';
    showToast('Profile updated.', 'success');
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-msg error';
  } finally {
    btn.disabled = false; btn.textContent = 'Save Changes';
  }
});

document.getElementById('passwordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('passwordSubmitBtn');
  const msg = document.getElementById('passwordMsg');
  btn.disabled = true; btn.textContent = 'Updating...';
  try {
    await fetchJSON('/api/member/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: document.getElementById('currentPassword').value,
        newPassword: document.getElementById('newPassword').value
      })
    });
    msg.textContent = 'Password updated.';
    msg.className = 'form-msg success';
    showToast('Password updated.', 'success');
    document.getElementById('passwordForm').reset();
    if (CURRENT_MEMBER.hasPassword === false) { CURRENT_MEMBER.hasPassword = true; document.getElementById('currentPasswordWrap').hidden = false; document.getElementById('firstPasswordNote').hidden = true; }
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'form-msg error';
  } finally {
    btn.disabled = false; btn.textContent = 'Update Password';
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetchJSON('/api/auth/logout', { method: 'POST' });
  await clearCachedAccountData();
  window.location.href = '/index.html';
});

// An alumnus's own entry in Alumni Connect. It appears only for members
// Shepherding has marked as alumni, and nothing here is published until they
// tick "List me" - writing the entry and publishing it are separate acts.
(async () => {
  const wrap = document.getElementById('alumniListing');
  if (!wrap) return;
  let data;
  try { data = await fetchJSON('/api/member/alumni-profile'); }
  catch (e) { return; }
  if (!data.isAlumni) return;

  const p = data.profile || {};
  const yes = (v) => v ? 'checked' : '';
  wrap.innerHTML = `
    <div class="form-card" style="margin-bottom:18px;">
      <h2 style="margin:0 0 6px;">Your Alumni Connect listing</h2>
      <p style="margin:0 0 16px; color:var(--ink-soft); font-size:0.88rem; line-height:1.55;">
        Members across every ACONSU chapter can look you up by what you do. Nothing
        below is shown to anyone until you tick <strong>List me</strong>, and you can
        take it down again at any time.
      </p>
      <form id="alumniForm">
        <div class="field">
          <label for="al_profession">What you do</label>
          <input type="text" id="al_profession" placeholder="e.g. Paediatric Nurse" value="${escapeHtml(p.profession || '')}">
        </div>
        <div class="field">
          <label for="al_org">Where you work</label>
          <input type="text" id="al_org" placeholder="e.g. Komfo Anokye Teaching Hospital" value="${escapeHtml(p.organisation || '')}">
        </div>
        <div class="field">
          <label for="al_industry">Field</label>
          <select id="al_industry">
            <option value="">Choose a field</option>
            ${(data.industries || []).map(i => `<option value="${escapeHtml(i)}"${p.industry === i ? ' selected' : ''}>${escapeHtml(i)}</option>`).join('')}
          </select>
        </div>
        <div class="field-row" style="display:grid; gap:12px; grid-template-columns:1fr 1fr;">
          <div class="field">
            <label for="al_prog">What you studied</label>
            <input type="text" id="al_prog" value="${escapeHtml(p.programme || '')}">
          </div>
          <div class="field">
            <label for="al_year">Year you finished</label>
            <input type="text" id="al_year" inputmode="numeric" placeholder="2024" value="${escapeHtml(p.graduationYear || '')}">
          </div>
        </div>
        <div class="field-row" style="display:grid; gap:12px; grid-template-columns:1fr 1fr;">
          <div class="field">
            <label for="al_city">City</label>
            <input type="text" id="al_city" value="${escapeHtml(p.city || '')}">
          </div>
          <div class="field">
            <label for="al_country">Country</label>
            <input type="text" id="al_country" value="${escapeHtml(p.country || 'Ghana')}">
          </div>
        </div>
        <div class="field">
          <label for="al_bio">A line about your work</label>
          <textarea id="al_bio" rows="3" placeholder="What you do, and what you would be glad to talk to a student about.">${escapeHtml(p.bio || '')}</textarea>
        </div>
        <div class="field">
          <label for="al_linkedin">LinkedIn (optional)</label>
          <input type="url" id="al_linkedin" placeholder="https://..." value="${escapeHtml(p.linkedin || '')}">
        </div>
        <div style="display:grid; gap:9px; margin:16px 0; font-size:0.88rem; color:var(--ink-soft);">
          <label><input type="checkbox" id="al_mentor" ${yes(p.openToMentoring)}> Happy to mentor a student</label>
          <label><input type="checkbox" id="al_email" ${yes(p.showEmail)}> Show my email address</label>
          <label><input type="checkbox" id="al_phone" ${yes(p.showPhone)}> Show my phone number</label>
          <label style="font-weight:800; color:var(--brand);"><input type="checkbox" id="al_listed" ${yes(p.listed)}> List me in Alumni Connect</label>
        </div>
        <button type="submit" class="btn btn-primary btn-sm" id="al_save">Save listing</button>
        <div class="form-msg" id="al_msg"></div>
      </form>
    </div>
  `;

  document.getElementById('alumniForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('al_save');
    const msg = document.getElementById('al_msg');
    btn.disabled = true; btn.textContent = 'Saving...';
    const val = (id) => document.getElementById(id).value.trim();
    const on = (id) => document.getElementById(id).checked;
    try {
      await fetchJSON('/api/member/alumni-profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          profession: val('al_profession'), organisation: val('al_org'),
          industry: val('al_industry'), programme: val('al_prog'),
          graduationYear: val('al_year'), city: val('al_city'), country: val('al_country'),
          bio: val('al_bio'), linkedin: val('al_linkedin'),
          openToMentoring: on('al_mentor'), showEmail: on('al_email'),
          showPhone: on('al_phone'), listed: on('al_listed')
        })
      });
      msg.textContent = on('al_listed')
        ? 'Saved. You are now listed in Alumni Connect.'
        : 'Saved. You are not listed \u2014 tick "List me" when you are ready.';
      msg.className = 'form-msg success';
      showToast('Alumni listing saved.', 'success');
    } catch (err) {
      msg.textContent = err.message || 'Could not save that.';
      msg.className = 'form-msg error';
    }
    btn.disabled = false; btn.textContent = 'Save listing';
  });
})();

// Alerts live here, in the member's own settings, rather than as a banner on
// the notifications page - one place to turn them on, and it stays out of the
// way of people who have already decided.
(async function initAlertsToggle() {
  const status = document.getElementById('alertsStatus');
  const btn = document.getElementById('alertsToggleBtn');

  async function refresh() {
    const subscribed = await isPushSubscribed();
    status.textContent = subscribed
      ? "Alerts are on. You'll hear about events and announcements even when the app is closed."
      : 'Alerts are off. Turn them on to hear about events and announcements when the app is closed.';
    btn.textContent = subscribed ? 'Turn Alerts Off' : 'Enable Alerts';
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        if (subscribed) {
          await unsubscribeFromPush();
          showToast('Alerts turned off.', 'success');
        } else {
          await subscribeToPush();
          showToast('Alerts enabled.', 'success');
        }
        await refresh();
      } catch (err) {
        showToast(err.message || 'Could not update your alert settings.', 'error');
      } finally {
        btn.disabled = false;
      }
    };
  }
  await refresh();
})();
