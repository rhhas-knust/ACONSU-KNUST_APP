# ACONSU Web App

Official website + admin backend for **ACONSU — The Apostles' Continuation Students Union**.

## What's included

- **Public site**: Home dashboard, Bible reader, Events (with capacity/deadline-limited registration), Sermons & Media, Departments (with join forms), Prayer Wall, Discover/search, Custom Pages (admin-created galleries/bookshelves/info pages), Notifications, Contact.
- **Member accounts**: sign up, log in, edit profile, forgot/reset password, birthdays (month/day only — no year, ever), App Streak and Badges.
- **Admin dashboard** (`/admin.html`): manages all public content, executives, members (view/edit/delete), media library uploads, and sends push/in-app announcements.
- **Shepherding portal** (`/shepherding.html`): a completely separate, restricted login for the Shepherding Head — pastoral care records and church finance tracking (MoMo, Tithe, Harvest, Offertory, Other income, plus expenses).
- **Installable app (PWA)** with offline support, real push notifications, and a Capacitor scaffold for native iOS/Android builds.
- **MongoDB Atlas** as the data store — real cloud database with automatic backups and replication.
- **Email notifications** (password reset, admin alerts on new join/prayer/testimony/contact submissions) and **automatic image compression** on every upload.
- **Security hardening**: rate-limiting, secure session cookies, security headers, bcrypt-hashed passwords throughout.

---

## 0. First — fixing "I can't access the admin page"

This is almost always one of two things:

1. **You're opening `admin.html` as a file** (double-clicking it, or a `file://...` address in the browser bar) instead of visiting it through the running server. Because the admin page loads its data over the network, it only works at a URL like `http://localhost:3000/admin.html` (while `npm start` is running) or your live Render/Railway URL — never a `file://` path.
2. **The `.env` file isn't set up yet**, so the server is using the placeholder login `admin` / `changeme`. Open `.env` (copy it from `.env.example` if it doesn't exist) and check `ADMIN_USERNAME` / `ADMIN_PASSWORD` — log in with whatever you set there.

If you've deployed and it still doesn't work, open the browser's dev tools (F12) → Network tab, try logging in, and check the response for `/api/admin/login` — send me that error and I can pinpoint it.

---

## 1. MongoDB Atlas setup (step by step)

Atlas is MongoDB's official free cloud hosting. This gets your data off the server's local disk and into a proper managed database.

1. Go to **mongodb.com/cloud/atlas/register** and create a free account.
2. When prompted to create a cluster, choose the **free "M0" tier** — this costs nothing and is plenty for ACONSU's traffic.
3. Pick any cloud provider/region (closest to your users is fine) and click **Create**.
4. **Create a database user**: in the left sidebar, go to *Database Access* → *Add New Database User*. Choose a username and a strong password (save it somewhere safe — you'll need it in a moment).
5. **Allow network access**: go to *Network Access* → *Add IP Address* → choose **"Allow access from anywhere"** (`0.0.0.0/0`). This is fine because access is still protected by your database username/password — Atlas itself isn't an open door.
6. Go back to *Database* → click **Connect** on your cluster → **Drivers** → copy the connection string. It looks like:
   ```
   mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
7. Paste that into your `.env` file as `MONGODB_URI`, replacing `<username>` and `<password>` with the ones from step 4, and add a database name before the `?`, e.g.:
   ```
   MONGODB_URI=mongodb+srv://acousuadmin:yourpassword@cluster0.xxxxx.mongodb.net/aconsu?retryWrites=true&w=majority
   ```

## 2. Local setup

```bash
cd aconsu-app
npm install
cp .env.example .env
```

Fill in `.env`:
```
PORT=7000
NODE_ENV=development
SESSION_SECRET=some_long_random_string
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
MONGODB_URI=your_atlas_connection_string_from_step_1
```

**Import your existing content into Atlas** (departments, events, sermons — one-time):
```bash
node migrate-to-mongo.js
```
This is safe to re-run; it won't create duplicates.

Then start the app:
```bash
npm start
```

Visit `http://localhost:3000` for the public site, and `http://localhost:3000/admin.html` to log in.

## 3. Deployment (Render or Railway)

Same as before, with one addition — set `MONGODB_URI` as an environment variable on the host too:

**Render:**
1. Push this project to a GitHub repo.
2. New → Web Service → connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Under Environment, add: `SESSION_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `MONGODB_URI`, and `NODE_ENV=production`.
5. Deploy.

**Railway:**
1. Push to GitHub, then New Project → Deploy from GitHub repo.
2. Add the same environment variables under Variables (including `NODE_ENV=production`).
3. Deploy.

Because content now lives in Atlas rather than local JSON files, you no longer need to worry about persistent disks or losing data on redeploy.

## 4. A real firewall — Cloudflare (free)

App code alone can't be a firewall — that protection has to sit in front of the server, at the network level. The straightforward way to get real protection (DDoS mitigation, a web application firewall, bot filtering) at no cost:

1. Create a free account at **cloudflare.com**.
2. Add your domain (if ACONSU doesn't have one yet, buy one — Namecheap or Cloudflare itself both work, roughly $10–15/year).
3. Point your domain's DNS to your Render/Railway app (Cloudflare walks you through this — usually a CNAME record to the URL Render/Railway gave you).
4. Turn on the **orange cloud** (proxy) on that DNS record — this routes all traffic through Cloudflare first.
5. Under **Security**, turn on "I'm Under Attack Mode" only if you're actively being attacked; otherwise the default "Medium" security level is enough for normal protection.

This blocks the vast majority of automated attacks before they even reach your server — well beyond what's possible in application code.

## 5. Other hardening already built in

- **Rate limiting**: the admin login is limited to 10 attempts per 15 minutes per IP, blocking brute-force password guessing. Public forms (join, prayer, testimony, contact) are limited to 20 submissions per 10 minutes per IP to block spam floods.
- **Session cookies** are `httpOnly` (invisible to malicious scripts) and marked `secure` automatically once `NODE_ENV=production` (so they only travel over HTTPS).
- **Helmet** sets standard security-related HTTP headers.
- **Change the defaults**: before going live, make sure `.env` has a real `SESSION_SECRET` (any long random string) and a strong `ADMIN_PASSWORD` — never deploy with the example values.

## 6. Project structure

```
aconsu-app/
  server.js               Express server + all API routes
  lib/
    db.js                 MongoDB Atlas connection
    models.js              Mongoose schemas
    repo.js                Generic CRUD used by server.js
    gridfs.js              File storage (photos, ebooks, profile/exec photos)
    bibleBooks.js          Static book/chapter list for the Bible reader
    push.js                Web push notification sending + cleanup
    mailer.js              SMTP email sending (password reset, admin alerts)
    imageProcess.js        Automatic image resize/compression on upload
  migrate-to-mongo.js      One-time import of old local JSON data into Atlas
  capacitor.config.json    Native app (iOS/Android) wrapper config
  data/                    Old local JSON files — kept only as the migration source
  public/
    index.html, about.html, departments.html, department.html,
    events.html, media.html, bible.html, prayer.html, contact.html,
    login.html, register.html, forgot-password.html, reset-password.html,
    profile.html, notifications.html, discover.html,
    page.html, admin.html, shepherding.html
    manifest.json           PWA app manifest
    sw.js                   Service worker (offline support)
    icons/                  Generated app icons, all sizes
    css/style.css           Design system (colors, type, components)
    js/main.js              Shared header/footer, countdown, auth state, PWA install, toasts
    js/admin.js             Admin dashboard logic
    js/shepherd.js          Shepherding portal logic (private, separate login)
    images/logo.jpg         ACONSU logo
```

## 7. Custom pages, uploads, and event registration

**Custom Pages** (admin dashboard → *Custom Pages*): create new tabs that appear automatically in the main menu — no code changes needed. Three types:
- **Photo Gallery** — e.g. "Sunday Service Pictures." Upload photos to it from the Media Library.
- **E-Book / Resource Shelf** — e.g. "E-Book Store." Upload PDFs or other documents; each shows as a downloadable card.
- **Plain Info Page** — free text, for anything else (a doctrine statement, an FAQ, etc.).

Each page gets a slug (its URL, e.g. `ebook-store` → `yoursite.com/page.html?slug=ebook-store`) and a menu label. Toggle "Show in main menu" off if you want a page to exist without appearing in navigation yet.

**Media Library** (admin dashboard → *Media Library*): upload photos or documents (up to 30MB each), tag them as Photo or E-Book, and optionally attach them to one of your Gallery/Bookshelf pages so they show up publicly. Files are stored directly in MongoDB Atlas (via GridFS) — no separate file storage service required. Delete anytime from the same screen.

**Event Registration** (admin dashboard → *Events*, when adding/editing an event): turn on "Enable registration," optionally set a capacity (0 = unlimited) and a registration deadline. The public Events page then shows a live "spots left" badge and a Register button that automatically disables once the deadline passes or the event fills up. See who's registered anytime via the "View" button next to each event.

## 8. Executives and homepage/department imagery

**Executives** (admin dashboard → *Executives*): add each exec's name, role, a short bio, a display order, and an optional photo. They appear automatically on the public **About** page in the "Meet the Executives" section, and 1–2 of their photos also show up as gently floating accents in the About page hero.

**Floating decorative images** on the Home, Departments, and individual Department pages pull automatically from any photo you've uploaded in the Media Library tagged as **"Photo"** and *not* attached to a specific gallery page — so a few favorite shots (worship, campus, group photos) uploaded there will start "floating" across those hero sections without any extra setup. No photos uploaded yet → those sections simply stay clean, nothing breaks.

## 9. UI/UX pass

A few things were added purely for feel:
- **Bottom tab bar on mobile** — Home, Events, Bible, Prayer, and a "More" tab that slides up a sheet with everything else (About, Departments, Sermons, custom pages, Contact, and Log In/Profile). This shows up automatically on any screen under 861px wide and gives the site a native-app feel instead of a mobile website feel; the desktop top nav stays as-is on wider screens. It's wired into every public page automatically — no per-page setup needed, and it'll pick up any new Custom Pages you add without further changes.
- **Toast notifications** confirm actions (join a department, submit a prayer request, register for an event) with a small notification in the corner, in addition to the inline message.
- **Scroll-reveal animations** — cards fade/slide into view as you scroll instead of popping in all at once.
- **Skeleton loading placeholders** on the About page while executive data loads, instead of a blank gap.
- **Visible focus outlines** on buttons/links/inputs for keyboard navigation and accessibility.
- Floating images and card hover/lift effects add some life without slowing the site down — they're disabled on mobile screens to keep things fast and uncluttered there.

## 10. Birthday celebrations

Members can optionally add their birthday — **month and day only, never a year** — when they sign up or later from their profile. This is a deliberate privacy choice: the database has no field for birth year anywhere, so a member's age can never be calculated or exposed, even by an admin looking directly at the database.

On the day itself, the homepage shows a celebratory banner — first name + last initial only (e.g. "Grace A.") with their profile photo if they have one. No email, phone, or any other detail is shown publicly. Admin can see the full list of members' birthdays (month/day) in the **Members** tab of the dashboard, for planning shout-outs or cards.

## 11. Bible reader

The new **Bible** tab (`/bible.html`) lets anyone read scripture directly in the app — pick a book, chapter, and translation (KJV, WEB, WEBBE, Open English Bible, and the Clementine Vulgate), and read right there, with Previous/Next chapter navigation. Each chapter can also be downloaded as a plain text file for offline reading.

This is powered by the free [bible-api.com](https://bible-api.com) service, called from the server (not the browser) so requests are cached for an hour and don't expose any third-party API directly to visitors.

**For full downloadable Bible versions** (entire PDFs or e-books per translation): use the **Custom Pages** feature you already have — create a Bookshelf-type page (e.g. titled "Bible Downloads"), then upload full versions as files via the Media Library, tagged to that page. The Bible reader page automatically detects a page like this (if its title or slug mentions "bible" or "scripture") and shows a "Browse Downloadable Versions" link pointing straight to it — no extra code needed on your end, just create the page and upload the files.

## 12. Member accounts

- **Sign up**: `/register.html` — name, email, password, optional phone and level.
- **Log in**: `/login.html`.
- **Profile**: `/profile.html` — update name/phone/level, upload a profile photo, change password, log out.

Logged-in members see their first name in the header (instead of "Log In"), linking straight to their profile. Passwords are hashed with bcrypt before ever touching the database — the app never stores or can see a plain-text password. Admin can see the full member list under **Members** in the admin dashboard (read-only for now — no editing/deleting from there yet; let me know if you want that added).

This is intentionally kept separate from admin auth — a member account can never access `/admin.html`, and an admin login can't be used to log into a member profile.

## 13. Installable App (PWA)

The site is now a full Progressive Web App — visitors on phones will see an "Install ACONSU App" prompt (or can use "Add to Home Screen" from their browser menu), after which it opens full-screen with its own icon, no browser bar, and works offline for pages already visited.

What's included:
- `manifest.json` — app name, icons (generated from your logo, all standard sizes), theme colors, and quick-action shortcuts to Events, Prayer Wall, and Sermons.
- `sw.js` (service worker) — caches the app shell and visited pages so the site loads instantly and works with a spotty or no connection. API data is always fetched fresh when online, and only served from cache as a fallback when offline. The admin dashboard is deliberately never cached, so it always reflects live login state.
- Icons in `/public/icons/` — generated from `logo.jpg` in every size iOS/Android expect, plus a "maskable" version for Android's adaptive icon shapes.

No setup needed — this works automatically once deployed over HTTPS (required for service workers; Render/Railway provide this by default).

## 14. Native App (iOS / Android) via Capacitor

For an actual installable app in the App Store / Play Store, this project is pre-wired for **Capacitor**, which wraps the live website in a native app shell. This is the practical path since the app needs its live database connection — it doesn't work as a fully offline bundled app.

**One-time setup (run on your own machine, after deploying the site):**

1. Deploy the site first (see section 3) and note your live URL.
2. Open `capacitor.config.json` and replace `YOUR-DEPLOYED-DOMAIN-HERE` with your real deployed URL (e.g. `https://aconsu.onrender.com` or your custom domain).
3. Install dependencies:
   ```bash
   npm install
   ```
4. Add the platforms you want to build for:
   ```bash
   npm run cap:add:android
   npm run cap:add:ios
   ```
5. Sync the config into the native projects:
   ```bash
   npm run cap:sync
   ```
6. Open in the native IDE to build and publish:
   ```bash
   npm run cap:open:android   # requires Android Studio
   npm run cap:open:ios       # requires Xcode (Mac only)
   ```

From there, each IDE handles building, signing, and submitting to the Play Store / App Store — standard Capacitor/native workflow, same as any other app. The app icon and splash screen can be customized inside `android/` and `ios/` once those folders are generated (step 4) — ask me if you'd like help configuring those.

Building and submitting native apps requires tools (Android Studio, Xcode) that only run on your own computer, not in this chat — but the project is fully set up for it, so it's just running the commands above when you're ready.

## 15. Home dashboard and notifications

**Tile dashboard**: the homepage now leads with a grid of quick-access tiles (Bible, Events, Departments, Sermons, Prayer Wall, Notifications), with any Custom Pages you've created appended automatically. This sits above the existing department/event previews — the tiles are for fast navigation, the sections below are for browsing.

**Notifications** — two layers working together:
- **In-app feed** (`/notifications.html`, also reachable via the bell icon or the "More" menu): every announcement and automatic update shows up here, newest first, with a small unread-count badge on the bell and the mobile "More" tab.
- **Real push notifications**: visitors can tap "Enable" on the notifications page to get phone alerts even when the app isn't open — this uses the standard Web Push API (no third-party notification service, no per-message cost).

**What triggers a notification automatically:**
- A new **event** is created by admin → "New Event: [title]"
- A new **sermon** is added by admin → "New Sermon: [title]"
- Once a day, if it's someone's **birthday** → "🎉 Happy Birthday!" naming whoever's celebrating (first names only, consistent with the privacy approach used elsewhere)

**Admin can also send manual announcements** any time from the new **Notifications** tab in the dashboard — title, message, and where tapping it should take people.

### Push notifications setup (required for phone alerts to work)

Push notifications need a one-time key pair (VAPID keys) so browsers trust that notifications are really coming from your server:

1. In the project folder, run:
   ```bash
   npx web-push generate-vapid-keys
   ```
2. Copy the two keys it prints into `.env`:
   ```
   VAPID_PUBLIC_KEY=...
   VAPID_PRIVATE_KEY=...
   VAPID_SUBJECT=mailto:youradminemail@example.com
   ```
3. Restart the server. That's it — no account, no third-party service, no per-notification cost.

If these aren't set, the app still works completely normally — the in-app notification feed keeps working, it just won't send real phone push alerts until the keys are added.

**A few real-world notes:**
- Push notifications need HTTPS, so this only works once deployed (Render/Railway provide HTTPS automatically) — it won't send real pushes on plain `localhost`.
- iPhones only support push notifications for sites that have been **added to the home screen** (installed as the PWA) — this is an Apple platform restriction, not something in this app's control. Android and desktop browsers support it directly, no install required.
- The automatic birthday and daily checks require the server process to keep running continuously — true by default on Render/Railway's standard web service plans, just flagging it in case you ever move to a "serverless"-style host where this wouldn't apply.

## 16. App Streak, Badges, and Discover

**App Streak** — logged-in members get a daily streak counter, shown on the Home greeting bar and the Profile page. It increments automatically the first time they open the app each day (silently, in the background — no action needed), and resets if a day is missed. Both current and longest streak are tracked.

**Badges** — computed live from real activity, not manually awarded, so they're always accurate:
- Welcome to ACONSU (everyone)
- 7-Day Streak / 30-Day Streak
- Scripture Reader (10+ Bible chapters read) / Deeply Rooted (50+)
- Prayer Warrior (submitted a prayer request)
- Serving Heart (joined a department)
- Event Goer (registered for an event)

Bible chapter reads are counted automatically each time a logged-in member opens a chapter in the Bible reader.

**Home page** now leads with a greeting bar (time-of-day greeting, streak flame, notification bell) and a proper "Verse of the Day" card, followed by the quick-access tile grid.

**Profile page** now leads with the member's name and photo (tap the camera icon to update instantly), quick-access pills (My Events, Prayer Wall, Departments), the streak card, and the badges grid — account editing and password change stay below as "Account Settings."

**Discover page** (`/discover.html`, reachable from the bell/More menu) — a search bar across sermons, departments, events, and custom pages, plus browsable tiles for Sermons, Bible, Departments, Events, and any Custom Pages you've created.

## 17. Shepherding portal (private — Shepherding Head only)

A completely separate, restricted-access area at **`/shepherding.html`** for pastoral care and church finance records. It is not linked from anywhere in the public site or the admin dashboard — only someone with the direct URL and the Shepherding Head credentials can reach it.

**Why it's separate from admin**: this deliberately does *not* share a login with the main admin dashboard, so the church can hand shepherding/finance access to one specific person without also giving them (or requiring them to share) the admin password, and vice versa.

### Setup
Add credentials to `.env` (leave blank and the portal will refuse all logins until set):
```
SHEPHERD_USERNAME=
SHEPHERD_PASSWORD=
```
Only share these with the Shepherding Head.

### What it does

**Members tab** — every ACONSU member automatically appears here with their name, email, phone, birthday, and profile photo pulled live from their existing account (nothing is re-typed or duplicated). The Shepherding Head then fills in the parts that live nowhere else in the system: home address, emergency contact, attendance status (New/Regular/Irregular/Inactive), last contact date, and free-form pastoral notes. A **"+ Add Visitor Record"** button also allows tracking people who attend but don't have an ACONSU account yet — entered manually with just a name and phone number.

**Finance tab** — logs day-to-day income and expenses:
- **Income** is categorized into exactly the sources you specified: **MoMo, Tithe, Harvest, Offertory,** and **Other**.
- **Expenses** use a free-text category (utilities, maintenance, outreach, etc.) since expense types vary more than income sources.
- Every entry has a date, amount, and optional description; entries can be edited or deleted.

**Overview tab** — total income, total expenses, net balance, and a breakdown of income by source, calculated live from every entry ever logged.

### Data privacy note
This portal can see phone numbers, addresses, and financial records — meaningfully more sensitive than anything the public admin dashboard touches. Treat the Shepherding Head credentials with the same care as the database password itself, and rotate them if the person holding the role ever changes.

## 18. Password reset, email notifications, image compression, and admin polish

This closing pass fills in the remaining day-to-day gaps:

**Forgot / Reset Password** — members who forget their password can now recover their account themselves at `/forgot-password.html`, no admin involvement needed. A reset link is emailed (valid for 1 hour), and the response is always the same generic message whether or not the email exists, so this can't be used to check who has an account. Requires SMTP setup (below) to actually deliver the email — without it, the request still completes safely but no email goes out.

**Email notifications** — the admin now gets a real email whenever someone submits a **join request, prayer request, testimony, or contact message**, in addition to seeing it in the dashboard. Sent to whatever address is set as **Contact Email** under Site Settings.

**Email setup (SMTP)** — add to `.env`:
```
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
MAIL_FROM=ACONSU <noreply@aconsu.org>
```
Works with any standard SMTP provider — Gmail (using an [App Password](https://myaccount.google.com/apppasswords), not your normal password), SendGrid, Mailgun, Zoho, etc. Leave blank and the app runs completely normally — password reset and admin notification emails just won't send until this is filled in.

**Image compression** — every photo uploaded anywhere in the app (media library, executive photos, member profile photos, shepherding record photos) is now automatically resized (max 1600px) and compressed before being stored, cutting Atlas storage usage significantly with no visible quality loss. Non-image files (PDFs, etc.) pass through untouched.

**Admin can now edit and delete members** — previously read-only. Name, phone, level, and department can be edited from the Members tab; email and password changes still require the member to do it themselves (deliberately — prevents an admin action from silently locking someone out of their own account).

**Pagination** — every admin and Shepherding portal table that can grow large (Members, Join Requests, Prayer Requests, Testimonies, Contact Messages, Notification History, Media Library, Departments/Events/Sermons/Pages, and the Shepherding Members/Finance tables) now paginates at 12–15 rows per page instead of rendering everything at once.

## 19. Design

Palette pulled from the ACONSU crest: deep purple (`#5B2C82`) and rich plum (`#3A1B54`) as primary, a light lilac background, with the crest's flame rendered as a gold-to-red gradient accent on key call-to-action buttons and the homepage hero. Headings use Fraunces (serif, for warmth and gravity); body text uses Manrope (clean, easy to read on mobile).
