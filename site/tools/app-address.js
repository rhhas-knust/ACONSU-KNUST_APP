#!/usr/bin/env node
/* ---------------------------------------------------------------------------
   Points the published site at the app's address.

   The site names the app in three places: where "Ask to be listed" sends its
   request (chapter.js) and the one outside address each page's security rule
   lets it talk to (index.html and alumni-request.html). Kept by hand, they
   would drift apart the day the app moves to a domain, and the form would
   quietly stop working. So the files here always carry the address below, and
   the publish swaps it for APP_URL, the one setting (a repository variable,
   see .github/workflows/pages.yml and docs/when-you-have-a-domain.md).

   The swap happens on the copy being published, never on the files in the
   repository, and an address that is not a plain https:// origin is refused
   rather than written into the pages.

     APP_URL   the app's address, e.g. https://app.example.org (unset: nothing changes)
     SITE_DIR  the site folder (default: the folder above this one)
   --------------------------------------------------------------------------- */
const fs = require('fs');
const path = require('path');

// What the files in the repository say. The smoke suite checks every mention
// of the app on the site is exactly this, so there is only ever one to swap.
const IN_THE_FILES = 'https://aconsu-knust-app.onrender.com';
const FILES = ['chapter.js', 'index.html', 'alumni-request.html'];

function swap(siteDir, appUrl) {
  const to = String(appUrl || '').trim().replace(/\/+$/, '');
  if (!to || to === IN_THE_FILES) return { changed: [] };
  if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/i.test(to)) {
    throw new Error(`APP_URL must be a plain address like https://app.example.org, not "${to}"`);
  }
  const changed = [];
  for (const name of FILES) {
    const file = path.join(siteDir, name);
    if (!fs.existsSync(file)) continue;
    const before = fs.readFileSync(file, 'utf8');
    const after = before.split(IN_THE_FILES).join(to);
    if (after !== before) { fs.writeFileSync(file, after); changed.push(name); }
  }
  return { changed };
}

if (require.main === module) {
  const siteDir = process.env.SITE_DIR || path.join(__dirname, '..');
  try {
    const { changed } = swap(siteDir, process.env.APP_URL);
    console.log(changed.length ? `App address set to ${process.env.APP_URL.trim()} in ${changed.join(', ')}` : 'App address unchanged');
  } catch (e) {
    console.error(`::error::${e.message}`);
    process.exit(1);
  }
}

module.exports = { swap, IN_THE_FILES, FILES };
