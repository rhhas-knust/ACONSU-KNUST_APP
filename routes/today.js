// The first-steps list on each leaders' portal's Today screen
// (public/js/today.js): which steps this account has done, and whether it
// has hidden the list. Kept per account, so it follows the person from one
// phone to another, and per portal, since one person can hold two offices.
//
// It records nothing else and decides nothing: what each office can see and
// do is lib/roles.js, untouched by any of this.

const PORTALS = new Set(['coordinator', 'finance', 'shepherding', 'publicity', 'executive', 'welfare', 'admin']);
const STEP = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
const MAX_STEPS = 20;

// The env admin has no account record of its own, so its list is kept on a
// row of its own.
const ADMIN_ROW = 'firstRun:admin';

function registerTodayRoutes(app, deps) {
  const { models, currentStaff } = deps;

  function whose(req) {
    const staff = currentStaff(req);
    if (staff && staff.id) return { model: models.StaffUser, filter: { id: staff.id } };
    if (req.session && req.session.isAdmin) return { model: models.SystemState, filter: { singleton: ADMIN_ROW }, upsert: true };
    return null;
  }

  async function read(who) {
    const doc = await who.model.findOne(who.filter).lean();
    const all = (doc && doc.firstRun && typeof doc.firstRun === 'object') ? doc.firstRun : {};
    // Only what this route writes is handed back.
    return Object.fromEntries(Object.entries(all).filter(([k]) => PORTALS.has(k)).map(([k, v]) => [k, {
      done: Array.isArray(v && v.done) ? v.done.filter((s) => STEP.test(s)).slice(0, MAX_STEPS) : [],
      hidden: !!(v && v.hidden)
    }]));
  }

  app.get('/api/portal/first-run', async (req, res) => {
    const who = whose(req);
    if (!who) return res.status(401).json({ error: 'Sign in first' });
    try { res.json({ portals: await read(who) }); } catch (e) { res.status(500).json({ error: 'Could not load your first steps' }); }
  });

  app.post('/api/portal/first-run', async (req, res) => {
    const who = whose(req);
    if (!who) return res.status(401).json({ error: 'Sign in first' });
    const body = req.body || {};
    const portal = String(body.portal || '');
    if (!PORTALS.has(portal)) return res.status(400).json({ error: 'Unknown portal' });
    if (body.done !== undefined && !STEP.test(String(body.done))) return res.status(400).json({ error: 'Unknown step' });
    try {
      const all = await read(who);
      const mine = all[portal] || { done: [], hidden: false };
      if (body.done !== undefined && !mine.done.includes(String(body.done)) && mine.done.length < MAX_STEPS) mine.done.push(String(body.done));
      if (body.hidden !== undefined) mine.hidden = body.hidden === true;
      all[portal] = mine;
      await who.model.findOneAndUpdate(who.filter, { $set: { firstRun: all } }, { upsert: !!who.upsert });
      res.json({ portals: all });
    } catch (e) {
      res.status(500).json({ error: 'Could not save that' });
    }
  });
}

module.exports = { registerTodayRoutes, PORTALS };
