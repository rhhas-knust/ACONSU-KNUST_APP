const webpush = require('web-push');
const models = require('./models');

let configured = false;

function ensureConfigured() {
  if (configured) return true;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return false; // push just won't fire — everything else in the app still works
  }
  webpush.setVapidDetails(
    VAPID_SUBJECT || 'mailto:admin@example.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
  configured = true;
  return true;
}

// `chapterId` (optional) narrows delivery to devices registered by members of
// that chapter — omit only for a genuinely national push (e.g. a National
// Coordinator announcement). Subscriptions from before chapters existed have
// no chapterId on file, so a chapter-scoped push can miss them until their
// owner's device re-registers (see resubscribePushIfAlreadyAllowed in
// main.js) — acceptable for a low-volume, self-healing gap.
// `memberIds` (optional) narrows delivery further, to the devices of exactly
// those members — used for a department's own announcement, which has no
// business buzzing the whole chapter's phones.
async function sendPushToAll(payload, chapterId, memberIds) {
  if (!ensureConfigured()) return { sent: 0, failed: 0, skipped: true };

  const query = chapterId ? { chapterId } : {};
  if (Array.isArray(memberIds)) {
    // An empty list means nobody, not everybody — the difference between a
    // department with no members reachable and a chapter-wide broadcast.
    if (!memberIds.length) return { sent: 0, failed: 0, skipped: false };
    query.memberId = { $in: memberIds };
  }
  const subs = await models.PushSubscription.find(query).lean();
  let sent = 0;
  let failed = 0;

  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify(payload)
      );
      sent++;
    } catch (err) {
      failed++;
      // 404/410 = the browser subscription no longer exists — clean it up so we stop retrying it forever.
      if (err.statusCode === 404 || err.statusCode === 410) {
        models.PushSubscription.deleteOne({ endpoint: sub.endpoint }).catch(() => {});
      }
    }
  }));

  return { sent, failed, skipped: false };
}

module.exports = { sendPushToAll, ensureConfigured };
