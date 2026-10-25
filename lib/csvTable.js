// Reading a spreadsheet saved as CSV, for the imports that bring a chapter's
// own records in: Shepherding's list of people (lib/peopleImport.js) and the
// books the Financial Secretary already keeps (lib/booksImport.js).
//
// What is the same for both lives here: opening the file whatever Excel or
// Google Sheets wrote it as, numbering its rows the way the spreadsheet does,
// and guessing what each column holds from its heading. What a column means,
// and what a row becomes, is each import's own.

const MAX_BYTES = 1024 * 1024;
const MAX_ROWS = 3000;
const MAX_COLUMNS = 60;
const REPEATABLE = new Set(['note', 'skip']);

const normHeading = (h) => String(h || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

// The best field for one heading, with how sure we are (an exact heading beats
// a heading that only contains one, and a longer match beats a shorter one).
// `headings` is { field: [headings that mean it] }; `skip` are headings that
// only ever mean "leave this out", matched exactly ("No." is a row number, but
// "Phone No." is not); `weak` fields lose a tie to any other.
function scoreHeading(heading, { headings, skip, weak = [] }) {
  const h = normHeading(heading);
  if (skip.has(h)) return { field: 'skip', score: 1000 };
  let best = { field: 'note', score: 0 };
  for (const [field, words] of Object.entries(headings)) {
    for (const w of words) {
      let score = 0;
      if (h === w) score = 1000 + w.length;
      else if (` ${h} `.includes(` ${w} `)) score = w.length - (weak.includes(field) ? 1 : 0);
      if (score > best.score) best = { field, score };
    }
  }
  return best;
}

// One field per column, each field at most once: the surer guess keeps it and
// the other column falls back to 'note'.
function guessMapping(headers, rules) {
  const scored = headers.map((h, index) => ({ index, ...scoreHeading(h, rules) }));
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
function cleanMapping(raw, columnCount, fieldKeys) {
  let list = raw;
  if (typeof raw === 'string') { try { list = JSON.parse(raw); } catch (e) { list = null; } }
  if (!Array.isArray(list)) return null;
  const mapping = [];
  const taken = new Set();
  for (let i = 0; i < columnCount; i++) {
    let field = fieldKeys.has(list[i]) ? list[i] : 'note';
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
  if (buffer.length > MAX_BYTES) return { error: 'That file is larger than 1 MB. A list saved as CSV is far smaller, so check it is the right file.' };
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
  if (width > MAX_COLUMNS) return { error: `That file has ${width} columns. A list like this has a handful, so check it is the right file.` };
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
  if (data.length > MAX_ROWS) return { error: `That file has ${data.length} rows. Up to ${MAX_ROWS} can be brought in at once; split the list and bring it in in parts.` };
  return { headers, rows: data };
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

module.exports = { MAX_BYTES, MAX_ROWS, normHeading, guessMapping, cleanMapping, readFile, parseCsv, detectDateOrder };
