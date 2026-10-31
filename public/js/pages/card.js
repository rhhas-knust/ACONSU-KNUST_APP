// The script of card.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
(async function () {
  await initLayout('/card.html');
  const authRes = await fetchJSON('/api/auth/me').catch(() => ({ member: null }));
  if (!authRes.member) { window.location.href = '/login.html'; return; }

  const wrap = document.getElementById('cardWrap');
  try {
    const data = await fetchJSON('/api/member/card');
    if (!data.ready) {
      wrap.innerHTML = `
        <div class="empty-state" style="background:var(--surface); border:1px solid var(--line); border-radius:16px; padding:40px 24px;">
          <p style="font-size:2rem; margin-bottom:10px;"></p>
          <p style="font-weight:700; color:var(--brand); margin-bottom:6px;">Card not ready yet</p>
          <p>${escapeHtml(data.message || 'Your card will be available once Shepherding completes your membership review.')}</p>
        </div>
      `;
      return;
    }
    const photo = data.profileImageFileId
      ? `<img src="/api/files/${data.profileImageFileId}" alt="">`
      : `<div class="avatar-fallback">${escapeHtml((data.name || '?').charAt(0).toUpperCase())}</div>`;
    wrap.innerHTML = `
      <div class="membership-card">
        <div class="brand-row">
          <img src="/images/logo.jpg" alt="ACONSU">
          <b>ACONSU Digital Membership Card</b>
        </div>
        <div class="photo-row">
          ${photo}
          <div>
            <p class="name">${escapeHtml(data.name)}</p>
            <p class="chapter">${escapeHtml(data.chapterName || '')}</p>
          </div>
        </div>
        <div class="status-row">
          <div>
            <div class="num-label">Membership No.</div>
            <div class="num-value">${escapeHtml(data.membershipNumber)}</div>
            <div class="num-label" style="margin-top:10px;">Status</div>
            <div class="num-value" style="text-transform:capitalize;">${escapeHtml(data.membershipStatus)}</div>
          </div>
          <div class="qr-box"><img src="${data.qrDataUrl}" alt="QR code"></div>
        </div>
      </div>
      <p class="card-hint">Show this QR code at events for quick attendance check-in.</p>
    `;
  } catch (e) {
    wrap.innerHTML = '<p class="empty-state">Could not load your membership card right now.</p>';
  }
})();
