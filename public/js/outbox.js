/* ============================================================
   The offline outbox, on the page (Phase 7). For the forms that
   matter most when the signal is weak: Sunday check-in at the
   door, prayer requests and the contact form.

     AconsuOutbox.send({ url, body, label })
       sends it now if it can; if there is no signal, keeps it on
       the phone and says so: { queued: true }. An answer from the
       server is returned as it is: { data }, or an Error.

   What is kept is sent by itself, in order, the moment the phone
   is back online (here, or by the service worker even after the
   page is closed), and a line on the page says how many are
   waiting to send. Requires outbox-core.js before it.
   ============================================================ */
window.AconsuOutbox = (function () {
  'use strict';
  const core = window.AconsuOutboxCore;
  const listeners = [];
  let timer = null;

  function chapterHeader() {
    try {
      const id = typeof getSelectedChapterId === 'function' ? getSelectedChapterId() : '';
      return id ? { 'X-Chapter-Id': id } : {};
    } catch (e) { return {}; }
  }

  // The line that says how many are waiting. Made once, on the page's own
  // colours, and only shown while something is.
  function line() {
    let el = document.getElementById('outboxLine');
    if (!el) {
      el = document.createElement('div');
      el.id = 'outboxLine';
      el.className = 'outbox-line';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.hidden = true;
      document.body.appendChild(el);
    }
    return el;
  }

  async function changed(result) {
    const waiting = (await core.all().catch(() => [])).length;
    const el = line();
    el.hidden = !waiting;
    el.textContent = waiting ? `${waiting} waiting to send. It will go when the phone is back online.` : '';
    listeners.forEach((fn) => { try { fn({ waiting, ...(result || {}) }); } catch (e) { /* one listener's trouble is its own */ } });
    if (waiting && !timer) timer = setInterval(() => { if (navigator.onLine) flush(); }, 20000);
    if (!waiting && timer) { clearInterval(timer); timer = null; }
  }

  async function flush() {
    const result = await core.flush().catch(() => null);
    await changed(result);
    return result;
  }

  // Ask the service worker to send it when the phone is back online, even if
  // this page has been closed by then (where the phone supports it).
  function askWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then((reg) => (reg.sync ? reg.sync.register(core.TAG) : null)).catch(() => {});
  }

  async function keep(item) {
    await core.add(item);
    askWorker();
    await changed();
    // Online but behind something still waiting: try them all now, in order.
    if (navigator.onLine) flush();
    return { queued: true };
  }

  async function send({ url, body, label, method }) {
    const item = {
      url, method: method || 'POST', label: label || '',
      body: typeof body === 'string' ? body : JSON.stringify(body || {}),
      headers: chapterHeader(),
      key: core.newKey()
    };
    // Something already waiting goes first: sending this ahead of it would
    // change the order things happened in.
    const waiting = (await core.all().catch(() => [])).length;
    if (!navigator.onLine || waiting) return keep(item);
    const r = await core.attempt(item);
    if (r.offline) return keep(item);
    if (!r.ok) {
      const err = new Error((r.data && r.data.error) || 'Request failed');
      err.status = r.status;
      throw err;
    }
    return { queued: false, data: r.data };
  }

  window.addEventListener('online', () => flush());
  // The service worker sent them: say so here too.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'OUTBOX_SENT') changed(e.data.result); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => flush());
  else flush();

  return {
    send, flush,
    waiting: () => core.all().then((items) => items.length).catch(() => 0),
    onChange: (fn) => { listeners.push(fn); }
  };
})();
