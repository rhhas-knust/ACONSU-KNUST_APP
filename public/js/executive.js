/* ============================================================
   Executive Portal — self-service profile + event submission
   (section 9). An executive can only ever see/edit their own
   record; event submissions go into Publicity's review queue
   rather than publishing directly.
   ============================================================ */

async function renderExecProfile(el) {
  const [{ item }, departments] = await Promise.all([
    fetchJSON('/api/executive/me'),
    fetchJSON('/api/departments')
  ]);
  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>My Executive Profile</h2>
        <p class="sub">Shown publicly on the About page. Update it whenever your position or department changes — last year's info is kept on file automatically.</p>
      </div>
    </div>
    <div class="portal-card" style="max-width:520px;">
      <form id="execForm">
        <div class="field" style="text-align:center;">
          ${item && item.imageFileId ? `<img src="/api/files/${item.imageFileId}" alt="" style="width:96px; height:96px; border-radius:50%; object-fit:cover; margin-bottom:10px;">` : ''}
          <label>Photo</label>
          <input type="file" id="eImage" accept="image/*">
        </div>
        <div class="field"><label>Full Name</label><input type="text" id="eName" value="${escapeHtml(item?.name || '')}" required></div>
        <div class="field"><label>Position</label><input type="text" id="eRole" value="${escapeHtml(item?.role || '')}" placeholder="e.g. Financial Secretary" required></div>
        <div class="field"><label>Department (required)</label><select id="eDept" required>
          <option value="">Choose your department</option>
          ${departments.map(d => `<option value="${escapeHtml(d.id)}" ${item?.department === d.id ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}
        </select></div>
        <div class="field"><label>Department Header</label><input type="file" id="eDeptHeader" accept="image/*">
          <small class="hint">Upload the banner for your assigned department. It will replace the current header.</small></div>
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
      formData.append('role', document.getElementById('eRole').value);
      formData.append('department', document.getElementById('eDept').value);
      formData.append('bio', document.getElementById('eBio').value);
      formData.append('phone', document.getElementById('ePhone').value);
      formData.append('email', document.getElementById('eEmail').value);
      await fetchJSON('/api/executive/me', { method: 'PUT', body: formData });
      const headerFile = document.getElementById('eDeptHeader').files[0];
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

initPortal({
  role: 'executive',
  label: 'Executive',
  panels: [
    { key: 'profile', label: 'My Profile', render: renderExecProfile },
    { key: 'department', label: 'My Department', render: renderExecDepartment },
    { key: 'members', label: 'Department Members', render: renderExecDeptMembers },
    { key: 'attendance', label: 'Attendance', render: renderExecDeptAttendance },
    { key: 'announce', label: 'Message Department', render: renderExecAnnounce },
    { key: 'bibleStudies', label: 'Bible Studies', render: renderExecBibleStudies },
    { key: 'events', label: 'My Events', render: renderExecEvents }
  ]
});
