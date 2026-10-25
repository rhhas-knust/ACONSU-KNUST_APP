// Someone on Shepherding's own list (brought in from the chapter's
// spreadsheet, added by hand, or new at the door) opens an app account. From
// then on they are one person: the list record becomes the care notes for the
// account, and the Sundays they were checked in at become the account's.
//
// At registration this happens on its own only when it is certain: the same
// phone number or email, names that agree, and exactly one person on the list
// who fits. Anything less is left for Shepherding, who see a suggestion beside
// the person and link them by hand.
//
// Nothing from the list is shown to the person registering, and nothing on
// their account is changed. A phone number is not checked at registration, so
// someone could type another person's; a link made that way gives them nothing
// to see, and Shepherding, who can see how each link was made, can undo it.

const repo = require('./repo');
const { phoneKey, namesAgree } = require('./peopleImport');
const attendance = require('./attendance');

const nameKey = (name) => String(name || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.,]/g, '');

// How a list record and an account match, if they do: 'phone' or 'email'
// (with names that agree), 'name' (exactly the same name, nothing else), or ''.
function matchHow(record, member) {
  if (!namesAgree(record.name, member.name)) return '';
  const pk = phoneKey(record.phone);
  if (pk && pk === phoneKey(member.phone)) return 'phone';
  const email = String(record.email || '').toLowerCase();
  if (email && email === String(member.email || '').toLowerCase()) return 'email';
  if (nameKey(record.name) && nameKey(record.name) === nameKey(member.name)) return 'name';
  return '';
}

// For the people list: beside each person on the list with no account, the one
// account that is probably theirs. A phone or email match beats a name alone,
// and two equally likely accounts suggest neither.
function suggestions(listRecords, members, linkedMemberIds) {
  // Looked up by phone, email and name, rather than every list person against
  // every account, so a chapter of hundreds stays quick.
  const byKey = new Map();
  const index = (key, m) => { if (key) byKey.set(key, [...(byKey.get(key) || []), m]); };
  members.filter(m => !linkedMemberIds.has(m.id)).forEach((m) => {
    index(phoneKey(m.phone) && `p:${phoneKey(m.phone)}`, m);
    index(m.email && `e:${String(m.email).toLowerCase()}`, m);
    index(nameKey(m.name) && `n:${nameKey(m.name)}`, m);
  });
  const out = new Map();
  for (const r of listRecords) {
    const near = new Set([
      ...(phoneKey(r.phone) ? byKey.get(`p:${phoneKey(r.phone)}`) || [] : []),
      ...(r.email ? byKey.get(`e:${String(r.email).toLowerCase()}`) || [] : []),
      ...(nameKey(r.name) ? byKey.get(`n:${nameKey(r.name)}`) || [] : [])
    ]);
    const scored = [...near].map(m => ({ m, how: matchHow(r, m) })).filter(x => x.how);
    const strong = scored.filter(x => x.how !== 'name');
    const pick = strong.length ? strong : scored;
    if (pick.length === 1) out.set(r.id, { memberId: pick[0].m.id, name: pick[0].m.name, how: pick[0].how });
  }
  return out;
}

// Fill what is blank on `into` from `from`; notes are joined, never replaced.
function mergeCare(into, from) {
  const changes = {};
  ['address', 'emergencyContact', 'imageFileId', 'email', 'level', 'programme', 'department'].forEach((f) => {
    if (!into[f] && from[f]) changes[f] = from[f];
  });
  if (!into.birthdayMonth && from.birthdayMonth) { changes.birthdayMonth = from.birthdayMonth; changes.birthdayDay = from.birthdayDay; }
  if ((from.lastContactDate || '') > (into.lastContactDate || '')) changes.lastContactDate = from.lastContactDate;
  if (from.pastoralNotes && !String(into.pastoralNotes || '').includes(from.pastoralNotes)) {
    changes.pastoralNotes = [into.pastoralNotes, from.pastoralNotes].filter(Boolean).join('\n\n').slice(0, 4000);
  }
  return changes;
}

// Make one person of a list record and an account. When the account already
// has care notes of its own (Shepherding wrote some before the two were
// matched), the list record is folded into those and removed; a link made that
// way cannot be undone, and says so.
async function link({ record, member, how, by }) {
  const chapterId = record.chapterId;
  const layer = (await repo.getAll('shepherdingRecords', { chapterId, memberId: member.id }))[0] || null;
  let kept;
  if (layer) {
    kept = await repo.patchById('shepherdingRecords', layer.id, {
      ...mergeCare(layer, record), origin: record.origin, linkedAt: new Date(), linkedHow: how, linkedBy: by || '', mergedFromList: true
    }, { chapterId });
  } else {
    kept = await repo.patchById('shepherdingRecords', record.id, {
      memberId: member.id, linkedAt: new Date(), linkedHow: how, linkedBy: by || ''
    }, { chapterId, memberId: '' });
  }
  const moved = await attendance.moveMarks({ chapterId, recordId: record.id, memberId: member.id });
  if (layer) await repo.removeById('shepherdingRecords', record.id, { chapterId, memberId: '' });
  return { record: kept, movedSundays: moved, merged: !!layer };
}

// A link that was wrong: the list record stands alone again, and the Sundays
// it brought with it go back to it.
async function unlink({ record }) {
  const chapterId = record.chapterId;
  const memberId = record.memberId;
  const kept = await repo.patchById('shepherdingRecords', record.id, {
    memberId: '', linkedAt: null, linkedHow: '', linkedBy: ''
  }, { chapterId });
  const moved = await attendance.moveMarks({ chapterId, recordId: record.id, memberId, back: true });
  return { record: kept, movedSundays: moved };
}

// Registration: link the new account to the one list record that is certainly
// theirs, if there is one. Never throws: an account is opened either way.
async function linkOnRegister(member) {
  try {
    if (!member.chapterId) return null;
    const listed = await repo.getAll('shepherdingRecords', { chapterId: member.chapterId, memberId: '' });
    const sure = listed.map(r => ({ r, how: matchHow(r, member) })).filter(x => x.how === 'phone' || x.how === 'email');
    if (sure.length !== 1) return null;
    return await link({ record: sure[0].r, member, how: sure[0].how, by: 'registration' });
  } catch (e) {
    return null;
  }
}

module.exports = { matchHow, suggestions, link, unlink, linkOnRegister };
