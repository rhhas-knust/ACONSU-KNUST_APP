// A department's own chat, on its page (department.html#chat). Only its
// members and its head get in; the server decides that on every request
// (routes/department-chat.js), so this only draws what it is given.
window.AconsuDeptChat = (function () {
  const when = (iso) => {
    try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  };

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
        <p class="dchat-body">${escapeHtml(p.body)}</p>
        ${actions ? `<div class="dchat-actions">${actions}</div>` : ''}
        ${isReply ? '' : `
          ${p.replies && p.replies.length ? `<ul class="dchat-replies">${p.replies.map(r => postHtml(r, isHead, true)).join('')}</ul>` : ''}
          <form class="dchat-compose dchat-reply" data-parent="${escapeHtml(p.id)}" hidden>
            <label class="sr-only" for="reply-${escapeHtml(p.id)}">Your reply</label>
            <textarea id="reply-${escapeHtml(p.id)}" rows="2" maxlength="2000" placeholder="Write a reply"></textarea>
            <button type="submit" class="btn btn-primary">Reply</button>
          </form>`}
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
      ${data.canPost ? `
      <form class="dchat-compose" id="dchatNew">
        <label class="sr-only" for="dchatBody">Message to the department</label>
        <textarea id="dchatBody" rows="2" maxlength="2000" placeholder="Write to the department"></textarea>
        <button type="submit" class="btn btn-primary">Send</button>
      </form>` : '<p class="muted">Your posting has been restricted, so you can read but not post.</p>'}
      <div class="form-msg" id="dchatMsg" role="status"></div>
      ${threads.length ? `<ul class="dchat-list">${threads.map(t => postHtml(t, isHead, false)).join('')}</ul>` : '<p class="empty-state">No messages yet. Start the conversation.</p>'}
    `;
    const msg = el.querySelector('#dchatMsg');
    const say = (text) => { msg.textContent = text; msg.className = 'form-msg error'; };
    const send = async (form, parentId) => {
      const box = form.querySelector('textarea');
      const text = box.value.trim();
      if (!text) { box.focus(); return; }
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        await fetchJSON(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: text, parentId }) });
        await mount(el, deptId);
      } catch (err) {
        btn.disabled = false;
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
      if (!window.confirm(isReply ? 'Remove this reply?' : 'Remove this message? Its replies go too.')) return;
      try {
        await fetchJSON(`${api}/${encodeURIComponent(b.dataset.remove)}`, { method: 'DELETE' });
        await mount(el, deptId);
      } catch (err) { say(err.message || 'Could not remove that.'); }
    }));
  }

  return { mount };
})();
