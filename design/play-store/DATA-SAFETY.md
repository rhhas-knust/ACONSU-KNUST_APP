# Play Console — Data Safety answers

Filled in from what the code actually collects (`lib/models.js`), not from a
template. Declaring this inaccurately is how apps get pulled, so where the
honest answer is "yes, we collect that", it says so.

**Privacy policy URL:** `https://<your-domain>/privacy.html`

---

## The two questions Play asks about everything

- **Collected** — it leaves the device and reaches our server. For this app that
  is nearly everything, because the data lives in MongoDB Atlas.
- **Shared** — it goes to a *third party*. For us this is almost always **No**:
  hosting and database providers acting on our instructions are processors, not
  third parties. The one real "shared" case is SMS.

---

## Personal info

| Data type | Collected | Shared | Optional? | Purpose |
|---|---|---|---|---|
| Name | Yes | No | Required | Account management, app functionality |
| Email address | Yes | No | Required | Account management |
| User IDs | Yes | No | Required | Account management |
| Address | Yes | No | Optional | App functionality — hostel / residence |
| Phone number | Yes | **Yes** | Optional | App functionality; passed to the SMS provider when a chapter texts members |
| Other info | Yes | No | Optional | Programme, level, birthday **month and day only — never the year** |

> Play has no category for "religious belief". Because this is a Christian
> students' union, holding an account implies affiliation. Disclose it in the
> listing and the policy rather than trying to force it into a Play category.

## Photos and videos

| Data type | Collected | Shared | Optional? | Purpose |
|---|---|---|---|---|
| Photos | Yes | No | **Required** | Profile photo, required at registration; shown on the membership card and to other members |

## Messages

| Data type | Collected | Shared | Optional? | Purpose |
|---|---|---|---|---|
| Other in-app messages | Yes | No | Optional | Community chat, group posts, prayer requests, testimonies, welfare requests |

## Financial info

| Data type | Collected | Shared | Optional? | Purpose |
|---|---|---|---|---|
| Purchase history | Yes | No | Optional | Giving records the Finance office keeps. **No payment is taken in the app** — the app records that a gift happened, it does not process one. |

## App activity

| Data type | Collected | Shared | Optional? | Purpose |
|---|---|---|---|---|
| App interactions | Yes | No | Optional | Attendance, event registrations, streaks, Bible-reading progress |
| Other user-generated content | Yes | No | Optional | Sermon notes |

## App info and performance

| Data type | Collected | Shared | Optional? | Purpose |
|---|---|---|---|---|
| Crash logs / diagnostics | No | — | — | No analytics or crash SDK is integrated |

## Device or other IDs

| Data type | Collected | Shared | Optional? | Purpose |
|---|---|---|---|---|
| Device or other IDs | Yes | No | Optional | Push subscription endpoint, only if notifications are enabled |

---

## Security practices — answer these Yes

- **Encrypted in transit** — Yes. HTTPS throughout; the app sets `cleartext: false`.
- **Users can request deletion** — Yes, through the contact page. The policy commits to 30 days.
- **Committed to the Play Families Policy** — Not applicable; not aimed at children.
- **Independent security review** — No.

## Data deletion

Play wants a URL where deletion can be requested. Use `https://<your-domain>/contact.html`
and make sure that page is reachable **without signing in** — Play's reviewer will
check it while signed out.

---

## Two things to get right before submitting

**Photo is required, not optional.** Registration refuses without one
(`server.js`, `/api/auth/register`). Declaring it optional would be inaccurate.

**Phone number is genuinely shared.** When a chapter sends SMS, the number and
message go to mNotify. That makes it a third-party disclosure and it must be
declared as shared — this is the single answer most likely to be got wrong.
