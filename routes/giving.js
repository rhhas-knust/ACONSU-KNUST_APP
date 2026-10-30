// Giving without an account (Phase 6), and the payment provider's side.
//
// Anyone can give: the giving page shows the chapter's own Mobile Money number
// (lib/payments, the manual way), the giver sends the money from their own
// phone, and tells us here what they sent, from which number. They get a
// receipt on screen and a link of their own to see later whether it arrived.
// Finance (or Welfare, for tithe) checks the account and confirms what
// actually arrived, as they do for members; a guest's receipt then goes to
// the number they sent from by SMS, where the chapter can send texts.
//
// The webhook route is for a provider added later. With the manual way, the
// only one there is, it answers "not found": nothing is accepted from outside.

const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const payments = require('../lib/payments');
const phoneLib = require('../lib/phone');
const sms = require('../lib/sms');
const baseUrl = require('../lib/baseUrl');

const PURPOSES = ['tithe', 'offertory', 'harvest', 'momo', 'other'];
const PURPOSE_WORDS = { tithe: 'tithe', offertory: 'offering', harvest: 'harvest gift', momo: 'gift', other: 'gift' };
const METHODS = ['momo', 'bank', 'cash', 'other'];
const NETWORKS = { mtn: 'MTN MoMo', telecel: 'Telecel Cash', airteltigo: 'AirtelTigo Money', bank: 'Bank', other: 'Other' };
const MAX_AMOUNT = 100000;
const oneLine = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const cedis = (n) => `GH₵ ${Number(n || 0).toFixed(2)}`;
// An amount in cedis as people type it ("50", "GH₵ 1,200.50"), to the
// pesewa. A minus sign is not an amount someone sent.
const amountOf = (raw) => {
  const text = String(raw == null ? '' : raw).replace(/GH₵|GHS|[\s,]/gi, '');
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const n = Math.round(Number(text) * 100) / 100;
  return n > 0 && n <= MAX_AMOUNT ? n : null;
};

// What a receipt says, to whoever holds its link: what, how much, where it
// stands. Not their number, and only their first name.
function receiptView(intent, chapter) {
  return {
    chapterName: (chapter && chapter.name) || 'ACONSU',
    firstName: String(intent.memberName || '').split(' ')[0],
    amount: intent.amount,
    amountReceived: intent.amountReceived,
    purpose: intent.purpose,
    status: intent.status,
    receivedOn: intent.receivedOn || '',
    note: intent.status === 'rejected' ? intent.reviewNotes || '' : '',
    loggedOn: intent.createdAt,
    toWelfare: intent.purpose === 'tithe'
  };
}

// A guest's receipt by SMS, once Finance or Welfare has looked: where the
// chapter can send texts and the number is a Ghanaian one. Members are told
// in the app instead.
async function tellGuest(req, intent, outcome) {
  if (!intent || intent.source !== 'guest' || !intent.receiptToken) return { sent: 0 };
  const to = phoneLib.ghanaKey(intent.payerNumber);
  if (!to || !(await sms.isConfigured(intent.chapterId))) return { sent: 0 };
  const link = `${baseUrl.forLinks(req)}/give.html?receipt=${intent.receiptToken}`;
  const what = PURPOSE_WORDS[intent.purpose] || 'gift';
  const msg = outcome === 'confirmed'
    ? `ACONSU: we received your ${cedis(intent.amountReceived || intent.amount)} ${what}. Thank you. Receipt: ${link}`
    : `ACONSU: we could not find your ${cedis(intent.amount)} ${what} in the account yet. Details: ${link}`;
  return sms.sendBatch([to], msg, `giving:${intent.id}`, intent.chapterId);
}

function registerGivingRoutes(app, deps) {
  const { repo, requireChapterAdmin, givingGoesToWelfare } = deps;

  const chapterFor = async (id) => {
    const chapter = id ? await repo.getById('chapters', String(id)) : null;
    return chapter && chapter.status === 'active' ? chapter : null;
  };
  const configured = (chapter) => {
    const p = (chapter && chapter.payment) || {};
    return !!(p.momoNumber || p.bankAccountNumber || p.welfareMomoNumber);
  };

  // Where to send it, for anyone: the chapter's Mobile Money and bank details
  // as it publishes them on its giving page, and nothing else of its settings.
  app.get('/api/giving/info', async (req, res) => {
    try {
      const chapter = await chapterFor(req.query.chapterId);
      if (!chapter) return res.status(404).json({ error: 'Choose your chapter.' });
      if (!configured(chapter)) return res.json({ configured: false, chapterName: chapter.name });
      const provider = payments.current();
      res.json({
        configured: true,
        chapterName: chapter.name,
        mode: payments.mode(),
        general: provider.createCharge({ chapter, purpose: 'offertory', toWelfare: false }),
        welfare: provider.createCharge({ chapter, purpose: 'tithe', toWelfare: true }),
        label: (chapter.payment && chapter.payment.provider) || '',
        welfarePurposes: ['tithe'],
        networks: NETWORKS
      });
    } catch (e) { res.status(500).json({ error: 'Could not load the giving details' }); }
  });

  // A few an hour from one network: a family gives on one phone, a script
  // does not fill the queue.
  const guestLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, max: Number(process.env.GIVING_GUEST_LIMIT_MAX) || 10,
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many from this network for now. Please try again in an hour, or tell Finance in person.' }
  });

  app.post('/api/giving/guest', guestLimiter, async (req, res) => {
    try {
      const b = req.body || {};
      // A form filled in by a script: thanked, nothing kept.
      if (oneLine(b.website, 200)) return res.json({ success: true, receipt: null });
      const chapter = await chapterFor(b.chapterId);
      if (!chapter) return res.status(400).json({ error: 'Choose your chapter.' });
      if (!configured(chapter)) return res.status(400).json({ error: 'This chapter has not set up giving yet.' });
      const name = oneLine(b.name, 80);
      if (name.length < 2) return res.status(400).json({ error: 'Type your name, so Finance knows whose gift it is.' });
      const amount = amountOf(b.amount);
      if (!amount) return res.status(400).json({ error: 'Type the amount you sent, in cedis.' });
      const payerNumber = oneLine(b.payerNumber, 30);
      if (!phoneLib.ghanaKey(payerNumber)) return res.status(400).json({ error: 'Type the phone number you sent it from, like 024 412 3456.' });
      if (b.consent !== true && b.consent !== 'true') return res.status(400).json({ error: 'Tick the box to say we may keep these details with your gift.' });
      const purpose = PURPOSES.includes(b.purpose) ? b.purpose : 'other';
      const intent = await repo.create('givingIntents', {
        chapterId: chapter.id, memberId: '', memberName: name, source: 'guest',
        amount, purpose,
        method: METHODS.includes(b.method) ? b.method : 'momo',
        reference: oneLine(b.reference, 60),
        payerNumber, payerNetwork: NETWORKS[b.payerNetwork] ? b.payerNetwork : '',
        receiptToken: crypto.randomBytes(18).toString('base64url'),
        provider: payments.current().name, status: 'pending'
      }, 'give');
      res.json({
        success: true,
        receipt: { token: intent.receiptToken, ...receiptView(intent, chapter) },
        nextStep: payments.current().createCharge({ chapter, purpose, toWelfare: givingGoesToWelfare(purpose), intent })
      });
    } catch (e) { res.status(500).json({ error: 'Could not record your gift. Please try again.' }); }
  });

  // A receipt, by the link given with it. The token is the only key.
  app.get('/api/giving/receipt/:token', async (req, res) => {
    try {
      const token = String(req.params.token || '');
      if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return res.status(404).json({ error: 'There is no receipt at this link.' });
      const intent = (await repo.getAll('givingIntents', repo.allChapters({ receiptToken: token })))[0];
      if (!intent) return res.status(404).json({ error: 'There is no receipt at this link.' });
      res.set('Cache-Control', 'no-store');
      res.json(receiptView(intent, await repo.getById('chapters', intent.chapterId)));
    } catch (e) { res.status(500).json({ error: 'Could not load this receipt' }); }
  });

  // The chapter admin's view of how giving is paid: the way in use, and the
  // address a provider would send its notifications to, once there is one.
  app.get('/api/admin/payments-setup', requireChapterAdmin, async (req, res) => {
    const provider = payments.current();
    const site = baseUrl.forLinks(req);
    res.json({
      provider: provider.name,
      mode: payments.mode(),
      takesWebhooks: !!provider.takesWebhooks,
      webhookUrl: provider.takesWebhooks && site ? `${site}/api/payments/webhook/${provider.name}` : '',
      problem: payments.problem(),
      liveNeeds: 'PAYMENT_MODE=live'
    });
  });

  return { tellGuest };
}

// ---------- a provider's notifications ----------
// Registered before the JSON body parser (server.js), so the signature is
// checked against the bytes exactly as they arrived.
function registerPaymentWebhook(app, deps) {
  const { repo, models, givingGoesToWelfare } = deps;
  app.post('/api/payments/webhook/:provider', express.raw({ type: '*/*', limit: '64kb' }), async (req, res) => {
    const adapter = payments.named(req.params.provider);
    if (!adapter || !adapter.takesWebhooks) return res.status(404).json({ error: 'Not found' });
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    try {
      if (!adapter.verifyWebhook({ rawBody, headers: req.headers })) return res.status(401).json({ error: 'Signature does not match' });
      const ev = adapter.parseEvent({ rawBody, headers: req.headers });
      if (!ev || !ev.providerRef) return res.status(400).json({ error: 'Not a payment notification' });
      const intent = (await repo.getAll('givingIntents', repo.allChapters({ provider: adapter.name, providerRef: String(ev.providerRef) })))[0];
      // A reference this app never handed out is not ours to record.
      if (!intent) return res.status(404).json({ error: 'Unknown reference' });
      if (ev.chapterId && ev.chapterId !== intent.chapterId) return res.status(400).json({ error: 'Wrong chapter' });
      // Told twice (providers retry): the first time counted, this changes nothing.
      if (intent.status !== 'pending' || intent.needsReview) return res.json({ received: true, already: true });
      const scope = { chapterId: intent.chapterId };
      if (ev.status === 'failed') {
        await repo.patchById('givingIntents', intent.id, { status: 'rejected', reviewNotes: 'The payment did not go through.', reviewedBy: adapter.name }, scope);
        return res.json({ received: true });
      }
      if (ev.status !== 'paid') return res.json({ received: true });
      // The amount is the provider's, checked against what was asked; a
      // different one waits for a person rather than counting.
      if (Math.round(Number(ev.amount) * 100) !== Math.round(Number(intent.amount) * 100) || String(ev.currency || 'GHS').toUpperCase() !== 'GHS') {
        await repo.patchById('givingIntents', intent.id, { needsReview: true, reviewNotes: `The provider reported ${ev.currency || ''} ${ev.amount}, not ${cedis(intent.amount)}.` }, scope);
        return res.json({ received: true, needsReview: true });
      }
      if (givingGoesToWelfare(intent.purpose)) {
        // Welfare's purse: Welfare confirms it into its own book, as ever.
        await repo.patchById('givingIntents', intent.id, { reviewNotes: 'Paid online; waiting for Welfare to record it.' }, scope);
        return res.json({ received: true });
      }
      // Claimed in one step first, so two deliveries of the same notification
      // arriving together record the money once.
      const today = new Date().toISOString().slice(0, 10);
      const claimed = await models.GivingIntent.findOneAndUpdate({ id: intent.id, status: 'pending', needsReview: false }, { $set: {
        status: 'confirmed', amountReceived: intent.amount, receivedOn: today, confirmedAt: new Date(), reviewedBy: adapter.name
      } }, { new: true });
      if (!claimed) return res.json({ received: true, already: true });
      // Money in waits as pending for a person to approve (the dual-control
      // rule): an online payment is no different.
      const entry = await repo.create('financeEntries', {
        chapterId: intent.chapterId, entryType: 'income', category: intent.purpose, amount: intent.amount, date: today,
        description: `Paid online, ${intent.memberName}`, method: 'momo', reference: String(ev.providerRef), payee: intent.memberName,
        approvalStatus: 'pending', source: 'online', recordedBy: adapter.name
      }, 'fin');
      await models.GivingIntent.updateOne({ id: intent.id }, { $set: { matchedFinanceEntryId: entry.id } });
      res.json({ received: true });
    } catch (e) { res.status(500).json({ error: 'Could not record this notification' }); }
  });
}

module.exports = { registerGivingRoutes, registerPaymentWebhook, tellGuest, receiptView, amountOf, NETWORKS };
