# Running ACONSU: the checks that keep it safe

Four things that live in dashboards rather than in the code, so the code cannot
check them for you. None takes long.

## 1. Is production mode on?

Several protections only switch on when `NODE_ENV=production` is set in the
Render environment: cookies that only travel over HTTPS, the HSTS header, the
refusal to start on a default admin password, and error pages that hide details.

Open `https://<your-app>/api/health`. It should say:

```json
{ "ok": true, "production": true, "warnings": [], ... }
```

If it says `"production": false`, or `warnings` is not empty, open Render, then
the service, then **Environment**, add `NODE_ENV` with the value `production`,
and let it redeploy. Do this before anything else here.

`render.yaml` in the project root describes the same setup, for when the service
is ever created again. It does nothing to a service that already exists.

## 2. Keeping it awake

On Render's free plan a service goes to sleep after about 15 minutes with no
visitors and takes up to a minute to wake. Two things suffer: the first person
to arrive waits, and the jobs that run inside the app (scheduled announcements,
birthday messages, new-member follow-ups) do not run while it sleeps. They run
late, when it next wakes, rather than not at all.

Two fixes, either is enough:

- **Free:** make an account at a free uptime monitor (UptimeRobot, Better
  Stack and Freshping all have free plans), add an HTTPS monitor for
  `https://<your-app>/api/health` with a 5 minute interval. It also emails you
  when the app is down, which is worth having anyway.
- **Paid:** a Render plan that does not sleep.

Do not run two copies of the app at once. The scheduled jobs would each run in
both, and people would get every message twice.

## 3. Backups

The whole app, including every uploaded photo and PDF, lives in one MongoDB
Atlas database. **A free (M0) Atlas cluster has no backups.** The cluster is
copied across three machines so one failing does not lose anything, but that is
not a backup: a mistake, a bad deploy or a deleted record is copied to all three.

**Find out which you have.** Atlas, then the cluster, then the **Backup** tab.
If it asks you to upgrade, there are no backups.

Then pick one:

- **Upgrade the cluster** to a size that includes backups, and set the retention
  you want. The simplest and the most reliable.
- **Take your own copies** with `scripts/backup.sh`, from a computer you control:

  ```bash
  # once: install MongoDB Database Tools (gives you `mongodump`)
  export MONGODB_URI='mongodb+srv://...'          # the same value the app uses
  export BACKUP_PASSPHRASE='a long phrase you will not lose'
  ./scripts/backup.sh                              # saves to ~/aconsu-backups
  ```

  Run it weekly at the least, and before any big change. Keep the passphrase
  somewhere other than that computer. The copy holds every member's details, so
  it is locked with the passphrase, saved with owner-only permissions, and the
  script refuses to save into a git repository. Copies older than 60 days are
  removed. Keep one copy somewhere other than the computer (an external drive,
  or a cloud drive that only you can open).

### Restoring

Do this once now, into a scratch database, so you know it works before you need it.

```bash
# if the copy is locked with a passphrase:
openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE \
  -in aconsu-2026-10-15-0900.archive.gz.enc -out restore.archive.gz

# into a SCRATCH database first (a second free Atlas cluster is fine):
mongorestore --uri='mongodb+srv://.../?...' --gzip --archive=restore.archive.gz
```

Check that members, events and the Media Library look right in the scratch copy.
To restore for real, point `--uri` at the live database and add `--drop`, which
replaces what is there with the copy. That throws away everything newer than the
copy, so only do it when the live data is already lost or wrong.

## 4. When something is wrong

1. Open `/api/health`. `"ok": false` and a database state other than `connected`
   means the database is the problem: check Atlas (cluster paused, password
   changed, network access list) before touching the app.
2. Render, then the service, then **Logs**. A sentence starting
   `Refusing to start in production` says which setting is missing.
3. A change that broke something: Render keeps earlier deploys. **Deploys**, then
   an earlier one, then **Rollback**.

## 5. What is waiting for a setting

`/api/health` lists the parts of the app that need a setting before they
switch on, under `features` (each with `on` and the setting it `needs`) and
`waitingForConfiguration` (the names still off). The same list is printed once
in the logs at start-up, starting `Waiting for configuration`. Waiting is
normal: the app works without every one of them.

| Name in `/api/health` | Switched on by | Without it |
|---|---|---|
| `publicAddress`, `searchEngines` | `PUBLIC_BASE_URL` | Links use Render's own address; no sitemap |
| `linksInMessages` | `PUBLIC_BASE_URL` or Render's own address | No password reset emails in production (they are never built from the request's address) |
| `email` | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` (and `MAIL_FROM`) | No email |
| `pushNotifications` | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | No push notifications |
| `androidAppLinks` | `ANDROID_ASSET_LINKS` | Links do not open in the Android app |
| `sharedCookieDomain` | `COOKIE_DOMAIN` | Off on purpose; leave it unset |

A setting that is there but malformed (`PUBLIC_BASE_URL` with a path, a
`COOKIE_DOMAIN` that is not a domain) is ignored, and `warnings` in
`/api/health` says so. The step-by-step for the day a domain is bought is
[when-you-have-a-domain.md](when-you-have-a-domain.md).

## 6. Old records are cleared daily

A job deletes notifications, the record of texts sent and contact-form
messages older than 12 months, and chat messages older than 2 years. Change
any of these with `RETAIN_NOTIFICATIONS_DAYS`, `RETAIN_SMS_LOG_DAYS`,
`RETAIN_CONTACT_MESSAGES_DAYS` or `RETAIN_CHAT_DAYS` (days; 0 keeps for
ever), and change the privacy page to match. When it removes anything, the
log says `Retention: removed ...`. It takes a lock in the database first
(the `systemstates` collection, row `lock:retention`), so two copies of the
app running at once never both run it; a lock left by a copy that crashed
lapses after 30 minutes.

## 7. A leader cannot sign in

- **"Too many wrong tries on this account"**: it rests for a minute, doubling
  with each further wrong try up to an hour. Their Chapter Coordinator presses
  **Unlock** on the leadership accounts list.
- **Lost the phone with their authenticator app**: they sign in with one of
  their ten recovery codes, then make new ones on My Account. Out of codes:
  **Reset second step** on the accounts list. The reset is recorded on the
  account, signs them out, and they set it up again at their next sign-in.
- **Only the "One more step" screen opens**: `ENFORCE_LEADER_2FA` is on and
  their 14 days to set up a second step are over. Setting it up (two minutes)
  opens the portal again.
- **Codes are always "not right"**: the phone's clock is off. Set the time to
  automatic in the phone's settings.
- **Every leader's codes stopped working at once**: `SESSION_SECRET` was
  changed. The secrets are sealed with it; each leader needs a reset.

## 8. "Chapter guard" in the logs

The data layer refuses a read or write on people's records that does not
say which chapter it is about (README section 30). Every such place found in
the code and tests has been fixed, but one the tests do not reach could
still turn up in production, as an error on one page and `Chapter guard:`
in the logs, naming the line. To keep the page working while it is fixed:
Render, **Environment**, `CHAPTER_GUARD=warn`, save. The place is then
logged once (`CHAPTER GUARD: ...`) and let through. Remove the setting once
the fix is deployed.
