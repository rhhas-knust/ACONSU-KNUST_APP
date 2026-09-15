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

    <div class="portal-card">
      <h3>Chapter Readiness</h3>
      <p class="hint">Is this chapter standing on its own — not what it's doing. Welfare cases and the finance ledger stay inside the chapter either way.</p>
      <div class="table-wrap">
        <table class="portal-table">
          <thead><tr><th>Chapter</th><th>Coordinator</th><th>Admin</th><th>Offices Staffed</th><th>Settings</th><th>Last Activity</th></tr></thead>
          <tbody>
            ${data.chapters.map(c => `
              <tr>
                <td><strong>${escapeHtml(c.name)}</strong></td>
                <td>${readinessPill(c.readiness.coordinatorAssigned, 'Assigned', 'Unassigned')}</td>
                <td>${readinessPill(c.readiness.adminAppointed, 'Appointed', 'Not appointed')}</td>
                <td>${pill(`${c.readiness.officesStaffedCount} / ${c.readiness.officesTotal}`,
                  c.readiness.officesStaffedCount === c.readiness.officesTotal ? 'green' : c.readiness.officesStaffedCount ? 'amber' : 'red')}</td>
                <td>${readinessPill(c.readiness.settingsComplete, 'Complete', 'Incomplete')}</td>
                <td class="tiny muted">${c.readiness.lastActivityAt ? dateTimeLabel(c.readiness.lastActivityAt) : 'No activity yet'}</td>
              </tr>
            `).join('') || emptyRow(6, 'No chapters yet — create the first one from the Chapters tab.')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function readinessPill(ok, yesLabel, noLabel) {
  return pill(ok ? yesLabel : noLabel, ok ? 'green' : 'red');
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
  const chapters = await fetchJSON('/api/national/chapters');

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
  // A chapter's own staff list is fetched with that chapter named explicitly.
  // National scope no longer means "every chapter's records merged", so the
  // accounts to promote from have to be asked for by chapter.
  el.querySelectorAll('[data-assign]').forEach(btn => btn.addEventListener('click', async () => {
    const chapter = chapters.find(c => c.id === btn.dataset.assign);
    let chapterStaff = [];
    try {
      chapterStaff = await fetchJSON(`/api/admin/staff?chapterId=${encodeURIComponent(chapter.id)}`);
    } catch (e) { /* fall through with an empty list — "new account" still works */ }
    assignCoordinatorForm(chapter, chapterStaff.filter(s => s.chapterId === chapter.id));
  }));
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

async function renderNationalReports(el) {
  const rows = await fetchJSON('/api/national/reports/overview');
  el.innerHTML = `<div class="panel-head"><div><h2>National Reports</h2><p class="sub">Chapter-level comparison only — sensitive personal records stay in the local chapter.</p></div></div>
  <div class="portal-card"><div class="table-wrap"><table class="portal-table"><thead><tr><th>Chapter</th><th>Status</th><th class="num">Active members</th><th class="num">Visitors</th><th class="num">Events</th><th class="num">Services</th><th class="num">Open welfare</th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>${escapeHtml(r.chapterName)}</strong></td><td>${pill(r.status,r.status==='active'?'green':'grey')}</td><td class="num">${r.activeMembers}</td><td class="num">${r.visitors}</td><td class="num">${r.events}</td><td class="num">${r.servicesRecorded}</td><td class="num">${r.openWelfareRequests}</td></tr>`).join('')||emptyRow(7,'No chapters yet.')}</tbody></table></div></div>`;
}

// ---------- national executives ----------
// The union's own officers, not any chapter's. These are the records stored
// with an empty chapterId; chapter executives belong to, and are managed in,
// their own chapter's dashboard. Sending the NATIONAL_SCOPE token on create
// is what distinguishes "this is a national officer" from "I forgot to pick
// a chapter" (see POST /api/admin/executives).
const NATIONAL_SCOPE_TOKEN = '__national__';

function nationalExecForm(exec) {
  const isEdit = !!exec;
  showModal(`
    <h3>${isEdit ? 'Edit National Executive' : 'New National Executive'}</h3>
    <p class="hint">A national officer of ACONSU. Chapter officers are managed inside their own chapter.</p>
    <form id="nationalExecForm">
      <div class="field"><label>Full Name</label>
        <input type="text" id="neName" value="${escapeHtml(exec?.name || '')}" required></div>
      <div class="field"><label>Position</label>
        <input type="text" id="neRole" value="${escapeHtml(exec?.role || '')}" placeholder="e.g. National President" required></div>
      <div class="field"><label>Bio (optional)</label>
        <textarea id="neBio" rows="3">${escapeHtml(exec?.bio || '')}</textarea></div>
      <div class="field-row">
        <div class="field"><label>Display Order</label>
          <input type="number" id="neOrder" value="${Number(exec?.order || 0)}"></div>
        <div class="field"><label>Photo (optional)</label>
          <input type="file" id="neImage" accept="image/*"></div>
      </div>
      <div style="display:flex; gap:10px; margin-top:22px;">
        <button type="submit" class="btn btn-primary">Save Executive</button>
        <button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button>
      </div>
      <div class="form-msg" id="nationalExecMsg"></div>
    </form>
  `);

  document.getElementById('nationalExecForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = new FormData();
    body.append('name', document.getElementById('neName').value);
    body.append('role', document.getElementById('neRole').value);
    body.append('bio', document.getElementById('neBio').value);
    body.append('order', document.getElementById('neOrder').value || '0');
    body.append('chapterId', NATIONAL_SCOPE_TOKEN);
    const file = document.getElementById('neImage').files[0];
    if (file) body.append('image', file);
    try {
      const url = isEdit ? `/api/admin/executives/${exec.id}` : '/api/admin/executives';
      const res = await fetch(url, { method: isEdit ? 'PUT' : 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save this executive.');
      closeModal();
      showToast(isEdit ? 'Executive updated' : 'National executive added', 'success');
      openPanel('executives');
    } catch (err) {
      setFormMsg('nationalExecMsg', err.message || 'Could not save this executive.', 'error');
    }
  });
}

async function renderNationalExecutives(el) {
  const execs = await fetchJSON('/api/executives');
  const national = execs.filter(e => !e.chapterId);

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>National Executives</h2>
        <p class="sub">ACONSU's own national officers. Each chapter's executives are managed by that chapter and never appear here.</p>
      </div>
      <div class="panel-actions"><button class="btn btn-primary btn-sm" id="newNationalExecBtn">+ New Executive</button></div>
    </div>
    <div class="table-wrap">
      <table class="portal-table">
        <thead><tr><th>Name</th><th>Position</th><th class="num">Order</th><th></th></tr></thead>
        <tbody>
          ${national.map(e => `
            <tr>
              <td><strong>${escapeHtml(e.name || '—')}</strong>${e.bio ? `<br><small class="muted">${escapeHtml(e.bio.slice(0, 80))}${e.bio.length > 80 ? '…' : ''}</small>` : ''}</td>
              <td>${escapeHtml(e.role || '—')}</td>
              <td class="num">${Number(e.order || 0)}</td>
              <td>
                <div class="row-actions">
                  <button data-edit-exec="${e.id}">Edit</button>
                  <button data-delete-exec="${e.id}" class="danger">Remove</button>
                </div>
              </td>
            </tr>
          `).join('') || emptyRow(4, 'No national executives yet — add the union\'s national officers here.')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('newNationalExecBtn').addEventListener('click', () => nationalExecForm(null));
  el.querySelectorAll('[data-edit-exec]').forEach(btn => btn.addEventListener('click', () =>
    nationalExecForm(national.find(e => e.id === btn.dataset.editExec))
  ));
  el.querySelectorAll('[data-delete-exec]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Remove this national executive?')) return;
    try {
      await fetchJSON(`/api/admin/executives/${btn.dataset.deleteExec}`, { method: 'DELETE' });
      showToast('Executive removed', 'success');
      openPanel('executives');
    } catch (err) {
      showToast(err.message || 'Could not remove this executive.', 'error');
    }
  }));
}

const FEATURE_LABELS = {
  bible: 'Bible', bibleStudy: 'Bible Study', events: 'Events', donations: 'Donations', welfare: 'Welfare',
  communityChat: 'Community Chat', ebooks: 'E-Books', liveStreaming: 'Live Streaming', attendance: 'Attendance',
  seminars: 'Seminars', prayerWall: 'Prayer Wall', groups: 'Groups', departments: 'Departments'
};
async function renderFeatures(el) {
  const data = await fetchJSON('/api/national/features');
  el.innerHTML = `<div class="panel-head"><div><h2>Feature Configuration</h2><p class="sub">Control which optional modules are available across ACONSU. A disabled module remains safely stored; it is simply not offered publicly.</p></div></div>
  <form class="portal-card" id="featuresForm"><div class="choice-grid">${Object.keys(FEATURE_LABELS).map(key=>`<label class="choice ${data.modules[key]?'selected':''}"><input type="checkbox" name="${key}" ${data.modules[key]?'checked':''}><span><strong>${FEATURE_LABELS[key]}</strong><br><small>${data.modules[key]?'Enabled':'Disabled'}</small></span></label>`).join('')}</div><div style="margin-top:20px"><button class="btn btn-primary">Save Feature Configuration</button><span class="form-msg" id="featuresMsg"></span></div></form>`;
  document.querySelectorAll('#featuresForm input').forEach(input=>input.addEventListener('change',()=>input.closest('.choice').classList.toggle('selected',input.checked)));
  document.getElementById('featuresForm').addEventListener('submit',async e=>{e.preventDefault();const modules={};Object.keys(FEATURE_LABELS).forEach(k=>modules[k]=document.querySelector(`#featuresForm [name="${k}"]`).checked);try{await fetchJSON('/api/national/features',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({modules})});setFormMsg('featuresMsg','Saved.','success');showToast('Feature configuration saved','success')}catch(err){setFormMsg('featuresMsg',err.message||'Could not save.','error')}});
}

// This portal is always national scope, never chapter-scoped — so a chapter
// chosen elsewhere in the same browser (the admin dashboard's own scope
// selector, or the public site's chapter picker — both share fetchJSON's
// X-Chapter-Id store in main.js) must not silently leak into requests made
// here. Without this, National Executives, Reports and the rest of this
// portal could end up scoped to whatever chapter admin.html was last
// pointed at, defeating the "national by default" rule this whole feature
// exists to enforce.
setSelectedChapterId('');

initPortal({
  role: 'nationalCoordinator',
  label: 'National Coordinator',
  panels: [
    { key: 'dashboard', label: 'National Dashboard', render: renderNationalDashboard },
    { key: 'chapters', label: 'Chapters', render: renderChapters },
    { key: 'executives', label: 'National Executives', render: renderNationalExecutives },
    { key: 'reports', label: 'National Reports', render: renderNationalReports },
    { key: 'features', label: 'Feature Configuration', render: renderFeatures },
    { key: 'announcements', label: 'National Announcements', render: renderNationalAnnouncements }
  ]
});
