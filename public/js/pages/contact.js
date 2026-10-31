// The script of contact.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
(async function() {
  const settings = await initLayout('/contact.html');
  const chapterName = settings.chapterName || settings.fellowshipName || 'ACONSU';
  const contact = settings.contact || {};
  const socialEl = document.getElementById('contactSocialRow');
  if (socialEl) {
    socialEl.innerHTML = socialLinksHtml(settings);
    socialEl.querySelectorAll('.social-icon-link').forEach(a => a.classList.add('on-light'));
  }
  if (settings.chapterName || settings.fellowshipName) {
    document.getElementById('contactTitle').textContent = `Contact ${chapterName}`;
  }
  if (settings.tagline) {
    document.getElementById('contactLede').textContent = settings.tagline;
  }
  const details = [
    contact.email || settings.email ? `<a href="mailto:${escapeHtml(contact.email || settings.email)}">${escapeHtml(contact.email || settings.email)}</a>` : '',
    contact.phone || settings.phone ? `<a href="tel:${escapeHtml(contact.phone || settings.phone)}">${escapeHtml(contact.phone || settings.phone)}</a>` : '',
    contact.whatsapp || settings.whatsapp ? `<a href="${String(contact.whatsapp || settings.whatsapp).startsWith('http') ? escapeHtml(contact.whatsapp || settings.whatsapp) : `https://wa.me/${escapeHtml(String(contact.whatsapp || settings.whatsapp).replace(/\D/g, ''))}`}" target="_blank" rel="noopener">WhatsApp: ${escapeHtml(contact.whatsapp || settings.whatsapp)}</a>` : '',
    settings.address ? `<span>${escapeHtml(settings.address)}</span>` : ''
  ].filter(Boolean);
  if (details.length) {
    document.getElementById('contactDetails').innerHTML = details.map(item => `<div style="font-weight:700; color:var(--brand);">${item}</div>`).join('');
    document.getElementById('contactDetailsBlurb').textContent = `Reach ${chapterName} through the official chapter channels below.`;
  }
})();

document.getElementById('contactForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('contactSubmitBtn');
  const msg = document.getElementById('contactMsg');
  btn.disabled = true; btn.textContent = 'Sending...';
  try {
    // No signal: kept on the phone and sent by itself when it is back (outbox.js).
    const out = await AconsuOutbox.send({
      url: '/api/contact', label: 'Message',
      body: {
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        message: document.getElementById('message').value
      }
    });
    msg.textContent = out.queued
      ? 'No signal right now. Your message is saved on this phone and will be sent by itself when you are back online.'
      : "Message sent. We'll get back to you soon.";
    msg.className = 'form-msg success';
    if (!out.queued) showToast("Message sent, we'll get back to you soon.", 'success');
    document.getElementById('contactForm').reset();
  } catch (err) {
    msg.textContent = err.message || 'Something went wrong. Please try again.';
    msg.className = 'form-msg error';
  } finally {
    btn.disabled = false; btn.textContent = 'Send Message';
  }
});
