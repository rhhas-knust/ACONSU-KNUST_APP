/* ============================================================
   Your data, on the profile page: download everything held about
   you, or delete your account for good. Both ask for your
   password first, or for an account with none (signed up with a
   code) a code texted to it. Server side: routes/privacy.js.
   Requires main.js.
   ============================================================ */
(function () {
  const $ = (id) => document.getElementById(id);
  const say = (id, text, kind) => { const el = $(id); el.textContent = text; el.className = `form-msg ${kind}`; };
  const password = () => $('myDataPassword').value;
  let byCode = false;
  // What confirms it is them: the password, or the code from the text.
  const proof = () => (byCode ? { smsCode: $('myDataCode').value.trim() } : { password: password() });
  const proven = () => (byCode ? $('myDataCode').value.trim().length === 6 : !!password());
  const askFor = () => (byCode ? 'Text yourself a code and type it in first.' : 'Type your password first.');

  function wire() {
    if (!$('myDataCard')) return;
    fetchJSON('/api/auth/me').then(({ member }) => {
      if (!member || member.hasPassword !== false) return;
      byCode = true;
      $('myDataPasswordWrap').hidden = true;
      $('myDataCodeWrap').hidden = false;
      document.querySelector('.my-data-hint').textContent = 'Download a copy of everything ACONSU holds about you, or delete your account for good. A code texted to your phone confirms it is you, for either one.';
    }).catch(() => {});
    $('myDataSendCode').addEventListener('click', async () => {
      try {
        const out = await fetchJSON('/api/member/confirm-code', { method: 'POST' });
        say('myDataMsg', out.message, 'success');
        $('myDataCode').focus();
      } catch (err) { say('myDataMsg', err.message, 'error'); }
    });

    $('exportBtn').addEventListener('click', async () => {
      const btn = $('exportBtn');
      if (!proven()) { (byCode ? $('myDataCode') : $('myDataPassword')).focus(); return say('myDataMsg', askFor(), 'error'); }
      btn.disabled = true; btn.textContent = 'Putting it together...';
      try {
        const data = await fetchJSON('/api/member/export', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(proof())
        });
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `aconsu-my-data-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        $('myDataPassword').value = '';
        $('myDataCode').value = '';
        say('myDataMsg', 'Downloaded. The file is on this phone now: keep it somewhere safe.', 'success');
      } catch (err) {
        say('myDataMsg', err.message, 'error');
      } finally {
        btn.disabled = false; btn.textContent = 'Download my data';
      }
    });

    $('deleteAccountBtn').addEventListener('click', async () => {
      const btn = $('deleteAccountBtn');
      if (!proven()) { (byCode ? $('myDataCode') : $('myDataPassword')).focus(); return say('deleteMsg', byCode ? 'Text yourself a code above and type it in first.' : 'Type your password in the box above first.', 'error'); }
      if ($('deleteConfirm').value.trim().toUpperCase() !== 'DELETE') { $('deleteConfirm').focus(); return say('deleteMsg', 'Type DELETE to confirm.', 'error'); }
      if (!window.confirm('Delete your ACONSU account for good? This cannot be undone.')) return;
      btn.disabled = true; btn.textContent = 'Deleting...';
      try {
        await fetchJSON('/api/member/delete-account', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...proof(), confirm: $('deleteConfirm').value })
        });
        // The phone's offline copy of their records goes too, as it does on sign-out.
        await clearCachedAccountData();
        window.location.href = '/index.html?deleted=1';
      } catch (err) {
        say('deleteMsg', err.message, 'error');
        btn.disabled = false; btn.textContent = 'Delete my account for good';
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
