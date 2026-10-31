// Notifications: the helper every part of the app uses to tell people
// something (saved for the in-app feed, and pushed to subscribed devices),
// the feed itself, push subscriptions, and the main admin's notification.
// Moved out of server.js (Phase 7) unchanged.

const repo = require('../lib/repo');
const push = require('../lib/push');

// ---------- notifications helper ----------
// Saves a notification for the in-app feed AND fires a real push to every
// subscribed device. Used both by the manual admin route and automatic
// triggers (new event, new sermon, birthdays).
// `chapterId` blank = national broadcast, visible in every chapter's feed -
// pass a real chapter id to keep an announcement inside one chapter.
// `audience` (optional) confines an announcement to one department:
// { departmentId, memberIds }. Without it this is a chapter-wide notice, which
// is what every caller but the department announcement wants.
async function createNotification(title, body, url, source, chapterId, audience) {
  const departmentId = (audience && audience.departmentId) || '';
  const notif = await repo.create('notifications', {
    chapterId: chapterId || '', title, body, url: url || '/index.html',
    source: source || 'admin', departmentId
  }, 'notif');
  push.sendPushToAll(
    { title, body, url: url || '/index.html' },
    chapterId,
    audience ? (audience.memberIds || []) : undefined
  ).catch(() => {});
  return notif;
}

function registerNotificationFeed(app, deps) {
  const { contentChapterFilter, memberDepartmentIds } = deps;

  app.get('/api/notifications', async (req, res) => {
    try {
      const base = contentChapterFilter(req);
      // Always include national broadcasts (blank chapterId) alongside this
      // chapter's own - a national announcement should reach every chapter.
      const filter = base.chapterId ? { $or: [{ chapterId: base.chapterId }, { chapterId: '' }] } : base;

      // A department's own announcement belongs to that department. Everyone
      // else in the chapter is simply not its audience, so it is filtered out
      // before the cut rather than shown to people it was never addressed to.
      // Someone serving in Choir and Ushering is the audience for both, so this
      // asks whether the notice belongs to any department they are in - reading
      // a single field here would have shown them only their primary one.
      let ownDepartments = [];
      if (req.session && req.session.memberId) {
        const me = await repo.getById('members', req.session.memberId, repo.ownRecord());
        ownDepartments = memberDepartmentIds(me);
      }
      const audience = { $or: [
        { departmentId: '' }, { departmentId: null }, { departmentId: { $exists: false } },
        ...(ownDepartments.length ? [{ departmentId: { $in: ownDepartments } }] : [])
      ] };

      // The database orders them and keeps the newest 40. This is asked for on
      // every page by everybody, so it must not read every notification there
      // has ever been in order to show forty.
      const items = await repo.getAll('notifications', { $and: [filter, audience] }, { sort: { createdAt: -1 }, limit: 40 });
      res.json(items);
    } catch (e) {
      res.status(500).json({ error: 'Could not load notifications' });
    }
  });
}

function registerPushRoutes(app, deps) {
  const { formLimiter, isPushEndpoint, requireAdmin, models } = deps;

  app.get('/api/push/vapid-public-key', (req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
  });

  app.post('/api/push/subscribe', formLimiter, async (req, res) => {
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
    // The server later POSTs to this address, so it must be a browser vendor's push
    // service and nothing else (see isPushEndpoint).
    if (!isPushEndpoint(subscription.endpoint)) return res.status(400).json({ error: 'Invalid subscription' });
    try {
      const existing = await models.PushSubscription.findOne({ endpoint: subscription.endpoint });
      if (existing) return res.json({ success: true }); // already subscribed on this device
      const memberId = (req.session && req.session.memberId) || '';
      // Denormalized so a chapter-scoped push send doesn't need to join through
      // Member every time - see lib/push.js.
      const owner = memberId ? await repo.getById('members', memberId, repo.ownRecord()) : null;
      await repo.create('pushSubscriptions', {
        endpoint: subscription.endpoint,
        keys: subscription.keys || {},
        memberId,
        chapterId: (owner && owner.chapterId) || ''
      }, 'push');
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Could not save subscription' });
    }
  });

  app.post('/api/push/unsubscribe', formLimiter, async (req, res) => {
    const { endpoint } = req.body;
    if (typeof endpoint !== 'string' || !endpoint) return res.status(400).json({ error: 'Endpoint required' });
    try {
      await models.PushSubscription.deleteOne({ endpoint });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Could not remove subscription' });
    }
  });

  app.post('/api/admin/notifications', requireAdmin, async (req, res) => {
    const { title, body, url } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'Title and message are required' });
    try {
      const notif = await createNotification(title, body, url, 'admin');
      res.json({ success: true, item: notif });
    } catch (e) {
      res.status(500).json({ error: 'Could not send notification' });
    }
  });
}

module.exports = { createNotification, registerNotificationFeed, registerPushRoutes };
