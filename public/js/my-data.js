/* ============================================================
   Your data, on the profile page: download everything held about
   you, or delete your account for good. Both ask for your
   password first. Server side: routes/privacy.js.
   Requires main.js.
   ============================================================ */
(function () {
  const $ = (id) => document.getElementById(id);
  const say = (id, text, kind) => { const el = $(id); el.textContent = text; el.className = `form-msg ${kind}`; };
  const password = () => $('myDataPassword').value;

  function wire() {
    if (!$('myDataCard')) return;

    $('exportBtn').addEventListener('click', async () => {
      const btn = $('exportBtn');
      if (!password()) { $('myDataPassword').focus(); return say('myDataMsg', 'Type your password first.', 'error'); }
      btn.disabled = true; btn.textContent = 'Putting it together...';
      try {
        const data = await fetchJSON('/api/member/export', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password() })
        });
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `aconsu-my-data-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        $('myDataPassword').value = '';
        say('myDataMsg', 'Downloaded. The file is on this phone now: keep it somewhere safe.', 'success');
      } catch (err) {
        say('myDataMsg', err.message, 'error');
      } finally {
        btn.disabled = false; btn.textContent = 'Download my data';
      }
    });

    $('deleteAccountBtn').addEventListener('click', async () => {
      const btn = $('deleteAccountBtn');
      if (!password()) { $('myDataPassword').focus(); return say('deleteMsg', 'Type your password in the box above first.', 'error'); }
      if ($('deleteConfirm').value.trim().toUpperCase() !== 'DELETE') { $('deleteConfirm').focus(); return say('deleteMsg', 'Type DELETE to confirm.', 'error'); }
      if (!window.confirm('Delete your ACONSU account for good? This cannot be undone.')) return;
      btn.disabled = true; btn.textContent = 'Deleting...';
      try {
        await fetchJSON('/api/member/delete-account', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: password(), confirm: $('deleteConfirm').value })
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
