// The sign-in an executive office comes with.
//
// Every executive position in a chapter has its own login, named after the
// office and the chapter: the President of ACONSU-KNUST signs in as
// `president.knust`, the Music Director as `musicdirector.knust`. Its starting
// password is the office's name followed by 123 (`president123`), which the
// person appointed must replace with their own the first time they sign in.
//
// Because that starting password follows a pattern anyone could guess, it is
// treated as a key that opens one door only: the screen where the holder
// chooses their own password (and confirms the email on their member profile).
// It opens nothing else, and it stops working after STARTING_PASSWORD_DAYS.
//
// The chapter is part of the username, so two chapters' Presidents are two
// different logins and neither can ever sign in as the other.

const STARTING_PASSWORD_DAYS = 14;

// 'aconsu-knust' -> 'knust'. Letters and digits only, so it is always a clean
// part of a username.
function chapterSlug(chapterId) {
  const raw = String(chapterId || '').toLowerCase().replace(/^aconsu[-_. ]*/, '');
  return raw.replace(/[^a-z0-9]/g, '') || String(chapterId || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// 'vice_president' -> 'vicepresident'
const positionSlug = (positionKey) => String(positionKey || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const usernameFor = (positionKey, chapterId) => `${positionSlug(positionKey)}.${chapterSlug(chapterId)}`;

const startingPasswordFor = (positionKey) => `${positionSlug(positionKey)}123`;

// Other names to try, in order, when the usual one is taken: the same office in
// a chapter whose short name another chapter already uses, or a second holder
// of a department office for a different department.
function fallbackUsernames(positionKey, chapterId, departmentSlug) {
  const p = positionSlug(positionKey);
  const full = String(chapterId || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const out = [];
  if (departmentSlug) out.push(`${p}-${departmentSlug}.${chapterSlug(chapterId)}`);
  if (full && full !== chapterSlug(chapterId)) out.push(`${p}.${full}`);
  for (let n = 2; n <= 9; n += 1) out.push(`${p}${n}.${chapterSlug(chapterId)}`);
  return out;
}

const startingPasswordExpiry = (from) => new Date((from ? new Date(from) : new Date()).getTime() + STARTING_PASSWORD_DAYS * 86400000);

module.exports = {
  STARTING_PASSWORD_DAYS, chapterSlug, positionSlug, usernameFor, startingPasswordFor, fallbackUsernames, startingPasswordExpiry
};
