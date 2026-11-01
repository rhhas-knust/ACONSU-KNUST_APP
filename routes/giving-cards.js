// Giving cards (lib/givingCards.js): Finance sees a card for everyone who
// gives to the treasury, Welfare one for everyone who gives tithe, a member
// their own, and someone without an account theirs through their receipt
// link. Offerings are on none of them.

const repo = require('../lib/repo');
const phoneLib = require('../lib/phone');
const givingCards = require('../lib/givingCards');

// Finance's purposes are every one but tithe (Welfare's purse) and the
// offering (nobody's own).
const WELFARE_PURPOSES = ['tithe'];
const FINANCE_PURPOSES = ['harvest', 'momo', 'other'];

function registerGivingCardRoutes(app, deps) {
  const { rolesLib, requireMember, requireViewRole, requireWelfareOfficer } = deps;

  const chapterCards = (purposes) => async (req, res) => {
    try {
      const intents = await repo.getAll('givingIntents', rolesLib.chapterFilter(req));
      res.set('Cache-Control', 'no-store');
      res.json({ cards: givingCards.buildCards(intents, { purposes }) });
    } catch (e) {
      res.status(500).json({ error: 'Could not load the giving cards' });
    }
  };
  app.get('/api/finance/giving-cards', requireViewRole('finance'), chapterCards(FINANCE_PURPOSES));
  app.get('/api/welfare/giving-cards', requireWelfareOfficer, chapterCards(WELFARE_PURPOSES));

  // A member's own card: everything they have given, tithe included.
  app.get('/api/giving/my-card', requireMember, async (req, res) => {
    try {
      const intents = await repo.getAll('givingIntents', repo.ownRecord({ memberId: req.session.memberId }));
      res.set('Cache-Control', 'no-store');
      res.json(givingCards.ownCard(intents));
    } catch (e) {
      res.status(500).json({ error: 'Could not load your giving card' });
    }
  });

  // Someone without an account: their receipt link opens their card too,
  // every gift sent from the same number to the same chapter. Only their
  // first name, and never the number itself.
  app.get('/api/giving/receipt/:token/card', async (req, res) => {
    try {
      const token = String(req.params.token || '');
      if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return res.status(404).json({ error: 'There is no receipt at this link.' });
      const intent = (await repo.getAll('givingIntents', repo.allChapters({ receiptToken: token })))[0];
      if (!intent) return res.status(404).json({ error: 'There is no receipt at this link.' });
      const phone = phoneLib.ghanaKey(intent.payerNumber);
      const same = phone
        ? (await repo.getAll('givingIntents', { chapterId: intent.chapterId, source: 'guest' })).filter((i) => phoneLib.ghanaKey(i.payerNumber) === phone)
        : [intent];
      const card = givingCards.ownCard(same);
      card.name = String(intent.memberName || '').split(' ')[0];
      res.set('Cache-Control', 'no-store');
      res.json(card);
    } catch (e) {
      res.status(500).json({ error: 'Could not load this giving card' });
    }
  });
}

module.exports = { registerGivingCardRoutes, FINANCE_PURPOSES, WELFARE_PURPOSES };
