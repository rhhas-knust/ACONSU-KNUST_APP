// The chapter's Church Timer: a separate app (its own repository and Render
// service) with a phone controller at its link, the TV screen at <link>/tv and
// the branding at <link>/settings. One deployment can serve several churches,
// each at <site>/c/<code>. Here only its link is kept, so the Technical Head's
// portal can open the right screens with one tap.

// What someone pastes, made into the timer's base link: https, no sign-in
// details, and only the site or a church's /c/<code>. A link to one of its
// screens (…/tv, …/display, …/settings) is taken back to the base. '' for
// anything that is not a web address.
function cleanTimerUrl(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let u;
  try { u = new URL(text); } catch (e) { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)) return null;
  const church = u.pathname.match(/^\/c\/([a-z0-9_-]{1,40})(?:\/|$)/i);
  return `https://${u.host.toLowerCase()}${church ? `/c/${church[1].toLowerCase()}` : ''}`;
}

// The screens, from the base link.
function screensOf(base) {
  if (!base) return null;
  const site = new URL(base);
  return {
    controller: base,
    tv: `${base}/tv`,
    settings: `${base}/settings`,
    // The Android TV app installs from the site itself, whichever church.
    apk: `${site.host}/apk`
  };
}

module.exports = { cleanTimerUrl, screensOf };
