// Sending something twice does it once (Phase 7, the offline outbox).
//
// A phone at the door, or someone sending a prayer request on a weak signal,
// queues what it could not send and sends it again when the signal is back
// (public/js/outbox-core.js). It may send the same thing twice: the first try
// reached the server, but the answer was lost on the way back. So each queued
// request carries an Idempotency-Key, made once on the phone; the first answer
// to it is kept for a day and given again, word for word, for the same key,
// without doing the work a second time.
//
// The key is kept per person (signed-in member, leader, or nobody), method and
// path, so one person's key can never return another's answer. Without the
// header a request is handled as it always was.

const crypto = require('crypto');
const models = require('./models');

const KEY = /^[A-Za-z0-9_-]{8,80}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function whoIs(req) {
  const s = req.session || {};
  if (s.memberId) return `m:${s.memberId}`;
  if (s.staff && s.staff.id) return `s:${s.staff.id}`;
  if (s.isAdmin) return 'admin';
  return 'anyone';
}

function idempotent() {
  return async function idempotency(req, res, next) {
    const raw = req.get('Idempotency-Key');
    if (!raw) return next();
    if (!KEY.test(raw)) return res.status(400).json({ error: 'That request has a key the server cannot use.' });
    const id = crypto.createHash('sha256').update(`${whoIs(req)}|${req.method}|${req.baseUrl || ''}${req.path}|${raw}`).digest('hex');
    try {
      await models.IdempotencyKey.create({ id, state: 'working', expireAt: new Date(Date.now() + DAY_MS) });
    } catch (e) {
      if (!(e && (e.code === 11000 || /duplicate key/i.test(e.message || '')))) return next(e);
      const prior = await models.IdempotencyKey.findOne({ id }).lean();
      if (prior && prior.state === 'done') {
        res.set('Idempotent-Replay', 'true');
        return res.status(prior.status || 200).json(prior.body);
      }
      // The first try is still being handled: the outbox tries again shortly.
      return res.status(409).json({ error: 'Already being sent. It will finish in a moment.', retry: true });
    }
    // The answer is kept as it is sent. A server error is not kept, so the
    // same key can be tried again and do the work then.
    const send = res.json.bind(res);
    res.json = (body) => {
      const status = res.statusCode || 200;
      const keep = status < 500
        ? models.IdempotencyKey.findOneAndUpdate({ id }, { $set: { state: 'done', status, body } })
        : models.IdempotencyKey.deleteOne({ id });
      Promise.resolve(keep).catch(() => {});
      return send(body);
    };
    return next();
  };
}

module.exports = { idempotent, KEY };
