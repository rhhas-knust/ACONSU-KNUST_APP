// The pure rules behind the executive offices' working forms: the semester
// outline, budget requests, meeting minutes and Sunday announcements.
//
// Nothing here touches the database or the request. Each function takes what a
// browser sent and returns either a clean value or a plain-English reason it
// cannot be accepted, so the rules can be tested on their own and the routes
// stay short. The limits are named once, at the top, so a form and the server
// can never disagree about how much a field may hold.

const LIMITS = {
  title: 140, label: 80, line: 200, text: 4000, longText: 8000, name: 80,
  goals: 12, priorities: 12, programmes: 80, focus: 40,
  budgetLines: 60, minuteItems: 40, minuteActions: 60, comment: 2000, announcement: 1200
};

const PROGRAMME_KINDS = ['service', 'outreach', 'training', 'fellowship', 'social', 'prayer', 'other'];

const oneLine = (value, max) => String(value == null ? '' : value)
  .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// Paragraphs keep their line breaks; control characters do not survive.
const block = (value, max) => String(value == null ? '' : value)
  .replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  .replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

// A real calendar day written YYYY-MM-DD. 2026-02-31 is not one.
function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const cleanDate = (value) => (isDate(String(value || '').trim()) ? String(value).trim() : '');

// Money: never negative, never more than a billion, always two places.
function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(Math.min(n, 1e9) * 100) / 100;
}

function stringList(value, max, each) {
  const raw = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(/\r?\n/) : []);
  return raw.map((v) => oneLine(v, each)).filter(Boolean).slice(0, max);
}

// ---------------------------------------------------------------- outline ----
// `departments` is a Map of this chapter's department id to its record, so a
// programme can only ever point at a department that is really in the chapter.
function cleanOutline(input, departments) {
  const src = input && typeof input === 'object' ? input : {};
  const title = oneLine(src.title, LIMITS.title);
  if (!title) return { error: 'Give the outline a title, for example "First semester 2026/2027".' };

  const startDate = cleanDate(src.startDate);
  const endDate = cleanDate(src.endDate);
  if (String(src.startDate || '').trim() && !startDate) return { error: 'The start date is not a real date.' };
  if (String(src.endDate || '').trim() && !endDate) return { error: 'The end date is not a real date.' };
  if (startDate && endDate && endDate < startDate) return { error: 'The semester cannot end before it starts.' };

  const programmes = [];
  const rawProgrammes = Array.isArray(src.programmes) ? src.programmes : [];
  if (rawProgrammes.length > LIMITS.programmes) return { error: `An outline can hold up to ${LIMITS.programmes} programmes.` };
  for (let i = 0; i < rawProgrammes.length; i += 1) {
    const p = rawProgrammes[i] || {};
    const programmeTitle = oneLine(p.title, LIMITS.title);
    const touched = programmeTitle || p.date || p.venue || p.notes || p.departmentId || Number(p.estimatedCost) > 0;
    if (!touched) continue; // an empty row is just unused space on the form
    if (!programmeTitle) return { error: `Programme ${i + 1} needs a name.` };
    const date = cleanDate(p.date);
    if (String(p.date || '').trim() && !date) return { error: `"${programmeTitle}" has a date that is not real.` };
    const departmentId = oneLine(p.departmentId, 80);
    if (departmentId && !(departments && departments.has(departmentId))) {
      return { error: `"${programmeTitle}" is given to a department that is not in this chapter.` };
    }
    programmes.push({
      id: oneLine(p.id, 60) || `prog_${i + 1}`,
      date,
      title: programmeTitle,
      kind: PROGRAMME_KINDS.includes(p.kind) ? p.kind : 'other',
      departmentId,
      departmentName: departmentId ? (departments.get(departmentId).name || '') : '',
      venue: oneLine(p.venue, LIMITS.line),
      estimatedCost: money(p.estimatedCost),
      notes: block(p.notes, 600)
    });
  }
  programmes.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));

  const departmentFocus = [];
  (Array.isArray(src.departmentFocus) ? src.departmentFocus : []).slice(0, LIMITS.focus).forEach((f) => {
    const id = oneLine(f && f.departmentId, 80);
    const focus = block(f && f.focus, 600);
    if (!id || !focus) return;
    if (!(departments && departments.has(id))) return;
    if (departmentFocus.some((x) => x.departmentId === id)) return;
    departmentFocus.push({ departmentId: id, departmentName: departments.get(id).name || '', focus });
  });

  return {
    value: {
      title,
      semesterLabel: oneLine(src.semesterLabel, LIMITS.label),
      startDate, endDate,
      theme: oneLine(src.theme, LIMITS.title),
      scripture: oneLine(src.scripture, LIMITS.line),
      vision: block(src.vision, LIMITS.text),
      goals: stringList(src.goals, LIMITS.goals, LIMITS.line),
      priorities: stringList(src.priorities, LIMITS.priorities, LIMITS.line),
      programmes,
      departmentFocus,
      needs: block(src.needs, LIMITS.text),
      risks: block(src.risks, LIMITS.text)
    }
  };
}

// What has to be there before the Coordinator is asked to look at it. A draft
// may be half-written; a submission may not.
function outlineGaps(outline) {
  const gaps = [];
  if (!outline.semesterLabel) gaps.push('which semester it is for');
  if (!outline.startDate || !outline.endDate) gaps.push('the start and end dates');
  if (!outline.theme && !outline.vision) gaps.push('a theme or a vision');
  if (!(outline.goals || []).length) gaps.push('at least one goal');
  if (!(outline.programmes || []).length) gaps.push('at least one programme');
  (outline.programmes || []).forEach((p) => {
    if (p.date && outline.startDate && outline.endDate && (p.date < outline.startDate || p.date > outline.endDate)) {
      gaps.push(`"${p.title}" to fall inside the semester (it is dated ${p.date})`);
    }
  });
  return gaps;
}

// ----------------------------------------------------------------- budget ----
function cleanBudgetLines(rawLines) {
  const raw = Array.isArray(rawLines) ? rawLines : [];
  if (raw.length > LIMITS.budgetLines) return { error: `A budget can hold up to ${LIMITS.budgetLines} lines.` };
  const lines = [];
  for (let i = 0; i < raw.length; i += 1) {
    const l = raw[i] || {};
    const item = oneLine(l.item, LIMITS.line);
    const touched = item || Number(l.unitCost) > 0 || l.note;
    if (!touched) continue;
    if (!item) return { error: `Line ${i + 1} needs a name for what the money is for.` };
    const quantity = Number(l.quantity === '' || l.quantity == null ? 1 : l.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e6) return { error: `"${item}": the quantity must be more than zero.` };
    const rawCost = l.unitCost === '' || l.unitCost == null ? 0 : Number(l.unitCost);
    if (!Number.isFinite(rawCost) || rawCost < 0) return { error: `"${item}": the cost has to be a number, and not below zero.` };
    const unitCost = money(rawCost);
    lines.push({
      item, quantity: Math.round(quantity * 100) / 100, unitCost,
      amount: Math.round(quantity * unitCost * 100) / 100,
      note: oneLine(l.note, LIMITS.line)
    });
  }
  const total = Math.round(lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100;
  return { lines, total };
}

// ---------------------------------------------------------------- minutes ----
// `execById` is this chapter's roster, so nobody can be marked present who is
// not an executive of the chapter.
function cleanMinutes(input, execById) {
  const src = input && typeof input === 'object' ? input : {};
  const date = cleanDate(src.date);
  if (!date) return { error: 'Choose the date the meeting was held.' };

  const present = [];
  (Array.isArray(src.presentExecutiveIds) ? src.presentExecutiveIds : []).forEach((id) => {
    if (execById.has(id) && !present.includes(id)) present.push(id);
  });

  const items = [];
  const rawItems = Array.isArray(src.items) ? src.items : [];
  if (rawItems.length > LIMITS.minuteItems) return { error: `Minutes can hold up to ${LIMITS.minuteItems} agenda items.` };
  rawItems.forEach((it) => {
    const heading = oneLine(it && it.heading, LIMITS.title);
    const discussion = block(it && it.discussion, LIMITS.text);
    const decision = block(it && it.decision, LIMITS.text);
    if (heading || discussion || decision) items.push({ heading, discussion, decision });
  });

  const actions = [];
  const rawActions = Array.isArray(src.actions) ? src.actions : [];
  if (rawActions.length > LIMITS.minuteActions) return { error: `Minutes can hold up to ${LIMITS.minuteActions} action items.` };
  for (let i = 0; i < rawActions.length; i += 1) {
    const a = rawActions[i] || {};
    const task = oneLine(a.task, LIMITS.line);
    const owner = oneLine(a.owner, LIMITS.name);
    const dueRaw = String(a.dueDate || '').trim();
    if (!task && !owner && !dueRaw) continue;
    if (!task) return { error: `Action ${i + 1} needs to say what is to be done.` };
    if (dueRaw && !isDate(dueRaw)) return { error: `"${task}" has a due date that is not real.` };
    actions.push({ id: oneLine(a.id, 60) || `act_${i + 1}`, task, owner, dueDate: dueRaw, done: a.done === true });
  }

  const startTime = oneLine(src.startTime, 10);
  const endTime = oneLine(src.endTime, 10);
  const timeOk = (t) => !t || /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  if (!timeOk(startTime) || !timeOk(endTime)) return { error: 'Times are written like 16:30.' };

  const value = {
    date,
    title: oneLine(src.title, LIMITS.title),
    startTime, endTime,
    venue: oneLine(src.venue, LIMITS.line),
    chair: oneLine(src.chair, LIMITS.name),
    presentExecutiveIds: present,
    presentNames: present.map((id) => execById.get(id).name || ''),
    apologies: block(src.apologies, 600),
    openingPrayer: oneLine(src.openingPrayer, LIMITS.name),
    announcements: block(src.announcements, LIMITS.text),
    items, actions,
    nextMeeting: oneLine(src.nextMeeting, LIMITS.line),
    closingPrayer: oneLine(src.closingPrayer, LIMITS.name),
    body: block(src.body, LIMITS.longText),
    decisions: block(src.decisions, LIMITS.text)
  };
  return { value };
}

// Minutes worth sending to the other secretary: something was actually recorded.
function minutesGaps(m) {
  const gaps = [];
  if (!(m.presentExecutiveIds || []).length && !(m.presentNames || []).length) gaps.push('who was present');
  const recorded = (m.items || []).length || String(m.body || '').trim() || m.fileId;
  if (!recorded) gaps.push('what was discussed (an agenda item, the free text, or a scan of the paper minutes)');
  return gaps;
}

const SECRETARIAT = ['general_secretary', 'assistant_general_secretary'];

// 'adopted' is what shared minutes used to be called.
const isShared = (m) => !!m && (m.status === 'approved' || m.status === 'adopted');

// The seats that must sign before minutes are shared: whichever of the General
// Secretary and the Assistant currently has somebody in it. With one seat empty
// the one who is there is the only signature that can be had.
function seatsRequired(holders) {
  const seats = SECRETARIAT.filter((key) => holders.includes(key));
  return seats;
}

function allApproved(minutes, requiredSeats) {
  return requiredSeats.length > 0 && requiredSeats.every((seat) => (minutes.approvedPositions || []).includes(seat));
}

// ----------------------------------------------------------- announcements ----
const longDate = (value) => {
  if (!isDate(value)) return '';
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  });
};

// The text read out on Sunday: what the secretaries chose to include, in the
// order they chose, each one attributed so the room knows who to ask.
function compileAnnouncements(call, items) {
  const chosen = items
    .filter((i) => i.status === 'included' && !i.nothing && (i.finalText || i.text))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const heading = call.serviceDate ? `Announcements for ${longDate(call.serviceDate)}` : 'Announcements';
  if (!chosen.length) return `${heading}\n\nNothing has been put forward yet.`;
  const body = chosen.map((i, n) => {
    const text = (i.finalText || i.text).trim();
    const tail = [i.whenWhere && i.whenWhere.trim(), i.contact && `Contact: ${i.contact.trim()}`].filter(Boolean).join('. ');
    return `${n + 1}. ${text}${tail ? ` ${tail}${/[.!?]$/.test(tail) ? '' : '.'}` : ''} (${i.fromLabel || i.fromName || 'Executive'})`;
  });
  return `${heading}\n\n${body.join('\n\n')}`;
}

// ------------------------------------------------------------- committees ----
function cleanCommittee(input) {
  const src = input && typeof input === 'object' ? input : {};
  const name = oneLine(src.name, LIMITS.title);
  if (!name) return { error: 'Give the committee or task force a name.' };
  const startDate = cleanDate(src.startDate);
  const dueDate = cleanDate(src.dueDate);
  if (String(src.startDate || '').trim() && !startDate) return { error: 'The start date is not a real date.' };
  if (String(src.dueDate || '').trim() && !dueDate) return { error: 'The due date is not a real date.' };
  if (startDate && dueDate && dueDate < startDate) return { error: 'It cannot be due before it starts.' };
  return {
    value: {
      name,
      kind: src.kind === 'task_force' ? 'task_force' : 'committee',
      mandate: block(src.mandate, LIMITS.text),
      chairName: oneLine(src.chairName, LIMITS.name),
      chairExecutiveId: oneLine(src.chairExecutiveId, 80),
      memberNames: stringList(src.memberNames, 30, LIMITS.name),
      startDate, dueDate,
      status: src.status === 'done' ? 'done' : 'active',
      progressNote: block(src.progressNote, LIMITS.text)
    }
  };
}

module.exports = {
  LIMITS, PROGRAMME_KINDS, SECRETARIAT,
  oneLine, block, isDate, cleanDate, money,
  cleanOutline, outlineGaps,
  cleanBudgetLines,
  cleanMinutes, minutesGaps, isShared, seatsRequired, allApproved,
  compileAnnouncements, longDate,
  cleanCommittee
};
