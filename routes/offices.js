// The executive offices' own work: the semester outline, budget requests,
// the secretariat's minutes and Sunday announcements, and the Vice President's
// committees and follow-up.
//
// Two rules run through all of it.
//
// 1. A record belongs to the OFFICE, not the person. Everything is keyed by
//    chapter and office (or department), never by the account that typed it, so
//    when an office changes hands the successor opens the same drafts, the same
//    comment thread and the same open budget request.
//
// 2. Every step that moves a record from one state to the next is a single
//    compare-and-set in the database (the state it must be in is part of the
//    filter), so two people pressing the same button at once cannot both win.
//    Rules about WHO may do a step come from lib/positions.js capabilities, the
//    same grant the portal reads to decide which panels to draw.
const fileTypes = require('../lib/fileTypes');
const office = require('../lib/offices');

function registerOfficeRoutes(app, deps) {
  const {
    repo, models, rolesLib, gridfs, upload, positions, requireRole, requireCapability,
    hasRole, currentStaff, resolveOwnPosition, actorName, currentAcademicYearLabel
  } = deps;
  const CAP = positions.CAPABILITIES;

  // ---------------------------------------------------------------- helpers --
  // The chapter a request is acting in. A chapter's own staff are pinned to it;
  // the National Coordinator must have chosen one.
  const chapterOf = (req) => {
    const scope = rolesLib.getActingScope(req);
    return scope.chapterId && scope.chapterId !== '__none__' ? scope.chapterId : '';
  };

  const guarded = (handler) => async (req, res) => {
    try {
      await handler(req, res);
    } catch (e) {
      res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
    }
  };

  const asExecutive = (capability, handler) => [requireRole('executive'), requireCapability(capability, handler)];

  const asCoordinator = (handler) => [requireRole('coordinator'), guarded(async (req, res) => {
    const chapterId = chapterOf(req);
    if (!chapterId) return res.status(400).json({ error: 'Choose a chapter first.' });
    return handler(req, res, { chapterId, who: actorName(req) || 'Chapter Coordinator' });
  })];

  async function departmentMap(chapterId) {
    const list = await repo.getAll('departments', { chapterId });
    return new Map(list.map((d) => [d.id, d]));
  }

  const newest = (a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
  const today = () => new Date().toISOString().slice(0, 10);

  // ========================================================= SEMESTER OUTLINE ==
  // The President writes it (the Alumni President writes the alumni body's own),
  // the Chapter Coordinator approves it, and approval is what shares it with the
  // rest of the executive body.
  const bodyOf = (position) => position.outlineBody || 'chapter';
  const OPEN_OUTLINE = ['draft', 'submitted', 'returned'];

  app.get('/api/executive/outline', ...asExecutive(CAP.OUTLINE_WRITE, async (req, res, { staff, position }) => {
    const items = await repo.getAll('semesterOutlines', { chapterId: staff.chapterId, body: bodyOf(position) });
    const departments = await departmentMap(staff.chapterId);
    res.json({
      items: items.sort(newest),
      body: bodyOf(position),
      kinds: office.PROGRAMME_KINDS,
      departments: [...departments.values()].map((d) => ({ id: d.id, name: d.name })).sort((a, b) => a.name.localeCompare(b.name)),
      academicYear: currentAcademicYearLabel()
    });
  }));

  app.post('/api/executive/outline', ...asExecutive(CAP.OUTLINE_WRITE, async (req, res, { staff, position }) => {
    const body = bodyOf(position);
    const departments = await departmentMap(staff.chapterId);
    const cleaned = office.cleanOutline(req.body, departments);
    if (cleaned.error) return res.status(400).json({ error: cleaned.error });
    // One outline in progress at a time, so a successor opens "the outline",
    // not a pile of half-finished ones.
    const open = (await repo.getAll('semesterOutlines', { chapterId: staff.chapterId, body })).find((o) => OPEN_OUTLINE.includes(o.status));
    if (open) {
      return res.status(409).json({ error: 'There is already an outline being worked on. Finish it, or delete it, before starting another.', id: open.id });
    }
    const item = await repo.create('semesterOutlines', {
      chapterId: staff.chapterId, body, ...cleaned.value, status: 'draft', version: 1,
      createdBy: actorName(req), updatedBy: actorName(req)
    }, 'outl');
    res.json({ success: true, item });
  }));

  app.put('/api/executive/outline/:id', ...asExecutive(CAP.OUTLINE_WRITE, async (req, res, { staff, position }) => {
    const filter = { chapterId: staff.chapterId, body: bodyOf(position) };
    const existing = await repo.getById('semesterOutlines', req.params.id, filter);
    if (!existing) return res.status(404).json({ error: 'That outline was not found.' });
    if (!['draft', 'returned'].includes(existing.status)) {
      return res.status(409).json({ error: existing.status === 'approved' ? 'This outline has been approved and shared. Start a new one for the next semester.' : 'This outline is with the Chapter Coordinator. Withdraw it first if you need to change it.' });
    }
    const departments = await departmentMap(staff.chapterId);
    const cleaned = office.cleanOutline(req.body, departments);
    if (cleaned.error) return res.status(400).json({ error: cleaned.error });
    const item = await repo.patchById('semesterOutlines', existing.id, {
      ...cleaned.value, version: (existing.version || 1) + 1, updatedBy: actorName(req)
    }, { ...filter, status: existing.status });
    if (!item) return res.status(409).json({ error: 'This outline changed while you were editing it. Reload and try again.' });
    res.json({ success: true, item });
  }));

  app.post('/api/executive/outline/:id/submit', ...asExecutive(CAP.OUTLINE_WRITE, async (req, res, { staff, position }) => {
    const filter = { chapterId: staff.chapterId, body: bodyOf(position) };
    const existing = await repo.getById('semesterOutlines', req.params.id, filter);
    if (!existing) return res.status(404).json({ error: 'That outline was not found.' });
    if (!['draft', 'returned'].includes(existing.status)) return res.status(409).json({ error: 'This outline has already been sent.' });
    const gaps = office.outlineGaps(existing);
    if (gaps.length) return res.status(400).json({ error: `Before this goes to the Chapter Coordinator it needs ${gaps.join(', ')}.`, gaps });
    const item = await repo.patchById('semesterOutlines', existing.id, {
      status: 'submitted', submittedAt: new Date(), submittedBy: actorName(req), returnNote: ''
    }, { ...filter, status: existing.status });
    if (!item) return res.status(409).json({ error: 'This outline has already been sent.' });
    res.json({ success: true, item });
  }));

  app.post('/api/executive/outline/:id/withdraw', ...asExecutive(CAP.OUTLINE_WRITE, async (req, res, { staff, position }) => {
    const item = await repo.patchById('semesterOutlines', req.params.id, { status: 'draft', submittedAt: null },
      { chapterId: staff.chapterId, body: bodyOf(position), status: 'submitted' });
    if (!item) return res.status(409).json({ error: 'Only an outline that is waiting for the Coordinator can be withdrawn.' });
    res.json({ success: true, item });
  }));

  app.delete('/api/executive/outline/:id', ...asExecutive(CAP.OUTLINE_WRITE, async (req, res, { staff, position }) => {
    const filter = { chapterId: staff.chapterId, body: bodyOf(position) };
    const existing = await repo.getById('semesterOutlines', req.params.id, filter);
    if (!existing) return res.status(404).json({ error: 'That outline was not found.' });
    if (!['draft', 'returned'].includes(existing.status)) return res.status(409).json({ error: 'Only a draft can be deleted.' });
    await repo.removeById('semesterOutlines', existing.id, filter);
    res.json({ success: true });
  }));

  // What every executive reads: the outlines the Coordinator has approved.
  app.get('/api/executive/outline/shared', ...asExecutive(CAP.OUTLINE_READ, async (req, res, { staff }) => {
    const items = await repo.getAll('semesterOutlines', { chapterId: staff.chapterId, status: 'approved' });
    items.sort((a, b) => new Date(b.sharedAt || 0) - new Date(a.sharedAt || 0));
    res.json({ items });
  }));

  app.get('/api/coordinator/outlines', ...asCoordinator(async (req, res, { chapterId }) => {
    const items = await repo.getAll('semesterOutlines', { chapterId, status: { $in: ['submitted', 'returned', 'approved'] } });
    const rank = { submitted: 0, returned: 1, approved: 2 };
    items.sort((a, b) => (rank[a.status] - rank[b.status]) || newest(a, b));
    res.json({ items, waiting: items.filter((i) => i.status === 'submitted').length });
  }));

  app.post('/api/coordinator/outlines/:id/approve', ...asCoordinator(async (req, res, { chapterId, who }) => {
    const now = new Date();
    const item = await repo.patchById('semesterOutlines', req.params.id,
      { status: 'approved', reviewedBy: who, reviewedAt: now, sharedAt: now, returnNote: '' },
      { chapterId, status: 'submitted' });
    if (!item) return res.status(409).json({ error: 'That outline is not waiting for approval any more.' });
    res.json({ success: true, item });
  }));

  app.post('/api/coordinator/outlines/:id/return', ...asCoordinator(async (req, res, { chapterId, who }) => {
    const note = office.block(req.body && req.body.note, 1000);
    if (!note) return res.status(400).json({ error: 'Say what needs changing, so the President knows what to fix.' });
    const item = await repo.patchById('semesterOutlines', req.params.id,
      { status: 'returned', returnNote: note, reviewedBy: who, reviewedAt: new Date() },
      { chapterId, status: 'submitted' });
    if (!item) return res.status(409).json({ error: 'That outline is not waiting for approval any more.' });
    res.json({ success: true, item });
  }));

  // =============================================================== BUDGETS ==
  // The Financial Secretary (or the Finance office, or the Coordinator) opens a
  // CALL naming the departments that must send a budget. Each department head
  // fills in a SUBMISSION. Finance reviews it, the Vice President decides, and
  // an approved one is posted into the chapter's budget.
  //
  // The Coordinator can do whatever the Vice President can, and decide a
  // submission that Finance has not reviewed yet, so one empty seat cannot stall
  // the year's money.
  async function budgetContext(req) {
    const chapterId = chapterOf(req);
    if (!chapterId) return { error: 'Choose a chapter first.', code: 400 };
    const ctx = { chapterId, canCall: false, canDecide: false, viaCoordinator: false, who: actorName(req) || 'Admin' };
    if (hasRole(req, 'coordinator')) { ctx.canCall = true; ctx.canDecide = true; ctx.viaCoordinator = true; }
    if (hasRole(req, 'finance')) ctx.canCall = true;
    const staff = currentStaff(req);
    if (staff && staff.role === 'executive') {
      const { position } = await resolveOwnPosition(req);
      if (positions.hasCapability(position, CAP.BUDGET_CALL)) ctx.canCall = true;
      if (positions.hasCapability(position, CAP.BUDGET_DECIDE)) ctx.canDecide = true;
    }
    return ctx;
  }

  const budgetRoute = (need, handler) => async (req, res) => {
    try {
      if (!currentStaff(req) && !(req.session && req.session.isAdmin)) return res.status(401).json({ error: 'Not authenticated' });
      const ctx = await budgetContext(req);
      if (ctx.error) return res.status(ctx.code).json({ error: ctx.error });
      const allowed = need === 'call' ? ctx.canCall : need === 'decide' ? ctx.canDecide : (ctx.canCall || ctx.canDecide);
      if (!allowed) {
        return res.status(403).json({ error: need === 'decide'
          ? 'Deciding on a budget belongs to the Vice President or the Chapter Coordinator.'
          : 'Budget requests are handled by the Financial Secretary, the Finance office, the Vice President and the Chapter Coordinator.' });
      }
      return await handler(req, res, ctx);
    } catch (e) {
      res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
    }
  };

  const academicYearDates = () => {
    const now = new Date();
    const y = now.getMonth() + 1 >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    return { startDate: `${y}-08-01`, endDate: `${y + 1}-07-31` };
  };

  const STATUS_COUNTS = ['draft', 'submitted', 'returned', 'recommended', 'approved', 'declined'];

  function summariseCall(call, submissions) {
    const mine = submissions.filter((s) => s.callId === call.id);
    const counts = Object.fromEntries(STATUS_COUNTS.map((k) => [k, mine.filter((s) => s.status === k).length]));
    return {
      ...call,
      asked: (call.departmentIds || []).length,
      counts,
      requestedTotal: Math.round(mine.filter((s) => s.status !== 'draft').reduce((n, s) => n + (s.total || 0), 0) * 100) / 100,
      approvedTotal: Math.round(mine.filter((s) => s.status === 'approved').reduce((n, s) => n + (s.approvedTotal || 0), 0) * 100) / 100,
      readyToPost: mine.filter((s) => s.status === 'approved' && !s.postedAt).length
    };
  }

  app.get('/api/budget/calls', budgetRoute('any', async (req, res, ctx) => {
    const [calls, submissions] = await Promise.all([
      repo.getAll('budgetCalls', { chapterId: ctx.chapterId }),
      repo.getAll('budgetSubmissions', { chapterId: ctx.chapterId })
    ]);
    calls.sort(newest);
    res.json({ items: calls.map((c) => summariseCall(c, submissions)), canCall: ctx.canCall, canDecide: ctx.canDecide, defaultPeriod: currentAcademicYearLabel() });
  }));

  app.post('/api/budget/calls', budgetRoute('call', async (req, res, ctx) => {
    const body = req.body || {};
    const title = office.oneLine(body.title, office.LIMITS.title);
    if (!title) return res.status(400).json({ error: 'Give the request a title, for example "Budgets for 2026/2027".' });
    const departments = await departmentMap(ctx.chapterId);
    let ids = body.allDepartments === true ? [...departments.keys()] : (Array.isArray(body.departmentIds) ? body.departmentIds : []);
    ids = [...new Set(ids.map((id) => String(id)))];
    if (!ids.length) return res.status(400).json({ error: 'Choose at least one department to ask.' });
    if (ids.some((id) => !departments.has(id))) return res.status(400).json({ error: 'One of those departments is not in this chapter.' });
    const dueDate = office.cleanDate(body.dueDate);
    if (String(body.dueDate || '').trim() && !dueDate) return res.status(400).json({ error: 'The due date is not a real date.' });
    const dates = academicYearDates();
    const startDate = office.cleanDate(body.startDate) || dates.startDate;
    const endDate = office.cleanDate(body.endDate) || dates.endDate;
    if (endDate < startDate) return res.status(400).json({ error: 'The budget year cannot end before it starts.' });
    const item = await repo.create('budgetCalls', {
      chapterId: ctx.chapterId, title,
      periodLabel: office.oneLine(body.periodLabel, office.LIMITS.label) || currentAcademicYearLabel(),
      dueDate, startDate, endDate,
      instructions: office.block(body.instructions, office.LIMITS.text),
      departmentIds: ids, status: 'open', createdBy: ctx.who
    }, 'bcal');
    res.json({ success: true, item });
  }));

  app.put('/api/budget/calls/:id', budgetRoute('call', async (req, res, ctx) => {
    const existing = await repo.getById('budgetCalls', req.params.id, { chapterId: ctx.chapterId });
    if (!existing) return res.status(404).json({ error: 'That budget request was not found.' });
    const body = req.body || {};
    const patch = {};
    if (body.title !== undefined) {
      patch.title = office.oneLine(body.title, office.LIMITS.title);
      if (!patch.title) return res.status(400).json({ error: 'The request needs a title.' });
    }
    if (body.instructions !== undefined) patch.instructions = office.block(body.instructions, office.LIMITS.text);
    if (body.dueDate !== undefined) {
      patch.dueDate = office.cleanDate(body.dueDate);
      if (String(body.dueDate || '').trim() && !patch.dueDate) return res.status(400).json({ error: 'The due date is not a real date.' });
    }
    if (Array.isArray(body.departmentIds)) {
      // Departments can be added later, never taken away once asked: a head may
      // already be writing their budget.
      const departments = await departmentMap(ctx.chapterId);
      const added = [...new Set(body.departmentIds.map(String))];
      if (added.some((id) => !departments.has(id))) return res.status(400).json({ error: 'One of those departments is not in this chapter.' });
      patch.departmentIds = [...new Set([...(existing.departmentIds || []), ...added])];
    }
    if (body.status === 'closed' || body.status === 'open') {
      patch.status = body.status;
      patch.closedAt = body.status === 'closed' ? new Date() : null;
    }
    const item = await repo.patchById('budgetCalls', existing.id, patch, { chapterId: ctx.chapterId });
    res.json({ success: true, item });
  }));

  app.get('/api/budget/calls/:id', budgetRoute('any', async (req, res, ctx) => {
    const call = await repo.getById('budgetCalls', req.params.id, { chapterId: ctx.chapterId });
    if (!call) return res.status(404).json({ error: 'That budget request was not found.' });
    const [submissions, departments, cards] = await Promise.all([
      repo.getAll('budgetSubmissions', { chapterId: ctx.chapterId, callId: call.id }),
      departmentMap(ctx.chapterId),
      repo.getAll('executives', { chapterId: ctx.chapterId })
    ]);
    const heads = new Map();
    cards.forEach((c) => { if (c.department && !heads.has(c.department)) heads.set(c.department, c.name); });
    // One row per department asked, whether or not it has started. Several
    // saved copies for one department (two heads saving at once) show the
    // latest, never both.
    const rows = (call.departmentIds || []).map((id) => {
      const mine = submissions.filter((s) => s.departmentId === id).sort(newest);
      const dept = departments.get(id);
      return { departmentId: id, departmentName: dept ? dept.name : id, headName: heads.get(id) || '', submission: mine[0] || null };
    });
    res.json({ call: summariseCall(call, submissions), rows, canCall: ctx.canCall, canDecide: ctx.canDecide, viaCoordinator: ctx.viaCoordinator });
  }));

  // Finance's review: pass a budget up to the Vice President (optionally trimmed)
  // or send it back to the department with a reason.
  app.post('/api/budget/submissions/:id/review', budgetRoute('call', async (req, res, ctx) => {
    const existing = await repo.getById('budgetSubmissions', req.params.id, { chapterId: ctx.chapterId });
    if (!existing) return res.status(404).json({ error: 'That budget was not found.' });
    const action = req.body && req.body.action;
    const note = office.block(req.body && req.body.note, 1000);
    if (action === 'return') {
      if (!note) return res.status(400).json({ error: 'Say what needs changing, so the department knows what to fix.' });
      const item = await repo.patchById('budgetSubmissions', existing.id,
        { status: 'returned', reviewedBy: ctx.who, reviewedAt: new Date(), reviewNote: note },
        { chapterId: ctx.chapterId, status: 'submitted' });
      if (!item) return res.status(409).json({ error: 'That budget is not waiting for review any more.' });
      return res.json({ success: true, item });
    }
    if (action !== 'recommend') return res.status(400).json({ error: 'Choose to recommend this budget or send it back.' });
    let recommendedTotal = existing.total;
    if (req.body.recommendedTotal !== undefined && req.body.recommendedTotal !== '') {
      recommendedTotal = office.money(req.body.recommendedTotal);
      if (recommendedTotal > existing.total) return res.status(400).json({ error: 'A recommendation cannot be more than the department asked for.' });
      if (recommendedTotal < existing.total && !note) return res.status(400).json({ error: 'You are recommending less than was asked. Say why, so the department understands.' });
    }
    const item = await repo.patchById('budgetSubmissions', existing.id,
      { status: 'recommended', recommendedTotal, reviewedBy: ctx.who, reviewedAt: new Date(), reviewNote: note },
      { chapterId: ctx.chapterId, status: 'submitted' });
    if (!item) return res.status(409).json({ error: 'That budget is not waiting for review any more.' });
    res.json({ success: true, item });
  }));

  // The decision. The Vice President decides what Finance has recommended; the
  // Coordinator can also decide one Finance has not reached yet.
  app.post('/api/budget/submissions/:id/decide', budgetRoute('decide', async (req, res, ctx) => {
    const existing = await repo.getById('budgetSubmissions', req.params.id, { chapterId: ctx.chapterId });
    if (!existing) return res.status(404).json({ error: 'That budget was not found.' });
    const action = req.body && req.body.action;
    const note = office.block(req.body && req.body.note, 1000);
    const filter = { chapterId: ctx.chapterId, status: ctx.viaCoordinator ? { $in: ['submitted', 'recommended'] } : 'recommended' };
    const notReady = 'That budget is not waiting for a decision. Finance has to review it first.';
    if (action === 'approve') {
      const fallback = existing.status === 'recommended' ? existing.recommendedTotal : existing.total;
      let approvedTotal = fallback;
      if (req.body.approvedTotal !== undefined && req.body.approvedTotal !== '') {
        approvedTotal = office.money(req.body.approvedTotal);
        if (approvedTotal > existing.total) return res.status(400).json({ error: 'You cannot approve more than the department asked for.' });
        if (approvedTotal < existing.total && !note) return res.status(400).json({ error: 'You are approving less than was asked. Say why, so the department understands.' });
      }
      const item = await repo.patchById('budgetSubmissions', existing.id,
        { status: 'approved', approvedTotal, decidedBy: ctx.who, decidedAt: new Date(), decisionNote: note }, filter);
      if (!item) return res.status(409).json({ error: notReady });
      return res.json({ success: true, item });
    }
    if (action === 'decline' || action === 'return') {
      if (!note) return res.status(400).json({ error: action === 'decline' ? 'Give the reason for declining.' : 'Say what needs changing, so the department knows what to fix.' });
      const item = await repo.patchById('budgetSubmissions', existing.id,
        action === 'decline'
          ? { status: 'declined', approvedTotal: 0, decidedBy: ctx.who, decidedAt: new Date(), decisionNote: note }
          : { status: 'returned', decidedBy: ctx.who, decidedAt: new Date(), reviewNote: note }, filter);
      if (!item) return res.status(409).json({ error: notReady });
      return res.json({ success: true, item });
    }
    res.status(400).json({ error: 'Choose to approve, decline or send this budget back.' });
  }));

  // Approved budgets become lines in the chapter's own budget (a draft the
  // Finance office can then activate), so the money that was agreed is the money
  // that is tracked.
  app.post('/api/budget/calls/:id/post', budgetRoute('call', async (req, res, ctx) => {
    const call = await repo.getById('budgetCalls', req.params.id, { chapterId: ctx.chapterId });
    if (!call) return res.status(404).json({ error: 'That budget request was not found.' });
    const approved = (await repo.getAll('budgetSubmissions', { chapterId: ctx.chapterId, callId: call.id, status: 'approved' }))
      .filter((s) => !s.postedAt && s.approvedTotal > 0);
    if (!approved.length) return res.status(400).json({ error: 'Nothing approved is waiting to be added to the budget.' });
    const lines = approved.map((s) => ({
      lineId: `req_${s.id}`, lineType: 'expense', category: s.departmentName || 'Department',
      plannedAmount: s.approvedTotal, notes: `Approved budget request: ${call.title}`
    }));
    let budget = call.budgetId ? await repo.getById('budgets', call.budgetId, { chapterId: ctx.chapterId }) : null;
    if (budget) {
      const have = new Set((budget.lines || []).map((l) => l.lineId));
      budget = await repo.patchById('budgets', budget.id, { lines: [...(budget.lines || []), ...lines.filter((l) => !have.has(l.lineId))] }, { chapterId: ctx.chapterId });
    } else {
      budget = await repo.create('budgets', {
        chapterId: ctx.chapterId, name: call.title, startDate: call.startDate || academicYearDates().startDate,
        endDate: call.endDate || academicYearDates().endDate, status: 'draft',
        notes: `Built from the budget request "${call.title}".`, lines, createdBy: ctx.who
      }, 'bud');
    }
    await Promise.all(approved.map((s) => repo.patchById('budgetSubmissions', s.id, { postedAt: new Date() }, { chapterId: ctx.chapterId })));
    await repo.patchById('budgetCalls', call.id, { budgetId: budget.id }, { chapterId: ctx.chapterId });
    res.json({ success: true, posted: approved.length, budgetId: budget.id, budgetName: budget.name });
  }));

  // The department head's side.
  app.get('/api/executive/budget-requests', ...asExecutive(CAP.BUDGET_SUBMIT, async (req, res, { staff, record }) => {
    const departmentId = record && record.department;
    if (!departmentId) return res.json({ items: [], department: null });
    const [calls, submissions, department] = await Promise.all([
      repo.getAll('budgetCalls', { chapterId: staff.chapterId }),
      repo.getAll('budgetSubmissions', { chapterId: staff.chapterId, departmentId }),
      repo.getById('departments', departmentId, { chapterId: staff.chapterId })
    ]);
    const items = calls
      .filter((c) => (c.departmentIds || []).includes(departmentId))
      .sort(newest)
      .map((call) => ({ call, submission: submissions.filter((s) => s.callId === call.id).sort(newest)[0] || null }));
    res.json({ items, department: department ? { id: department.id, name: department.name } : null });
  }));

  app.put('/api/executive/budget-requests/:callId', ...asExecutive(CAP.BUDGET_SUBMIT, async (req, res, { staff, record }) => {
    const departmentId = record && record.department;
    if (!departmentId) return res.status(400).json({ error: 'Your Chapter Coordinator has not attached a department to your office yet.' });
    const call = await repo.getById('budgetCalls', req.params.callId, { chapterId: staff.chapterId });
    if (!call || !(call.departmentIds || []).includes(departmentId)) {
      return res.status(404).json({ error: 'Your department was not asked for a budget on this request.' });
    }
    if (call.status !== 'open') return res.status(409).json({ error: 'This request is closed. Ask the Financial Secretary to reopen it.' });
    const cleaned = office.cleanBudgetLines(req.body && req.body.lines);
    if (cleaned.error) return res.status(400).json({ error: cleaned.error });
    const justification = office.block(req.body && req.body.justification, office.LIMITS.text);
    const submitting = req.body && req.body.submit === true;
    if (submitting && (!cleaned.lines.length || cleaned.total <= 0)) {
      return res.status(400).json({ error: 'Add at least one line with a cost before sending this to Finance.' });
    }
    const department = await repo.getById('departments', departmentId, { chapterId: staff.chapterId });
    const existing = (await repo.getAll('budgetSubmissions', { chapterId: staff.chapterId, callId: call.id, departmentId })).sort(newest)[0];
    const fields = {
      lines: cleaned.lines, total: cleaned.total, justification,
      ...(submitting ? { status: 'submitted', submittedBy: staff.id, submittedByName: actorName(req), submittedAt: new Date(), reviewNote: '' } : {})
    };
    if (existing) {
      if (!['draft', 'returned'].includes(existing.status)) {
        return res.status(409).json({ error: 'This budget is already with Finance. It can be changed only if it is sent back to you.' });
      }
      const item = await repo.patchById('budgetSubmissions', existing.id, fields,
        { chapterId: staff.chapterId, status: existing.status });
      if (!item) return res.status(409).json({ error: 'This budget has just been sent. Reload to see where it is.' });
      return res.json({ success: true, item });
    }
    const item = await repo.create('budgetSubmissions', {
      chapterId: staff.chapterId, callId: call.id, departmentId,
      departmentName: department ? department.name : '', status: 'draft', ...fields
    }, 'bsub');
    res.json({ success: true, item });
  }));

  // =============================================================== MINUTES ==
  // The General Secretary and the Assistant keep the minutes between them: one
  // writes, they discuss it in a thread on the minutes themselves, both sign it
  // off, and only then do the other executives see it.
  const MINUTES_VISIBLE_DRAFTS = ['draft', 'in_review'];

  // Which of the two secretarial seats currently has someone in it. A seat with
  // an ended term or a disabled login is empty, whatever the roster card says.
  async function seatHolders(chapterId) {
    const cards = await repo.getAll('executives', { chapterId });
    const held = [];
    for (const card of cards) {
      if (!office.SECRETARIAT.includes(card.positionKey) || !card.staffId || held.includes(card.positionKey)) continue;
      const user = await repo.getById('staffUsers', card.staffId, { chapterId });
      const ended = user && user.termEndsAt && new Date(user.termEndsAt) <= new Date();
      if (user && user.active !== false && !ended) held.push(card.positionKey);
    }
    return held;
  }

  const minuteShape = (m, keep) => {
    if (keep) return m;
    // Another executive sees the record, not the secretaries' working.
    const { comments, approvedBy, ...rest } = m;
    return rest;
  };

  app.get('/api/executive/minutes', requireRole('executive'), requireCapability(CAP.MINUTES, async (req, res, { staff, position }) => {
    const keep = positions.hasCapability(position, CAP.MINUTES_KEEP);
    const all = await repo.getAll('executiveMinutes', { chapterId: staff.chapterId });
    const visible = all.filter((m) => keep || office.isShared(m));
    visible.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    res.json(visible.map((m) => minuteShape(m, keep)));
  }));

  // Everything the form needs in one round trip: this chapter's executives (to
  // tick who was present) and which seats are filled.
  app.get('/api/executive/minutes-setup', ...asExecutive(CAP.MINUTES_KEEP, async (req, res, { staff }) => {
    const cards = await repo.getAll('executives', { chapterId: staff.chapterId });
    cards.sort((a, b) => (a.order || 0) - (b.order || 0));
    res.json({
      executives: cards.map((c) => ({ id: c.id, name: c.name, role: c.role || '' })),
      seats: await seatHolders(staff.chapterId),
      today: today()
    });
  }));

  const loadMinute = async (req, chapterId) => repo.getById('executiveMinutes', req.params.id, { chapterId });

  app.post('/api/executive/minutes', ...asExecutive(CAP.MINUTES_KEEP, async (req, res, { staff, position }) => {
    const cards = await repo.getAll('executives', { chapterId: staff.chapterId });
    const cleaned = office.cleanMinutes({ date: today(), ...(req.body || {}) }, new Map(cards.map((c) => [c.id, c])));
    if (cleaned.error) return res.status(400).json({ error: cleaned.error });
    const item = await repo.create('executiveMinutes', {
      chapterId: staff.chapterId, ...cleaned.value, status: 'draft',
      recordedBy: actorName(req), recordedPosition: position.key
    }, 'emin');
    res.json({ success: true, item });
  }));

  app.put('/api/executive/minutes/:id', ...asExecutive(CAP.MINUTES_KEEP, async (req, res, { staff }) => {
    const existing = await loadMinute(req, staff.chapterId);
    if (!existing) return res.status(404).json({ error: 'Those minutes were not found.' });
    if (!MINUTES_VISIBLE_DRAFTS.includes(existing.status)) {
      return res.status(409).json({ error: 'These minutes have been shared with the executive body and are now the record. Write any correction in the next meeting\'s minutes.' });
    }
    const cards = await repo.getAll('executives', { chapterId: staff.chapterId });
    const cleaned = office.cleanMinutes({ date: existing.date, ...(req.body || {}) }, new Map(cards.map((c) => [c.id, c])));
    if (cleaned.error) return res.status(400).json({ error: cleaned.error });
    // What was approved is what was read. A change means reading it again.
    const hadApprovals = (existing.approvedPositions || []).length > 0;
    const item = await repo.patchById('executiveMinutes', existing.id,
      { ...cleaned.value, approvedBy: [], approvedPositions: [] },
      { chapterId: staff.chapterId, status: { $in: MINUTES_VISIBLE_DRAFTS } });
    if (!item) return res.status(409).json({ error: 'These minutes were shared while you were editing them.' });
    if (hadApprovals) {
      await models.ExecutiveMinute.findOneAndUpdate({ id: existing.id, chapterId: staff.chapterId }, {
        $push: { comments: { id: `cm_${Date.now()}`, by: staff.id, byName: actorName(req), position: '', text: 'Changed the minutes, so both secretaries need to approve them again.', at: new Date() } }
      });
    }
    res.json({ success: true, item });
  }));

  app.post('/api/executive/minutes/:id/review', ...asExecutive(CAP.MINUTES_KEEP, async (req, res, { staff }) => {
    const existing = await loadMinute(req, staff.chapterId);
    if (!existing) return res.status(404).json({ error: 'Those minutes were not found.' });
    const gaps = office.minutesGaps(existing);
    if (gaps.length) return res.status(400).json({ error: `Before these go to the other secretary they need ${gaps.join(' and ')}.`, gaps });
    const item = await repo.patchById('executiveMinutes', existing.id,
      { status: 'in_review', approvedBy: [], approvedPositions: [] },
      { chapterId: staff.chapterId, status: 'draft' });
    if (!item) return res.status(409).json({ error: 'These minutes are already with the other secretary.' });
    res.json({ success: true, item });
  }));

  app.post('/api/executive/minutes/:id/comments', ...asExecutive(CAP.MINUTES_KEEP, async (req, res, { staff, position }) => {
    const text = office.block(req.body && req.body.text, office.LIMITS.comment);
    if (!text) return res.status(400).json({ error: 'Write your comment first.' });
    const comment = { id: `cm_${Date.now()}_${Math.floor(Math.random() * 1000)}`, by: staff.id, byName: actorName(req), position: position.key, text, at: new Date() };
    const item = await models.ExecutiveMinute.findOneAndUpdate(
      { id: req.params.id, chapterId: staff.chapterId, status: { $in: MINUTES_VISIBLE_DRAFTS } },
      { $push: { comments: comment } }, { new: true }
    ).lean();
    if (!item) return res.status(409).json({ error: 'Comments can be added only while the minutes are being worked on.' });
    delete item._id; delete item.__v;
    res.json({ success: true, item });
  }));

  // Sign-off. Each secretary signs for their own seat; when every filled seat
  // has signed, the minutes become the record and are shared.
  app.post('/api/executive/minutes/:id/approve', ...asExecutive(CAP.MINUTES_KEEP, async (req, res, { staff, position }) => {
    const existing = await loadMinute(req, staff.chapterId);
    if (!existing) return res.status(404).json({ error: 'Those minutes were not found.' });
    if (existing.status !== 'in_review') {
      return res.status(409).json({ error: office.isShared(existing) ? 'These minutes have already been shared.' : 'Send the minutes to the other secretary first.' });
    }
    const afterSign = await models.ExecutiveMinute.findOneAndUpdate(
      { id: existing.id, chapterId: staff.chapterId, status: 'in_review' },
      { $addToSet: { approvedPositions: position.key, approvedBy: staff.id } }, { new: true }
    ).lean();
    if (!afterSign) return res.status(409).json({ error: 'These minutes are no longer waiting for approval.' });
    const required = office.seatsRequired(await seatHolders(staff.chapterId));
    let result = afterSign;
    if (office.allApproved(afterSign, required)) {
      const now = new Date();
      const shared = await models.ExecutiveMinute.findOneAndUpdate(
        { id: existing.id, chapterId: staff.chapterId, status: 'in_review' },
        { $set: { status: 'approved', sharedAt: now, adoptedAt: now, adoptedBy: actorName(req) } }, { new: true }
      ).lean();
      result = shared || (await models.ExecutiveMinute.findOne({ id: existing.id }).lean());
    }
    delete result._id; delete result.__v;
    res.json({ success: true, item: result, shared: office.isShared(result), waitingFor: required.filter((s) => !(result.approvedPositions || []).includes(s)) });
  }));

  // Back to the writer: not ready, with the reason left in the thread.
  app.post('/api/executive/minutes/:id/reopen', ...asExecutive(CAP.MINUTES_KEEP, async (req, res, { staff, position }) => {
    const note = office.block(req.body && req.body.note, office.LIMITS.comment);
    const item = await repo.patchById('executiveMinutes', req.params.id,
      { status: 'draft', approvedBy: [], approvedPositions: [] },
      { chapterId: staff.chapterId, status: 'in_review' });
    if (!item) return res.status(409).json({ error: 'Only minutes waiting for approval can be sent back to draft.' });
    if (note) {
      await models.ExecutiveMinute.findOneAndUpdate({ id: item.id, chapterId: staff.chapterId }, {
        $push: { comments: { id: `cm_${Date.now()}`, by: staff.id, byName: actorName(req), position: position.key, text: note, at: new Date() } }
      });
    }
    res.json({ success: true, item });
  }));

  app.delete('/api/executive/minutes/:id', ...asExecutive(CAP.MINUTES_KEEP, async (req, res, { staff }) => {
    const existing = await loadMinute(req, staff.chapterId);
    if (!existing) return res.status(404).json({ error: 'Those minutes were not found.' });
    if (existing.status !== 'draft') return res.status(409).json({ error: 'Only a draft can be deleted.' });
    await repo.removeById('executiveMinutes', existing.id, { chapterId: staff.chapterId });
    if (existing.fileId) gridfs.deleteFile(existing.fileId).catch(() => {});
    res.json({ success: true });
  }));

  // A scan or photo of the paper minutes. Stored privately: it opens only for the
  // secretaries and the Coordinator, and for the other executives once shared.
  const MINUTES_FILE_LIMIT = 15 * 1024 * 1024;
  app.post('/api/executive/minutes/:id/file', requireRole('executive'), upload.single('file'), requireCapability(CAP.MINUTES_KEEP, async (req, res, { staff }) => {
    const existing = await loadMinute(req, staff.chapterId);
    if (!existing) return res.status(404).json({ error: 'Those minutes were not found.' });
    if (!MINUTES_VISIBLE_DRAFTS.includes(existing.status)) return res.status(409).json({ error: 'These minutes are shared and can no longer be changed.' });
    if (!req.file) return res.status(400).json({ error: 'Choose a file to attach.' });
    if (req.file.size > MINUTES_FILE_LIMIT) return res.status(413).json({ error: 'That file is too large. Please send one under 15MB.' });
    // The bytes decide what it is, not the name: a PDF or a photo, nothing else.
    if (!fileTypes.sniff(req.file.buffer)) return res.status(400).json({ error: 'Attach a PDF, or a photo of the minutes (JPG or PNG).' });
    const fileId = String(await gridfs.uploadBuffer(req.file.buffer, req.file.originalname, {
      category: 'minutes', chapterId: staff.chapterId, targetId: existing.id,
      title: `Minutes ${existing.date}`, contentType: req.file.mimetype
    }));
    const item = await repo.patchById('executiveMinutes', existing.id,
      { fileId, approvedBy: [], approvedPositions: [] },
      { chapterId: staff.chapterId, status: { $in: MINUTES_VISIBLE_DRAFTS } });
    if (!item) {
      gridfs.deleteFile(fileId).catch(() => {});
      return res.status(409).json({ error: 'These minutes were shared while the file was uploading.' });
    }
    if (existing.fileId) gridfs.deleteFile(existing.fileId).catch(() => {});
    res.json({ success: true, item });
  }));

  app.delete('/api/executive/minutes/:id/file', ...asExecutive(CAP.MINUTES_KEEP, async (req, res, { staff }) => {
    const existing = await loadMinute(req, staff.chapterId);
    if (!existing) return res.status(404).json({ error: 'Those minutes were not found.' });
    const item = await repo.patchById('executiveMinutes', existing.id, { fileId: '', approvedBy: [], approvedPositions: [] },
      { chapterId: staff.chapterId, status: { $in: MINUTES_VISIBLE_DRAFTS } });
    if (!item) return res.status(409).json({ error: 'These minutes are shared and can no longer be changed.' });
    if (existing.fileId) gridfs.deleteFile(existing.fileId).catch(() => {});
    res.json({ success: true, item });
  }));

  // The Coordinator reads the record too, but not the secretaries' drafts.
  app.get('/api/coordinator/minutes', ...asCoordinator(async (req, res, { chapterId }) => {
    const all = await repo.getAll('executiveMinutes', { chapterId });
    const shared = all.filter(office.isShared).sort((a, b) => (a.date < b.date ? 1 : -1)).map((m) => minuteShape(m, false));
    res.json({ items: shared, inReview: all.filter((m) => m.status === 'in_review').length });
  }));

  // ====================================================== SUNDAY ANNOUNCEMENTS ==
  // The secretaries ask every executive what they want announced, review what
  // comes back, and compile the text that is read out.
  const announceOpen = ['open'];

  // Who is expected to answer: every executive with a login who can send an
  // announcement. Their answer is keyed by the roster card, which stays with the
  // office when it changes hands.
  async function expectedSenders(chapterId) {
    const cards = await repo.getAll('executives', { chapterId });
    return cards
      .filter((c) => c.staffId && positions.hasCapability(positions.resolvePosition(c.positionKey, c.role, !!c.department), CAP.ANNOUNCE_SUBMIT))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  app.get('/api/executive/announcement-calls', ...asExecutive(CAP.ANNOUNCE_COLLECT, async (req, res, { staff }) => {
    const [calls, items] = await Promise.all([
      repo.getAll('announcementCalls', { chapterId: staff.chapterId }),
      repo.getAll('announcementItems', { chapterId: staff.chapterId })
    ]);
    const senders = await expectedSenders(staff.chapterId);
    calls.sort((a, b) => (a.serviceDate < b.serviceDate ? 1 : -1));
    res.json({
      items: calls.map((c) => {
        const mine = items.filter((i) => i.callId === c.id);
        return { ...c, received: mine.length, expected: senders.length, nothingCount: mine.filter((i) => i.nothing).length };
      }),
      suggestedDate: nextSunday()
    });
  }));

  function nextSunday() {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7 || 7));
    return d.toISOString().slice(0, 10);
  }

  app.post('/api/executive/announcement-calls', ...asExecutive(CAP.ANNOUNCE_COLLECT, async (req, res, { staff }) => {
    const body = req.body || {};
    const serviceDate = office.cleanDate(body.serviceDate);
    if (!serviceDate) return res.status(400).json({ error: 'Choose the date of the service these announcements are for.' });
    const dueDate = office.cleanDate(body.dueDate);
    if (String(body.dueDate || '').trim() && !dueDate) return res.status(400).json({ error: 'The deadline is not a real date.' });
    if (dueDate && dueDate > serviceDate) return res.status(400).json({ error: 'The deadline has to come before the service.' });
    const duplicate = (await repo.getAll('announcementCalls', { chapterId: staff.chapterId, serviceDate })).find((c) => c.status === 'open');
    if (duplicate) return res.status(409).json({ error: 'You have already asked for announcements for that service.', id: duplicate.id });
    const item = await repo.create('announcementCalls', {
      chapterId: staff.chapterId, serviceDate, dueDate,
      title: office.oneLine(body.title, office.LIMITS.title) || `Announcements for ${office.longDate(serviceDate)}`,
      note: office.block(body.note, 1000), status: 'open', createdBy: actorName(req)
    }, 'acal');
    res.json({ success: true, item });
  }));

  app.get('/api/executive/announcement-calls/:id', ...asExecutive(CAP.ANNOUNCE_COLLECT, async (req, res, { staff }) => {
    const call = await repo.getById('announcementCalls', req.params.id, { chapterId: staff.chapterId });
    if (!call) return res.status(404).json({ error: 'That request was not found.' });
    const [items, senders] = await Promise.all([
      repo.getAll('announcementItems', { chapterId: staff.chapterId, callId: call.id }),
      expectedSenders(staff.chapterId)
    ]);
    const answered = new Set(items.map((i) => i.executiveId));
    items.sort((a, b) => ((a.order || 999) - (b.order || 999)) || newest(b, a));
    res.json({
      call, items,
      waitingOn: senders.filter((c) => !answered.has(c.id)).map((c) => ({ id: c.id, name: c.name, role: c.role || '' }))
    });
  }));

  app.put('/api/executive/announcement-calls/:id', ...asExecutive(CAP.ANNOUNCE_COLLECT, async (req, res, { staff }) => {
    const body = req.body || {};
    const patch = {};
    if (body.note !== undefined) patch.note = office.block(body.note, 1000);
    if (body.compiledText !== undefined) patch.compiledText = office.block(body.compiledText, office.LIMITS.longText);
    if (body.status === 'open' || body.status === 'closed') patch.status = body.status;
    if (body.dueDate !== undefined) {
      patch.dueDate = office.cleanDate(body.dueDate);
      if (String(body.dueDate || '').trim() && !patch.dueDate) return res.status(400).json({ error: 'The deadline is not a real date.' });
    }
    const item = await repo.patchById('announcementCalls', req.params.id, patch, { chapterId: staff.chapterId });
    if (!item) return res.status(404).json({ error: 'That request was not found.' });
    res.json({ success: true, item });
  }));

  // Decide what happens to one answer: read it out (perhaps tidied), or leave it.
  app.put('/api/executive/announcement-calls/:id/items/:itemId', ...asExecutive(CAP.ANNOUNCE_COLLECT, async (req, res, { staff }) => {
    const body = req.body || {};
    const patch = {};
    if (['submitted', 'included', 'left_out'].includes(body.status)) patch.status = body.status;
    if (body.finalText !== undefined) patch.finalText = office.block(body.finalText, office.LIMITS.announcement);
    if (body.order !== undefined) patch.order = Math.max(0, Math.min(999, parseInt(body.order, 10) || 0));
    const item = await repo.patchById('announcementItems', req.params.itemId, patch,
      { chapterId: staff.chapterId, callId: req.params.id });
    if (!item) return res.status(404).json({ error: 'That announcement was not found.' });
    res.json({ success: true, item });
  }));

  app.post('/api/executive/announcement-calls/:id/compile', ...asExecutive(CAP.ANNOUNCE_COLLECT, async (req, res, { staff }) => {
    const call = await repo.getById('announcementCalls', req.params.id, { chapterId: staff.chapterId });
    if (!call) return res.status(404).json({ error: 'That request was not found.' });
    let items = await repo.getAll('announcementItems', { chapterId: staff.chapterId, callId: call.id });
    if (req.body && req.body.includeAll === true) {
      // "Read out everything that came in" - anything not yet decided is included.
      const undecided = items.filter((i) => i.status === 'submitted' && !i.nothing);
      await Promise.all(undecided.map((i, n) => repo.patchById('announcementItems', i.id, { status: 'included', order: i.order || (n + 1) }, { chapterId: staff.chapterId })));
      items = await repo.getAll('announcementItems', { chapterId: staff.chapterId, callId: call.id });
    }
    const compiledText = office.compileAnnouncements(call, items);
    const item = await repo.patchById('announcementCalls', call.id,
      { compiledText, compiledBy: actorName(req), compiledAt: new Date() }, { chapterId: staff.chapterId });
    res.json({ success: true, item });
  }));

  // The executive's side: what has been asked of them, and their answer.
  app.get('/api/executive/announcement-requests', ...asExecutive(CAP.ANNOUNCE_SUBMIT, async (req, res, { staff, record }) => {
    const calls = (await repo.getAll('announcementCalls', { chapterId: staff.chapterId }))
      .sort((a, b) => (a.serviceDate < b.serviceDate ? 1 : -1)).slice(0, 12);
    const mine = record ? await repo.getAll('announcementItems', { chapterId: staff.chapterId, executiveId: record.id }) : [];
    res.json({
      items: calls.map((call) => ({
        call: { id: call.id, title: call.title, serviceDate: call.serviceDate, dueDate: call.dueDate, note: call.note, status: call.status },
        answer: mine.find((i) => i.callId === call.id) || null
      }))
    });
  }));

  app.put('/api/executive/announcement-requests/:callId', ...asExecutive(CAP.ANNOUNCE_SUBMIT, async (req, res, { staff, record, position }) => {
    if (!record) return res.status(400).json({ error: 'Set up your executive profile first, so we know who this announcement is from.' });
    const call = await repo.getById('announcementCalls', req.params.callId, { chapterId: staff.chapterId });
    if (!call) return res.status(404).json({ error: 'That request was not found.' });
    if (!announceOpen.includes(call.status)) return res.status(409).json({ error: 'The secretaries have closed this request.' });
    const body = req.body || {};
    const nothing = body.nothing === true;
    const text = nothing ? '' : office.block(body.text, office.LIMITS.announcement);
    if (!nothing && !text) return res.status(400).json({ error: 'Write the announcement, or say you have nothing for this Sunday.' });
    const fields = {
      nothing, text,
      whenWhere: nothing ? '' : office.oneLine(body.whenWhere, office.LIMITS.line),
      contact: nothing ? '' : office.oneLine(body.contact, office.LIMITS.name),
      fromLabel: position.label, fromName: actorName(req), positionKey: position.key, staffId: staff.id
    };
    const existing = (await repo.getAll('announcementItems', { chapterId: staff.chapterId, callId: call.id, executiveId: record.id }))[0];
    if (existing) {
      // Changing it after the secretaries have chosen is allowed, but it goes
      // back to being undecided: they should look at the new wording.
      const item = await repo.patchById('announcementItems', existing.id, { ...fields, status: 'submitted', finalText: '' }, { chapterId: staff.chapterId });
      return res.json({ success: true, item });
    }
    const item = await repo.create('announcementItems', {
      chapterId: staff.chapterId, callId: call.id, executiveId: record.id, ...fields, status: 'submitted'
    }, 'aitm');
    res.json({ success: true, item });
  }));

  // ============================================ COMMITTEES AND FOLLOW-UP ==
  app.get('/api/executive/committees', ...asExecutive(CAP.COMMITTEES, async (req, res, { staff }) => {
    const [items, cards] = await Promise.all([
      repo.getAll('committees', { chapterId: staff.chapterId }),
      repo.getAll('executives', { chapterId: staff.chapterId })
    ]);
    items.sort((a, b) => (a.status === b.status ? newest(a, b) : a.status === 'active' ? -1 : 1));
    res.json({ items, executives: cards.map((c) => ({ id: c.id, name: c.name, role: c.role || '' })) });
  }));

  app.post('/api/executive/committees', ...asExecutive(CAP.COMMITTEES, async (req, res, { staff }) => {
    const cleaned = office.cleanCommittee(req.body);
    if (cleaned.error) return res.status(400).json({ error: cleaned.error });
    const item = await repo.create('committees', { chapterId: staff.chapterId, ...cleaned.value, createdBy: actorName(req) }, 'comm');
    res.json({ success: true, item });
  }));

  app.put('/api/executive/committees/:id', ...asExecutive(CAP.COMMITTEES, async (req, res, { staff }) => {
    const cleaned = office.cleanCommittee(req.body);
    if (cleaned.error) return res.status(400).json({ error: cleaned.error });
    const item = await repo.patchById('committees', req.params.id, cleaned.value, { chapterId: staff.chapterId });
    if (!item) return res.status(404).json({ error: 'That committee was not found.' });
    res.json({ success: true, item });
  }));

  app.delete('/api/executive/committees/:id', ...asExecutive(CAP.COMMITTEES, async (req, res, { staff }) => {
    const existing = await repo.getById('committees', req.params.id, { chapterId: staff.chapterId });
    if (!existing) return res.status(404).json({ error: 'That committee was not found.' });
    await repo.removeById('committees', existing.id, { chapterId: staff.chapterId });
    res.json({ success: true });
  }));

  // Action items from the minutes the executive body has been given, together
  // with the active committees' deadlines: one place to see what is still owed.
  app.get('/api/executive/followups', ...asExecutive(CAP.FOLLOW_UP, async (req, res, { staff }) => {
    const [minutes, committees] = await Promise.all([
      repo.getAll('executiveMinutes', { chapterId: staff.chapterId }),
      repo.getAll('committees', { chapterId: staff.chapterId, status: 'active' })
    ]);
    const now = today();
    const actions = [];
    minutes.filter(office.isShared).forEach((m) => {
      (m.actions || []).forEach((a) => actions.push({
        minuteId: m.id, minuteTitle: m.title || 'Executive meeting', minuteDate: m.date,
        actionId: a.id, task: a.task, owner: a.owner, dueDate: a.dueDate || '', done: !!a.done,
        overdue: !a.done && !!a.dueDate && a.dueDate < now
      }));
    });
    actions.sort((a, b) => (a.done - b.done) || String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));
    res.json({
      actions,
      open: actions.filter((a) => !a.done).length,
      overdue: actions.filter((a) => a.overdue).length,
      committees: committees.map((c) => ({ id: c.id, name: c.name, kind: c.kind, chairName: c.chairName, dueDate: c.dueDate, overdue: !!c.dueDate && c.dueDate < now }))
    });
  }));

  app.patch('/api/executive/followups/:minuteId/:actionId', ...asExecutive(CAP.FOLLOW_UP, async (req, res, { staff }) => {
    const existing = await repo.getById('executiveMinutes', req.params.minuteId, { chapterId: staff.chapterId });
    if (!existing || !office.isShared(existing)) return res.status(404).json({ error: 'That item was not found.' });
    const actions = (existing.actions || []).map((a) => (a.id === req.params.actionId ? { ...a, done: req.body && req.body.done === true } : a));
    if (!actions.some((a) => a.id === req.params.actionId)) return res.status(404).json({ error: 'That item was not found.' });
    const item = await repo.patchById('executiveMinutes', existing.id, { actions }, { chapterId: staff.chapterId });
    res.json({ success: true, item });
  }));
}

module.exports = { registerOfficeRoutes };
