// The Global Settings were ACONSU-KNUST's.
//
// Before there was more than one chapter the app was ACONSU-KNUST's, and what
// the admin dashboard's Global Settings page holds (the names, contacts, social
// links, verse, home banner and office email addresses) was set for it. Every
// other chapter then showed those wherever its own were blank: KNUST's phone
// number, KNUST's office emails, KNUST's banner.
//
// This moves them where they belong, once: into the ACONSU-KNUST chapter, only
// where the chapter has not set its own, and then puts Global back to the
// union's plain defaults for the national app. What Global held is kept on the
// settings record (movedToChapter.previous), so nothing is lost. It runs once
// per database: afterwards the marker is there, and Global is the national
// app's to fill. The wider church and the national council are the whole
// union's, not KNUST's, and are left as they are.

const UNION_NAME = "The Apostles' Continuation Students Union";

// Global, as a new national app starts.
const GLOBAL_DEFAULTS = {
  fellowshipName: 'ACONSU', fullName: UNION_NAME, tagline: '', verseOfTheWeek: '', address: '',
  email: '', phone: '', whatsapp: '', instagram: '', facebook: '', youtube: '', twitter: '',
  tiktok: '', telegram: '', spotify: '', homeHeaderImageFileId: '', nextServiceLabel: '',
  shepherdingEmail: '', financeEmail: '', publicityEmail: ''
};

// Values the app shipped with, which were never anybody's own choice.
const PLACEHOLDERS = {
  fellowshipName: ['ACONSU'],
  fullName: [UNION_NAME],
  address: ['Campus Fellowship Auditorium'],
  nextServiceLabel: ['Next Sunday Service']
};

// Where each Global setting goes on the chapter. A path of two parts is a field
// inside one of the chapter's groups (contact, office emails, payment, about).
const INTO_CHAPTER = {
  fullName: 'fullName', tagline: 'tagline', verseOfTheWeek: 'verseOfTheWeek', address: 'address',
  homeHeaderImageFileId: 'homeHeaderImageFileId',
  email: 'contact.email', phone: 'contact.phone', whatsapp: 'contact.whatsapp',
  instagram: 'contact.instagram', facebook: 'contact.facebook', youtube: 'contact.youtube',
  twitter: 'contact.twitter', tiktok: 'contact.tiktok', telegram: 'contact.telegram', spotify: 'contact.spotify',
  shepherdingEmail: 'officeEmails.shepherding', financeEmail: 'officeEmails.finance',
  publicityEmail: 'officeEmails.publicity', welfareEmail: 'officeEmails.welfare',
  // Older records kept these on Global too.
  provider: 'payment.provider', momoNumber: 'payment.momoNumber', momoName: 'payment.momoName',
  bankName: 'payment.bankName', bankAccountName: 'payment.bankAccountName',
  bankAccountNumber: 'payment.bankAccountNumber', donationDestination: 'payment.donationDestination',
  welfareDestination: 'payment.welfareDestination'
};
const ABOUT_KEYS = ['history', 'vision', 'mission', 'values', 'leadership', 'firstVisit'];

const blank = (v) => v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
const isPlaceholder = (key, v) => (PLACEHOLDERS[key] || []).includes(String(v).trim());

// Returns what happened, for the start-up log: { moved: [keys], chapterId } or
// { skipped: reason }.
async function moveGlobalSetupToChapter({ repo, chapterId }) {
  const settings = await repo.getSettings();
  if (settings.movedToChapter) return { skipped: 'already moved' };
  const chapter = await repo.getById('chapters', chapterId);
  if (!chapter) return { skipped: 'no such chapter yet' }; // tried again on the next start

  const patch = {};
  const groups = {};
  const moved = [];
  const group = (name) => { if (!groups[name]) groups[name] = { ...(chapter[name] || {}) }; return groups[name]; };
  for (const [key, to] of Object.entries(INTO_CHAPTER)) {
    const value = settings[key];
    if (blank(value) || isPlaceholder(key, value)) continue;
    const [first, second] = to.split('.');
    if (second) {
      const g = group(first);
      if (!blank(g[second])) continue;
      g[second] = typeof value === 'string' ? value.trim() : value;
    } else {
      if (!blank(chapter[first])) continue;
      patch[first] = typeof value === 'string' ? value.trim() : value;
    }
    moved.push(key);
  }
  if (Array.isArray(settings.serviceTimes) && settings.serviceTimes.length && blank(chapter.serviceTimes)) {
    patch.serviceTimes = settings.serviceTimes;
    moved.push('serviceTimes');
  }
  const about = settings.about || {};
  for (const k of ABOUT_KEYS) {
    if (blank(about[k]) || !blank((chapter.about || {})[k])) continue;
    group('about')[k] = about[k];
    moved.push(`about.${k}`);
  }
  Object.assign(patch, groups);
  if (Object.keys(patch).length) await repo.patchById('chapters', chapter.id, patch);

  // Global goes back to the defaults; what it held is kept beside them.
  const previous = {};
  for (const key of new Set([...Object.keys(GLOBAL_DEFAULTS), ...Object.keys(INTO_CHAPTER), 'serviceTimes', 'about'])) {
    if (!blank(settings[key])) previous[key] = settings[key];
  }
  await repo.setSettings({
    ...GLOBAL_DEFAULTS,
    movedToChapter: { chapterId: chapter.id, chapterName: chapter.name, at: new Date().toISOString(), moved, previous }
  });
  return { moved, chapterId: chapter.id };
}

module.exports = { moveGlobalSetupToChapter, GLOBAL_DEFAULTS, UNION_NAME };
