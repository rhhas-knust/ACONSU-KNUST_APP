// The script of register.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
// Name, phone, chapter, password and agreement: everything else is on the
// profile, asked for later and never required. The photo comes straight
// after (photo.html), before anything else opens.
(async function () {
  const authRes = await fetchJSON('/api/auth/me').catch(() => ({ member: null }));
  if (authRes.member) { window.location.href = '/profile.html'; return; }
  await initLayout('/register.html');

  const chapterSelect = document.getElementById('chapterId');
  try {
    const chapters = await fetchJSON('/api/chapters');
    chapterSelect.innerHTML = chapters.length
      ? `<option value="">Select your chapter…</option>` + chapters.map(c =>
          `<option value="${c.id}">${escapeHtml(c.name)}${c.institution ? ': ' + escapeHtml(c.institution) : ''}</option>`
        ).join('')
      : `<option value="">No chapters available yet</option>`;
    // Only one chapter exists in most deployments - pick it automatically so
    // registration stays a single step until a second chapter is added.
    if (chapters.length === 1) chapterSelect.value = chapters[0].id;
    else if (getSelectedChapterId()) chapterSelect.value = getSelectedChapterId();
  } catch (e) {
    chapterSelect.innerHTML = `<option value="">Could not load chapters</option>`;
  }
  offerCode();
  chapterSelect.addEventListener('change', offerCode);
})();

// Signing up with a code instead of a password: only for a chapter with its
// own SMS account. Everywhere else the password stays.
let withCode = false;
async function offerCode() {
  const chapterId = document.getElementById('chapterId').value;
  const status = chapterId ? await fetchJSON(`/api/auth/sms-status?chapterId=${encodeURIComponent(chapterId)}`).catch(() => ({})) : {};
  document.getElementById('codeSignup').hidden = !status.phoneOnlySignup;
  if (!status.phoneOnlySignup && withCode) toggleCode();
}
function toggleCode() {
  withCode = !withCode;
  document.getElementById('passwordWrap').hidden = withCode;
  document.getElementById('codeSignupBox').hidden = !withCode;
  document.getElementById('codeSignupSwitch').textContent = withCode ? 'Choose a password instead' : 'No password? Get a code by text instead';
}
document.getElementById('codeSignupSwitch').addEventListener('click', toggleCode);
document.getElementById('sendSignupCode').addEventListener('click', async () => {
  const msg = document.getElementById('registerMsg');
  try {
    const out = await fetchJSON('/api/auth/sms/signup-code', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: document.getElementById('phone').value, chapterId: document.getElementById('chapterId').value })
    });
    msg.textContent = out.message; msg.className = 'form-msg success';
    document.getElementById('signupCode').focus();
  } catch (err) { msg.textContent = err.message; msg.className = 'form-msg error'; }
});

// Counted once a visit, the first time someone types into the form: only how
// many sign-ups were started, to set beside how many were finished. Nothing
// about who (routes/share.js, lib/metrics.js).
document.getElementById('registerForm').addEventListener('input', () => {
  try { navigator.sendBeacon('/api/metrics/signup-started'); } catch (e) { /* a lost count is fine */ }
}, { once: true });

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('registerBtn');
  const msg = document.getElementById('registerMsg');
  const say = (text, focus) => {
    msg.textContent = text;
    msg.className = 'form-msg error';
    if (focus) document.getElementById(focus).focus();
  };
  const v = (id) => document.getElementById(id).value.trim();
  if (v('name').length < 2) return say('Type your full name.', 'name');
  if (v('phone').replace(/\D/g, '').length < 9) return say('Type your phone number, like 024 412 3456.', 'phone');
  if (!v('chapterId')) return say('Choose your ACONSU chapter.', 'chapterId');
  if (!withCode && document.getElementById('password').value.length < 8) return say('Choose a password of at least 8 characters.', 'password');
  if (withCode && v('signupCode').length !== 6) return say('Type the 6-digit code from the text. No text? Press Text me a code.', 'signupCode');
  if (!document.getElementById('agree').checked) return say('Tick the box to agree to the Terms and the Privacy policy.', 'agree');
  btn.disabled = true; btn.textContent = 'Creating account...';
  try {
    const formData = new FormData();
    formData.append('chapterId', v('chapterId'));
    formData.append('name', v('name'));
    formData.append('phone', v('phone'));
    formData.append('email', v('email'));
    formData.append('password', withCode ? '' : document.getElementById('password').value);
    if (withCode) formData.append('smsCode', v('signupCode'));
    formData.append('consent', 'true');
    // fetchJSON attaches an X-Chapter-Id header automatically; multipart
    // bodies must not get a manual Content-Type (the browser sets the
    // multipart boundary itself), so this call intentionally passes none.
    await fetchJSON('/api/auth/register', { method: 'POST', body: formData });
    setSelectedChapterId(v('chapterId'));
    window.location.href = '/photo.html?new=1';
  } catch (err) {
    say(err.message || 'Could not create account.');
    btn.disabled = false; btn.textContent = 'Create Account';
  }
});
