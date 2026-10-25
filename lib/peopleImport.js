// Bringing a chapter's existing list into Shepherding: the spreadsheet the team
// already keeps, saved as CSV (Excel, Google Sheets and Google Forms all can).
//
// Everything about the file is worked out here, on the server, so there is one
// reading of it rather than one in the browser and another here:
//   1. read   - the file is opened and each column is given a best guess
//               (Name, Phone, Hall...), which Shepherding can correct.
//   2. check  - with the columns settled, every row is tidied and compared with
//               the people already on the list. Nothing is written.
//   3. import - the same plan, carried out by routes/shepherd-list.js.
//
// Nobody already on the list is added twice. The same phone number or email is
// the same person (as long as the names agree at all: two students can share a
// parent's number), and so is the same name when one side has no number or
// email to tell them apart. A blank on the list is filled from the file; what
// is already on the list is never overwritten.

const MAX_BYTES = 1024 * 1024;
const MAX_ROWS = 3000;
const MAX_COLUMNS = 60;

// What a column can be. 'note' keeps the column in the person's notes under
// its own heading ("Gender: Female"), so nothing in the file is lost by having
// no box of its own; 'skip' leaves it out (a row number, a form's timestamp).
const FIELDS = [
  { key: 'name', label: 'Full name' },
  { key: 'firstName', label: 'First / other names' },
  { key: 'lastName', label: 'Surname' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'level', label: 'Level / year' },
  { key: 'programme', label: 'Programme / course' },
  { key: 'address', label: 'Hall / hostel / address' },
  { key: 'department', label: 'Church department' },
  { key: 'birthday', label: 'Birthday' },
  { key: 'emergencyContact', label: 'Emergency contact' },
  { key: 'notes', label: 'Notes' },
  { key: 'note', label: 'Keep in notes, with its heading' },
  { key: 'skip', label: 'Leave out' }
];
const FIELD_KEYS = new Set(FIELDS.map(f => f.key));
const REPEATABLE = new Set(['note', 'skip']);

// The headings lists actually use, after normalising (lower case, punctuation
// gone): "Phone No." is "phone no", "Hall/Hostel" is "hall hostel".
const HEADINGS = {
  name: ['name', 'names', 'full name', 'full names', 'fullname', 'member', 'member name', 'members name', 'name of member', 'student name', 'name of student'],
  firstName: ['first name', 'first names', 'firstname', 'other names', 'other name', 'othernames', 'given name', 'given names', 'forename', 'forenames'],
  lastName: ['surname', 'last name', 'lastname', 'family name'],
  phone: ['phone', 'phone number', 'phone numbers', 'phone no', 'telephone', 'telephone number', 'tel', 'tel no', 'mobile', 'mobile number', 'mobile no', 'cell', 'contact', 'contacts', 'contact number', 'contact no', 'number', 'whatsapp', 'whatsapp number', 'whatsapp contact'],
  email: ['email', 'emails', 'e mail', 'email address', 'e mail address', 'mail'],
  level: ['level', 'year', 'year of study', 'current level', 'level year', 'class'],
  programme: ['programme', 'program', 'programme of study', 'program of study', 'course', 'course of study', 'major'],
  address: ['hall', 'hostel', 'hall hostel', 'hostel hall', 'hall or hostel', 'hall of residence', 'residence', 'place of residence', 'residential address', 'address', 'location', 'accommodation', 'room', 'area'],
  department: ['department', 'church department', 'aconsu department', 'dept', 'ministry', 'unit'],
  birthday: ['birthday', 'birth day', 'date of birth', 'dob', 'd o b', 'birth date', 'birthdate', 'day of birth'],
  emergencyContact: ['emergency contact', 'emergency number', 'next of kin', 'guardian', 'guardian contact', 'guardian number', 'parent contact', 'parents contact'],
  notes: ['notes', 'note', 'remarks', 'remark', 'comment', 'comments']
};
// Only ever an exact heading: "No." is a row number, but "Phone No." is not.
const SKIP_HEADINGS = new Set(['', 'no', 's n', 'sn', 'serial', 'serial no', 'serial number', 'id', 'timestamp', 'index']);

const normHeading = (h) => String(h || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

// The best field for one heading, with how sure we are (an exact heading beats
// a heading that only contains one, and a longer match beats a shorter one).
function scoreHeading(heading) {
  const h = normHeading(heading);
  if (SKIP_HEADINGS.has(h)) return { field: 'skip', score: 1000 };
  let best = { field: 'note', score: 0 };
  for (const [field, words] of Object.entries(HEADINGS)) {
    for (const w of words) {
      let score = 0;
      if (h === w) score = 1000 + w.length;
      else if (` ${h} `.includes(` ${w} `)) score = w.length - (field === 'name' ? 1 : 0);
      if (score > best.score) best = { field, score };
    }
  }
  return best;
}

// One field per column, each field at most once: the surer guess keeps it and
// the other column falls back to the notes.
function guessMapping(headers) {
  const scored = headers.map((h, index) => ({ index, ...scoreHeading(h) }));
  const mapping = headers.map(() => 'note');
  const taken = new Set();
  [...scored].sort((a, b) => b.score - a.score).forEach(({ index, field }) => {
    if (REPEATABLE.has(field)) { mapping[index] = field; return; }
    if (taken.has(field)) return;
    taken.add(field);
    mapping[index] = field;
  });
  return mapping;
}

// Whatever a browser sends for a mapping, made into one we can trust.
function cleanMapping(raw, columnCount) {
  let list = raw;
  if (typeof raw === 'string') { try { list = JSON.parse(raw); } catch (e) { list = null; } }
  if (!Array.isArray(list)) return null;
  const mapping = [];
  const taken = new Set();
  for (let i = 0; i < columnCount; i++) {
    let field = FIELD_KEYS.has(list[i]) ? list[i] : 'note';
    if (!REPEATABLE.has(field)) {
      if (taken.has(field)) field = 'note';
      taken.add(field);
    }
    mapping.push(field);
  }
  return mapping;
}

// ---------- reading the file ----------

// Excel on Windows saves "CSV (Comma delimited)" in the old Windows encoding,
// not UTF-8; a curly apostrophe in a name would otherwise come out as junk.
// Node reads "windows-1252" as plain Latin-1, which gets the 32 characters the
// two differ on wrong (’ “ ” – among them), so those are mapped here.
const WINDOWS_1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ';
function decode(buffer) {
  let bytes = buffer;
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) bytes = bytes.subarray(3);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) {
    let text = '';
    for (const b of bytes) text += b >= 0x80 && b <= 0x9F ? WINDOWS_1252[b - 0x80] : String.fromCharCode(b);
    return text;
  }
}

// The separator is whichever of , ; or tab the first line uses most (outside
// quotes). Excel set to a European language saves with semicolons.
function detectDelimiter(text) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === '\n' || ch === '\r')) break;
    else if (!inQuotes && ch in counts) counts[ch]++;
  }
  const [sep, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? sep : ',';
}

// RFC 4180, as spreadsheets write it: quoted cells may hold the separator, a
// line break, or a doubled "" for a quote mark.
function parseCsv(text) {
  const sep = detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"' && cell.trim() === '') {
      cell = '';
      inQuotes = true;
    } else if (ch === sep) {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row);
      row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// Opens the upload. Rows keep their spreadsheet row numbers (the heading row
// is row 1), so "row 14 has no name" is row 14 when they open the file.
function readFile(buffer, { hasHeader = true } = {}) {
  if (!buffer || !buffer.length) return { error: 'That file is empty.' };
  if (buffer.length > MAX_BYTES) return { error: 'That file is larger than 1 MB. A list of names saved as CSV is far smaller, so check it is the right file.' };
  const head = buffer.subarray(0, 4).toString('hex');
  if (head === '504b0304' || head === 'd0cf11e0') {
    return { error: 'That is an Excel file. In Excel choose File, Save As, and pick "CSV UTF-8 (Comma delimited)". In Google Sheets choose File, Download, Comma-separated values. Then choose that file here.' };
  }
  if (buffer.includes(0)) return { error: 'That does not look like a CSV file. Save the list as CSV from Excel or Google Sheets and try again.' };
  const rows = parseCsv(decode(buffer));
  const numbered = rows.map((cells, i) => ({ rowNumber: i + 1, cells: cells.map(c => c.trim()) }))
    .filter(r => r.cells.some(c => c !== ''));
  if (!numbered.length) return { error: 'That file is empty.' };
  const width = Math.max(...numbered.map(r => r.cells.length));
  if (width > MAX_COLUMNS) return { error: `That file has ${width} columns. A list of people has a handful, so check it is the right file.` };
  let headers;
  let data;
  if (hasHeader) {
    headers = numbered[0].cells;
    data = numbered.slice(1);
  } else {
    headers = [];
    data = numbered;
  }
  headers = Array.from({ length: width }, (_, i) => headers[i] || (hasHeader ? '' : `Column ${i + 1}`));
  if (data.length > MAX_ROWS) return { error: `That file has ${data.length} people in it. Up to ${MAX_ROWS} can be brought in at once; split the list and bring it in in parts.` };
  return { headers, rows: data };
}

// ---------- tidying one person ----------

const DAYS_IN_MONTH = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const TITLES = new Set(['mr', 'mrs', 'miss', 'ms', 'dr', 'rev', 'bro', 'sis', 'brother', 'sister', 'pastor', 'elder', 'deacon', 'deaconess', 'apostle', 'prophet', 'prophetess', 'evang']);

const collapse = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const cut = (s, n) => collapse(s).slice(0, n);

// Lists are often typed in capitals, or all in small letters. "ABENA O. MENSAH"
// and "kwame" read better at the door as "Abena O. Mensah" and "Kwame". A word
// typed in mixed case ("McCarthy") is left exactly as typed.
function tidyName(raw) {
  return cut(raw, 120).split(/([\s'’-]+)/).map((word) => {
    const letters = word.replace(/[^A-Za-z]/g, '');
    if (!letters || (letters !== letters.toUpperCase() && letters !== letters.toLowerCase())) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join('');
}

const nameKey = (name) => collapse(name).toLowerCase().replace(/[.,]/g, '');
const nameTokens = (name) => nameKey(name).split(/[\s'’-]+/).filter(t => t.length >= 2 && !TITLES.has(t));
function namesAgree(a, b) {
  const x = nameTokens(a);
  const y = new Set(nameTokens(b));
  return !x.length || !y.size || x.some(t => y.has(t));
}

// The last nine digits: 024 412 3456, +233 24 412 3456 and 244123456 (Excel
// drops the leading 0) are one number.
function phoneKey(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : '';
}

function tidyOnePhone(part) {
  let d = part.replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (/^233\d{9}$/.test(d)) return `0${d.slice(3)}`;
  if (/^0\d{9}$/.test(d)) return d;
  if (/^[2-5]\d{8}$/.test(d)) return `0${d}`;
  return collapse(part);
}

// A cell can hold two numbers ("024... / 020..."): the first is the phone and
// the rest are kept in the notes. Excel sometimes saves a long number as
// 2.44123E+08, which has lost digits for good; that is said, never guessed at.
function tidyPhone(raw) {
  const text = collapse(raw);
  if (!text) return { value: '' };
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(text.replace(/\s/g, ''))) return { value: '', unreadable: text };
  const parts = text.split(/\s*(?:\/|,|;|\||\bor\b|\band\b|&)\s*/i).map(p => p.trim()).filter(Boolean);
  return { value: tidyOnePhone(parts[0] || '').slice(0, 40), extra: parts.slice(1).map(tidyOnePhone).join(', ') };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// "Level 200", "L200" and "200" are all level 200. Anything else is kept as typed.
function tidyLevel(raw) {
  const text = cut(raw, 30);
  const m = text.match(/(?:^|\D)([1-9]00)(?:\D|$)/);
  return m ? m[1] : text;
}

// Which way round a column of numeric dates is: 13/05 can only be day first,
// 05/13 only month first. Ghana writes the day first, so that is the default.
function detectDateOrder(values) {
  let dayFirst = false;
  let monthFirst = false;
  values.forEach((v) => {
    const m = String(v || '').trim().match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.]\d{2,4})?$/);
    if (!m) return;
    if (+m[1] > 12) dayFirst = true;
    if (+m[2] > 12) monthFirst = true;
  });
  return monthFirst && !dayFirst ? 'mdy' : 'dmy';
}

function monthDay(month, day) {
  return month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN_MONTH[month] ? { month, day } : null;
}

// Only the month and day are kept: the app wishes people a happy birthday, it
// does not need to know how old they are.
function parseBirthday(raw, order) {
  const t = collapse(raw).toLowerCase().replace(/(\d+)(st|nd|rd|th)\b/g, '$1');
  if (!t) return null;
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return monthDay(+m[2], +m[3]);
  const word = t.match(/[a-z]{3,}/);
  if (word) {
    const month = MONTHS.indexOf(word[0].slice(0, 3)) + 1;
    const day = t.match(/(?:^|\D)(\d{1,2})(?:\D|$)/);
    return month && day ? monthDay(month, +day[1]) : null;
  }
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?$/);
  if (m) return order === 'mdy' ? monthDay(+m[1], +m[2]) : monthDay(+m[2], +m[1]);
  return null;
}

// "Music", "music department" and "Music Ministry" are the Music department.
// A department the chapter does not have (often a student's academic
// department, under the same heading) goes to the notes instead.
const deptKey = (s) => collapse(s).toLowerCase().replace(/\b(department|dept|ministry|unit|team)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function matchDepartment(raw, departments) {
  const key = deptKey(raw);
  if (!key) return '';
  const found = departments.find(d => deptKey(d.name) === key);
  return found ? found.id : '';
}

// One row of the file, made into a person. `notes` collects whatever has no
// box of its own, and `warnings` what Shepherding should know about.
function cleanRow(cells, headers, mapping, ctx) {
  const get = (field) => {
    const i = mapping.indexOf(field);
    return i >= 0 ? collapse(cells[i]) : '';
  };
  const notes = [];
  const warnings = [];
  const person = {};

  person.name = tidyName(get('name') || [get('firstName'), get('lastName')].filter(Boolean).join(' '));

  const phone = tidyPhone(get('phone'));
  person.phone = phone.value;
  if (phone.extra) notes.push(`Other phone: ${phone.extra}`);
  if (phone.unreadable) {
    notes.push(`Phone as it was in the file: ${phone.unreadable}`);
    warnings.push(`The phone number was saved by Excel as ${phone.unreadable}, which has lost digits. Add it by hand.`);
  }

  const email = get('email').toLowerCase();
  if (email && EMAIL.test(email) && email.length <= 120) person.email = email;
  else { person.email = ''; if (email) notes.push(`Email as it was in the file: ${email}`); }

  person.level = tidyLevel(get('level'));
  person.programme = cut(get('programme'), 120);
  person.address = cut(get('address'), 200);
  person.emergencyContact = cut(get('emergencyContact'), 200);

  const dept = get('department');
  person.department = dept ? matchDepartment(dept, ctx.departments || []) : '';
  if (dept && !person.department) notes.push(`Department: ${dept}`);

  const birthdayRaw = get('birthday');
  const birthday = parseBirthday(birthdayRaw, ctx.dateOrder);
  person.birthdayMonth = birthday ? birthday.month : null;
  person.birthdayDay = birthday ? birthday.day : null;
  if (birthdayRaw && !birthday) notes.push(`Birthday: ${birthdayRaw}`);

  const own = get('notes');
  if (own) notes.unshift(own);
  mapping.forEach((field, i) => {
    const value = collapse(cells[i]);
    if (field === 'note' && value) notes.push(`${collapse(headers[i]) || `Column ${i + 1}`}: ${value}`);
  });
  person.pastoralNotes = notes.join('\n').slice(0, 2000);
  return { person, warnings };
}

// ---------- who is new ----------

// Everyone already known to Shepherding, in one shape: { kind: 'member' | 'record', id, ...fields }.
function indexPeople(people) {
  const byPhone = new Map();
  const byEmail = new Map();
  const byName = new Map();
  const add = (map, key, p) => { if (key) map.set(key, [...(map.get(key) || []), p]); };
  const put = (p) => {
    const entry = { ...p, phoneKey: phoneKey(p.phone), emailKey: String(p.email || '').toLowerCase(), nameKey: nameKey(p.name) };
    add(byPhone, entry.phoneKey, entry);
    add(byEmail, entry.emailKey, entry);
    add(byName, entry.nameKey, entry);
    return entry;
  };
  (people || []).forEach(put);
  return {
    put,
    // Phone first, then email, then name, as the strongest evidence wins.
    find(p) {
      const k = { phoneKey: phoneKey(p.phone), emailKey: String(p.email || '').toLowerCase(), nameKey: nameKey(p.name) };
      for (const e of byPhone.get(k.phoneKey) || []) if (namesAgree(p.name, e.name)) return { match: e };
      for (const e of byEmail.get(k.emailKey) || []) if (namesAgree(p.name, e.name)) return { match: e };
      for (const e of byName.get(k.nameKey) || []) {
        if (!(k.phoneKey || k.emailKey) || !(e.phoneKey || e.emailKey)) return { match: e };
      }
      const sharer = (byPhone.get(k.phoneKey) || [])[0];
      return { match: null, sharesPhoneWith: sharer ? sharer.name : '' };
    }
  };
}

const FILLABLE = ['phone', 'email', 'level', 'programme', 'address', 'department', 'emergencyContact', 'pastoralNotes'];

// What bringing this person in would change on the list record they match:
// only the blanks, never something already written there.
function blanksToFill(existing, person) {
  const changes = {};
  FILLABLE.forEach((f) => { if (!existing[f] && person[f]) changes[f] = person[f]; });
  if (!existing.birthdayMonth && person.birthdayMonth) {
    changes.birthdayMonth = person.birthdayMonth;
    changes.birthdayDay = person.birthdayDay;
  }
  return changes;
}

// The plan for the whole file. Each row ends up as one of:
//   add     - new to the list
//   fill    - already on the list; blanks there are filled from the file
//   same    - already on the list, and the file adds nothing new
//   account - already in the app with an account of their own
//   skip    - left out, with the reason (no name, or the same person as an
//             earlier row of the file)
function planImport(file, mapping, { existing = [], departments = [] } = {}) {
  const birthdayCol = mapping.indexOf('birthday');
  const ctx = {
    departments,
    dateOrder: detectDateOrder(birthdayCol >= 0 ? file.rows.map(r => r.cells[birthdayCol]) : [])
  };
  const known = indexPeople(existing);
  const inFile = indexPeople([]);
  const plan = file.rows.map(({ rowNumber, cells }) => {
    const { person, warnings } = cleanRow(cells, file.headers, mapping, ctx);
    const entry = { row: rowNumber, name: person.name, person, warnings };
    if (!person.name) return { ...entry, action: 'skip', reason: 'No name in this row' };
    const earlier = inFile.find(person);
    if (earlier.match) return { ...entry, action: 'skip', reason: `Same person as row ${earlier.match.row}` };
    const found = known.find(person);
    inFile.put({ ...person, row: rowNumber });
    if (found.sharesPhoneWith) warnings.push(`Has the same phone number as ${found.sharesPhoneWith}, who is already on the list.`);
    else if (earlier.sharesPhoneWith) warnings.push(`Has the same phone number as ${earlier.sharesPhoneWith}, earlier in the file.`);
    if (!found.match) return { ...entry, action: 'add' };
    if (found.match.kind === 'member') return { ...entry, action: 'account', matchId: found.match.id, matchName: found.match.name };
    const changes = blanksToFill(found.match, person);
    return Object.keys(changes).length
      ? { ...entry, action: 'fill', matchId: found.match.id, matchName: found.match.name, changes }
      : { ...entry, action: 'same', matchId: found.match.id, matchName: found.match.name };
  });
  const counts = { add: 0, fill: 0, same: 0, account: 0, skip: 0 };
  plan.forEach(p => { counts[p.action]++; });
  return { plan, counts };
}

module.exports = {
  FIELDS, MAX_ROWS, MAX_BYTES,
  readFile, parseCsv, guessMapping, cleanMapping, planImport,
  tidyName, tidyPhone, phoneKey, parseBirthday, detectDateOrder, tidyLevel, matchDepartment, namesAgree
};
