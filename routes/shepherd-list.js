// Shepherding's own list, and Sunday check-in at the door.
//
// A chapter can run Shepherding before anyone has an account: the list the
// team already keeps comes in from a CSV file (lib/peopleImport.js), and each
// Sunday whoever is at the door checks people in from it, one tap each, on as
// many phones as they have (lib/attendance.js keeps those from overwriting
// each other). People with accounts are checked in the same way, by name or by
// the QR code on their membership card.
//
// Everything is confined to the caller's own chapter: the people looked up,
// the list compared against, and the register written to.
const multer = require('multer');
const peopleImport = require('../lib/peopleImport');
const attendance = require('../lib/attendance');
const listLink = require('../lib/listLink');
const { rejectOperatorKeys } = require('../lib/requestGuard');

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// A few rows of what a list looks like, for a team starting from nothing.
const TEMPLATE = [
  'Full name,Phone,Email,Level,Programme,Hall / hostel,Department,Birthday,Emergency contact,Notes',
  'Ama Owusu,0244123456,ama@example.com,200,BSc Nursing,Unity Hall,Music,14/03,0201234567 (mother),',
  'Kwame Mensah,0551234567,,300,BSc Computer Science,Hall 7,Ushering,02/11,,Joined in first year'
].join('\r\n') + '\r\n';

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: peopleImport.MAX_BYTES + 1, files: 1 }
});

function registerShepherdListRoutes(app, deps) {
  const { repo, models, rolesLib, requireShepherd, requireAttendanceTaker, actorName } = deps;

  // The one chapter this request may touch, or null when it has none.
  const chapterOf = (req) => {
    const scope = rolesLib.chapterFilter(req);
    return scope.chapterId && scope.chapterId !== '__no_access__' ? scope.chapterId : null;
  };

  // multer's own size refusal, said in words.
  const takeFile = (req, res, next) => csvUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'That file is larger than 1 MB. A list of names saved as CSV is far smaller, so check it is the right file.' });
    return res.status(400).json({ error: 'Could not read that upload. Choose the file again.' });
  });

  // Everyone Shepherding already knows in this chapter, in the shape the
  // import compares against.
  async function knownPeople(chapterId) {
    const [members, records] = await Promise.all([
      repo.getAll('members', { chapterId }),
      repo.getAll('shepherdingRecords', { chapterId, memberId: '' })
    ]);
    return [
      ...members.map(m => ({ kind: 'member', id: m.id, name: m.name, phone: m.phone, email: m.email })),
      ...records.map(r => ({ kind: 'record', ...r }))
    ];
  }

  const view = (p) => ({
    row: p.row, name: p.name, action: p.action, reason: p.reason || '', matchName: p.matchName || '',
    phone: p.person.phone, level: p.person.level, programme: p.person.programme, address: p.person.address,
    fills: p.changes ? Object.keys(p.changes).filter(k => k !== 'birthdayDay') : [],
    warnings: p.warnings
  });

  // ---------- bringing the list in ----------
  // One route, three steps (see lib/peopleImport.js): 'read' opens the file
  // and guesses its columns, 'check' says what would happen, 'import' does it.
  // The browser keeps the file and sends it again with each step, so nothing
  // half-read is ever left waiting on the server.
  app.post('/api/shepherd/import', requireShepherd, takeFile, rejectOperatorKeys, async (req, res) => {
    try {
      const chapterId = chapterOf(req);
      if (!chapterId) return res.status(403).json({ error: 'Open the chapter whose list this is first.' });
      if (!req.file) return res.status(400).json({ error: 'Choose the CSV file with your list.' });
      const step = ['read', 'check', 'import'].includes(req.body.step) ? req.body.step : 'read';
      const file = peopleImport.readFile(req.file.buffer, { hasHeader: req.body.hasHeader !== '0' });
      if (file.error) return res.status(400).json({ error: file.error });
      if (!file.rows.length) return res.status(400).json({ error: 'There is nobody in that file, only the headings.' });

      if (step === 'read') {
        const mapping = peopleImport.guessMapping(file.headers);
        return res.json({
          fields: peopleImport.FIELDS,
          rowCount: file.rows.length,
          columns: file.headers.map((heading, i) => ({
            index: i,
            heading,
            field: mapping[i],
            samples: file.rows.map(r => r.cells[i]).filter(Boolean).slice(0, 3)
          }))
        });
      }

      const mapping = peopleImport.cleanMapping(req.body.mapping, file.headers.length) || peopleImport.guessMapping(file.headers);
      if (!mapping.includes('name') && !mapping.includes('firstName') && !mapping.includes('lastName')) {
        return res.status(400).json({ error: 'Choose which column holds the names.' });
      }
      const [existing, departments] = await Promise.all([
        knownPeople(chapterId),
        repo.getAll('departments', { chapterId })
      ]);
      const { plan, counts } = peopleImport.planImport(file, mapping, { existing, departments });
      const summary = {
        rowCount: file.rows.length,
        counts,
        adding: plan.filter(p => p.action === 'add').slice(0, 8).map(view),
        notAdding: plan.filter(p => p.action !== 'add').slice(0, 500).map(view),
        warnings: plan.filter(p => p.warnings.length).slice(0, 200).map(view)
      };
      if (step === 'check') return res.json(summary);

      // Ids are numbered within the batch: hundreds of people are made in the
      // same millisecond, and a random suffix alone would sooner or later repeat.
      const batch = repo.genId('shep');
      let added = 0;
      let filled = 0;
      for (const [i, p] of plan.entries()) {
        if (p.action === 'add') {
          await repo.create('shepherdingRecords', {
            ...p.person, id: `${batch}_${i}`, chapterId, memberId: '',
            origin: 'import', attendanceStatus: 'regular', lastContactDate: ''
          });
          added++;
        } else if (p.action === 'fill') {
          await repo.patchById('shepherdingRecords', p.matchId, p.changes, { chapterId, memberId: '' });
          filled++;
        }
      }
      res.json({ ...summary, done: { added, filled } });
    } catch (e) {
      res.status(500).json({ error: 'Could not bring in that list' });
    }
  });

  app.get('/api/shepherd/import/template.csv', requireShepherd, (req, res) => {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="aconsu-shepherding-list.csv"');
    res.send(TEMPLATE);
  });

  // ---------- one person: the list and their account ----------
  // Linking happens on its own at registration when it is certain (see
  // lib/listLink.js); these are Shepherding's hands for the rest, and for
  // undoing a link that was wrong.
  app.post('/api/shepherd/records/:id/link', requireShepherd, async (req, res) => {
    try {
      const chapterId = chapterOf(req);
      const record = chapterId ? await repo.getById('shepherdingRecords', req.params.id, { chapterId, memberId: '' }) : null;
      if (!record) return res.status(404).json({ error: 'That person is not on this chapter\'s list, or is already linked to an account.' });
      const member = req.body.memberId ? await repo.getById('members', String(req.body.memberId), { chapterId }) : null;
      if (!member) return res.status(404).json({ error: 'Choose an app account in this chapter.' });
      const taken = (await repo.getAll('shepherdingRecords', { chapterId, memberId: member.id })).find(r => r.linkedAt);
      if (taken) return res.status(409).json({ error: `${member.name}'s account is already linked to someone on the list. If that was wrong, unlink it first.` });
      res.json({ success: true, ...(await listLink.link({ record, member, how: 'hand', by: actorName(req) })) });
    } catch (e) { res.status(500).json({ error: 'Could not link them' }); }
  });

  app.post('/api/shepherd/records/:id/unlink', requireShepherd, async (req, res) => {
    try {
      const chapterId = chapterOf(req);
      const record = chapterId ? await repo.getById('shepherdingRecords', req.params.id, { chapterId }) : null;
      if (!record || !record.memberId || !record.linkedAt) return res.status(404).json({ error: 'That account is not linked to anyone on the list.' });
      if (record.mergedFromList) return res.status(409).json({ error: 'This link was folded into care notes the account already had, so it cannot be undone. Correct the notes by hand instead.' });
      res.json({ success: true, ...(await listLink.unlink({ record })) });
    } catch (e) { res.status(500).json({ error: 'Could not unlink them' }); }
  });

  // ---------- Sunday check-in ----------
  const dayOf = (raw) => (DATE.test(String(raw || '')) ? String(raw) : new Date().toISOString().slice(0, 10));
  const serviceOf = (raw) => (attendance.SERVICE_TYPES.includes(raw) ? raw : 'sunday');

  // The person a check-in is for, found only inside this chapter: an id from
  // another chapter answers "not found" rather than ever reaching its register.
  async function findPerson(chapterId, body) {
    if (body.memberId) {
      const m = await repo.getById('members', String(body.memberId), { chapterId });
      return m ? { memberId: m.id, recordId: '', name: m.name, member: m } : null;
    }
    if (body.recordId) {
      const r = await repo.getById('shepherdingRecords', String(body.recordId), { chapterId, memberId: '' });
      return r ? { memberId: '', recordId: r.id, name: r.name } : null;
    }
    return null;
  }

  const presentCount = (record) => (record ? record.marks.filter(m => m.status === 'present').length : 0);

  // What every check-in answers with: who, and how many are in so far.
  async function checkIn(req, person, present) {
    const chapterId = chapterOf(req);
    const result = await attendance.setMark({
      scope: { chapterId }, chapterId,
      date: dayOf(req.body.date), serviceType: serviceOf(req.body.serviceType),
      person, present, recordedBy: actorName(req)
    });
    return {
      success: true,
      alreadyMarked: !result.changed,
      member: { id: person.memberId || person.recordId, name: person.name, profileImageFileId: person.member ? person.member.profileImageFileId : '', membershipStage: person.member ? person.member.membershipStage : '' },
      person: { memberId: person.memberId, recordId: person.recordId, name: person.name },
      present: presentCount(result.record)
    };
  }

  const failed = (res, e, what) => res.status(e.status || 500).json({ error: e.status ? e.message : what });

  // The QR code on a member's card (section 13). It carries a token, never
  // their id, and is looked up within this chapter only.
  app.post('/api/attendance/scan', requireAttendanceTaker, async (req, res) => {
    try {
      const chapterId = chapterOf(req);
      const { qrToken } = req.body;
      if (!qrToken) return res.status(400).json({ error: 'A QR code is required' });
      const member = chapterId ? await models.Member.findOne({ qrToken: String(qrToken), chapterId }).lean() : null;
      if (!member) return res.status(404).json({ error: 'That code does not match anyone in this chapter.' });
      res.json(await checkIn(req, { memberId: member.id, recordId: '', name: member.name, member }, true));
    } catch (e) { failed(res, e, 'Could not record attendance'); }
  });

  // By name: an account holder (memberId) or someone on the list (recordId).
  app.post('/api/attendance/mark', requireAttendanceTaker, async (req, res) => {
    try {
      const chapterId = chapterOf(req);
      if (!req.body.memberId && !req.body.recordId) return res.status(400).json({ error: 'Choose who to check in' });
      const person = chapterId ? await findPerson(chapterId, req.body) : null;
      if (!person) return res.status(404).json({ error: 'Not found in this chapter.' });
      res.json(await checkIn(req, person, true));
    } catch (e) { failed(res, e, 'Could not record attendance'); }
  });

  // A tap on the wrong name, taken back.
  app.post('/api/attendance/unmark', requireAttendanceTaker, async (req, res) => {
    try {
      const chapterId = chapterOf(req);
      if (!req.body.memberId && !req.body.recordId) return res.status(400).json({ error: 'Choose whose check-in to take back' });
      const person = chapterId ? await findPerson(chapterId, req.body) : null;
      if (!person) return res.status(404).json({ error: 'Not found in this chapter.' });
      res.json(await checkIn(req, person, false));
    } catch (e) { failed(res, e, 'Could not take that check-in back'); }
  });

  // Someone at the door who is not on the list yet: they are added to it (as
  // new, for Shepherding to follow up) and checked in, in one go. A phone
  // number already on the list is that person, checked in instead of added.
  app.post('/api/attendance/newcomer', requireAttendanceTaker, async (req, res) => {
    try {
      const chapterId = chapterOf(req);
      if (!chapterId) return res.status(403).json({ error: 'Open your chapter first.' });
      const name = peopleImport.tidyName(req.body.name);
      if (name.length < 2) return res.status(400).json({ error: 'Type their name.' });
      const phone = peopleImport.tidyPhone(req.body.phone).value;
      const key = peopleImport.phoneKey(phone);
      if (key) {
        const [members, records] = await Promise.all([
          repo.getAll('members', { chapterId }),
          repo.getAll('shepherdingRecords', { chapterId, memberId: '' })
        ]);
        const same = (p) => peopleImport.phoneKey(p.phone) === key && peopleImport.namesAgree(name, p.name);
        const member = members.find(same);
        const record = !member && records.find(same);
        if (member || record) {
          const person = member
            ? { memberId: member.id, recordId: '', name: member.name, member }
            : { memberId: '', recordId: record.id, name: record.name };
          return res.json({ ...(await checkIn(req, person, true)), wasOnList: true });
        }
      }
      const record = await repo.create('shepherdingRecords', {
        chapterId, memberId: '', name, phone, origin: 'checkin', attendanceStatus: 'new',
        pastoralNotes: `First checked in on ${dayOf(req.body.date)}.`
      }, 'shep');
      res.json({ ...(await checkIn(req, { memberId: '', recordId: record.id, name: record.name }, true)), wasOnList: false });
    } catch (e) { failed(res, e, 'Could not add them'); }
  });

  // Who is in so far: what every phone at the door shows, refreshed as it goes.
  app.get('/api/attendance/checkins', requireAttendanceTaker, async (req, res) => {
    try {
      const chapterId = chapterOf(req);
      const date = dayOf(req.query.date);
      const serviceType = serviceOf(req.query.serviceType);
      const record = chapterId ? (await repo.getAll('attendanceRecords', { chapterId, date, serviceType }))[0] : null;
      const present = record ? record.marks.filter(m => m.status === 'present') : [];
      res.json({
        date, serviceType,
        count: present.length,
        visitorCount: record ? record.visitorCount || 0 : 0,
        present: present
          .map(m => ({ memberId: m.memberId, recordId: m.recordId, name: m.name, at: m.at || null }))
          .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
      });
    } catch (e) { res.status(500).json({ error: 'Could not load who is in' }); }
  });
}

module.exports = { registerShepherdListRoutes };
