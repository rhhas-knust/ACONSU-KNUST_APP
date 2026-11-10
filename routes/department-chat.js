// Every department's own private discussion: its members and its head, and
// nobody else. Nobody sets it up and nobody keeps a list of who is in it. Who
// may read and post is worked out on each request from the department itself:
// the members who serve in it (their profile's departments) and whoever holds
// it (the executive whose roster card carries it). Someone who joins the
// department is in the chat; someone who leaves is out.
//
// The messages are kept with the Small Groups' posts (GroupPost), under a
// group id of their own, "dept:<department id>", so one store, one clear-out
// and one erasure (lib/eraseMember.js) cover both.
const MAX_LENGTH = 2000;
const PAGE = 200;
// What may be sent with a message: photos and PDFs, up to four at a time,
// each up to 10 MB as sent (photos are made smaller before they are kept).
const MAX_FILES = 4;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ATTACHABLE = /^(image\/(jpeg|png|gif|webp)|application\/pdf)$/;

function registerDepartmentChatRoutes(app, deps) {
  const { repo, models, requireMember, push, gridfs, upload, compressIfImage, fileTypes } = deps;
  const chatIdOf = departmentId => `dept:${departmentId}`;

  // The members who hold the department (its head, and an assistant whose card
  // carries it), through the account on their roster card.
  async function headMemberIds(chapterId, departmentId) {
    const cards = await repo.getAll('executives', { chapterId, department: departmentId });
    const staffIds = cards.map(c => c.staffId).filter(Boolean);
    if (!staffIds.length) return new Set();
    const staff = await models.StaffUser.find({ id: { $in: staffIds }, active: { $ne: false } }).lean();
    return new Set(staff.map(s => s.memberId).filter(Boolean));
  }

  function servesIn(member, departmentId) {
    return (member.departments || []).includes(departmentId) || member.department === departmentId;
  }

  // Who the signed-in member is to this department: in it, its head, or
  // neither (then the answer is no, and the same no whether the department
  // exists in another chapter or not at all).
  async function standing(req, res) {
    const member = await repo.getById('members', req.session.memberId, repo.ownRecord());
    if (!member) { res.status(401).json({ error: 'Please log in to continue' }); return null; }
    const department = await repo.getById('departments', req.params.id, { chapterId: member.chapterId || '' });
    if (!department) { res.status(404).json({ error: 'Department not found' }); return null; }
    const heads = await headMemberIds(department.chapterId, department.id);
    const isHead = heads.has(member.id);
    if (!isHead && !servesIn(member, department.id)) {
      res.status(403).json({ error: `The ${department.name} chat is for the department's members. Ask to join it from the Departments page.` });
      return null;
    }
    return { member, department, isHead, heads };
  }

  async function everyoneIn(department, heads) {
    const members = await repo.getAll('members', {
      chapterId: department.chapterId,
      $or: [{ departments: department.id }, { department: department.id }]
    });
    return [...new Set([...members.map(m => m.id), ...heads])];
  }

  // Whether a member may open a file sent in this department's chat: the
  // same people who may read the chat (canOpenPrivateFile in server.js).
  async function mayOpenFile(memberId, chapterId, departmentId) {
    if (!memberId || !departmentId) return false;
    const member = await repo.getById('members', memberId, repo.ownRecord());
    if (!member || (member.chapterId || '') !== (chapterId || '')) return false;
    if (servesIn(member, departmentId)) return true;
    return (await headMemberIds(chapterId, departmentId)).has(memberId);
  }

  // The files sent with a message, checked by what they are rather than what
  // they were called, and stored before the message is.
  async function keepFiles(files, department, member) {
    const kept = [];
    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) throw Object.assign(new Error(`"${f.originalname}" is over 10 MB. Send a smaller one.`), { status: 400 });
      const type = fileTypes.sniff(f.buffer);
      if (!ATTACHABLE.test(type)) throw Object.assign(new Error(`"${f.originalname}" is not a photo or a PDF.`), { status: 400 });
    }
    for (const f of files) {
      const { buffer, contentType } = await compressIfImage(f.buffer, fileTypes.sniff(f.buffer));
      const name = String(f.originalname || 'file').replace(/[\\/\r\n]+/g, ' ').slice(0, 120);
      const fileId = String(await gridfs.uploadBuffer(buffer, name, {
        category: 'department-chat', chapterId: department.chapterId, targetId: department.id,
        uploadedBy: member.id, contentType
      }));
      kept.push({ fileId, name, contentType: fileTypes.sniff(buffer) || contentType, size: buffer.length });
    }
    return kept;
  }
  const dropFiles = (attachments) => Promise.all((attachments || []).map(a => gridfs.deleteFile(a.fileId).catch(() => {})));

  const shape = (post, viewer, isHead) => ({
    id: post.id,
    parentId: post.parentId || '',
    authorMemberId: post.authorMemberId,
    authorName: post.authorName || 'A member',
    authorRole: post.authorRole || '',
    body: post.body || '',
    attachments: (post.attachments || []).map(a => ({ fileId: a.fileId, name: a.name, contentType: a.contentType, size: a.size })),
    pinned: !!post.pinned,
    createdAt: post.createdAt,
    canRemove: isHead || post.authorMemberId === viewer.id
  });

  app.get('/api/departments/:id/chat', requireMember, async (req, res) => {
    try {
      const who = await standing(req, res);
      if (!who) return;
      const { member, department, isHead } = who;
      const posts = await repo.getAll('groupPosts', { chapterId: department.chapterId, groupId: chatIdOf(department.id) });
      const byTime = (a, b) => new Date(a.createdAt) - new Date(b.createdAt);
      const replies = posts.filter(p => p.parentId).sort(byTime);
      // Newest conversation first, the head's pinned ones above everything.
      const threads = posts
        .filter(p => !p.parentId)
        .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || byTime(b, a))
        .slice(0, PAGE)
        .map(p => ({
          ...shape(p, member, isHead),
          replies: replies.filter(r => r.parentId === p.id).map(r => shape(r, member, isHead))
        }));
      res.json({
        department: { id: department.id, name: department.name },
        isHead,
        canPost: !member.chatRestricted,
        threads
      });
    } catch (e) {
      res.status(500).json({ error: 'Could not load the department chat' });
    }
  });

  app.post('/api/departments/:id/chat', requireMember, ...upload.array('files', MAX_FILES), async (req, res) => {
    let attachments = [];
    try {
      const who = await standing(req, res);
      if (!who) return;
      const { member, department, isHead, heads } = who;
      if (member.chatRestricted) return res.status(403).json({ error: 'Your posting privileges have been restricted. Contact your Chapter Admin.' });
      const body = String((req.body && req.body.body) || '').trim();
      const files = req.files || [];
      if (!body && !files.length) return res.status(400).json({ error: 'Write a message or add a photo or PDF first.' });
      if (body.length > MAX_LENGTH) return res.status(400).json({ error: `Keep it under ${MAX_LENGTH} characters.` });
      const parentId = String((req.body && req.body.parentId) || '');
      let parent = null;
      if (parentId) {
        parent = await repo.getById('groupPosts', parentId, { chapterId: department.chapterId, groupId: chatIdOf(department.id) });
        if (!parent || parent.parentId) return res.status(404).json({ error: 'That message is no longer here.' });
      }
      attachments = await keepFiles(files, department, member);
      const post = await repo.create('groupPosts', {
        chapterId: department.chapterId,
        groupId: chatIdOf(department.id),
        parentId: parent ? parent.id : '',
        authorMemberId: member.id,
        authorName: member.name || '',
        authorRole: isHead ? 'Head' : '',
        body,
        attachments,
        pinned: false
      }, 'gpost');

      // A new message reaches everyone in the department; a reply reaches the
      // people already in that conversation. Never the person who wrote it.
      let audience;
      if (parent) {
        const thread = await repo.getAll('groupPosts', { chapterId: department.chapterId, groupId: chatIdOf(department.id), parentId: parent.id });
        audience = [parent.authorMemberId, ...thread.map(p => p.authorMemberId)];
      } else {
        audience = await everyoneIn(department, heads);
      }
      audience = [...new Set(audience)].filter(id => id && id !== member.id);
      if (audience.length) {
        const sent = attachments.length
          ? `Sent ${attachments.length === 1 ? (attachments[0].contentType === 'application/pdf' ? 'a PDF' : 'a photo') : `${attachments.length} files`}`
          : '';
        const text = body || sent;
        push.sendPushToAll({
          title: `${department.name}: ${member.name || 'New message'}`,
          body: text.length > 140 ? `${text.slice(0, 137)}...` : text,
          url: `/department.html?id=${encodeURIComponent(department.id)}#chat`
        }, department.chapterId, audience).catch(() => {});
      }
      res.json({ success: true, item: shape(post, member, isHead), reached: audience.length });
    } catch (e) {
      await dropFiles(attachments);
      if (e && e.status === 400) return res.status(400).json({ error: e.message });
      res.status(500).json({ error: 'Could not send that' });
    }
  });

  app.post('/api/departments/:id/chat/:postId/pin', requireMember, async (req, res) => {
    try {
      const who = await standing(req, res);
      if (!who) return;
      if (!who.isHead) return res.status(403).json({ error: 'Only the department head pins messages.' });
      const scope = { chapterId: who.department.chapterId, groupId: chatIdOf(who.department.id) };
      const post = await repo.getById('groupPosts', req.params.postId, scope);
      if (!post || post.parentId) return res.status(404).json({ error: 'That message is no longer here.' });
      const pinned = !(req.body && req.body.pinned === false);
      await repo.patchById('groupPosts', post.id, { pinned }, scope);
      res.json({ success: true, pinned });
    } catch (e) {
      res.status(500).json({ error: 'Could not pin that' });
    }
  });

  app.delete('/api/departments/:id/chat/:postId', requireMember, async (req, res) => {
    try {
      const who = await standing(req, res);
      if (!who) return;
      const scope = { chapterId: who.department.chapterId, groupId: chatIdOf(who.department.id) };
      const post = await repo.getById('groupPosts', req.params.postId, scope);
      if (!post) return res.status(404).json({ error: 'That message is no longer here.' });
      if (!who.isHead && post.authorMemberId !== who.member.id) {
        return res.status(403).json({ error: 'Only the person who wrote it, or the department head, can remove it.' });
      }
      // A conversation goes with its replies, and a message with its files.
      if (!post.parentId) {
        const replies = await repo.getAll('groupPosts', { ...scope, parentId: post.id });
        for (const r of replies) {
          await repo.removeById('groupPosts', r.id, scope);
          await dropFiles(r.attachments);
        }
      }
      await repo.removeById('groupPosts', post.id, scope);
      await dropFiles(post.attachments);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Could not remove that' });
    }
  });

  return { mayOpenFile };
}

module.exports = { registerDepartmentChatRoutes, MAX_LENGTH, MAX_FILES, MAX_FILE_BYTES };
