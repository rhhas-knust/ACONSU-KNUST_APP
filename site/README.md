# The chapter landing site

A plain website for a chapter: who you are, when you meet, how to reach you.
**No server, no database, no build step, and nothing to pay for.** Five files
and a logo.

It is deliberately separate from the ACONSU app. The app is a members' system
and will keep growing; this is the page you can give to someone today.

## Publishing it, for free

Any of these host a folder of files at no cost and with no cold start — the
page is already there when someone opens it, unlike a server that has to wake
up first.

| Where | How |
|---|---|
| **GitHub Pages** | Repo → Settings → Pages → Source: **GitHub Actions**. That is all — `.github/workflows/pages.yml` does the rest, and republishes whenever anything in `site/` changes on `main`. |
| **Netlify** | Drag this `site` folder onto app.netlify.com. That is the whole process. |
| **Cloudflare Pages** | Connect the repo, set the build output directory to `site`, leave the build command empty. |

### Why a workflow for GitHub Pages and not just a folder setting

Publishing from a branch, GitHub Pages offers exactly two folders: the repo
root and `/docs`. **It cannot be pointed at `site/`.** The alternatives were to
rename this folder to `docs/` — misleading, and it would fight with any real
documentation later — or to keep a second copy of it on a `gh-pages` branch
that somebody has to remember to sync. The workflow keeps one copy, here, and
publishes it.

You do not have to run anything. Set the source to GitHub Actions once, and
every push that touches `site/` republishes.

All three give you a free `https://` address. A custom domain (say
`aconsuknust.org`) is the only part that costs money, and only if you want one
— it is roughly GHS 150–250 a year, and the hosting above stays free either
way.

### About the address

GitHub Pages will serve this at `rhhas-knust.github.io/ACONSU-KNUST_APP/` —
the app's repository name, in the address of a church landing page. Every path
in these files is relative, so it works perfectly well there; it just reads
oddly.

Two ways to a cleaner address, if it matters:

- **A custom domain.** Works with all three hosts above, costs money.
- **A repository named `rhhas-knust.github.io`**, which GitHub serves at the
  bare `rhhas-knust.github.io`. That is a *separate repository*, not a branch —
  copy this folder into it. Free.

Netlify and Cloudflare both hand you a tidier free address than GitHub does
(`aconsu-knust.netlify.app`), so if the address bothers you and a domain is out
of reach, start there.

## Making it yours

Edit **`chapter.js`**. Nothing else. It is the only file with your details in
it, and every field is commented.

Then replace `images/logo.jpg` with your own.

### Anything left blank disappears

This is the rule the whole site is built on. A blank phone number does not
render an empty row. No service times hides the whole "When we meet" section —
*and* removes the "Plan a Visit" button that would have scrolled to it, because
a link to a section that is not there is a promise the page does not keep.

So **publish it today with half of it filled in.** It will look finished, not
abandoned. Fill in the rest as you get it.

### Before you publish, fill in at least

- `serviceTimes` — when and where you actually meet. Until this is set, the
  whole "When we meet" section is hidden, and that is the one thing a visitor
  came for.
- `contact.email` or `contact.phone` — some way to reach a person.

Everything else already has sensible content in it.

## Another chapter

Copy this folder, change `chapter.js`, change the logo. That is the whole job.
Nothing in the other files is specific to KNUST.

## What is in here

| File | What it is |
|---|---|
| `chapter.js` | **Your details.** The only file you edit. |
| `index.html` | The page structure. |
| `styles.css` | ACONSU's colours and type. Follows the reader's light/dark setting. |
| `site.js` | Fills the page from `chapter.js` and hides what is empty. |
| `images/` | Your logo, and any photos you add. |

## Looking at it before you publish

Open `index.html` in a browser. It works straight off the disk — no server
needed. What you see is what gets published.
