// The code checker: `npm run lint`, and a CI step. It looks for mistakes
// (a name used but never defined, a variable that is never read, a function
// defined twice), not for style: no rule here is about spaces, quotes or
// semicolons, and none should be added.
const fs = require('fs');
const path = require('path');
const js = require('@eslint/js');
const globals = require('globals');

// The page scripts in public/js share one global scope: main.js and portal.js
// define helpers (escapeHtml, fetchJSON, statCard...) that every page uses,
// and each office script defines one object (OfficeBooks...). Read their
// names from the files themselves, so a new helper needs no edit here.
const PAGE_DIR = path.join(__dirname, 'public', 'js');
const pageGlobals = {};
for (const file of fs.readdirSync(PAGE_DIR).filter(f => f.endsWith('.js'))) {
  const text = fs.readFileSync(path.join(PAGE_DIR, file), 'utf8');
  for (const m of text.matchAll(/^(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) pageGlobals[m[1]] = 'writable';
  for (const m of text.matchAll(/^\s*window\.([A-Za-z_$][\w$]*)\s*=/gm)) pageGlobals[m[1]] = 'writable';
}

module.exports = [
  {
    ignores: ['node_modules/**', 'android/**', 'ios/**', 'docs/**', 'design/**', 'site/images/**', 'site/data/**']
  },
  js.configs.recommended,
  {
    rules: {
      // An empty catch is how this app says "never let this break the request".
      'no-empty': ['error', { allowEmptyCatch: true }],
      // An unused argument is often the shape of an Express handler, and
      // `const { passwordHash, ...safe } = member` is how a field is left out.
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      // Control characters are stripped from what people type on purpose.
      'no-control-regex': 'off',
      // Tidiness, not a mistake: `let rows = []` overwritten in a try.
      'no-useless-assignment': 'off'
    }
  },
  {
    // The server, its tests and its tools: Node, CommonJS.
    files: ['*.js', 'lib/**/*.js', 'routes/**/*.js', 'test/**/*.js', 'site/tools/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: { ...globals.node } }
  },
  {
    // The browser checks hand functions to the page to run there.
    files: ['test/ux.js', 'test/*-ui.js'],
    languageOptions: { globals: { ...globals.browser } }
  },
  {
    // The pages: plain scripts in the browser, sharing one global scope, so a
    // top-level name in one is used by another and "unused" means nothing there.
    files: ['public/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: { ...globals.browser, ...pageGlobals } },
    rules: {
      'no-unused-vars': ['error', { vars: 'local', args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-redeclare': ['error', { builtinGlobals: false }]
    }
  },
  {
    files: ['public/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } }
  },
  {
    files: ['site/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: { ...globals.browser } }
  }
];
