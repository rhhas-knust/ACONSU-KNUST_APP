// The browser runs only this app's own script files (Phase 7): no script
// written into a page runs, and no onclick=. Two fixed snippets are the only
// exceptions, each allowed by its exact fingerprint: the light/dark setting
// every page sets before it is drawn, and the offline page's few lines.
//
//   node test/csp.js     (also run by `npm test`)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const securityHeaders = require('../lib/securityHeaders');

let failures = 0;
function check(label, cond, detail) {
  if (cond) console.log(`  ok   ${label}`);
  else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 600)}` : ''}`); }
}
const PUB = path.join(__dirname, '..', 'public');
const pages = fs.readdirSync(PUB).filter(f => f.endsWith('.html'));
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');
const allJs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => (d.isDirectory() ? allJs(path.join(dir, d.name)) : d.name.endsWith('.js') ? [path.join(dir, d.name)] : []));
const scripts = allJs(path.join(PUB, 'js'));

console.log('\n== the policy ==');
const src = securityHeaders.CSP['script-src'];
check('scripts from this app only, and nothing written into a page', src[0] === "'self'" && !src.includes("'unsafe-inline'") && !src.some(s => /^https?:/.test(s)), src);
check('two fixed fingerprints, and no other way in', src.length === 3 && src.slice(1).every(s => /^'sha256-[A-Za-z0-9+/=]{44}'$/.test(s)), src);
check('no onclick= and the like, anywhere', JSON.stringify(securityHeaders.CSP['script-src-attr']) === `["'none'"]`);
check('nor eval', !src.includes("'unsafe-eval'"));

console.log('\n== the pages ==');
const allowed = new Set(src.slice(1).map(s => s.slice(1, -1)));
const fingerprint = (body) => `sha256-${crypto.createHash('sha256').update(body).digest('base64')}`;
const stray = [];
let themed = 0;
for (const f of pages) {
  for (const m of read(f).matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    const attrs = m[1] || '';
    if (/\bsrc=/.test(attrs) || /type="application\/(ld\+)?json"/.test(attrs)) continue;
    if (allowed.has(fingerprint(m[2]))) { if (m[2].includes('aconsu.theme')) themed += 1; continue; }
    stray.push(`${f}: ${m[2].trim().slice(0, 60)}`);
  }
}
check('every script written into a page is one of the two allowed, word for word', stray.length === 0, stray);
check(`and every page sets light or dark before it is drawn (${themed} of ${pages.length})`, themed === pages.length, themed);
const handlers = [];
const HANDLER = /<[a-z][^>]*\son[a-z]+\s*=\s*["']/i;
for (const f of pages) if (HANDLER.test(read(f))) handlers.push(f);
for (const f of scripts) {
  const text = fs.readFileSync(f, 'utf8');
  // An onclick= inside markup a script builds is refused just the same.
  if (/<[a-z][^<>`]*\son[a-z]+=\\?["']/i.test(text)) handlers.push(path.relative(PUB, f));
}
check('no onclick= (or any on...=) in a page or in markup a script builds', handlers.length === 0, handlers);
const jsUrls = [...pages.map(read), ...scripts.map(f => fs.readFileSync(f, 'utf8'))].filter(t => /href=["']javascript:/i.test(t)).length;
check('and no javascript: links', jsUrls === 0);

console.log('\n== each page\'s own script ==');
const pageScripts = fs.readdirSync(path.join(PUB, 'js', 'pages')).filter(f => f.endsWith('.js'));
const referenced = new Set(pages.flatMap(f => [...read(f).matchAll(/<script src="\/js\/pages\/([\w-]+\.js)"><\/script>/g)].map(m => m[1])));
check(`all ${pageScripts.length} are loaded by a page`, pageScripts.every(f => referenced.has(f)), pageScripts.filter(f => !referenced.has(f)));
check('and every one a page asks for is there', [...referenced].every(f => pageScripts.includes(f)), [...referenced].filter(f => !pageScripts.includes(f)));
const sw = read('sw.js');
const shell = [...sw.slice(sw.indexOf('const APP_SHELL'), sw.indexOf('];', sw.indexOf('const APP_SHELL'))).matchAll(/'\/([\w-]+\.html)'/g)].map(m => m[1]);
const offlineMissing = shell.flatMap(f => [...read(f).matchAll(/<script src="(\/js\/pages\/[\w-]+\.js)"><\/script>/g)].map(m => m[1])).filter(s => !sw.includes(`'${s}'`));
check('the pages kept for offline use have their scripts kept too', offlineMissing.length === 0, offlineMissing);
check('the offline page needs nothing it could not load', !/<script[^>]+src=/.test(read('offline.html')));

console.log(failures ? `\n${failures} FAILURES` : '\nall security policy checks passed');
process.exit(failures ? 1 : 0);
