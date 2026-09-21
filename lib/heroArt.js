// Hero art — what the top of every page wears.
//
// Two layers, and the second one is optional:
//
//   1. A built-in scene, drawn entirely in CSS. No image is downloaded, so a
//      page on mobile data costs nothing extra to look like something. Every
//      page gets one, chosen to suit what the page is for.
//   2. A picture the chapter uploads for that page, which covers the scene.
//      This is where a designer's artwork lands — the union can dress any page
//      without a deploy, and a chapter that uploads nothing still looks like
//      the app rather than like a blank wall.
//
// Both sides read this file: the server validates uploads and page keys
// against it, and the admin picker is built from it, so the list of pages
// exists once. The scene names match the `[data-art="..."]` rules in
// public/css/style.css.

const SCENES = {
  dawn: 'Sunrise — warm gold breaking over deep purple',
  word: 'Scripture — deep purple with ruled light',
  gather: 'Gathering — soft scattered light, for people and events',
  flame: 'Flame — gold and ember, for prayer and care',
  harvest: 'Harvest — generous gold, for giving',
  voice: 'Voice — resonant bands, for sermons and media',
  calm: 'Calm — quiet lilac, for reading and admin pages'
};

// The `path` is what each page passes to initLayout(), which is how a page
// finds its own art without every page having to name it twice.
const HERO_PAGES = [
  { key: 'home', path: '/index.html', label: 'Home', scene: 'dawn' },
  { key: 'about', path: '/about.html', label: 'About', scene: 'roots' },
  { key: 'bible', path: '/bible.html', label: 'Read the Bible', scene: 'word' },
  { key: 'bible-study', path: '/bible-study.html', label: 'Bible Study', scene: 'word' },
  { key: 'events', path: '/events.html', label: 'Events', scene: 'gather' },
  { key: 'departments', path: '/departments.html', label: 'Departments', scene: 'gather' },
  { key: 'groups', path: '/groups.html', label: 'Groups', scene: 'gather' },
  { key: 'group', path: '/group.html', label: 'A single group', scene: 'gather' },
  { key: 'alumni', path: '/alumni.html', label: 'Alumni Connect', scene: 'gather' },
  { key: 'media', path: '/media.html', label: 'Sermons', scene: 'voice' },
  { key: 'content', path: '/content.html', label: 'Watch & Listen', scene: 'voice' },
  { key: 'meet', path: '/meet.html', label: 'ACONSU Rooms', scene: 'voice' },
  { key: 'chat', path: '/chat.html', label: 'Community Chat', scene: 'gather' },
  { key: 'prayer', path: '/prayer.html', label: 'Prayer Wall', scene: 'flame' },
  { key: 'welfare', path: '/welfare.html', label: 'Welfare', scene: 'flame' },
  { key: 'give', path: '/give.html', label: 'Give', scene: 'harvest' },
  { key: 'contact', path: '/contact.html', label: 'Contact', scene: 'calm' },
  { key: 'notifications', path: '/notifications.html', label: 'Notifications', scene: 'calm' },
  { key: 'privacy', path: '/privacy.html', label: 'Privacy', scene: 'calm' },
  { key: 'page', path: '/page.html', label: 'Custom pages', scene: 'calm' },
  { key: 'not-found', path: '/404.html', label: 'Page not found', scene: 'calm' }
];

// 'roots' is About's own scene; it is listed here rather than in SCENES above
// only because it reads as a variant of 'dawn' — both are described for the
// admin picker the same way.
SCENES.roots = 'Roots — layered depth, for history and identity';

const BY_KEY = new Map(HERO_PAGES.map((p) => [p.key, p]));
const BY_PATH = new Map(HERO_PAGES.map((p) => [p.path, p]));

function pageByKey(key) {
  return BY_KEY.get(String(key || '')) || null;
}

// A page identifies itself by the path it hands initLayout(); a query string
// or a missing leading slash should not stop it finding its own art.
function pageByPath(path) {
  const clean = String(path || '').split('?')[0].split('#')[0];
  const normalised = clean.startsWith('/') ? clean : `/${clean}`;
  return BY_PATH.get(normalised) || null;
}

function isHeroPage(key) {
  return BY_KEY.has(String(key || ''));
}

module.exports = { HERO_PAGES, SCENES, pageByKey, pageByPath, isHeroPage };
