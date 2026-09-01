// Community groups routes. Dependencies are injected by server.js so this
// module stays easy to test and does not create a second application context.
function registerGroupRoutes(app, deps) {
  const { repo, models, rolesLib, requireMember, requireContentManager, isChapterAdminOrAbove,
    resolveViewerChapterId, resolveChapterIdForWrite, actorName } = deps;

  const isGroupLeaderOrAbove = (req, group) => isChapterAdminOrAbove(req)
    || !!(req.session && req.session.memberId && group.leaderMemberId === req.session.memberId);
  const isGroupMember = (req, group) => !!(req.session && req.session.memberId
    && group.memberIds.includes(req.session.memberId));
  const canAccessGroup = async (req, group) => {
    const chapterId = await resolveViewerChapterId(req);
    return !!(group && chapterId && group.chapterId === chapterId);
  };

  app.get('/api/groups', async (req, res) => {
    try {
      const chapterId = await resolveViewerChapterId(req);
      const groups = await repo.getAll('groups', chapterId ? { chapterId } : {});
      res.json(groups.map(({ memberIds, ...g }) => ({ ...g, memberCount: memberIds.length })));
    } catch (e) { res.status(500).json({ error: 'Could not load groups' }); }
  });

  app.get('/api/groups/:id', async (req, res) => {
    try {
      const group = await repo.getById('groups', req.params.id);
      if (!await canAccessGroup(req, group)) return res.status(404).json({ error: 'Group not found' });
      const canSeeRoster = isGroupMember(req, group) || isGroupLeaderOrAbove(req, group);
      let members = [];
      if (canSeeRoster && group.memberIds.length) {
        const all = await repo.getAll('members', { id: { $in: group.memberIds }, chapterId: group.chapterId });
        members = all.map((m) => ({ id: m.id, name: m.name, profileImageFileId: m.profileImageFileId }));
      }
      const { memberIds, ...safe } = group;
      res.json({ ...safe, memberCount: memberIds.length, members, isMember: isGroupMember(req, group), isLeader: isGroupLeaderOrAbove(req, group) });
    } catch (e) { res.status(500).json({ error: 'Could not load this group' }); }
  });

  app.post('/api/admin/groups', requireContentManager, async (req, res) => {
    try {
      const chapterId = await resolveChapterIdForWrite(req, req.body.chapterId);
      if (!chapterId) return res.status(400).json({ error: 'A chapter is required.' });
      const { name, type, description, linkedDepartmentId, leaderMemberId, meetingDay, meetingTime, meetingLocation } = req.body;
      if (!name) return res.status(400).json({ error: 'A name is required' });
      let leaderName = '';
      if (leaderMemberId) {
        const leader = await repo.getById('members', leaderMemberId, { chapterId });
        leaderName = leader ? leader.name : '';
      }
      const group = await repo.create('groups', {
        chapterId, name, type: ['bible_study', 'prayer', 'fellowship', 'department', 'cell', 'other'].includes(type) ? type : 'other',
        description: description || '', linkedDepartmentId: linkedDepartmentId || '', leaderMemberId: leaderMemberId || '', leaderName,
        meetingDay: meetingDay || '', meetingTime: meetingTime || '', meetingLocation: meetingLocation || '',
        memberIds: leaderMemberId ? [leaderMemberId] : [], createdBy: actorName(req)
      }, 'grp');
      res.json({ success: true, item: group });
    } catch (e) { res.status(500).json({ error: 'Could not create this group' }); }
  });

  app.put('/api/admin/groups/:id', requireContentManager, async (req, res) => {
    try {
      const filter = rolesLib.chapterFilter(req, { required: false });
      const existing = await repo.getById('groups', req.params.id, filter);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      const { chapterId, memberIds, ...body } = req.body;
      let leaderName = existing.leaderName;
      if (body.leaderMemberId !== undefined && body.leaderMemberId !== existing.leaderMemberId) {
        const leader = body.leaderMemberId ? await repo.getById('members', body.leaderMemberId, filter) : null;
        leaderName = leader ? leader.name : '';
      }
      const group = await repo.updateById('groups', req.params.id, { ...existing, ...body, leaderName }, filter);
      res.json({ success: true, item: group });
    } catch (e) { res.status(500).json({ error: 'Could not update this group' }); }
  });

  app.delete('/api/admin/groups/:id', requireContentManager, async (req, res) => {
    try {
      const filter = rolesLib.chapterFilter(req, { required: false });
      const group = await repo.getById('groups', req.params.id, filter);
      if (!group) return res.status(404).json({ error: 'Not found' });
      await repo.removeById('groups', req.params.id, filter);
      await models.GroupPost.deleteMany({ groupId: req.params.id, chapterId: group.chapterId });
      await models.GroupMeeting.deleteMany({ groupId: req.params.id, chapterId: group.chapterId });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Could not delete this group' }); }
  });

  app.put('/api/groups/:id', requireMember, async (req, res) => {
    try {
      const existing = await repo.getById('groups', req.params.id);
      if (!await canAccessGroup(req, existing)) return res.status(404).json({ error: 'Group not found' });
      if (!isGroupLeaderOrAbove(req, existing)) return res.status(403).json({ error: 'Only the group leader can edit this group.' });
      const { description, meetingDay, meetingTime, meetingLocation, resources } = req.body;
      const updated = await repo.updateById('groups', req.params.id, {
        ...existing, description: description !== undefined ? description : existing.description,
        meetingDay: meetingDay !== undefined ? meetingDay : existing.meetingDay, meetingTime: meetingTime !== undefined ? meetingTime : existing.meetingTime,
        meetingLocation: meetingLocation !== undefined ? meetingLocation : existing.meetingLocation,
        resources: Array.isArray(resources) ? resources.filter((r) => r && r.title) : existing.resources
      });
      res.json({ success: true, item: updated });
    } catch (e) { res.status(500).json({ error: 'Could not update this group' }); }
  });

  app.post('/api/groups/:id/join', requireMember, async (req, res) => {
    try {
      const group = await repo.getById('groups', req.params.id);
      if (!await canAccessGroup(req, group)) return res.status(404).json({ error: 'Group not found' });
      await models.Group.updateOne({ id: req.params.id, chapterId: group.chapterId }, { $addToSet: { memberIds: req.session.memberId } });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Could not join this group' }); }
  });

  app.post('/api/groups/:id/leave', requireMember, async (req, res) => {
    try {
      const group = await repo.getById('groups', req.params.id);
      if (!await canAccessGroup(req, group)) return res.status(404).json({ error: 'Group not found' });
      await models.Group.updateOne({ id: req.params.id, chapterId: group.chapterId }, { $pull: { memberIds: req.session.memberId } });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Could not leave this group' }); }
  });

  app.get('/api/groups/:id/posts', requireMember, async (req, res) => {
    try {
      const group = await repo.getById('groups', req.params.id);
      if (!await canAccessGroup(req, group)) return res.status(404).json({ error: 'Group not found' });
      if (!isGroupMember(req, group) && !isGroupLeaderOrAbove(req, group)) return res.status(403).json({ error: 'Join this group to see its posts.' });
      const posts = await repo.getAll('groupPosts', { groupId: req.params.id, chapterId: group.chapterId });
      posts.sort((a, b) => (b.isAnnouncement - a.isAnnouncement) || (new Date(b.createdAt) - new Date(a.createdAt)));
      res.json(posts);
    } catch (e) { res.status(500).json({ error: 'Could not load posts' }); }
  });

  app.post('/api/groups/:id/posts', requireMember, async (req, res) => {
    try {
      const group = await repo.getById('groups', req.params.id);
      if (!await canAccessGroup(req, group)) return res.status(404).json({ error: 'Group not found' });
      if (!isGroupMember(req, group) && !isGroupLeaderOrAbove(req, group)) return res.status(403).json({ error: 'Join this group to post.' });
      if (!req.body.body || !req.body.body.trim()) return res.status(400).json({ error: 'A message is required' });
      const member = await repo.getById('members', req.session.memberId);
      const post = await repo.create('groupPosts', { chapterId: group.chapterId, groupId: group.id, authorMemberId: req.session.memberId,
        authorName: member ? member.name : '', body: req.body.body.trim(), isAnnouncement: !!req.body.isAnnouncement && isGroupLeaderOrAbove(req, group) }, 'gpost');
      res.json({ success: true, item: post });
    } catch (e) { res.status(500).json({ error: 'Could not post this' }); }
  });

  app.get('/api/groups/:id/meetings', requireMember, async (req, res) => {
    try {
      const group = await repo.getById('groups', req.params.id);
      if (!await canAccessGroup(req, group)) return res.status(404).json({ error: 'Group not found' });
      if (!isGroupMember(req, group) && !isGroupLeaderOrAbove(req, group)) return res.status(403).json({ error: 'Join this group to see its meetings.' });
      const meetings = await repo.getAll('groupMeetings', { groupId: req.params.id, chapterId: group.chapterId });
      res.json(meetings.sort((a, b) => (a.date < b.date ? 1 : -1)));
    } catch (e) { res.status(500).json({ error: 'Could not load meetings' }); }
  });

  app.post('/api/groups/:id/meetings', requireMember, async (req, res) => {
    try {
      const group = await repo.getById('groups', req.params.id);
      if (!await canAccessGroup(req, group)) return res.status(404).json({ error: 'Group not found' });
      if (!isGroupLeaderOrAbove(req, group)) return res.status(403).json({ error: 'Only the group leader can log a meeting.' });
      const { date, topic, location, attendeeMemberIds, notes } = req.body;
      if (!date) return res.status(400).json({ error: 'A date is required' });
      const meeting = await repo.create('groupMeetings', { chapterId: group.chapterId, groupId: group.id, date, topic: topic || '', location: location || '',
        attendeeMemberIds: Array.isArray(attendeeMemberIds) ? attendeeMemberIds.filter((id) => group.memberIds.includes(id)) : [], notes: notes || '', recordedBy: actorName(req) }, 'gmeet');
      res.json({ success: true, item: meeting });
    } catch (e) { res.status(500).json({ error: 'Could not log this meeting' }); }
  });
}

module.exports = { registerGroupRoutes };
