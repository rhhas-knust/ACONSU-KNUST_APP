// Events that happen again: every week, every other week, or once a month (on
// a date, or on a weekday such as the first Saturday). The pure rules, with no
// database in sight, so they can be tested on their own.
//
// An event keeps ONE date: the next time it happens. When that day has gone,
// the event moves on to the one after (rollForward), so every screen that shows
// an event's date (the home page, the Events page, the counts, a shared link)
// shows the next one without knowing anything about series. The series itself
// is kept beside it:
//
//   repeat       { every: 'week' | '2weeks' | 'month', monthBy: 'date' | 'weekday', until }
//   seriesStart  the first date, which fixes the weekday, the day of the month,
//                and which weeks "every other week" means
//   occurrence   the series date the event currently stands for. It differs
//                from `date` only when this one was moved ("Thursday this week")
//   seriesTime   the usual time, which a moved one may change for that time only
//   skipped      series dates called off ("no fellowship this Wednesday")
//
// Dates are 'YYYY-MM-DD' strings in Ghana time, which is UTC all year.

const EVERY = ['week', '2weeks', 'month'];
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDINALS = ['first', 'second', 'third', 'fourth'];
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

const toUtc = (s) => new Date(`${s}T00:00:00Z`);
const fmt = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => fmt(new Date(toUtc(s).getTime() + n * DAY_MS));
const today = (now) => fmt(now || new Date());
const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

// What a form sends, made into a rule: nothing that is not one of the choices.
function cleanRepeat(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const every = EVERY.includes(r.every) ? r.every : '';
  if (!every) return { every: '', monthBy: 'date', until: '' };
  return {
    every,
    monthBy: every === 'month' && r.monthBy === 'weekday' ? 'weekday' : 'date',
    until: isDate(r.until) ? r.until : ''
  };
}

const isRepeating = (event) => !!(event && event.repeat && EVERY.includes(event.repeat.every) && isDate(event.seriesStart || event.date));

// Which week of the month a date falls in: 1 to 4, or 5 for "the last"
// (a date from the 29th on can only be the last of its weekday).
function weekOfMonth(s) {
  const n = Math.ceil(toUtc(s).getUTCDate() / 7);
  return n >= 5 ? 5 : n;
}

// The series date in a given month for a monthly rule.
function monthlyDate(start, monthBy, y, m) {
  const s = toUtc(start);
  if (monthBy === 'weekday') {
    const weekday = s.getUTCDay();
    const n = weekOfMonth(start);
    if (n === 5) {
      const last = new Date(Date.UTC(y, m, daysIn(y, m)));
      const back = (last.getUTCDay() - weekday + 7) % 7;
      return fmt(new Date(last.getTime() - back * DAY_MS));
    }
    const first = new Date(Date.UTC(y, m, 1));
    const ahead = (weekday - first.getUTCDay() + 7) % 7;
    return fmt(new Date(first.getTime() + (ahead + (n - 1) * 7) * DAY_MS));
  }
  // The 31st in a 30-day month falls on the 30th, rather than being skipped.
  return fmt(new Date(Date.UTC(y, m, Math.min(s.getUTCDate(), daysIn(y, m)))));
}

// The first series date strictly after `after`, or '' when the series has
// ended. Dates called off are passed over.
function nextAfter(event, after) {
  if (!isRepeating(event)) return '';
  const { every, monthBy, until } = event.repeat;
  const start = event.seriesStart || event.date;
  const skipped = new Set(event.skipped || []);
  const ok = (s) => s > after && s >= start && !skipped.has(s);
  let candidate = '';
  if (every === 'week' || every === '2weeks') {
    const step = every === 'week' ? 7 : 14;
    const from = after < start ? start : after;
    const gap = Math.round((toUtc(from) - toUtc(start)) / DAY_MS);
    candidate = addDays(start, Math.max(0, Math.floor(gap / step)) * step);
    for (let i = 0; i < 400 && !ok(candidate); i += 1) candidate = addDays(candidate, step);
  } else {
    const a = toUtc(after < start ? start : after);
    let y = a.getUTCFullYear();
    let m = a.getUTCMonth();
    candidate = monthlyDate(start, monthBy, y, m);
    for (let i = 0; i < 400 && !ok(candidate); i += 1) {
      m += 1; if (m > 11) { m = 0; y += 1; }
      candidate = monthlyDate(start, monthBy, y, m);
    }
  }
  if (!ok(candidate)) return '';
  return until && candidate > until ? '' : candidate;
}

// The first series date on or after `day`.
const onOrAfter = (event, day) => nextAfter(event, addDays(day, -1));

// When the event's day has gone, what to save so it shows the next one: the
// date, which series date that is, and the usual time back. null when there is
// nothing to do, or when the series has ended (the event then stays in the
// past, where the Events page lists it under Past).
function rollForward(event, now) {
  if (!isRepeating(event) || !isDate(event.date)) return null;
  const day = today(now);
  if (event.date >= day) return null;
  // The first series date from today on, and after the one this event stood
  // for: a "Tuesday instead" for a Wednesday does not bring that Wednesday back.
  const occ = event.occurrence || event.date;
  const next = nextAfter(event, occ >= day ? occ : addDays(day, -1));
  if (!next) return null;
  return { date: next, occurrence: next, time: event.seriesTime || event.time || '' };
}

// The next few dates, for "Next: 12 Nov, 19 Nov, 26 Nov" under the event.
function upcoming(event, count, now) {
  if (!isRepeating(event)) return [];
  const out = [event.date];
  let from = event.occurrence || event.date;
  const day = today(now);
  while (out.length < count) {
    const next = nextAfter(event, from < day ? addDays(day, -1) : from);
    if (!next) break;
    if (!out.includes(next)) out.push(next);
    from = next;
  }
  return out;
}

// The series in words: "Every Wednesday", "Every other Saturday", "Monthly on
// the 15th", "First Saturday of every month", "Last Friday of every month".
function describe(repeat, start) {
  const r = cleanRepeat(repeat);
  if (!r.every || !isDate(start)) return '';
  const d = toUtc(start);
  const weekday = WEEKDAYS[d.getUTCDay()];
  let words;
  if (r.every === 'week') words = `Every ${weekday}`;
  else if (r.every === '2weeks') words = `Every other ${weekday}`;
  else if (r.monthBy === 'weekday') {
    const n = weekOfMonth(start);
    words = `${n === 5 ? 'Last' : ORDINALS[n - 1].replace(/^./, c => c.toUpperCase())} ${weekday} of every month`;
  } else {
    const day = d.getUTCDate();
    const suffix = (day % 100 >= 11 && day % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] || 'th');
    words = `Monthly on the ${day}${suffix}`;
  }
  return r.until ? `${words}, until ${new Date(`${r.until}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}` : words;
}

// What an event's save should store for its series, from what the form sent
// (`incoming`) and what was saved before (`existing`, or null for a new one).
// Changing the date starts the series again from that date; leaving it alone
// keeps the series as it was, called-off dates and all.
function seriesFields(incoming, existing) {
  const hasRepeat = incoming && Object.prototype.hasOwnProperty.call(incoming, 'repeat');
  const before = existing || {};
  const repeat = hasRepeat ? cleanRepeat(incoming.repeat) : cleanRepeat(before.repeat);
  const date = (incoming && incoming.date !== undefined ? incoming.date : before.date) || '';
  const time = (incoming && incoming.time !== undefined ? incoming.time : before.time) || '';
  if (!repeat.every || !isDate(date)) {
    const off = { repeat, seriesStart: '', occurrence: '', seriesTime: '', skipped: [] };
    // The words were the series' own, so they go with it.
    if (cleanRepeat(before.repeat).every && before.recurring === describe(before.repeat, before.seriesStart)) off.recurring = '';
    return off;
  }
  const sameDate = existing && before.date === date && isDate(before.seriesStart) && cleanRepeat(before.repeat).every === repeat.every
    && cleanRepeat(before.repeat).monthBy === repeat.monthBy;
  const out = sameDate
    // While this one is moved, the time on the form is its own; the usual
    // time stays as it was.
    ? { repeat, seriesStart: before.seriesStart, occurrence: before.occurrence || date, seriesTime: (before.occurrence && before.occurrence !== before.date) ? (before.seriesTime || time) : time, skipped: before.skipped || [] }
    : { repeat, seriesStart: date, occurrence: date, seriesTime: time, skipped: [] };
  out.recurring = describe(repeat, out.seriesStart);
  return out;
}

// Calling off the next one: it is marked skipped and the event moves on to
// the one after. null when there is no "one after" (the series is ending).
function skipCurrent(event, now) {
  if (!isRepeating(event)) return null;
  const occ = event.occurrence || event.date;
  const skipped = [...new Set([...(event.skipped || []), occ])].sort();
  const next = nextAfter({ ...event, skipped }, occ < today(now) ? addDays(today(now), -1) : occ);
  if (!next) return null;
  return { skipped, date: next, occurrence: next, time: event.seriesTime || event.time || '' };
}

// Moving only this one, to another day or time. It must still come before the
// one after it, and not be in the past.
function moveCurrent(event, newDate, newTime, now) {
  if (!isRepeating(event)) return { error: 'This event does not repeat.' };
  if (!isDate(newDate)) return { error: 'Choose the new date.' };
  if (newDate < today(now)) return { error: 'The new date has already passed.' };
  const occ = event.occurrence || event.date;
  const following = nextAfter(event, occ);
  if (following && newDate >= following) return { error: `That is on or after the next one (${following}). Call this one off instead.` };
  return { patch: { date: newDate, time: newTime !== undefined ? String(newTime) : (event.time || '') } };
}

module.exports = { EVERY, cleanRepeat, isRepeating, nextAfter, onOrAfter, rollForward, upcoming, describe, seriesFields, skipCurrent, moveCurrent, today, isDate };
