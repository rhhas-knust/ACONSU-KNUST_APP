#!/usr/bin/env node
// Brings the church's shared life onto the website as plain files.
//
//   node site/tools/sync-feed.js
//
// Reads this chapter's approved alumni, this week's celebrated alumnus and this
// month's theme from the app, and writes them into the site:
//
//   site/data/feed.json          what the page shows
//   site/images/alumni/<id>.jpg  each alumnus's photo
//   site/images/theme/<id>.jpg   each prayer flyer
//
// WHY THE SITE DOES NOT ASK THE APP ITSELF. The app sleeps on free hosting
// and takes the better part of a minute to wake. A visitor to this site must
// not wait for that, and must not see an empty page if it never wakes. So the
// asking happens here, on a schedule, where waiting a minute costs nobody
// anything; the visitor is only ever served files that are already here.
//
// IF THE APP CANNOT BE REACHED, nothing is changed and nothing fails. The last
// good files stay published - an out-of-date wall is better than no site.
//
// Runs in .github/workflows/pages.yml. Needs Node 18+ (global fetch) and no packages.
//
//   APP_URL   the app's address, e.g. https://aconsu-knust-app.onrender.com
//             (unset: do nothing)
//   SITE_DIR  the site folder to write into (default: the folder above this one)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SITE = process.env.SITE_DIR ? path.resolve(process.env.SITE_DIR) : path.resolve(__dirname, '..');
const APP_URL = String(process.env.APP_URL || '').trim().replace(/\/+$/, '');
const ATTEMPTS = Number(process.env.SYNC_ATTEMPTS) || 3;
const TIMEOUT_MS = Number(process.env.SYNC_TIMEOUT_MS) || 75000; // a sleeping app needs most of a minute
const RETRY_WAIT_MS = Number(process.env.SYNC_RETRY_WAIT_MS) || 5000;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

const FEED = path.join(SITE, 'data', 'feed.json');
const ALUMNI_DIR = path.join(SITE, 'images', 'alumni');
const THEME_DIR = path.join(SITE, 'images', 'theme');

const note = (m) => console.log(m);
const warn = (m) => console.log(`::warning::${m}`);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/; // a file id becomes part of a path; nothing else may

// What this chapter is called in the app. Read from the one file a chapter
// edits, so there is no second place to keep it.
function chapterIdFromSite() {
  try {
    const sandbox = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(SITE, 'chapter.js'), 'utf8'), sandbox, { timeout: 2000 });
    const c = sandbox.window.CHAPTER || {};
    return String((c.alumni && c.alumni.chapterId) || '').trim();
  } catch (e) {
    return '';
  }
}

async function fetchWithTimeout(url, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'aconsu-site-sync' } }); }
  finally { clearTimeout(timer); }
}

async function getFeed(chapterId) {
  const url = `${APP_URL}/api/public/site-feed?chapter=${encodeURIComponent(chapterId)}`;
  let lastError = '';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetchWithTimeout(url, TIMEOUT_MS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const feed = await res.json();
      if (feed && feed.version === 1 && Array.isArray(feed.alumni)) return feed;
      throw new Error('the reply was not a site feed');
    } catch (e) {
      lastError = e.name === 'AbortError' ? `no answer in ${Math.round(TIMEOUT_MS / 1000)}s` : e.message;
      note(`attempt ${attempt}/${ATTEMPTS}: ${lastError}`);
      if (attempt < ATTEMPTS) await new Promise(r => setTimeout(r, RETRY_WAIT_MS));
    }
  }
  throw new Error(lastError);
}

// JPEG, PNG or WebP by its first bytes, whatever the server says it is. An
// error page that arrived with a 200 must never be saved as somebody's photo.
function imageExtension(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.slice(1, 4).toString() === 'PNG') return 'png';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  return '';
}

// Saves one file from the app into dir and returns its path relative to the
// site, or '' if it could not be had. An image already saved is never fetched
// again: a replaced photo has a new id, so a saved one cannot be stale.
async function saveImage(fileId, dir, relDir) {
  if (!ID_RE.test(String(fileId || ''))) return '';
  for (const ext of ['jpg', 'png', 'webp']) {
    if (fs.existsSync(path.join(dir, `${fileId}.${ext}`))) return `${relDir}/${fileId}.${ext}`;
  }
  try {
    const res = await fetchWithTimeout(`${APP_URL}/api/files/${encodeURIComponent(fileId)}`, TIMEOUT_MS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) throw new Error(`${buf.length} bytes is too large`);
    const ext = imageExtension(buf);
    if (!ext) throw new Error('not a JPEG, PNG or WebP picture');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${fileId}.${ext}`), buf);
    return `${relDir}/${fileId}.${ext}`;
  } catch (e) {
    warn(`could not fetch image ${fileId}: ${e.message}`);
    return '';
  }
}

function prune(dir, keepNames) {
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!keepNames.has(f)) { fs.unlinkSync(path.join(dir, f)); removed++; }
  }
  return removed;
}

const str = (v, max) => String(v == null ? '' : v).slice(0, max);

async function main() {
  if (!APP_URL) { note('APP_URL is not set - leaving the alumni and theme as they are.'); return; }
  const chapterId = chapterIdFromSite();
  if (!chapterId) {
    warn('site/chapter.js has no alumni.chapterId, so the alumni cannot be fetched. Add it, or leave alumni out.');
    return;
  }

  let feed;
  try { feed = await getFeed(chapterId); }
  catch (e) {
    warn(`could not reach the app (${e.message}). The alumni and theme on the site stay as they were.`);
    return;
  }

  const keepAlumni = new Set();
  const keepTheme = new Set();
  const photo = async (fileId) => {
    const rel = await saveImage(fileId, ALUMNI_DIR, 'images/alumni');
    if (rel) keepAlumni.add(path.basename(rel));
    return rel;
  };
  // A person on the wall and the same person in the spotlight share one photo.
  const person = async (a) => ({
    id: str(a.id, 64),
    name: str(a.name, 80),
    about: str(a.about, 400),
    currentWork: str(a.currentWork, 120),
    classOf: str(a.classOf, 4),
    photo: await photo(a.imageFileId)
  });

  const out = { version: 1, weekKey: str(feed.weekKey, 12), month: str(feed.month, 7), theme: null, spotlight: null, alumni: [] };

  for (const a of feed.alumni) out.alumni.push(await person(a));
  if (feed.spotlight) out.spotlight = await person(feed.spotlight);

  if (feed.theme && feed.theme.title) {
    const flyers = [];
    for (const id of (feed.theme.flyerFileIds || []).slice(0, 6)) {
      const rel = await saveImage(id, THEME_DIR, 'images/theme');
      if (rel) { keepTheme.add(path.basename(rel)); flyers.push(rel); }
    }
    const prayerFlyers = [];
    for (const id of (feed.theme.prayerFlyerFileIds || []).slice(0, 6)) {
      const rel = await saveImage(id, THEME_DIR, 'images/theme');
      if (rel) { keepTheme.add(path.basename(rel)); prayerFlyers.push(rel); }
    }
    out.theme = {
      month: str(feed.theme.month, 7),
      title: str(feed.theme.title, 120),
      scripture: str(feed.theme.scripture, 200),
      blurb: str(feed.theme.blurb, 1200),
      flyers,
      prayer: str(feed.theme.prayer, 4000),
      prayerNote: str(feed.theme.prayerNote, 200),
      prayerFlyers
    };
  }

  const text = JSON.stringify(out, null, 2) + '\n';
  const before = fs.existsSync(FEED) ? fs.readFileSync(FEED, 'utf8') : '';
  if (before !== text) {
    fs.mkdirSync(path.dirname(FEED), { recursive: true });
    fs.writeFileSync(FEED, text);
  }
  const removed = prune(ALUMNI_DIR, keepAlumni) + prune(THEME_DIR, keepTheme);
  note(`${before === text ? 'unchanged' : 'updated'}: ${out.alumni.length} alumni, `
    + `spotlight ${out.spotlight ? out.spotlight.name : 'none'}, theme ${out.theme ? out.theme.title : 'none'}`
    + (removed ? `, ${removed} old picture(s) removed` : ''));
}

main().catch((e) => {
  // Never fail the publish over this. See the header.
  warn(`alumni sync stopped: ${e.message}`);
});
