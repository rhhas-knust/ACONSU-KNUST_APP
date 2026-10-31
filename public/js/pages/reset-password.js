// The script of reset-password.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
initLayout('/reset-password.html');

const params = new URLSearchParams(window.location.search);
const token = params.get('token');
const email = params.get('email');

if (!token || !email) {
  document.getElementById('resetForm').innerHTML = '<h1 style="text-align:center; font-size:1.8rem;">Set a new password</h1><p class="empty-state">This reset link is invalid. Please request a new one from the <a href="/forgot-password.html">forgot password page</a>.</p>';
}

document.getElementById('resetForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('resetBtn');
  const msg = document.getElementById('resetMsg');
  btn.disabled = true; btn.textContent = 'Resetting...';
  try {
    await fetchJSON('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, email, newPassword: document.getElementById('newPassword').value })
    });
    showToast('Password reset, please log in.', 'success');
    window.location.href = '/login.html';
  } catch (err) {
    msg.textContent = err.message || 'Could not reset password.';
    msg.className = 'form-msg error';
    btn.disabled = false; btn.textContent = 'Reset Password';
  }
});
