// Scheduling, milestones, welfare and giving are grouped here because they
// share the same member/staff chapter boundary.
function registerMemberServiceRoutes(app, deps) {
  const { repo, rolesLib, requireMember, requireContentManager, requireShepherd, requireViewRole,
    requireFinance, isChapterAdminOrAbove, hasRole, actorName, createNotification, notifyAdminByEmail,
    resolveViewerChapterId } = deps;
  const VOLUNTEER_ROLES = ['usher', 'prayer_team', 'media', 'musician', 'protocol', 'publicity', 'transport', 'other'];
  const MILESTONE_TYPES = ['graduation', 'executive_appointment', 'membership_anniversary', 'other'];
  const MILESTONE_LABELS = { graduation: 'graduated! 🎓', executive_appointment: 'was appointed to a new executive position! 🎉', membership_anniversary: 'is celebrating a membership milestone! 🎉', other: 'has something to celebrate! 🎉' };
  const WELFARE_CATEGORIES = ['financial', 'medical', 'bereavement', 'academic', 'other'];
  const WELFARE_STATUSES = ['submitted', 'under_review', 'approved', 'declined', 'fulfilled'];
  const requireWelfareAccess = (req, res, next) => (isChapterAdminOrAbove(req) || hasRole(req, 'welfare'))
    ? next() : res.status(401).json({ error: 'Not authenticated' });
  const logMilestone = async ({ chapterId, memberId, memberName, type, note, loggedBy }) => {
    const milestone = await repo.create('milestones', { chapterId, memberId, memberName, type: MILESTONE_TYPES.includes(type) ? type : 'other', note: note || '', loggedBy: loggedBy || '' }, 'mstone');
    createNotification(`Congratulations, ${memberName}!`, `${memberName} ${MILESTONE_LABELS[milestone.type]}${note ? ' — ' + note : ''}`, '/index.html', 'system', chapterId).catch(() => {});
    return milestone;
  };

  app.get('/api/events/:id/volunteers', requireMember, async (req, res) => {
    try {
      const event = await repo.getById('events', req.params.id);
      const chapterId = await resolveViewerChapterId(req);
      if (!event || !chapterId || event.chapterId !== chapterId) return res.status(404).json({ error: 'Event not found' });
      res.json(await repo.getAll('volunteerAssignments', { eventId: event.id, chapterId }));
    } catch (e) { res.status(500).json({ error: 'Could not load volunteer assignments' }); }
  });
  app.post('/api/events/:id/volunteers', requireContentManager, async (req, res) => {
    try {
      const filter = rolesLib.chapterFilter(req, { required: false });
      const event = await repo.getById('events', req.params.id, filter);
      if (!event) return res.status(404).json({ error: 'Event not found' });
      const { role, memberId } = req.body;
      if (!VOLUNTEER_ROLES.includes(role) || !memberId) return res.status(400).json({ error: 'A role and a member are required' });
      const member = await repo.getById('members', memberId, filter);
      if (!member) return res.status(400).json({ error: 'That member is not in this chapter' });
      const assignment = await repo.create('volunteerAssignments', { chapterId: event.chapterId, eventId: event.id, role, memberId, memberName: member.name, status: 'assigned', assignedBy: actorName(req) }, 'vol');
      res.json({ success: true, item: assignment });
    } catch (e) { res.status(500).json({ error: 'Could not create this assignment' }); }
  });
  app.delete('/api/events/:eventId/volunteers/:assignmentId', requireContentManager, async (req, res) => {
    try { await repo.removeById('volunteerAssignments', req.params.assignmentId, { ...rolesLib.chapterFilter(req, { required: false }), eventId: req.params.eventId }); res.json({ success: true }); }
    catch (e) { res.status(500).json({ error: 'Could not remove this assignment' }); }
  });
  app.get('/api/member/volunteer-assignments', requireMember, async (req, res) => {
    try {
      const chapterId = await resolveViewerChapterId(req);
      const items = await repo.getAll('volunteerAssignments', { memberId: req.session.memberId, chapterId });
      const events = await repo.getAll('events', { id: { $in: items.map((i) => i.eventId) }, chapterId });
      res.json(items.map((i) => ({ ...i, event: events.find((e) => e.id === i.eventId) || null })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
    } catch (e) { res.status(500).json({ error: 'Could not load your assignments' }); }
  });
  app.patch('/api/member/volunteer-assignments/:id', requireMember, async (req, res) => {
    try {
      const chapterId = await resolveViewerChapterId(req);
      const existing = await repo.getById('volunteerAssignments', req.params.id, { memberId: req.session.memberId, chapterId });
      if (!existing) return res.status(404).json({ error: 'Not found' });
      const status = req.body.status === 'confirmed' ? 'confirmed' : req.body.status === 'declined' ? 'declined' : null;
      if (!status) return res.status(400).json({ error: 'status must be "confirmed" or "declined"' });
      res.json({ success: true, item: await repo.updateById('volunteerAssignments', req.params.id, { ...existing, status }) });
    } catch (e) { res.status(500).json({ error: 'Could not update this' }); }
  });

  app.get('/api/shepherd/milestones', requireViewRole('shepherding'), async (req, res) => { try { const items = await repo.getAll('milestones', rolesLib.chapterFilter(req)); res.json(items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))); } catch (e) { res.status(500).json({ error: 'Could not load milestones' }); } });
  app.post('/api/shepherd/milestones', requireShepherd, async (req, res) => {
    try { const filter = rolesLib.chapterFilter(req); const { memberId, type, note } = req.body; if (!memberId || !type) return res.status(400).json({ error: 'A member and a type are required' }); const member = await repo.getById('members', memberId, filter); if (!member) return res.status(404).json({ error: 'Member not found in this chapter' }); res.json({ success: true, item: await logMilestone({ chapterId: filter.chapterId, memberId, memberName: member.name, type, note, loggedBy: actorName(req) }) }); } catch (e) { res.status(500).json({ error: 'Could not log this milestone' }); }
  });

  app.post('/api/welfare/requests', requireMember, async (req, res) => {
    try { const member = await repo.getById('members', req.session.memberId); if (!member) return res.status(404).json({ error: 'Account not found' }); const { category, description, amountRequested } = req.body; if (!description) return res.status(400).json({ error: 'Please describe your request' }); const request = await repo.create('welfareRequests', { chapterId: member.chapterId, memberId: member.id, memberName: member.name, category: WELFARE_CATEGORIES.includes(category) ? category : 'other', description, amountRequested: Number(amountRequested) || 0, status: 'submitted' }, 'welf'); res.json({ success: true, item: request }); notifyAdminByEmail('New Welfare Request — ACONSU', '<p>A new welfare request has been submitted. Log in to the Welfare portal to review it.</p>'); } catch (e) { res.status(500).json({ error: 'Could not submit your request' }); }
  });
  app.get('/api/welfare/requests/mine', requireMember, async (req, res) => { try { const items = await repo.getAll('welfareRequests', { memberId: req.session.memberId }); res.json(items.map(({ notes, ...safe }) => safe).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))); } catch (e) { res.status(500).json({ error: 'Could not load your requests' }); } });
  app.post('/api/shepherd/welfare-referrals', requireShepherd, async (req, res) => {
    try { const filter = rolesLib.chapterFilter(req); const { memberId, category, description } = req.body; if (!memberId || !description) return res.status(400).json({ error: 'A member and description are required' }); const member = await repo.getById('members', memberId, filter); if (!member) return res.status(404).json({ error: 'Member not found in this chapter' }); res.json({ success: true, item: await repo.create('welfareRequests', { chapterId: filter.chapterId, memberId: member.id, memberName: member.name, category: WELFARE_CATEGORIES.includes(category) ? category : 'other', description, status: 'submitted', referredBy: actorName(req) }, 'welf') }); } catch (e) { res.status(500).json({ error: 'Could not submit this referral' }); }
  });
  app.get('/api/welfare/requests', requireWelfareAccess, async (req, res) => { try { const items = await repo.getAll('welfareRequests', rolesLib.chapterFilter(req)); res.json(items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))); } catch (e) { res.status(500).json({ error: 'Could not load welfare requests' }); } });
  app.patch('/api/welfare/requests/:id', requireWelfareAccess, async (req, res) => {
    try { const filter = rolesLib.chapterFilter(req); const existing = await repo.getById('welfareRequests', req.params.id, filter); if (!existing) return res.status(404).json({ error: 'Not found' }); const { status, notes } = req.body; res.json({ success: true, item: await repo.updateById('welfareRequests', req.params.id, { ...existing, status: WELFARE_STATUSES.includes(status) ? status : existing.status, notes: notes !== undefined ? notes : existing.notes, handledBy: actorName(req) }, filter) }); } catch (e) { res.status(500).json({ error: 'Could not update this request' }); }
  });

  app.get('/api/giving/chapter-info', requireMember, async (req, res) => { try { const member = await repo.getById('members', req.session.memberId); if (!member || !member.chapterId) return res.json({ configured: false }); const chapter = await repo.getById('chapters', member.chapterId); if (!chapter || !chapter.payment || !(chapter.payment.momoNumber || chapter.payment.bankAccountNumber)) return res.json({ configured: false }); res.json({ configured: true, payment: chapter.payment, chapterName: chapter.name }); } catch (e) { res.status(500).json({ error: 'Could not load giving details' }); } });
  app.post('/api/giving/intents', requireMember, async (req, res) => {
    try { const member = await repo.getById('members', req.session.memberId); if (!member) return res.status(404).json({ error: 'Account not found' }); const { amount, purpose, method, reference } = req.body; if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'A valid amount is required' }); res.json({ success: true, item: await repo.create('givingIntents', { chapterId: member.chapterId, memberId: member.id, memberName: member.name, amount: Number(amount), purpose: ['momo', 'tithe', 'harvest', 'offertory', 'other'].includes(purpose) ? purpose : 'other', method: ['momo', 'bank', 'cash', 'other'].includes(method) ? method : 'momo', reference: reference || '', status: 'pending' }, 'give') }); } catch (e) { res.status(500).json({ error: 'Could not record this' }); }
  });
  app.get('/api/giving/mine', requireMember, async (req, res) => { try { const items = await repo.getAll('givingIntents', { memberId: req.session.memberId }); res.json(items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))); } catch (e) { res.status(500).json({ error: 'Could not load your giving history' }); } });
  app.get('/api/finance/giving-queue', requireViewRole('finance'), async (req, res) => { try { const items = await repo.getAll('givingIntents', { ...rolesLib.chapterFilter(req), status: 'pending' }); res.json(items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))); } catch (e) { res.status(500).json({ error: 'Could not load the giving queue' }); } });
  app.patch('/api/finance/giving/:id/confirm', requireFinance, async (req, res) => {
    try { const filter = rolesLib.chapterFilter(req); const intent = await repo.getById('givingIntents', req.params.id, filter); if (!intent) return res.status(404).json({ error: 'Not found' }); if (intent.status !== 'pending') return res.status(400).json({ error: 'This has already been reviewed.' }); const entry = await repo.create('financeEntries', { chapterId: intent.chapterId, entryType: 'income', category: intent.purpose, amount: intent.amount, date: new Date().toISOString().slice(0, 10), description: `Giving confirmed — ${intent.memberName}`, method: intent.method, reference: intent.reference, payee: intent.memberName, approvalStatus: 'approved', approvedBy: actorName(req), recordedBy: actorName(req) }, 'fin'); const updated = await repo.updateById('givingIntents', req.params.id, { ...intent, status: 'confirmed', matchedFinanceEntryId: entry.id, reviewedBy: actorName(req) }, filter); res.json({ success: true, item: updated, entry }); } catch (e) { res.status(500).json({ error: 'Could not confirm this' }); }
  });
  app.patch('/api/finance/giving/:id/reject', requireFinance, async (req, res) => { try { const filter = rolesLib.chapterFilter(req); const intent = await repo.getById('givingIntents', req.params.id, filter); if (!intent) return res.status(404).json({ error: 'Not found' }); res.json({ success: true, item: await repo.updateById('givingIntents', req.params.id, { ...intent, status: 'rejected', reviewNotes: req.body.notes || '', reviewedBy: actorName(req) }, filter) }); } catch (e) { res.status(500).json({ error: 'Could not reject this' }); } });

  return { logMilestone };
}

module.exports = { registerMemberServiceRoutes };
