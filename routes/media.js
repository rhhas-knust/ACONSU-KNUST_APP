// The Media office: the live stream of the service, and the sermons.
//
// The service is streamed on YouTube (a phone or a laptop, see the guide in the
// Media portal). This is the control room around it: say the stream is coming,
// say it is on (the app shows a "Live now" banner and members get a push
// alert), end it, and keep the recording as that Sunday's sermon in one step.
// Everything is one chapter's: a Media account reaches its own chapter only.
//
// The Media Head and the Assistant Media Head open it with their office sign-in
// (POSITION_OPENS_OFFICE in server.js); a chapter admin can make Media accounts
// for volunteers, and keeps the sermons and the live stream as a backup.

const youtube = require('../lib/youtube');

const LIVE_KIND = 'live_service';
// Forgotten to press End: after this long a stream no longer says "Live now".
const LIVE_STALE_MS = 6 * 60 * 60 * 1000;
const CHECKLIST_KEYS = [
  'internet', 'battery', 'audio', 'camera', 'slides', 'title', 'golive', 'share',
  'watch', 'chat', 'end', 'sermon', 'pack'
];

const oneLine = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const multiline = (v, max) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
// A link people can follow: https only, so nothing else (javascript:, data:)
// ever reaches a page as a link.
function safeLink(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u.toString().slice(0, 500) : null;
  } catch (e) { return null; }
}
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const dayOf = (d) => new Date(d).toISOString().slice(0, 10);

function registerMediaRoutes(app, deps) {
  const { repo, hasRole, isChapterAdminOrAbove, resolveChapterIdForWrite, createNotification, actorName, contentChapterFilter, featureModules } = deps;

  const mayRun = (req) => isChapterAdminOrAbove(req) || hasRole(req, 'media');
  const requireMedia = (req, res, next) => (mayRun(req) ? next() : res.status(401).json({ error: 'Not authenticated' }));
  // Which chapter: a Media account's own, always; the main admin's choice.
  async function chapterOf(req, res) {
    const chapterId = await resolveChapterIdForWrite(req, (req.query && req.query.chapterId) || (req.body && req.body.chapterId));
    if (!chapterId) { res.status(400).json({ error: 'Choose a chapter first.' }); return null; }
    return chapterId;
  }
  const deskOf = async (chapterId) => (await repo.getAll('mediaDesks', { chapterId }))[0] || null;
  const streamsOf = async (chapterId) => (await repo.getAll('contentItems', { chapterId, kind: LIVE_KIND }))
    .filter((s) => s.liveState)
    .sort((a, b) => new Date(b.startsAt || b.createdAt) - new Date(a.startsAt || a.createdAt));
  const streamOf = async (chapterId, id) => {
    const s = await repo.getById('contentItems', id, { chapterId });
    return s && s.kind === LIVE_KIND ? s : null;
  };
  const isOnAir = (s) => s.liveState === 'live' && !(s.wentLiveAt && Date.now() - new Date(s.wentLiveAt).getTime() > LIVE_STALE_MS);
  const announce = (chapterId, s) => createNotification(
    `We are live: ${s.title}`,
    'The service has started. Tap to join it in the app.',
    '/content.html?kind=live_service', 'media', chapterId
  ).catch(() => {});

  // ---------- the office's front page ----------
  app.get('/api/media/overview', requireMedia, async (req, res) => {
    try {
      const chapterId = await chapterOf(req, res);
      if (!chapterId) return;
      const [desk, streams, sermons] = await Promise.all([deskOf(chapterId), streamsOf(chapterId), repo.getAll('sermons', { chapterId })]);
      const today = dayOf(Date.now());
      sermons.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || new Date(b.createdAt) - new Date(a.createdAt));
      res.json({
        chapterId,
        setup: {
          youtubeChannelId: (desk && desk.youtubeChannelId) || '',
          serviceTitle: (desk && desk.serviceTitle) || 'Sunday Service'
        },
        live: streams.find(isOnAir) || null,
        upcoming: streams.filter((s) => s.liveState === 'upcoming').sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)),
        // Ended streams not yet kept as a sermon: the job left over.
        toKeep: streams.filter((s) => (s.liveState === 'ended' || (s.liveState === 'live' && !isOnAir(s))) && !s.sermonId).slice(0, 5),
        recent: streams.filter((s) => s.liveState === 'ended').slice(0, 5),
        sermons: { count: sermons.length, latest: sermons[0] || null },
        checklist: { date: today, done: desk && desk.checklistDate === today ? desk.checklistDone : [] }
      });
    } catch (e) { res.status(500).json({ error: 'Could not load the Media office' }); }
  });

  // ---------- setup: the church's YouTube channel ----------
  app.put('/api/media/setup', requireMedia, async (req, res) => {
    try {
      const chapterId = await chapterOf(req, res);
      if (!chapterId) return;
      const raw = String(req.body.youtubeChannel || '').trim();
      const channelId = youtube.channelIdOf(raw);
      if (raw && !channelId) {
        return res.status(400).json({ error: 'That is not a channel ID. It starts with UC and has 24 letters and numbers: YouTube Studio, Settings, Channel, Advanced settings.' });
      }
      const fields = {
        youtubeChannelId: channelId,
        youtubeChannelUrl: channelId ? `https://www.youtube.com/channel/${channelId}` : '',
        serviceTitle: oneLine(req.body.serviceTitle, 80) || 'Sunday Service',
        updatedBy: actorName(req)
      };
      const desk = await deskOf(chapterId);
      const item = desk
        ? await repo.patchById('mediaDesks', desk.id, fields, { chapterId })
        : await repo.create('mediaDesks', { chapterId, ...fields }, 'media');
      youtube._cache.clear();
      res.json({ success: true, item });
    } catch (e) { res.status(500).json({ error: 'Could not save the setup' }); }
  });

  // ---------- YouTube, to fill the forms in ----------
  app.get('/api/media/youtube/lookup', requireMedia, async (req, res) => {
    const out = await youtube.lookup(req.query.url);
    if (out.error) return res.status(400).json(out);
    res.json(out);
  });

  app.get('/api/media/youtube/recent', requireMedia, async (req, res) => {
    try {
      const chapterId = await chapterOf(req, res);
      if (!chapterId) return;
      const desk = await deskOf(chapterId);
      const out = await youtube.recentUploads(desk && desk.youtubeChannelId, { fresh: req.query.fresh === '1' });
      if (out.error) return res.json({ items: [], error: out.error });
      const sermons = await repo.getAll('sermons', { chapterId });
      const kept = new Set(sermons.map((s) => s.videoId || youtube.videoIdOf(s.url)).filter(Boolean));
      res.json({ items: out.items.map((v) => ({ ...v, isSermon: kept.has(v.videoId) })) });
    } catch (e) { res.json({ items: [], error: 'Could not read the channel.' }); }
  });

  // ---------- the live stream ----------
  function streamFields(req, existing) {
    const title = oneLine(req.body.title, 120);
    if (!title) return { error: 'Give the stream a title, for example "Sunday Service".' };
    const url = String(req.body.url || '').trim();
    const videoId = youtube.videoIdOf(url);
    if (!videoId) return { error: 'Paste the YouTube link of the stream (YouTube Studio, the stream, Share).' };
    let startsAt = existing ? existing.startsAt : null;
    if (req.body.startsAt !== undefined && req.body.startsAt !== '') {
      const d = new Date(req.body.startsAt);
      if (Number.isNaN(d.getTime())) return { error: 'That start time could not be read.' };
      startsAt = d;
    }
    const link = youtube.watchUrl(videoId);
    return {
      fields: {
        title, previewUrl: link, resourceUrl: link,
        summary: oneLine(req.body.preacher, 120),
        body: multiline(req.body.notes, 1000),
        startsAt: startsAt || new Date(),
        eventDate: dayOf(startsAt || new Date())
      }
    };
  }

  app.post('/api/media/live', requireMedia, async (req, res) => {
    try {
      const chapterId = await chapterOf(req, res);
      if (!chapterId) return;
      const out = streamFields(req, null);
      if (out.error) return res.status(400).json({ error: out.error });
      const now = req.body.when !== 'later';
      if (!now && !(new Date(out.fields.startsAt).getTime() > Date.now())) {
        return res.status(400).json({ error: 'A stream for later needs a start time that is still ahead.' });
      }
      const streams = await streamsOf(chapterId);
      if (now && streams.some(isOnAir)) return res.status(409).json({ error: 'A stream is already live. End it first.' });
      const item = await repo.create('contentItems', {
        chapterId, kind: LIVE_KIND, ...out.fields,
        imageFileId: '', resourceFileId: '', category: '', published: true, featured: false, sortOrder: 0,
        liveState: now ? 'live' : 'upcoming',
        wentLiveAt: now ? new Date() : null,
        startsAt: now ? new Date() : out.fields.startsAt,
        createdBy: actorName(req)
      }, 'content');
      res.json({ success: true, item });
      if (now && req.body.notify !== false) announce(chapterId, item);
    } catch (e) { res.status(500).json({ error: 'Could not start the stream' }); }
  });

  app.put('/api/media/live/:id', requireMedia, async (req, res) => {
    try {
      const chapterId = await chapterOf(req, res);
      if (!chapterId) return;
      const existing = await streamOf(chapterId, req.params.id);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      const out = streamFields(req, existing);
      if (out.error) return res.status(400).json({ error: out.error });
      const item = await repo.patchById('contentItems', existing.id, out.fields, { chapterId });
      res.json({ success: true, item });
    } catch (e) { res.status(500).json({ error: 'Could not save the stream' }); }
  });

  // Upcoming to live: the moment the service starts.
  app.post('/api/media/live/:id/start', requireMedia, async (req, res) => {
    try {
      const chapterId = await chapterOf(req, res);
      if (!chapterId) return;
      const existing = await streamOf(chapterId, req.params.id);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      if (existing.liveState !== 'upcoming') return res.status(400).json({ error: 'Only a stream that is coming up can go live.' });
      if ((await streamsOf(chapterId)).some(isOnAir)) return res.status(409).json({ error: 'A stream is already live. End it first.' });
      const item = await repo.patchById('contentItems', existing.id, { liveState: 'live', wentLiveAt: new Date(), eventDate: dayOf(Date.now()) }, { chapterId });
      res.json({ success: true, item });
      if (req.body.notify !== false) announce(chapterId, item);
    } catch (e) { res.status(500).json({ error: 'Could not start the stream' }); }
  });

  app.post('/api/media/live/:id/end', requireMedia, async (req, res) => {
    try {
      const chapterId = await chapterOf(req, res);
      if (!chapterId) return;
      const existing = await streamOf(chapterId, req.params.id);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      if (existing.liveState !== 'live') return res.status(400).json({ error: 'That stream is not live.' });
      const item = await repo.patchById('contentItems', existing.id, { liveState: 'ended', endedAt: new Date() }, { chapterId });
      res.json({ success: true, item });
    } catch (e) { res.status(500).json({ error: 'Could not end the stream' }); }
  });

  app.delete('/api/media/live/:id', requireMedia, async (req, res) => {
    try {
      const chapterId = await chapterOf(req, res);
      if (!chapterId) return;
      const existing = await streamOf(chapterId, req.params.id);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      if (existing.liveState === 'live' && isOnAir(existing)) return res.status(400).json({ error: 'End the stream before removing it.' });
      await repo.removeById('contentItems', existing.id, { chapterId });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Could not remove the stream' }); }
  });

  // The recording, kept as the day's sermon in one step.
  app.post('/api/media/live/:id/sermon', requireMedia, async (req, res) => {
    try {
      const chapterId = await chapterOf(req, res);
      if (!chapterId) return;
      const stream = await streamOf(chapterId, req.params.id);
      if (!stream) return res.status(404).json({ error: 'Not found' });
      if (stream.sermonId) return res.status(409).json({ error: 'That stream is already kept as a sermon.' });
      const videoId = youtube.videoIdOf(stream.previewUrl);
      const sermon = await repo.create('sermons', {
        chapterId,
        title: oneLine(req.body.title, 160) || stream.title,
        speaker: oneLine(req.body.speaker, 120) || stream.summary || '',
        date: isDay(req.body.date) ? req.body.date : (stream.eventDate || dayOf(stream.startsAt || Date.now())),
        type: 'video',
        url: stream.previewUrl,
        description: multiline(req.body.description, 2000),
        videoId, thumbnailUrl: videoId ? youtube.thumbnailOf(videoId) : '',
        fromLiveId: stream.id
      }, 'serm');
      await repo.patchById('contentItems', stream.id, { sermonId: sermon.id }, { chapterId });
      res.json({ success: true, item: sermon });
      if (req.body.notify === true) {
        createNotification(`New Sermon: ${sermon.title}`, `${sermon.speaker ? `${sermon.speaker}: ` : ''}${sermon.title} is now available.`, '/media.html', 'system', chapterId).catch(() => {});
      }
    } catch (e) { res.status(500).json({ error: 'Could not keep the sermon' }); }
  });

  // ---------- the sermons ----------
  function sermonFields(body) {
    const title = oneLine(body.title, 160);
    if (!title) return { error: 'A sermon needs a title.' };
    const url = safeLink(body.url);
    if (url === null) return { error: 'The link must be a full web address that starts with https://' };
    const videoId = youtube.videoIdOf(url);
    return {
      fields: {
        title,
        speaker: oneLine(body.speaker, 120),
        date: isDay(body.date) ? body.date : dayOf(Date.now()),
        type: body.type === 'audio' ? 'audio' : 'video',
        url,
        description: multiline(body.description, 2000),
        videoId, thumbnailUrl: videoId ? youtube.thumbnailOf(videoId) : ''
      }
    };
  }

  app.get('/api/media/sermons', requireMedia, async (req, res) => {
    try {
      const chapterId = await chapterOf(req, res);
      if (!chapterId) return;
      const items = await repo.getAll('sermons', { chapterId });
      items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || new Date(b.createdAt) - new Date(a.createdAt));
      res.json(items);
    } catch (e) { res.status(500).json({ error: 'Could not load the sermons' }); }
  });

  app.post('/api/media/sermons', requireMedia, async (req, res) => {
    try {
      const chapterId = await chapterOf(req, res);
      if (!chapterId) return;
      const out = sermonFields(req.body || {});
      if (out.error) return res.status(400).json({ error: out.error });
      if (out.fields.videoId) {
        const twin = (await repo.getAll('sermons', { chapterId })).find((s) => (s.videoId || youtube.videoIdOf(s.url)) === out.fields.videoId);
        if (twin) return res.status(409).json({ error: `That video is already a sermon: ${twin.title}.` });
      }
      const item = await repo.create('sermons', { chapterId, ...out.fields, fromLiveId: '' }, 'serm');
      res.json({ success: true, item });
      if (req.body.notify !== false) {
        createNotification(`New Sermon: ${item.title}`, `${item.speaker ? `${item.speaker}: ` : ''}${item.title} is now available.`, '/media.html', 'system', chapterId).catch(() => {});
      }
    } catch (e) { res.status(500).json({ error: 'Could not save the sermon' }); }
  });

  app.put('/api/media/sermons/:id', requireMedia, async (req, res) => {
    try {
      const chapterId = await chapterOf(req, res);
      if (!chapterId) return;
      const existing = await repo.getById('sermons', req.params.id, { chapterId });
      if (!existing) return res.status(404).json({ error: 'Not found' });
      const out = sermonFields(req.body || {});
      if (out.error) return res.status(400).json({ error: out.error });
      const item = await repo.patchById('sermons', existing.id, out.fields, { chapterId });
      res.json({ success: true, item });
    } catch (e) { res.status(500).json({ error: 'Could not save the sermon' }); }
  });

  app.delete('/api/media/sermons/:id', requireMedia, async (req, res) => {
    try {
      const chapterId = await chapterOf(req, res);
      if (!chapterId) return;
      const existing = await repo.getById('sermons', req.params.id, { chapterId });
      if (!existing) return res.status(404).json({ error: 'Not found' });
      await repo.removeById('sermons', existing.id, { chapterId });
      if (existing.fromLiveId) {
        const stream = await streamOf(chapterId, existing.fromLiveId).catch(() => null);
        if (stream && stream.sermonId === existing.id) await repo.patchById('contentItems', stream.id, { sermonId: '' }, { chapterId });
      }
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Could not remove the sermon' }); }
  });

  // ---------- this Sunday's checklist, shared by the team ----------
  app.put('/api/media/checklist', requireMedia, async (req, res) => {
    try {
      const chapterId = await chapterOf(req, res);
      if (!chapterId) return;
      const done = (Array.isArray(req.body.done) ? req.body.done : []).filter((k) => CHECKLIST_KEYS.includes(k));
      const fields = { checklistDate: dayOf(Date.now()), checklistDone: [...new Set(done)], updatedBy: actorName(req) };
      const desk = await deskOf(chapterId);
      if (desk) await repo.patchById('mediaDesks', desk.id, fields, { chapterId });
      else await repo.create('mediaDesks', { chapterId, ...fields }, 'media');
      res.json({ success: true, checklist: { date: fields.checklistDate, done: fields.checklistDone } });
    } catch (e) { res.status(500).json({ error: 'Could not save the checklist' }); }
  });

  // ---------- for everyone: is the service on now? ----------
  app.get('/api/live', async (req, res) => {
    try {
      const modules = await featureModules();
      if (!modules.liveStreaming) return res.json({ live: null, next: null });
      const scope = contentChapterFilter(req);
      const chapterPart = scope.chapterId ? { $or: [{ chapterId: scope.chapterId }, { chapterId: '' }] } : {};
      const streams = (await repo.getAll('contentItems', { ...chapterPart, kind: LIVE_KIND, published: true })).filter((s) => s.liveState);
      const pick = (s) => s && ({ id: s.id, title: s.title, preacher: s.summary || '', url: s.previewUrl, startsAt: s.startsAt, wentLiveAt: s.wentLiveAt, liveState: s.liveState });
      const live = streams.filter(isOnAir).sort((a, b) => new Date(b.wentLiveAt) - new Date(a.wentLiveAt))[0] || null;
      const next = streams.filter((s) => s.liveState === 'upcoming' && new Date(s.startsAt).getTime() > Date.now() - 60 * 60 * 1000)
        .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))[0] || null;
      res.json({ live: pick(live), next: pick(next) });
    } catch (e) { res.json({ live: null, next: null }); }
  });

  return { requireMedia, CHECKLIST_KEYS };
}

module.exports = { registerMediaRoutes, CHECKLIST_KEYS };
