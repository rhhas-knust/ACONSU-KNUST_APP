/* ============================================================
   Sharing to WhatsApp, the front door for most people who will
   ever open ACONSU. One button, used on events, sermons, public
   prayer requests, the verse of the day and "Invite a friend".

   The phone's own share sheet when it has one (which includes
   WhatsApp), otherwise straight to WhatsApp. The link is the
   app's chosen address, or this page's own when it has none yet.
   No tracking parameter is ever added; the server counts that a
   share happened and nothing else (routes/share.js).
   Requires main.js.
   ============================================================ */
window.AconsuShare = (function () {
  const KINDS = ['event', 'sermon', 'prayer', 'verse', 'invite'];
  let base = null;

  async function siteBase() {
    if (base !== null) return base;
    try {
      const r = await fetch('/api/public/address').then((x) => x.json());
      base = (r && r.base) || location.origin;
    } catch (e) {
      base = location.origin;
    }
    return base;
  }

  function counted(kind) {
    try {
      const body = new Blob([JSON.stringify({ kind })], { type: 'application/json' });
      if (!(navigator.sendBeacon && navigator.sendBeacon('/api/share', body))) {
        fetch('/api/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind }), keepalive: true }).catch(() => {});
      }
    } catch (e) { /* a lost count is fine */ }
  }

  // The link the button shares, and the WhatsApp fallback that carries it.
  async function linkFor(path) {
    return (await siteBase()) + (path || '/');
  }
  function whatsappUrl(text, url) {
    return `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`;
  }

  async function share({ kind, title, text, path }) {
    if (!KINDS.includes(kind)) return;
    const url = await linkFor(path);
    counted(kind);
    if (navigator.share) {
      try { await navigator.share({ title: title || document.title, text, url }); return; } catch (e) {
        if (e && e.name === 'AbortError') return; // they closed the sheet
      }
    }
    window.open(whatsappUrl(text, url), '_blank', 'noopener');
  }

  // The button, as markup to drop into a card. Everything it needs rides on
  // data- attributes, so any list can render it and one listener serves all.
  function button({ kind, title, text, path, label }) {
    const esc = (v) => escapeHtml(String(v == null ? '' : v));
    return `<button type="button" class="btn btn-outline btn-sm share-btn" data-share="${esc(kind)}" data-share-title="${esc(title)}"
      data-share-text="${esc(text)}" data-share-path="${esc(path)}"><svg class="share-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>${esc(label || 'Share')}</button>`;
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-share]');
    if (!b) return;
    e.preventDefault();
    share({ kind: b.dataset.share, title: b.dataset.shareTitle, text: b.dataset.shareText, path: b.dataset.sharePath });
  });

  return { share, button, linkFor, whatsappUrl };
})();
