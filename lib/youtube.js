// What the Media office needs from YouTube, without a Google account key.
//
//   videoIdOf(link)        the 11-character id in any link people paste:
//                          watch?v=, youtu.be/, /live/, /shorts/, /embed/
//   lookup(link)           a video's title, channel and picture (YouTube's
//                          public oEmbed answer), to fill a form in
//   recentUploads(channel) the channel's latest videos (its public feed:
//                          the 15 newest, a live stream among them once it
//                          is scheduled or on air), to pick from
//
// Both calls go out from the server, so the member's browser never talks to
// YouTube for them, and each gives up after a few seconds: YouTube being slow
// must never hold up a save. Neither is needed for anything to work - a link
// can always be pasted and the title typed.

const TIMEOUT_MS = 6000;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const FEED_CACHE_MS = 5 * 60 * 1000;
const feedCache = new Map();

function videoIdOf(link) {
  const s = String(link || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/^https?:\/\/(?:(?:www|m|music)\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|live\/|shorts\/|embed\/)|youtu\.be\/|youtube-nocookie\.com\/embed\/)([A-Za-z0-9_-]{11})(?:[?&#/]|$)/i);
  return m ? m[1] : '';
}
const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;
const thumbnailOf = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

// "UC..." from a pasted channel address or the id itself; '' when it is not
// one (an @handle needs YouTube to look it up, so it is not accepted here:
// the guide says where the id is found).
function channelIdOf(value) {
  const s = String(value || '').trim();
  if (CHANNEL_ID.test(s)) return s;
  const m = s.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})/i);
  return m ? m[1] : '';
}

async function get(url, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await (fetchImpl || fetch)(url, { signal: ctrl.signal, headers: { 'user-agent': 'ACONSU-app' } });
    return res;
  } finally { clearTimeout(timer); }
}

async function lookup(link, { fetchImpl } = {}) {
  const id = videoIdOf(link);
  if (!id) return { error: 'That is not a YouTube video link.' };
  const base = { videoId: id, url: watchUrl(id), thumbnailUrl: thumbnailOf(id) };
  try {
    const res = await get(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl(id))}`, fetchImpl);
    if (res.status === 401 || res.status === 403) return { ...base, title: '', channel: '', note: 'YouTube will not share this video\'s details. It may be private: make it Public or Unlisted.' };
    if (res.status === 404 || res.status === 400) return { ...base, title: '', channel: '', note: 'YouTube does not know this video. Check the link.' };
    if (!res.ok) return { ...base, title: '', channel: '', note: 'YouTube did not answer. Type the title yourself.' };
    const data = await res.json();
    return { ...base, title: String(data.title || '').slice(0, 200), channel: String(data.author_name || '').slice(0, 120) };
  } catch (e) {
    return { ...base, title: '', channel: '', note: 'YouTube did not answer in time. Type the title yourself.' };
  }
}

const decode = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
  .replace(/&amp;/g, '&');
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)); return m ? decode(m[1]).trim() : ''; };

function parseFeed(xml) {
  const entries = String(xml || '').split('<entry>').slice(1).map((chunk) => chunk.split('</entry>')[0]);
  return entries.map((e) => {
    const videoId = tag(e, 'yt:videoId');
    return {
      videoId,
      title: tag(e, 'title').slice(0, 200),
      published: tag(e, 'published'),
      url: watchUrl(videoId),
      thumbnailUrl: thumbnailOf(videoId)
    };
  }).filter((v) => /^[A-Za-z0-9_-]{11}$/.test(v.videoId));
}

async function recentUploads(channelId, { fetchImpl, fresh } = {}) {
  const id = channelIdOf(channelId);
  if (!id) return { error: 'Add the church\'s YouTube channel ID first (Media Setup).' };
  const cached = feedCache.get(id);
  if (!fresh && cached && Date.now() - cached.at < FEED_CACHE_MS) return { items: cached.items };
  try {
    const res = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, fetchImpl);
    if (res.status === 404) return { error: 'YouTube does not know that channel ID. Check it in Media Setup.' };
    if (!res.ok) return { error: 'YouTube did not answer. Paste the link instead.' };
    const items = parseFeed(await res.text());
    feedCache.set(id, { at: Date.now(), items });
    return { items };
  } catch (e) {
    return { error: 'YouTube did not answer in time. Paste the link instead.' };
  }
}

module.exports = { videoIdOf, channelIdOf, watchUrl, thumbnailOf, lookup, parseFeed, recentUploads, _cache: feedCache };
