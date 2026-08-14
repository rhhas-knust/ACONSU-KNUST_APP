/* ============================================================
   Shepherding Portal — the pastoral side of the union.
   Sunday attendance, the people directory (editable here), and
   the contact messages members send in.
   ============================================================ */

const SHEP_ROWS_PER_PAGE = 15;
const ATTENDANCE_STATUSES = ['new', 'regular', 'irregular', 'inactive'];
const SERVICE_TYPES = [
  { value: 'sunday', label: 'Sunday Service' },
  { value: 'midweek', label: 'Midweek Meeting' },
  { value: 'special', label: 'Special Programme' }
];
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const personKey = (p) => (p.source === 'visitor' ? p.recordId : p.memberId);
const birthdayLabel = (p) => (p.birthdayMonth && p.birthdayDay ? `${MONTHS[p.birthdayMonth]} ${p.birthdayDay}` : '—');

function avatar(person) {
  return person.imageFileId
    ? `<span class="avatar-chip"><img src="/api/files/${person.imageFileId}" alt=""></span>`
    : `<span class="avatar-chip">${escapeHtml((person.name || '?').charAt(0).toUpperCase())}</span>`;
}

// ---------- overview ----------
async function renderShepOverview(el) {
  const [people, services, messages] = await Promise.all([
    fetchJSON('/api/shepherd/members'),
    fetchJSON('/api/shepherd/attendance'),
    fetchJSON('/api/shepherd/contact-messages')
  ]);

  const recent = services.slice(0, 8).reverse();
  const average = recent.length ? Math.round(recent.reduce((s, r) => s + r.total, 0) / recent.length) : 0;
  const followUp = people.filter(p => ['irregular', 'inactive'].includes(p.attendanceStatus));
  const unread = messages.filter(m => m.status !== 'replied');
  const lastService = services[0];

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Shepherding Overview</h2>
        <p class="sub">Who is here, who has drifted, and who is waiting to hear back from us.</p>
      </div>
      ${PORTAL.canEdit ? '<div class="panel-actions"><button class="btn btn-primary btn-sm" id="quickRegisterBtn">Take Attendance</button></div>' : ''}
    </div>

    <div class="stat-grid">
      ${statCard('People Tracked', people.length, { foot: `${people.filter(p => p.source === 'visitor').length} visitors without accounts` })}
      ${statCard('Last Service', lastService ? String(lastService.total) : '—', {
        tone: 'good',
        foot: lastService ? `${shortDate(lastService.date)} · ${lastService.present} on the register + ${lastService.visitorCount} walk-ins` : 'No register taken yet'
      })}
      ${statCard('Average Attendance', average, { foot: `across the last ${recent.length || 0} services` })}
      ${statCard('Need Follow-Up', followUp.length, { tone: followUp.length ? 'bad' : '', foot: 'marked irregular or inactive' })}
    </div>

    <div class="portal-card">
      <h3>Attendance Trend</h3>
      <p class="hint">Total people counted at each of the most recent services.</p>
      ${barChart(recent.map(r => ({ label: shortDate(r.date).replace(/ \d{4}$/, ''), value: r.total })), {
        emptyMessage: 'No attendance has been recorded yet. Take the first register on Sunday.'
      })}
    </div>

    <div class="card-split">
      <div class="portal-card">
        <h3>People to Reach Out To</h3>
        <p class="hint">Anyone marked irregular or inactive, oldest contact first.</p>
        <div class="table-wrap">
          <table class="portal-table" style="min-width:0;">
            <tbody>
              ${followUp
                .sort((a, b) => (a.lastContactDate || '').localeCompare(b.lastContactDate || ''))
                .slice(0, 8)
                .map(p => `
                  <tr>
                    <td>${escapeHtml(p.name)}<br><small class="muted">${escapeHtml(p.phone || p.email || 'no contact on file')}</small></td>
                    <td>${pill(p.attendanceStatus)}</td>
                    <td class="tiny muted">${p.lastContactDate ? `last contact ${shortDate(p.lastContactDate)}` : 'never contacted'}</td>
                  </tr>
                `).join('') || '<tr><td class="muted">Nobody needs following up right now.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div class="portal-card">
        <h3>Unanswered Messages (${unread.length})</h3>
        <p class="hint">Sent through the contact form on the app.</p>
        <div class="table-wrap">
          <table class="portal-table" style="min-width:0;">
            <tbody>
              ${unread.slice(0, 6).map(m => `
                <tr>
                  <td>${escapeHtml(m.name)}<br><small class="muted">${escapeHtml(m.email)}</small></td>
                  <td class="tiny">${escapeHtml((m.message || '').slice(0, 90))}${(m.message || '').length > 90 ? '…' : ''}</td>
                </tr>
              `).join('') || '<tr><td class="muted">Everything has been replied to.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const quick = document.getElementById('quickRegisterBtn');
  if (quick) quick.addEventListener('click', () => openPanel('attendance'));
}

// ---------- attendance ----------
const registerState = { date: lastSundayISO(), serviceType: 'sunday', marks: {}, loaded: false };

// Quick Check-In: SCAN QR -> IDENTIFY MEMBER -> VERIFY CHAPTER -> RECORD
// ATTENDANCE (section 13), with a manual search fallback when scanning isn't
// available — either browser support (BarcodeDetector isn't universal yet)
// or simply no camera to hand. Both paths call the same server-side
// check-in, which is what actually verifies chapter membership.
function wireQuickCheckIn(people) {
  const feedback = document.getElementById('checkinFeedback');
  const showFeedback = (text, type) => { feedback.textContent = text; feedback.className = `form-msg ${type || ''}`; };

  async function checkIn(payload, label) {
    try {
      const res = await fetchJSON('/api/attendance/scan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, date: registerState.date, serviceType: registerState.serviceType })
      });
      showFeedback(res.alreadyMarked ? `${res.member.name} was already marked present.` : `✅ ${res.member.name} marked present.`, 'success');
      showToast(`${res.member.name} checked in`, 'success');
    } catch (err) {
      showFeedback(err.message || `Could not check in ${label}.`, 'error');
    }
  }

  // ---- manual search fallback (always available) ----
  const searchInput = document.getElementById('checkinSearch');
  const resultsHost = document.getElementById('checkinResults');
  searchInput.addEventListener('input', () => {
    const term = searchInput.value.trim().toLowerCase();
    if (!term) { resultsHost.innerHTML = ''; return; }
    const matches = people.filter(p => p.source === 'member' && (p.name || '').toLowerCase().includes(term)).slice(0, 6);
    resultsHost.innerHTML = matches.map(p => `
      <button type="button" class="mark-btn" data-checkin-member="${p.memberId}" style="display:flex; width:100%; justify-content:flex-start; margin-bottom:6px;">${escapeHtml(p.name)}</button>
    `).join('') || '<p class="tiny muted">No match.</p>';
    resultsHost.querySelectorAll('[data-checkin-member]').forEach(btn => btn.addEventListener('click', async () => {
      await checkIn({ memberId: btn.dataset.checkinMember }, btn.textContent);
      searchInput.value = ''; resultsHost.innerHTML = '';
    }));
  });

  // ---- camera QR scan (feature-detected — not every browser supports it yet) ----
  const startBtn = document.getElementById('startScanBtn');
  const stopBtn = document.getElementById('stopScanBtn');
  const scanArea = document.getElementById('scanArea');
  const video = document.getElementById('scanVideo');
  let stream = null;
  let scanTimer = null;

  if (!('BarcodeDetector' in window)) {
    startBtn.disabled = true;
    startBtn.textContent = '📷 Scanning not supported on this browser — use search below';
    return;
  }

  async function stopScan() {
    if (scanTimer) clearInterval(scanTimer);
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    scanArea.style.display = 'none';
  }

  startBtn.addEventListener('click', async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream;
      await video.play();
      scanArea.style.display = 'block';
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      let busy = false;
      scanTimer = setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
          const codes = await detector.detect(video);
          if (codes.length) {
            await checkIn({ qrToken: codes[0].rawValue }, 'this member');
          }
        } catch (e) { /* a missed frame isn't an error — just try again next tick */ }
        busy = false;
      }, 800);
    } catch (e) {
      showFeedback('Could not access the camera. You can still check people in with search below.', 'error');
    }
  });
  stopBtn.addEventListener('click', stopScan);
}

async function renderAttendance(el) {
  const [people, services, existing] = await Promise.all([
    fetchJSON('/api/shepherd/members'),
    fetchJSON('/api/shepherd/attendance'),
    fetchJSON(`/api/shepherd/attendance/${registerState.date}?serviceType=${registerState.serviceType}`)
  ]);

  // Re-open an already-saved register with its marks intact, so corrections
  // during the week are an edit rather than a re-count.
  const record = existing.record;
  registerState.marks = {};
  if (record) {
    record.marks.forEach((m) => { registerState.marks[m.memberId || m.recordId] = m.status; });
  }

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Attendance Register</h2>
        <p class="sub">Mark who was in the room. Saving the same date again updates that register instead of creating a second one.</p>
      </div>
    </div>

    <div class="portal-card">
      <div class="inline-form" style="margin-bottom:0;">
        <div class="field"><label>Service date</label><input type="date" id="regDate" value="${registerState.date}"></div>
        <div class="field"><label>Service</label>
          <select id="regService">
            ${SERVICE_TYPES.map(s => `<option value="${s.value}" ${registerState.serviceType === s.value ? 'selected' : ''}>${s.label}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Walk-in visitors (headcount)</label>
          <input type="number" id="regVisitors" min="0" value="${record?.visitorCount || 0}" style="min-width:110px;">
        </div>
        <button type="button" class="btn btn-outline btn-sm" id="loadRegisterBtn">Load</button>
      </div>
      ${record ? `<p class="tiny muted" style="margin-top:10px;">A register already exists for this service — saving will update it. Last saved by ${escapeHtml(record.recordedBy || 'someone')}.</p>` : ''}
    </div>

    ${PORTAL.canEdit ? `
      <div class="portal-card">
        <h3>Quick Check-In (section 13)</h3>
        <p class="hint">Scan a member's QR code, or search by name if scanning isn't available — either instantly marks them present for the service selected above.</p>
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px;">
          <button type="button" class="btn btn-primary btn-sm" id="startScanBtn">📷 Scan QR Code</button>
        </div>
        <div id="scanArea" style="display:none; margin-bottom:14px;">
          <video id="scanVideo" style="width:100%; max-width:360px; border-radius:12px; background:#000;" playsinline muted></video>
          <div><button type="button" class="btn btn-outline btn-sm" id="stopScanBtn" style="margin-top:8px;">Stop Scanning</button></div>
        </div>
        <div class="field" style="max-width:360px;">
          <label>Or search by name</label>
          <input type="search" id="checkinSearch" placeholder="Type a name…" autocomplete="off">
        </div>
        <div id="checkinResults" style="max-width:360px;"></div>
        <div id="checkinFeedback" class="form-msg"></div>
      </div>
    ` : ''}

    ${PORTAL.canEdit ? `
      <div class="portal-card">
        <div class="panel-head" style="margin-bottom:14px;">
          <div>
            <h3 style="margin:0;">Mark the register (${people.length} people)</h3>
            <p class="sub" id="registerTally"></p>
          </div>
          <div class="panel-actions">
            <input type="search" id="regSearch" placeholder="Search a name…" style="padding:9px 12px; border:1px solid var(--line); border-radius:9px;">
            <button type="button" class="btn btn-outline btn-sm" id="markAllPresentBtn">All present</button>
            <button type="button" class="btn btn-outline btn-sm" id="markAllAbsentBtn">Clear</button>
          </div>
        </div>
        <div class="register-list" id="registerList"></div>
        <div class="field" style="margin-top:18px;"><label>Notes about this service</label>
          <input type="text" id="regNotes" value="${escapeHtml(record?.notes || '')}" placeholder="Optional — rain kept numbers down, guest speaker, etc.">
        </div>
        <button type="button" class="btn btn-primary" id="saveRegisterBtn">Save Register</button>
        <div class="form-msg" id="registerMsg"></div>
      </div>
    ` : ''}

    <div class="portal-card">
      <div class="panel-head" style="margin-bottom:14px;">
        <h3 style="margin:0;">Past Services (${services.length})</h3>
        <div class="panel-actions">
          <a class="btn btn-outline btn-sm" href="/api/shepherd/attendance-summary.pdf" target="_blank" rel="noopener">📄 Attendance % Report (PDF)</a>
          <a class="btn btn-outline btn-sm" href="/api/shepherd/members/report.pdf" target="_blank" rel="noopener">📄 Membership Report (PDF)</a>
        </div>
      </div>
      <div class="table-wrap">
        <table class="portal-table">
          <thead>
            <tr><th>Date</th><th>Service</th><th class="num">Present</th><th class="num">Excused</th><th class="num">Absent</th><th class="num">Walk-ins</th><th class="num">Total</th>${PORTAL.canEdit ? '<th>Actions</th>' : ''}</tr>
          </thead>
          <tbody>
            ${paginate(services, 1, SHEP_ROWS_PER_PAGE).map(s => `
              <tr>
                <td>${shortDate(s.date)}</td>
                <td>${escapeHtml((SERVICE_TYPES.find(t => t.value === s.serviceType) || {}).label || s.serviceType)}</td>
                <td class="num">${s.present}</td>
                <td class="num">${s.excused}</td>
                <td class="num">${s.absent}</td>
                <td class="num">${s.visitorCount}</td>
                <td class="num"><strong>${s.total}</strong></td>
                ${PORTAL.canEdit ? `<td class="row-actions">
                  <button data-open-register="${s.date}" data-service="${s.serviceType}">Open</button>
                  <a href="/api/shepherd/attendance/${s.date}/report.pdf?serviceType=${s.serviceType}" target="_blank" rel="noopener" style="border:none; background:var(--lilac-mid); color:var(--purple-rich); padding:6px 11px; border-radius:7px; font-size:0.77rem; font-weight:700; text-decoration:none;">PDF</a>
                  <button class="danger" data-delete-register="${s.id}">Delete</button>
                </td>` : ''}
              </tr>
            `).join('') || emptyRow(PORTAL.canEdit ? 8 : 7, 'No registers taken yet.')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('loadRegisterBtn').addEventListener('click', () => {
    registerState.date = document.getElementById('regDate').value || lastSundayISO();
    registerState.serviceType = document.getElementById('regService').value;
    openPanel('attendance');
  });

  el.querySelectorAll('[data-open-register]').forEach(btn => {
    btn.addEventListener('click', () => {
      registerState.date = btn.dataset.openRegister;
      registerState.serviceType = btn.dataset.service;
      openPanel('attendance');
    });
  });
  el.querySelectorAll('[data-delete-register]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this whole register? The attendance for that service will be lost.')) return;
      await fetchJSON(`/api/shepherd/attendance/${btn.dataset.deleteRegister}`, { method: 'DELETE' });
      showToast('Register deleted.', 'success');
      openPanel('attendance');
    });
  });

  if (!PORTAL.canEdit) return;

  wireQuickCheckIn(people);

  const listEl = document.getElementById('registerList');
  const tallyEl = document.getElementById('registerTally');

  function statusOf(person) {
    return registerState.marks[personKey(person)] || 'absent';
  }

  function updateTally() {
    const counts = people.reduce((acc, p) => {
      acc[statusOf(p)] = (acc[statusOf(p)] || 0) + 1;
      return acc;
    }, {});
    const visitors = Number(document.getElementById('regVisitors').value || 0);
    tallyEl.textContent = `${counts.present || 0} present · ${counts.excused || 0} excused · ${counts.absent || 0} absent · ${visitors} walk-ins — ${(counts.present || 0) + visitors} in the room`;
  }

  function drawList() {
    const term = (document.getElementById('regSearch').value || '').toLowerCase();
    const shown = people.filter(p => !term || (p.name || '').toLowerCase().includes(term));
    listEl.innerHTML = shown.map(p => {
      const key = personKey(p);
      const status = statusOf(p);
      return `
        <div class="register-row">
          ${avatar(p)}
          <div class="who">
            <strong>${escapeHtml(p.name)}</strong>
            <small>${escapeHtml(p.phone || p.email || 'no contact on file')}${p.source === 'visitor' ? ' · visitor' : ''}</small>
          </div>
          <div class="marks">
            ${['present', 'excused', 'absent'].map(s => `
              <button type="button" class="mark-btn ${status === s ? 'on' : ''}" data-status="${s}" data-person="${key}">
                ${s === 'present' ? 'Present' : s === 'excused' ? 'Excused' : 'Absent'}
              </button>
            `).join('')}
          </div>
        </div>
      `;
    }).join('') || '<p class="empty-state">Nobody matches that search.</p>';

    listEl.querySelectorAll('.mark-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        registerState.marks[btn.dataset.person] = btn.dataset.status;
        // Only repaint this row's buttons — redrawing the whole list would
        // lose the scroll position halfway through a congregation.
        btn.parentElement.querySelectorAll('.mark-btn').forEach(b => b.classList.toggle('on', b === btn));
        updateTally();
      });
    });
    updateTally();
  }

  drawList();
  document.getElementById('regSearch').addEventListener('input', drawList);
  document.getElementById('regVisitors').addEventListener('input', updateTally);
  document.getElementById('markAllPresentBtn').addEventListener('click', () => {
    people.forEach(p => { registerState.marks[personKey(p)] = 'present'; });
    drawList();
  });
  document.getElementById('markAllAbsentBtn').addEventListener('click', () => {
    registerState.marks = {};
    drawList();
  });

  document.getElementById('saveRegisterBtn').addEventListener('click', async () => {
    const btn = document.getElementById('saveRegisterBtn');
    btn.disabled = true;
    try {
      await fetchJSON('/api/shepherd/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: registerState.date,
          serviceType: registerState.serviceType,
          visitorCount: Number(document.getElementById('regVisitors').value || 0),
          notes: document.getElementById('regNotes').value,
          marks: people.map(p => ({
            memberId: p.source === 'visitor' ? '' : p.memberId,
            recordId: p.source === 'visitor' ? p.recordId : '',
            name: p.name,
            status: statusOf(p)
          }))
        })
      });
      showToast('Register saved.', 'success');
      openPanel('attendance');
    } catch (err) {
      setFormMsg('registerMsg', err.message || 'Could not save this register.', 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- members ----------
let shepMembersPage = 1;
let memberSearch = '';

async function renderShepMembers(el) {
  const [people, departments] = await Promise.all([
    fetchJSON('/api/shepherd/members'),
    fetchJSON('/api/departments')
  ]);
  const deptName = (id) => (departments.find(d => d.id === id) || {}).name || '';
  const filtered = memberSearch
    ? people.filter(p => `${p.name} ${p.email} ${p.phone}`.toLowerCase().includes(memberSearch.toLowerCase()))
    : people;
  const pageItems = paginate(filtered, shepMembersPage, SHEP_ROWS_PER_PAGE);

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Members (${filtered.length}${memberSearch ? ` of ${people.length}` : ''})</h2>
        <p class="sub">Everyone with an ACONSU account, plus visitors you have added by hand. You can correct anyone's details here.</p>
      </div>
      <div class="panel-actions">
        <input type="search" id="memberSearch" value="${escapeHtml(memberSearch)}" placeholder="Search name, email, phone…" style="padding:9px 12px; border:1px solid var(--line); border-radius:9px;">
        ${PORTAL.canEdit ? '<button class="btn btn-primary btn-sm" id="addVisitorBtn">+ Add Visitor</button>' : ''}
      </div>
    </div>

    <div class="table-wrap">
      <table class="portal-table">
        <thead>
          <tr><th>Name</th><th>Contact</th><th>Department</th><th>Birthday</th><th>Attendance</th><th>Last Contact</th>${PORTAL.canEdit ? '<th>Actions</th>' : ''}</tr>
        </thead>
        <tbody>
          ${pageItems.map(p => `
            <tr>
              <td style="display:flex; align-items:center; gap:10px;">
                ${avatar(p)}
                <span>${escapeHtml(p.name)}${p.source === 'visitor' ? '<br><small class="muted">visitor — no account</small>' : ''}</span>
              </td>
              <td>${escapeHtml(p.email || '—')}${p.phone ? `<br>${escapeHtml(p.phone)}` : ''}</td>
              <td>${escapeHtml(deptName(p.department) || '—')}</td>
              <td>${birthdayLabel(p)}</td>
              <td>${pill(p.attendanceStatus)}</td>
              <td>${p.lastContactDate ? shortDate(p.lastContactDate) : '—'}</td>
              ${PORTAL.canEdit ? `<td class="row-actions">
                <button data-care="${personKey(p)}">Care Notes</button>
                ${p.source === 'member' ? `<button data-details="${p.memberId}">Details</button>` : ''}
                <button data-history="${personKey(p)}">History</button>
                ${p.recordId ? `<button class="danger" data-delete="${p.recordId}">Delete</button>` : ''}
              </td>` : ''}
            </tr>
          `).join('') || emptyRow(PORTAL.canEdit ? 7 : 6, 'Nobody here yet.')}
        </tbody>
      </table>
    </div>
    <div id="shepMembersPagination"></div>
  `;

  renderPaginationControls('shepMembersPagination', filtered.length, SHEP_ROWS_PER_PAGE, shepMembersPage, (p) => {
    shepMembersPage = p;
    openPanel('members');
  });

  const search = document.getElementById('memberSearch');
  search.addEventListener('change', () => {
    memberSearch = search.value;
    shepMembersPage = 1;
    openPanel('members');
  });

  const addBtn = document.getElementById('addVisitorBtn');
  if (addBtn) addBtn.addEventListener('click', () => openCareForm(null));

  el.querySelectorAll('[data-care]').forEach(btn => {
    btn.addEventListener('click', () => openCareForm(people.find(p => personKey(p) === btn.dataset.care)));
  });
  el.querySelectorAll('[data-details]').forEach(btn => {
    btn.addEventListener('click', () => openMemberDetailsForm(people.find(p => p.memberId === btn.dataset.details), departments));
  });
  el.querySelectorAll('[data-history]').forEach(btn => {
    btn.addEventListener('click', () => openAttendanceHistory(people.find(p => personKey(p) === btn.dataset.history)));
  });
  el.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this shepherding record? Their ACONSU account, if they have one, is untouched.')) return;
      await fetchJSON(`/api/shepherd/records/${btn.dataset.delete}`, { method: 'DELETE' });
      showToast('Record deleted.', 'success');
      openPanel('members');
    });
  });
}

// The account details a member typed in themselves. Editable here because
// shepherding is the office that finds out a number has changed.
function openMemberDetailsForm(person, departments) {
  showModal(`
    <h3>Edit ${escapeHtml(person.name)}</h3>
    <p class="tiny muted" style="margin-bottom:16px;">These are the details on their ACONSU account. Their email address and password can only be changed by them, from their own profile.</p>
    <form id="memberDetailsForm">
      <div class="field"><label>Full Name</label><input type="text" id="dName" value="${escapeHtml(person.name || '')}" required></div>
      <div class="field-row">
        <div class="field"><label>Phone</label><input type="tel" id="dPhone" value="${escapeHtml(person.phone || '')}"></div>
        <div class="field"><label>Level / Year</label><input type="text" id="dLevel" value="${escapeHtml(person.level || '')}" placeholder="e.g. 200"></div>
      </div>
      <div class="field"><label>Department</label>
        <select id="dDepartment">
          <option value="">— none —</option>
          ${departments.map(d => `<option value="${d.id}" ${person.department === d.id ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field-row">
        <div class="field"><label>Birthday Month</label>
          <select id="dBMonth">
            <option value="">—</option>
            ${MONTHS.slice(1).map((m, i) => `<option value="${i + 1}" ${person.birthdayMonth === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Birthday Day</label><input type="number" id="dBDay" min="1" max="31" value="${person.birthdayDay || ''}"></div>
      </div>
      <div style="display:flex; gap:10px;">
        <button type="submit" class="btn btn-primary">Save Details</button>
        <button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button>
      </div>
      <div class="form-msg" id="memberDetailsMsg"></div>
    </form>
  `);

  document.getElementById('memberDetailsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await fetchJSON(`/api/shepherd/members/${person.memberId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('dName').value,
          phone: document.getElementById('dPhone').value,
          level: document.getElementById('dLevel').value,
          department: document.getElementById('dDepartment').value,
          birthdayMonth: document.getElementById('dBMonth').value,
          birthdayDay: document.getElementById('dBDay').value
        })
      });
      closeModal();
      showToast('Member details updated.', 'success');
      openPanel('members');
    } catch (err) {
      setFormMsg('memberDetailsMsg', err.message || 'Could not save.', 'error');
    }
  });
}

// The pastoral layer that only shepherding keeps: address, next of kin, how
// they're doing, and what was said last time.
function openCareForm(person) {
  const isVisitor = !person || person.source === 'visitor';
  showModal(`
    <h3>${person ? `Care Notes — ${escapeHtml(person.name)}` : 'Add a Visitor'}</h3>
    <form id="careForm">
      ${isVisitor ? `
        <div class="field"><label>Full Name</label><input type="text" id="cName" value="${escapeHtml(person?.name || '')}" required></div>
        <div class="field"><label>Phone</label><input type="tel" id="cPhone" value="${escapeHtml(person?.phone || '')}"></div>
      ` : '<p class="tiny muted" style="margin-bottom:16px;">Name, phone and photo come from their account — edit those under “Details”.</p>'}
      <div class="field"><label>Address / Hall</label><input type="text" id="cAddress" value="${escapeHtml(person?.address || '')}"></div>
      <div class="field"><label>Emergency Contact</label><input type="text" id="cEmergency" value="${escapeHtml(person?.emergencyContact || '')}"></div>
      <div class="field"><label>Attendance Pattern</label>
        <select id="cAttendance">
          ${ATTENDANCE_STATUSES.map(s => `<option value="${s}" ${person?.attendanceStatus === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Last Contacted</label><input type="date" id="cLastContact" value="${person?.lastContactDate || ''}"></div>
      <div class="field"><label>Pastoral Notes</label><textarea id="cNotes" placeholder="Kept private to the shepherding team.">${escapeHtml(person?.pastoralNotes || '')}</textarea></div>
      <div class="field"><label>Photo${isVisitor ? '' : ' (used here instead of their profile photo)'}</label><input type="file" id="cImage" accept="image/*"></div>
      <div style="display:flex; gap:10px;">
        <button type="submit" class="btn btn-primary">Save</button>
        <button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button>
      </div>
      <div class="form-msg" id="careFormMsg"></div>
    </form>
  `);

  document.getElementById('careForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData();
    if (isVisitor) {
      formData.append('name', document.getElementById('cName').value);
      formData.append('phone', document.getElementById('cPhone').value);
      if (person?.recordId) formData.append('recordId', person.recordId);
    } else {
      formData.append('memberId', person.memberId);
    }
    formData.append('address', document.getElementById('cAddress').value);
    formData.append('emergencyContact', document.getElementById('cEmergency').value);
    formData.append('attendanceStatus', document.getElementById('cAttendance').value);
    formData.append('lastContactDate', document.getElementById('cLastContact').value);
    formData.append('pastoralNotes', document.getElementById('cNotes').value);
    const fileInput = document.getElementById('cImage');
    if (fileInput.files.length) formData.append('image', fileInput.files[0]);

    try {
      const res = await fetch('/api/shepherd/records', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save');
      closeModal();
      showToast('Record saved.', 'success');
      openPanel('members');
    } catch (err) {
      setFormMsg('careFormMsg', err.message, 'error');
    }
  });
}

async function openAttendanceHistory(person) {
  showModal(`<h3>${escapeHtml(person.name)}</h3><p class="empty-state">Loading attendance…</p>`);
  try {
    const data = await fetchJSON(`/api/shepherd/attendance-history/${personKey(person)}`);
    document.getElementById('modalContent').innerHTML = `
      <h3>${escapeHtml(person.name)}</h3>
      <div class="stat-grid" style="margin-bottom:18px;">
        ${statCard('Attendance Rate', data.rate === null ? '—' : `${data.rate}%`, { tone: data.rate >= 70 ? 'good' : data.rate === null ? '' : 'bad' })}
        ${statCard('Services Attended', `${data.attended} of ${data.servicesRecorded}`)}
      </div>
      <div class="table-wrap">
        <table class="portal-table" style="min-width:0;">
          <thead><tr><th>Date</th><th>Service</th><th>Status</th></tr></thead>
          <tbody>
            ${data.history.map(h => `
              <tr><td>${shortDate(h.date)}</td><td>${escapeHtml(h.serviceType)}</td><td>${pill(h.status)}</td></tr>
            `).join('') || emptyRow(3, 'No registers include this person yet.')}
          </tbody>
        </table>
      </div>
      <button type="button" class="btn btn-outline" id="cancelModalBtn" style="margin-top:18px;">Close</button>
    `;
    document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
  } catch (err) {
    document.getElementById('modalContent').innerHTML = '<p class="empty-state">Could not load attendance history.</p>';
  }
}

// ---------- contact messages ----------
let messagesPage = 1;

async function renderMessages(el) {
  const messages = await fetchJSON('/api/shepherd/contact-messages');
  const pageItems = paginate(messages, messagesPage, SHEP_ROWS_PER_PAGE);
  const unread = messages.filter(m => m.status !== 'replied').length;

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Contact Messages (${messages.length})</h2>
        <p class="sub">Everything sent through the app's contact form comes here, and a copy goes to the shepherding email address set in Site Settings.</p>
      </div>
      ${unread ? `<div class="panel-actions">${pill(`${unread} awaiting reply`, 'amber')}</div>` : ''}
    </div>

    <div class="table-wrap">
      <table class="portal-table">
        <thead><tr><th>From</th><th>Message</th><th>Received</th><th>Status</th>${PORTAL.canEdit ? '<th>Actions</th>' : ''}</tr></thead>
        <tbody>
          ${pageItems.map(m => `
            <tr>
              <td>${escapeHtml(m.name)}<br><a href="mailto:${escapeHtml(m.email)}" class="tiny">${escapeHtml(m.email)}</a></td>
              <td>${escapeHtml(m.message)}</td>
              <td class="tiny muted">${dateTimeLabel(m.createdAt)}</td>
              <td>${pill(m.status === 'replied' ? 'replied' : 'new', m.status === 'replied' ? 'green' : 'amber')}</td>
              ${PORTAL.canEdit ? `<td class="row-actions">
                <button data-reply="${escapeHtml(m.email)}" data-name="${escapeHtml(m.name)}">Reply by Email</button>
                <button data-toggle="${m.id}" data-status="${m.status}">${m.status === 'replied' ? 'Mark Unhandled' : 'Mark Replied'}</button>
              </td>` : ''}
            </tr>
          `).join('') || emptyRow(PORTAL.canEdit ? 5 : 4, 'No messages have come in yet.')}
        </tbody>
      </table>
    </div>
    <div id="messagesPagination"></div>
  `;

  renderPaginationControls('messagesPagination', messages.length, SHEP_ROWS_PER_PAGE, messagesPage, (p) => {
    messagesPage = p;
    openPanel('messages');
  });

  el.querySelectorAll('[data-reply]').forEach(btn => {
    btn.addEventListener('click', () => {
      window.location.href = `mailto:${btn.dataset.reply}?subject=${encodeURIComponent('Re: your message to ACONSU')}`;
    });
  });
  el.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetchJSON(`/api/shepherd/contact-messages/${btn.dataset.toggle}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: btn.dataset.status === 'replied' ? 'new' : 'replied' })
      });
      openPanel('messages');
    });
  });
}

// ---------- membership workflow (section 7) ----------
// REGISTERED -> VISITOR -> SHEPHERDING REVIEW -> ACCEPTED -> ASSIGNED
// SHEPHERD -> ACTIVE. Every registration lands here first; this is the one
// place that moves someone forward.
const STAGE_LABELS = { visitor: 'Visitor', under_review: 'Under Review', accepted: 'Accepted', active: 'Active Member' };
const NEXT_STAGE = { visitor: 'under_review', under_review: 'accepted' };
const NEXT_ACTION_LABEL = { visitor: 'Begin Review', under_review: 'Accept as Member' };

async function moveStage(memberId, stage, extra) {
  try {
    await fetchJSON(`/api/shepherd/members/${memberId}/stage`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage, ...(extra || {}) })
    });
    showToast(`Marked as ${STAGE_LABELS[stage]}.`, 'success');
    openPanel('visitors');
  } catch (err) {
    showToast(err.message || 'Could not update this person.', 'error');
  }
}

function assignShepherdForm(person) {
  showModal(`
    <h3>Assign Shepherd &amp; Activate</h3>
    <p class="hint">${escapeHtml(person.name)} becomes an active member once a shepherd is assigned — their digital membership card is issued at the same time.</p>
    <form id="assignShepherdForm">
      <div class="field"><label>Shepherd's Name</label>
        <input type="text" id="shepherdNameInput" placeholder="Who is shepherding this person?" required></div>
      <div style="display:flex; gap:10px;">
        <button type="submit" class="btn btn-primary">Activate Membership</button>
        <button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button>
      </div>
      <div class="form-msg" id="assignShepherdMsg"></div>
    </form>
  `);
  document.getElementById('assignShepherdForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const shepherdName = document.getElementById('shepherdNameInput').value.trim();
    if (!shepherdName) return;
    await moveStage(person.memberId, 'active', { shepherdName });
    closeModal();
  });
}

async function renderVisitors(el) {
  const people = await fetchJSON('/api/shepherd/members');
  // Only ACONSU accounts go through this workflow — a manually-added visitor
  // record with no account isn't a "registration" to review yet.
  const withAccount = people.filter(p => p.source === 'member');
  const pipeline = withAccount.filter(p => p.membershipStage !== 'active');
  const active = withAccount.filter(p => p.membershipStage === 'active');

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Membership Workflow</h2>
        <p class="sub">Visitor &rarr; Shepherding Review &rarr; Accepted &rarr; Assigned Shepherd &rarr; Active Member.</p>
      </div>
    </div>

    <div class="stat-grid">
      ${statCard('New Visitors', withAccount.filter(p => p.membershipStage === 'visitor').length, { tone: 'gold' })}
      ${statCard('Under Review', withAccount.filter(p => p.membershipStage === 'under_review').length)}
      ${statCard('Accepted, Awaiting Shepherd', withAccount.filter(p => p.membershipStage === 'accepted').length)}
      ${statCard('Active Members', active.length, { tone: 'good' })}
    </div>

    <div class="portal-card">
      <h3>In Progress</h3>
      <div class="table-wrap">
        <table class="portal-table">
          <thead><tr><th></th><th>Name</th><th>Contact</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${pipeline.map(p => `
              <tr>
                <td>${avatar(p)}</td>
                <td><strong>${escapeHtml(p.name)}</strong></td>
                <td class="tiny muted">${escapeHtml(p.email || p.phone || '—')}</td>
                <td>${pill(STAGE_LABELS[p.membershipStage] || p.membershipStage)}</td>
                <td>
                  <div class="row-actions">
                    ${NEXT_STAGE[p.membershipStage] ? `<button data-advance="${p.memberId}" data-stage="${NEXT_STAGE[p.membershipStage]}">${NEXT_ACTION_LABEL[p.membershipStage]}</button>` : ''}
                    ${p.membershipStage === 'accepted' ? `<button data-assign="${p.memberId}">Assign Shepherd &amp; Activate</button>` : ''}
                  </div>
                </td>
              </tr>
            `).join('') || emptyRow(5, 'Nobody is in the visitor pipeline right now.')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="portal-card">
      <h3>Active Members</h3>
      <p class="hint">${active.length} member${active.length === 1 ? '' : 's'} with an assigned shepherd and a digital membership card.</p>
      <div class="table-wrap">
        <table class="portal-table">
          <thead><tr><th></th><th>Name</th><th>Membership No.</th><th>Shepherd</th></tr></thead>
          <tbody>
            ${active.slice(0, 20).map(p => `
              <tr>
                <td>${avatar(p)}</td>
                <td>${escapeHtml(p.name)}</td>
                <td class="tiny muted">${escapeHtml(p.membershipNumber || '—')}</td>
                <td class="tiny muted">${escapeHtml(p.shepherdName || '—')}</td>
              </tr>
            `).join('') || emptyRow(4, 'No active members yet.')}
          </tbody>
        </table>
      </div>
      ${active.length > 20 ? `<p class="tiny muted" style="margin-top:10px;">Showing the first 20 — see the Members tab for everyone.</p>` : ''}
    </div>
  `;

  el.querySelectorAll('[data-advance]').forEach(btn => {
    btn.addEventListener('click', () => moveStage(btn.dataset.advance, btn.dataset.stage));
  });
  el.querySelectorAll('[data-assign]').forEach(btn => {
    btn.addEventListener('click', () => assignShepherdForm(pipeline.find(p => p.memberId === btn.dataset.assign)));
  });
}

initPortal({
  role: 'shepherding',
  label: 'Shepherding',
  panels: [
    { key: 'overview', label: 'Overview', render: renderShepOverview },
    { key: 'visitors', label: 'Membership Workflow', render: renderVisitors },
    { key: 'attendance', label: 'Attendance', render: renderAttendance },
    { key: 'members', label: 'Members', render: renderShepMembers },
    { key: 'messages', label: 'Messages', render: renderMessages }
  ]
});
