// The browser-side rules of the road, in one place so they can be tested and so
// nobody has to hunt through server.js to find out what a page is allowed to load.
//
// What is allowed, and why:
//  - Scripts and styles come from this app. The pages carry a lot of inline script
//    and style, so 'unsafe-inline' is still needed for both; that is a weaker
//    policy than a nonce-based one would be, and the honest limit of this change.
//    What the policy does buy: no script can be pulled in from another host, no
//    page can be framed by another site, nothing can be posted to another site's
//    address, and no plugin runs.
//  - Fonts and pictures come from here (and from https: for pictures, because a
//    chapter may point its logo at its own web address).
//  - The only other companies a page may frame are YouTube (the no-cookie address)
//    and Facebook, and only after a visitor presses a video's button.
const CSP = {
  'default-src': ["'self'"],
  'script-src': ["'self'", "'unsafe-inline'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:', 'https:'],
  'font-src': ["'self'"],
  'media-src': ["'self'", 'blob:'],
  'connect-src': ["'self'"],
  'frame-src': ['https://www.youtube-nocookie.com', 'https://www.facebook.com'],
  'worker-src': ["'self'"],
  'manifest-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'self'"]
};

function cspDirectives(isProd) {
  const d = {};
  Object.keys(CSP).forEach((k) => { d[k] = CSP[k].slice(); });
  if (isProd) d['upgrade-insecure-requests'] = [];
  return d;
}

// What a page may ask the browser's own features to do. The rooms page needs the
// camera and microphone; nothing needs location, payment or sensors.
const PERMISSIONS_POLICY = 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()';

function permissionsPolicy(req, res, next) {
  res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
  next();
}

module.exports = { CSP, cspDirectives, PERMISSIONS_POLICY, permissionsPolicy };
