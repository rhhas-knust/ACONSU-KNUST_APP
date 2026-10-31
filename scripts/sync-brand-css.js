// Writes the default brand palette (lib/brand.js) into the two token blocks at
// the top of public/css/style.css, so the stylesheet looks right on its own when
// /theme.css has not loaded. Run it after changing DEFAULT_BRAND:
//
//   node scripts/sync-brand-css.js          (rewrite)
//   node scripts/sync-brand-css.js --check  (exit 1 if out of date; test/brand.js does this)
const fs = require('fs');
const path = require('path');
const brand = require('../lib/brand');

const FILE = path.join(__dirname, '..', 'public', 'css', 'style.css');

function sync(css) {
  const p = brand.paletteFor(brand.DEFAULT_BRAND);
  const lightStart = css.indexOf(':root {');
  const darkStart = css.indexOf(':root[data-theme="dark"] {');
  if (lightStart < 0 || darkStart < 0) throw new Error('style.css token blocks not found');
  const lightEnd = css.indexOf('\n}', lightStart);
  const darkEnd = css.indexOf('\n}', darkStart);
  const apply = (blockText, tokens) => {
    let out = blockText;
    for (const [name, value] of Object.entries(tokens)) {
      const re = new RegExp(`(${name}:\\s*)[^;]+;`);
      if (re.test(out)) out = out.replace(re, `$1${value};`);
      else out = out.replace(/\n$/, '') + `\n  ${name}: ${value};`;
    }
    return out;
  };
  const light = apply(css.slice(lightStart, lightEnd), p.light);
  const dark = apply(css.slice(darkStart, darkEnd), p.dark);
  return css.slice(0, lightStart) + light + css.slice(lightEnd, darkStart) + dark + css.slice(darkEnd);
}

if (require.main === module) {
  const current = fs.readFileSync(FILE, 'utf8');
  const next = sync(current);
  if (process.argv.includes('--check')) process.exit(next === current ? 0 : 1);
  fs.writeFileSync(FILE, next);
  console.log(next === current ? 'style.css already matches the default brand.' : 'style.css updated.');
}
module.exports = { sync };
