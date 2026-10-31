// The script of groups.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
const GROUP_TYPES = [
  { value: '', label: 'All' },
  { value: 'bible_study', label: 'Bible Study' },
  { value: 'prayer', label: 'Prayer' },
  { value: 'fellowship', label: 'Fellowship' },
  { value: 'cell', label: 'Cell' },
  { value: 'department', label: 'Department' },
  { value: 'other', label: 'Other' }
];
let ALL_GROUPS = [];
let activeType = '';

function renderGroups() {
  const shown = activeType ? ALL_GROUPS.filter(g => g.type === activeType) : ALL_GROUPS;
  document.getElementById('groupList').innerHTML = shown.map(g => `
    <a href="/group.html?id=${g.id}" class="group-card" style="display:block; text-decoration:none; color:inherit;">
      <h3>${escapeHtml(g.name)}</h3>
      <div class="meta">${escapeHtml((GROUP_TYPES.find(t => t.value === g.type) || {}).label || g.type)} · ${g.memberCount} member${g.memberCount === 1 ? '' : 's'}${g.meetingDay ? ' · ' + escapeHtml(g.meetingDay) + (g.meetingTime ? ' ' + escapeHtml(g.meetingTime) : '') : ''}</div>
      <p style="color:var(--ink-soft); font-size:0.9rem;">${escapeHtml(g.description || '')}</p>
    </a>
  `).join('') || '<p class="empty-state">No groups yet in this category.</p>';
}

(async function () {
  await initLayout('/groups.html');
  document.getElementById('typeFilter').innerHTML = GROUP_TYPES.map(t => `<button type="button" data-type="${t.value}" class="${t.value === '' ? 'active' : ''}">${t.label}</button>`).join('');
  document.querySelectorAll('#typeFilter button').forEach(btn => btn.addEventListener('click', () => {
    activeType = btn.dataset.type;
    document.querySelectorAll('#typeFilter button').forEach(b => b.classList.toggle('active', b === btn));
    renderGroups();
  }));
  try {
    ALL_GROUPS = await fetchJSON('/api/groups');
    renderGroups();
  } catch (e) {
    document.getElementById('groupList').innerHTML = '<p class="empty-state">Could not load groups right now.</p>';
  }
})();
