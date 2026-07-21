# ACONSU Web App

Official website + admin backend for **ACONSU — The Apostles' Continuation Students Union**.

## What's included

- **Public site**: Home, About, Departments (list + individual pages with meeting info and a "Join" form), Events (with live countdown), Sermons & Media, Prayer Wall (prayer requests + testimonies), Contact.
- **Admin dashboard** (`/admin.html`): password-protected. Add/edit/delete departments, events, and sermons; view and manage join requests, prayer requests, testimonies and contact messages; edit site-wide settings — no code required.
- **MongoDB Atlas** as the data store — a real cloud database with automatic backups and replication, so content survives redeploys and server restarts.
- **Security hardening**: rate-limiting on login and public forms, secure session cookies, security headers (via Helmet).

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
PORT=3000
NODE_ENV=development
SESSION_SECRET=some_long_random_string
ADMIN_USERNAME=your_admin_username
ADMIN_PASSWORD=a_strong_password
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

Visit `http://localhost:7000` for the public site, and `http://localhost:7000/admin.html` to log in.

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
  migrate-to-mongo.js      One-time import of old local JSON data into Atlas
  capacitor.config.json    Native app (iOS/Android) wrapper config
  data/                    Old local JSON files — kept only as the migration source
  public/
    index.html, about.html, departments.html, department.html,
    events.html, media.html, prayer.html, contact.html,
    login.html, register.html, profile.html, page.html, admin.html
    manifest.json           PWA app manifest
    sw.js                   Service worker (offline support)
    icons/                  Generated app icons, all sizes
    css/style.css           Design system (colors, type, components)
    js/main.js              Shared header/footer, countdown, auth state, PWA install, toasts
    js/admin.js             Admin dashboard logic
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
- **Toast notifications** confirm actions (join a department, submit a prayer request, register for an event) with a small notification in the corner, in addition to the inline message.
- **Scroll-reveal animations** — cards fade/slide into view as you scroll instead of popping in all at once.
- **Skeleton loading placeholders** on the About page while executive data loads, instead of a blank gap.
- **Visible focus outlines** on buttons/links/inputs for keyboard navigation and accessibility.
- Floating images and card hover/lift effects add some life without slowing the site down — they're disabled on mobile screens to keep things fast and uncluttered there.

## 11. Member accounts

Regular members (students, not admins) can now create their own accounts, separate from the admin login:

- **Sign up**: `/register.html` — name, email, password, optional phone and level.
- **Log in**: `/login.html`.
- **Profile**: `/profile.html` — update name/phone/level, upload a profile photo, change password, log out.

Logged-in members see their first name in the header (instead of "Log In"), linking straight to their profile. Passwords are hashed with bcrypt before ever touching the database — the app never stores or can see a plain-text password. Admin can see the full member list under **Members** in the admin dashboard (read-only for now — no editing/deleting from there yet; let me know if you want that added).

This is intentionally kept separate from admin auth — a member account can never access `/admin.html`, and an admin login can't be used to log into a member profile.

## 12. Installable App (PWA)

The site is now a full Progressive Web App — visitors on phones will see an "Install ACONSU App" prompt (or can use "Add to Home Screen" from their browser menu), after which it opens full-screen with its own icon, no browser bar, and works offline for pages already visited.

What's included:
- `manifest.json` — app name, icons (generated from your logo, all standard sizes), theme colors, and quick-action shortcuts to Events, Prayer Wall, and Sermons.
- `sw.js` (service worker) — caches the app shell and visited pages so the site loads instantly and works with a spotty or no connection. API data is always fetched fresh when online, and only served from cache as a fallback when offline. The admin dashboard is deliberately never cached, so it always reflects live login state.
- Icons in `/public/icons/` — generated from `logo.jpg` in every size iOS/Android expect, plus a "maskable" version for Android's adaptive icon shapes.

No setup needed — this works automatically once deployed over HTTPS (required for service workers; Render/Railway provide this by default).

## 13. Native App (iOS / Android) via Capacitor

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

## 14. Design

Palette pulled from the ACONSU crest: deep purple (`#5B2C82`) and rich plum (`#3A1B54`) as primary, a light lilac background, with the crest's flame rendered as a gold-to-red gradient accent on key call-to-action buttons and the homepage hero. Headings use Fraunces (serif, for warmth and gravity); body text uses Manrope (clean, easy to read on mobile).
#   A C O N S U - K N U S T A P P  
 