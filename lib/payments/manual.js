// The manual way, and for now the only one (decision of 30 October 2026: no
// Paystack or other paid provider until the owner asks). Nothing is charged:
// the giver is shown the chapter's own Mobile Money number, sends the money
// from their own phone, and tells us what they sent; Finance (or Welfare, for
// tithe) checks the account and confirms what actually arrived.

const name = 'manual';

// Where to send it. Tithe goes to Welfare's own account; everything else to
// the chapter's.
function createCharge({ chapter, purpose, toWelfare }) {
  const p = (chapter && chapter.payment) || {};
  return {
    kind: 'instructions',
    momoNumber: toWelfare ? p.welfareMomoNumber || '' : p.momoNumber || '',
    momoName: toWelfare ? p.welfareMomoName || '' : p.momoName || '',
    bankName: toWelfare ? '' : p.bankName || '',
    bankAccountName: toWelfare ? '' : p.bankAccountName || '',
    bankAccountNumber: toWelfare ? '' : p.bankAccountNumber || '',
    toWelfare: !!toWelfare,
    purpose
  };
}

// No provider sends anything in the manual way, so there is nothing a
// notification could be trusted for.
const verifyWebhook = () => false;
const parseEvent = () => null;

module.exports = { name, createCharge, verifyWebhook, parseEvent, takesWebhooks: false };
