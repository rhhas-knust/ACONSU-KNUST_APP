# ACONSU Management System Improvement Plan & Architecture

## Objective & Executive Summary
Upgrade the ACONSU Administrative Management System into a modern, enterprise-grade Church & Campus Management System (ChMS) benchmarked against platforms like **Planning Center**, **Breeze ChMS**, and **Church Community Builder**.

A primary requirement is enabling **each Chapter Admin to manage their own chapter's site settings, branding, contacts, service schedules, payment info, and banners independently**, while National Leadership retains global oversight.

---

## Roadmap Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: Chapter-Scoped Settings & Modular Admin Navigation (Current) │
│ - Per-chapter site settings (branding, verse, contacts, times, banner) │
│ - Categorized modular sidebar navigation (grouping 22 flat buttons)    │
│ - Universal Command Palette (Ctrl+K / Cmd+K) for rapid administrative  │
│   navigation and quick actions                                         │
└────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PHASE 2: Operational Dashboard & "Rule of 4" KPI Metric Cards          │
│ - 4 core metric cards with trend indicators & interactive drill-down   │
│ - Live pastoral care & activity stream (WebSocket/SSE)                 │
│ - Responsive mobile admin drawer & bottom sheets for phone management  │
└────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PHASE 3: Discipleship Lifecycle Pipeline & Retention Automation        │
│ - 6-stage lifecycle: First-Timer ➔ Member ➔ Worker ➔ Exec ➔ Alumni    │
│ - Inactivity detection (30-day absent alert to Welfare & Shepherding)  │
│ - Automated onboarding sequences (Day 0 welcome, Day 3 cell invite)    │
└────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────┐
│ PHASE 4: Volunteer Scheduling & Dual-Control Finance Operations        │
│ - Volunteer conflict checker (double-booking & fatigue prevention)     │
│ - Dual-control offering & MoMo batch reconciliation                    │
│ - 3-tap mobile small group attendance reporting for cell leaders       │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1 Detailed Specification: Chapter-Scoped Settings & Modular Admin

### 1. Chapter-Scoped Site Settings Architecture

#### The Problem:
Currently, `/api/settings` and `/api/admin/settings` manage a single global `Settings` document (`singleton: 'main'`). If KNUST or Legon chapter admins update the verse of the week, contact numbers, or header images, it affects the whole system or requires superadmin privileges.

#### The Solution:
Allow each chapter admin to customize their own chapter's public profile and site settings:
1. **Data Model (`Chapter` schema extension in `lib/models.js`)**:
   - `tagline`: Chapter motto or theme for the academic year.
   - `verseOfTheWeek`: Chapter-specific scripture theme.
   - `serviceTimes`: Array of service/fellowship times (e.g. `["Sundays 8:00 AM - 11:00 AM (Central Hall)", "Wednesdays 6:30 PM (Midweek Service)"]`).
   - `homeHeaderImageFileId`: Chapter-specific hero banner image stored in GridFS.
   - `contact`: Email, Phone, WhatsApp group invite link, Instagram, Facebook, YouTube, TikTok.
   - `about`: Vision, Mission, Values, History, and Chapter Leadership bio.
   - `payment`: Chapter MoMo number, Merchant Name, Bank details for giving claims.

2. **Backend API Endpoints (`server.js`)**:
   - `GET /api/settings`:
     - Inspects the `X-Chapter-Id` request header (or session/query parameter).
     - If a chapter is selected, merges the Chapter's customized settings with global fallback defaults.
     - Public visitors viewing KNUST see KNUST's banner, verse, service times, and MoMo number.
   - `GET /api/admin/chapter-settings`:
     - Protected by `requireChapterAdmin`.
     - Loads the acting chapter's full configuration for editing.
   - `PUT /api/admin/chapter-settings`:
     - Protected by `requireChapterAdmin`.
     - Updates the acting chapter's settings, contacts, service times, and about information.
   - `POST /api/admin/chapter-settings/banner`:
     - Uploads a chapter-specific home header banner image, compresses it with `sharp`, stores it in GridFS, and links it to `Chapter.homeHeaderImageFileId`.

---

### 2. Categorized Modular Admin Navigation

#### The Problem:
`public/admin.html` currently has a flat list of 22 buttons in the sidebar without visual hierarchy, causing cognitive overload.

#### The Solution:
Reorganize `public/admin.html` and `public/js/admin.js` into collapsible, categorized functional domains:

```
├── 📊 OVERVIEW
│   └── Dashboard Overview
│
├── 👥 PEOPLE & LEADERSHIP
│   ├── Members Roster
│   ├── Executive Applications & Roster
│   ├── Leadership Accounts (Staff Roles)
│   └── Join Requests & New Converts
│
├── 📖 MINISTRY & DISCIPLESHIP
│   ├── Bible Studies
│   ├── Small Groups & Cells
│   ├── Prayer Wall Moderation
│   ├── Testimonies Review
│   └── Sermons & Media
│
├── 🗓️ OPERATIONS & GATHERINGS
│   ├── Events & Service Schedules
│   ├── Departments
│   ├── Push Notifications & Broadcasts
│   └── Dynamic Form Builder
│
├── 🤝 CARE & COMMUNITY
│   ├── Welfare Requests & Cases
│   └── Community Chat Moderation
│
└── ⚙️ SYSTEM & CHAPTER SETTINGS
    ├── 🏢 Chapter Site Settings (Branding, Banner, Contacts, Times)
    ├── 🎨 Custom Pages
    ├── 📁 Media Library (GridFS)
    ├── 📑 Reports & PDF Export
    └── 🌐 National Management Portal (National Coordinator only)
```

---

### 3. Universal Command Palette (`Ctrl + K` / `Cmd + K`)

#### Features:
- Keyboard shortcut `Ctrl + K` or `Cmd + K` (with a topbar search icon for mobile/mouse users).
- Instant fuzzy navigation to any admin section:
  - `> Settings` ➔ Opens Chapter Site Settings
  - `> Members` ➔ Opens Member Directory
  - `> Executives` ➔ Opens Executive Review
  - `> Events` ➔ Opens Events & Calendar
  - `> Welfare` ➔ Opens Welfare Portal
- Quick Action shortcuts:
  - `+ New Member`
  - `+ Create Event`
  - `+ Send Notification`
  - `+ Upload Banner`

---

## Verification & Testing Plan

1. **Automated Smoke Tests (`test/smoke.js`)**:
   - Verify chapter admin can load their chapter settings via `GET /api/admin/chapter-settings`.
   - Verify chapter admin can update their chapter tagline, verse, service times, and contact info via `PUT /api/admin/chapter-settings`.
   - Verify Chapter 1's settings cannot overwrite or be read by Chapter 2's admin.
   - Verify public `GET /api/settings` with `X-Chapter-Id: aconsu-knust` reflects the chapter's custom settings.
   - Verify banner upload attaches to chapter record and serves via `/api/files/:id`.
2. **Manual Admin UI Verification**:
   - Log into `admin.html` as a chapter admin.
   - Confirm categorized sidebar navigation renders cleanly.
   - Open Chapter Site Settings, edit the verse of the week and WhatsApp number, save, and verify instant update on `index.html`.
   - Test `Ctrl+K` command palette across all major panels.
