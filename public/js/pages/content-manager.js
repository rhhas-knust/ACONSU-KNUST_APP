// The script of content-manager.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
const KIND_LABELS = {
  live_service: 'Live Service',
  seminar: 'Seminar',
  ebook: 'E-Book',
  weekly_highlight: 'Weekly Highlight',
  founder: 'Founder',
  church_info: 'Church Info',
  aconsu_info: 'ACONSU Info'
};

let allItems = [];
let currentFilter = 'all';
let isNationalUser = false;

const q = id => document.getElementById(id);

async function init() {
  try {
    const authRes = await fetchJSON('/api/portal/me').catch(() => null);
    if (authRes && authRes.user && authRes.user.role === 'nationalCoordinator') {
      isNationalUser = true;
      q('nationalWrap').style.display = 'flex';
    }
  } catch (e) {}

  loadContent();
}

async function loadContent() {
  try {
    allItems = await fetchJSON('/api/admin/content');
    renderTable();
  } catch (e) {
    q('itemsTableBody').innerHTML = '<tr><td colspan="5" class="danger" style="text-align:center;">Could not load content. Please ensure you are logged in with admin or publicity privileges.</td></tr>';
  }
}

function renderTable() {
  const query = (q('filterSearch').value || '').trim().toLowerCase();
  const filtered = allItems.filter(item => {
    if (currentFilter !== 'all' && item.kind !== currentFilter) return false;
    if (query) {
      const matchTitle = (item.title || '').toLowerCase().includes(query);
      const matchCat = (item.category || '').toLowerCase().includes(query);
      const matchSummary = (item.summary || '').toLowerCase().includes(query);
      return matchTitle || matchCat || matchSummary;
    }
    return true;
  });

  q('totalCount').textContent = filtered.length;

  if (!filtered.length) {
    q('itemsTableBody').innerHTML = '<tr><td colspan="5" class="empty-state" style="text-align:center; padding:30px;">No content items found matching your filters.</td></tr>';
    return;
  }

  q('itemsTableBody').innerHTML = filtered.map(i => `
    <tr>
      <td>
        ${i.imageFileId 
          ? `<img src="/api/files/${i.imageFileId}" alt="" style="width:44px; height:44px; object-fit:cover; border-radius:6px;">`
          : `<div style="width:44px; height:44px; background:#eee; border-radius:6px; display:flex; align-items:center; justify-content:center; font-size:1.1rem;"></div>`
        }
      </td>
      <td>
        <span class="badge" style="font-size:0.75rem;">${escapeHtml(KIND_LABELS[i.kind] || i.kind)}</span>
        ${i.isNational || !i.chapterId ? '<span class="badge" style="background:#5B2C82; color:#fff; font-size:0.7rem; margin-top:2px;">National</span>' : ''}
      </td>
      <td>
        <strong>${escapeHtml(i.title)}</strong>
        ${i.category ? `<br><small class="muted">${escapeHtml(i.category)}</small>` : ''}
        ${i.eventDate ? `<br><small class="muted">${formatDate(i.eventDate)}</small>` : ''}
      </td>
      <td>
        <span class="pill ${i.published ? 'pill-green' : 'pill-grey'}">${i.published ? 'Published' : 'Draft'}</span>
        ${i.featured ? '<span class="pill pill-gold" style="margin-left:4px;">Featured</span>' : ''}
      </td>
      <td class="row-actions">
        <button type="button" class="btn btn-outline btn-sm" data-edit-item="${escapeHtml(i.id)}">Edit</button>
        <a href="/content.html?kind=${encodeURIComponent(i.kind)}" target="_blank" class="btn btn-outline btn-sm" style="text-decoration:none;">View &nearr;</a>
        <button type="button" class="btn btn-outline btn-sm danger" data-delete-item="${escapeHtml(i.id)}">Delete</button>
      </td>
    </tr>
  `).join('');
}

function editItem(id) {
  const item = allItems.find(i => i.id === id);
  if (!item) return;

  q('editItemId').value = item.id;
  q('formTitle').textContent = 'Edit Content: ' + item.title;
  q('saveBtn').textContent = 'Update Content';
  q('cancelBtn').style.display = 'inline-block';

  q('kind').value = item.kind;
  q('title').value = item.title || '';
  q('category').value = item.category || '';
  q('eventDate').value = item.eventDate || '';
  q('summary').value = item.summary || '';
  q('body').value = item.body || '';
  q('previewUrl').value = item.previewUrl || '';
  q('resourceUrl').value = item.resourceUrl || '';
  q('sortOrder').value = item.sortOrder || 0;
  q('published').checked = item.published !== false;
  q('featured').checked = !!item.featured;
  if (q('isNational')) q('isNational').checked = !item.chapterId;

  if (item.imageFileId) {
    q('imagePreviewBox').style.display = 'flex';
    q('currentImageThumb').src = '/api/files/' + item.imageFileId;
    q('imageFileName').textContent = 'Current Cover Photo';
  } else {
    q('imagePreviewBox').style.display = 'none';
  }

  if (item.resourceFileId) {
    q('resourcePreviewBox').style.display = 'flex';
    q('resourceFileName').textContent = 'Current Resource Attached';
  } else {
    q('resourcePreviewBox').style.display = 'none';
  }

  q('formCard').scrollIntoView({ behavior: 'smooth' });
}

function resetForm() {
  q('contentForm').reset();
  q('editItemId').value = '';
  q('formTitle').textContent = 'Create New Content';
  q('saveBtn').textContent = 'Publish Content';
  q('cancelBtn').style.display = 'none';
  q('imagePreviewBox').style.display = 'none';
  q('resourcePreviewBox').style.display = 'none';
  q('formMsg').textContent = '';
  q('published').checked = true;
}

q('cancelBtn').onclick = resetForm;

q('contentForm').onsubmit = async (e) => {
  e.preventDefault();
  const editId = q('editItemId').value;
  const isEditing = Boolean(editId);
  const saveBtn = q('saveBtn');

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  q('formMsg').textContent = '';

  try {
    const formData = new FormData();
    formData.append('kind', q('kind').value);
    formData.append('title', q('title').value);
    formData.append('category', q('category').value);
    formData.append('eventDate', q('eventDate').value);
    formData.append('summary', q('summary').value);
    formData.append('body', q('body').value);
    formData.append('previewUrl', q('previewUrl').value);
    formData.append('resourceUrl', q('resourceUrl').value);
    formData.append('sortOrder', q('sortOrder').value);
    formData.append('published', q('published').checked ? 'true' : 'false');
    formData.append('featured', q('featured').checked ? 'true' : 'false');
    if (isNationalUser) formData.append('isNational', q('isNational').checked ? 'true' : 'false');

    const imgFile = q('imageFile').files[0];
    if (imgFile) formData.append('imageFile', imgFile);

    const resFile = q('resourceFile').files[0];
    if (resFile) formData.append('resourceFile', resFile);

    const url = isEditing ? `/api/admin/content/${editId}` : '/api/admin/content';
    const method = isEditing ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      body: formData
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save content');

    showToast(isEditing ? 'Content updated successfully.' : 'Content published.', 'success');
    resetForm();
    await loadContent();
  } catch (err) {
    q('formMsg').textContent = err.message || 'Error saving content';
    q('formMsg').className = 'form-msg danger';
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = isEditing ? 'Update Content' : 'Publish Content';
  }
};

async function deleteItem(id) {
  if (!confirm('Are you sure you want to delete this content item? Attached images and PDF files will also be removed.')) return;
  try {
    await fetchJSON('/api/admin/content/' + id, { method: 'DELETE' });
    showToast('Content deleted.', 'success');
    if (q('editItemId').value === id) resetForm();
    await loadContent();
  } catch (e) {
    showToast(e.message || 'Could not delete item.', 'error');
  }
}

// Filter listeners
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderTable();
  };
});

q('filterSearch').oninput = renderTable;

init();

// The Edit and Delete buttons on each row (no handler written into the page:
// the browser refuses those, lib/securityHeaders.js).
document.addEventListener('click', (e) => {
  const edit = e.target.closest && e.target.closest('[data-edit-item]');
  if (edit) { editItem(edit.dataset.editItem); return; }
  const del = e.target.closest && e.target.closest('[data-delete-item]');
  if (del) deleteItem(del.dataset.deleteItem);
});
