const webpush = require('web-push');
const models = require('./models');

const baseUrl = require('./baseUrl');

let configured = false;

// The push services want a way to reach whoever runs the app: a mailto: or an
// https: address. Neither needs a domain of our own. A bare email address is
// taken as mailto:, and with nothing set the mail sender's address or the
// app's own https address is used. web-push refuses anything else outright,
// which would switch push off for everyone, so a bad value is never passed on.
function vapidSubject(env = process.env) {
  const s = String(env.VAPID_SUBJECT || '').trim();
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(s) || /^https:\/\/[^\s]+$/i.test(s)) return s;
  if (/^[^\s@:]+@[^\s@]+\.[^\s@]+$/.test(s)) return `mailto:${s}`;
  const from = (String(env.MAIL_FROM || '').match(/[^\s<>@"]+@[^\s<>@"]+\.[^\s<>@"]+/) || [])[0];
  if (from) return `mailto:${from}`;
  const site = baseUrl.forLinks(null, { ...env, NODE_ENV: 'production' });
  if (/^https:/.test(site)) return site;
  return 'mailto:admin@example.com';
}

function ensureConfigured() {
  if (configured) return true;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return false; // push just won't fire - everything else in the app still works
  }
  try {
    webpush.setVapidDetails(vapidSubject(), VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  } catch (e) {
    console.error('Push notifications are off: the VAPID keys were not accepted (' + e.message + ').');
    return false;
  }
  configured = true;
  return true;
}

// `chapterId` (optional) narrows delivery to devices registered by members of
// that chapter - omit only for a genuinely national push (e.g. a National
// Coordinator announcement). Subscriptions from before chapters existed have
// no chapterId on file, so a chapter-scoped push can miss them until their
// owner's device re-registers (see resubscribePushIfAlreadyAllowed in
// main.js) - acceptable for a low-volume, self-healing gap.
// `memberIds` (optional) narrows delivery further, to the devices of exactly
// those members - used for a department's own announcement, which has no
// business buzzing the whole chapter's phones.
async function sendPushToAll(payload, chapterId, memberIds) {
  if (!ensureConfigured()) return { sent: 0, failed: 0, skipped: true };

  const query = chapterId ? { chapterId } : {};
  if (Array.isArray(memberIds)) {
    // An empty list means nobody, not everybody - the difference between a
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
      // 404/410 = the browser subscription no longer exists - clean it up so we stop retrying it forever.
      if (err.statusCode === 404 || err.statusCode === 410) {
        models.PushSubscription.deleteOne({ endpoint: sub.endpoint }).catch(() => {});
      }
    }
  }));

  return { sent, failed, skipped: false };
}

module.exports = { sendPushToAll, ensureConfigured, vapidSubject };
