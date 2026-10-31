// The script of departments.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
// This page used to be a chapter picker wearing the word "Departments" - a
// member who had already joined a chapter was still asked to choose one, and
// the departments they actually wanted were a further tap away. A signed-in
// member now lands straight on their own chapter's departments. Visitors, who
// genuinely do have a chapter to choose, still get the chapter list.
let MY_DEPARTMENTS = null;

function departmentCard(d) {
  const meets = [d.meetingDay, d.meetingTime].filter(Boolean).join(', ');
  let action;
  if (d.joined) {
    action = `<span class="pill-serving">You serve here</span>
      <button class="btn btn-outline btn-sm dept-leave" data-id="${escapeHtml(d.id)}" data-name="${escapeHtml(d.name)}">Leave</button>`;
  } else if (d.pendingRequestId) {
    action = `<span class="pill-waiting">Waiting on the head</span>
      <button class="btn btn-outline btn-sm dept-withdraw" data-id="${escapeHtml(d.id)}">Withdraw</button>`;
  } else {
    action = `<button class="btn btn-primary btn-sm dept-join" data-id="${escapeHtml(d.id)}" data-name="${escapeHtml(d.name)}">Ask to join</button>`;
  }
  return `
    <div class="card dept-card" style="padding:0; overflow:hidden; display:flex; flex-direction:column;">
      <a href="/department.html?id=${encodeURIComponent(d.id)}" class="dept-thumb" style="height:120px; display:block;">
        ${d.headerImageFileId
          ? `<img src="/api/files/${escapeHtml(d.headerImageFileId)}" alt="${escapeHtml(d.name)}">`
          : `<span class="dept-thumb-fallback" style="display:flex; align-items:center; justify-content:center; background:var(--surface-3); color:var(--brand); font-weight:800; font-size:1.75rem;">${escapeHtml((d.name || 'D').charAt(0))}</span>`}
      </a>
      <div style="padding:18px; display:flex; flex-direction:column; gap:10px; flex:1;">
        <h2 style="margin:0; font-size:1.17rem;"><a href="/department.html?id=${encodeURIComponent(d.id)}" style="color:inherit; text-decoration:none;">${escapeHtml(d.name)}</a></h2>
        ${d.tagline ? `<p style="margin:0; color:var(--ink-soft); font-size:0.9rem;">${escapeHtml(d.tagline)}</p>` : ''}
        ${meets ? `<div class="dept-meta">Meets ${escapeHtml(meets)}${d.meetingLocation ? ' &middot; ' + escapeHtml(d.meetingLocation) : ''}</div>` : ''}
        ${d.headName ? `<div class="dept-meta">Led by ${escapeHtml(d.headName)}</div>` : ''}
        <div style="margin-top:auto; display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding-top:6px;">${action}</div>
      </div>
    </div>
  `;
}

// `firstRender` exists because the scroll-reveal animation puts every card at
// opacity 0 until it scrolls into view. That is right when the page loads and
// wrong after a button press: re-running it would fade the whole list out and
// back in every time someone asked to join something.
async function renderMyDepartments(firstRender) {
  const wrap = document.getElementById('deptGrid');
  const data = await fetchJSON('/api/member/departments');
  MY_DEPARTMENTS = data.departments || [];
  if (!MY_DEPARTMENTS.length) {
    wrap.innerHTML = '<p class="empty-state">Your chapter has not set up its departments yet. Your Chapter Coordinator adds them.</p>';
    return;
  }
  wrap.innerHTML = MY_DEPARTMENTS.map(departmentCard).join('');
  // Signed-in members land on departments now, but "View All Chapters" on the
  // home page still points here, so the chapter list stays one tap away rather
  // than becoming unreachable.
  const more = document.getElementById('deptFooterLink');
  if (more) more.innerHTML = '<a href="/department.html?chapterId=' + encodeURIComponent(data.chapterId) +
    '">See your chapter\'s leadership</a> &middot; <a href="/index.html#chapters">Other ACONSU chapters</a>';
  if (firstRender) initScrollReveal('#deptGrid .card');
}

async function actOnDepartment(btn, run, working) {
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = working;
  try {
    await run();
    await renderMyDepartments();
  } catch (err) {
    showToast(err.message || 'That did not go through.', 'error');
    btn.disabled = false;
    btn.textContent = original;
  }
}

document.addEventListener('click', (e) => {
  const join = e.target.closest('.dept-join');
  if (join) {
    return actOnDepartment(join, async () => {
      await fetchJSON(`/api/member/departments/${encodeURIComponent(join.dataset.id)}/request`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({})
      });
      showToast(`Your request to join ${join.dataset.name} has been sent to its head.`, 'success');
    }, 'Sending…');
  }
  const withdraw = e.target.closest('.dept-withdraw');
  if (withdraw) {
    return actOnDepartment(withdraw, async () => {
      await fetchJSON(`/api/member/departments/${encodeURIComponent(withdraw.dataset.id)}/request`, { method: 'DELETE' });
      showToast('Request withdrawn.', 'success');
    }, 'Withdrawing…');
  }
  const leave = e.target.closest('.dept-leave');
  if (leave) {
    if (!confirm(`Step back from ${leave.dataset.name}? You can ask to join again later.`)) return;
    return actOnDepartment(leave, async () => {
      await fetchJSON(`/api/member/departments/${encodeURIComponent(leave.dataset.id)}`, { method: 'DELETE' });
      showToast(`You have left ${leave.dataset.name}.`, 'success');
    }, 'Leaving…');
  }
});

async function renderChapterPicker() {
  // Nobody signed in: choosing a chapter is a real question here, so this is
  // the one case where the chapter list belongs.
  (document.getElementById('deptsEyebrow') || {}).textContent = 'Find Your Chapter';
  document.getElementById('deptsTitle').textContent = 'Chapters';
  document.getElementById('deptsLede').textContent =
    'Each chapter has its own departments and leadership. Sign in to see your own chapter\'s departments and ask to serve.';
  const chapters = await fetchJSON('/api/chapters');
  document.getElementById('deptGrid').innerHTML = chapters.map(chapter => `
    <a href="/department.html?chapterId=${encodeURIComponent(chapter.id)}" class="card dept-card">
      <div class="dept-thumb">
        <span class="dept-thumb-fallback" style="display:flex; align-items:center; justify-content:center; background:var(--surface-3); color:var(--brand); font-weight:800; font-size:1.75rem;">${escapeHtml((chapter.name || 'A').charAt(0))}</span>
      </div>
      <h2 style="font-size:1.17rem;">${escapeHtml(chapter.name)}</h2>
      <p style="color:var(--ink-soft); font-size:0.92rem;">${escapeHtml(chapter.fullName || chapter.institution || 'Chapter community')}</p>
      <div class="dept-meta">${escapeHtml(chapter.location || chapter.institution || 'ACONSU Chapter')}</div>
    </a>
  `).join('') || '<p class="empty-state">Chapters coming soon.</p>';
  initScrollReveal('#deptGrid .card');
}

(async function () {
  await initLayout('/departments.html');
  const auth = await fetchJSON('/api/auth/me').catch(() => ({ member: null }));
  try {
    if (auth && auth.member) await renderMyDepartments(true);
    else await renderChapterPicker();
  } catch (e) {
    document.getElementById('deptGrid').innerHTML =
      '<p class="empty-state">Could not load departments right now.</p>';
  }
  try {
    const photos = await fetchJSON('/api/files?category=photo');
    const general = photos.filter(p => !p.pageSlug).slice(0, 4);
    if (general.length) {
      document.getElementById('deptsHero').style.overflow = 'visible';
      renderFloatingImages('deptsHero', general.map(p => p.id));
    }
  } catch (e) { /* decorative only */ }
})();
