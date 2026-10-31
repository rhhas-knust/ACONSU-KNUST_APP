// The script of chat.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
let currentMember = null;
let currentTopicId = null;

function fmtWhen(v) { try { return new Date(v).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }

async function loadTopics() {
  const list = document.getElementById('topicList');
  try {
    const topics = await fetchJSON('/api/chat/topics');
    list.innerHTML = topics.map(t => `
      <div class="topic-card" data-open="${t.id}">
        <div>
          <strong>${escapeHtml(t.title)}${t.locked ? ' (locked)' : ''}</strong>
          <div class="tiny muted">Started by ${escapeHtml(t.createdByName || 'Someone')} · ${fmtWhen(t.lastActivity)}</div>
        </div>
        <span class="badge">${t.messageCount} repl${t.messageCount === 1 ? 'y' : 'ies'}</span>
      </div>
    `).join('') || '<p class="empty-state">No discussions yet. Start the first one!</p>';
    list.querySelectorAll('[data-open]').forEach(card => card.addEventListener('click', () => openTopic(card.dataset.open, topics.find(t => t.id === card.dataset.open).title)));
  } catch (e) {
    list.innerHTML = '<p class="empty-state">Log in to see community discussions.</p>';
  }
}

async function openTopic(id, title) {
  currentTopicId = id;
  document.getElementById('topicListView').style.display = 'none';
  document.getElementById('topicDetailView').style.display = 'block';
  document.getElementById('topicTitle').textContent = title;
  await loadMessages();
}

async function loadMessages() {
  const list = document.getElementById('messagesList');
  list.innerHTML = '<div class="skeleton-stack" role="status" aria-label="Loading"><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div></div>';
  try {
    const messages = await fetchJSON(`/api/chat/topics/${currentTopicId}/messages`);
    list.innerHTML = messages.map(m => `
      <div class="chat-message" data-id="${m.id}">
        <div class="who">${escapeHtml(m.authorName || 'Someone')}</div>
        <p style="margin:4px 0;">${escapeHtml(m.body)}</p>
        <div class="when">${fmtWhen(m.createdAt)}</div>
        <div class="actions"><button data-report="${m.id}">Report</button></div>
      </div>
    `).join('') || '<p class="empty-state">No replies yet. Be the first.</p>';
    list.querySelectorAll('[data-report]').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Report this message to the moderators?')) return;
      await fetchJSON(`/api/chat/messages/${btn.dataset.report}/report`, { method: 'POST' });
      showToast('Reported, thank you for flagging this.', 'success');
    }));
  } catch (e) {
    list.innerHTML = '<p class="empty-state">Could not load messages.</p>';
  }
}

document.getElementById('backToTopicsBtn').addEventListener('click', () => {
  document.getElementById('topicDetailView').style.display = 'none';
  document.getElementById('topicListView').style.display = 'block';
  loadTopics();
});

document.getElementById('messageForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = document.getElementById('messageBody').value.trim();
  if (!text) return;
  try {
    await fetchJSON(`/api/chat/topics/${currentTopicId}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: text })
    });
    document.getElementById('messageBody').value = '';
    loadMessages();
  } catch (err) {
    showToast(err.message || 'Could not send this message.', 'error');
  }
});

document.getElementById('newTopicBtn').addEventListener('click', async () => {
  if (!currentMember) { window.location.href = '/login.html'; return; }
  const title = prompt('What do you want to discuss?');
  if (!title || !title.trim()) return;
  try {
    const { item } = await fetchJSON('/api/chat/topics', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim() })
    });
    openTopic(item.id, item.title);
  } catch (err) {
    showToast(err.message || 'Could not start this discussion.', 'error');
  }
});

(async function () {
  await initLayout('/chat.html');
  const authRes = await fetchJSON('/api/auth/me').catch(() => ({ member: null }));
  currentMember = authRes.member;
  if (!currentMember) {
    document.getElementById('topicList').innerHTML = '<p class="empty-state">Log in to join the community discussion.</p>';
    document.getElementById('newTopicBtn').textContent = 'Log In to Post';
  }
  loadTopics();
})();
