// What makes a password acceptable when someone chooses one for themselves.
//
// Only the rules a person can act on are here, each answered in plain words so
// the form can show the reason instead of a bare "invalid". The length limit is
// not arbitrary: bcrypt only reads the first 72 bytes, so a longer password
// would be silently cut and the extra characters would protect nothing.
const MIN_LENGTH = 8;
// Leaders' accounts open other people's records, so theirs are longer.
const LEADER_MIN_LENGTH = 12;
const MAX_BYTES = 72;

// The passwords people reach for first, and the ones this app's own examples
// have used. Compared after lower-casing and dropping spaces.
const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'p@ssw0rd', 'p@ssword',
  '12345678', '123456789', '1234567890', '11111111', '00000000', '87654321', 'qwertyui', 'qwerty123', 'qwertyuiop',
  'abcd1234', 'abc12345', 'iloveyou', 'letmein1', 'welcome1', 'welcome123', 'changeme', 'changeme1', 'changeme123',
  'admin123', 'admin1234', 'administrator', 'secret123', 'secret1234', 'aconsu', 'aconsu123', 'aconsu2026', 'aconsu1234',
  'knust123', 'knustknust', 'ghana123', 'jesus123', 'godisgood', 'blessed1', 'blessing1', 'hallelujah'
]);

const compact = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');

// An ascending or descending run of digits or letters: 12345678, abcdefgh.
function isRun(s) {
  if (s.length < 6) return false;
  let up = true; let down = true;
  for (let i = 1; i < s.length; i += 1) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1);
    if (d !== 1) up = false;
    if (d !== -1) down = false;
  }
  return up || down;
}

// Returns '' when the password is acceptable, else what to tell the person.
// `username` and `current` are optional: a password that is the person's own
// username, or the one they already have, is no change at all.
function passwordProblem(candidate, { username, current, minLength = MIN_LENGTH } = {}) {
  if (typeof candidate !== 'string') return 'Choose a new password.';
  if (candidate.length < minLength) return `Use at least ${minLength} characters.`;
  if (Buffer.byteLength(candidate, 'utf8') > MAX_BYTES) return `Use ${MAX_BYTES} characters or fewer.`;
  if (candidate.trim() !== candidate) return 'Take the spaces off the start and end of the password.';
  const flat = compact(candidate);
  if (/^(.)\1+$/.test(flat)) return 'A password made of one repeated character is too easy to guess.';
  if (isRun(flat)) return 'A run like 12345678 or abcdefgh is too easy to guess.';
  if (COMMON.has(flat)) return 'That password is one of the first that anyone would try. Choose something less common.';
  const name = compact(username);
  if (name.length >= 3 && flat.includes(name)) return 'Do not use your username inside your password.';
  if (typeof current === 'string' && current && candidate === current) return 'Your new password has to be different from your current one.';
  return '';
}

module.exports = { MIN_LENGTH, LEADER_MIN_LENGTH, MAX_BYTES, passwordProblem };
