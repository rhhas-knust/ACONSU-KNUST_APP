// A giving card: one for each person who gives, with every gift of theirs on
// it, totalled by purpose and by year.
//
// Offerings (offertory) are never on a card: they are the congregation's,
// given together on a Sunday, not one person's. A claim Finance or Welfare
// turned down is not on one either. A confirmed gift counts at what the
// account actually received; one still waiting for Finance or Welfare is on
// the card too, marked as waiting, at what the giver said they sent.
//
// A member's gifts are theirs by account. Someone without an account is known
// by the number they sent from (lib/phone.js), so every gift from that number
// is one card; with no usable number, by the name they gave.

const phoneLib = require('./phone');

const OFFERING = 'offertory';
const PURPOSE_LABELS = { tithe: 'Tithe', harvest: 'Harvest', momo: 'Giving', other: 'Other giving', offertory: 'Offering' };

const dayOf = (v) => {
  if (!v) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};
const round = (n) => Math.round(Number(n || 0) * 100) / 100;
const nameKey = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Who a gift belongs to: their account, else the number they sent from, else
// their name.
function giverKey(intent) {
  if (intent.memberId) return `member:${intent.memberId}`;
  const phone = phoneLib.ghanaKey(intent.payerNumber);
  if (phone) return `phone:${phone}`;
  return `name:${nameKey(intent.memberName)}`;
}

// Whether a gift belongs on a card at all.
const onACard = (intent) => intent && intent.purpose !== OFFERING && (intent.status === 'confirmed' || intent.status === 'pending');

function giftOf(intent) {
  const confirmed = intent.status === 'confirmed';
  return {
    id: intent.id,
    purpose: intent.purpose,
    purposeLabel: PURPOSE_LABELS[intent.purpose] || intent.purpose,
    status: confirmed ? 'confirmed' : 'waiting',
    amount: round(confirmed && intent.amountReceived != null ? intent.amountReceived : intent.amount),
    date: confirmed ? (dayOf(intent.receivedOn) || dayOf(intent.confirmedAt) || dayOf(intent.createdAt)) : dayOf(intent.createdAt),
    method: intent.method || ''
  };
}

// Every card from a set of giving claims. `purposes`, when given, keeps only
// those (Finance's own, or Welfare's tithe).
function buildCards(intents, { purposes } = {}) {
  const cards = new Map();
  for (const intent of intents || []) {
    if (!onACard(intent)) continue;
    if (purposes && !purposes.includes(intent.purpose)) continue;
    const key = giverKey(intent);
    let card = cards.get(key);
    if (!card) {
      card = {
        key,
        name: '',
        memberId: intent.memberId || '',
        source: intent.memberId ? 'member' : 'guest',
        phone: '',
        gifts: [],
        totals: { confirmed: 0, waiting: 0 },
        byPurpose: {},
        byYear: {}
      };
      cards.set(key, card);
    }
    const gift = giftOf(intent);
    card.gifts.push(gift);
    // The name and number they gave most recently.
    if (!card.latest || new Date(intent.createdAt) >= card.latest) {
      card.latest = new Date(intent.createdAt);
      card.name = String(intent.memberName || '').trim() || card.name;
      card.phone = intent.payerNumber || card.phone;
    }
    if (gift.status === 'confirmed') {
      card.totals.confirmed = round(card.totals.confirmed + gift.amount);
      card.byPurpose[gift.purpose] = round((card.byPurpose[gift.purpose] || 0) + gift.amount);
      const year = gift.date.slice(0, 4);
      if (year) card.byYear[year] = round((card.byYear[year] || 0) + gift.amount);
    } else {
      card.totals.waiting = round(card.totals.waiting + gift.amount);
    }
  }
  return [...cards.values()].map((card) => {
    const { latest, ...rest } = card;
    rest.gifts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    rest.lastGift = rest.gifts.length ? rest.gifts[0].date : '';
    rest.count = rest.gifts.length;
    rest.byPurpose = Object.entries(rest.byPurpose).map(([purpose, total]) => ({ purpose, label: PURPOSE_LABELS[purpose] || purpose, total }));
    rest.byYear = Object.entries(rest.byYear).sort((a, b) => b[0].localeCompare(a[0])).map(([year, total]) => ({ year, total }));
    return rest;
  }).sort((a, b) => b.totals.confirmed - a.totals.confirmed || a.name.localeCompare(b.name));
}

// The one card a giver sees of their own: nobody else's details, and no
// phone number (they know it).
function ownCard(intents, opts) {
  const [card] = buildCards(intents, opts);
  if (!card) return { name: '', gifts: [], totals: { confirmed: 0, waiting: 0 }, byPurpose: [], byYear: [], count: 0, lastGift: '' };
  const { phone, key, memberId, ...own } = card;
  return own;
}

module.exports = { OFFERING, PURPOSE_LABELS, giverKey, onACard, buildCards, ownCard };
