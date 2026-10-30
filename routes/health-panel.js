// National's Health panel: is the app doing its job? Sign-ups started and
// finished, members active this week, shares, and giving claims by where
// they stand. Counts only, for the whole union and per chapter. Nothing in
// it names or follows a person: the sign-up and share figures are the day
// counts in lib/metrics.js, and the rest are totals worked out from the
// records the app keeps anyway. No cookie and no outside service is involved.

const metrics = require('../lib/metrics');
const { SHARE_KINDS } = require('./share');

const PERIODS = [7, 28, 90];
const DAY = 24 * 60 * 60 * 1000;
const dayOf = (d) => new Date(d).toISOString().slice(0, 10);

function registerHealthRoutes(app, deps) {
  const { repo, rolesLib } = deps;

  app.get('/api/national/health', rolesLib.requireNational, async (req, res) => {
    try {
      const days = PERIODS.includes(Number(req.query.days)) ? Number(req.query.days) : 28;
      const now = Date.now();
      const to = dayOf(now);
      const from = dayOf(now - (days - 1) * DAY);
      const weekAgo = dayOf(now - 6 * DAY);
      const inPeriod = (d) => { if (!d) return false; const k = dayOf(d); return k >= from && k <= to; };

      const [counts, chapters, members, giving] = await Promise.all([
        metrics.rows(from, to),
        repo.getAll('chapters'),
        repo.getAll('members', repo.allChapters()),
        repo.getAll('givingIntents', repo.allChapters())
      ]);
      const sum = (pred) => counts.filter(pred).reduce((n, r) => n + r.count, 0);

      const started = sum((r) => r.key === 'signup:started');
      const completed = members.filter((m) => inPeriod(m.createdAt)).length;
      const activeThisWeek = (m) => (m.lastActiveDate || '') >= weekAgo;
      const shares = Object.fromEntries([...SHARE_KINDS].map((k) => [k, sum((r) => r.key === `share:${k}`)]));
      const payments = { pending: 0, confirmed: 0, rejected: 0 };
      giving.filter((g) => inPeriod(g.createdAt)).forEach((g) => { if (payments[g.status] !== undefined) payments[g.status] += 1; });

      // Week by week, oldest first, ending today.
      const weeks = [];
      for (let end = now; weeks.length < Math.ceil(days / 7); end -= 7 * DAY) {
        const wTo = dayOf(end);
        const wFrom = dayOf(Math.max(end - 6 * DAY, now - (days - 1) * DAY));
        const within = (d) => d >= wFrom && d <= wTo;
        weeks.unshift({
          from: wFrom,
          to: wTo,
          started: sum((r) => r.key === 'signup:started' && within(r.day)),
          completed: members.filter((m) => m.createdAt && within(dayOf(m.createdAt))).length,
          shares: sum((r) => r.key.startsWith('share:') && within(r.day))
        });
      }

      res.json({
        days, from, to,
        signUps: { started, completed },
        members: { total: members.length, activeThisWeek: members.filter(activeThisWeek).length },
        shares: { ...shares, total: Object.values(shares).reduce((a, b) => a + b, 0) },
        payments: { ...payments, total: payments.pending + payments.confirmed + payments.rejected },
        weeks,
        chapters: chapters.map((c) => {
          const mine = members.filter((m) => m.chapterId === c.id);
          return { id: c.id, name: c.name, members: mine.length, activeThisWeek: mine.filter(activeThisWeek).length, joined: mine.filter((m) => inPeriod(m.createdAt)).length };
        }).sort((a, b) => b.members - a.members || String(a.name).localeCompare(String(b.name))),
        generatedAt: new Date().toISOString()
      });
    } catch (e) {
      res.status(500).json({ error: 'Could not work out the figures' });
    }
  });
}

module.exports = { registerHealthRoutes, PERIODS };
