/* Makes the "How to use the ACONSU app" video.

   Run it again whenever the app changes enough that the video is wrong:
       node design/how-to-video/make-video.js

   It starts the real app on throwaway data, opens it on a phone-sized screen,
   and does what a new member would do while a caption says what is happening
   and a ring shows where the finger goes. What it records is the app itself,
   not a mock-up, so it cannot show something the app does not do.

   Writes  public/video/how-to-aconsu.mp4        the video (no sound, captions in the picture)
           public/video/how-to-aconsu-poster.jpg  the still shown before it is played

   Needs Playwright with a Chromium, and an ffmpeg that has libx264.
   FFMPEG=/path/to/ffmpeg   if it is not on the PATH.
   PLAYWRIGHT_CHROMIUM=/path/to/chrome   if Chromium is not in the usual place.

   Nothing here is a member's real data. The account that signs up on screen is
   made up, and the Bible chapter is the King James text of Psalm 23, answered
   locally because the app normally fetches it from a Bible service on the
   internet that the machine making the video may not be able to reach. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'public', 'video');
const OUT = path.join(OUT_DIR, 'how-to-aconsu.mp4');
const POSTER = path.join(OUT_DIR, 'how-to-aconsu-poster.jpg');

let chromium;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { ({ chromium } = require(p)); break; } catch (e) { /* try the next */ } }
if (!chromium) { console.error('Playwright is not installed.'); process.exit(2); }
const sharp = require('sharp');
const CHROME = process.env.PLAYWRIGHT_CHROMIUM
  || (fs.existsSync('/opt/pw-browsers') ? fs.readdirSync('/opt/pw-browsers').filter(d => /^chromium-\d+$/.test(d)).map(d => `/opt/pw-browsers/${d}/chrome-linux/chrome`)[0] : undefined);

function findFfmpeg() {
  const candidates = [process.env.FFMPEG, 'ffmpeg'];
  try {
    const py = spawnSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' });
    if (py.status === 0) candidates.push(py.stdout.trim());
  } catch (e) { /* no python */ }
  for (const c of candidates.filter(Boolean)) {
    const r = spawnSync(c, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
    if (r.status === 0 && /libx264/.test(r.stdout)) return c;
  }
  return null;
}

// ---- the screen ---------------------------------------------------------------
// The app runs in a 390 x 700 frame and is drawn at twice the size, so the text in
// the video is sharp. Below it is the caption. 780 x 1688 is a tall phone screen.
const W = 780, H = 1688, APP_H = 700, SCALE = 2;
const TOTAL_STEPS = 8;

const STAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>stage</title><style>
@font-face{font-family:'Source Sans 3';font-weight:600;src:url('/fonts/source-sans-3-latin-600-normal.woff2') format('woff2')}
@font-face{font-family:'Source Sans 3';font-weight:700;src:url('/fonts/source-sans-3-latin-700-normal.woff2') format('woff2')}
@font-face{font-family:'Source Serif 4';font-weight:700;src:url('/fonts/source-serif-4-latin-700-normal.woff2') format('woff2')}
html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:#fff;font-family:'Source Sans 3',system-ui,sans-serif}
#screen{position:absolute;left:0;top:0;width:${W / SCALE}px;height:${APP_H}px;border:0;background:#fff;transform:scale(${SCALE});transform-origin:0 0}
#cap{position:absolute;left:0;top:${APP_H * SCALE}px;width:${W}px;height:${H - APP_H * SCALE}px;box-sizing:border-box;padding:40px 52px 32px;background:#3A1B54;color:#fff;display:flex;flex-direction:column;justify-content:center}
#bar{position:absolute;left:0;top:${APP_H * SCALE}px;height:8px;width:0;background:#E8971E}
#step{font-size:28px;font-weight:600;color:#E4CDF0;letter-spacing:.01em;margin:0 0 12px;min-height:34px}
#text{font-size:43px;line-height:1.26;font-weight:700;margin:0;transition:opacity .22s}
#text.off{opacity:0}
#finger{position:absolute;left:0;top:0;width:92px;height:92px;margin:-46px 0 0 -46px;border-radius:50%;box-sizing:border-box;background:rgba(255,255,255,.62);border:5px solid #5B2C82;box-shadow:0 4px 14px rgba(36,21,48,.35);opacity:0;transition:left .45s cubic-bezier(.4,0,.2,1),top .45s cubic-bezier(.4,0,.2,1),opacity .2s,transform .14s;pointer-events:none}
#finger.on{opacity:1}
#finger.down{transform:scale(.72);background:rgba(232,151,30,.72)}
#card{position:absolute;inset:0;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 70px;transition:opacity .5s}
#card.off{opacity:0;pointer-events:none}
#card img{width:340px;height:340px;object-fit:contain;margin-bottom:46px}
#card h1{font-family:'Source Serif 4',Georgia,serif;font-weight:700;font-size:72px;line-height:1.1;color:#1F1727;margin:0 0 26px}
#card p{font-size:36px;line-height:1.35;color:#4B3F57;margin:0 0 14px;font-weight:600}
#card small{font-size:29px;color:#675A73;font-weight:600;margin-top:34px}
</style></head><body>
<iframe id="screen" title="the app"></iframe>
<div id="bar"></div>
<div id="cap"><p id="step"></p><p id="text" class="off"></p></div>
<div id="finger"></div>
<div id="card"><img src="/images/logo.jpg" alt=""><h1 id="cardTitle"></h1><p id="cardLine"></p><small id="cardSmall"></small></div>
</body></html>`;

// ---- what the app is filled with ---------------------------------------------
const PSALM_23 = [
  'The LORD is my shepherd; I shall not want.',
  'He maketh me to lie down in green pastures: he leadeth me beside the still waters.',
  'He restoreth my soul: he leadeth me in the paths of righteousness for his name\'s sake.',
  'Yea, though I walk through the valley of the shadow of death, I will fear no evil: for thou art with me; thy rod and thy staff they comfort me.',
  'Thou preparest a table before me in the presence of mine enemies: thou anointest my head with oil; my cup runneth over.',
  'Surely goodness and mercy shall follow me all the days of my life: and I will dwell in the house of the LORD for ever.'
].map((text, i) => ({ verse: i + 1, text }));

async function seed(base) {
  let jar = '';
  const call = async (method, p, body) => {
    const headers = {}; if (jar) headers.cookie = jar; if (body) headers['content-type'] = 'application/json';
    const res = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (sc.length) jar = sc.map(c => c.split(';')[0]).join('; ');
    return res.json().catch(() => ({}));
  };
  await call('POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  await call('POST', '/api/national/chapters', { id: 'aconsu-knust', name: 'ACONSU-KNUST', institution: 'KNUST' });
  const dept = [
    ['Choir', 'Lead the congregation in song', 'Saturdays', '4:00 PM', 'Main Auditorium'],
    ['Ushering', 'Welcome and seat the congregation', 'Sundays', '7:30 AM', 'Main Entrance'],
    ['Media', 'Sound, screens and the livestream', 'Fridays', '6:00 PM', 'Media Room']
  ];
  for (const [name, tagline, day, time, where] of dept) {
    await call('POST', '/api/admin/departments', { name, tagline, meetingDay: day, meetingTime: time, meetingLocation: where, chapterId: 'aconsu-knust' });
  }
  // Next Sunday and Thursday, so the page never shows a date that has passed.
  const next = (dow) => { const d = new Date(); d.setDate(d.getDate() + ((dow - d.getDay() + 7) % 7 || 7)); return d.toISOString().slice(0, 10); };
  await call('POST', '/api/admin/events', { title: 'Sunday Service', date: next(0), time: '06:20', location: 'Acci Ayeduase Auditorium', chapterId: 'aconsu-knust', status: 'published', description: 'Everyone is welcome.' });
  await call('POST', '/api/admin/events', { title: 'Midweek Service', date: next(4), time: '18:30', location: 'Acci Ayeduase Auditorium', chapterId: 'aconsu-knust', status: 'published', description: 'Worship, the Word and prayer.' });
  // One that asks for a sign-up, so the Register button can be shown.
  await call('POST', '/api/admin/events', { title: 'Campus Outreach', date: next(6), time: '09:00', location: 'Student Centre', chapterId: 'aconsu-knust', status: 'published', description: 'Meet at the Student Centre.', registrationEnabled: true, capacity: 100 });
}

async function avatar(file) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#5B2C82"/><circle cx="200" cy="150" r="70" fill="#E4CDF0"/><path d="M60 400a140 140 0 0 1 280 0z" fill="#E4CDF0"/></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
}

// ---- the script of the video --------------------------------------------------
(async () => {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) { console.error('Needs an ffmpeg with libx264 (set FFMPEG=/path/to/ffmpeg).'); process.exit(2); }
  if (!CHROME) { console.error('No Chromium found (set PLAYWRIGHT_CHROMIUM=/path/to/chrome).'); process.exit(2); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aconsu-video-'));
  const photo = path.join(tmp, 'me.png');
  await avatar(photo);

  require(path.join(ROOT, 'test', 'harness.js'));
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/video', PORT: '4472', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 'video', LOGIN_RATE_LIMIT_MAX: '900' });
  require(path.join(ROOT, 'server.js'));
  await new Promise(r => setTimeout(r, 1500));
  const BASE = 'http://127.0.0.1:4472';
  await seed(BASE);

  const browser = await chromium.launch({ executablePath: CHROME });
  // serviceWorkers are blocked so every request, the Bible one included, passes through this script.
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, serviceWorkers: 'block', recordVideo: { dir: tmp, size: { width: W, height: H } } });
  // The Bible service is on the internet; answer it here (see the note at the top).
  await ctx.route('**/api/bible/passage**', route => route.fulfill({ json: { reference: 'Psalms 23', translation: 'kjv', verses: PSALM_23 } }));
  await ctx.route('**/__stage', route => route.fulfill({ contentType: 'text/html', body: STAGE }));
  const page = await ctx.newPage();
  globalThis.__page = page;
  const t0 = Date.now();
  page.on('pageerror', e => console.log('  page error:', e.message));

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const app = () => page.frames().find(f => f.parentFrame());
  const inApp = (sel) => page.frameLocator('#screen').locator(sel).first();
  const settle = async () => { try { await app().waitForLoadState('load'); } catch (e) { /* mid-navigation */ } await sleep(900); };

  await page.goto(BASE + '/__stage');
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate((u) => { document.getElementById('screen').src = u; }, '/index.html');
  await settle();

  let step = 0;
  let startedAt = 0;
  const caption = async (text, n) => {
    await page.evaluate(({ text, n, total }) => {
      const t = document.getElementById('text'), s = document.getElementById('step');
      t.classList.add('off');
      setTimeout(() => {
        s.textContent = n ? `Step ${n} of ${total}` : '';
        t.textContent = text; t.classList.remove('off');
      }, 230);
      document.getElementById('bar').style.width = n ? (n / total * 100) + '%' : '0';
    }, { text, n, total: TOTAL_STEPS });
    await sleep(300);
  };
  // A caption stays up long enough to be read: about three words a second, and at least four seconds.
  const scene = async (text, actions) => {
    step += 1;
    startedAt = Date.now();
    await caption(text, step);
    await actions();
    const words = text.split(/\s+/).length;
    const wanted = Math.max(3800, words * 300 + 1100);
    const left = wanted - (Date.now() - startedAt);
    if (left > 0) await sleep(left);
  };
  const aim = async (x, y) => { await page.evaluate(({ x, y }) => { const f = document.getElementById('finger'); f.classList.add('on'); f.style.left = x + 'px'; f.style.top = y + 'px'; }, { x, y }); await sleep(520); };
  const centreOf = async (sel) => {
    const box = await inApp(sel).boundingBox();
    if (!box) throw new Error('not on screen: ' + sel);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const pointAt = async (sel) => { const c = await centreOf(sel); await aim(c.x, c.y); };
  const tap = async (sel, { navigates = false } = {}) => {
    await inApp(sel).scrollIntoViewIfNeeded();
    const c = await centreOf(sel);
    await aim(c.x, c.y);
    await page.evaluate(() => document.getElementById('finger').classList.add('down'));
    await sleep(160);
    await inApp(sel).click();
    await page.evaluate(() => document.getElementById('finger').classList.remove('down'));
    if (navigates) await settle(); else await sleep(500);
  };
  const type = async (sel, text, delay = 36) => {
    await tap(sel);
    await inApp(sel).pressSequentially(text, { delay });
    await sleep(300);
  };
  const scroll = async (dy, ms = 1400) => {
    await app().evaluate(({ dy, ms }) => new Promise((done) => {
      const from = window.scrollY, t0 = performance.now();
      (function frame(t) {
        const p = Math.min(1, (t - t0) / ms), e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        window.scrollTo(0, from + dy * e);
        p < 1 ? requestAnimationFrame(frame) : done();
      })(t0);
    }), { dy, ms });
    await sleep(300);
  };
  const hideFinger = () => page.evaluate(() => document.getElementById('finger').classList.remove('on'));
  const card = async (title, line, small) => {
    await page.evaluate(({ title, line, small }) => {
      document.getElementById('cardTitle').textContent = title;
      document.getElementById('cardLine').textContent = line;
      document.getElementById('cardSmall').textContent = small || '';
      document.getElementById('card').classList.remove('off');
    }, { title, line, small });
  };
  const cardOff = () => page.evaluate(() => document.getElementById('card').classList.add('off'));

  // ---- the title ----
  await card('How to use the ACONSU app', 'A short tour: sign up, events, Bible, prayer and more.', "The Apostles' Continuation Students Union");
  await sleep(1200);
  const videoStart = (Date.now() - t0) / 1000;   // the picture before this is the blank page loading
  await page.screenshot({ path: path.join(tmp, 'poster.png') });
  await sleep(2200);
  await cardOff();
  await sleep(600);

  // ---- 1. finding your way ----
  await scene('The bar at the bottom takes you anywhere: Home, Events, Bible, Prayer and More.', async () => {
    for (const label of ['Home', 'Events', 'Bible', 'Prayer', 'More']) {
      await pointAt(`.bottom-nav a:has-text("${label}")`);
      await sleep(200);
    }
  });

  // ---- 2. sign up ----
  await scene('To join, tap Log In at the top, then Sign up.', async () => {
    await tap('#site-header a:has-text("Log In")', { navigates: true });
    await tap('a:has-text("Sign up")', { navigates: true });
  });
  await caption('Add a photo, then type your name, email and a password. Tick the box to agree, and tap Create Account.', 2);
  await inApp('#profileImage').setInputFiles(photo);
  await sleep(500);
  await type('#name', 'Ama Mensah');
  await type('#email', 'ama.mensah@example.com');
  await scroll(280, 800);
  await type('#password', 'a-long-password');
  await scroll(520, 1300);
  await tap('#agree');
  await tap('#registerBtn', { navigates: true });
  await sleep(1200);
  await caption('That is all. You are signed in, and your profile opens.', 2);
  await sleep(3000);

  // ---- 3. events ----
  await scene('Events shows what is coming up. Tap Register Now to keep your place.', async () => {
    await tap('.bottom-nav a:has-text("Events")', { navigates: true });
    await sleep(900);
    await tap('[data-register]');
    await sleep(1000);
    await tap('#regSubmitBtn');
    await sleep(900);
  });

  // ---- 4. the Bible ----
  await scene('Bible: pick a book, a chapter and a version. Reading every day builds your streak.', async () => {
    await tap('.bottom-nav a:has-text("Bible")', { navigates: true });
    await sleep(600);
    await tap('#bookSelect');
    await inApp('#bookSelect').selectOption({ label: 'Psalms' });
    await sleep(500);
    await tap('#chapterSelect');
    await inApp('#chapterSelect').selectOption('23');
    await sleep(1500);
    await scroll(240, 1100);
  });

  // ---- 5. prayer ----
  await scene('Prayer Wall: write your request and choose who sees it. You can keep it between you and the leaders.', async () => {
    await tap('.bottom-nav a:has-text("Prayer")', { navigates: true });
    await scroll(250, 800);
    await type('#request', 'Please pray for me as I prepare for exams.', 34);
    await tap('#visibility');
    await sleep(400);
    await scroll(300, 800);
    await tap('#prayerSubmitBtn');
    await sleep(1200);
  });

  // ---- 6. more ----
  await scene('More has the rest: departments, groups, community, giving and your account. Scroll to see it all.', async () => {
    await tap('.bottom-nav a:has-text("More")', { navigates: true });
    await hideFinger();
    await scroll(560, 2000);
    await scroll(560, 2000);
    await scroll(-1400, 1400);
  });

  // ---- 7. your profile, and dark mode ----
  await scene('Tap your name for your profile. Prefer a darker screen? Tap the moon at the top.', async () => {
    await tap('.more-account-inner', { navigates: true });
    await sleep(500);
    await scroll(360, 1200);
    await scroll(-360, 800);
    await tap('#site-header #themeToggle');
    await sleep(1800);
    await tap('#site-header #themeToggle');   // and back, so the rest of the video is in light again
    await sleep(400);
  });

  // ---- 8. help ----
  await scene('Tap the bell for announcements. Need a hand? Open More, then Contact Us.', async () => {
    await tap('#site-header a[href="/notifications.html"]', { navigates: true });
    await hideFinger();
    await sleep(800);
  });

  // ---- the end ----
  await hideFinger();
  await page.evaluate(() => { document.getElementById('text').classList.add('off'); document.getElementById('step').textContent = ''; });
  await card('Welcome to ACONSU', 'Open the app any time you need it.', "The Apostles' Continuation Students Union");
  await sleep(3200);

  const webm = await page.video().path();
  await ctx.close();
  await browser.close();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0, videoStart - 0.15)), '-i', webm,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '32', '-pix_fmt', 'yuv420p', '-r', '25', '-an', '-movflags', '+faststart', OUT]);
  await sharp(path.join(tmp, 'poster.png')).jpeg({ quality: 82 }).toFile(POSTER);
  const mb = (fs.statSync(OUT).size / 1048576).toFixed(2);
  console.log(`wrote ${path.relative(ROOT, OUT)} (${mb} MB) and ${path.relative(ROOT, POSTER)}`);
  process.exit(0);
})().catch(async (e) => {
  console.error(e);
  // What the screen looked like when it went wrong.
  try { const f = path.join(os.tmpdir(), 'aconsu-video-failed.png'); await globalThis.__page.screenshot({ path: f }); console.error('screen at the time: ' + f); } catch (x) { /* no page */ }
  process.exit(1);
});
