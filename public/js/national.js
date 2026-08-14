/* ============================================================
   National Coordinator — oversight across every ACONSU chapter.
   Creates/edits/activates chapters, assigns Chapter Coordinators,
   and gives a national, aggregated view (never individually
   identifying data — see section 38 of the platform spec).
   ============================================================ */

// ---------- dashboard ----------
async function renderNationalDashboard(el) {
  const data = await fetchJSON('/api/national/dashboard');

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>ACONSU, Nationally</h2>
        <p class="sub">Every chapter, on one screen. Updated live — last read ${dateTimeLabel(data.generatedAt)}.</p>
      </div>
    </div>

    <div class="stat-grid">
      ${statCard('Total Chapters', data.totalChapters)}
      ${statCard('Active Chapters', data.activeChapters, { tone: 'good' })}
      ${statCard('Total Members', data.totalMembers)}
      ${statCard('Total Visitors', data.totalVisitors, { tone: data.totalVisitors ? 'gold' : '' })}
      ${statCard('Executives', data.totalExecutives)}
      ${statCard('Upcoming Events', data.upcomingEvents)}
      ${statCard('National Balance', money(data.financialOverview.balance), { tone: data.financialOverview.balance < 0 ? 'bad' : 'good' })}
    </div>

    <div class="portal-card">
      <h3>Chapter Comparison</h3>
      <p class="hint">Aggregated figures only — no individual member data appears here.</p>
      <div class="table-wrap">
        <table class="portal-table">
          <thead><tr><th>Chapter</th><th>Status</th><th class="num">Members</th><th class="num">Visitors</th><th class="num">Execs</th><th class="num">Upcoming Events</th><th class="num">Last Service</th><th class="num">Balance</th></tr></thead>
          <tbody>
            ${data.chapters.map(c => `
              <tr>
                <td><strong>${escapeHtml(c.name)}</strong></td>
                <td>${pill(c.status, c.status === 'active' ? 'green' : 'grey')}</td>
                <td class="num">${c.memberCount}</td>
                <td class="num">${c.visitorCount}</td>
                <td class="num">${c.executiveCount}</td>
                <td class="num">${c.upcomingEvents}</td>
                <td class="num">${c.lastServiceAttendance === null ? '—' : c.lastServiceAttendance}</td>
                <td class="num">${money(c.balance)}</td>
              </tr>
            `).join('') || emptyRow(8, 'No chapters yet — create the first one from the Chapters tab.')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ---------- chapters ----------
function chapterForm(chapter) {
  const isEdit = !!chapter;
  showModal(`
    <h3>${isEdit ? 'Edit Chapter' : 'New Chapter'}</h3>
    <form id="chapterForm">
      ${isEdit ? '' : `
        <div class="field"><label>Chapter ID</label>
          <input type="text" id="cId" placeholder="e.g. aconsu-legon" required>
          <small class="hint">Lowercase letters, numbers and hyphens only. Can't be changed later.</small>
        </div>
      `}
      <div class="field"><label>Chapter Name</label>
        <input type="text" id="cName" value="${escapeHtml(chapter?.name || '')}" placeholder="e.g. ACONSU-Legon" required></div>
      <div class="field"><label>Full Name (optional)</label>
        <input type="text" id="cFullName" value="${escapeHtml(chapter?.fullName || '')}" placeholder="The Apostles' Continuation Students Union — Legon"></div>
      <div class="field-row">
        <div class="field"><label>Institution</label><input type="text" id="cInstitution" value="${escapeHtml(chapter?.institution || '')}" placeholder="e.g. University of Ghana"></div>
        <div class="field"><label>Location</label><input type="text" id="cLocation" value="${escapeHtml(chapter?.location || '')}" placeholder="e.g. Legon, Accra"></div>
      </div>
      <div class="field"><label>Address</label><input type="text" id="cAddress" value="${escapeHtml(chapter?.address || '')}"></div>
      <div class="field-row">
        <div class="field"><label>Contact Email</label><input type="email" id="cEmail" value="${escapeHtml(chapter?.contact?.email || '')}"></div>
        <div class="field"><label>Contact Phone</label><input type="tel" id="cPhone" value="${escapeHtml(chapter?.contact?.phone || '')}"></div>
      </div>
      <div style="display:flex; gap:10px; margin-top:22px;">
        <button type="submit" class="btn btn-primary">Save Chapter</button>
        <button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button>
      </div>
      <div class="form-msg" id="chapterFormMsg"></div>
    </form>
  `);

  document.getElementById('chapterForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById('cName').value,
      fullName: document.getElementById('cFullName').value,
      institution: document.getElementById('cInstitution').value,
      location: document.getElementById('cLocation').value,
      address: document.getElementById('cAddress').value,
      contact: { email: document.getElementById('cEmail').value, phone: document.getElementById('cPhone').value }
    };
    try {
      if (isEdit) {
        await fetchJSON(`/api/national/chapters/${chapter.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
      } else {
        payload.id = document.getElementById('cId').value;
        await fetchJSON('/api/national/chapters', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
      }
      closeModal();
      showToast(isEdit ? 'Chapter updated' : 'Chapter created', 'success');
      openPanel('chapters');
    } catch (err) {
      setFormMsg('chapterFormMsg', err.message || 'Could not save this chapter.', 'error');
    }
  });
}

function assignCoordinatorForm(chapter, staffInChapter) {
  const existing = staffInChapter.filter(s => s.role !== 'coordinator');
  showModal(`
    <h3>Assign Chapter Coordinator — ${escapeHtml(chapter.name)}</h3>
    <p class="hint">The current coordinator (if any) steps down to Chapter Admin rather than losing their account.</p>
    <form id="assignForm">
      <div class="choice-grid" style="margin-bottom:16px;">
        <label class="choice selected"><input type="radio" name="mode" value="new" checked><span><strong>New account</strong><br><small>Create a fresh Chapter Coordinator login</small></span></label>
        <label class="choice"><input type="radio" name="mode" value="existing" ${existing.length ? '' : 'disabled'}><span><strong>Promote existing staff</strong><br><small>${existing.length ? 'Pick from this chapter\'s accounts' : 'No other accounts in this chapter yet'}</small></span></label>
      </div>
      <div id="newFields">
        <div class="field"><label>Username</label><input type="text" id="acUsername"></div>
        <div class="field"><label>Full Name</label><input type="text" id="acName"></div>
        <div class="field"><label>Password</label><input type="password" id="acPassword" minlength="8"></div>
      </div>
      <div id="existingFields" style="display:none;">
        <div class="field"><label>Account</label>
          <select id="acStaffId">${existing.map(s => `<option value="${s.id}">${escapeHtml(s.name || s.username)} (${escapeHtml(s.role)})</option>`).join('')}</select>
        </div>
      </div>
      <div style="display:flex; gap:10px; margin-top:22px;">
        <button type="submit" class="btn btn-primary">Assign Coordinator</button>
        <button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button>
      </div>
      <div class="form-msg" id="assignFormMsg"></div>
    </form>
  `);

  document.querySelectorAll('#assignForm input[name="mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      document.querySelectorAll('.choice').forEach(c => c.classList.toggle('selected', c.querySelector('input').checked));
      document.getElementById('newFields').style.display = radio.value === 'new' && radio.checked ? 'block' : document.getElementById('newFields').style.display;
      const mode = document.querySelector('#assignForm input[name="mode"]:checked').value;
      document.getElementById('newFields').style.display = mode === 'new' ? 'block' : 'none';
      document.getElementById('existingFields').style.display = mode === 'existing' ? 'block' : 'none';
    });
  });

  document.getElementById('assignForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const mode = document.querySelector('#assignForm input[name="mode"]:checked').value;
    const payload = mode === 'existing'
      ? { staffId: document.getElementById('acStaffId').value }
      : {
          username: document.getElementById('acUsername').value,
          name: document.getElementById('acName').value,
          password: document.getElementById('acPassword').value
        };
    try {
      await fetchJSON(`/api/national/chapters/${chapter.id}/assign-coordinator`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      closeModal();
      showToast('Chapter Coordinator assigned', 'success');
      openPanel('chapters');
    } catch (err) {
      setFormMsg('assignFormMsg', err.message || 'Could not assign a coordinator.', 'error');
    }
  });
}

async function renderChapters(el) {
  const [chapters, staff] = await Promise.all([
    fetchJSON('/api/national/chapters'),
    fetchJSON('/api/admin/staff')
  ]);

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Chapters</h2>
        <p class="sub">Create chapters, activate or deactivate them, and assign who leads each one.</p>
      </div>
      <div class="panel-actions"><button class="btn btn-primary btn-sm" id="newChapterBtn">+ New Chapter</button></div>
    </div>
    <div class="table-wrap">
      <table class="portal-table">
        <thead><tr><th>Chapter</th><th>Institution</th><th>Coordinator</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${chapters.map(c => `
            <tr>
              <td><strong>${escapeHtml(c.name)}</strong><br><small class="muted">${escapeHtml(c.id)}</small></td>
              <td>${escapeHtml(c.institution || '—')}</td>
              <td>${escapeHtml(c.coordinatorName || 'Not assigned')}</td>
              <td>${pill(c.status, c.status === 'active' ? 'green' : 'grey')}</td>
              <td>
                <div class="row-actions">
                  <button data-edit="${c.id}">Edit</button>
                  <button data-assign="${c.id}">Assign Coordinator</button>
                  <button data-toggle="${c.id}" data-status="${c.status}" class="${c.status === 'active' ? 'danger' : ''}">${c.status === 'active' ? 'Deactivate' : 'Activate'}</button>
                </div>
              </td>
            </tr>
          `).join('') || emptyRow(5, 'No chapters yet.')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('newChapterBtn').addEventListener('click', () => chapterForm(null));
  el.querySelectorAll('[data-edit]').forEach(btn => btn.addEventListener('click', () =>
    chapterForm(chapters.find(c => c.id === btn.dataset.edit))
  ));
  el.querySelectorAll('[data-assign]').forEach(btn => btn.addEventListener('click', () =>
    assignCoordinatorForm(chapters.find(c => c.id === btn.dataset.assign), staff.filter(s => s.chapterId === btn.dataset.assign))
  ));
  el.querySelectorAll('[data-toggle]').forEach(btn => btn.addEventListener('click', async () => {
    const next = btn.dataset.status === 'active' ? 'inactive' : 'active';
    try {
      await fetchJSON(`/api/national/chapters/${btn.dataset.toggle}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next })
      });
      showToast(`Chapter ${next === 'active' ? 'activated' : 'deactivated'}`, 'success');
      openPanel('chapters');
    } catch (err) {
      showToast(err.message || 'Could not update this chapter.', 'error');
    }
  }));
}

// ---------- national announcements ----------
async function renderNationalAnnouncements(el) {
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>National Announcement</h2>
        <p class="sub">Reaches every chapter at once — for anything that isn't chapter-specific. Each Chapter Coordinator has their own chapter-wide announcement tool for local news.</p>
      </div>
    </div>
    <div class="portal-card" style="max-width:560px;">
      <form id="nationalAnnounceForm">
        <div class="field"><label>Title</label><input type="text" id="naTitle" required></div>
        <div class="field"><label>Message</label><textarea id="naBody" rows="4" required></textarea></div>
        <div class="field">
          <label><input type="checkbox" id="naSms" style="width:auto; margin-right:8px;">Also send as SMS to every chapter</label>
        </div>
        <button type="submit" class="btn btn-primary">Send to Every Chapter</button>
        <div class="form-msg" id="naMsg"></div>
      </form>
    </div>
  `;

  document.getElementById('nationalAnnounceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const channels = ['app'];
      if (document.getElementById('naSms').checked) channels.push('sms');
      const { result } = await fetchJSON('/api/national/announcements', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: document.getElementById('naTitle').value, body: document.getElementById('naBody').value, channels })
      });
      setFormMsg('naMsg', result, 'success');
      document.getElementById('nationalAnnounceForm').reset();
      showToast('Sent to every chapter', 'success');
    } catch (err) {
      setFormMsg('naMsg', err.message || 'Could not send this announcement.', 'error');
    }
  });
}

initPortal({
  role: 'nationalCoordinator',
  label: 'National Coordinator',
  panels: [
    { key: 'dashboard', label: 'National Dashboard', render: renderNationalDashboard },
    { key: 'chapters', label: 'Chapters', render: renderChapters },
    { key: 'announcements', label: 'National Announcements', render: renderNationalAnnouncements }
  ]
});
