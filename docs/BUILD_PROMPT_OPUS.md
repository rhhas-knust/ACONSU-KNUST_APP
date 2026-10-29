# Build prompt: ACONSU audit improvements

Paste everything below the line into a new Claude Code session on this repository (model: Opus 5.5).

---

You are working in the ACONSU-KNUST_APP repository: an Express + MongoDB (Mongoose) PWA with a Capacitor Android shell, plain HTML/JS front end in `public/`, a static marketing site in `site/`, and a test suite run by `npm test` (plus a browser suite, `npm run ux`). Node 22.

## Context

An audit found the app is technically strong but has adoption and compliance gaps. Read these first, in this order, before touching code:

1. `README.md` (sections 5, 12, 17, 20, 22, 23, 27)
2. `docs/audit-2026-10-15.md` (the earlier audit; its "Not touched" items are still open)
3. `docs/accessibility-and-privacy.md` (design rules and the privacy promises you must not break)
4. `docs/operations.md`, `docs/offices.md`, `lib/roles.js`, `lib/securityHeaders.js`, `lib/repo.js`, `test/harness.js`

Obey the design rules in `docs/accessibility-and-privacy.md`: no gradients, no pill buttons, no emoji icons, no em dashes in user-facing copy, no invented numbers or reviews, 44px tap targets, WCAG 2.2 AA, no analytics or third-party trackers.

## Hard constraint: there is no domain name yet

The project does not own a domain. Everything that needs one must be built so it works today on the Render URL or localhost, and switches on by configuration the day a domain exists. Concretely:

- Introduce one source of truth for the public address: `PUBLIC_BASE_URL` (already in `render.yaml`). Add a small helper (for example `lib/baseUrl.js`) that returns `PUBLIC_BASE_URL` when set, otherwise derives the origin from the request (`req.protocol` and `req.get('host')`, respecting the existing proxy-trust setting), otherwise `http://localhost:PORT`. Never hardcode a hostname anywhere. Search the repo for hardcoded URLs and replace them.
- Everything below that depends on a domain must be **feature-flagged by environment variable**, off by default, and must fail soft: if the variable is missing, the feature hides itself or falls back, logs one clear warning at start-up, and nothing throws. `/api/health` should report which domain-dependent features are active and which are waiting for configuration.
- Domain-dependent items to prepare but not activate:
  - Email: `MAIL_FROM` and SMTP are already optional. Make password-reset and alert emails build links from the base-URL helper. Document SPF, DKIM and DMARC records to add when the domain exists.
  - Mobile money payments (item 3 below): webhook and callback URLs must be built from the base-URL helper and shown on an admin "Payments setup" screen so the owner can copy them into the provider dashboard once a domain exists. Until then, payments run in a clearly labelled **sandbox/manual mode**.
  - Web push: `VAPID_SUBJECT` must accept a `mailto:` or an `https:` URL; do not require a domain.
  - Open Graph and canonical tags, `sitemap.xml`, `robots.txt`: generate from the base-URL helper; omit canonical and sitemap entries when no `PUBLIC_BASE_URL` is set rather than emitting localhost.
  - PWA `manifest.json` (`id`, `start_url`, `scope`) must stay relative so it survives a domain change. Do not change the existing manifest `id` in a way that would orphan installed apps; if a change is unavoidable, explain it in the docs.
  - Android: Capacitor `server.url`, deep links, and `assetlinks.json` (Digital Asset Links) cannot be finished without a domain. Add a documented placeholder route that serves `/.well-known/assetlinks.json` from an env-supplied JSON string when present and 404s otherwise.
  - CORS and cookies: keep the current no-CORS, host-only cookie behaviour. Do not add a cookie `domain` attribute unless `COOKIE_DOMAIN` is set.
  - Cloudflare, HSTS preload and CSP `connect-src` additions: document only, do not enable.
- Write `docs/when-you-have-a-domain.md`: a numbered checklist of exactly what to set (env vars, DNS records, provider dashboard fields, Play Console fields) the day a domain is bought, with the expected `/api/health` output after each step.

## Work items (do them in this order; one commit per item; each item ships with tests)

### 1. Frictionless signup and phone sign-in
- Registration currently requires email, phone, password, chapter, level, programme, hostel, birthday and consent on one form (`public/register.html`, handlers in `server.js` and `routes/account.js`).
- Reduce the required fields to: full name, phone number, chapter, consent. Everything else moves to the profile page as optional, with a gentle "complete your profile" prompt that is never blocking.
- Make email optional at signup. Password reset must work by SMS code for phone-only accounts (use the existing mNotify wrapper in `lib/sms.js`) and by email link for accounts that have an email.
- Add phone-number sign-in with a 6-digit SMS one-time code as an alternative to password. Codes: hashed at rest, 10 minute expiry, 5 attempts, per-phone and per-IP rate limits, no account enumeration (same response whether or not the number exists), Ghana number normalisation (`024xxxxxxx`, `+23324xxxxxxx` and `23324xxxxxxx` are the same number). When SMS is not configured (no `MNOTIFY_API_KEY`), fall back to password sign-in and say so plainly; in development, log the code to the console only when `NODE_ENV !== 'production'`.
- Keep existing accounts working. Write a migration-safe change (no destructive schema change) and test sign-in for a pre-existing email+password member.
- Guests must still be able to browse events, sermons, the Bible and public pages without an account. Add a test that asserts this.

### 2. WhatsApp sharing as a front door
- Add a reusable share control (`public/js/share.js`, 44px target, keyboard accessible) used on events, sermons, prayer requests (only ones the member chose to make public), the verse of the day, and an "Invite a friend" link on the home page and profile.
- Use `navigator.share` when available, else a `https://wa.me/?text=` link. Share text and links come from the base-URL helper; with no configured domain it must still produce a working link to the current origin.
- Add per-page Open Graph tags (title, description, image) so shared links preview well. Keep them generated from the base-URL helper and omit absolute `og:url` when no `PUBLIC_BASE_URL` is set.
- No tracking parameters, no third-party scripts.

### 3. Mobile money giving (provider-agnostic, sandbox first)
- Create `lib/payments/` with a small provider interface (`createCharge`, `verifyWebhook`, `parseEvent`) and two adapters: `manual` (default; shows the chapter's MoMo number and lets the giver record a reference for the treasurer to confirm) and `paystack` (Ghana mobile money). Select by `PAYMENT_PROVIDER`. Secrets only from env (`PAYSTACK_SECRET_KEY`); never log or return them.
- Webhook endpoint `POST /api/payments/webhook/:provider`: verify the signature with a timing-safe compare, be idempotent by provider reference, reject unknown references, and never trust amounts from the client. Raw-body handling must not break the existing JSON parser.
- A confirmed payment creates a pending income entry in the finance ledger (`INCOME_CATEGORIES` already has `momo`, `tithe`, `harvest`, `offertory`) in the right chapter, flagged `source: 'online'`, so the Treasurer and Financial Secretary reconcile it in their existing screens. Respect the dual-control rule already in place for offerings.
- Giver UI on `public/give.html`: amount, purpose, MoMo number and network; clear states for pending, paid, failed; works without an account; receipt shown on screen (and by SMS or email when configured).
- Admin "Payments setup" screen shows the exact webhook URL to paste into the provider (built from the base-URL helper) and the current mode (manual, sandbox, live). Live mode requires `PAYMENT_MODE=live` explicitly.
- Tests use a fake provider adapter and signed sample webhooks; include replayed-webhook, bad-signature, wrong-amount and wrong-chapter cases.

### 4. Leader "Today" screens and first-run checklists
- For each portal (coordinator, finance, shepherding, publicity, executive, welfare, chapter admin), add a default "Today" view at the top showing at most 5 actions that role performs weekly, each a single large button with a count where one exists (for example "3 offerings waiting", "12 people not seen in 30 days"). Everything else stays reachable under "All tools", collapsed by default on phones.
- Add a dismissible first-run checklist per role (stored per account) with 3 to 6 steps and a link to the how-to video at `public/video/how-to-aconsu.mp4`.
- Do not remove any existing panel or permission. This is a presentation layer over `lib/roles.js`; do not change what any role can do.

### 5. Privacy promises made true
- **Erase my data:** one `lib/eraseMember.js` routine, used by both the admin "delete member" button and a new self-service "Delete my account" on the profile page. Enumerate every collection that holds a member id (the audit counted about 21: prayer requests, chat, event registrations, attendance, alumni profile, welfare entries, linked leadership login, push subscriptions, sessions, notifications, streaks and badges, uploaded files). For each, decide delete or anonymise, and keep finance ledger rows but strip the person's name. Revoke all sessions and close any linked leadership login. Require password or SMS-code re-confirmation. Write a test that fails if a new Mongoose model with a member reference is added and not handled (derive the list from the schema, do not hardcode).
- **Export my data:** `GET /api/me/export` returns a JSON (and optional CSV zip) of everything held about the member. Rate-limited, requires re-confirmation.
- Update `public/privacy.html` and `site/privacy.html` to describe exactly what these do and how long records are kept; bump `POLICY_VERSION`.
- Add retention jobs (configurable, safe defaults) for notifications, SMS logs, chat and contact messages. Run them from the existing scheduler but guard with a database lock so two instances cannot run them twice.

### 6. Second step for leadership accounts
- Add TOTP (authenticator app) two-step sign-in for every account that can reach finance, welfare, shepherding, coordinator or national data. Enrolment screen with QR code (the `qrcode` package is already a dependency), 10 single-use recovery codes stored hashed, and a documented admin reset path that is itself audited. Use a vetted TOTP implementation with a small dependency or a short audited in-repo one using `crypto`; allow a +/- 1 step window; block code reuse.
- Raise the minimum leadership password length to 12 and add a per-account lockout with exponential backoff (in addition to the per-IP limit).
- Roll out safely: add an `ENFORCE_LEADER_2FA` env flag (default off) with a 14 day grace period shown as a banner, so no leader is locked out on deploy day. Existing sessions keep working until they expire.

### 7. Chapter isolation by default
- Make the data layer (`lib/repo.js`) refuse reads and writes on the chapter-scoped record types unless a chapter filter (or an explicit `{ allChapters: true }` opt-in by a national actor) is supplied. Add a test that enumerates every route and fails if a chapter-scoped model is queried without it. Keep the behaviour of the national tier described in `GOVERNANCE_TIER_REVIEW.md`: national actors see aggregates and national records by default, not merged chapter member data.

### 8. Offline resilience for the people who need it most
- Add an offline outbox (IndexedDB plus the service worker) for Sunday check-in and the prayer and contact forms: submissions made without signal are queued, shown as "waiting to send", and replayed in order with idempotency keys when the connection returns. The server must accept the idempotency key and ignore duplicates. Bump the service worker `CACHE_NAME`.

### 9. Maintainability and hardening
- Continue extracting `server.js` by area into `routes/` (start with payments, account, notifications). No behaviour change; the full suite must stay green after every extraction.
- Remove `'unsafe-inline'` from `script-src` in `lib/securityHeaders.js` by moving inline scripts to files (use nonces only where moving is impractical). Keep `style-src` as is unless trivial. The browser suite must still pass.
- Decide and implement alumni photo handling: stop committing `site/images/alumni` to git history; keep photos in the app's file storage and have the site refresh fetch them at publish time.
- Add a linter (ESLint, minimal config, no style bikeshedding) and a CI step. Make the browser suite job blocking once it passes twice locally.

### 10. Minimal, privacy-respecting measurement
- Add a National-only "Health" panel with first-party counts only: sign-ups completed vs started, weekly active members, share clicks (counted server-side on the share endpoint, no identifiers), payments by status. No cookies, no third-party scripts, no per-person tracking. Document it in the privacy page.

## How to work

- Branch: use the branch the session gives you. Do not push elsewhere. Do not open a pull request unless asked.
- Before each item: write the failing test first, see it fail, then implement. After each item: run `npm test`, and `npm run ux` for anything that touches the UI. Fix regressions before moving on. Report test counts honestly; if something cannot be tested in this environment (real phone, live SMS, live provider), say so in the commit body and in `docs/`.
- Never commit secrets. New env vars go in `.env.example` with a comment, and in `docs/operations.md`.
- Database changes must be backward compatible and idempotent (this app runs on Atlas with real data). Do not drop fields or collections. Write any one-off migration as a script under `scripts/` that supports a dry run.
- Match the surrounding code's style, comment density and naming. Do not reformat files you are not changing.
- Keep user-facing copy plain and short, readable by a first-year student on a low-end phone.
- Update `README.md` (add concise sections, do not bloat it), `docs/audit-2026-10-15.md` (mark items fixed, with evidence), and `docs/when-you-have-a-domain.md`.

## Done means

- Every item above is implemented, tested and committed separately, or explicitly listed as blocked with the reason.
- `npm test` passes, `npm run ux` passes, `npm audit --omit=dev` reports 0.
- With **no** `PUBLIC_BASE_URL`, no SMTP, no SMS key and no payment keys, the app boots, `/api/health` lists what is waiting for configuration, and every flow degrades to its manual or fallback path without an error.
- A final summary lists: what changed, what is feature-flagged off and what exact env var turns it on, what needs a domain, what I still need to do by hand (Atlas backup check, provider accounts, real-phone TalkBack and Rooms tests), and anything you chose not to do and why.

Ask me before: deleting any existing user-visible feature, changing an existing role's permissions, adding a paid third-party service, or anything that would be hard to undo in the production database.
