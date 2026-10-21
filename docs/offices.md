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
| **Financial Secretary** | Asks departments for their budgets at the start of the year, reviews what comes back, adds approved amounts to the chapter budget. |
| **Treasurer, Organising Secretary, Campus Coordinator** | Read the shared outline and minutes, answer the announcement call. |
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
**Show** / **Hide** button. It works from the keyboard, is at least 44px to press,
and the password goes back to hidden when the form is sent or the page is put in
the background. It is added by `public/js/main.js`, so a form added later cannot
be left without one.

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
| Tests | `test/offices.js`, `test/account.js` (server rules), `test/offices-ui.js`, `test/account-ui.js` (browser) |
