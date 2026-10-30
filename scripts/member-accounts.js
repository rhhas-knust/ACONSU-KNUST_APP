#!/usr/bin/env node
// Lets members sign up with a phone number and no email (lib/memberAccount.js).
// The app does this by itself on start; this is the same, by hand, for when
// you want to see first what it would do.
//
//   MONGODB_URI=... node scripts/member-accounts.js            (dry run: changes nothing)
//   MONGODB_URI=... node scripts/member-accounts.js --apply    (does it)
//
// Only adds: replaces the email index with one that allows accounts without
// an email, and fills in the phone key on older accounts. No record is deleted.
const mongoose = require('mongoose');
const memberAccount = require('../lib/memberAccount');

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('Set MONGODB_URI first.'); process.exit(2); }
  const apply = process.argv.includes('--apply');
  await mongoose.connect(uri);
  const out = await memberAccount.prepare({ dryRun: !apply });
  console.log(apply ? `Done: ${JSON.stringify(out)}` : 'Dry run: nothing was changed. Run again with --apply to do it.');
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
