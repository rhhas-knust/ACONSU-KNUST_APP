/* ============================================================
   Executive Portal (section 9).

   What an executive sees is decided by the POSITION they hold,
   not by the fact that they are an executive. The six elected
   officers run the chapter and get chapter-wide screens; the
   portfolio officers run one department each and get the
   department screens. lib/positions.js is the single source of
   that grant — the server enforces it and this file draws from
   the same list, so a panel can never appear that the server
   would refuse.

   Position and department are deliberately read-only here: they
   decide what their holder may do, so only the Chapter
   Coordinator sets them.
   ============================================================ */

// Filled in once per sign-in, from /api/executive/me.
let EXEC_POSITION = null;

function can(capability) {
  return !!EXEC_POSITION && (EXEC_POSITION.capabilities || []).includes(capability);
}

async function renderExecProfile(el) {
  const me = await fetchJSON('/api/executive/me');
  const item = me.item;
  const position = me.position || { label: '', kind: 'unknown' };
  const departmentName = me.department ? me.department.name : '';
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>My Executive Profile</h2>
        <p class="sub">Shown publicly on the About page. Your position is set by your Chapter Coordinator — everything else here is yours to keep current.</p>
      </div>
    </div>
    ${position.kind === 'unknown' ? `
      <div class="portal-card" style="border-color: var(--flame-gold); background:#FFF8EC; max-width:520px;">
        <strong>Your position hasn't been set yet.</strong>
        <span class="muted"> Ask your Chapter Coordinator to set it and the rest of your portal will open up.</span>
      </div>` : ''}
    <div class="portal-card" style="max-width:520px;">
      <div class="field">
        <label>Position</label>
        <p style="margin:0; font-weight:600;">${escapeHtml(position.label || 'Not set')}</p>
        <small class="hint">${position.kind === 'officer'
          ? 'An officer of the chapter — you answer for the chapter as a whole, so you hold no single department.'
          : position.kind === 'portfolio'
            ? `You run the ${escapeHtml(departmentName || 'department attached to your office')}.`
            : 'Set by your Chapter Coordinator.'}</small>
      </div>
      ${me.needsDepartment ? `
        <div class="portal-card" style="border-color: var(--flame-gold); background:#FFF8EC;">
          <strong>No department attached yet.</strong>
          <span class="muted"> Your office runs a department, but none has been attached — ask your Chapter Coordinator.</span>
        </div>` : ''}
      <form id="execForm">
        <div class="field" style="text-align:center;">
          ${item && item.imageFileId ? `<img src="/api/files/${item.imageFileId}" alt="" style="width:96px; height:96px; border-radius:50%; object-fit:cover; margin-bottom:10px;">` : ''}
          <label>Photo</label>
          <input type="file" id="eImage" accept="image/*">
        </div>
        <div class="field"><label>Full Name</label><input type="text" id="eName" value="${escapeHtml(item?.name || '')}" required></div>
        ${can('department') && departmentName ? `
        <div class="field"><label>Department Header</label><input type="file" id="eDeptHeader" accept="image/*">
          <small class="hint">The banner for ${escapeHtml(departmentName)}. It will replace the current header.</small></div>` : ''}
        <div class="field"><label>Bio</label><textarea id="eBio" rows="4">${escapeHtml(item?.bio || '')}</textarea></div>
        <div class="field-row">
          <div class="field"><label>Phone</label><input type="tel" id="ePhone" value="${escapeHtml(item?.contact?.phone || '')}"></div>
          <div class="field"><label>Email</label><input type="email" id="eEmail" value="${escapeHtml(item?.contact?.email || '')}"></div>
        </div>
        <button type="submit" class="btn btn-primary">Save Profile</button>
        <div class="form-msg" id="execFormMsg"></div>
      </form>
      ${(item?.history || []).length ? `
        <h4 style="margin-top:22px;">Past Years</h4>
        <div class="table-wrap"><table class="portal-table" style="min-width:0;">
          <thead><tr><th>Year</th><th>Position</th><th>Department</th></tr></thead>
          <tbody>${item.history.map(h => `<tr><td>${escapeHtml(h.year)}</td><td>${escapeHtml(h.role || '—')}</td><td>${escapeHtml(h.department || '—')}</td></tr>`).join('')}</tbody>
        </table></div>
      ` : ''}
    </div>
  `;

  document.getElementById('execForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const formData = new FormData();
      const imgFile = document.getElementById('eImage').files[0];
      if (imgFile) formData.append('image', imgFile);
      formData.append('name', document.getElementById('eName').value);
      formData.append('bio', document.getElementById('eBio').value);
      formData.append('phone', document.getElementById('ePhone').value);
      formData.append('email', document.getElementById('eEmail').value);
      await fetchJSON('/api/executive/me', { method: 'PUT', body: formData });
      const headerInput = document.getElementById('eDeptHeader');
      const headerFile = headerInput && headerInput.files[0];
      if (headerFile) {
        const headerData = new FormData();
        headerData.append('file', headerFile);
        await fetchJSON('/api/executive/department-header', { method: 'POST', body: headerData });
      }
      showToast('Profile saved.', 'success');
      openPanel('profile');
    } catch (err) {
      setFormMsg('execFormMsg', err.message || 'Could not save your profile.', 'error');
    }
  });
}

async function renderExecEvents(el) {
  const items = await fetchJSON('/api/executive/events');
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Submit an Event</h2>
        <p class="sub">Goes to Publicity for review — it won't appear publicly until they approve and publish it.</p>
      </div>
    </div>
    <div class="portal-card" style="max-width:520px;">
      <form id="eventSubmitForm">
        <div class="field"><label>Title</label><input type="text" id="evTitle" required></div>
        <div class="field-row">
          <div class="field"><label>Date</label><input type="date" id="evDate" required></div>
          <div class="field"><label>Time</label><input type="time" id="evTime"></div>
        </div>
        <div class="field"><label>Location</label><input type="text" id="evLocation"></div>
        <div class="field"><label>Category</label><input type="text" id="evCategory" placeholder="e.g. Outreach, Retreat, Social"></div>
        <div class="field"><label>Description</label><textarea id="evDescription" rows="3"></textarea></div>
        <button type="submit" class="btn btn-primary">Submit for Review</button>
        <div class="form-msg" id="eventSubmitMsg"></div>
      </form>
    </div>

    <div class="portal-card">
      <h3>My Submissions</h3>
      <div class="table-wrap">
        <table class="portal-table">
          <thead><tr><th>Title</th><th>Date</th><th>Status</th><th>Reviewer Notes</th></tr></thead>
          <tbody>
            ${items.map(ev => `
              <tr>
                <td>${escapeHtml(ev.title)}</td>
                <td>${shortDate(ev.date)}</td>
                <td>${pill(ev.status)}</td>
                <td class="tiny muted">${escapeHtml(ev.reviewNotes || '—')}</td>
              </tr>
            `).join('') || emptyRow(4, 'No events submitted yet.')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('eventSubmitForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await fetchJSON('/api/executive/events', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: document.getElementById('evTitle').value,
          date: document.getElementById('evDate').value,
          time: document.getElementById('evTime').value,
          location: document.getElementById('evLocation').value,
          category: document.getElementById('evCategory').value,
          description: document.getElementById('evDescription').value
        })
      });
      showToast('Event submitted for review.', 'success');
      document.getElementById('eventSubmitForm').reset();
      openPanel('events');
    } catch (err) {
      setFormMsg('eventSubmitMsg', err.message || 'Could not submit this event.', 'error');
    }
  });
}

// ---------- my department ----------
// Every panel below is scoped server-side to the department on this
// executive's own roster card (see requireOwnDepartment in server.js), so
// there is nothing here that says which department — there is only theirs.
// Before they've chosen one, the server says so and this shows the prompt
// rather than an error.
function departmentPrompt(el, message) {
  el.innerHTML = `
    <div class="panel-head"><div><h2>My Department</h2></div></div>
    <p class="empty-state">${escapeHtml(message)}</p>
    <div style="text-align:center;"><button class="btn btn-primary btn-sm" id="goToProfileBtn">Open My Profile</button></div>
  `;
  const btn = document.getElementById('goToProfileBtn');
  if (btn) btn.addEventListener('click', () => openPanel('profile'));
}

async function renderExecDepartment(el) {
  let data;
  try {
    data = await fetchJSON('/api/executive/department');
  } catch (err) {
    return departmentPrompt(el, err.message || 'Choose your department on your profile first.');
  }
  const d = data.department;
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>${escapeHtml(d.name || 'My Department')}</h2>
        <p class="sub">This is what visitors see on your department's page. Keep the meeting details current — they're how people find you.</p>
      </div>
    </div>

    <div class="stat-grid">
      ${statCard('Members', data.memberCount)}
      ${statCard('Meetings Logged', data.meetingCount)}
      ${statCard('Last Meeting', data.lastMeeting ? `${data.lastMeeting.present} present` : '—',
        { tone: data.lastMeeting ? 'good' : '' })}
    </div>

    <div class="portal-card" style="max-width:620px;">
      <form id="deptForm">
        <div class="field"><label>Tagline</label>
          <input type="text" id="dTagline" value="${escapeHtml(d.tagline || '')}" placeholder="A short line that sums up this department"></div>
        <div class="field"><label>Description</label>
          <textarea id="dDescription" rows="4">${escapeHtml(d.description || '')}</textarea></div>
        <div class="field-row">
          <div class="field"><label>Meeting Day</label>
            <input type="text" id="dMeetingDay" value="${escapeHtml(d.meetingDay || '')}" placeholder="e.g. Saturdays"></div>
          <div class="field"><label>Meeting Time</label>
            <input type="text" id="dMeetingTime" value="${escapeHtml(d.meetingTime || '')}" placeholder="e.g. 4:00 PM"></div>
        </div>
        <div class="field"><label>Meeting Location</label>
          <input type="text" id="dMeetingLocation" value="${escapeHtml(d.meetingLocation || '')}"></div>
        <button type="submit" class="btn btn-primary">Save Department</button>
        <div class="form-msg" id="deptMsg"></div>
      </form>
    </div>
  `;

  document.getElementById('deptForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await fetchJSON('/api/executive/department', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tagline: document.getElementById('dTagline').value,
          description: document.getElementById('dDescription').value,
          meetingDay: document.getElementById('dMeetingDay').value,
          meetingTime: document.getElementById('dMeetingTime').value,
          meetingLocation: document.getElementById('dMeetingLocation').value
        })
      });
      showToast('Department updated.', 'success');
      openPanel('department');
    } catch (err) {
      setFormMsg('deptMsg', err.message || 'Could not save your department.', 'error');
    }
  });
}

async function renderExecDeptMembers(el) {
  let members;
  try {
    members = await fetchJSON('/api/executive/department/members');
  } catch (err) {
    return departmentPrompt(el, err.message || 'Choose your department on your profile first.');
  }
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Department Members</h2>
        <p class="sub">The people in your department, so you can reach them. Their wider records stay with Shepherding.</p>
      </div>
      <div class="panel-actions"><span class="tiny muted">${members.length} member${members.length === 1 ? '' : 's'}</span></div>
    </div>
    <div class="table-wrap">
      <table class="portal-table">
        <thead><tr><th>Name</th><th>Level / Programme</th><th>Contact</th><th>Stage</th></tr></thead>
        <tbody>
          ${members.map(m => `
            <tr>
              <td><strong>${escapeHtml(m.name || '—')}</strong></td>
              <td class="tiny muted">${escapeHtml([m.level, m.programme].filter(Boolean).join(' · ') || '—')}</td>
              <td class="tiny muted">${escapeHtml(m.phone || m.email || '—')}</td>
              <td>${pill(m.membershipStage || 'visitor')}</td>
            </tr>
          `).join('') || emptyRow(4, 'Nobody has joined this department yet.')}
        </tbody>
      </table>
    </div>
  `;
}

async function renderExecDeptAttendance(el) {
  let members, meetings;
  try {
    [members, meetings] = await Promise.all([
      fetchJSON('/api/executive/department/members'),
      fetchJSON('/api/executive/department/meetings')
    ]);
  } catch (err) {
    return departmentPrompt(el, err.message || 'Choose your department on your profile first.');
  }
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Department Attendance</h2>
        <p class="sub">Open, tap whoever came, save. This is your department's own register — the chapter's service attendance is kept separately by Shepherding.</p>
      </div>
    </div>

    <div class="portal-card">
      <form id="deptMeetingForm">
        <div class="field-row">
          <div class="field"><label>Date</label>
            <input type="date" id="mDate" value="${todayISO()}" required></div>
          <div class="field"><label>Topic (optional)</label>
            <input type="text" id="mTopic" placeholder="What the meeting covered"></div>
        </div>
        <label>Who was present</label>
        <div class="choice-grid" id="attendeeGrid" style="margin-top:8px;">
          ${members.map(m => `
            <label class="choice">
              <input type="checkbox" value="${escapeHtml(m.id)}" data-attendee>
              <span><strong>${escapeHtml(m.name || '—')}</strong></span>
            </label>
          `).join('') || '<p class="hint">Nobody is in this department yet, so there is no one to mark.</p>'}
        </div>
        <div style="margin-top:18px;">
          <button type="submit" class="btn btn-primary" ${members.length ? '' : 'disabled'}>Save Register</button>
          <span class="tiny muted" id="attendeeCount" style="margin-left:10px;">0 marked present</span>
        </div>
        <div class="form-msg" id="deptMeetingMsg"></div>
      </form>
    </div>

    <div class="portal-card">
      <h3>Past Meetings</h3>
      <div class="table-wrap">
        <table class="portal-table">
          <thead><tr><th>Date</th><th>Topic</th><th class="num">Present</th><th>Recorded by</th></tr></thead>
          <tbody>
            ${meetings.map(m => `
              <tr>
                <td>${shortDate(m.date)}</td>
                <td>${escapeHtml(m.topic || '—')}</td>
                <td class="num">${(m.attendeeMemberIds || []).length}</td>
                <td class="tiny muted">${escapeHtml(m.recordedBy || '—')}</td>
              </tr>
            `).join('') || emptyRow(4, 'No meetings logged yet.')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  const countLabel = document.getElementById('attendeeCount');
  const boxes = () => Array.from(el.querySelectorAll('[data-attendee]'));
  const refreshCount = () => {
    const n = boxes().filter(b => b.checked).length;
    countLabel.textContent = `${n} marked present`;
  };
  boxes().forEach(b => b.addEventListener('change', () => {
    b.closest('.choice').classList.toggle('selected', b.checked);
    refreshCount();
  }));

  document.getElementById('deptMeetingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await fetchJSON('/api/executive/department/meetings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: document.getElementById('mDate').value,
          topic: document.getElementById('mTopic').value,
          attendeeMemberIds: boxes().filter(b => b.checked).map(b => b.value)
        })
      });
      showToast('Register saved.', 'success');
      openPanel('attendance');
    } catch (err) {
      setFormMsg('deptMeetingMsg', err.message || 'Could not save this register.', 'error');
    }
  });
}

async function renderExecAnnounce(el) {
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Message My Department</h2>
        <p class="sub">Goes to your department's members. Chapter-wide announcements stay with the Coordinator and Publicity.</p>
      </div>
    </div>
    <div class="portal-card" style="max-width:560px;">
      <form id="deptAnnounceForm">
        <div class="field"><label>Title</label><input type="text" id="anTitle" required></div>
        <div class="field"><label>Message</label><textarea id="anBody" rows="4" required></textarea></div>
        <button type="submit" class="btn btn-primary">Send to Department</button>
        <div class="form-msg" id="deptAnnounceMsg"></div>
      </form>
    </div>
  `;
  document.getElementById('deptAnnounceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await fetchJSON('/api/executive/department/announcement', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: document.getElementById('anTitle').value,
          body: document.getElementById('anBody').value
        })
      });
      showToast(`Sent to ${res.reached} department member${res.reached === 1 ? '' : 's'}.`, 'success');
      document.getElementById('deptAnnounceForm').reset();
    } catch (err) {
      setFormMsg('deptAnnounceMsg', err.message || 'Could not send this announcement.', 'error');
    }
  });
}

// ---------- bible studies ----------
// Executives have always been allowed to run these (requireBibleStudyManager
// in server.js); until now there was simply no screen for it.
async function renderExecBibleStudies(el) {
  const studies = await fetchJSON('/api/bible-studies');
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Bible Studies</h2>
        <p class="sub">Study outlines for the chapter. What you publish here appears in the Bible Study section of the app.</p>
      </div>
      <div class="panel-actions"><button class="btn btn-primary btn-sm" id="newStudyBtn">+ New Study</button></div>
    </div>
    <div class="table-wrap">
      <table class="portal-table">
        <thead><tr><th>Topic</th><th>Date</th><th>Scripture</th><th></th></tr></thead>
        <tbody>
          ${studies.map(s => `
            <tr>
              <td><strong>${escapeHtml(s.topic || '—')}</strong></td>
              <td>${shortDate(s.date)}</td>
              <td class="tiny muted">${escapeHtml(s.scriptureReference || '—')}</td>
              <td><div class="row-actions"><button data-delete-study="${s.id}" class="danger">Remove</button></div></td>
            </tr>
          `).join('') || emptyRow(4, 'No Bible studies yet.')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('newStudyBtn').addEventListener('click', () => {
    showModal(`
      <h3>New Bible Study</h3>
      <form id="studyForm">
        <div class="field"><label>Topic</label><input type="text" id="stTopic" required></div>
        <div class="field-row">
          <div class="field"><label>Date</label><input type="date" id="stDate" value="${todayISO()}" required></div>
          <div class="field"><label>Scripture</label><input type="text" id="stRef" placeholder="e.g. James 2:14-26"></div>
        </div>
        <div class="field"><label>Study Material</label><textarea id="stMaterial" rows="5"></textarea></div>
        <div style="display:flex; gap:10px; margin-top:22px;">
          <button type="submit" class="btn btn-primary">Save Study</button>
          <button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button>
        </div>
        <div class="form-msg" id="studyMsg"></div>
      </form>
    `);
    const cancel = document.getElementById('cancelModalBtn');
    if (cancel) cancel.addEventListener('click', closeModal);
    document.getElementById('studyForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await fetchJSON('/api/admin/bible-studies', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic: document.getElementById('stTopic').value,
            date: document.getElementById('stDate').value,
            scriptureReference: document.getElementById('stRef').value,
            studyMaterial: document.getElementById('stMaterial').value
          })
        });
        closeModal();
        showToast('Bible study saved.', 'success');
        openPanel('bibleStudies');
      } catch (err) {
        setFormMsg('studyMsg', err.message || 'Could not save this study.', 'error');
      }
    });
  });

  el.querySelectorAll('[data-delete-study]').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm('Remove this Bible study?')) return;
    try {
      await fetchJSON(`/api/admin/bible-studies/${btn.dataset.deleteStudy}`, { method: 'DELETE' });
      showToast('Study removed.', 'success');
      openPanel('bibleStudies');
    } catch (err) {
      showToast(err.message || 'Could not remove this study.', 'error');
    }
  }));
}

/* ---------- chapter-wide screens, for the elected officers ---------- */

async function renderExecChapterPulse(el) {
  const d = await fetchJSON('/api/executive/chapter/pulse');
  const stageRows = Object.entries(d.byStage || {})
    .sort((a, b) => b[1] - a[1])
    .map(([stage, count]) => `<tr><td>${escapeHtml(stage.replace(/_/g, ' '))}</td><td>${count}</td></tr>`)
    .join('');
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>The Chapter at a Glance</h2>
        <p class="sub">Where the chapter stands today — membership, departments and what is coming up.</p>
      </div>
    </div>
    <div class="stat-row" style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:16px;">
      ${[['Members', d.memberCount], ['Departments', d.departmentCount], ['Executives', d.executiveCount], ['Events awaiting review', d.pendingEvents]]
        .map(([label, value]) => `
          <div class="portal-card" style="flex:1 1 140px; min-width:140px; text-align:center;">
            <div style="font-size:1.8rem; font-weight:700;">${value}</div>
            <div class="muted" style="font-size:0.8rem;">${escapeHtml(label)}</div>
          </div>`).join('')}
    </div>
    <div class="portal-card">
      <h4 style="margin-top:0;">Membership</h4>
      ${stageRows
        ? `<div class="table-wrap"><table class="portal-table" style="min-width:0;">
             <thead><tr><th>Stage</th><th>People</th></tr></thead><tbody>${stageRows}</tbody></table></div>`
        : '<p class="empty-state">No members yet.</p>'}
    </div>
    <div class="portal-card">
      <h4 style="margin-top:0;">Coming Up</h4>
      ${(d.upcomingEvents || []).length ? `
        <div class="table-wrap"><table class="portal-table" style="min-width:0;">
          <thead><tr><th>Date</th><th>Event</th><th>Where</th></tr></thead>
          <tbody>${d.upcomingEvents.map(e => `
            <tr><td>${escapeHtml(e.date)}</td><td>${escapeHtml(e.title)}</td><td>${escapeHtml(e.location || '—')}</td></tr>
          `).join('')}</tbody>
        </table></div>` : '<p class="empty-state">Nothing on the calendar yet.</p>'}
    </div>
  `;
}

async function renderExecChapterMembers(el) {
  const members = await fetchJSON('/api/executive/chapter/members');
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Chapter Members</h2>
        <p class="sub">Everyone in the chapter, across every department.</p>
      </div>
      <div class="panel-actions"><span class="tiny muted">${members.length} member${members.length === 1 ? '' : 's'}</span></div>
    </div>
    <div class="portal-card">
      <div class="field"><input type="search" id="memberSearch" placeholder="Search by name, department or programme"></div>
      ${members.length ? `
        <div class="table-wrap"><table class="portal-table">
          <thead><tr><th>Name</th><th>Department</th><th>Level</th><th>Stage</th><th>Contact</th></tr></thead>
          <tbody id="memberRows">${members.map(m => `
            <tr data-search="${escapeHtml(`${m.name} ${m.department} ${m.programme}`.toLowerCase())}">
              <td>${escapeHtml(m.name || '')}</td>
              <td>${escapeHtml(m.department || '—')}</td>
              <td>${escapeHtml(m.level || '—')}</td>
              <td>${escapeHtml((m.membershipStage || '').replace(/_/g, ' '))}</td>
              <td>${escapeHtml(m.phone || m.email || '—')}</td>
            </tr>`).join('')}</tbody>
        </table></div>` : '<p class="empty-state">No members yet.</p>'}
    </div>
  `;
  const search = document.getElementById('memberSearch');
  if (search) {
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      document.querySelectorAll('#memberRows tr').forEach(row => {
        row.style.display = !q || row.dataset.search.includes(q) ? '' : 'none';
      });
    });
  }
}

async function renderExecChapterDepartments(el) {
  const departments = await fetchJSON('/api/executive/chapter/departments');
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Departments</h2>
        <p class="sub">Every department in the chapter, who heads it and how many belong to it.</p>
      </div>
    </div>
    <div class="portal-card">
      ${departments.length ? `
        <div class="table-wrap"><table class="portal-table">
          <thead><tr><th>Department</th><th>Head</th><th>Members</th><th>Meets</th></tr></thead>
          <tbody>${departments.map(d => `
            <tr>
              <td><strong>${escapeHtml(d.name)}</strong>${d.tagline ? `<br><span class="tiny muted">${escapeHtml(d.tagline)}</span>` : ''}</td>
              <td>${d.headName ? `${escapeHtml(d.headName)}<br><span class="tiny muted">${escapeHtml(d.headRole || '')}</span>` : '<span class="muted">Vacant</span>'}</td>
              <td>${d.memberCount}</td>
              <td>${escapeHtml([d.meetingDay, d.meetingTime].filter(Boolean).join(', ') || '—')}</td>
            </tr>`).join('')}</tbody>
        </table></div>` : '<p class="empty-state">No departments yet.</p>'}
    </div>
  `;
}

async function renderExecChapterAttendance(el) {
  const records = await fetchJSON('/api/executive/chapter/attendance');
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Service Attendance</h2>
        <p class="sub">The chapter's service registers. Taking a register stays with Shepherding — this is the record of it.</p>
      </div>
    </div>
    <div class="portal-card">
      ${records.length ? `
        <div class="table-wrap"><table class="portal-table">
          <thead><tr><th>Date</th><th>Service</th><th>Present</th><th>Visitors</th></tr></thead>
          <tbody>${records.map(r => `
            <tr>
              <td>${escapeHtml(r.date)}</td>
              <td>${escapeHtml(r.title || r.serviceType || '—')}</td>
              <td>${r.present}${r.total ? ` <span class="tiny muted">of ${r.total}</span>` : ''}</td>
              <td>${r.visitorCount || 0}</td>
            </tr>`).join('')}</tbody>
        </table></div>` : '<p class="empty-state">No registers taken yet.</p>'}
    </div>
  `;
}

async function renderExecFinance(el) {
  const d = await fetchJSON('/api/executive/chapter/finance');
  const money = (n) => `GHS ${Number(n || 0).toFixed(2)}`;
  const categories = Object.entries(d.incomeByCategory || {}).sort((a, b) => b[1] - a[1]);
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>The Books</h2>
        <p class="sub">Read-only. Recording income and expenses stays with the Finance office — this is so you can answer for the money, not move it.</p>
      </div>
    </div>
    <div class="stat-row" style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:16px;">
      ${[['Income', money(d.totalIncome)], ['Expenses', money(d.totalExpense)], ['Balance', money(d.balance)], ['Awaiting approval', d.pendingApprovals]]
        .map(([label, value]) => `
          <div class="portal-card" style="flex:1 1 150px; min-width:150px; text-align:center;">
            <div style="font-size:1.3rem; font-weight:700;">${escapeHtml(String(value))}</div>
            <div class="muted" style="font-size:0.8rem;">${escapeHtml(label)}</div>
          </div>`).join('')}
    </div>
    <div class="portal-card">
      <h4 style="margin-top:0;">Where the income came from</h4>
      ${categories.length ? `
        <div class="table-wrap"><table class="portal-table" style="min-width:0;">
          <thead><tr><th>Source</th><th>Amount</th></tr></thead>
          <tbody>${categories.map(([cat, amount]) => `
            <tr><td>${escapeHtml(cat)}</td><td>${money(amount)}</td></tr>`).join('')}</tbody>
        </table></div>` : '<p class="empty-state">Nothing recorded yet.</p>'}
    </div>
  `;
}

async function renderExecMinutes(el) {
  const items = await fetchJSON('/api/executive/minutes');
  const canAdopt = ['president', 'vice_president', 'secretary'].includes(EXEC_POSITION && EXEC_POSITION.key);
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Executive Minutes</h2>
        <p class="sub">The record of what the executive body decided. Drafts become the record once adopted.</p>
      </div>
      <div class="panel-actions"><button class="btn btn-primary btn-sm" id="newMinuteBtn">+ New Minutes</button></div>
    </div>
    <div class="portal-card">
      ${items.length ? `
        <div class="table-wrap"><table class="portal-table">
          <thead><tr><th>Date</th><th>Title</th><th>Status</th><th></th></tr></thead>
          <tbody>${items.map(m => `
            <tr>
              <td>${escapeHtml(m.date)}</td>
              <td>${escapeHtml(m.title || '—')}<br><span class="tiny muted">${escapeHtml((m.body || '').slice(0, 90))}${(m.body || '').length > 90 ? '…' : ''}</span></td>
              <td>${m.status === 'adopted'
                ? `<span class="tiny">Adopted${m.adoptedBy ? ` by ${escapeHtml(m.adoptedBy)}` : ''}</span>`
                : '<span class="tiny muted">Draft</span>'}</td>
              <td>${m.status !== 'adopted' && canAdopt
                ? `<button class="btn btn-sm" data-adopt="${escapeHtml(m.id)}">Adopt</button>` : ''}</td>
            </tr>`).join('')}</tbody>
        </table></div>` : '<p class="empty-state">No minutes recorded yet.</p>'}
    </div>
  `;

  document.getElementById('newMinuteBtn').addEventListener('click', () => {
    showModal(`
      <h3>New Minutes</h3>
      <form id="minuteForm">
        <div class="field-row">
          <div class="field"><label>Date</label><input type="date" id="mDate" value="${todayISO()}" required></div>
          <div class="field"><label>Title</label><input type="text" id="mTitle" placeholder="e.g. Term planning"></div>
        </div>
        <div class="field"><label>Minutes</label><textarea id="mBody" rows="6" required placeholder="What was discussed"></textarea></div>
        <div class="field"><label>Decisions</label><textarea id="mDecisions" rows="3" placeholder="Resolutions taken"></textarea></div>
        <div class="field"><label>Apologies</label><input type="text" id="mApologies" placeholder="Who sent apologies"></div>
        <div style="display:flex; gap:10px; margin-top:22px;">
          <button type="submit" class="btn btn-primary">Save as Draft</button>
          <button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button>
        </div>
        <div class="form-msg" id="minuteMsg"></div>
      </form>
    `);
    const cancelMinute = document.getElementById('cancelModalBtn');
    if (cancelMinute) cancelMinute.addEventListener('click', closeModal);
    document.getElementById('minuteForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await fetchJSON('/api/executive/minutes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: document.getElementById('mDate').value,
            title: document.getElementById('mTitle').value,
            body: document.getElementById('mBody').value,
            decisions: document.getElementById('mDecisions').value,
            apologies: document.getElementById('mApologies').value
          })
        });
        closeModal();
        showToast('Minutes saved as a draft.', 'success');
        openPanel('minutes');
      } catch (err) {
        setFormMsg('minuteMsg', err.message || 'Could not save these minutes.', 'error');
      }
    });
  });

  el.querySelectorAll('[data-adopt]').forEach(btn => btn.addEventListener('click', async () => {
    try {
      await fetchJSON(`/api/executive/minutes/${btn.dataset.adopt}/adopt`, { method: 'PATCH' });
      showToast('Minutes adopted.', 'success');
      openPanel('minutes');
    } catch (err) {
      showToast(err.message || 'Could not adopt these minutes.', 'error');
    }
  }));
}

async function renderExecChapterAnnounce(el) {
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Message the Chapter</h2>
        <p class="sub">Goes to everyone in the chapter, in-app and by push. Use it for what the whole chapter needs to know.</p>
      </div>
    </div>
    <div class="portal-card" style="max-width:520px;">
      <form id="chapterAnnounceForm">
        <div class="field"><label>Title</label><input type="text" id="caTitle" required></div>
        <div class="field"><label>Message</label><textarea id="caBody" rows="4" required></textarea></div>
        <button type="submit" class="btn btn-primary">Send to the Chapter</button>
        <div class="form-msg" id="chapterAnnounceMsg"></div>
      </form>
    </div>
  `;
  document.getElementById('chapterAnnounceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await fetchJSON('/api/executive/chapter/announcement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: document.getElementById('caTitle').value,
          body: document.getElementById('caBody').value
        })
      });
      showToast(`Sent to ${res.reached} member${res.reached === 1 ? '' : 's'}.`, 'success');
      openPanel('chapterAnnounce');
    } catch (err) {
      setFormMsg('chapterAnnounceMsg', err.message || 'Could not send this announcement.', 'error');
    }
  });
}

/* ---------- which panels this executive actually gets ---------- */
// Every panel names the capability it needs. The list is filtered against the
// grant the server sent, so the portal and the server can never disagree about
// what this office may do.
const EXEC_PANELS = [
  { key: 'profile',          label: 'My Profile',          capability: 'profile',              render: renderExecProfile },
  { key: 'pulse',            label: 'Chapter Overview',    capability: 'chapter.pulse',        render: renderExecChapterPulse },
  { key: 'chapterMembers',   label: 'Chapter Members',     capability: 'chapter.members',      render: renderExecChapterMembers },
  { key: 'chapterDepts',     label: 'Departments',         capability: 'chapter.departments',  render: renderExecChapterDepartments },
  { key: 'minutes',          label: 'Minutes',             capability: 'minutes',              render: renderExecMinutes },
  { key: 'chapterAttend',    label: 'Service Attendance',  capability: 'attendance.chapter',   render: renderExecChapterAttendance },
  { key: 'finance',          label: 'The Books',           capability: 'finance.summary',      render: renderExecFinance },
  { key: 'chapterAnnounce',  label: 'Message Chapter',     capability: 'announce.chapter',     render: renderExecChapterAnnounce },
  { key: 'department',       label: 'My Department',       capability: 'department',           render: renderExecDepartment },
  { key: 'members',          label: 'Department Members',  capability: 'department.members',   render: renderExecDeptMembers },
  { key: 'attendance',       label: 'Attendance',          capability: 'department.attendance', render: renderExecDeptAttendance },
  { key: 'announce',         label: 'Message Department',  capability: 'announce.department',  render: renderExecAnnounce },
  { key: 'bibleStudies',     label: 'Bible Studies',       capability: 'bibleStudies',         render: renderExecBibleStudies },
  { key: 'events',           label: 'My Events',           capability: 'events',               render: renderExecEvents }
];

initPortal({
  role: 'executive',
  label: 'Executive',
  panels: EXEC_PANELS,
  // Runs once the session is known: asks the server which position this is and
  // keeps only the panels it grants. The profile panel is always kept, so an
  // executive whose position has not been set yet still lands somewhere that
  // explains why the rest is missing.
  resolvePanels: async (all) => {
    const me = await fetchJSON('/api/executive/me');
    EXEC_POSITION = me.position || null;
    if (me.position && me.position.label) {
      PORTAL.label = `Executive · ${me.position.label}`;
    }
    const granted = all.filter(p => can(p.capability));
    return granted.length ? granted : all.filter(p => p.key === 'profile');
  }
});
