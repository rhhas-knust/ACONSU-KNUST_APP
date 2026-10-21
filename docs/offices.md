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
| Tests | `test/offices.js` (server rules), `test/offices-ui.js` (browser) |
