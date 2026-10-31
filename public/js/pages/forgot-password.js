// The script of forgot-password.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
initLayout('/forgot-password.html');

// A phone number: a code by text (where the chapter can send texts), then the
// code and a new password here. An email address: a link by email, as before.
const $ = (id) => document.getElementById(id);
const looksLikeEmail = (v) => v.includes('@');
let codeSent = false;
function say(text, kind) { const m = $('forgotMsg'); m.textContent = text; m.className = `form-msg ${kind || ''}`; }
const post = (url, body) => fetchJSON(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

$('email').addEventListener('input', () => { if (codeSent) { codeSent = false; $('resetByCode').hidden = true; $('forgotBtn').textContent = 'Send'; } });

$('forgotForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('forgotBtn');
  const who = $('email').value.trim();
  if (!who) { say('Type your phone number or email address.', 'error'); $('email').focus(); return; }
  btn.disabled = true;
  try {
    if (looksLikeEmail(who)) {
      const res = await post('/api/auth/forgot-password', { email: who });
      say(res.message || 'If an account exists for that email, a reset link has been sent.', 'success');
    } else if (!codeSent) {
      const status = await fetchJSON(`/api/auth/sms-status?chapterId=${encodeURIComponent(getSelectedChapterId() || '')}`).catch(() => ({ codes: false }));
      if (!status.codes) {
        say('Resetting by text is not set up for your chapter yet. Type the email address on your account instead, or ask your chapter admin to reset it.', 'error');
      } else {
        const res = await post('/api/auth/sms/request', { phone: who, purpose: 'reset' });
        codeSent = true;
        $('resetByCode').hidden = false;
        btn.textContent = 'Change my password';
        say(res.message, 'success');
        $('resetCode').focus();
      }
    } else {
      if ($('newPassword').value.length < 8) { say('Choose a password of at least 8 characters.', 'error'); $('newPassword').focus(); btn.disabled = false; return; }
      const res = await post('/api/auth/sms/reset', { phone: who, code: $('resetCode').value, newPassword: $('newPassword').value });
      say(res.message, 'success');
      $('resetByCode').hidden = true;
      btn.hidden = true;
      $('forgotMsg').insertAdjacentHTML('afterend', '<p style="text-align:center; margin-top:12px;"><a class="btn btn-primary" href="/login.html">Sign in</a></p>');
    }
  } catch (err) {
    say(err.message || 'Something went wrong. Please try again.', 'error');
  } finally {
    btn.disabled = false;
  }
});
