// The app's public address, in one place.
//
// There is no domain name yet. Today the app answers at Render's address,
// which Render itself puts in RENDER_EXTERNAL_URL. The day a domain is bought,
// PUBLIC_BASE_URL is set to it and every link, search-engine file and setup
// screen follows, with no code change (docs/when-you-have-a-domain.md).
// Nothing else in the app spells out a hostname.
//
// Two different questions, kept apart on purpose:
//
//   chosen()        the address the owner has chosen (PUBLIC_BASE_URL), or ''.
//                   Search engines and canonical links use only this, so they
//                   never point at a stand-in address that will change.
//
//   forLinks(req)   where a link sent OUT of the app (an email, a text, a
//                   share) should point: the chosen address, else Render's.
//                   It is never built from the Host header in production:
//                   that is whatever the sender of the request typed, so
//                   asking for a password reset for somebody else with
//                   "Host: evil.example" would mail them a reset link to
//                   evil.example and hand over the account when they click it.
//                   With nothing configured, production refuses ('') and the
//                   caller says so. Only a developer's machine, where there is
//                   nothing to protect, falls back to the request, and then to
//                   localhost.

// A bare origin: scheme, host and perhaps a port; no path, no trailing slash.
// Only the characters a hostname can have, since the result is written into
// emails, XML and pages as it is.
function clean(value) {
  const v = String(value == null ? '' : value).trim().replace(/\/+$/, '');
  return /^https?:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*(:\d{1,5})?$/i.test(v) ? v : '';
}

function chosen(env = process.env) {
  return clean(env.PUBLIC_BASE_URL);
}

function forLinks(req, env = process.env) {
  const set = clean(env.PUBLIC_BASE_URL) || clean(env.RENDER_EXTERNAL_URL);
  if (set) return set;
  if (env.NODE_ENV === 'production') return '';
  if (req && typeof req.get === 'function' && req.get('host')) return `${req.protocol}://${req.get('host')}`;
  return `http://localhost:${env.PORT || 3000}`;
}

// The Android app's link to the website (Digital Asset Links). It names the
// app's signing key, which only exists once the app is in the Play Console,
// so it comes from the environment as the JSON the Console gives you. Anything
// that is not a JSON list is treated as not set.
function assetLinks(env = process.env) {
  const raw = String(env.ANDROID_ASSET_LINKS || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch (e) {
    return null;
  }
}

// A cookie domain only when one is asked for. Without it the sign-in cookie
// belongs to exactly the address the app is on, which is what we want until
// there is a reason to share it (there is none yet).
function cookieDomain(env = process.env) {
  const v = String(env.COOKIE_DOMAIN || '').trim().toLowerCase();
  return /^\.?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v) ? v : '';
}

// What depends on configuration, what is on, and what each one waits for.
// Shown by /api/health and logged once at start-up. Booleans and names only:
// never a value, a key or an address.
function features({ env = process.env, mailReady = false, pushReady = false } = {}) {
  const linkBase = forLinks(null, { ...env, NODE_ENV: 'production' });
  return {
    publicAddress: {
      on: !!chosen(env),
      using: chosen(env) ? 'PUBLIC_BASE_URL' : (clean(env.RENDER_EXTERNAL_URL) ? 'the Render address' : 'none'),
      needs: 'PUBLIC_BASE_URL'
    },
    linksInMessages: { on: !!linkBase, needs: 'PUBLIC_BASE_URL (or Render\'s own address)' },
    email: { on: !!mailReady, needs: 'SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM' },
    pushNotifications: { on: !!pushReady, needs: 'VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY' },
    searchEngines: { on: !!chosen(env), needs: 'PUBLIC_BASE_URL' },
    androidAppLinks: { on: !!assetLinks(env), needs: 'ANDROID_ASSET_LINKS' },
    sharedCookieDomain: { on: !!cookieDomain(env), needs: 'COOKIE_DOMAIN (leave unset)' }
  };
}

// The ones still waiting, by name. A shared cookie domain is left out: it is
// off on purpose, not waiting for anything.
function waiting(list) {
  return Object.entries(list).filter(([name, f]) => !f.on && name !== 'sharedCookieDomain').map(([name]) => name);
}

module.exports = { clean, chosen, forLinks, assetLinks, cookieDomain, features, waiting };
