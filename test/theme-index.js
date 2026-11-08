// The monthly theme on a database made by its first version, which allowed one
// theme record per month whatever its state. There a month holding a chapter's
// proposal took no theme from National: the save was refused as a duplicate and
// the portal said only "Could not save the theme". On start the app replaces
// that rule with the right one (one LIVE theme per month), and the save works.
//
//   node test/theme-index.js     (also run by `npm test`)
const { fakeModels } = require('./harness.js');
const themeIndex = require('../lib/themeIndex');
const life = require('../lib/churchLife');

(async () => {
  Object.assign(process.env, { MONGODB_URI: 'mongodb://stub/aconsu_theme_index', PORT: '4371', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin123', SESSION_SECRET: 'test', LOGIN_RATE_LIMIT_MAX: '300' });
  delete process.env.SHEPHERD_USERNAME;

  let failures = 0;
  function check(label, cond, detail) {
    if (cond) console.log(`  ok   ${label}`);
    else { failures++; console.log(`  FAIL ${label}${detail !== undefined ? ` - ${JSON.stringify(detail).slice(0, 500)}` : ''}`); }
  }

  // The theme collection's indexes, as MongoDB keeps them, and a create that
  // obeys them as MongoDB would.
  const Theme = fakeModels.MonthlyTheme;
  function oldDatabase(indexes, { refuseTwo } = {}) {
    const done = [];
    const collection = {
      indexes: async () => indexes.map(i => ({ ...i })),
      createIndex: async (key, opts) => {
        if (refuseTwo && indexes.some(i => i.key.month === 1)) throw new Error('Index already exists with a different name');
        done.push(['create', opts.name, JSON.stringify(opts.partialFilterExpression)]);
        indexes.push({ name: opts.name, key, unique: true, partialFilterExpression: opts.partialFilterExpression });
      },
      dropIndex: async (name) => { done.push(['drop', name]); indexes.splice(indexes.findIndex(i => i.name === name), 1); }
    };
    return { done, indexes, collection };
  }
  const realCreate = Theme.create.bind(Theme);
  let db = null;
  Theme.create = async (data) => {
    const oneAMonth = db && db.indexes.some(i => i.key.month === 1 && i.unique && !i.partialFilterExpression);
    if (oneAMonth && Theme._docs.some(d => d.month === data.month)) {
      const e = new Error(`E11000 duplicate key error collection: monthlythemes index: month_1 dup key: { month: "${data.month}" }`);
      e.code = 11000;
      throw e;
    }
    return realCreate(data);
  };
  const useDatabase = (d) => { db = d; Object.defineProperty(Theme, 'collection', { value: d.collection, configurable: true, writable: true }); };

  require('../server.js');
  await new Promise(r => setTimeout(r, 1200));
  const BASE = 'http://127.0.0.1:4371';
  let jar = '';
  async function call(method, p, body) {
    const h = {};
    if (jar) h.cookie = jar;
    const isForm = body instanceof FormData;
    if (body && !isForm) h['content-type'] = 'application/json';
    const res = await fetch(BASE + p, { method, headers: h, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
    const sc = res.headers.getSetCookie();
    if (sc.length) jar = sc.map(c => c.split(';')[0]).join('; ');
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }
  // The theme as the National portal sends it.
  const themeForm = (title) => {
    const fd = new FormData();
    Object.entries({ title, scripture: 'Romans 6:4', blurb: '', keepFlyers: '[]', prayer: '', prayerNote: '', keepPrayerFlyers: '[]' }).forEach(([k, v]) => fd.append(k, v));
    return fd;
  };
  await call('POST', '/api/admin/login', { username: 'admin', password: 'admin123' });
  const month = life.monthKey();

  console.log('\n== a database made by the first version ==');
  useDatabase(oldDatabase([{ name: '_id_', key: { _id: 1 } }, { name: 'month_1', key: { month: 1 }, unique: true }]));
  await Theme.create({ id: 'theme_proposal', month, title: 'From a chapter', status: 'pending', proposedByChapterId: 'aconsu-knust', proposedByName: 'Chapter admin' });
  let r = await call('PUT', `/api/national/themes/${month}`, themeForm('Walking in Newness'));
  check('the month holds a chapter\'s proposal, so National\'s theme is refused (as on the live site)', r.status === 409, r);
  check('and it says what to do, not just "Could not save"', /Restart the app/.test(r.data.error || ''), r.data);

  console.log('\n== the repair, on start ==');
  let out = await themeIndex.oneLiveThemePerMonth({ dryRun: true, log: () => {} });
  check('a dry run says what it would do and changes nothing', out === 'would change' && db.done.length === 0, db.done);
  out = await themeIndex.oneLiveThemePerMonth({ log: () => {} });
  check('the right rule is made first, then the old one goes', out === 'changed'
    && db.done[0][0] === 'create' && db.done[0][1] === 'month_one_approved' && db.done[0][2] === '{"status":"approved"}'
    && db.done[1][0] === 'drop' && db.done[1][1] === 'month_1', db.done);
  out = await themeIndex.oneLiveThemePerMonth({ log: () => {} });
  check('and the next start changes nothing', out === 'ready' && db.done.length === 2, db.done);

  r = await call('PUT', `/api/national/themes/${month}`, themeForm('Walking in Newness'));
  check('now National\'s theme saves, beside the chapter\'s proposal', r.status === 200 && r.data.item && r.data.item.status === 'approved', r);
  check('and the proposal is still there, untouched', Theme._docs.some(d => d.id === 'theme_proposal' && d.status === 'pending'));

  console.log('\n== other databases ==');
  useDatabase(oldDatabase([{ name: 'month_1', key: { month: 1 }, unique: true }], { refuseTwo: true }));
  out = await themeIndex.oneLiveThemePerMonth({ log: () => {} });
  check('where only one index on the field is allowed: the old one goes first', out === 'changed' && db.done[0][0] === 'drop' && db.done[1][0] === 'create', db.done);
  useDatabase(oldDatabase([{ name: 'month_1', key: { month: 1 }, unique: true, partialFilterExpression: { status: 'approved' } }]));
  out = await themeIndex.oneLiveThemePerMonth({ log: () => {} });
  check('the right rule under its old name is left as it is', out === 'ready' && db.done.length === 0, db.done);
  useDatabase(oldDatabase([{ name: 'month_1', key: { month: 1 } }, { name: 'month_one_approved', key: { month: 1 }, unique: true, partialFilterExpression: { status: 'approved' } }]));
  out = await themeIndex.oneLiveThemePerMonth({ log: () => {} });
  check('a plain (not unique) month index is no obstacle and is left alone', out === 'ready' && db.done.length === 0, db.done);

  console.log(failures ? `\n${failures} FAILURES` : '\nall theme index checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
