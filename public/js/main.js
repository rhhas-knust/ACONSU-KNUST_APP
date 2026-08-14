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
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
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
    ? `<a href="/profile.html" class="btn btn-outline btn-sm">${escapeHtml(member.name.split(' ')[0])}</a>`
    : `<a href="/login.html" class="btn btn-outline btn-sm">Log In</a>`;
  el.innerHTML = `
    <nav class="nav">
      <a href="/index.html" class="nav-brand">
        <img src="/images/logo.jpg" alt="ACONSU logo">
        <span>ACONSU</span>
      </a>
      <ul class="nav-links" id="navLinks">${links}</ul>
      <div class="nav-cta">
        <a href="/notifications.html" class="bell-link" id="navBellLink" aria-label="Notifications" style="position:relative; color:var(--purple-deep); display:flex; align-items:center;">
          ${svgIcon(ICON_BELL)}
        </a>
        ${accountLink}
        <a href="/prayer.html" class="btn btn-primary btn-sm">Prayer Request</a>
        <button class="nav-toggle" id="navToggle" aria-label="Toggle menu">&#9776;</button>
      </div>
    </nav>
  `;
  document.getElementById('navToggle').addEventListener('click', () => {
    document.getElementById('navLinks').classList.toggle('open');
  });
  getUnreadNotificationCount().then((count) => {
    if (count > 0) {
      const bell = document.getElementById('navBellLink');
      const dot = document.createElement('span');
      dot.style.cssText = 'position:absolute; top:-3px; right:-3px; width:9px; height:9px; border-radius:50%; background:var(--flame-red); border:2px solid var(--paper);';
      bell.appendChild(dot);
    }
  });
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
          <div class="social-row">
            ${s.instagram ? `<a href="${s.instagram}" target="_blank" rel="noopener">IG</a>` : ''}
            ${s.facebook ? `<a href="${s.facebook}" target="_blank" rel="noopener">FB</a>` : ''}
            ${s.youtube ? `<a href="${s.youtube}" target="_blank" rel="noopener">YT</a>` : ''}
            ${s.whatsapp ? `<a href="https://wa.me/${s.whatsapp}" target="_blank" rel="noopener">WA</a>` : ''}
          </div>
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
          <a href="/prayer.html">Submit a Prayer Request</a>
          <a href="/contact.html">Contact Us</a>
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
  try {
    const settings = await fetchJSON('/api/settings');
    renderFooter(settings);
    const verseEl = document.getElementById('verseStrip');
    if (verseEl && settings.verseOfTheWeek) verseEl.textContent = settings.verseOfTheWeek;
    return settings;
  } catch (e) {
    renderFooter({});
    return {};
  }
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

function showInstallBanner() {
  if (document.getElementById('installBanner')) return;
  if (localStorage.getItem('aconsu_install_dismissed') === '1') return;
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
