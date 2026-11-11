// A department's own chat, on its page (department.html#chat). Only its
// members and its head get in; the server decides that on every request
// (routes/department-chat.js), so this only draws what it is given.
window.AconsuDeptChat = (function () {
  const when = (iso) => {
    try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  };

  const MAX_FILES = 4;
  const MAX_BYTES = 10 * 1024 * 1024;
  const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,application/pdf';
  const sizeLabel = (n) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  function attachmentsHtml(list) {
    if (!list || !list.length) return '';
    const photos = list.filter(a => a.contentType !== 'application/pdf');
    const pdfs = list.filter(a => a.contentType === 'application/pdf');
    return `
      ${photos.length ? `<div class="dchat-photos">${photos.map(a => `
        <a href="/api/files/${encodeURIComponent(a.fileId)}" target="_blank" rel="noopener"><img src="/api/files/${encodeURIComponent(a.fileId)}" alt="${escapeHtml(a.name || 'Photo')}" loading="lazy"></a>`).join('')}</div>` : ''}
      ${pdfs.map(a => `
        <a class="dchat-file" href="/api/files/${encodeURIComponent(a.fileId)}" target="_blank" rel="noopener">
          <span class="dchat-file-kind" aria-hidden="true">PDF</span>
          <span class="dchat-file-name">${escapeHtml(a.name || 'Document')}</span>
          <small>${escapeHtml(sizeLabel(a.size || 0))}</small>
        </a>`).join('')}`;
  }

  // The writing box, the "Photo or PDF" button and Send, for a new message and
  // for a reply alike.
  function composeHtml(id, label, placeholder, sendLabel, extra) {
    return `
      <form class="dchat-compose" ${extra}>
        <label class="sr-only" for="${id}">${label}</label>
        <textarea id="${id}" rows="2" maxlength="2000" placeholder="${placeholder}"></textarea>
        <ul class="dchat-picked" aria-live="polite"></ul>
        <div class="dchat-tools">
          <label class="btn btn-outline dchat-attach">
            <input type="file" class="sr-only" accept="${ACCEPT}" multiple>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.4 11.1l-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8"/></svg>
            Photo or PDF
          </label>
          <button type="submit" class="btn btn-primary">${sendLabel}</button>
        </div>
      </form>`;
  }

  function postHtml(p, isHead, isReply) {
    const actions = [
      isReply ? '' : `<button type="button" class="dchat-act" data-reply="${escapeHtml(p.id)}">Reply${p.replies && p.replies.length ? ` (${p.replies.length})` : ''}</button>`,
      isHead && !isReply ? `<button type="button" class="dchat-act" data-pin="${escapeHtml(p.id)}" data-pinned="${p.pinned ? '1' : ''}">${p.pinned ? 'Unpin' : 'Pin'}</button>` : '',
      p.canRemove ? `<button type="button" class="dchat-act is-bad" data-remove="${escapeHtml(p.id)}">Remove</button>` : ''
    ].join('');
    return `
      <li class="dchat-post${p.pinned ? ' is-pinned' : ''}" data-id="${escapeHtml(p.id)}">
        <div class="dchat-meta">
          <strong>${escapeHtml(p.authorName)}</strong>
          ${p.authorRole ? `<span class="badge">${escapeHtml(p.authorRole)}</span>` : ''}
          ${p.pinned ? '<span class="badge">Pinned</span>' : ''}
          <span class="dchat-when">${escapeHtml(when(p.createdAt))}</span>
        </div>
        ${p.body ? `<p class="dchat-body">${escapeHtml(p.body)}</p>` : ''}
        ${attachmentsHtml(p.attachments)}
        ${actions ? `<div class="dchat-actions">${actions}</div>` : ''}
        ${isReply ? '' : `
          ${p.replies && p.replies.length ? `<ul class="dchat-replies">${p.replies.map(r => postHtml(r, isHead, true)).join('')}</ul>` : ''}
          ${composeHtml(`reply-${escapeHtml(p.id)}`, 'Your reply', 'Write a reply', 'Reply', `data-parent="${escapeHtml(p.id)}" hidden`).replace('class="dchat-compose"', 'class="dchat-compose dchat-reply"')}`}
      </li>`;
  }

  async function mount(el, deptId) {
    const api = `/api/departments/${encodeURIComponent(deptId)}/chat`;
    let data;
    try {
      data = await fetchJSON(api);
    } catch (e) {
      if (e.status === 401) {
        el.innerHTML = '<h2>Department chat</h2><p class="muted">Members of this department talk here. <a href="/login.html">Sign in</a> to join in.</p>';
      } else if (e.status === 403) {
        el.innerHTML = `<h2>Department chat</h2><p class="muted">${escapeHtml(e.message)}</p>`;
      } else {
        el.innerHTML = '<h2>Department chat</h2><p class="muted">Could not load the chat right now.</p>';
      }
      return;
    }
    const { isHead, threads } = data;
    el.innerHTML = `
      <h2>Department chat</h2>
      <p class="muted dchat-who">Only ${escapeHtml(data.department.name)}'s members and its head see this.</p>
      ${data.canPost
        ? composeHtml('dchatBody', 'Message to the department', 'Write to the department', 'Send', 'id="dchatNew"')
        : '<p class="muted">Your posting has been restricted, so you can read but not post.</p>'}
      <div class="form-msg" id="dchatMsg" role="status"></div>
      ${threads.length ? `<ul class="dchat-list">${threads.map(t => postHtml(t, isHead, false)).join('')}</ul>` : '<p class="empty-state">No messages yet. Start the conversation.</p>'}
    `;
    const msg = el.querySelector('#dchatMsg');
    const say = (text) => { msg.textContent = text; msg.className = 'form-msg error'; };
    // What each form has picked to send with its message.
    const picked = new Map();
    const drawPicked = (form) => {
      const list = picked.get(form) || [];
      form.querySelector('.dchat-picked').innerHTML = list.map((f, i) => `
        <li><span>${escapeHtml(f.name)} <small class="muted">${escapeHtml(sizeLabel(f.size))}</small></span>
          <button type="button" class="dchat-act is-bad" data-unpick="${i}" aria-label="Take off ${escapeHtml(f.name)}">Take off</button></li>`).join('');
      form.querySelectorAll('[data-unpick]').forEach((b) => b.addEventListener('click', () => {
        list.splice(Number(b.dataset.unpick), 1);
        drawPicked(form);
      }));
    };
    el.querySelectorAll('.dchat-compose').forEach((form) => {
      picked.set(form, []);
      const input = form.querySelector('input[type="file"]');
      input.addEventListener('change', () => {
        const list = picked.get(form);
        for (const f of Array.from(input.files || [])) {
          if (!ACCEPT.split(',').includes(f.type)) { say(`"${f.name}" is not a photo or a PDF.`); continue; }
          if (f.size > MAX_BYTES) { say(`"${f.name}" is over 10 MB. Send a smaller one.`); continue; }
          if (list.length >= MAX_FILES) { say(`Up to ${MAX_FILES} at a time.`); break; }
          list.push(f);
        }
        input.value = '';
        drawPicked(form);
      });
    });
    const send = async (form, parentId) => {
      const box = form.querySelector('textarea');
      const text = box.value.trim();
      const files = picked.get(form) || [];
      if (!text && !files.length) { box.focus(); return; }
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = files.length ? 'Sending...' : btn.textContent;
      try {
        const body = new FormData();
        body.append('body', text);
        body.append('parentId', parentId || '');
        files.forEach(f => body.append('files', f, f.name));
        await fetchJSON(api, { method: 'POST', body });
        await mount(el, deptId);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = parentId ? 'Reply' : 'Send';
        say(err.message || 'Could not send that.');
      }
    };
    const fresh = el.querySelector('#dchatNew');
    if (fresh) fresh.addEventListener('submit', (e) => { e.preventDefault(); send(fresh, ''); });
    el.querySelectorAll('.dchat-reply').forEach((form) => {
      form.addEventListener('submit', (e) => { e.preventDefault(); send(form, form.dataset.parent); });
    });
    el.querySelectorAll('[data-reply]').forEach((b) => b.addEventListener('click', () => {
      const form = el.querySelector(`.dchat-reply[data-parent="${CSS.escape(b.dataset.reply)}"]`);
      if (!form) return;
      if (!data.canPost) { say('Your posting has been restricted.'); return; }
      form.hidden = !form.hidden;
      if (!form.hidden) form.querySelector('textarea').focus();
    }));
    el.querySelectorAll('[data-pin]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await fetchJSON(`${api}/${encodeURIComponent(b.dataset.pin)}/pin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pinned: !b.dataset.pinned }) });
        await mount(el, deptId);
      } catch (err) { say(err.message || 'Could not pin that.'); }
    }));
    el.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
      const isReply = !!b.closest('.dchat-replies');
      if (!window.confirm(isReply ? 'Remove this reply, and anything sent with it?' : 'Remove this message, and anything sent with it? Its replies go too.')) return;
      try {
        await fetchJSON(`${api}/${encodeURIComponent(b.dataset.remove)}`, { method: 'DELETE' });
        await mount(el, deptId);
      } catch (err) { say(err.message || 'Could not remove that.'); }
    }));
  }

  return { mount };
})();
