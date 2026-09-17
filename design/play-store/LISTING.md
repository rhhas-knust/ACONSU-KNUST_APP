# Play Store listing

Copy these into the Play Console. Character limits are Play's own.

---

## App name
*(30 characters max)*

```
ACONSU
```

Alternative if you want the affiliation visible in search results — 29 characters,
just inside the limit:

```
ACONSU — Students Union
```

## Short description
*(80 characters max — this is what shows in search results, so it does the work)*

```
Your chapter in your pocket: events, departments, giving and daily scripture.
```
*(76 characters)*

## Full description
*(4000 characters max)*

```
ACONSU is the app for members of The Apostles' Continuation Students Union — your
chapter, your department, and your part in it, in one place.

FOR EVERY MEMBER

• A digital membership card with your own QR code, scanned to record attendance
• See the department you belong to, when it meets, where, and who leads it
• Know where you stand — your membership journey, from visitor to full member
• Announcements from your department and your chapter, kept so you can read them
  back rather than losing them when the notification clears
• The daily verse, posted by your chapter's Bible Studies Coordinator
• Events, with registration for the ones you want to attend
• Sermon notes you can write and keep
• Read the Bible in the app, and track how far you have come
• A prayer wall to share requests and pray for others
• Community chat with the rest of the union
• Welfare support, requested confidentially
• Give, and see how

FOR THOSE WHO LEAD

Each office has its own workspace, and sees only what belongs to that office:

• Chapter executives, from the President to each department head
• Shepherding — member care, attendance and follow-up
• Finance — the books, budgets and reporting
• Publicity — announcements, events and SMS
• Welfare — requests and referrals, handled discreetly
• Chapter Coordinators and Chapter Admins

BUILT FOR MORE THAN ONE CHAPTER

Every chapter's members, money and records stay inside that chapter. Leaders in
one chapter cannot see another's. The national council is the one place the whole
union meets.

PRIVACY

We do not sell your information and we do not use it for advertising. Prayer
requests, welfare cases and pastoral notes are seen only by the office that
handles them. Read the full policy at <your-domain>/privacy.html
```

---

## Category and contact

| Field | Value |
|---|---|
| App category | Lifestyle *(or Social — Lifestyle is the closer fit)* |
| Tags | Community, Religion & Spirituality |
| Contact email | the union's own address, and one someone actually reads |
| Website | your Render URL, or a custom domain if you have one |
| Privacy policy | `https://<your-domain>/privacy.html` |

## Content rating questionnaire

Answer honestly and it will come back **Everyone** / PEGI 3. The questions that
need a considered answer:

- **User-generated content:** **Yes** — community chat, group posts, prayer
  requests and testimonies.
- **Can users interact?** **Yes.**
- **Is content moderated?** **Yes** — Chapter Admins and Coordinators can restrict
  a member from posting (`chatRestricted`), and testimonies are published only
  after review.

Saying "no" to user-generated content when the app has a chat is a common and
avoidable cause of a rating being revoked later.

---

## Graphics you need to supply

Play will not let you publish without these.

| Asset | Size | Notes |
|---|---|---|
| App icon | 512 × 512 PNG | 32-bit, no transparency |
| Feature graphic | 1024 × 500 PNG | Shown at the top of the listing. The launch artwork works well here — render it at that ratio from `design/launch-screen/continuance.html`. |
| Phone screenshots | min 2, up to 8 | 16:9 or 9:16, min 320px on the short side |
| Tablet screenshots | optional | Only if you declare tablet support |

### Screenshots worth taking

In this order — the first two are what most people actually look at:

1. **Home** — the daily verse and the dashboard tiles
2. **Profile** — where you stand, your department, what you signed up for
3. **Digital membership card** with its QR code
4. **Events**
5. **Prayer wall**
6. **A leadership portal** — the executive portal shows the app is more than a
   noticeboard

Take them on a real device after the app is installed, signed in as a member
with a filled-in profile. Empty screens make an app look unfinished.

---

## Before you hit publish

- [ ] The privacy policy URL loads **while signed out** — the reviewer checks it that way
- [ ] The contact/deletion URL also loads signed out
- [ ] A test account for the reviewer, in the Play Console's "App access" section.
      This app requires sign-in, and **without credentials the reviewer sees a
      login wall and rejects it.** Give them a real member account.
- [ ] `versionCode` raised for every upload after the first
- [ ] The release build is signed — see `android/keystore.properties.example`
- [ ] Render is awake. If it has spun down, the reviewer opens the app, sees
      nothing load, and that is the whole review.
