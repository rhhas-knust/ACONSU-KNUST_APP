// How giving is paid (BUILD_PROMPT_OPUS item 3). One small interface, so a
// provider can be added later without touching the giving screens:
//
//   createCharge({ chapter, purpose, toWelfare, intent })
//       what the giver does next: instructions (manual), or a provider's own
//       payment page later
//   verifyWebhook({ rawBody, headers })   true only for a genuine message
//   parseEvent({ rawBody, headers })      { providerRef, status: 'paid'|'failed',
//                                           amount, currency, chapterId }
//
// Chosen by PAYMENT_PROVIDER (default and, for now, only: manual). A provider
// other than manual runs as a sandbox unless PAYMENT_MODE=live is set on
// purpose. Its secrets come from the environment only, and are never logged
// or sent to a browser.

const manual = require('./manual');

const providers = new Map([[manual.name, manual]]);

// For a provider added later, and for the tests' stand-in.
function register(adapter) {
  if (!adapter || !adapter.name) throw new Error('A payment provider needs a name');
  providers.set(adapter.name, adapter);
}

function current(env = process.env) {
  const wanted = String(env.PAYMENT_PROVIDER || 'manual').trim().toLowerCase();
  return providers.get(wanted) || manual;
}

function named(name) {
  return providers.get(String(name || '').toLowerCase()) || null;
}

function mode(env = process.env) {
  const p = current(env);
  if (p.name === 'manual') return 'manual';
  return String(env.PAYMENT_MODE || '').trim().toLowerCase() === 'live' ? 'live' : 'sandbox';
}

// Said once at start-up when the setting names a provider this app does not have.
function problem(env = process.env) {
  const wanted = String(env.PAYMENT_PROVIDER || '').trim().toLowerCase();
  return wanted && !providers.has(wanted) ? `PAYMENT_PROVIDER=${wanted} is not a provider this app has; giving stays manual.` : '';
}

module.exports = { register, current, named, mode, problem, manual };
