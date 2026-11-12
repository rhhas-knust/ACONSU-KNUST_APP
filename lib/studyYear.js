// A student's level moves up by itself each academic year. The year turns on
// 1 August (currentAcademicYearLabel in server.js), so a member who was in
// Level 200 in 2026/2027 shows Level 300 from 1 August 2027, without anyone
// editing anything.
//
// The level is typed freely ("200", "Level 200", "L200", "Year 2"), so only a
// level the app can read is moved on; anything else is left as it was. Each
// member records which academic year their level was last true for
// (levelAcademicYear); the yearly step moves it on by the years since. Alumni,
// and anyone who said they have finished, are not moved.

const MAX_HUNDREDS = 6; // Level 600: the longest courses (medicine)
const MAX_YEAR = 6;

function academicYearOf(date) {
  const d = date || new Date();
  const y = d.getFullYear();
  return d.getMonth() + 1 >= 8 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
}
const startOf = (label) => {
  const m = /^(\d{4})\/\d{4}$/.exec(String(label || ''));
  return m ? Number(m[1]) : null;
};

// The level moved on by `years`, or null when it cannot be read. A level
// already at the top stays there.
function bump(level, years) {
  const text = String(level || '');
  if (!years || years < 1) return text;
  const hundreds = /(^|[^0-9])([1-9])00(?![0-9])/.exec(text);
  if (hundreds) {
    const n = Math.min(MAX_HUNDREDS, Number(hundreds[2]) + years);
    const at = hundreds.index + hundreds[1].length;
    return `${text.slice(0, at)}${n}00${text.slice(at + 3)}`;
  }
  const year = /^(\s*(?:year|yr)\s*)([1-9])(\s*)$/i.exec(text) || /^(\s*)([1-9])(\s*)$/.exec(text);
  if (year) {
    const n = Math.min(MAX_YEAR, Number(year[2]) + years);
    return `${year[1]}${n}${year[3]}`;
  }
  return null;
}

// Moves every member's level on to this academic year. A member whose level
// has never been dated is dated to this year and not moved: the count starts
// now. Returns what changed.
async function rollLevels({ models, now, log = () => {} }) {
  const current = academicYearOf(now);
  const currentStart = startOf(current);
  const members = await models.Member.find({ level: { $ne: '' } }).lean();
  const changed = [];
  for (const m of members) {
    if (!m.level) continue;
    if (!m.levelAcademicYear) {
      await models.Member.updateOne({ id: m.id }, { $set: { levelAcademicYear: current } });
      continue;
    }
    const years = currentStart - (startOf(m.levelAcademicYear) || currentStart);
    if (years < 1) continue;
    const done = m.membershipStage === 'alumni' || m.registeredAsAlumni;
    const next = done ? null : bump(m.level, years);
    const set = { levelAcademicYear: current };
    if (next && next !== m.level) {
      set.level = next;
      set.academicHistory = [...(m.academicHistory || []), { year: m.levelAcademicYear, level: m.level, hostel: m.hostel || '', updatedAt: now || new Date() }];
      changed.push({ id: m.id, from: m.level, to: next });
    }
    await models.Member.updateOne({ id: m.id }, { $set: set });
  }
  if (changed.length) log(`Moved ${changed.length} member(s) up a level for ${current}.`);
  return changed;
}

module.exports = { academicYearOf, bump, rollLevels };
