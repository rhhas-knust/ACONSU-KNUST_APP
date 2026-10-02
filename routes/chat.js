// Chapter-wide community discussion routes.
function registerChatRoutes(app, deps) {
  const { repo, models, rolesLib, requireMember, requireChapterAdmin, isChapterAdminOrAbove,
    resolveViewerChapterId, actorName, chapterConfidential } = deps;
  const requireChatModerator = (req, res, next) => isChapterAdminOrAbove(req)
    ? next() : res.status(401).json({ error: 'Not authenticated' });
  // Reading a discussion is for its members, and for the people who moderate
  // it. The moderation panel in the admin dashboard calls these two reads, and
  // they used to be members-only, so every admin login was refused and the
  // panel never got past "Loading...". A moderator is held to the same rule as
  // any other chapter record: their own chapter's, and not at all for National
  // once there is more than one chapter (individual records stay inside the
  // chapter they belong to).
  const requireMemberOrModerator = (req, res, next) => {
    if (req.session && req.session.memberId) return next();
    if (!isChapterAdminOrAbove(req)) return res.status(401).json({ error: 'Not authenticated' });
    return chapterConfidential('Community discussions')(req, res, next);
  };
  // The chapter a request is about. A member always has one. A moderator
  // names one (the dashboard sends it), and with exactly one active chapter
  // there is nothing to name - the same single-chapter rule the rest of the
  // app uses. Otherwise empty, and empty must never widen into "every chapter".
  const chapterInView = async (req) => {
    const named = await resolveViewerChapterId(req);
    if (named) return named;
    if (req.session && req.session.memberId) return '';
    return rolesLib.getSoleActiveChapterId() || '';
  };
  const belongsToViewerChapter = async (req, item) => {
    const chapterId = await chapterInView(req);
    return !!(item && chapterId && item.chapterId === chapterId);
  };

  app.get('/api/chat/topics', requireMemberOrModerator, async (req, res) => {
    try {
      const chapterId = await chapterInView(req);
      // A moderator with no chapter in view must not fall through to the
      // "every chapter" filter below, which exists for members who always have one.
      if (!chapterId && !(req.session && req.session.memberId)) return res.json([]);
      const topics = await repo.getAll('chatTopics', chapterId ? { chapterId } : {});
      const withMeta = await Promise.all(topics.map(async (t) => {
        const msgs = await repo.getAll('chatMessages', { topicId: t.id, chapterId: t.chapterId, hidden: false });
        const last = [...msgs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
        return { ...t, messageCount: msgs.length, lastActivity: last ? last.createdAt : t.createdAt };
      }));
      res.json(withMeta.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity)));
    } catch (e) { res.status(500).json({ error: 'Could not load discussions' }); }
  });

  app.post('/api/chat/topics', requireMember, async (req, res) => {
    try {
      if (!req.body.title || !req.body.title.trim()) return res.status(400).json({ error: 'A title is required' });
      const chapterId = await resolveViewerChapterId(req);
      if (!chapterId) return res.status(400).json({ error: 'Could not determine your chapter.' });
      const member = await repo.getById('members', req.session.memberId);
      if (member && member.chatRestricted) return res.status(403).json({ error: 'Your posting privileges have been restricted. Contact your Chapter Admin.' });
      const topic = await repo.create('chatTopics', { chapterId, title: req.body.title.trim(), createdByMemberId: req.session.memberId, createdByName: member ? member.name : '' }, 'topic');
      res.json({ success: true, item: topic });
    } catch (e) { res.status(500).json({ error: 'Could not start this discussion' }); }
  });

  app.get('/api/chat/topics/:id/messages', requireMemberOrModerator, async (req, res) => {
    try {
      const topic = await repo.getById('chatTopics', req.params.id);
      if (!await belongsToViewerChapter(req, topic)) return res.status(404).json({ error: 'Discussion not found' });
      const messages = await repo.getAll('chatMessages', { topicId: topic.id, chapterId: topic.chapterId, hidden: false });
      res.json(messages.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
    } catch (e) { res.status(500).json({ error: 'Could not load messages' }); }
  });

  app.post('/api/chat/topics/:id/messages', requireMember, async (req, res) => {
    try {
      const topic = await repo.getById('chatTopics', req.params.id);
      if (!await belongsToViewerChapter(req, topic)) return res.status(404).json({ error: 'Discussion not found' });
      if (topic.locked) return res.status(400).json({ error: 'This discussion has been locked.' });
      if (!req.body.body || !req.body.body.trim()) return res.status(400).json({ error: 'A message is required' });
      const member = await repo.getById('members', req.session.memberId);
      if (member && member.chatRestricted) return res.status(403).json({ error: 'Your posting privileges have been restricted. Contact your Chapter Admin.' });
      const message = await repo.create('chatMessages', { chapterId: topic.chapterId, topicId: topic.id, authorMemberId: req.session.memberId,
        authorName: member ? member.name : '', body: req.body.body.trim() }, 'msg');
      res.json({ success: true, item: message });
    } catch (e) { res.status(500).json({ error: 'Could not send this message' }); }
  });

  app.post('/api/chat/messages/:id/report', requireMember, async (req, res) => {
    try {
      const message = await repo.getById('chatMessages', req.params.id);
      if (!await belongsToViewerChapter(req, message)) return res.status(404).json({ error: 'Message not found' });
      await models.ChatMessage.updateOne({ id: req.params.id, chapterId: message.chapterId }, { $inc: { reportCount: 1 } });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Could not report this message' }); }
  });

  app.patch('/api/chat/messages/:id/moderate', requireChatModerator, async (req, res) => {
    try {
      const filter = rolesLib.chapterFilter(req, { required: false });
      const hidden = req.body.hidden !== false;
      const item = await repo.patchById('chatMessages', req.params.id, { hidden, hiddenBy: hidden ? actorName(req) : '' }, filter);
      if (!item) return res.status(404).json({ error: 'Not found' });
      res.json({ success: true, item });
    } catch (e) { res.status(500).json({ error: 'Could not moderate this message' }); }
  });

  app.patch('/api/chat/topics/:id/lock', requireChatModerator, async (req, res) => {
    try {
      const filter = rolesLib.chapterFilter(req, { required: false });
      const item = await repo.patchById('chatTopics', req.params.id, { locked: req.body.locked !== false }, filter);
      if (!item) return res.status(404).json({ error: 'Not found' });
      res.json({ success: true, item });
    } catch (e) { res.status(500).json({ error: 'Could not update this discussion' }); }
  });

  app.patch('/api/admin/members/:id/chat-restriction', requireChapterAdmin, async (req, res) => {
    try {
      const filter = rolesLib.chapterFilter(req, { required: false });
      const item = await repo.patchById('members', req.params.id, { chatRestricted: !!req.body.chatRestricted }, filter);
      if (!item) return res.status(404).json({ error: 'Member not found' });
      const { passwordHash, ...safe } = item;
      res.json({ success: true, item: safe });
    } catch (e) { res.status(500).json({ error: 'Could not update this member' }); }
  });
}

module.exports = { registerChatRoutes };
