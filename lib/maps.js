// Map links for the places people go: the chapter's meeting place, an event's
// venue, where a department or a group meets.
//
// A chapter pastes the link its members already share (Google Maps' "Share"
// gives https://maps.app.goo.gl/...). Three things are done with it:
//   1. It is checked: only a map service's own address is accepted, so a link
//      on the page can never lead somewhere else, or run as script.
//   2. The exact spot is read from it, when it carries one, so the app can show
//      the map itself. A short share link does not, so it is followed (to map
//      services only, never anywhere else) to the full link that does.
//   3. The page offers "Open in Maps" (the link as given) and, on request,
//      the map inside the app.

const MAX_LENGTH = 1200; // an embed link is long

// Hosts a map link may point at. Google's are recognised by path as well,
// since google.com serves far more than maps.
function isMapHost(u) {
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();
  if (host === 'maps.app.goo.gl') return true;
  if (host === 'goo.gl' && path.startsWith('/maps')) return true;
  if (host === 'maps.google.com' || /^maps\.google\.[a-z.]{2,8}$/.test(host)) return true;
  if (/^(www\.)?google\.[a-z.]{2,8}$/.test(host) && path.startsWith('/maps')) return true;
  if (host === 'maps.apple.com') return true;
  if (host === 'www.openstreetmap.org' || host === 'openstreetmap.org' || host === 'osm.org') return true;
  return false;
}

// '' stays ''; anything else must be a map service's own https address.
function cleanMapUrl(raw) {
  const text = String(extractEmbedSrc(raw == null ? '' : raw)).trim();
  if (!text) return { value: '' };
  if (text.length > MAX_LENGTH) return { error: 'That map link is too long. Use the Share link from your maps app.' };
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`); } catch (e) {
    return { error: 'That is not a link. Paste the Share link from Google Maps (it starts https://maps.app.goo.gl/).' };
  }
  if (u.protocol === 'http:') u.protocol = 'https:';
  if (u.protocol !== 'https:' || u.username || u.password || !isMapHost(u)) {
    return { error: 'Only a Google Maps, Apple Maps or OpenStreetMap link can be used here. In Google Maps, press Share and copy the link.' };
  }
  return { value: u.toString() };
}

const inRange = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
const pair = (a, b) => { const lat = Number(a); const lng = Number(b); return inRange(lat, lng) ? { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 } : null; };

// The spot a full map link points at, or null when it does not say.
function coordsFromMapUrl(raw) {
  let text = String(raw || '');
  try { text = decodeURIComponent(text); } catch (e) { /* use as is */ }
  const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';
  // Google's place marker is the most exact: !3d<lat>!4d<lng>
  let m = text.match(new RegExp(`!3d${NUM}!4d${NUM}`));
  if (m) return pair(m[1], m[2]);
  // Explicit coordinates in the query: q=, ll=, query=, destination=, center=, sll=
  m = text.match(new RegExp(`[?&](?:q|ll|sll|query|destination|daddr|center)=${NUM},\\s*${NUM}`));
  if (m) return pair(m[1], m[2]);
  // OpenStreetMap: mlat/mlon, or #map=zoom/lat/lng
  m = text.match(new RegExp(`[?&]mlat=${NUM}&mlon=${NUM}`));
  if (m) return pair(m[1], m[2]);
  m = text.match(new RegExp(`#map=\\d+/${NUM}/${NUM}`));
  if (m) return pair(m[1], m[2]);
  // Google's viewport: /@<lat>,<lng>,<zoom>z
  m = text.match(new RegExp(`/@${NUM},${NUM}`));
  if (m) return pair(m[1], m[2]);
  return null;
}

// What the app needs to draw the map: an embed link Google gave for it, the
// exact spot, or the place's name to search for. Read from the link alone.
function placeFromMapUrl(raw) {
  let u;
  try { u = new URL(raw); } catch (e) { return null; }
  if (/(^|\.)google\.[a-z.]+$/.test(u.hostname) && u.pathname.startsWith('/maps/embed')) return { embed: u.toString() };
  const coords = coordsFromMapUrl(raw);
  if (coords) return coords;
  const q = u.searchParams.get('q') || u.searchParams.get('query') || u.searchParams.get('destination') || u.searchParams.get('daddr');
  // Numbers that are not a place on Earth are not something to search for either.
  if (q && /^\s*-?[\d.]+\s*,\s*-?[\d.]+\s*$/.test(q)) return null;
  if (q && q.trim() && !/^https?:/i.test(q)) return { query: q.trim().slice(0, 200) };
  const place = u.pathname.match(/\/maps\/place\/([^/]+)/);
  if (place) return { query: decodeURIComponent(place[1].replace(/\+/g, ' ')).slice(0, 200) };
  return null;
}

// Follow a short share link to the full one, one hop at a time, and only while
// every hop stays on a map service: a link that redirects anywhere else is
// dropped, so pasting a link can never make the server fetch an arbitrary
// address. Returns what placeFromMapUrl would for the full link, or null.
async function resolveMapPlace(url, opts) {
  const o = opts || {};
  const fetchImpl = o.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const direct = placeFromMapUrl(url);
  if (direct || !fetchImpl) return direct;
  let current = url;
  for (let hop = 0; hop < 6; hop += 1) {
    let u;
    try { u = new URL(current); } catch (e) { return null; }
    if (u.protocol !== 'https:' || !isMapHost(u)) return null;
    const found = placeFromMapUrl(current);
    if (found) return found;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), o.timeoutMs || 5000) : null;
    let res;
    try {
      res = await fetchImpl(current, { redirect: 'manual', signal: controller ? controller.signal : undefined, headers: { 'user-agent': 'Mozilla/5.0 (ACONSU app; map link check)' } });
    } catch (e) {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
    const next = res.headers && typeof res.headers.get === 'function' ? res.headers.get('location') : null;
    if (res.status >= 300 && res.status < 400 && next) {
      current = new URL(next, current).toString();
      continue;
    }
    // Some short links answer with the page itself; the full link is in it.
    if (res.status === 200 && typeof res.text === 'function') {
      const body = (await res.text().catch(() => '')).slice(0, 200000);
      const link = body.match(/https:\/\/www\.google\.[a-z.]+\/maps\/[^"'\s<>]+/);
      return link ? placeFromMapUrl(link[0]) : null;
    }
    return null;
  }
  return null;
}

// A pasted "Embed a map" snippet is a whole <iframe>; the link is its src.
function extractEmbedSrc(raw) {
  const m = String(raw || '').match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i);
  return m ? m[1].replace(/&amp;/g, '&') : raw;
}

module.exports = { cleanMapUrl, coordsFromMapUrl, placeFromMapUrl, resolveMapPlace, isMapHost, MAX_LENGTH };
