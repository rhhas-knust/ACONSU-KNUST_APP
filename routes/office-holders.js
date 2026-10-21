// Who holds each key office, and passing an office on.
//
// An executive is elected for one academic year. When it ends the account stops
// working (see currentStaff in server.js), so the office needs one of two things
// from the Chapter Coordinator: RENEW the same person, or HAND OVER to the next.
// Handing over does not edit the old account into a new person. It ends the
// outgoing account, opens a new one for the successor (who must be a member of
// this chapter first), and moves the office's roster card across, so:
//   - the outgoing person's login stops at once, session included;
//   - the successor gets a login of their own, and the same drafts, threads and
//     open requests the office already had (those belong to the office);
//   - the old account stays, pointing at its successor, as the record.
//
// The Alumni President also has a desk here: the chapter's alumni, showing only
// what each alumnus has chosen to share.

const DAY = 86400000;
const ENDING_SOON_DAYS = 60;

function registerOfficeHolderRoutes(app, deps) {
  const {
    repo, models, rolesLib, positions, requireRole, requireCapability, actorName, bcrypt,
    academicYearEndsAt, currentAcademicYearLabel, revokeStaffSessions, logMilestone,
    officeAppointmentProblem
  } = deps;
  const CAP = positions.CAPABILITIES;

  const chapterOf = (req) => {
    const scope = rolesLib.getActingScope(req);
    return scope.chapterId && scope.chapterId !== '__none__' ? scope.chapterId : '';
  };

  const asCoordinator = (handler) => [requireRole('coordinator'), async (req, res) => {
    try {
      const chapterId = chapterOf(req);
      if (!chapterId) return res.status(400).json({ error: 'Choose a chapter first.' });
      return await handler(req, res, { chapterId, who: actorName(req) || 'Chapter Coordinator' });
    } catch (e) {
      res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
    }
  }];

  function seatStatus(account) {
    if (!account) return 'vacant';
    if (account.active === false) return 'ended';
    if (account.termEndsAt) {
      const left = new Date(account.termEndsAt).getTime() - Date.now();
      if (left <= 0) return 'ended';
      if (left <= ENDING_SOON_DAYS * DAY) return 'ending';
    }
    return 'current';
  }

  // ------------------------------------------------------------ key offices --
  app.get('/api/coordinator/offices', ...asCoordinator(async (req, res, { chapterId }) => {
    const [cards, accounts] = await Promise.all([
      repo.getAll('executives', { chapterId }),
      repo.getAll('staffUsers', { chapterId, role: 'executive' })
    ]);
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    const rank = { current: 0, ending: 1, ended: 2, vacant: 3 };

    const cardsFor = (key) => cards.filter((c) => positions.resolvePosition(c.positionKey, c.role, !!c.department).key === key);
    const offices = [];
    positions.POSITIONS.forEach((position) => {
      const mine = cardsFor(position.key);
      if (position.kind !== 'officer' && !mine.length) return; // a department with no head is not a gap in the executive
      const rows = mine.length ? mine : [null];
      rows.forEach((card) => {
        const account = card && card.staffId ? accountById.get(card.staffId) : null;
        const status = seatStatus(account);
        // Those who held this seat before, newest first.
        const before = accounts
          .filter((a) => a.positionKey === position.key && (!account || a.id !== account.id) && (!card || !card.department || true))
          .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
          .slice(0, 5)
          .map((a) => ({ name: a.name, termYear: a.termYear || '', endedAt: a.endedAt || a.termEndsAt || null }));
        offices.push({
          key: position.key, label: position.label, kind: position.kind,
          requiresDepartment: positions.requiresDepartment(position),
          mustBeAlumnus: positions.requiresAlumnus(position),
          status,
          department: card ? card.department || '' : '',
          cardId: card ? card.id : '',
          holder: account ? {
            staffId: account.id, name: account.name, username: account.username, memberId: account.memberId || '',
            termYear: account.termYear || '', termEndsAt: account.termEndsAt || null,
            daysLeft: account.termEndsAt ? Math.ceil((new Date(account.termEndsAt).getTime() - Date.now()) / DAY) : null,
            active: account.active !== false
          } : (card ? { staffId: '', name: card.name || '', username: '', memberId: '', termYear: '', termEndsAt: null, daysLeft: null, active: false } : null),
          before
        });
      });
    });
    offices.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'officer' ? -1 : 1)
      || (positions.positionByKey(a.key).order - positions.positionByKey(b.key).order)
      || (rank[a.status] - rank[b.status]));
    const needsAttention = offices.filter((o) => o.status !== 'current' && (o.kind === 'officer' || o.status !== 'vacant')).length;
    res.json({ items: offices, needsAttention, academicYear: currentAcademicYearLabel() });
  }));

  // ----------------------------------------------------------- hand-over --
  app.post('/api/coordinator/offices/handover', ...asCoordinator(async (req, res, { chapterId, who }) => {
    const body = req.body || {};
    const position = positions.positionByKey(body.positionKey);
    if (!position) return res.status(400).json({ error: 'Choose the office being handed over.' });

    const memberId = String(body.memberId || '').trim();
    if (!memberId) return res.status(400).json({ error: 'Choose the member taking over. Everyone who holds an office is a member of the chapter first.' });
    const member = await repo.getById('members', memberId, { chapterId });
    if (!member) return res.status(400).json({ error: 'That member is not in this chapter.' });

    const username = String(body.username || '').toLowerCase().trim();
    const password = String(body.password || '');
    if (!username || !password) return res.status(400).json({ error: 'Give the new office holder a username and a password to start with.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (await models.StaffUser.findOne({ username })) return res.status(400).json({ error: 'That username is already taken' });

    // The outgoing holder, if there is one: the roster card for this office.
    const cards = await repo.getAll('executives', { chapterId });
    const wantedCard = body.cardId ? cards.find((c) => c.id === body.cardId) : null;
    const card = wantedCard || cards.find((c) => positions.resolvePosition(c.positionKey, c.role, !!c.department).key === position.key) || null;
    if (card && positions.resolvePosition(card.positionKey, card.role, !!card.department).key !== position.key) {
      return res.status(400).json({ error: 'That roster card does not belong to this office.' });
    }
    const outgoing = card && card.staffId ? await repo.getById('staffUsers', card.staffId, { chapterId }) : null;
    if (outgoing && outgoing.memberId === member.id) {
      return res.status(400).json({ error: `${member.name || 'That member'} already holds this office. Use Renew to keep them for another year.` });
    }

    // The department comes with the office. A vacant department head's office has
    // no card to take it from, so then it must be named.
    let department = '';
    if (positions.requiresDepartment(position)) {
      department = String(body.department || (card && card.department) || '').trim();
      if (!department) return res.status(400).json({ error: `A ${position.label} runs a department, choose which one.` });
      if (!await repo.getById('departments', department, { chapterId })) {
        return res.status(400).json({ error: 'That department is not in this chapter, pick one from the list.' });
      }
    }

    // One person, one seat. Someone who already holds a different office has to
    // leave it before taking this one.
    const theirAccounts = await repo.getAll('staffUsers', { chapterId, memberId: member.id, role: 'executive' });
    const alreadySeated = theirAccounts.find((a) => (!outgoing || a.id !== outgoing.id) && seatStatus(a) !== 'ended');
    if (alreadySeated) {
      return res.status(409).json({ error: `${member.name || 'That member'} already holds another office. Hand that one over first.` });
    }
    // The alumnus rule (and, for the successor, that the seat is not already held
    // by somebody else). The outgoing holder is the one being replaced.
    const problem = await officeAppointmentProblem(chapterId, position, member, outgoing && outgoing.id);
    if (problem) return res.status(409).json({ error: problem });

    // 1. The successor's own login.
    const account = await repo.create('staffUsers', {
      username, name: member.name || username, role: 'executive', chapterId, memberId: member.id,
      positionKey: position.key, passwordHash: await bcrypt.hash(password, 10), active: true,
      termYear: currentAcademicYearLabel(), termEndsAt: academicYearEndsAt(),
      handedOverFrom: outgoing ? outgoing.id : ''
    }, 'staff');

    // 2. The office's roster card moves to them. The card keeps its id, so
    // everything keyed to the office (this year's announcement answers, the
    // card on the public roster) stays with the office.
    const cardFields = {
      chapterId, staffId: account.id, name: member.name || '', role: position.label, positionKey: position.key,
      department, order: position.order, bio: '',
      contact: { phone: member.phone || '', email: member.email || '' },
      imageFileId: member.profileImageFileId || '', history: []
    };
    const item = card
      ? await repo.patchById('executives', card.id, cardFields, { chapterId })
      : await repo.create('executives', cardFields, 'exec');

    // 3. The outgoing account ends, and with it the session they may be using.
    if (outgoing) {
      await repo.patchById('staffUsers', outgoing.id, {
        termEndsAt: new Date(), endedAt: new Date(), handedOverTo: account.id,
        positionKey: outgoing.positionKey || position.key
      }, { chapterId });
      await revokeStaffSessions(outgoing.id);
      if (outgoing.memberId) {
        const stillSeated = (await repo.getAll('staffUsers', { chapterId, memberId: outgoing.memberId, role: 'executive' }))
          .some((a) => a.id !== outgoing.id && seatStatus(a) !== 'ended');
        if (!stillSeated) {
          await repo.patchById('members', outgoing.memberId,
            { isExecutive: false, executiveStatus: 'none', executiveRole: '', executiveDepartment: '' }, { chapterId });
        }
      }
    }

    // 4. The new holder is recorded on their member profile, and the appointment
    // is the milestone.
    await repo.patchById('members', member.id, {
      isExecutive: true, executiveStatus: 'verified', executiveRole: position.label,
      executiveDepartment: department, executiveVerifiedAt: new Date()
    }, { chapterId });
    await logMilestone({
      chapterId, memberId: member.id, memberName: member.name || '',
      type: 'executive_appointment', note: position.label, loggedBy: who
    });

    const { passwordHash, ...safe } = account;
    res.json({ success: true, item: safe, card: item, handedOverFrom: outgoing ? outgoing.name : '' });
  }));

  // --------------------------------------------------------- alumni desk --
  // The chapter's alumni, for the Alumni President. A member the chapter has
  // marked as an alumnus is listed by name. Everything beyond that appears only
  // if they chose to list themselves in Alumni Connect, and their email or phone
  // only if they ticked that too: the Alumni President sees what any other
  // alumnus would, not what the member record happens to hold.
  app.get('/api/executive/alumni', requireRole('executive'), requireCapability(CAP.ALUMNI_BODY, async (req, res, { staff }) => {
    const members = await repo.getAll('members', { chapterId: staff.chapterId, membershipStage: 'alumni' });
    const profiles = await repo.getAll('alumniProfiles', { chapterId: staff.chapterId, listed: true });
    const byMember = new Map(profiles.map((p) => [p.memberId, p]));
    const items = members.map((m) => {
      const p = byMember.get(m.id);
      return {
        id: m.id, name: m.name || 'Alumnus',
        graduationYear: (p && p.graduationYear) || m.graduationYear || '',
        listed: !!p,
        programme: p ? (p.programme || m.programme || '') : '',
        profession: p ? p.profession : '', organisation: p ? p.organisation : '',
        industry: p ? p.industry : '', city: p ? p.city : '', country: p ? p.country : '',
        openToMentoring: !!(p && p.openToMentoring),
        email: p && p.showEmail ? (m.email || '') : '',
        phone: p && p.showPhone ? (m.phone || '') : ''
      };
    }).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    res.json({
      count: items.length,
      listed: items.filter((i) => i.listed).length,
      mentors: items.filter((i) => i.openToMentoring).length,
      items
    });
  }));
}

module.exports = { registerOfficeHolderRoutes };
