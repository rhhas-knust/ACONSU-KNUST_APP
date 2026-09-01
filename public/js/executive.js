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

initPortal({
  role: 'executive',
  label: 'Executive',
  panels: [
    { key: 'profile', label: 'My Profile', render: renderExecProfile },
    { key: 'events', label: 'My Events', render: renderExecEvents }
  ]
});
