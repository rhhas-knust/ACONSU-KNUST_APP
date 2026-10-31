// The script of login.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
// Two ways in: the password, or (where the chapter can send texts) a code
// sent to the phone number. The second is offered only where it can work.
let byCode = false;
let codeSent = false;
const $ = (id) => document.getElementById(id);
function say(text, kind) { const m = $('loginMsg'); m.textContent = text; m.className = `form-msg ${kind || ''}`; }
function showMode() {
  $('passwordField').hidden = byCode;
  $('password').required = !byCode;
  $('codeField').hidden = !(byCode && codeSent);
  $('forgotLink').hidden = byCode;
  $('codeSwitch').textContent = byCode ? 'Sign in with my password instead' : 'Sign in with a code by text instead';
  document.querySelector('label[for="email"]').textContent = byCode ? 'Your phone number' : 'Phone number or email';
  $('loginBtn').textContent = !byCode ? 'Log In' : codeSent ? 'Sign in' : 'Send me a code';
}

(async function () {
  const authRes = await fetchJSON('/api/auth/me').catch(() => ({ member: null }));
  if (authRes.member) { window.location.href = '/profile.html'; return; }
  await initLayout('/login.html');
  const status = await fetchJSON(`/api/auth/sms-status?chapterId=${encodeURIComponent(getSelectedChapterId() || '')}`).catch(() => ({ codes: false }));
  $('codeSwitchWrap').hidden = !status.codes;
})();

$('codeSwitch').addEventListener('click', () => { byCode = !byCode; codeSent = false; say(''); showMode(); });

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('loginBtn');
  const msg = document.getElementById('loginMsg');
  if (byCode) {
    const post = (url, body) => fetchJSON(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    btn.disabled = true;
    try {
      if (!codeSent) {
        const out = await post('/api/auth/sms/request', { phone: $('email').value, purpose: 'signin' });
        codeSent = true; showMode();
        say(out.message, 'success');
        $('smsCodeInput').focus();
      } else {
        const out = await post('/api/auth/sms/signin', { phone: $('email').value, code: $('smsCodeInput').value });
        window.location.href = out.needsPhoto ? '/photo.html' : '/profile.html';
        return;
      }
    } catch (err) { say(err.message || 'Could not sign you in.', 'error'); }
    btn.disabled = false;
    return;
  }
  btn.disabled = true; btn.textContent = 'Logging in...';
  try {
    await fetchJSON('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: document.getElementById('email').value,
        password: document.getElementById('password').value
      })
    }).then((out) => {
      // Signed up but never added a photo: that comes first.
      if (out && out.needsPhoto) { window.location.href = '/photo.html'; return new Promise(() => {}); }
      return out;
    });
    showToast('Welcome back!', 'success');
    window.location.href = '/profile.html';
  } catch (err) {
    msg.textContent = err.message || 'Could not log in.';
    msg.className = 'form-msg error';
    btn.disabled = false; btn.textContent = 'Log In';
  }
});
