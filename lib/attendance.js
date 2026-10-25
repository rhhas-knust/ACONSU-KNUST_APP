// Sunday check-in at the door, and what a register says about one person.
//
// A register is one document per chapter, date and service, holding every
// person's mark. At the door several phones check people in at once, so a
// check-in never writes back a copy of the register it read a moment ago:
// that would quietly undo whoever else checked someone in in between. Each
// save lands only on the version (`rev`) it was worked out from, and is worked
// out again from the newer one when someone else got there first.

const models = require('./models');
const repo = require('./repo');

const SERVICE_TYPES = ['sunday', 'midweek', 'special'];
const ATTEMPTS = 12;

// The register's id is made from what it is, so two phones opening the same
// Sunday's register at the same moment cannot make two of them: the second
// is refused as a duplicate, and adds its check-in to the first instead.
function registerId(chapterId, date, serviceType) {
  return `att_${chapterId || 'none'}_${date}_${serviceType}`;
}

// A register saved before `rev` existed has none: that counts as 0.
const atRev = (record) => (record.rev ? { rev: record.rev } : { $or: [{ rev: 0 }, { rev: null }] });

const isDuplicate = (e) => !!(e && (e.code === 11000 || /duplicate key/i.test(e.message || '')));

// Check someone in (present = true) or take the check-in back (present = false).
// `person` is { memberId } for an account holder or { recordId } for someone on
// Shepherding's own list, plus their name as it stands today.
// `scope` confines the register looked for to the caller's chapter.
async function setMark({ scope, chapterId, date, serviceType, person, present, recordedBy }) {
  const service = SERVICE_TYPES.includes(serviceType) ? serviceType : 'sunday';
  const key = person.memberId ? 'memberId' : 'recordId';
  const value = person.memberId || person.recordId;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const existing = (await repo.getAll('attendanceRecords', { ...scope, date, serviceType: service }))[0] || null;
    const marks = existing ? existing.marks.map(m => ({ ...m })) : [];
    const i = marks.findIndex(m => m[key] === value);
    const wasPresent = i >= 0 && marks[i].status === 'present';
    if (present === wasPresent) return { changed: false, record: existing };
    if (present) {
      const mark = { memberId: person.memberId || '', recordId: person.recordId || '', name: person.name || '', status: 'present', at: new Date() };
      if (i >= 0) marks[i] = { ...marks[i], ...mark }; else marks.push(mark);
    } else {
      marks.splice(i, 1);
    }
    if (!existing) {
      try {
        const record = await repo.create('attendanceRecords', {
          id: registerId(chapterId, date, service), chapterId, date, serviceType: service,
          marks, visitorCount: 0, notes: '', recordedBy: recordedBy || '', rev: 1
        });
        return { changed: true, record };
      } catch (e) {
        if (isDuplicate(e)) continue;
        throw e;
      }
    }
    const result = await models.AttendanceRecord.updateOne(
      { id: existing.id, ...atRev(existing) },
      { $set: { marks }, $inc: { rev: 1 } }
    );
    if ((result.modifiedCount ?? result.nModified) === 1) {
      return { changed: true, record: { ...existing, marks, rev: (existing.rev || 0) + 1 } };
    }
    // Someone else saved first. A short, uneven pause before trying again, so
    // phones that collided once do not keep colliding in step.
    await new Promise(r => setTimeout(r, 5 + Math.random() * 20 * (attempt + 1)));
  }
  const busy = new Error('Too many people are being checked in at this moment. Try again.');
  busy.status = 503;
  throw busy;
}

const dayOf = (when) => {
  const d = new Date(when);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

// Every service that counts for one person, newest first. With check-in at the
// door, only the people who came get a mark, so a service with no mark for
// them counts as missed, as long as they were on the list by that day.
// Services from before they were on the list are not held against them.
function attendanceFor(person, registers) {
  const since = dayOf(person.createdAt);
  return registers
    .map((r) => {
      const mark = r.marks.find(m => (person.memberId && m.memberId === person.memberId) || (person.recordId && m.recordId === person.recordId));
      if (mark) return { date: r.date, serviceType: r.serviceType, status: mark.status };
      if (since && r.date >= since) return { date: r.date, serviceType: r.serviceType, status: 'absent', notCheckedIn: true };
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function attendanceRate(history) {
  const attended = history.filter(h => h.status === 'present').length;
  return {
    servicesRecorded: history.length,
    attended,
    rate: history.length ? Math.round((attended / history.length) * 100) : null
  };
}

const STATUS_WEIGHT = { present: 3, excused: 2, absent: 1 };

// When someone on Shepherding's list opens an account (lib/listLink.js), the
// Sundays they were checked in at as a list person become the account's. Each
// mark keeps the list record's id beside the account's, so the link can be
// undone (back = true) and those marks return to the list record. A register
// that has them both ways (checked in by name, and by their new account) keeps
// one mark, the better of the two.
async function moveMarks({ chapterId, recordId, memberId, back = false }) {
  const registers = (await repo.getAll('attendanceRecords', { chapterId }))
    .filter(r => r.marks.some(m => m.recordId === recordId));
  let moved = 0;
  for (const { id } of registers) {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const current = await repo.getById('attendanceRecords', id, { chapterId });
      if (!current) break;
      let marks;
      if (back) {
        marks = current.marks.map(m => (m.recordId === recordId ? { ...m, memberId: '' } : m));
      } else {
        const fromList = current.marks.find(m => m.recordId === recordId);
        const asMember = current.marks.find(m => m !== fromList && m.memberId === memberId);
        const best = asMember && STATUS_WEIGHT[asMember.status] > STATUS_WEIGHT[fromList.status] ? asMember : fromList;
        const merged = { ...fromList, memberId, status: best.status, at: best.at || fromList.at || (asMember && asMember.at) || null };
        marks = current.marks.filter(m => m !== asMember).map(m => (m === fromList ? merged : m));
      }
      const result = await models.AttendanceRecord.updateOne(
        { id: current.id, ...atRev(current) },
        { $set: { marks }, $inc: { rev: 1 } }
      );
      if ((result.modifiedCount ?? result.nModified) === 1) { moved++; break; }
      await new Promise(r => setTimeout(r, 5 + Math.random() * 20 * (attempt + 1)));
    }
  }
  return moved;
}

module.exports = { SERVICE_TYPES, registerId, atRev, setMark, moveMarks, attendanceFor, attendanceRate };
