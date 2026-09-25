// ---------- shared helpers ----------
// Every request automatically carries whichever chapter is selected (see
// "chapter selection" below) via a header, so chapter-scoped API routes know
// which chapter's content to return without every single call site having
// to remember to pass it.
async function fetchJSON(url, options) {
  const opts = { ...(options || {}) };
  if (typeof url === 'string' && url.startsWith('/api/')) {
    const chapterId = getSelectedChapterId();
    if (chapterId) opts.headers = { ...(opts.headers || {}), 'X-Chapter-Id': chapterId };
  }
  // An upload that is slow is not a sleeping server — it is a big photo on a
  // mobile connection, which is the normal case at registration. Telling those
  // two apart decides which message is honest.
  const done = beginRequest(opts.body instanceof FormData);
  try {
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  } finally {
    done();
  }
}

// ---------- slow first request (free-tier cold start) ----------
// The server sleeps when nobody has used it for a while, and the request that
// wakes it can take the better part of a minute. To a member that is a dead
// screen, and a dead screen reads as a broken app — so say what is happening
// rather than leaving them to guess. Only shown when a request is genuinely
// slow, so a warm server never shows it at all.
const SLOW_REQUEST_MS = 4000;
let inFlight = 0;
let slowTimer = null;

function beginRequest(isUpload) {
  inFlight++;
  if (inFlight === 1) {
    slowTimer = setTimeout(() => showSlowBanner(isUpload), SLOW_REQUEST_MS);
  }
  let settled = false;
  return function finish() {
    if (settled) return; // a caller finishing twice must not unbalance the count
    settled = true;
    inFlight = Math.max(0, inFlight - 1);
    if (inFlight === 0) {
      clearTimeout(slowTimer);
      slowTimer = null;
      hideSlowBanner();
    }
  };
}

function showSlowBanner(isUpload) {
  if (document.getElementById('wakingBanner')) return;
  const message = isUpload
    ? 'Still uploading — a photo can take a while on mobile data.'
    : 'Waking the server up — this can take a moment the first time today.';
  const el = document.createElement('div');
  el.id = 'wakingBanner';
  el.setAttribute('role', 'status');
  el.innerHTML = `
    <span style="width:14px; height:14px; border:2px solid rgba(255,255,255,0.32); border-top-color:#E8971E; border-radius:50%; display:inline-block; animation:aconsuSpin 0.8s linear infinite; flex-shrink:0;"></span>
    <span></span>
  `;
  el.lastElementChild.textContent = message;
  el.style.cssText = 'position:fixed; left:16px; right:16px; top:16px; z-index:395; background:#3A1B54; color:#fff; border-radius:12px; padding:12px 16px; display:flex; align-items:center; gap:11px; box-shadow:0 12px 30px rgba(0,0,0,0.26); max-width:440px; margin:0 auto; font-family:Manrope,sans-serif; font-size:0.84rem; font-weight:600;';
  if (!document.getElementById('aconsuSpinKeyframes')) {
    const style = document.createElement('style');
    style.id = 'aconsuSpinKeyframes';
    style.textContent = '@keyframes aconsuSpin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }
  document.body.appendChild(el);
}

function hideSlowBanner() {
  const el = document.getElementById('wakingBanner');
  if (el) el.remove();
}

// ---------- signing out ----------
// Clearing the session cookie is not enough on a shared phone. The service
// worker has been keeping /api/ responses so the app works offline, and those
// responses are the departing member's records. Drop them before the next
// person opens the app.
async function clearCachedAccountData() {
  try {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.ready;
    if (reg && reg.active) reg.active.postMessage({ type: 'CLEAR_API_CACHE' });
  } catch (e) { /* signing out must never be blocked by cache cleanup */ }
}

// ---------- chapter selection ----------
// ACONSU is a multi-chapter platform: every chapter-scoped page needs to know
// which chapter it's showing. With a single active chapter (true for most
// deployments most of the time) this resolves itself silently on first
// visit. The moment a second chapter exists, a visitor is asked once and
// it's remembered on that device from then on — a signed-in member's own
// account overrides it automatically once they log in (see initLayout).
const CHAPTER_STORAGE_KEY = 'aconsu_chapter_id';

function getSelectedChapterId() {
  try { return localStorage.getItem(CHAPTER_STORAGE_KEY) || ''; } catch (e) { return ''; }
}
function setSelectedChapterId(id) {
  try {
    if (id) localStorage.setItem(CHAPTER_STORAGE_KEY, id);
    else localStorage.removeItem(CHAPTER_STORAGE_KEY);
  } catch (e) { /* private-browsing storage errors are non-fatal here */ }
}

function showChapterPicker(chapters) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:fixed; inset:0; background:rgba(36,21,48,0.55); z-index:500; display:flex; align-items:center; justify-content:center; padding:20px;';
    backdrop.innerHTML = `
      <div style="background:#fff; border-radius:16px; padding:28px; max-width:420px; width:100%; max-height:85vh; overflow-y:auto; font-family:'Manrope',sans-serif;">
        <h3 style="margin:0 0 6px; font-family:'Fraunces',serif; color:var(--purple-deep,#3A1B54);">Choose your ACONSU chapter</h3>
        <p style="color:#5a4468; font-size:0.9rem; margin:0 0 18px;">This app now serves several ACONSU chapters — pick yours to continue. You can change this later from your profile.</p>
        <div id="chapterPickList" style="display:flex; flex-direction:column; gap:10px;"></div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const list = backdrop.querySelector('#chapterPickList');
    chapters.forEach((c) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-outline';
      btn.style.cssText = 'text-align:left; padding:12px 16px;';
      btn.innerHTML = `<strong>${escapeHtml(c.name)}</strong>${c.institution ? `<br><small style="opacity:0.7;">${escapeHtml(c.institution)}</small>` : ''}`;
      btn.addEventListener('click', () => {
        setSelectedChapterId(c.id);
        backdrop.remove();
        resolve(c.id);
      });
      list.appendChild(btn);
    });
  });
}

// Resolves (and, if needed, asks) which chapter this browser is looking at.
// Safe to call on every page load — instant once a chapter is already
// chosen. Called from initLayout, so ordinary pages never need this directly.
async function ensureChapterSelected() {
  if (getSelectedChapterId()) return getSelectedChapterId();
  try {
    const chapters = await fetch('/api/chapters').then(r => r.json());
    if (Array.isArray(chapters) && chapters.length === 1) {
      setSelectedChapterId(chapters[0].id);
      return chapters[0].id;
    }
    if (Array.isArray(chapters) && chapters.length > 1) {
      return await showChapterPicker(chapters);
    }
  } catch (e) { /* chapters not reachable yet — pages fall back to unscoped content */ }
  return '';
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

// ---------- bottom tab bar (mobile app navigation) ----------
const ICON_HOME = '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>';
const ICON_EVENTS = '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>';
const ICON_BIBLE = '<path d="M12 6.2c-2-1.5-5-2-8-1v13c3-1 6-.5 8 1 2-1.5 5-2 8-1V5.2c-3-1-6-.5-8 1Z"/><path d="M12 6.2v13"/>';
const ICON_PRAYER = '<path d="M12 21s-7-4.5-9.5-9C1 8 2.5 4.5 6 4c2-.3 4 .8 6 3 2-2.2 4-3.3 6-3 3.5.5 5 4 3.5 8-2.5 4.5-9.5 9-9.5 9Z"/>';
const ICON_MORE = '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>';
const ICON_BELL = '<path d="M6 8a6 6 0 0 1 12 0c0 4.5 1.5 6 2 7H4c.5-1 2-2.5 2-7Z"/><path d="M10 19a2 2 0 0 0 4 0"/>';
const ICON_USERS = '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 14.2c2.6.4 4.5 2.6 4.5 5.3"/>';
const ICON_HEADPHONES = '<path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="2.5" y="13" width="4" height="6" rx="1.5"/><rect x="17.5" y="13" width="4" height="6" rx="1.5"/>';
const ICON_VIDEO = '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>';
const ICON_BOOK = '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>';
const ICON_GIVE = '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>';
const ICON_CHAT = '<path d="M21 11.5a8.5 8.5 0 0 1-9.5 8.4L4 21l1.3-4.2A8.5 8.5 0 1 1 21 11.5z"/>';
const ICON_INFO = '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="7.8" r="0.9" fill="currentColor" stroke="none"/>';
const ICON_MAIL = '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="m3 6.5 9 6 9-6"/>';
const ICON_CARD = '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>';

// ---------- social platform icons (footer, chapter contact, connect) ----------
const ICON_FACEBOOK = '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>';
const ICON_INSTAGRAM = '<rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>';
const ICON_YOUTUBE = '<path d="M22.5 6.4a2.8 2.8 0 0 0-2-2C18.9 4 12 4 12 4s-6.9 0-8.6.4a2.8 2.8 0 0 0-2 2A29.4 29.4 0 0 0 1 11.8a29.4 29.4 0 0 0 .4 5.3 2.8 2.8 0 0 0 2 2c1.7.4 8.6.4 8.6.4s6.9 0 8.6-.4a2.8 2.8 0 0 0 2-2 29.4 29.4 0 0 0 .4-5.3 29.4 29.4 0 0 0-.4-5.4z"/><path d="M9.8 15V8.5l5.7 3.3z" fill="currentColor" stroke="none"/>';
const ICON_WHATSAPP = '<path d="M21 11.5a8.4 8.4 0 0 1-9.9 8.3 8.4 8.4 0 0 1-3.4-.9L3 21l1.9-4.7a8.4 8.4 0 0 1-.9-3.8 8.4 8.4 0 1 1 17 0z"/><path d="M8.5 9.3c.2-.5.5-.5.8-.5h.5c.2 0 .4 0 .6.4s.6 1.5.7 1.6c.1.1.1.3 0 .5s-.2.3-.4.5-.3.4-.1.7a5.6 5.6 0 0 0 2.4 2.1c.3.1.4.1.6-.1s.7-.8.9-1.1.4-.2.6-.1l1.5.7c.2.1.4.2.4.3.1.3.1.9-.2 1.4s-1.3 1-2.2 1c-1.6.1-4.3-.9-5.8-2.9a6.8 6.8 0 0 1-1.4-3.6c0-.9.3-1.5.4-1.9z"/>';
const ICON_TIKTOK = '<path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/>';
const ICON_TWITTER = '<path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"/>';
const ICON_TELEGRAM = '<path d="M21.5 2 2 9.5l7 3 2.5 7.5 3-4 6 4.5z"/>';
const ICON_SPOTIFY = '<circle cx="12" cy="12" r="10"/><path d="M7.5 9c2.5-1.5 6 0 7.5 2m0-5.5c3.5-2 8 0 11 3M9 13.5c1.5-.5 4 0 5 1.5" fill="none"/>';

// Renders the platform icons for whatever links a settings/contact object
// has set — used by the site footer, contact page, and social connect strips.
function socialLinksHtml(s) {
  const cfg = s || {};
  const links = [
    (cfg.whatsapp || cfg.phone) && {
      href: cfg.whatsapp ? (cfg.whatsapp.startsWith('http') ? cfg.whatsapp : `https://wa.me/${String(cfg.whatsapp).replace(/[^\d]/g, '')}`) : `https://wa.me/${String(cfg.phone || '').replace(/[^\d]/g, '')}`,
      icon: ICON_WHATSAPP,
      label: 'WhatsApp',
      cls: 'social-whatsapp'
    },
    cfg.youtube && { href: cfg.youtube, icon: ICON_YOUTUBE, label: 'YouTube', cls: 'social-youtube' },
    cfg.instagram && { href: cfg.instagram, icon: ICON_INSTAGRAM, label: 'Instagram', cls: 'social-instagram' },
    cfg.facebook && { href: cfg.facebook, icon: ICON_FACEBOOK, label: 'Facebook', cls: 'social-facebook' },
    cfg.tiktok && { href: cfg.tiktok, icon: ICON_TIKTOK, label: 'TikTok', cls: 'social-tiktok' },
    cfg.twitter && { href: cfg.twitter, icon: ICON_TWITTER, label: 'X / Twitter', cls: 'social-twitter' },
    cfg.telegram && { href: cfg.telegram, icon: ICON_TELEGRAM, label: 'Telegram', cls: 'social-telegram' },
    cfg.spotify && { href: cfg.spotify, icon: ICON_SPOTIFY, label: 'Spotify', cls: 'social-spotify' }
  ].filter(Boolean);

  // If no custom social links are on file yet, provide standard union handles
  const list = links.length ? links : [
    { href: 'https://wa.me/', icon: ICON_WHATSAPP, label: 'WhatsApp', cls: 'social-whatsapp' },
    { href: 'https://youtube.com', icon: ICON_YOUTUBE, label: 'YouTube', cls: 'social-youtube' },
    { href: 'https://instagram.com', icon: ICON_INSTAGRAM, label: 'Instagram', cls: 'social-instagram' },
    { href: 'https://facebook.com', icon: ICON_FACEBOOK, label: 'Facebook', cls: 'social-facebook' }
  ];

  return list.map(l => `
    <a href="${escapeHtml(l.href)}" target="_blank" rel="noopener" aria-label="${l.label}" title="${l.label}" class="social-icon-link ${l.cls}">
      ${svgIcon(l.icon)}
    </a>
  `).join('');
}

function svgIcon(pathData) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${pathData}</svg>`;
}

// ---------- push notification subscription ----------
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function isPushSubscribed() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Push notifications are not supported on this browser.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

  const { publicKey } = await fetchJSON('/api/push/vapid-public-key');
  if (!publicKey) throw new Error('Push notifications are not configured on the server yet.');

  const reg = await navigator.serviceWorker.ready;
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey)
  });
  await fetchJSON('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription })
  });
  return true;
}

// Quietly re-register a device that has already granted permission — no prompt,
// no button, nothing shown. This keeps the server's subscription list accurate
// (browsers rotate endpoints) without ever asking a member twice.
async function resubscribePushIfAlreadyAllowed() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { publicKey } = await fetchJSON('/api/push/vapid-public-key');
      if (!publicKey) return;
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
    }
    await fetchJSON('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub })
    });
  } catch (e) { /* alerts are optional — never let this surface to the member */ }
}

async function unsubscribeFromPush() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await fetchJSON('/api/push/unsubscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint })
    }).catch(() => {});
    await sub.unsubscribe();
  }
}

// ---------- unread notification badge ----------
async function getUnreadNotificationCount() {
  try {
    const items = await fetchJSON('/api/notifications');
    if (!items.length) return 0;
    const lastSeen = localStorage.getItem('aconsu_last_seen_notif') || '';
    return items.filter((n) => n.createdAt > lastSeen).length;
  } catch (e) {
    return 0;
  }
}

function markNotificationsSeen() {
  localStorage.setItem('aconsu_last_seen_notif', new Date().toISOString());
}

// ---------- shared pagination (admin & shepherding dashboards) ----------
function paginate(array, page, perPage) {
  const start = (page - 1) * perPage;
  return array.slice(start, start + perPage);
}

function renderPaginationControls(containerId, totalItems, perPage, currentPage, onPageChange) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
  if (totalPages <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:center; gap:14px; margin-top:16px;">
      <button type="button" id="${containerId}-prev" class="btn btn-outline btn-sm" ${currentPage <= 1 ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''}>&larr; Prev</button>
      <span style="font-size:0.85rem; color:#5a4468; font-weight:700;">Page ${currentPage} of ${totalPages}</span>
      <button type="button" id="${containerId}-next" class="btn btn-outline btn-sm" ${currentPage >= totalPages ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''}>Next &rarr;</button>
    </div>
  `;
  const prevBtn = document.getElementById(`${containerId}-prev`);
  const nextBtn = document.getElementById(`${containerId}-next`);
  if (prevBtn) prevBtn.addEventListener('click', () => currentPage > 1 && onPageChange(currentPage - 1));
  if (nextBtn) nextBtn.addEventListener('click', () => currentPage < totalPages && onPageChange(currentPage + 1));
}

// ---------- daily streak check-in ----------
function dailyCheckin() {
  const todayKey = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem('aconsu_last_checkin') === todayKey) return; // already pinged today
  fetchJSON('/api/member/checkin', { method: 'POST' })
    .then(() => localStorage.setItem('aconsu_last_checkin', todayKey))
    .catch(() => {}); // non-critical — silently skip if it fails
}

const BOTTOM_TABS = [
  { href: '/index.html', label: 'Home', icon: ICON_HOME },
  { href: '/events.html', label: 'Events', icon: ICON_EVENTS },
  { href: '/bible.html', label: 'Bible', icon: ICON_BIBLE },
  { href: '/prayer.html', label: 'Prayer', icon: ICON_PRAYER }
];

function renderBottomNav(activePath, customPages, member) {
  document.getElementById('bottomNav')?.remove();

  const tabHrefs = BOTTOM_TABS.map(t => t.href);
  const isMoreActive = activePath && !tabHrefs.includes(activePath);

  // "More" is a full page of its own rather than a pop-up sheet, so it can be
  // linked to, shared, and reached with the back button like anything else.
  const nav = document.createElement('nav');
  nav.id = 'bottomNav';
  nav.className = 'bottom-nav';
  nav.innerHTML = `
    ${BOTTOM_TABS.map(t => `
      <a href="${t.href}" class="bottom-nav-item ${activePath === t.href ? 'active' : ''}">
        ${svgIcon(t.icon)}
        <span>${t.label}</span>
      </a>
    `).join('')}
    <a href="/more.html" class="bottom-nav-item ${isMoreActive ? 'active' : ''}" id="moreTabBtn" style="position:relative;">
      ${svgIcon(ICON_MORE)}
      <span>More</span>
    </a>
  `;
  document.body.appendChild(nav);

  getUnreadNotificationCount().then((count) => {
    if (count > 0) {
      const moreBtn = document.getElementById('moreTabBtn');
      const dot = document.createElement('span');
      dot.style.cssText = 'position:absolute; top:2px; right:22%; width:8px; height:8px; border-radius:50%; background:var(--flame-red);';
      moreBtn.appendChild(dot);
    }
  });
}


// The verse on the home screen. Two things can fill it, and the more specific
// one wins: today's verse from the chapter's Bible Studies Coordinator if they
// have posted one, otherwise the Verse of the Week an admin typed into Site
// Settings. Before this, the Coordinator could post a daily verse that nothing
// in the app ever showed.
async function renderVerseOfDay(settings) {
  const verseEl = document.getElementById('verseStrip');
  if (!verseEl) return;

  const daily = await fetchJSON('/api/daily-verse').then(r => r && r.item).catch(() => null);
  if (daily && daily.reference) {
    verseEl.textContent = daily.text
      ? `"${daily.text}" — ${daily.reference}`
      : daily.reference;
    // Kept apart as well as joined: sharing this verse as an image needs the
    // two halves, and guessing them back out of one string is guesswork.
    verseEl.dataset.reference = daily.reference;
    if (daily.text) verseEl.dataset.text = daily.text;
    // The reflection is the Coordinator's own thought on it, so it is shown
    // under the verse rather than folded into the quote itself.
    const card = document.getElementById('verseOfDayCard');
    if (card && daily.reflection && !card.querySelector('.verse-reflection')) {
      const note = document.createElement('p');
      note.className = 'verse-reflection';
      note.style.cssText = 'margin:10px 0 0; font-size:0.85rem; opacity:0.85;';
      note.textContent = daily.reflection;
      verseEl.insertAdjacentElement('afterend', note);
    }
    return;
  }

  if (settings && settings.verseOfTheWeek) verseEl.textContent = settings.verseOfTheWeek;
}

const NAV_LINKS = [
  { href: '/index.html', label: 'Home' },
  { href: '/about.html', label: 'About' },
  { href: '/departments.html', label: 'Departments' },
  { href: '/events.html', label: 'Events' },
  { href: '/media.html', label: 'Sermons' },
  { href: '/bible.html', label: 'Bible' },
  { href: '/prayer.html', label: 'Prayer Wall' },
  { href: '/contact.html', label: 'Contact' }
];

function renderHeader(activePath, customPages, member) {
  const el = document.getElementById('site-header');
  if (!el) return;
  const custom = (customPages || []).filter(p => p.showInNav).map(p => ({
    href: `/page.html?slug=${encodeURIComponent(p.slug)}`,
    label: p.navLabel || p.title
  }));
  const allLinks = [...NAV_LINKS.slice(0, -1), ...custom, NAV_LINKS[NAV_LINKS.length - 1]];
  const links = allLinks.map(l => `<li><a href="${l.href}" class="${activePath === l.href ? 'active' : ''}">${l.label}</a></li>`).join('');
  const accountLink = member
    ? `<a href="/profile.html" class="btn btn-outline btn-sm nav-btn-account">${escapeHtml(member.name.split(' ')[0])}</a>`
    : `<a href="/login.html" class="btn btn-outline btn-sm nav-btn-account">Log In</a>`;
  el.innerHTML = `
    <nav class="nav">
      <a href="/index.html" class="nav-brand">
        <img src="/images/logo.jpg" alt="ACONSU logo">
        <span>ACONSU</span>
      </a>
      <ul class="nav-links" id="navLinks">${links}</ul>
      <div class="nav-cta">
        <button type="button" class="theme-toggle" id="themeToggle" aria-label="Switch between light and dark">
          ${themeToggleIcon()}
        </button>
        <a href="/notifications.html" class="bell-link" id="navBellLink" aria-label="Notifications" style="position:relative; color:var(--brand); display:flex; align-items:center;">
          ${svgIcon(ICON_BELL)}
        </a>
        ${accountLink}
        <a href="/prayer.html" class="btn btn-primary btn-sm nav-btn-prayer">Prayer Request</a>
      </div>
    </nav>
  `;
  wireNotificationBell();
  wireThemeToggle();
}

// ---------- light and dark ----------
// The theme is set on <html> by an inline script in each page's <head>, before
// any of this runs, so the page never paints light and then flips. Everything
// below only has to keep that in step with what the reader clicks.
const THEME_KEY = 'aconsu.theme';

// What the reader chose, or '' for "whatever this device prefers". Storage can
// throw in a private window, so it is never allowed to take the page down.
function storedTheme() {
  try { return localStorage.getItem(THEME_KEY) || ''; } catch (e) { return ''; }
}

function systemPrefersDark() {
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function currentTheme() {
  return document.documentElement.getAttribute('data-theme')
    || storedTheme()
    || (systemPrefersDark() ? 'dark' : 'light');
}

// The icon shows what you would GET, not what you are on: a moon while you are
// in the light, because that is the thing the button does.
function themeToggleIcon() {
  const dark = currentTheme() === 'dark';
  return dark
    ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* private window */ }
  const btn = document.getElementById('themeToggle');
  if (btn) {
    btn.innerHTML = themeToggleIcon();
    btn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }
}

function wireThemeToggle() {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  if (btn.dataset.wired) return;
  btn.dataset.wired = '1';
  // The staff portals carry the button in static markup, so it arrives empty.
  if (!btn.querySelector('svg')) btn.innerHTML = themeToggleIcon();
  btn.setAttribute('aria-label', currentTheme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  btn.addEventListener('click', () => {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  });

  // Until someone chooses for themselves, follow the device. Once they have
  // chosen, their choice stands - changing the phone's theme at dusk should not
  // overrule someone who deliberately picked the other one.
  if (!storedTheme() && window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = (e) => {
      if (storedTheme()) return;
      document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
      btn.innerHTML = themeToggleIcon();
    };
    if (mq.addEventListener) mq.addEventListener('change', follow);
    else if (mq.addListener) mq.addListener(follow);
  }
}

// ---------- in-app notifications ----------
// The bell stays a real link to /notifications.html — it works with no script,
// it can be opened in a new tab, and it is still where the full history lives.
// The click is only intercepted to show the last few in place, because reading
// one notice should not cost you the page you were on.
function wireNotificationBell() {
  const bell = document.getElementById('navBellLink');
  if (!bell) return;

  getUnreadNotificationCount().then((count) => {
    bell.querySelector('.notif-count')?.remove();
    if (count <= 0) return;
    const badge = document.createElement('span');
    badge.className = 'notif-count';
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.setAttribute('aria-label', `${count} unread`);
    bell.appendChild(badge);
  });

  bell.addEventListener('click', (e) => {
    // Let a modified click do what the person plainly meant by it.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    toggleNotificationPanel(bell);
  });
}

function closeNotificationPanel() {
  document.getElementById('notifPanel')?.remove();
  document.removeEventListener('keydown', notifEscHandler);
}

function notifEscHandler(e) {
  if (e.key === 'Escape') closeNotificationPanel();
}

async function toggleNotificationPanel(bell) {
  if (document.getElementById('notifPanel')) return closeNotificationPanel();

  const panel = document.createElement('div');
  panel.id = 'notifPanel';
  panel.className = 'notif-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Notifications');
  panel.innerHTML = `
    <div class="notif-panel-head">
      <strong>Notifications</strong>
      <a href="/notifications.html">See all</a>
    </div>
    <div class="notif-panel-body"><p class="notif-empty">Loading\u2026</p></div>
  `;
  document.body.appendChild(panel);
  document.addEventListener('keydown', notifEscHandler);

  // Anything outside closes it — including the bell, which toggles.
  setTimeout(() => {
    document.addEventListener('click', function away(e) {
      if (panel.contains(e.target) || bell.contains(e.target)) return;
      closeNotificationPanel();
      document.removeEventListener('click', away);
    });
  }, 0);

  const body = panel.querySelector('.notif-panel-body');
  let items = [];
  try {
    items = await fetchJSON('/api/notifications');
  } catch (err) {
    body.innerHTML = '<p class="notif-empty">Could not load notifications right now.</p>';
    return;
  }
  if (!items.length) {
    body.innerHTML = '<p class="notif-empty">Nothing yet. You are all caught up.</p>';
  } else {
    const lastSeen = (() => {
      try { return localStorage.getItem('aconsu_last_seen_notif') || ''; } catch (e) { return ''; }
    })();
    body.innerHTML = items.slice(0, 8).map((n) => `
      <a class="notif-row ${n.createdAt > lastSeen ? 'unread' : ''}" href="${escapeHtml(n.url || '/notifications.html')}">
        <span class="notif-row-title">${escapeHtml(n.title || 'Notice')}</span>
        <span class="notif-row-body">${escapeHtml(n.body || '')}</span>
        <span class="notif-row-when">${timeAgo(n.createdAt)}</span>
      </a>
    `).join('');
  }

  // Marked seen on opening, not on visiting the full page — opening the panel
  // IS having seen them, and the badge should agree with what you just read.
  markNotificationsSeen();
  bell.querySelector('.notif-count')?.remove();
}

// Short, and tolerant of a clock that disagrees with the server's. A phone
// running fast makes the difference negative; every branch below already falls
// through to 'just now' in that case, and the clamp keeps it that way if the
// order of those branches ever changes.
function timeAgo(iso) {
  const then = new Date(iso).getTime();
  if (!then) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ---------- the side rail (wide screens) ----------
// The same links the top bar and the bottom tabs already carry, laid out as a
// rail. Grouped, because a flat list of fourteen is a list you scan rather than
// a place you know your way around.
//
// It is built here rather than written into each page for the same reason the
// header is: there are twenty-one pages, and a link added in one place should
// not need finding in twenty-one others.
const SIDE_NAV_GROUPS = [
  {
    title: '',
    links: [{ href: '/index.html', label: 'Home', icon: ICON_HOME }]
  },
  {
    title: 'Gather',
    links: [
      { href: '/content.html?kind=live_service', label: 'Live Service', icon: ICON_VIDEO },
      { href: '/media.html', label: 'Sermons', icon: ICON_HEADPHONES },
      { href: '/events.html', label: 'Events', icon: ICON_EVENTS }
    ]
  },
  {
    title: 'Grow',
    links: [
      { href: '/bible.html', label: 'Bible', icon: ICON_BIBLE },
      { href: '/bible-study.html', label: 'Bible Study', icon: ICON_BOOK },
      { href: '/prayer.html', label: 'Prayer Wall', icon: ICON_PRAYER }
    ]
  },
  {
    title: 'Belong',
    links: [
      { href: '/departments.html', label: 'Departments', icon: ICON_USERS },
      { href: '/groups.html', label: 'Groups', icon: ICON_USERS },
      { href: '/chat.html', label: 'Community Chat', icon: ICON_CHAT },
      { href: '/alumni.html', label: 'Alumni Connect', icon: ICON_USERS }
    ]
  },
  {
    title: 'Support',
    links: [
      { href: '/give.html', label: 'Giving', icon: ICON_GIVE },
      { href: '/welfare.html', label: 'Welfare', icon: ICON_GIVE },
      { href: '/notifications.html', label: 'Notifications', icon: ICON_BELL },
      { href: '/about.html', label: 'About', icon: ICON_INFO },
      { href: '/contact.html', label: 'Contact', icon: ICON_MAIL }
    ]
  }
];

function renderSideNav(activePath, customPages, member) {
  document.getElementById('sideNav')?.remove();

  // A page the chapter added itself is as much part of the app as a built-in
  // one, so it sits in the rail rather than being reachable only from a menu.
  const custom = (customPages || []).filter(p => p.showInNav).map(p => ({
    href: `/page.html?slug=${encodeURIComponent(p.slug)}`,
    label: p.navLabel || p.title,
    icon: ICON_BOOK
  }));
  const groups = custom.length
    ? [...SIDE_NAV_GROUPS, { title: 'More from your chapter', links: custom }]
    : SIDE_NAV_GROUPS;

  const item = (l) => `
    <a href="${l.href}" class="side-nav-item ${activePath === l.href ? 'active' : ''}">
      ${svgIcon(l.icon)}<span>${escapeHtml(l.label)}</span>
    </a>`;

  const account = member
    ? `<a href="/profile.html" class="side-nav-me">
         <span class="side-nav-avatar">${escapeHtml((member.name || '?').trim().charAt(0).toUpperCase())}</span>
         <span class="side-nav-me-text">
           <strong>${escapeHtml(member.name || 'My profile')}</strong>
           <small>View profile</small>
         </span>
       </a>`
    : `<a href="/login.html" class="btn btn-primary btn-sm btn-block">Log In</a>`;

  const rail = document.createElement('aside');
  rail.id = 'sideNav';
  rail.className = 'side-nav';
  rail.innerHTML = `
    <a href="/index.html" class="side-nav-brand">
      <img src="/images/logo.jpg" alt=""><span>ACONSU</span>
    </a>
    <nav class="side-nav-scroll">
      ${groups.map(g => `
        ${g.title ? `<p class="side-nav-title">${escapeHtml(g.title)}</p>` : ''}
        ${g.links.map(item).join('')}
      `).join('')}
    </nav>
    <div class="side-nav-foot">${account}</div>
  `;
  document.body.appendChild(rail);
}

function renderFooter(settings) {
  const el = document.getElementById('site-footer');
  if (!el) return;
  const s = settings || {};
  el.innerHTML = `
    <div class="container">
      <div class="footer-grid">
        <div>
          <h4>ACONSU</h4>
          <p style="color:#C9B3D8; font-size:0.9rem;">${escapeHtml(s.fullName || "The Apostles' Continuation Students Union")}</p>
          <div class="social-row">${socialLinksHtml(s)}</div>
        </div>
        <div>
          <h4>Explore</h4>
          <a href="/departments.html">Departments</a>
          <a href="/events.html">Events</a>
          <a href="/media.html">Sermons &amp; Media</a>
          <a href="/prayer.html">Prayer Wall</a>
        </div>
        <div>
          <h4>Get Involved</h4>
          <a href="/departments.html">Join a Department</a>
          <a href="/alumni.html">Alumni Connect</a>
          <a href="/prayer.html">Submit a Prayer Request</a>
          <a href="/contact.html">Contact Us</a>
          <a href="/privacy.html">Privacy Policy</a>
        </div>
        <div>
          <h4>Reach Us</h4>
          <a href="#">${escapeHtml(s.address || 'Campus Fellowship Auditorium')}</a>
          ${s.email ? `<a href="mailto:${s.email}">${escapeHtml(s.email)}</a>` : ''}
          ${s.phone ? `<a href="tel:${s.phone}">${escapeHtml(s.phone)}</a>` : ''}
        </div>
      </div>
      <div class="footer-bottom">
        <span>&copy; ${new Date().getFullYear()} ACONSU. All Rights Reserved.</span>
        <span>Built with love, for the union.</span>
      </div>
      <div style="text-align:center; padding-top:10px; font-size:0.72rem; color:#9b86a9;">Powered by HasTech Solutions</div>
    </div>
  `;
}

async function initLayout(activePath) {
  await ensureChapterSelected();
  let member = null;
  try {
    const authRes = await fetchJSON('/api/auth/me');
    member = authRes.member;
    if (member) {
      dailyCheckin();
      // A signed-in member's own chapter is authoritative — keeps this
      // browser in step even if it last browsed anonymously as another
      // chapter (a shared/public computer, a link from a friend, etc.).
      if (member.chapterId && member.chapterId !== getSelectedChapterId()) {
        setSelectedChapterId(member.chapterId);
      }
    }
  } catch (e) { /* nav still works without auth state */ }
  let customPages = [];
  try {
    customPages = await fetchJSON('/api/pages');
  } catch (e) { /* nav still works without custom pages */ }
  renderHeader(activePath, customPages, member);
  renderBottomNav(activePath, customPages, member);
  renderSideNav(activePath, customPages, member);
  try {
    const settings = await fetchJSON('/api/settings');
    renderFooter(settings);
    applyHeroArtwork(settings);
    await renderVerseOfDay(settings);
    return settings;
  } catch (e) {
    renderFooter({});
    return {};
  }
}

// ---------- hero artwork ----------
// Each page's built-in scene is drawn by CSS from the data-art on its own
// hero, so it is already on screen before this runs and before any request
// returns. This only adds the picture a chapter has uploaded for that page,
// when it has uploaded one.
function applyHeroArtwork(settings) {
  const hero = document.querySelector('.hero[data-hero-page]');
  if (!hero || hero.querySelector('.hero-art')) return;
  const own = ((settings && settings.heroArt) || {})[hero.dataset.heroPage];
  if (!own || !own.fileId) return;

  const url = `/api/files/${encodeURIComponent(own.fileId)}`;
  const layer = document.createElement('div');
  layer.className = 'hero-art';

  // Nothing is shown until the picture has actually decoded. A slow file leaves
  // the scene where it is, and a missing one leaves it there for good — better
  // than a blank rectangle, and much better than dark text on a dark image
  // because the tone was flipped before the veil under it existed.
  const probe = new Image();
  probe.onload = () => {
    layer.style.backgroundImage = `url('${url}')`;
    hero.dataset.artTone = own.tone === 'dark' ? 'dark' : 'light';
    hero.prepend(layer);
    requestAnimationFrame(() => layer.classList.add('is-loaded'));
  };
  probe.src = url;
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------- countdown ----------
function startCountdown(targetDate, targetTime, elId) {
  const el = document.getElementById(elId);
  if (!el || !targetDate) return;
  const target = new Date(`${targetDate}T${targetTime || '00:00'}:00`);

  function tick() {
    const now = new Date();
    let diff = target - now;
    if (diff <= 0) {
      el.innerHTML = '<div class="countdown-caption">We are live now — see you inside!</div>';
      clearInterval(timer);
      return;
    }
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const mins = Math.floor((diff / (1000 * 60)) % 60);
    const secs = Math.floor((diff / 1000) % 60);
    el.querySelector('[data-d]').textContent = String(days).padStart(2, '0');
    el.querySelector('[data-h]').textContent = String(hours).padStart(2, '0');
    el.querySelector('[data-m]').textContent = String(mins).padStart(2, '0');
    el.querySelector('[data-s]').textContent = String(secs).padStart(2, '0');
  }
  tick();
  const timer = setInterval(tick, 1000);
}

function nextUpcomingEvent(events) {
  const now = new Date();
  const upcoming = events
    .filter(e => new Date(`${e.date}T${e.time || '00:00'}:00`) >= now)
    .sort((a, b) => new Date(`${a.date}T${a.time}:00`) - new Date(`${b.date}T${b.time}:00`));
  return upcoming[0] || null;
}

// ---------- PWA: service worker + install prompt ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline support just won't be available */ });
  });
}

window.addEventListener('load', maybeOfferIosInstall);

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  showInstallBanner();
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  const banner = document.getElementById('installBanner');
  if (banner) banner.remove();
});

// Safari never fires `beforeinstallprompt` — there is no programmatic install on
// iOS at all. Since we are not shipping through the App Store, Add to Home Screen
// is the *only* way an iPhone member can get the app, and Apple surfaces it
// nowhere obvious. Without this, every iOS visitor stays on a browser tab
// forever and never sees a home-screen icon or a full-screen app.
function isIosSafari() {
  const ua = navigator.userAgent || '';
  // iPadOS 13+ reports itself as a Mac; the touch-point count is what gives it away.
  const isIpadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const isIos = /iPad|iPhone|iPod/.test(ua) || isIpadOs;
  if (!isIos) return false;
  // Chrome, Firefox and Edge on iOS cannot install to the home screen at all,
  // so pointing their users at a Share menu that lacks the option is worse than
  // saying nothing. Only Safari proper gets the prompt.
  return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

function isStandalone() {
  return window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}

function showIosInstallSheet() {
  if (document.getElementById('iosInstallSheet')) return;
  if (localStorage.getItem('aconsu_install_dismissed') === '1') return;

  const sheet = document.createElement('div');
  sheet.id = 'iosInstallSheet';
  sheet.innerHTML = `
    <div style="display:flex; align-items:center; gap:12px; margin-bottom:14px;">
      <img src="/icons/icon-72.png" alt="" style="width:44px; height:44px; border-radius:12px; flex-shrink:0;">
      <div>
        <strong style="display:block; font-size:0.95rem;">Add ACONSU to your Home Screen</strong>
        <span style="font-size:0.78rem; opacity:0.8;">Opens full screen and works offline</span>
      </div>
      <button id="iosInstallDismiss" aria-label="Dismiss" style="margin-left:auto; background:none; color:#fff; border:none; font-size:1.4rem; line-height:1; cursor:pointer; opacity:0.75; flex-shrink:0;">&times;</button>
    </div>
    <ol style="margin:0; padding-left:20px; font-size:0.85rem; line-height:1.85; opacity:0.92;">
      <li>Tap the <strong>Share</strong> button <span aria-hidden="true">&#x2191;</span> at the bottom of Safari</li>
      <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
      <li>Tap <strong>Add</strong></li>
    </ol>
  `;
  sheet.style.cssText = 'position:fixed; left:16px; right:16px; bottom:16px; z-index:390; background:#3A1B54; color:#fff; border-radius:16px; padding:16px 18px; box-shadow:0 16px 40px rgba(0,0,0,0.32); max-width:420px; margin:0 auto; font-family:Manrope,sans-serif;';
  document.body.appendChild(sheet);

  document.getElementById('iosInstallDismiss').addEventListener('click', () => {
    try { localStorage.setItem('aconsu_install_dismissed', '1'); } catch (e) { /* private mode */ }
    sheet.remove();
  });
}

// Don't ambush a first-time visitor with this before they know what the app is.
// Show it once they've come back, or once they've been reading for a while.
function maybeOfferIosInstall() {
  if (!isIosSafari() || isStandalone()) return;
  let visits = 0;
  try {
    visits = parseInt(localStorage.getItem('aconsu_visits') || '0', 10) + 1;
    localStorage.setItem('aconsu_visits', String(visits));
  } catch (e) { return; } // no storage means no way to stop nagging, so don't start
  if (visits >= 2) setTimeout(showIosInstallSheet, 2500);
}

function showInstallBanner() {
  if (document.getElementById('installBanner')) return;
  if (localStorage.getItem('aconsu_install_dismissed') === '1') return;
  if (isStandalone()) return;
  const banner = document.createElement('div');
  banner.id = 'installBanner';
  banner.innerHTML = `
    <div style="display:flex; align-items:center; gap:12px;">
      <img src="/icons/icon-72.png" alt="" style="width:38px; height:38px; border-radius:10px;">
      <div>
        <strong style="display:block; font-size:0.9rem;">Install the ACONSU App</strong>
        <span style="font-size:0.78rem; opacity:0.85;">Quick access, works offline</span>
      </div>
    </div>
    <div style="display:flex; gap:8px; flex-shrink:0;">
      <button id="installBtn" style="background:#fff; color:#3A1B54; border:none; padding:8px 16px; border-radius:999px; font-weight:700; font-size:0.85rem; cursor:pointer;">Install</button>
      <button id="dismissInstallBtn" style="background:none; color:#fff; border:none; font-size:1.2rem; cursor:pointer; opacity:0.8;">&times;</button>
    </div>
  `;
  banner.style.cssText = 'position:fixed; left:16px; right:16px; bottom:16px; z-index:390; background:#3A1B54; color:#fff; border-radius:14px; padding:14px 16px; display:flex; align-items:center; justify-content:space-between; gap:12px; box-shadow:0 16px 40px rgba(0,0,0,0.28); max-width:480px; margin:0 auto; font-family:Manrope,sans-serif;';
  document.body.appendChild(banner);

  document.getElementById('installBtn').addEventListener('click', async () => {
    banner.remove();
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
  });
  document.getElementById('dismissInstallBtn').addEventListener('click', () => {
    localStorage.setItem('aconsu_install_dismissed', '1');
    banner.remove();
  });
}

// ---------- toast notifications ----------
function ensureToastHost() {
  let host = document.getElementById('toastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toastHost';
    host.style.cssText = 'position:fixed; bottom:20px; right:20px; z-index:400; display:flex; flex-direction:column; gap:10px; max-width:320px;';
    document.body.appendChild(host);
  }
  return host;
}
function showToast(message, type) {
  const host = ensureToastHost();
  const toast = document.createElement('div');
  const bg = type === 'error' ? '#A93226' : type === 'success' ? '#2E7D4F' : '#3A1B54';
  toast.textContent = message;
  toast.style.cssText = `background:${bg}; color:#fff; padding:14px 18px; border-radius:10px; font-family:'Manrope',sans-serif; font-weight:600; font-size:0.9rem; box-shadow:0 12px 28px rgba(0,0,0,0.2); opacity:0; transform:translateY(12px); transition:opacity 0.25s ease, transform 0.25s ease;`;
  host.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)'; });
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(12px)';
    setTimeout(() => toast.remove(), 300);
  }, 3600);
}

// ---------- scroll-reveal for cards/sections ----------
function initScrollReveal(selector) {
  const els = document.querySelectorAll(selector || '.card, .form-card');
  if (!('IntersectionObserver' in window) || !els.length) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('reveal-in');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });
  els.forEach(el => { el.classList.add('reveal-pre'); io.observe(el); });
}

// ---------- floating decorative images ----------
function renderFloatingImages(containerId, fileIds, positions) {
  const container = document.getElementById(containerId);
  if (!container || !fileIds || !fileIds.length) return;
  const defaultPositions = [
    { top: '8%', left: '4%', width: '140px', height: '100px', rotate: '-6deg', delay: '0s' },
    { top: '12%', right: '5%', width: '120px', height: '160px', rotate: '5deg', delay: '0.15s' },
    { bottom: '6%', left: '8%', width: '130px', height: '90px', rotate: '4deg', delay: '0.3s' },
    { bottom: '10%', right: '6%', width: '110px', height: '140px', rotate: '-4deg', delay: '0.45s' }
  ];
  const pos = positions || defaultPositions;
  fileIds.slice(0, pos.length).forEach((fileId, i) => {
    const p = pos[i];
    const div = document.createElement('div');
    div.className = 'float-deco';
    Object.assign(div.style, {
      top: p.top || 'auto', left: p.left || 'auto', right: p.right || 'auto', bottom: p.bottom || 'auto',
      width: p.width, height: p.height, transform: `rotate(${p.rotate})`, animationDelay: p.delay
    });
    div.innerHTML = `<img src="/api/files/${fileId}" alt="" loading="lazy">`;
    container.appendChild(div);
    setTimeout(() => div.classList.add('fade-in'), 50 + i * 120);
  });
}

// ---------- mobile haptic feedback & share ----------
function triggerHaptic(duration = 10) {
  try {
    if ('vibrate' in navigator) navigator.vibrate(duration);
  } catch (e) { /* ignore if unsupported */ }
}

async function shareContent({ title, text, url }) {
  const shareUrl = url || window.location.href;
  const shareData = {
    title: title || document.title,
    text: text || '',
    url: shareUrl
  };
  triggerHaptic(12);
  if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData);
      return true;
    } catch (e) {
      if (e.name !== 'AbortError') showToast('Could not share content', 'error');
      return false;
    }
  }
  // Fallback: Copy link to clipboard
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Link copied to clipboard!', 'success');
      return true;
    }
  } catch (err) { /* clipboard failure */ }
  showToast('Sharing is not supported on this browser', 'error');
  return false;
}

// ---------- sharing a verse as a card ----------
// One path for both places a verse can be shared from, so the picker, the
// share sheet and the download fallback exist once.
const VERSE_STYLE_PREF = 'aconsu.verseCardStyle';

function rememberedVerseStyle() {
  try { return localStorage.getItem(VERSE_STYLE_PREF) || ''; } catch (e) { return ''; }
}

async function pickVerseCardStyle() {
  let styles = [];
  let fallback = 'purple';
  try {
    const data = await fetchJSON('/api/verse-styles');
    styles = data.styles || [];
    fallback = data.defaultStyle || fallback;
  } catch (e) {
    return rememberedVerseStyle() || fallback; // offline: use whatever they chose last
  }
  if (!styles.length) return fallback;

  const chosen = rememberedVerseStyle();
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:fixed; inset:0; background:rgba(36,21,48,0.58); z-index:9999; display:flex; align-items:flex-end; justify-content:center; padding:0;';
    backdrop.innerHTML = `
      <div role="dialog" aria-label="Choose a background" style="background:#fff; width:100%; max-width:480px; border-radius:18px 18px 0 0; padding:20px 20px calc(20px + env(safe-area-inset-bottom,0px)); font-family:'Manrope',sans-serif;">
        <h3 style="margin:0 0 4px; font-family:'Fraunces',serif; font-size:1.15rem; color:#3A1B54;">Choose a background</h3>
        <p style="margin:0 0 16px; font-size:0.85rem; color:#6b5878;">Your choice is remembered for next time.</p>
        <div id="verseStyleGrid" style="display:grid; grid-template-columns:repeat(3,1fr); gap:10px;"></div>
        <button type="button" id="verseStyleCancel" class="btn btn-outline btn-sm" style="width:100%; margin-top:16px;">Cancel</button>
      </div>
    `;
    document.body.appendChild(backdrop);

    const grid = backdrop.querySelector('#verseStyleGrid');
    styles.forEach((style) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isChosen = style.value === chosen;
      btn.style.cssText = `border:2px solid ${isChosen ? '#5B2C82' : 'transparent'}; background:none; padding:0; cursor:pointer; border-radius:12px; overflow:hidden; display:block;`;
      const chip = document.createElement('span');
      chip.style.cssText = `display:block; height:74px; border-radius:9px; background:${style.swatch || '#5B2C82'};`;
      const name = document.createElement('span');
      name.style.cssText = 'display:block; font-size:0.72rem; font-weight:700; color:#3A1B54; padding:6px 2px 4px; text-align:center;';
      name.textContent = style.label;
      btn.append(chip, name);
      btn.addEventListener('click', () => {
        try { localStorage.setItem(VERSE_STYLE_PREF, style.value); } catch (e) { /* private mode */ }
        backdrop.remove();
        resolve(style.value);
      });
      grid.appendChild(btn);
    });

    const close = () => { backdrop.remove(); resolve(''); };
    backdrop.querySelector('#verseStyleCancel').addEventListener('click', close);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  });
}

// Share sheets take a file where they can, which is how a verse card ends up
// in a WhatsApp status rather than a downloads folder. Everything else falls
// back to a plain download.
async function shareVerseCard({ text, reference, filename }) {
  const style = await pickVerseCardStyle();
  if (!style) return false; // they backed out of the picker

  const params = new URLSearchParams({ verse: text || '', style });
  if (reference) params.set('reference', reference);
  const url = `/api/verse-image?${params.toString()}`;
  const name = `${(filename || reference || 'verse').replace(/[\s:]+/g, '_')}.png`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('image failed');
    const blob = await res.blob();
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: reference || 'Verse of the Day' });
      return true;
    }
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = name;
    a.click();
    URL.revokeObjectURL(objectUrl);
    showToast('Verse image saved.', 'success');
    return true;
  } catch (e) {
    if (e && e.name === 'AbortError') return false;
    showToast('Could not make the verse image.', 'error');
    return false;
  }
}

// ---------- offline / online network connectivity banner ----------
window.addEventListener('offline', () => {
  showToast('📡 You are currently offline. Viewing cached content.', 'error');
});
window.addEventListener('online', () => {
  showToast('⚡ Back online! Connection restored.', 'success');
});


// The staff portals and the admin pages build their own top bar rather than
// going through renderHeader, so the switch has to be picked up here too.
document.addEventListener('DOMContentLoaded', wireThemeToggle);
