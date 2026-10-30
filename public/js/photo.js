/* The photo, asked for straight after signing up (Phase 5). It is not on the
   sign-up form, which stays short, but it is still required: until there is
   one, every page of the app sends a signed-in member here first (main.js,
   initLayout). Requires main.js. */
(async function () {
  const $ = (id) => document.getElementById(id);
  const setFormMsg = (id, text, kind) => { const m = $(id); m.textContent = text; m.className = `form-msg ${kind || ''}`; };
  const params = new URLSearchParams(location.search);
  // Only a path on this site, never somewhere else.
  const next = /^\/[^/\\]/.test(params.get('next') || '') ? params.get('next') : '/index.html';
  const me = await fetchJSON('/api/auth/me').catch(() => ({ member: null }));
  if (!me.member) { location.replace('/login.html'); return; }
  if (!me.member.needsPhoto && !params.has('change')) { location.replace(next); return; }
  await initLayout('/photo.html');
  if (params.has('change')) $('photoTitle').textContent = 'Change your photo';

  let file = null;
  const pick = (input) => input.addEventListener('change', () => {
    file = input.files[0] || null;
    if (!file) return;
    if (!/^image\//.test(file.type)) { file = null; setFormMsg('photoMsg', 'That is not a photo. Choose a picture of yourself.', 'error'); return; }
    $('photoPreview').src = URL.createObjectURL(file);
    $('photoPreview').hidden = false;
    $('photoEmpty').hidden = true;
    $('photoSave').disabled = false;
    setFormMsg('photoMsg', '');
  });
  pick($('photoCamera'));
  pick($('photoFile'));

  $('photoForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!file) { setFormMsg('photoMsg', 'Take or choose a photo first.', 'error'); return; }
    const btn = $('photoSave');
    btn.disabled = true; btn.textContent = 'Saving...';
    try {
      const fd = new FormData();
      fd.append('photo', file);
      await fetchJSON('/api/member/photo', { method: 'POST', body: fd });
      showToast(params.has('new') ? 'Welcome to ACONSU!' : 'Your photo is saved.', 'success');
      location.replace(next);
    } catch (err) {
      setFormMsg('photoMsg', err.message || 'Could not save your photo.', 'error');
      btn.disabled = false; btn.textContent = 'Save my photo';
    }
  });

  $('photoSignOut').addEventListener('click', async () => {
    await fetchJSON('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.replace('/index.html');
  });
})();
