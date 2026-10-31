// The browser-side rules of the road, in one place so they can be tested and so
// nobody has to hunt through server.js to find out what a page is allowed to load.
//
// What is allowed, and why:
//  - Scripts come from this app's own files, and nowhere else: no script
//    written into a page runs, and no onclick= either, so text that slips into
//    a page cannot run as code. The one exception is the few lines every page
//    carries to set light or dark before the page is drawn (it has to run
//    before anything loads), and the offline page's few lines (it is shown when
//    nothing can load), each allowed by its exact fingerprint and nothing else. Every page's own script is a file in public/js/pages/.
//  - Styles still allow 'unsafe-inline': the pages carry a lot of inline style,
//    and a style cannot run code. No script can be pulled in from another host,
//    no page can be framed by another site, nothing can be posted to another
//    site's address, and no plugin runs.
//  - Fonts and pictures come from here (and from https: for pictures, because a
//    chapter may point its logo at its own web address).
//  - The only other companies a page may frame are YouTube (the no-cookie address)
//    and Facebook, and only after a visitor presses a video's button.
// sha256 of the theme snippet at the top of every page (the text between
// <script> and </script>, exactly). test/csp.js fails if any page carries an
// inline script with another fingerprint, or this one changes without it.
const THEME_SCRIPT_HASH = "'sha256-WE7CuYOAUQEu6uFqEPUgiiJAILnStvVs3HuobN3bNUE='";
// The offline page's own few lines: it is shown when the network has gone, so
// it cannot count on loading a file, and carries its script inline too.
const OFFLINE_SCRIPT_HASH = "'sha256-NMqiv5jyiFk2jUkBdT5zoayg0/TWEzjljIeiHE8QDdc='";

const CSP = {
  'default-src': ["'self'"],
  'script-src': ["'self'", THEME_SCRIPT_HASH, OFFLINE_SCRIPT_HASH],
  // No onclick= and the like, anywhere.
  'script-src-attr': ["'none'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:', 'https:'],
  'font-src': ["'self'"],
  'media-src': ["'self'", 'blob:'],
  'connect-src': ["'self'"],
  // Google for the map of a meeting place, which loads only when someone asks for it.
  'frame-src': ['https://www.youtube-nocookie.com', 'https://www.facebook.com', 'https://www.google.com', 'https://maps.google.com'],
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

module.exports = { CSP, THEME_SCRIPT_HASH, OFFLINE_SCRIPT_HASH, cspDirectives, PERMISSIONS_POLICY, permissionsPolicy };
