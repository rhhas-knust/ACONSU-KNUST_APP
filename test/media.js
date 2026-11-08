// The Media office: who gets in (the Media Head, the Assistant, a Media
// volunteer account, the chapter admin as a backup; not Publicity, not
// a member), the live stream from "coming up" to "live" to kept as a sermon,
// the sermons, the shared Sunday checklist, YouTube's answers (stubbed here),
// and that Publicity no longer posts live services.
//
//   node test/media.js     (also run by `npm test`)
const { fakeModels } = require('./harness.js');
const youtube = require('../lib/youtube');

(async () => {
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/aconsu_media', PORT: '4372', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 'test', LOGIN_RATE_LIMIT_MAX: '300' });
  delete process.env.SHEPHERD_USERNAME;

  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 600)}` : ''}`); }
  }

  // YouTube, answered here.
  const CHANNEL = 'UCabcdefghijklmnopqrstuv';
  const VID = 'dQw4w9WgXcQ';
  const OLD = 'oHg5SJYRHA0';
  const asked = [];
  const passOn = global.fetch;
  global.fetch = (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://www.youtube.com/oembed')) {
      asked.push(u);
      if (u.includes('privatevid1')) return Promise.resolve(new Response('Unauthorized', { status: 401 }));
      return Promise.resolve(new Response(JSON.stringify({ title: 'Sunday Service | Walking in Newness', author_name: 'ACONSU KNUST' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    }
    if (u.startsWith('https://www.youtube.com/feeds/videos.xml')) {
      asked.push(u);
      if (!u.includes(CHANNEL)) return Promise.resolve(new Response('', { status: 404 }));
      const entry = (id, title) => `<entry><id>yt:video:${id}</id><yt:videoId>${id}</yt:videoId><title>${title}</title><published>2026-11-01T10:00:00+00:00</published></entry>`;
      return Promise.resolve(new Response(`<?xml version="1.0"?><feed>${entry(VID, 'Sunday Service &amp; Communion')}${entry(OLD, 'Bible Study')}</feed>`, { status: 200 }));
    }
    return passOn(url, opts);
  };

  console.log('\n== YouTube links ==');
  check('every kind of link people paste gives the video', [
    `https://www.youtube.com/watch?v=${VID}`, `https://youtu.be/${VID}?si=abc`, `https://www.youtube.com/live/${VID}?feature=share`,
    `https://m.youtube.com/watch?feature=x&v=${VID}`, `https://www.youtube.com/shorts/${VID}`, VID
  ].every(l => youtube.videoIdOf(l) === VID));
  check('and anything else gives nothing', ['https://example.com/watch?v=dQw4w9WgXcQ', 'javascript:alert(1)', '', 'https://www.youtube.com/@aconsu'].every(l => youtube.videoIdOf(l) === ''));
  check('a channel ID is read from itself or its address, never from an @handle', youtube.channelIdOf(CHANNEL) === CHANNEL && youtube.channelIdOf(`https://www.youtube.com/channel/${CHANNEL}`) === CHANNEL && youtube.channelIdOf('@aconsuknust') === '');

  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4372';
  const jars = {};
  async function call(jar, method, p, body) {
    const h = { 'X-Chapter-Id': 'aconsu-knust' };
    if (jar && jars[jar]) h.cookie = jars[jar];
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + p, { method, headers: h, body: payload });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (jar && sc.length) jars[jar] = sc.map(c => c.split(';')[0]).join('; ');
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = text; }
    return { status: res.status, data };
  }
  const C = 'aconsu-knust';
  await call('admin', 'POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  await call('admin', 'POST', '/api/national/chapters', { id: C, name: 'ACONSU-KNUST', institution: 'KNUST' });
  const dept = (await call('admin', 'POST', '/api/admin/departments', { name: 'Media', description: 'Sound, cameras and the stream', chapterId: C })).data.item;
  let n = 0;
  async function person(name, account) {
    n += 1;
    const f = new FormData();
    f.append('profileImage', new Blob([Buffer.from(name)], { type: 'image/png' }), 'me.png');
    Object.entries({ name, email: `p${n}@example.com`, phone: `02440011${String(n).padStart(2, '0')}`, password: 'secret123', chapterId: C, consent: 'true' }).forEach(([k, v]) => f.append(k, v));
    const res = await fetch(BASE + '/api/auth/register', { method: 'POST', body: f });
    const jar = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const id = (await res.json()).member.id;
    if (account) {
      const made = await call('admin', 'POST', '/api/admin/staff', { ...account, memberId: id, chapterId: C, password: 'Start-Pass-12345' });
      if (made.status !== 200) console.log('   (could not make the account)', JSON.stringify(made.data).slice(0, 200));
    }
    return jar;
  }
  jars.headMember = await person('Kofi Media', { username: 'mediahead.knust', name: 'Kofi Media', role: 'executive', positionKey: 'media_head', executiveDepartment: dept && dept.id, department: dept && dept.id });
  jars.volMember = await person('Ama Camera', { username: 'ama.media', name: 'Ama Camera', role: 'media' });
  await person('Esi Publicity', { username: 'esi.pub', name: 'Esi Publicity', role: 'publicity' });
  jars.member = await person('Plain Member');
  fakeModels.StaffUser._docs.forEach(a => { a.mustChangePassword = false; a.mustSetUpSecondStep = false; });
  const signIn = (jar, username) => call(jar, 'POST', '/api/portal/login', { username, password: 'Start-Pass-12345', chapterId: C });
  await signIn('head', 'mediahead.knust');
  await signIn('vol', 'ama.media');
  await signIn('pub', 'esi.pub');

  console.log('\n== who gets in ==');
  let r = await call('head', 'GET', '/api/portal/me');
  check('the Media Head opens the Media portal with their office sign-in', r.data.access && r.data.access.media && r.data.access.media.view && r.data.access.media.edit, r.data.access && r.data.access.media);
  r = await call('vol', 'GET', '/api/portal/me');
  check('so does a Media volunteer account the chapter admin made', r.data.access.media.view && r.data.access.media.edit);
  r = await call('pub', 'GET', '/api/portal/me');
  check('Publicity does not', r.data.access.media.view === false);
  r = await call('headMember', 'GET', '/api/auth/me');
  check('the Media Head\'s own profile links them straight to the Media Office', (r.data.member.portals || []).some(p => p.label === 'Media Office' && p.href === '/media-portal.html?as=mediahead.knust'), r.data.member.portals);
  r = await call('pub', 'GET', '/api/media/overview');
  check('Publicity cannot read the Media office', r.status === 401);
  r = await call('member', 'GET', '/api/media/overview');
  check('nor can a member', r.status === 401);
  r = await call('head', 'GET', '/api/media/overview');
  check('the Media Head reads their chapter\'s office', r.status === 200 && r.data.chapterId === C && r.data.live === null, r.data);

  console.log('\n== setup ==');
  r = await call('head', 'PUT', '/api/media/setup', { youtubeChannel: '@aconsuknust' });
  check('an @handle is refused, and it says where the channel ID is', r.status === 400 && /Advanced settings/.test(r.data.error), r.data);
  r = await call('head', 'PUT', '/api/media/setup', { youtubeChannel: `https://www.youtube.com/channel/${CHANNEL}`, serviceTitle: 'Sunday Service' });
  check('the channel address is read for its ID', r.status === 200 && r.data.item.youtubeChannelId === CHANNEL, r.data);
  r = await call('head', 'GET', '/api/media/youtube/recent');
  check('the channel\'s latest videos are listed to pick from', r.status === 200 && r.data.items.length === 2 && r.data.items[0].videoId === VID && r.data.items[0].title === 'Sunday Service & Communion' && r.data.items[0].isSermon === false, r.data);
  r = await call('head', 'GET', `/api/media/youtube/lookup?url=${encodeURIComponent(`https://youtu.be/${VID}`)}`);
  check('a pasted link fills in the title and picture', r.status === 200 && r.data.title === 'Sunday Service | Walking in Newness' && r.data.thumbnailUrl === `https://i.ytimg.com/vi/${VID}/hqdefault.jpg`, r.data);
  r = await call('head', 'GET', '/api/media/youtube/lookup?url=https%3A%2F%2Fyoutu.be%2Fprivatevid1');
  check('a private video says to make it Public or Unlisted', r.status === 200 && /Public or Unlisted/.test(r.data.note || ''), r.data);
  r = await call('head', 'GET', '/api/media/youtube/lookup?url=https%3A%2F%2Fexample.com');
  check('a link that is not YouTube is refused', r.status === 400);

  console.log('\n== the stream ==');
  const notes = () => fakeModels.Notification._docs.filter(x => /We are live/.test(x.title));
  const soon = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  r = await call('head', 'POST', '/api/media/live', { title: 'Sunday Service', url: `https://www.youtube.com/live/${VID}`, when: 'later', startsAt: soon, preacher: 'Rev. Mensah' });
  check('a stream is set up ahead for later', r.status === 200 && r.data.item.liveState === 'upcoming', r.data);
  const sid = r.data.item.id;
  r = await call(null, 'GET', '/api/live');
  check('the app knows it is coming, and nothing is live yet', r.data.live === null && r.data.next && r.data.next.id === sid && r.data.next.preacher === 'Rev. Mensah', r.data);
  check('nobody is told yet', notes().length === 0);
  r = await call('head', 'POST', '/api/media/live', { title: 'Sunday Service', url: 'https://example.com/stream' });
  check('a stream needs a YouTube link', r.status === 400 && /YouTube link/.test(r.data.error), r.data);
  r = await call('vol', 'POST', `/api/media/live/${sid}/start`, {});
  check('a Media volunteer puts it live when the service starts', r.status === 200 && r.data.item.liveState === 'live', r.data);
  await new Promise(res => setTimeout(res, 100));
  check('and the chapter is told: "We are live"', notes().length === 1 && notes()[0].chapterId === C, fakeModels.Notification._docs.map(x => x.title));
  r = await call(null, 'GET', '/api/live');
  check('the app shows it live', r.data.live && r.data.live.id === sid && r.data.live.url === `https://www.youtube.com/watch?v=${VID}`, r.data);
  r = await call(null, 'GET', '/api/content/live_service');
  check('and the Live Services page lists it', Array.isArray(r.data) && r.data.some(s => s.id === sid && s.liveState === 'live'));
  r = await call('head', 'POST', '/api/media/live', { title: 'Another', url: `https://youtu.be/${OLD}` });
  check('a second stream cannot go live on top of it', r.status === 409, r.data);
  r = await call('head', 'DELETE', `/api/media/live/${sid}`);
  check('a live stream cannot be removed before it ends', r.status === 400);
  r = await call('head', 'POST', `/api/media/live/${sid}/end`, {});
  check('it is ended', r.status === 200 && r.data.item.liveState === 'ended');
  r = await call(null, 'GET', '/api/live');
  check('and the app no longer says "Live now"', r.data.live === null);
  r = await call('head', 'GET', '/api/media/overview');
  check('the office shows the recording waiting to be kept as a sermon', r.data.toKeep.length === 1 && r.data.toKeep[0].id === sid, r.data.toKeep);
  r = await call('head', 'POST', `/api/media/live/${sid}/sermon`, { title: 'Walking in Newness', speaker: 'Rev. Mensah' });
  check('the recording is kept as the sermon in one step', r.status === 200 && r.data.item.type === 'video' && r.data.item.url === `https://www.youtube.com/watch?v=${VID}` && r.data.item.fromLiveId === sid && r.data.item.speaker === 'Rev. Mensah', r.data);
  const fromLive = r.data.item.id;
  r = await call('head', 'POST', `/api/media/live/${sid}/sermon`, {});
  check('but only once', r.status === 409);
  r = await call('head', 'GET', '/api/media/overview');
  check('and nothing is left to keep', r.data.toKeep.length === 0 && r.data.sermons.count === 1, r.data);
  r = await call(null, 'GET', '/api/sermons');
  check('members see the sermon on the Sermons page', Array.isArray(r.data) && r.data.some(s => s.id === fromLive && s.thumbnailUrl === `https://i.ytimg.com/vi/${VID}/hqdefault.jpg`));
  r = await call('head', 'GET', '/api/media/youtube/recent');
  check('the channel list now marks that video as a sermon already', r.data.items.find(v => v.videoId === VID).isSermon === true);

  r = await call('head', 'POST', '/api/media/live', { title: 'Midweek Prayer', url: `https://youtu.be/${OLD}`, notify: false });
  check('going live straight away works too, and can skip the alert', r.status === 200 && r.data.item.liveState === 'live');
  await new Promise(res => setTimeout(res, 100));
  check('so nobody is told this time', notes().length === 1);
  const forgotten = fakeModels.ContentItem._docs.find(d => d.id === r.data.item.id);
  forgotten.wentLiveAt = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
  r = await call(null, 'GET', '/api/live');
  check('a stream someone forgot to end stops saying "Live now" after six hours', r.data.live === null);

  console.log('\n== sermons ==');
  r = await call('vol', 'POST', '/api/media/sermons', { title: 'Bible Study', speaker: 'Bro. Yaw', url: `https://www.youtube.com/watch?v=${OLD}`, type: 'video', date: '2026-11-04', notify: false });
  check('Media adds a sermon from a YouTube link', r.status === 200 && r.data.item.videoId === OLD, r.data);
  const sermonId = r.data.item.id;
  r = await call('vol', 'POST', '/api/media/sermons', { title: 'Twice', url: `https://youtu.be/${OLD}` });
  check('the same video twice is refused, naming the one it already is', r.status === 409 && /Bible Study/.test(r.data.error), r.data);
  r = await call('vol', 'POST', '/api/media/sermons', { title: 'Bad link', url: 'javascript:alert(1)' });
  check('a link that is not https is refused', r.status === 400);
  r = await call('vol', 'POST', '/api/media/sermons', { title: 'An audio message', url: 'https://drive.google.com/file/d/abc/view', type: 'audio', notify: false });
  check('an audio link from elsewhere is fine', r.status === 200 && r.data.item.type === 'audio' && r.data.item.videoId === '', r.data);
  r = await call('vol', 'PUT', `/api/media/sermons/${sermonId}`, { title: 'Bible Study: Romans 6', speaker: 'Bro. Yaw', url: `https://youtu.be/${OLD}`, date: '2026-11-04' });
  check('a sermon is corrected', r.status === 200 && r.data.item.title === 'Bible Study: Romans 6');
  r = await call('admin', 'GET', '/api/sermons');
  check('the chapter admin\'s Sermons panel still lists them all', r.status === 200 && Array.isArray(r.data) && r.data.length === 3, r.data);
  r = await call('admin', 'POST', '/api/admin/sermons', { title: 'Added by the admin', chapterId: C });
  check('and the chapter admin can still add one, as a backup', r.status === 200, r.data);
  await call('admin', 'DELETE', `/api/admin/sermons/${r.data.item.id}`);
  r = await call('head', 'DELETE', `/api/media/sermons/${fromLive}`);
  check('removing the sermon kept from a stream', r.status === 200);
  check('frees the stream to be kept again', fakeModels.ContentItem._docs.find(d => d.id === sid).sermonId === '');

  console.log('\n== the Sunday checklist ==');
  r = await call('vol', 'PUT', '/api/media/checklist', { done: ['internet', 'audio', 'not-a-step'] });
  check('a volunteer ticks steps; unknown ones are dropped', r.status === 200 && JSON.stringify(r.data.checklist.done) === '["internet","audio"]', r.data);
  r = await call('head', 'GET', '/api/media/overview');
  check('and the Media Head sees the same ticks', JSON.stringify(r.data.checklist.done) === '["internet","audio"]');
  fakeModels.MediaDesk._docs[0].checklistDate = '2026-01-01';
  r = await call('head', 'GET', '/api/media/overview');
  check('a new day starts with a clear list', r.data.checklist.done.length === 0);

  console.log('\n== Publicity hands live services over ==');
  r = await call('pub', 'POST', '/api/admin/content', { kind: 'live_service', title: 'Old way', previewUrl: `https://youtu.be/${VID}` });
  check('Publicity can no longer post a live service, and is told where it went', r.status === 403 && /Media office/.test(r.data.error), r.data);
  r = await call('pub', 'POST', '/api/admin/content', { kind: 'seminar', title: 'Leadership seminar' });
  check('but still posts everything else (a seminar)', r.status === 200, r.data);
  r = await call('pub', 'PUT', `/api/admin/content/${sid}`, { title: 'Changed' });
  check('nor change one Media made', r.status === 403);
  r = await call('admin', 'POST', '/api/admin/content', { kind: 'live_service', title: 'Admin backup', previewUrl: `https://youtu.be/${VID}` });
  check('the chapter admin still can, as a backup', r.status === 200);

  console.log('\n== another chapter ==');
  await call('admin', 'POST', '/api/national/chapters', { id: 'aconsu-ucc', name: 'ACONSU-UCC', institution: 'UCC' });
  const ucc = await call('admin', 'POST', '/api/media/sermons', { title: 'UCC sermon', url: `https://youtu.be/${VID}`, chapterId: 'aconsu-ucc', notify: false });
  check('the main admin can add a sermon for another chapter', ucc.status === 200 && ucc.data.item.chapterId === 'aconsu-ucc', ucc.data);
  r = await call('head', 'GET', '/api/media/sermons?chapterId=aconsu-ucc');
  check('but KNUST\'s Media Head sees only KNUST\'s, whatever they ask for', r.status === 200 && !r.data.some(s => s.chapterId === 'aconsu-ucc'), r.data);
  r = await call('head', 'DELETE', `/api/media/sermons/${ucc.data.item.id}`);
  check('and cannot remove another chapter\'s', r.status === 404);

  console.log(failures ? `\n${failures} FAILURES` : '\nall media checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
