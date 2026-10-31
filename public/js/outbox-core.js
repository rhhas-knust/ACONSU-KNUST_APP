/* ============================================================
   The offline outbox's store and sender, shared by the pages
   (outbox.js) and the service worker (sw.js), which sends it
   when the phone is back online even if the page was closed.

   What could not be sent is kept on the phone, in IndexedDB, in
   the order it was made, each with a key of its own
   (Idempotency-Key). It is sent again in that order; the server
   keeps the first answer to each key, so something that did get
   through the first time is never done twice (lib/idempotency.js).
   ============================================================ */
(function (scope) {
  'use strict';
  const DB = 'aconsu-outbox';
  const STORE = 'items';

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function run(mode, work) {
    return open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const out = work(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(out && 'result' in out ? out.result : out); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    }));
  }

  const add = (item) => run('readwrite', (s) => s.add({ ...item, createdAt: Date.now(), tries: 0 }));
  const all = () => run('readonly', (s) => s.getAll()).then((items) => (items || []).sort((a, b) => a.id - b.id));
  const remove = (id) => run('readwrite', (s) => s.delete(id));
  const put = (item) => run('readwrite', (s) => s.put(item));

  // A fresh key for one request.
  function newKey() {
    if (scope.crypto && scope.crypto.randomUUID) return scope.crypto.randomUUID().replace(/-/g, '');
    const b = new Uint8Array(16);
    scope.crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  // One try at one request: { ok, status, data } or { offline: true }.
  async function attempt(item) {
    let res;
    try {
      res = await fetch(item.url, {
        method: item.method || 'POST',
        headers: { 'Content-Type': 'application/json', ...(item.headers || {}), 'Idempotency-Key': item.key },
        body: item.body,
        credentials: 'same-origin'
      });
    } catch (e) {
      return { offline: true };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  // Sends what is waiting, oldest first, and stops at the first that cannot
  // go yet (no signal, the server busy or asleep), so the order is kept.
  // Something the server turns down (a 4xx it will always give) is taken out
  // and reported, rather than tried for ever.
  let flushing = null;
  function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      const sent = [];
      const refused = [];
      const items = await all();
      for (const item of items) {
        const r = await attempt(item);
        const later = r.offline || r.status === 409 || r.status === 429 || r.status === 408 || r.status >= 500;
        if (later) {
          item.tries = (item.tries || 0) + 1;
          await put(item);
          break;
        }
        await remove(item.id);
        (r.ok ? sent : refused).push({ ...item, status: r.status, data: r.data });
      }
      const left = (await all()).length;
      return { sent, refused, left };
    })().finally(() => { flushing = null; });
    return flushing;
  }

  scope.AconsuOutboxCore = { add, all, remove, flush, attempt, newKey, TAG: 'aconsu-outbox' };
})(typeof self !== 'undefined' ? self : window);
