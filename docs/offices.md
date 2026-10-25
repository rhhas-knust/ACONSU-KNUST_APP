# The executive offices and their work

Who does what in an ACONSU chapter's executive, and how the portal helps them do
it. Everything here is built on the closed list of positions in `lib/positions.js`:
a position grants capabilities, and the server and the portal both read the same
grant, so a screen never appears that the server would refuse.

## The people

Everyone who holds an office is **a member of the chapter first**. An office
account is opened against a real member (`POST /api/admin/staff`, or Key offices
below), serves one academic year, and stops working the day the year ends unless
the Chapter Coordinator renews it or hands the office to the next person.

| Office | Their desk |
| --- | --- |
| **President** | Writes the semester outline in a guided form; follows up what the executive resolved. |
| **Vice President** | Records the finances (the ledger); decides on department budgets Finance has reviewed; sets up committees and task forces; follows up action items. Stands in for the President. |
| **General Secretary** and **Assistant General Secretary** | One grant, held by both. Take the minutes with a form that follows the order of a meeting, agree them between the two of them, then share them; collect Sunday announcements from every executive. |
| **Financial Secretary** | Keeps the books: records what the Treasurer files, brings in the books the chapter kept before (CSV), sees each Sunday's attendance beside its offering. Asks departments for their budgets at the start of the year, reviews what comes back, adds approved amounts to the chapter budget. Lands on The Books (`executive.html#ledger`). |
| **Treasurer** | Holds the money and accounts for it: files each Sunday's offering with a photo of the count, and every other movement with evidence, for the Financial Secretary to record. Lands on Account for Money (`executive.html#treasury`). Reads the shared outline and minutes, answers the announcement call. |
| **Organising Secretary, Campus Coordinator** | Read the shared outline and minutes, answer the announcement call. |
| **Department heads and their assistants** | Answer a budget request for their department; read the outline and minutes; answer the announcement call. |
| **Alumni President** | Has the alumni body's own desk: the chapter's alumni (showing only what each has chosen to share), and a plan for the alumni's semester that goes through the same approval. Must be an alumnus. |
| **Chapter Coordinator** | Approves or returns outlines; decides on a budget if the Vice President cannot; reads the shared minutes; keeps the Key offices list. |

## The four workflows

**Semester outline.** President (or Alumni President) writes it, it goes to the
Chapter Coordinator, who approves or returns it with a reason. Approval is what
shares it, read-only, with the whole executive body. Only one outline is in
progress at a time, and the outline belongs to the office, so a successor opens
the same draft.

**Budget requests.** Finance opens a *call* naming the departments to ask. Each
head fills in line items (quantity x cost each; the server works the amounts out)
and a reason, then sends it. Finance *recommends* (optionally trimmed, with a
reason) or sends it back. The Vice President *approves, declines or sends it back*.
The Chapter Coordinator can decide too, including a budget Finance has not
reviewed, so one empty seat cannot stall the year. Finance then posts the
approved amounts as lines of a draft chapter budget.

**Minutes.** The General Secretary or the Assistant writes them (draft), sends
them to the other (in review), they discuss in a comment thread, and **both sign**.
Any edit clears the signatures, because you approve what you read. When every
filled seat has signed the minutes are the record: shared with the executive body
and locked. If one seat is empty, the one secretary's signature is enough. A scan
or photo of the paper minutes can be attached; it is stored privately and opens
only for the secretaries and Coordinator until the minutes are shared.

**Sunday announcements.** A secretary asks for announcements for a given service.
Each executive answers (or says they have nothing). The secretaries choose what
is read out, tidy the wording, set the order, and compile the text.

## Terms, renewing and handing over

*Coordinator portal, Key offices.* Each office shows who holds it, the term, and
whether it is in office, ending soon, ended or empty. Two actions:

- **Renew** the same person for the new year.
- **Hand over**: choose the member taking over (for the Alumni President, only
  alumni are listed), give them a username and starting password. The outgoing
  login stops at once, session included; the old account is kept, pointing at its
  successor; the office's roster card moves across, so drafts, comment threads, an
  open budget request and this week's announcement answer are waiting for the
  successor. Someone who already holds another office has to leave it first.

Officer seats are single seats: a second President cannot be seated beside the
first, and an account that was handed over cannot be renewed to take the seat back.

## Office logins

Every executive office in a chapter comes with its own login, named after the
office and the chapter:

| Office | Username | Starting password |
| --- | --- | --- |
| President of ACONSU-KNUST | `president.knust` | `president123` |
| Vice President | `vicepresident.knust` | `vicepresident123` |
| Music Director | `musicdirector.knust` | `musicdirector123` |

The rule is the office's name with the spaces taken out, then `.` and the
chapter's short name; the starting password is the same name followed by `123`.
Each chapter's logins are its own: `president.ucc` is a different account from
`president.knust`, and neither can sign in as the other.

When someone is appointed (Leadership Accounts, approving an application, or
Key offices), the Coordinator does not make up a username or password: the
office's login is issued and shown once, to pass on. Because the starting
password follows a pattern anyone could guess, it is only a key to one screen:

- Signing in with it opens nothing but **Choose your own password**. Every other
  part of the portal, and every API route, treats the session as signed out.
- To choose a password the holder also confirms the email on their member
  profile, so that knowing the pattern is not enough to take the office over.
- An unused starting password stops working after 14 days.
- A Coordinator can put it back (Key offices, Reset password) when someone
  forgets theirs. Any password set for an executive by someone else must be
  changed at the next sign-in.

On hand-over the office's login passes to the new holder and the outgoing
account is kept, under an archived name, as the record.

## My Account and passwords

Every leader's portal has a **My Account** page: name, username, office,
department, chapter, when the term ends, and when the password was last changed.
It also has:

- **Change your password.** Needs the current password. The new one must be at
  least 8 characters (72 at most, because that is all bcrypt reads), must not be
  one of the commonly guessed passwords, a run like `12345678`, one repeated
  character, or contain the username, and must differ from the current one. The
  form shows these as it is filled in; the server gives the final answer, in words.
- **Signing out of other devices.** Changing the password does this
  automatically and keeps the device in use signed in. There is also a button for
  doing it without changing the password.
- **A reminder while the password is still the starting one.** An account's
  password starts out chosen by the Coordinator, so until its owner changes it the
  page says so, here and on the first page of the executive portal. A Coordinator
  reset puts the reminder back.

Guessing the current password is rate-limited like signing in. The administrator
login and the legacy shepherding login live in the server's settings, are not
accounts, and so cannot be changed from the portal.

Every password box in the app, on every page (member sign-in, registration, reset,
profile, every portal's sign-in, and the forms that open inside portals), has a
eye button that shows or hides it. It works from the keyboard, is at least 44px to press,
and the password goes back to hidden when the form is sent or the page is put in
the background. It is added by `public/js/main.js`, so a form added later cannot
be left without one.

## A chapter is its own

A chapter's look (site settings, artwork, media library, custom pages,
department pages, content hub), its events, its members and its leadership
accounts and executive offices belong to that chapter. The main admin (the
login behind the admin dashboard) can change them only while the chapter has
asked:

1. The Chapter Admin or Chapter Coordinator opens **Ask National for Help**,
   says what they need, and how long to keep the request open (3 to 30 days).
2. The main admin sees it under **Chapter Requests**, works on that chapter
   (and only that chapter), and marks it done.
3. The request closes when it is marked done, withdrawn by the chapter, or its
   days run out, and the panels lock again.

Until then the main admin's Chapter Site Settings, Custom Pages, Media Library,
Departments, Events, Members, Join Requests, Alumni Wall, Executives and
Leadership Accounts panels say whose they are and are view only, and the server
refuses the changes, from the Publicity, Shepherding and Coordinator portals
too. A change to one record (an event, a member, an account) is judged by that
record's own chapter, whatever chapter the request names.

What stays the main admin's own: national events, national executives,
National Coordinator accounts, and appointing a chapter's Coordinator from the
National portal (which is also how a chapter locked out of every account gets
back in). A chapter with no admin of its own yet can still be set up. The rule
is in `routes/chapter-requests.js`.

## Global Settings are the national app's

What the Global Settings page held had been set for ACONSU-KNUST, from when the
app was KNUST's alone, and every other chapter showed it wherever its own was
blank (KNUST's phone number, banner and office email addresses). On the first
start after this change it is moved into ACONSU-KNUST's Chapter Site Settings,
only where KNUST had not set its own, and Global goes back to the union's plain
defaults (`lib/globalMove.js`). What Global held is kept on the settings record,
and it happens once: afterwards Global is the national app's to fill.

From then on a chapter's page shows only its own details: a blank stays blank
and the page leaves it out. Each chapter sets its own office email addresses
(Shepherding, Publicity, Finance, Welfare) in its Chapter Site Settings, and a
chapter's messages go only to its own addresses. The wider church, the founders
and the national council are the whole union's and were left where they are.

## What the research said

The role of a Vice President in student and church bodies is consistently:
stand in for the president, select and oversee committee chairs and task forces,
follow what the committees and officers are doing, and (varies by constitution)
keep or oversee the finances, with release of funds needing a second approver.
Meeting minutes are consistently structured as: date, time and place; who was
present and who sent apologies; agenda items with the decision on each; action
items with an owner and a deadline; the next meeting; the attendance list as the
distribution list. ACONSU's own rules (the two secretaries agreeing minutes
before they are shared, the Coordinator approving the outline) are applied as
described to us and are not from those sources.

## Where the code is

| Area | File |
| --- | --- |
| Positions and capabilities | `lib/positions.js` |
| Rules for outline, budget lines, minutes, announcements, committees | `lib/offices.js` |
| Outline, budgets, minutes, announcements, committees, follow-up | `routes/offices.js` |
| Key offices, hand-over, alumni desk | `routes/office-holders.js` |
| Screens | `public/js/office-ui.js` (toolkit), `office-outline.js`, `office-budget.js`, `office-minutes.js`, `office-announce.js`, `office-bodies.js` |
| Private minutes scans | `canOpenPrivateFile` in `server.js`, `lib/fileTypes.js` |
| My Account and password change | `routes/account.js`, `lib/passwords.js`, `public/js/account.js` |
| Show / Hide on password boxes | the end of `public/js/main.js`, `.pw-wrap` in `public/css/style.css` |
| Office logins | `lib/officeAccounts.js`, `issueOfficeLogin` in `server.js`, the first-sign-in screen in `public/js/portal.js` |
| A chapter is its own | `routes/chapter-requests.js`, `public/js/chapter-requests.js` |
| Global Settings moved to ACONSU-KNUST | `lib/globalMove.js` |
| Tests | `test/offices.js`, `test/account.js`, `test/chapter-look.js`, `test/global.js` (server rules); `test/offices-ui.js`, `test/account-ui.js`, `test/chapter-look-ui.js`, `test/visit-ui.js` (browser) |
