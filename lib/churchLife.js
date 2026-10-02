// The small, pure rules behind the Alumni wall, the weekly spotlight and the
// monthly theme. Kept out of the routes so they can be tested without a
// server, and so the clock can be moved in a test without anything in
// production being able to move it.
//
// Ghana keeps GMT all year, so UTC is local time here and a week turns over
// at midnight on Monday for the people who read it.

let nowFn = () => new Date();
const now = () => nowFn();
// Test seam only. Nothing in the app calls this; a test that needs "next week"
// replaces the clock rather than waiting for it.
function _setNowForTests(fn) { nowFn = fn || (() => new Date()); }

// ISO-8601 week, e.g. "2026-W41". The year is the week's own year, so the
// first days of January can belong to the previous year's last week.
function isoWeekKey(date) {
  const d = date || now();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((t - yearStart) / 86400000) + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function monthKey(date) {
  const d = date || now();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
function isMonthKey(value) { return MONTH_RE.test(String(value || '')); }

// Who is celebrated next: whoever has waited longest. Someone never featured
// goes before anyone who has been, and ties fall to who was approved first, so
// every alumnus gets a turn before any gets a second one - and a person
// approved this morning does not jump the queue ahead of people already waiting.
function pickSpotlight(entries) {
  const pool = (entries || []).filter(e => e && e.status === 'approved');
  if (!pool.length) return null;
  const when = (e) => (e.approvedAt ? new Date(e.approvedAt).getTime() : 0);
  return [...pool].sort((a, b) => {
    const wa = a.lastSpotlightWeek || '', wb = b.lastSpotlightWeek || '';
    if (wa !== wb) return wa < wb ? -1 : 1; // '' sorts first: never featured
    if (when(a) !== when(b)) return when(a) - when(b);
    return String(a.id).localeCompare(String(b.id));
  })[0];
}

// The only fields that ever leave the server about an alumnus. A whitelist,
// so a field added to the record later is private until somebody decides
// otherwise. `contact` in particular exists for the National admin to verify
// a request and must never reach a page.
function publicAlumnus(entry, chapterName) {
  return {
    id: entry.id,
    name: entry.name || '',
    about: entry.about || '',
    currentWork: entry.currentWork || '',
    classOf: entry.classOf || '',
    chapterId: entry.chapterId || '',
    chapterName: chapterName || '',
    imageFileId: entry.imageFileId || ''
  };
}

function publicTheme(theme) {
  if (!theme) return null;
  return {
    month: theme.month,
    title: theme.title || '',
    scripture: theme.scripture || '',
    blurb: theme.blurb || '',
    flyerFileIds: Array.isArray(theme.flyerFileIds) ? theme.flyerFileIds.filter(Boolean) : []
  };
}

module.exports = { isoWeekKey, monthKey, isMonthKey, pickSpotlight, publicAlumnus, publicTheme, now, _setNowForTests };
