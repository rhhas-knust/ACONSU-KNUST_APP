// ---------- shared helpers ----------
async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
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

// ---------- header / footer ----------
const NAV_LINKS = [
  { href: '/index.html', label: 'Home' },
  { href: '/about.html', label: 'About' },
  { href: '/departments.html', label: 'Departments' },
  { href: '/events.html', label: 'Events' },
  { href: '/media.html', label: 'Sermons' },
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
        ${accountLink}
        <a href="/prayer.html" class="btn btn-primary btn-sm">Prayer Request</a>
        <button class="nav-toggle" id="navToggle" aria-label="Toggle menu">&#9776;</button>
      </div>
    </nav>
  `;
  document.getElementById('navToggle').addEventListener('click', () => {
    document.getElementById('navLinks').classList.toggle('open');
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
    </div>
  `;
}

async function initLayout(activePath) {
  let customPages = [];
  try {
    customPages = await fetchJSON('/api/pages');
  } catch (e) { /* nav still works without custom pages */ }
  let member = null;
  try {
    const authRes = await fetchJSON('/api/auth/me');
    member = authRes.member;
  } catch (e) { /* nav still works without auth state */ }
  renderHeader(activePath, customPages, member);
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
