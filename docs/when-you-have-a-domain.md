# When you have a domain

ACONSU has no domain name yet. Everything works today on Render's address
(`https://aconsu-knust-app.onrender.com`) and on a developer's machine. The
parts that need a domain wait quietly for a setting and say so in
`/api/health`. This is the list of exactly what to set, in order, on the day a
domain is bought.

Below, `example.org` stands for the domain you buy. The plan is:

- **`app.example.org`** for the app (members, leaders, the portals).
- **`www.example.org`** for the public website (`site/`), with the bare
  `example.org` sending people there.

Keeping the app and the website on separate names means either can move
without the other.

## How to read `/api/health`

Open `https://<the app's address>/api/health`. Two parts matter here:

- **`features`**: each setting-dependent part of the app, with `on` (true or
  false) and `needs` (the setting that switches it on).
- **`waitingForConfiguration`**: the names of the ones still off.

Only names and true or false are shown, never a value. Waiting is normal: the
app works without every one of them.

## 0. Before you start

Open `/api/health` on the Render address and keep a copy. On Render today,
with no email or push keys set, you should see:

```json
"waitingForConfiguration": ["publicAddress", "email", "pushNotifications", "searchEngines", "androidAppLinks"]
```

`linksInMessages` is not in the list. Render tells the app its own address, so
password reset links already work (once email is set up).

## 1. Buy the domain

Any registrar works (Namecheap, Cloudflare, a Ghanaian `.com.gh` registrar).
Turn on auto-renew. A domain that lapses takes the app's address with it, and
someone else can buy it.

Nothing changes in `/api/health`.

## 2. Point `app.example.org` at Render

1. Render → the ACONSU service → **Settings** → **Custom Domains** → **Add**,
   and type `app.example.org`.
2. At the registrar, add the record Render shows. For a name like `app.`, that is
   a **CNAME** record: name `app`, value `aconsu-knust-app.onrender.com`.
3. Wait until Render shows the domain as verified and the certificate as issued.
   This takes minutes to a few hours.
4. Open `https://app.example.org/api/health`. It should answer, with the same
   list as step 0.

The old Render address keeps working. Leave it working.

## 3. Tell the app its address

Render → the service → **Environment** → set:

```
PUBLIC_BASE_URL=https://app.example.org
```

Just the address: `https://`, the name, no `/` at the end, no path. Saving it
redeploys the app.

`/api/health` afterwards:

```json
"features": { "publicAddress": { "on": true, "using": "PUBLIC_BASE_URL", ... }, "searchEngines": { "on": true, ... } }
"waitingForConfiguration": ["email", "pushNotifications", "androidAppLinks"]
```

What changed: password reset links now point at `app.example.org`, and
`/robots.txt` and `/sitemap.xml` now tell search engines where the public pages
are. If the start-up log says `PUBLIC_BASE_URL is set but is not an address`,
the value has a typo; the app ignores it and carries on using Render's address.

## 4. Email from the domain

1. Pick an email provider that offers SMTP (Zoho Mail, Google Workspace,
   Brevo, Mailgun and others) and add `example.org` to it.
2. Add the DNS records the provider gives you. Without these, mail from the app
   lands in spam:
   - **SPF**: one `TXT` record on `example.org`, like
     `v=spf1 include:<what your provider says> ~all`. Only ever one SPF record:
     if one exists, add the provider's `include:` to it.
   - **DKIM**: a `TXT` (or `CNAME`) record on a name like
     `<selector>._domainkey.example.org`, copied exactly from the provider.
   - **DMARC**: a `TXT` record on `_dmarc.example.org`:
     `v=DMARC1; p=none; rua=mailto:dmarc@example.org`.
     After two to four weeks of clean reports, change `p=none` to
     `p=quarantine`.
3. Render → **Environment**:

```
SMTP_HOST=<from the provider>
SMTP_PORT=587
SMTP_USER=<from the provider>
SMTP_PASS=<from the provider>
MAIL_FROM=ACONSU <no-reply@example.org>
```

`/api/health` afterwards: `"email": { "on": true }`, and `email` is gone from
`waitingForConfiguration`. Test it: ask for a password reset on your own account.

## 5. Push notifications

Push does not need a domain, and may already be on. If `pushNotifications` is
still waiting, generate keys once (`npx web-push generate-vapid-keys`) and set:

```
VAPID_PUBLIC_KEY=<public key>
VAPID_PRIVATE_KEY=<private key>
VAPID_SUBJECT=mailto:admin@example.org
```

`VAPID_SUBJECT` is a contact for the push services: a `mailto:` or an
`https://` address. A plain email address also works. **Never change the keys
once members have turned notifications on**: every phone subscribed with the
old keys stops receiving them.

`/api/health` afterwards: `"pushNotifications": { "on": true }`.

## 6. The public website on `www.example.org`

1. GitHub → the repository → **Settings** → **Pages** → **Custom domain**:
   `www.example.org`. Save.
2. At the registrar:
   - `CNAME` record: name `www`, value `rhhas-knust.github.io`.
   - For the bare `example.org`, four `A` records:
     `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
     (check them against GitHub's own Pages documentation on the day).
3. Back in **Pages**, tick **Enforce HTTPS** once it can be ticked.
4. GitHub → your account → **Settings** → **Pages** → **Add a verified
   domain**. This stops anyone else putting a site on your domain.
5. Tell the website where the app is. Repository → **Settings** → **Secrets and
   variables** → **Actions** → **Variables** → **New repository variable**:
   `APP_URL` = `https://app.example.org`. Then **Actions** → **Landing site** →
   **Run workflow**. The publish writes the new address into the pages
   (`site/tools/app-address.js`); the files in the repository do not change.
6. Tell the app the website's new address, so the alumni form can still reach
   it. Render → **Environment**:

```
SITE_ORIGINS=https://www.example.org,https://rhhas-knust.github.io
```

Keep the old one in the list for a few weeks, while old copies of the page
are still open in people's browsers.

`/api/health` does not change: this is the website, not the app. Check it by
sending yourself an alumni form from `www.example.org`.

## 7. The Android app

1. Play Console → the app → **App integrity** (under Test and release) → **App
   signing**. Copy the **Digital Asset Links JSON** shown there.
2. Render → **Environment**, the JSON on one line:

```
ANDROID_ASSET_LINKS=[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"android_app","package_name":"com.aconsu.app","sha256_cert_fingerprints":["..."]}}]
```

`/api/health` afterwards: `"androidAppLinks": { "on": true }`, and
`https://app.example.org/.well-known/assetlinks.json` shows that JSON. Before,
it answers "Not set up yet".

3. The app itself needs a code change and a new release, because the address
   is built into it:
   - `capacitor.config.json`: `server.url` → `https://app.example.org`.
   - `android/app/src/main/AndroidManifest.xml`: an `intent-filter` with
     `android:autoVerify="true"` for `https://app.example.org`, so links open
     in the app.
   - Rebuild, then release the update through the Play Console.

   Until members update, their app keeps opening the Render address, which
   keeps working.

## 8. Members' installed web app

Browsers treat the new address as a different app. Someone who installed ACONSU
from the Render address keeps that copy, and it keeps working, because the
Render address stays up. They also stay signed in there and have to sign in
once on the new address (a sign-in belongs to one address).

So:
- Announce the new address (`app.example.org`) and ask members to open it, add
  it to their home screen, and remove the old one.
- Do not redirect the Render address to the domain for at least a semester. A
  redirect would push old installs out of the app and into a browser tab.

## 9. Leave these alone

- **`COOKIE_DOMAIN`**: leave it unset. Sign-in then belongs to
  `app.example.org` alone, which is what we want. It is only for sharing
  sign-in across several names, which ACONSU does not do.
- **Cloudflare** (README section 4): worth adding later, once everything above
  works. It needs no change in the app.
- **HSTS preload**: do not. It tells browsers never to use plain http on the
  domain and every name under it, it takes months to undo, and it breaks
  any name that is not on https yet.
- **The page security rule's `connect-src`**: nothing to add. The app only talks
  to itself.
- **The installed app's identity** (`public/manifest.json`'s `id`, `start_url`,
  `scope`): already relative, so nothing to change. Do not change `id`: every
  installed copy is known by it.

## 10. Giving

Giving is manual for now: members send MoMo to the chapter's number and tell the
Treasurer the reference. Nothing to set for the domain. If an online payment
provider is chosen later, its setup screen will show the exact address to paste
into the provider's dashboard, built from `PUBLIC_BASE_URL`.

## All the settings in one place

| Setting | Where | What it is | Without it |
|---|---|---|---|
| `PUBLIC_BASE_URL` | Render | The app's address, `https://app.example.org` | Links use Render's address; no sitemap |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Render | The email account the app sends from | No email; everything else works |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Render | Push notification keys and contact | No push notifications |
| `ANDROID_ASSET_LINKS` | Render | The JSON from the Play Console | Links do not open in the Android app |
| `SITE_ORIGINS` | Render | The website's address(es), comma-separated | The alumni form only works from `rhhas-knust.github.io` |
| `COOKIE_DOMAIN` | Render | Leave unset | (correct as it is) |
| `APP_URL` | GitHub repository variable | The app's address, for the website | The website points at Render's address |
