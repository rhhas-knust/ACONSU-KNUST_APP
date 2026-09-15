# National vs Chapter — Governance Tier Review

**Status:** review complete, implementation proposed
**Scope:** `public/national.html`, `public/admin.html`, `public/coordinator.html` and the API surface behind them
**Method:** code audit plus an empirical audit run against the real Express app (two chapters, seeded executives, live sign-ins for each role). Every finding below was reproduced, not inferred.

---

## Executive summary

The platform's problem is not that the National Coordinator has too many screens. `national.html` is already lean — five panels, all of them genuinely national. The problem is that **the National Coordinator is also handed the entire chapter-operations dashboard**, and when they open it, chapter-scoped data from every chapter is merged into one undifferentiated list.

The second problem is the mirror image of the first. The delegation chain Robert wants — National Coordinator assigns a Chapter Coordinator, who then stands up their own Chapter Admin, who carries the operational load — **already works at the API level**. It is simply invisible in the interface. The Chapter Coordinator's own portal tells them, in writing, to go and ask the national admin instead.

So national is doing work it should never see, chapters are unable to take work they are already authorised to do, and both halves trace back to the user interface rather than the permission model. That is good news: the security foundation in `lib/roles.js` is sound and does not need rewriting.

---

## What was verified

| Finding | Result |
|---|---|
| National actor sees executives from every chapter merged into one list | Confirmed |
| National actor can call the per-member roster endpoint (individually identifying data, cross-chapter) | Confirmed |
| Chapter Coordinator can create their own Chapter Admin via the API | Confirmed |
| Chapter Coordinator can staff their own chapter offices (finance, etc.) | Confirmed |
| Chapter Coordinator cannot mint a National Coordinator | Correctly blocked |
| Chapter Coordinator and Chapter Admin are both confined to their own chapter's data | Confirmed |
| Chapter Coordinator is locked out of the national dashboard | Correctly blocked |

The isolation guarantees hold. What fails is the **default scope for a national actor**: `chapterFilter()` returns an empty Mongo filter (`{}`) when the actor is national and has not selected a chapter, which reads as "every chapter" rather than "national-level records only".

---

## Finding 1 — National inherits the whole chapter dashboard

A National Coordinator signing into `/admin.html` gets the badge `🌐 National Admin` and all twenty-two operational panels: Members, Executives, Join Requests, Bible Studies, Groups, Prayer Wall, Testimonies, Sermons, Events, Departments, Notifications, Forms, Welfare, Chat Moderation, Contact Messages, Chapter Settings, Pages, Media, Reports and global Settings.

Almost none of that is national work. Prayer requests, welfare cases, attendance registers and contact messages are local pastoral matters. A national officer browsing them is not oversight, it is duplication — and in the case of welfare, it is a confidentiality problem.

## Finding 2 — Cross-chapter merging contradicts the platform's own privacy rule

`national.js` states the rule plainly on the dashboard: *"Aggregated figures only — no individual member data appears here."* The national reports panel repeats it: *"sensitive personal records stay in the local chapter."*

The admin dashboard breaks that promise through the side door. A national actor calling the member roster endpoint receives a 200 and a cross-chapter list; the executives endpoint returns KNUST's and Legon's officers side by side with nothing distinguishing them. The stated policy is right. The enforcement is missing in exactly the place a busy national officer is most likely to be standing.

## Finding 3 — "Executives" at national level has no national meaning

`executiveSchema` carries a `chapterId`, and the data model already reserves `chapterId: ''` for national/unscoped records. But nothing in the interface ever creates a national executive, and nothing ever filters for one. The national tier therefore has no roster of the national executive body — the thing it actually needs — while being shown every chapter's officers, which it does not.

## Finding 4 — The delegation chain stops at the interface

This is the most consequential finding, and the most easily fixed.

The backend already permits the hand-off. `NATIONAL_ONLY_ROLES` is `['nationalCoordinator', 'coordinator']`, so a Chapter Coordinator may create every other role — Chapter Admin, Finance, Shepherding, Publicity, Welfare, Executive, Department Leader — scoped automatically and unavoidably to their own chapter. The audit run confirmed a freshly assigned Chapter Coordinator creating a working Chapter Admin, who then signed in and managed their own chapter settings.

The interface does not offer this anywhere. The coordinator portal's *Offices & Leaders* panel lists who holds each office read-only, and closes with: *"Accounts are created by the ACONSU admin under Leadership Accounts."* That sentence is the bottleneck. It routes every staffing decision in every chapter back to one national inbox, which is precisely the workload Robert is trying to shed.

There is a second, quieter gap: after assigning a Chapter Coordinator, nothing tells that person what they are now responsible for. They inherit a chapter with no settings, no admin and no staffed offices, and no indication that they are the one expected to fix that.

---

## Target model

### The governing rule

> **National by default, chapter by selection.**
> A national actor reading a chapter-scoped resource sees national-level records (`chapterId === ''`). Chapter data appears only when a chapter is explicitly selected, and selecting one is a deliberate, visible act. Aggregation endpoints under `/api/national/*` remain cross-chapter by design — that is their job.

This single change converts "everything merged, always" into "nothing local unless you asked for it", without touching the isolation logic that already works.

### Responsibility matrix

| Concern | National Coordinator | Chapter Coordinator | Chapter Admin |
|---|---|---|---|
| Create / activate chapters | Owns | — | — |
| Assign Chapter Coordinator | Owns | — | — |
| National executive body | Owns | — | — |
| Platform feature toggles | Owns | — | — |
| National announcements | Owns | — | — |
| Cross-chapter comparison reports | Owns (aggregate only) | — | — |
| Chapter readiness oversight | Owns (status, not content) | — | — |
| Appoint Chapter Admin | — | Owns | — |
| Staff chapter offices | — | Owns | — |
| Chapter approvals | — | Owns | — |
| Chapter announcements | — | Owns | — |
| Chapter branding & settings | — | Approves | Operates |
| Members, join requests, attendance | — | Oversees | Owns |
| Chapter executives | — | Oversees | Owns |
| Events, departments, groups, media | — | Oversees | Owns |
| Prayer wall, testimonies, contact inbox | — | Oversees | Owns |
| Welfare cases | Never | Oversees | Referral only |
| Finance ledger | Never (aggregate balance only) | Approves | — |

"Never" is deliberate. Welfare case notes and the finance ledger are the two places where cross-chapter visibility is a confidentiality failure rather than a convenience.

### Corrected delegation chain

```
National Coordinator
  ├─ creates the chapter
  ├─ assigns the Chapter Coordinator ──────── hand-off point; national steps back
  └─ thereafter sees only: is this chapter staffed, active and reporting?

Chapter Coordinator  (top local authority)
  ├─ appoints the Chapter Admin
  ├─ staffs Finance / Shepherding / Publicity / Welfare / Executives
  ├─ approves sensitive chapter operations
  └─ speaks to the whole chapter

Chapter Admin  (the operational workhorse)
  └─ runs members, events, departments, content, media, forms, reports
```

The hand-off point is the idea to make real in the interface. Today it is an API capability with no doorway.

---

## Implementation plan

### Phase A — Stop the bleed (small, safe, high value)

1. **Scope national reads to national records.** Introduce a `nationalScopeFilter` used by chapter-scoped *resource* endpoints so a national actor with no chapter selected gets `{ chapterId: '' }` rather than `{}`. Leave `/api/national/*` aggregation untouched.
2. **Give national a real chapter selector.** A single explicit control in the admin topbar — "Viewing: National / ACONSU-KNUST / ACONSU-Legon" — that drives the existing `?chapterId=` mechanism. Looking into a chapter becomes a choice, and the current scope is always on screen.
3. **National executives become a first-class thing.** The executives panel at national scope manages the national executive body only (`chapterId === ''`), which is what Robert asked for.

### Phase B — Open the delegation doorway

4. **Replace the coordinator's read-only *Offices & Leaders* with a working staffing panel.** Create, rename, deactivate and reset passwords for every chapter role the backend already permits. Delete the sentence that points people back to national.
5. **Add a first-run checklist for a newly assigned Chapter Coordinator**: set chapter settings and branding, appoint your Chapter Admin, staff your offices. This is the "carry on from here" signal — it turns an empty portal into an onboarding path.

### Phase C — Oversight without interference

6. **Chapter readiness on the national dashboard.** Per chapter: coordinator assigned, admin appointed, offices staffed, settings complete, last activity. National sees whether a chapter is healthy without reading its contents — the distinction between oversight and doing the work.
7. **Hard-block the two confidential surfaces.** Welfare case notes and the finance ledger should refuse a national actor outright, with an explicit message, rather than quietly returning cross-chapter rows.

### Phase D — Fit and finish

8. Prune the national actor's admin navigation to the panels that survive the matrix above, so the twenty-two-panel wall is never presented to someone who needs five of them.
9. Extend `test/smoke.js` with tier-boundary cases: national default scope returns no chapter records; coordinator staffs their own chapter; national is refused welfare and ledger reads.

---

## Notes and risks

- **Backward compatibility.** The legacy env admin login is treated as a bootstrap National Coordinator. Narrowing national default scope will change what that account sees on day one. It keeps every capability — it just has to pick a chapter first. Worth saying out loud before it surprises anyone mid-service.
- **Existing records.** Any executive created before this change carries a real `chapterId`, so the national executive roster will start empty. That is correct rather than broken, but it will look like data loss unless it is expected. A short migration can promote a named few to `chapterId: ''` if a national executive body already exists on paper.
- **Phase A is independently shippable** and delivers most of the perceived relief. Phase B is what actually removes work from the national inbox permanently.
- **Not changed:** `lib/roles.js` isolation logic, `chapterIdForWrite`, or any write-path permission check. Those were audited and are correct.
