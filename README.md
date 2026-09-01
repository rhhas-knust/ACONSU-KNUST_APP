# ACONSU Web App

Official website + admin backend for **ACONSU — The Apostles' Continuation Students Union**.

## What's included

- **Public site**: Home dashboard, Bible reader, Events (with capacity/deadline-limited registration), Sermons & Media, Departments (with join forms), Prayer Wall, Discover/search, Custom Pages (admin-created galleries/bookshelves/info pages), Notifications, Contact.
- **Member accounts**: sign up, log in, edit profile, forgot/reset password, birthdays (month/day only — no year, ever), App Streak and Badges.
- **Admin dashboard** (`/admin.html`): manages all public content, executives, members (view/edit/delete), media library uploads, leadership accounts, and sends push/in-app announcements.
- **Leadership portals** — one signed-in area per office, each with its own account (see section 17):
  - **Coordinator** (`/coordinator.html`) — a read-only dashboard across every office.
  - **Finance** (`/finance.html`) — budgets with planned-vs-actual tracking, a full ledger, reports and CSV export.
  - **Shepherding** (`/shepherding.html`) — Sunday attendance registers, member records they can edit, and the contact-message inbox.
  - **Publicity** (`/publicity.html`) — app + SMS announcements, scheduled sends, event updates, and the testimony inbox.
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
    roles.js                Multi-chapter role hierarchy + chapter-scope resolution (section 20)
    gridfs.js              File storage (photos, ebooks, profile/exec photos)
    bibleBooks.js          Static book/chapter list for the Bible reader
    push.js                Web push notification sending + cleanup
    sms.js                 SMS sending via mNotify + audience resolution
    mailer.js              SMTP email sending (password reset, office alerts)
    imageProcess.js        Automatic image resize/compression on upload
  migrate-to-mongo.js      One-time import of old local JSON data into Atlas
  migrate-multichapter.js One-time migration to the multi-chapter model — see section 20
  capacitor.config.json    Native app (iOS/Android) wrapper config
  test/
    smoke.js               End-to-end test of the portals (`npm test`)
    harness.js             In-memory stand-in for MongoDB, used by the test
  data/                    Old local JSON files — kept only as the migration source
  public/
    index.html, about.html, departments.html, department.html,
    events.html, media.html, bible.html, prayer.html, contact.html,
    login.html, register.html, forgot-password.html, reset-password.html,
    profile.html, notifications.html, discover.html, more.html,
    page.html, admin.html (also the Chapter Admin portal — section 20)
    national.html, coordinator.html, finance.html, shepherding.html, publicity.html
    manifest.json           PWA app manifest
    sw.js                   Service worker (offline support)
    icons/                  Generated app icons, all sizes
    css/style.css           Design system (colors, type, components)
    css/portal.css          Shared styling for the leadership portals
    js/main.js              Shared header/footer, chapter selection, auth state, PWA install, toasts
    js/admin.js             Admin / Chapter Admin dashboard logic
    js/portal.js            Shared portal shell — sign-in, nav, modals, formatting
    js/national.js          National Coordinator portal (chapters, national dashboard/announcements)
    js/coordinator.js       Chapter Coordinator dashboard (approvals, chapter-wide announcements)
    js/finance.js           Finance office (budgets, ledger, reports)
    js/shepherd.js          Shepherding portal (attendance, members, messages, membership workflow)
    js/publicity.js         Publicity portal (announcements, SMS, testimonies)
    images/logo.jpg         ACONSU logo
```

Run `npm test` to check the portals still behave after a change — it boots the real
app against an in-memory database and exercises every portal route, permission rule
and money calculation. No database or network needed.

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

**Department header images**: every department can carry its own header photo. Set one from the admin dashboard → *Departments* → **Header Image** on the department's row. The screen shows what is there now, lets you upload a replacement, or lets you pick something already in the media library. That photo then appears as the banner across the top of the department's own page (with the name and tagline over it) and as the thumbnail on its card in the departments list and on the home page. Departments without a photo fall back to the flame gradient, so nothing ever looks broken.

**Knowing where an image will go**: the Media Library's upload form now begins with **"Where will this image be used?"** Choosing an option explains, in plain words, exactly where the image will appear — and when the choice needs one, asks which department or page it belongs to. Pick "Department header" and the department is updated the moment the upload finishes; there's no second step to forget. Every card in the library then says what its image is doing ("Header for Choir", "On the Gallery page", "Floating photo on the home page") instead of leaving you to guess.

**Floating decorative images** on the Home, Departments, and individual Department pages pull automatically from any photo uploaded with the **"Floating home-page photo"** placement (or, from before placements existed, any Photo not attached to a page) — so a few favourite shots start "floating" across those hero sections without extra setup. No photos uploaded yet → those sections simply stay clean, nothing breaks.

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
- **In-app feed** (`/notifications.html`, also reachable via the bell icon or the More page): every announcement and automatic update shows up here, newest first, with a small unread-count badge on the bell and the mobile "More" tab.
- **Real push notifications**: members turn alerts on under **Alerts** on their profile page, and get phone alerts even when the app isn't open — this uses the standard Web Push API (no third-party notification service, no per-message cost). There is deliberately no prompt or Enable button on the notifications page itself: a device that has already granted permission is quietly re-registered in the background, and everyone else is left alone until they go looking for the setting.

**The "More" page**: the More tab used to open a pop-up sheet. It is now a page of its own at `/more.html`, laid out as grouped tiles — Stay Connected, Grow, Belong, your custom pages, and an account section — with the signed-in member's name and photo across the top. Being a real page means it can be linked to, shared, and left with the back button like anything else in the app.

**What triggers a notification automatically:**
- A new **event** is created by admin → "New Event: [title]"
- A new **sermon** is added by admin → "New Sermon: [title]"
- Once a day, if it's someone's **birthday** → "🎉 Happy Birthday!" naming whoever's celebrating (first names only, consistent with the privacy approach used elsewhere)

**Manual announcements** can be sent from the admin dashboard's **Notifications** tab, and — with more control over channel, audience and timing — from the Publicity portal (section 17).

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

## 17. Leadership portals (Coordinator, Finance, Shepherding, Publicity)

The union's back office is split into four signed-in areas, one per office. They share a look and a login system but nothing else: each opens only its own work, so access follows the person holding the office rather than a password everyone knows.

| Portal | URL | What it opens |
| --- | --- | --- |
| Coordinator | `/coordinator.html` | Read-only dashboard across every office, plus who holds which portal |
| Finance | `/finance.html` | Budgets, ledger, reports, CSV export |
| Shepherding | `/shepherding.html` | Attendance registers, member records, contact messages |
| Publicity | `/publicity.html` | Announcements (app + SMS), scheduled sends, events, testimonies |

None of these are linked from the public site. Give each leader their URL along with their credentials.

### Creating accounts

In the admin dashboard, open **Leadership Accounts** → **+ Add Account**. Enter the leader's name, a username, the portal their account should open, and a password (at least 8 characters). The password is shown in plain text while you type it so you can pass it on, then stored hashed — it can never be read back, only replaced.

An account can be disabled without deleting it (untick "Account is active"), which is the right move when someone steps down mid-term.

The old `SHEPHERD_USERNAME` / `SHEPHERD_PASSWORD` pair in `.env` still signs in to the shepherding portal, so nobody loses access the day this ships. Clear it once the shepherding lead has a proper account.

### Coordinator

The coordinator's dashboard reads across all four offices in one screen: balance in hand and this month's movement, the active budget's lines with progress bars, average attendance and the trend across recent services, how many people need following up, what publicity has sent and what is queued, and the counts of join requests, prayer requests and unanswered messages.

A coordinator sign-in also opens the other three portals — in view-only mode, with a banner saying so. They can see everything and change nothing; the office that owns the work still does it.

### Finance

Finance stands on its own, built the way a small finance office actually works.

**Budgets** — a budget covers a period (a term, an academic year) and is made of lines: planned income sources and planned spending areas. Actual figures are never typed into a budget. They are summed live from ledger entries booked against each line, so a budget can't drift out of step with the books. Each line shows planned, actual, variance and a progress bar; income going over plan reads as good, spending over plan reads as a problem.

**Ledger** — every cedi in and out, with the things an auditor asks about: how the money moved (cash, MoMo, bank, cheque), a reference (MoMo transaction ID, receipt number), who paid or was paid, which budget line it belongs to, an approval state for money that needs a second pair of eyes, and who recorded it. Filter by date range, type or budget.

**Reports** — a statement for any period, laid out to be read aloud at a meeting: income by source, expenditure by category, net for the period, and the running balance to date. Monthly movement is charted, and the whole filtered view exports to CSV for a spreadsheet or an audit.

Income sources stay fixed to the union's actual ones — **MoMo, Tithe, Harvest, Offertory, Other** — while expense categories are free text, since spending varies far more than giving does.

### Shepherding

**Attendance** — the register is the centre of this portal. Pick a date (it defaults to the Sunday just gone) and a service, then mark each person Present, Excused or Absent, with a headcount box for walk-in visitors who aren't on any list. A running tally shows how many are in the room as you go. Saving the same date twice updates that register rather than creating a second one, so corrections during the week are just an edit. Every person's attendance rate is available from their row.

**Members** — everyone with an ACONSU account appears automatically with their details pulled live from their account; visitors without accounts can be added by hand. Shepherding can now **edit a member's details** (name, phone, level, department, birthday) — they're the office that finds out a number has changed. Email and password stay with the member, since changing an email from someone else's screen is how people get locked out. Alongside that sits the pastoral layer only shepherding keeps: address, emergency contact, attendance pattern, last contact date and private notes.

**Messages** — everything sent through the app's contact form arrives here, with a reply-by-email button and a handled/unhandled state. A copy is emailed to the shepherding address set under Site Settings (falling back to the main contact address).

### Publicity

**Send an announcement** — one composer, two channels. "In the app" posts to the notification feed and pushes an alert to phones that allowed them; "SMS" texts everyone in the chosen audience who has a phone number on file. The audience can be everyone or a single department, and each option shows how many numbers it will actually reach before you send. A live counter shows the character count and how many SMS segments each recipient will be charged.

**Scheduled** — write it now, send it at the right moment: the night before a programme, or first thing on Sunday. The server checks for due announcements every minute and claims each one atomically before sending, so a restart mid-send can never double-send. Queued items can be cancelled; sent ones keep a record of what happened.

**Events** — publicity keeps the calendar current. Adding an event announces it automatically; editing one offers to post an "Event Update" so people know it moved.

**Testimonies** — members' testimonies land here for review, and publishing one puts it on the public wall. A copy of each new testimony is emailed to the publicity address under Site Settings.

**SMS log** — the last 200 messages the app tried to send and what became of each, so a failed batch can be understood after the fact.

### SMS setup (mNotify)

SMS goes through [mNotify](https://mnotify.com), a Ghanaian bulk-SMS provider, so delivery to MTN/Telecel/AT numbers is direct. Add to `.env`:

```
MNOTIFY_API_KEY=your_api_key
SMS_SENDER_ID=ACONSU
```

The sender ID must be registered with mNotify first and is capped at 11 characters. Numbers are normalised before sending, so `024...`, `+233 24...` and `233...` all work; anything that can't be a Ghanaian mobile number is skipped rather than charged for.

Leave these blank and the app still works: publicity can compose, schedule and target messages, and every intended recipient is logged as "skipped" — nothing is delivered until the credentials are set, and no send silently fails.

### Data privacy note

These portals see phone numbers, addresses, attendance and financial records — meaningfully more sensitive than anything the public site touches. Treat leadership passwords with the same care as the database password, and disable an account the day someone leaves the role.

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

## 20. Multi-chapter platform (Phase 2 of the ACONSU platform spec)

What used to be a single-chapter app (one ACONSU-KNUST) is now built to run **many ACONSU chapters from one deployment**, each with its own members, events, finances, attendance and content, with a National Coordinator overseeing all of them. This section covers what changed and how to switch a live install over.

### Hierarchy

```
National Coordinator          — every chapter (env admin login doubles as this — see below)
      ↓
Chapter Coordinator           — role 'coordinator' — top authority in ONE chapter
      ↓
Chapter Admin                 — role 'chapterAdmin' — day-to-day admin (this is admin.html)
      ↓
Executive / Finance / Shepherding / Publicity / Welfare / Department Leader
      ↓
Members  →  Visitors
```

`coordinator` keeps its original database value on purpose (nothing that already exists had to be renamed) — its *meaning* changed from "read-only rollup" to "highest local authority," gaining approval powers (finance entry approval) and a chapter-wide announcement tool on top of the read access it already had.

### How chapter isolation actually works

Every chapter-owned collection (members, events, departments, finance entries, attendance, shepherding records, join/prayer/testimony/contact submissions, custom pages, sermons, executives, scheduled notifications, SMS logs) carries a `chapterId`. This is enforced **server-side**, not just hidden in the UI (section 43):

- `lib/roles.js` → `getActingScope(req)` decides, from the session alone, which chapter (if any) a request may touch.
- Every chapter-scoped route filters reads and stamps writes through `chapterFilter(req)` / `chapterIdForWrite(req)` — a chapter-scoped account can never read or write another chapter's row even by guessing its id in the URL.
- A `chapterId` in a request **body** is never trusted for who-owns-this — it's always derived from the session server-side.
- National-level accounts (the env admin login, or a real `nationalCoordinator` account) can act across every chapter, and must explicitly pick one (`?chapterId=`) for anything that only makes sense for a single chapter (like the Chapter Coordinator dashboard).
- Notifications and events can be marked national (blank `chapterId` / `isNational: true`) to broadcast to every chapter — everything else defaults to exactly one chapter, never "all of them," unless a route is explicitly a national one.

`test/smoke.js` has a dedicated "chapter isolation" section that spins up a second chapter with its own Finance/Shepherding/Coordinator accounts and asserts none of it is reachable from the first chapter's accounts, including by guessing a document id directly.

### What's new

- **National Coordinator portal** (`/national.html`) — create/edit/activate/deactivate chapters, assign or change a Chapter Coordinator (the outgoing one steps down to Chapter Admin rather than losing their account), a national dashboard with aggregated (never individually-identifying) per-chapter comparison, and national announcements.
- **Chapter Coordinator** (`/coordinator.html`, upgraded) — same dashboard as before, now genuinely scoped to one chapter, plus an Approvals tab (finance entries flagged pending) and a chapter-wide announcement composer.
- **Chapter Admin** — `/admin.html` now accepts sign-in from a `chapterAdmin` or `coordinator` portal account, not only the legacy env admin login. A national/env-admin session gets a chapter picker on the Leadership Accounts form; a chapter-scoped account is auto-confined to its own chapter with no picker shown.
- **Registration** (`/register.html`) — now asks for a chapter, a profile photo (compulsory, section 6), programme and hostel, and a new account starts as a **visitor**, not a full member.
- **Membership workflow** (Shepherding → Membership Workflow tab) — visitor → under review → accepted → assigned shepherd + active, matching section 7. Activating a member issues their membership number and a QR token (the digital membership card and QR attendance scanning that consume these are Phase 3 work — the data is ready for them).
- Public pages pick up which chapter they're showing via a small chapter-selector (`main.js`: `ensureChapterSelected`) — invisible with one active chapter, asks once a second chapter exists, and a signed-in member's own chapter always wins.

### Migrating an existing (single-chapter) install

```bash
node migrate-multichapter.js
```

Safe to re-run — it only ever fills in a **missing** `chapterId`, never overwrites one that's already set. It creates one `Chapter` document from whatever is already in Site Settings, backfills that chapter's id onto every existing document, and grandfathers existing member accounts straight to **active** membership (they already went through the old direct-registration flow, so demoting them to "visitor" would be wrong). Existing admin/member logins are completely unaffected — nothing about how they sign in changed.

### Deliberately not in this pass

Matching the spec's own phased rollout, this pass was the *foundation* (chapter model, isolation, hierarchy, registration, membership workflow, national/chapter portals). Phase 3–4 (below) built directly on it. Community Chat, Groups, Welfare portal, Volunteer scheduling, Live Services, Seminars, E-Book Library, per-chapter payment/donation integration, and the full mobile UX overhaul are still ahead (Phases 5–9 of the spec).

## 21. Core features + spiritual life (Phases 3–4 of the platform spec)

Built directly on the Phase 2 foundation — every new piece below is chapter-isolated the same way (server-side, not just hidden in the UI) and covered by `test/smoke.js`.

**Executive Portal** (`/executive.html`) — an executive signs in with their own portal account (role `executive`) and can only ever edit the one Executive record tied to that account, never anyone else's. Position/department changes are snapshotted into history automatically, the same pattern as a member's academic history. Executives submit events from here, which land in Publicity's review queue rather than publishing directly.

**Event workflow** (section 9) — `Event.status` now runs `draft → submitted → approved/rejected → published`. Events created directly by Admin/Coordinator/Publicity still publish immediately (status defaults to `published`, so nothing existing changed behaviour). Only an executive's submission enters the pipeline: Publicity reviews it (`/api/publicity/events/:id/review`), then publishes it separately (`/api/publicity/events/:id/publish`) once any flyer is attached — the public `/api/events` endpoint only ever returns `published` events to anonymous visitors. Flyers upload through the same placement system as department headers and show on the event's card, on `events.html`, and in a flyer strip on the homepage once published.

**Form Builder** (section 11, `/api/forms`, Publicity portal → Forms) — one generic engine (short text, long text, multiple choice, checkboxes, dropdown, date, time, phone, email, file) reused for event registration, travelling-event sign-ups, executive info, department activities and welfare, so a new kind of form never needs a new schema. Chapter Admin/Coordinator or Publicity can build one; anyone can fill one in; submissions are viewable per-form.

**QR digital membership card + attendance** (sections 13–14) — every active member's card (`/card.html`, linked from Profile) shows a real, scannable QR code (generated server-side via the `qrcode` package, encoding an unguessable token — never the member's id or email). Shepherding's Attendance tab gained a Quick Check-In card: camera scanning via the browser's `BarcodeDetector` API where supported, with a manual name-search fallback everywhere else (section 13 requires this fallback explicitly). Both paths call the same server-side check that identifies the member *and verifies their chapter* before recording anything — a chapter's shepherd can never check in another chapter's member, even with a valid code.

**PDF reports** (section 37, via the new `pdfkit`-based `lib/pdf.js`) — Finance gained a PDF sibling to its existing CSV export; Shepherding gained a per-service attendance report, an attendance-percentage report across a date range, and a membership roster, all downloadable straight from the portal.

**Bible Study** (`/bible-study.html`, section 16) — chapter-scoped entries (topic, date, scripture reference, study material, questions, notes, resources) that link straight into the existing Bible reader (`bible.html` now accepts `?book=&chapter=` for exactly this). Managed from the admin dashboard's new Bible Study tab.

**Sermon Notes** (`/sermon-notes.html`, section 17) — private, member-owned notes (title, preacher, date, scripture, notes, summary, key lessons, reflections). No admin or shepherding view of these exists on purpose — they're personal.

**Prayer Wall** (`/prayer.html`, section 18) — prayer requests now carry a `visibility` (public / private / shepherd-only / anonymous) instead of a plain private flag. Public and anonymous requests appear on a real wall where members can tap "I'm praying for you" (tracked per-member, only a count is ever shown publicly) and the original submitter — or Shepherding, for anonymous ones — can mark a request answered with an optional testimony that then shows on the wall.

### New dependencies

`qrcode` and `pdfkit` — both pure-JS, no native compilation, same class of dependency as the ones already here. `npm audit` flagged 4 pre-existing high/critical advisories in **nodemailer, sharp, and Capacitor's `tar`** dependency (none from these two new packages) — all three fixes are breaking-change major-version bumps to libraries real features depend on (email delivery, image compression), so I left them for a dedicated, tested pass rather than bundling a risky upgrade into this one. Worth prioritizing soon.

## 22. Community, care and giving (Phases 5–6 of the platform spec)

**Social platform icons** — the footer (and anywhere else `socialLinksHtml()` is used) now renders real Facebook/Instagram/YouTube/WhatsApp icons instead of "IG/FB/YT/WA" text, matching the app's existing icon style. Only ever shows a platform a chapter/settings record actually has a link for.

**Groups** (`/groups.html`, `/group.html`, section 20) — Bible Study, Prayer, Fellowship, Cell and other groups, distinct from Departments (a group can optionally sit under one). Each group has a leader — who is very often just a member with no portal login at all, so leader permissions are checked against the member session directly, not the staff-only role system. A group's own leader can update its meeting details, resources, post announcements and log meetings (with attendance) without needing Chapter Admin access; Chapter Admin/Coordinator/Publicity create groups and (re)assign leadership from the admin dashboard's new Groups tab.

**Community Chat** (`/chat.html`, section 19) — chapter-wide discussion topics and replies. Moderation is deliberately simple: hide a message (soft-delete — nothing is destroyed, it just stops showing, from the admin dashboard's Chat Moderation tab), lock a topic, restrict a member from posting further (toggle on the Members tab — they can still read, just not post), and members can report a message to flag it for review.

**Volunteer / Service Scheduling** (section 23) — Publicity assigns ushers/prayer team/media/musicians/protocol/transport/other roles per event (Events tab → Volunteers); a member sees what they've been asked to serve on their Profile page and confirms or declines.

**Member Milestones** (section 36) — birthdays already ran their own daily check; this adds the ones a human has to notice. An executive-appointment notification fires automatically the first time someone sets up their Executive profile. Shepherding can log a graduation, membership anniversary, or anything else worth celebrating from a new Pastoral Care tab, which posts a congratulatory notification to the chapter.

**Welfare** (`/welfare.html`, `/welfare-portal.html`, section 33) — a member submits their own request and tracks its status (never their internal case notes); Shepherding can raise a referral on someone's behalf during pastoral care without seeing the full welfare queue themselves — that stays confidential to Welfare Officers and Chapter Admin/Coordinator, the same boundary a real welfare team keeps. Welfare Officers get their own portal (`/welfare-portal.html`) rather than the full admin dashboard.

**Giving** (`/give.html`, section 32) — deliberately **not** a live payment gateway; nothing in this codebase charges a card or moves money on its own. A member is shown their chapter's real MoMo/bank details (set by National/Chapter Admin under chapter payment config) and logs what they sent — Finance then reconciles each claim from a "Giving Claims" tab into a real ledger entry (or rejects it). This is the same honest, manual-first pattern already used for SMS/email: real, working, and upgradeable to a real gateway later without needing to be torn out.

All of the above is chapter-isolated the same way as everything else in this app, and `test/smoke.js` proves it end-to-end (a member can't read a group they haven't joined, a hidden chat message stays hidden, Finance can't browse the welfare queue, a confirmed gift actually moves the ledger by the right amount, and so on).

## 23. Reliability and security maintenance

The Phase 5–6 community routes now live in focused modules under `routes/` (`groups.js`, `chat.js`, and `member-services.js`). They are registered by `server.js` with the existing authentication and chapter-scoping helpers injected, so the app retains one authoritative session and permission model rather than creating parallel middleware.

This maintenance pass also closes direct-ID chapter-isolation checks for groups, chat topics/messages, and volunteer assignments. A logged-in member must now belong to the same chapter before any of those records can be read, joined, changed, reported, or responded to.

The dependency upgrade moves Nodemailer to 9.x, Sharp to 0.35.x and Capacitor to 8.x. At the time of the upgrade, `npm audit --omit=dev` reported **0 vulnerabilities** and the complete smoke-test suite passed. Android/iOS builds should be synced and built in their native toolchains after pulling this update (`npm run cap:sync`); no payment, email, image, or app data migration is required.

## 24. Media & Content Hub (Phase 7 of the platform spec)

Phase 7 establishes a comprehensive multimedia and resource platform across all ACONSU chapters, with centralized management and granular chapter/national scoping.

### What's included:

- **Live Services** (`/content.html?kind=live_service`, section 24) — embeds responsive YouTube and Facebook livestreams directly in the app, with real-time live status badges and direct stream links. Administrators and Publicity officers can update stream links dynamically without code modifications.
- **Seminars & Workshops** (`/content.html?kind=seminar`, section 25) — multi-stage learning cards supporting the *Snapshot Image ➔ Short Video Preview ➔ Watch Full Session* workflow, with downloadable presentation notes.
- **E-Book Library** (`/content.html?kind=ebook`, section 28) — curated publications library with interactive category filter pills (*Bible Studies, Christian Growth, Devotionals, Leadership, Church History, ACONSU Publications*), in-page search, and direct GridFS PDF downloads.
- **This Week at ACONSU** (`/content.html?kind=weekly_highlight`, section 27) — high-visual highlight strip featuring chapter outreach, fellowship moments, campus events, and celebrations.
- **Founders & Church Heritage** (`/content.html?kind=founder`, `/content.html?kind=church_info`, `/content.html?kind=aconsu_info`, sections 29–30) — dedicated historical profiles and documentation celebrating the founders of the union, the history/vision/mission of The Apostles Continuation Church, and the national ACONSU campus network.
- **Content Manager Portal** (`/content-manager.html`, sections 10, 24–31) — full-featured media management portal with:
  - Drag-and-drop cover photo and PDF document uploads stored directly in MongoDB Atlas GridFS.
  - In-place editing (`PUT /api/admin/content/:id`) with pre-filled forms.
  - Draft vs. Published toggle and category tagging.
  - Type-filter tabs and live search bar.
  - National broadcast switch (`isNational`) for the National Coordinator.
- **Navigation & Discover Integration** (sections 40, 42) — Live Services, Seminars, and E-Books are wired directly into `/more.html` and the Discover page (`/discover.html`), with global search indexing across all published ContentItems.
- **Publicity Portal Linkage** — a dedicated **Media & Content** management tab embedded directly in the Publicity Portal navigation (`/publicity.html`).
- **Feature Flag Gating** (section 39) — National Coordinator can globally toggle `liveStreaming`, `seminars`, and `ebooks` on or off via `/api/national/features`.
- **Automatic Storage Cleanup** — deleting any content item via `DELETE /api/admin/content/:id` automatically deletes its associated cover image and PDF document from GridFS, preventing orphaned storage leaks.

## 25. National Management (Phase 8 of the platform spec)

Phase 8 completes the National Coordinator's toolkit with real-time oversight, historical reporting, feature-flag governance, and cross-chapter announcements — all scoped so that sensitive per-member data never leaves the chapter that owns it (section 38).

### National Dashboard (`/national.html` → Dashboard tab)

A live, aggregated overview across every chapter:
- Total / active chapters, total members, total visitors, executives, upcoming events, and the national financial balance.
- Per-chapter comparison table showing member counts, visitor counts, executive counts, upcoming events, last service attendance, and running balance — never individually-identifying data.
- Generated-at timestamp so the viewer always knows how fresh the numbers are.

API: `GET /api/national/dashboard` (requires `nationalCoordinator` or the env-admin session).

### Chapter Management (Chapters tab)

Create, edit, activate/deactivate chapters, and assign or change each chapter's Chapter Coordinator — all from one screen.

| Action | API |
| --- | --- |
| List all chapters | `GET /api/national/chapters` |
| Create a chapter | `POST /api/national/chapters` (body: `{ id, name, institution?, location?, ... }`) |
| Edit a chapter | `PUT /api/national/chapters/:id` |
| Activate / deactivate | `PATCH /api/national/chapters/:id/status` (body: `{ status: "active" \| "inactive" }`) |
| Assign coordinator | `POST /api/national/chapters/:id/assign-coordinator` (body: `{ username, name, password }` for new, or `{ staffId }` to promote existing) |

Assigning a new coordinator automatically steps down the previous one to Chapter Admin rather than deleting their account.

### Feature Configuration (Features tab)

The National Coordinator controls which optional modules are available platform-wide. A disabled module remains safely stored — it is simply not offered publicly.

Available toggles: Bible, Bible Study, Events, Donations, Welfare, Community Chat, E-Books, Live Streaming, Attendance, Seminars, Prayer Wall, Groups, Departments.

| Action | API |
| --- | --- |
| View current flags | `GET /api/national/features` |
| Update flags | `PUT /api/national/features` (body: `{ modules: { ebooks: false, ... } }`) |

Only recognised boolean keys are accepted — a crafted request cannot add arbitrary configuration fields.

### National Reports

**Live overview** (Reports tab) — chapter-level comparison only, never a list of individual members or finances:

`GET /api/national/reports/overview` → returns per-chapter active members, visitors, event count, services recorded, and open welfare requests.

**Historical snapshots** — persist a point-in-time snapshot of the live dashboard into a `NationalReport` document, useful for tracking growth trends over weeks/months:

| Action | API |
| --- | --- |
| Take a snapshot | `POST /api/national/reports/snapshot` (optional body: `{ region, continent }`) |
| Retrieve history | `GET /api/national/reports/history?from=YYYY-MM-DD&to=YYYY-MM-DD` |

Each snapshot captures total chapters, active chapters, total members, total visitors, national balance, and per-chapter breakdowns at the moment it's taken.

### National Announcements (Announcements tab)

A single composer that reaches every chapter at once — for anything that isn't chapter-specific. Each Chapter Coordinator has their own chapter-wide announcement tool for local news.

`POST /api/national/announcements` (body: `{ title, body, channels: ["app", "sms"] }`)

Channels: `app` posts to the notification feed and fires push alerts; `sms` texts every member with a phone number on file. Blank `chapterId` ensures the notification appears in every chapter's feed.

### Schemas

Two dedicated schemas support this phase:

- **NationalFeature** — `{ key (unique), enabled, description }` with timestamps. Backs the feature-flag toggle UI.
- **NationalReport** — `{ reportDate, region, continent, metrics (Mixed) }` with timestamps. Stores historical snapshots for trend analysis.

### Security

All national routes require `rolesLib.requireNational`, which accepts either:
1. A `StaffUser` account with role `nationalCoordinator`.
2. The legacy env-admin session (`ADMIN_USERNAME` / `ADMIN_PASSWORD`).

A Chapter Coordinator, Chapter Admin, or any chapter-level role receives `401` — `test/smoke.js` verifies this explicitly.
