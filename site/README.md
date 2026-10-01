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

### The freshers link

`freshers.link` takes either of two things, and they are not the same:

| What you paste | What it does |
|---|---|
| `https://chat.whatsapp.com/XXXXXXXX` | Joins the group. In WhatsApp: open the group → tap its name → **Invite to group via link** → Copy link. This is almost certainly what you want. |
| `0547541623` | Opens a chat with that person, with `freshers.message` typed in ready to send. |

Write a number however you normally would — `0547541623`, `+233 547 541 623`,
`(0244) 000-000` all work. WhatsApp actually needs the international form with
no leading zero, and the page converts it for you using `countryCode`.

A group invite cannot carry a prefilled message; WhatsApp does not allow it, so
`message` is ignored for one.

**Blank the link and the whole band disappears** — which is how you take it
down when freshers' week is over.

### A photo behind the heading

Set `heroImage` to a file in `images/`, written relative to this folder:

```js
heroImage: 'images/header.jpg',
heroImageTone: 'dark',
```

Blank keeps the purple-and-gold gradient, which is a perfectly good header —
only use a photo if it is a good one.

**What makes a good one:** wide rather than tall (it is cropped to a band),
busy at the edges rather than the middle, since the heading sits over the
centre. A congregation, the auditorium, the campus.

**Size it first.** About 1600px wide and under 300KB. A 4MB photo straight off
a phone costs a fresher on campus data real money and several seconds — and it
is the first thing on the page, so nothing else shows until it loads.

`heroImageTone` decides the words, not the picture: `dark` puts the heading in
white over a darkened photo and suits almost anything; `light` keeps the purple
heading and lays a pale wash over instead, for a very pale photo. The photo
never goes on bare either way, so the heading stays readable whatever you
photographed.

### Pictures on the activities

Each entry in `ministries` takes an optional `photo`, shown as a band across
the top of its card:

```js
{ name: 'Prayer', blurb: '…', photo: 'images/prayer.jpg' },
```

A card without one starts at its heading rather than showing a grey box, so
you can add pictures as you take them. About 1200px wide is plenty — they are
displayed roughly 400px across.

### You do not have to resize anything

Upload the photo straight off your phone. **A workflow shrinks anything
oversized before the site is published**, and commits the smaller file back to
the repo.

A phone photo is typically 4–12MB and several thousand pixels wide. Nothing on
this page is displayed wider than 1600px, so all that weight buys nothing and
costs a visitor on campus data real money and several seconds. The shrinker
brings a 12MB photo down to a couple of hundred KB.

It only ever makes files smaller, and it only ever asks one question: **is
this wider than 1600px?**

- Anything already that narrow is left byte for byte as it was — however many
  times the workflow runs.
- If re-encoding would make a file *bigger*, the original is kept.
- Which way up the phone was held is honoured, so nothing arrives sideways.
- PNGs stay PNGs, so a logo keeps its transparency.

Deciding on **file size** instead would look more thorough and would be wrong:
whether a file is "too big" does not stop being true after one pass, so a photo
that is still large after shrinking comes back every run, gives up another
slice of quality, and is committed again. Width settles after one pass and
stays settled.

You can also run it yourself before committing:

```
node site/tools/shrink-images.js
```

### Who leads the chapter

Two lists in `chapter.js`, both optional:

- **`coordinators`** — photo, name, role, a sentence or two, and contact. A
  chapter with two coordinators lists two; the cards sit side by side.
- **`executives`** — just the name and the office. President, Vice President,
  General Secretary, Organising Secretary, and whatever else you hold.

Photos go in `images/` and the path is written relative to this folder:
`photo: 'images/coordinator-yaw.jpg'`. **Somebody with no photo yet gets their
initials in a circle**, so put the names up now and add the pictures when you
have them.

Phone numbers can be written however you normally write them; they are dialled
in international form so a call works from outside Ghana too.

> **On publishing phone numbers.** This page is on the open internet — anyone
> can read it, and so can anything that scrapes it. That is a different thing
> from a number inside the app, which is behind a login. Leave `phone` blank
> and the line simply does not appear; an email alone is often enough.

Empty both lists and the whole Leadership section goes.

### The wider church, and the founding fathers

This chapter is one part of The Apostles' Continuation Church, and the men who
founded the church are not the chapter's own leadership — so they get their own
section, under the **church's** logo rather than the chapter's, and above the
coordinators who lead here.

Two things in `chapter.js`:

```js
church: {
  name: "The Apostles' Continuation Church",
  logo: 'images/church-logo.png',
  blurb: 'Our chapter is one part of the wider church.',
},

founders: [
  { name: 'Apostle Kwame Anane', role: 'Founder',        about: 'Began the work in 1961.', photo: 'images/founder.jpg' },
  { name: 'Elder Kofi Mensah',   role: 'Founding Member', about: '', photo: '', inMemoriam: true },
],
```

- **`church.logo`** is the general logo of the whole church, shown above the
  founders. It is **fitted whole rather than cropped**, so it keeps the space
  drawn around it and a round seal does not come out square. A PNG keeps its
  transparency.
- **`founders`** is the list. A row with no name is skipped, and somebody with
  no photo yet gets their initials — so put the names up now and add the
  pictures as you find them.
- **`inMemoriam: true`** marks one who has gone. It adds a quiet line under the
  card rather than doing anything to his picture, so his card reads like the
  others'.

The two halves stand on their own: the logo with no photographs yet is a
section worth publishing, and so are the names before anybody has found the
logo file. Blank the logo and leave the names out and **the whole section
disappears**, like everything else here.

**The portraits are framed standing, not cropped to a circle** like the
chapter's own people. These are formal studio portraits: the head sits in the
top third, and a circle centred on one shows a tie and a pair of folded arms.
So a founder's photo can be a full standing shot — it is framed 3:4 with the
crop held high. A head-and-shoulders photo works just as well.

A note on the initials: a title is not a name, so *Apostle Kwame Anane* gets
**KA** and not AK. Apostle, Rev, Elder, Pastor, Dr and the rest are skipped —
unless the title is all you have written, in which case it is kept.

### Reports anyone can read

A PDF the page links to — an outreach write-up, an annual review, the things a
chapter gets asked for and ends up digging out of WhatsApp.

Put the file in a `files/` folder inside this one (make it if it is not there),
then add a row:

```js
reports: [
  {
    title: 'Orphanage Outreach',
    date: 'September 2026',          // free text, shown under the title
    blurb: 'Where we went, what we took, and what it cost.',
    file: 'files/orphanage-outreach-2026.pdf',
  },
],
```

The whole card is the link, so there is no small target to miss on a phone, and
it opens in a new tab rather than navigating the reader away from the page.

- **A row needs both a `title` and a `file`.** A title with nothing behind it is
  a card that goes nowhere, so it is skipped.
- **An empty list hides the whole section**, like everything else here.
- **A mistyped path fails the build**, the same check that guards the
  photographs — better than a reader finding a 404.

> **The shrinker does not touch PDFs.** It only ever resizes pictures. A report
> goes up exactly as large as it is, and a 20MB PDF costs a reader on campus
> data real money. If yours is heavy, export it again at a lower quality before
> putting it here.

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
