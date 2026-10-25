// Bringing the books a chapter already keeps (an Excel cash book, a Google
// Sheet) into the ledger, so the Financial Secretary starts from where the
// chapter's money actually stands rather than from nothing.
//
// The file is read by lib/csvTable.js, in the same three steps as the people
// list: what each column holds, a check of what would be added, then the
// import itself (routes/books.js). Books are kept three ways and all three are
// understood:
//   - one Amount column, and a column saying In or Out (Income / Expense);
//   - two columns, Money in and Money out (Receipts / Payments);
//   - one Amount column, with spending written as a negative or in brackets.
//
// Nothing is entered twice: a row with the same date, the same amount, the
// same direction and the same description as an entry already in the books
// is that entry. Bringing the same file in again adds nothing.
//
// Tithe is left out, with the reason: the chapter keeps it in Welfare's own
// book (see WELFARE_GIVING_PURPOSES in server.js), and it must never be
// recorded as though it had been in the treasury.

const csvTable = require('./csvTable');

const FIELDS = [
  { key: 'date', label: 'Date' },
  { key: 'type', label: 'In or out' },
  { key: 'amount', label: 'Amount' },
  { key: 'amountIn', label: 'Money in' },
  { key: 'amountOut', label: 'Money out' },
  { key: 'category', label: 'Category (what for)' },
  { key: 'method', label: 'How (cash, MoMo, bank)' },
  { key: 'reference', label: 'Reference / receipt no.' },
  { key: 'payee', label: 'Who (from or to)' },
  { key: 'description', label: 'Details' },
  { key: 'note', label: 'Keep in the details, with its heading' },
  { key: 'skip', label: 'Leave out' }
];
const FIELD_KEYS = new Set(FIELDS.map(f => f.key));

const HEADINGS = {
  date: ['date', 'day', 'date received', 'date paid', 'transaction date', 'value date', 'date of transaction'],
  type: ['type', 'in out', 'in or out', 'income expense', 'income or expense', 'income expenditure', 'entry type', 'transaction type', 'kind', 'nature'],
  amount: ['amount', 'amount ghs', 'amount gh', 'amount ghc', 'amount gh c', 'amount cedis', 'ghs', 'ghc', 'cedis', 'value', 'sum'],
  amountIn: ['money in', 'in', 'income', 'receipts', 'received', 'amount received', 'inflow', 'inflows', 'deposit', 'deposits', 'cash in', 'revenue'],
  amountOut: ['money out', 'out', 'expenditure', 'expense', 'expenses', 'payments', 'payment', 'paid', 'amount paid', 'spent', 'outflow', 'outflows', 'withdrawal', 'withdrawals', 'cash out'],
  category: ['category', 'item', 'items', 'head', 'account', 'account head', 'purpose', 'what for', 'source', 'income type', 'expense type', 'type of income', 'type of expense', 'nature of payment'],
  method: ['method', 'mode', 'payment method', 'mode of payment', 'how', 'how paid', 'channel', 'means'],
  reference: ['reference', 'ref', 'ref no', 'receipt no', 'receipt number', 'transaction id', 'momo id', 'cheque no', 'voucher', 'voucher no', 'pv no'],
  payee: ['payee', 'paid to', 'received from', 'from', 'to', 'name', 'giver', 'donor', 'vendor', 'supplier', 'who', 'person'],
  description: ['description', 'details', 'particulars', 'narration', 'narrative', 'remarks', 'memo', 'notes', 'comment', 'comments']
};
// Only ever exact: a running balance and a total are worked out, not entered.
const SKIP_HEADINGS = new Set(['', 'no', 's n', 'sn', 'serial', 'serial no', 'id', 'timestamp', 'index', 'balance', 'bal', 'running balance', 'balance ghs', 'total', 'totals']);
const RULES = { headings: HEADINGS, skip: SKIP_HEADINGS, weak: ['payee'] };

const guessMapping = (headers) => csvTable.guessMapping(headers, RULES);
const cleanMapping = (raw, columnCount) => csvTable.cleanMapping(raw, columnCount, FIELD_KEYS);

const collapse = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const cut = (s, n) => collapse(s).slice(0, n);
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MAX_AMOUNT = 10000000;

const pad = (n) => String(n).padStart(2, '0');
function isoDate(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}
function fullYear(y) {
  if (y >= 1000) return y;
  const thisYear = new Date().getUTCFullYear() % 100;
  return y <= thisYear + 1 ? 2000 + y : 1900 + y;
}

// A day in the books needs its year: "12 March" on its own could be any March.
// Day first, as Ghana writes dates, unless the column is plainly month first.
// Excel sometimes saves a date as its day number (45000 is 15 March 2023).
function parseDate(raw, order) {
  const t = collapse(raw).toLowerCase().replace(/(\d+)(st|nd|rd|th)\b/g, '$1').replace(/,/g, ' ');
  if (!t) return { error: 'No date' };
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return { value: isoDate(+m[1], +m[2], +m[3]) };
  if (/^\d{5}$/.test(t) && +t > 20000 && +t < 70000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(t) * 86400000);
    return { value: d.toISOString().slice(0, 10) };
  }
  const word = t.match(/[a-z]{3,}/);
  if (word) {
    const month = MONTHS.indexOf(word[0].slice(0, 3)) + 1;
    const nums = (t.match(/\d+/g) || []).map(Number);
    const day = nums.find(n => n >= 1 && n <= 31);
    const year = nums.find(n => n !== day && (n >= 1000 || nums.length > 1));
    if (!month || !day) return { error: `"${collapse(raw)}" is not a date` };
    if (year === undefined) return { error: `The date "${collapse(raw)}" has no year` };
    return { value: isoDate(fullYear(year), month, day) };
  }
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const [a, b, y] = [+m[1], +m[2], fullYear(+m[3])];
    return { value: order === 'mdy' ? isoDate(y, a, b) : isoDate(y, b, a) };
  }
  if (/^\d{1,2}[-/.]\d{1,2}$/.test(t)) return { error: `The date "${collapse(raw)}" has no year` };
  return { error: `"${collapse(raw)}" is not a date` };
}

// "GHS 1,200.50", "GH₵1,200", "1200", "(200.00)" and "-200" are all amounts;
// brackets and a minus sign mean money out. Blank is no amount at all.
function parseMoney(raw) {
  let t = collapse(raw).toLowerCase();
  if (!t || t === '-') return null;
  let negative = false;
  if (/^\(.*\)$/.test(t)) { negative = true; t = t.slice(1, -1); }
  t = t.replace(/gh[s₵¢c]?|cedis?|₵|¢/g, '').replace(/[\s,]/g, '');
  if (/^-/.test(t) || /-$/.test(t)) { negative = true; t = t.replace(/^-|-$/g, ''); }
  if (!/^\d+(\.\d+)?$/.test(t)) return NaN;
  const n = Math.round(Number(t) * 100) / 100;
  return negative ? -n : n;
}

const IN_WORDS = ['in', 'income', 'received', 'receive', 'receipt', 'receipts', 'inflow', 'deposit', 'revenue', 'collection', 'contribution', 'donation', 'gift', 'credit in'];
const OUT_WORDS = ['out', 'expense', 'expenses', 'expenditure', 'spent', 'spend', 'payment', 'paid', 'outflow', 'withdrawal', 'purchase', 'bought'];
function classifyType(raw) {
  const words = collapse(raw).toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (words.some(w => OUT_WORDS.includes(w))) return 'expense';
  if (words.some(w => IN_WORDS.includes(w))) return 'income';
  return null;
}

// The chapter's money comes in five kinds (server.js INCOME_CATEGORIES). What
// the books call each is recognised; anything else is "other", with the
// book's own word kept in the details.
function incomeCategory(raw) {
  const t = collapse(raw).toLowerCase();
  if (!t) return { value: 'other' };
  if (/\btithes?\b/.test(t)) return { value: 'tithe' };
  if (/\b(offertory|offerings?|collections?)\b/.test(t)) return { value: 'offertory' };
  if (/\bharvest\b/.test(t)) return { value: 'harvest' };
  if (/\b(momo|mobile money)\b/.test(t)) return { value: 'momo' };
  return { value: 'other', kept: collapse(raw) };
}

function paymentMethod(raw) {
  const t = collapse(raw).toLowerCase();
  if (!t || /\bcash\b/.test(t)) return 'cash';
  if (/\b(momo|mobile money|mtn|vodafone|telecel|airtel|airteltigo)\b/.test(t)) return 'momo';
  if (/\bcheque|\bcheck\b|\bchq\b/.test(t)) return 'cheque';
  if (/\b(bank|transfer|deposit)\b/.test(t)) return 'bank';
  return 'other';
}

// One row of the books, made into a ledger entry, or the reason it cannot be.
function cleanRow(cells, headers, mapping, ctx) {
  const get = (field) => {
    const i = mapping.indexOf(field);
    return i >= 0 ? collapse(cells[i]) : '';
  };
  const details = [];

  const date = parseDate(get('date'), ctx.dateOrder);
  if (!date.value) return { reason: date.error || 'No date' };

  // What the money was for: the category column, or, in a cash book that has
  // none, the details ("Sunday offering", "Tithe").
  const categoryText = get('category');
  const forWhat = categoryText || get('description');

  let entryType = null;
  let amount = null;
  if (mapping.includes('amountIn') || mapping.includes('amountOut')) {
    const moneyIn = parseMoney(get('amountIn'));
    const moneyOut = parseMoney(get('amountOut'));
    if (Number.isNaN(moneyIn) || Number.isNaN(moneyOut)) return { reason: 'The amount is not a number' };
    if (moneyIn && moneyOut) return { reason: 'Money in and money out on the same row' };
    if (moneyIn) { entryType = moneyIn > 0 ? 'income' : 'expense'; amount = Math.abs(moneyIn); }
    else if (moneyOut) { entryType = 'expense'; amount = Math.abs(moneyOut); }
  }
  if (!amount && mapping.includes('amount')) {
    const a = parseMoney(get('amount'));
    if (Number.isNaN(a)) return { reason: 'The amount is not a number' };
    if (a) {
      amount = Math.abs(a);
      entryType = classifyType(get('type')) || (a < 0 ? 'expense' : null);
      if (!entryType && !mapping.includes('type')) {
        const known = incomeCategory(forWhat);
        if (!known.kept && forWhat) entryType = 'income';
      }
    }
  }
  if (!amount) return { reason: 'No amount' };
  if (!entryType) return { reason: 'Could not tell if this was money in or money out. Choose the column that says which.' };
  if (amount > MAX_AMOUNT) return { reason: 'The amount looks too large to be right' };

  let category;
  if (entryType === 'income') {
    const c = incomeCategory(forWhat);
    if (c.value === 'tithe') return { reason: 'Tithe is kept in Welfare\'s own book, not the treasury\'s' };
    category = c.value;
    if (c.kept && categoryText) details.push(`Category: ${categoryText}`);
  } else {
    category = cut(categoryText, 60) || 'other';
  }

  const own = get('description');
  if (own) details.unshift(own);
  mapping.forEach((field, i) => {
    const value = collapse(cells[i]);
    if (field === 'note' && value) details.push(`${collapse(headers[i]) || `Column ${i + 1}`}: ${value}`);
  });

  return {
    entry: {
      date: date.value, entryType, amount, category,
      method: paymentMethod(get('method')),
      reference: cut(get('reference'), 80),
      payee: cut(get('payee'), 120),
      description: details.join('. ').slice(0, 500)
    }
  };
}

// The same entry, however it was typed: what makes two rows one.
const sameKey = (e) => [e.date, e.entryType, Number(e.amount).toFixed(2),
  collapse(e.description || e.payee || e.category).toLowerCase()].join('|');

// The plan for the whole file. Each row ends up as one of:
//   add  - a new entry for the books
//   same - already in the books (entered by hand, or brought in before)
//   skip - left out, with the reason
function planImport(file, mapping, { existing = [] } = {}) {
  const dateCol = mapping.indexOf('date');
  const ctx = { dateOrder: csvTable.detectDateOrder(dateCol >= 0 ? file.rows.map(r => r.cells[dateCol]) : []) };
  // Counted, not just looked up: two identical entries in the books match two
  // identical rows in the file, not one.
  const inBooks = new Map();
  existing.filter(e => e.approvalStatus !== 'rejected').forEach((e) => {
    const k = sameKey(e);
    inBooks.set(k, (inBooks.get(k) || 0) + 1);
  });
  const seen = new Map();
  const plan = file.rows.map(({ rowNumber, cells }) => {
    const { entry, reason } = cleanRow(cells, file.headers, mapping, ctx);
    if (!entry) return { row: rowNumber, action: 'skip', reason, warnings: [] };
    const k = sameKey(entry);
    const warnings = [];
    if (inBooks.get(k)) {
      inBooks.set(k, inBooks.get(k) - 1);
      return { row: rowNumber, action: 'same', entry, warnings };
    }
    if (seen.has(k)) warnings.push(`Looks the same as row ${seen.get(k)}. Both are added; check it is not entered twice.`);
    else seen.set(k, rowNumber);
    return { row: rowNumber, action: 'add', entry, warnings };
  });
  const counts = { add: 0, same: 0, skip: 0 };
  const totals = { in: 0, out: 0 };
  let first = '';
  let last = '';
  plan.forEach((p) => {
    counts[p.action]++;
    if (p.action !== 'add') return;
    totals[p.entry.entryType === 'income' ? 'in' : 'out'] += p.entry.amount;
    if (!first || p.entry.date < first) first = p.entry.date;
    if (!last || p.entry.date > last) last = p.entry.date;
  });
  totals.in = Math.round(totals.in * 100) / 100;
  totals.out = Math.round(totals.out * 100) / 100;
  return { plan, counts, totals, from: first, to: last };
}

module.exports = { FIELDS, guessMapping, cleanMapping, planImport, parseDate, parseMoney, classifyType, incomeCategory, paymentMethod };
