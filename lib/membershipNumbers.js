// Membership numbers: ACONSU-KNUST-0001, -0002, ... one per member, never two
// alike, never reused.
//
// They used to be worked out as "the highest number given so far, plus one",
// read and then written. Two acceptances at the same moment (two shepherds, or
// one accepting a batch while the Coordinator appoints someone) both read the
// same highest number and both gave out the next one, so two members ended up
// with the same number. Now each chapter has a counter in the database that is
// moved on and read in one step (Counter, $inc), which no two requests can
// share. The counter starts from the highest number already given, so nothing
// already on a card is reused.
//
// repairDuplicates() mends the numbers that were already given twice: the
// member who had the number first keeps it, each other one gets a new number,
// and the number they had is kept on their record (previousMembershipNumbers).

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const prefixOf = (chapterId) => `${String(chapterId || '').toUpperCase()}-`;
const counterKey = (chapterId) => `membershipNumber:${chapterId || ''}`;

function create({ models }) {
  // The highest number already given in a chapter, by reading them all: only
  // needed once, to start the chapter's counter.
  async function highestGiven(chapterId) {
    const pattern = new RegExp(`^${escape(prefixOf(chapterId))}(\\d+)$`);
    const numbered = await models.Member.find({ chapterId, membershipNumber: { $regex: pattern.source } }).lean();
    return numbered.reduce((n, m) => {
      const hit = pattern.exec(String(m.membershipNumber || ''));
      return hit ? Math.max(n, Number(hit[1])) : n;
    }, 0);
  }

  async function next(chapterId) {
    const key = counterKey(chapterId);
    const existing = await models.Counter.findOne({ key }).lean();
    if (!existing) {
      // Start (or catch up) the counter from what is already given. $max only
      // ever raises it, so two requests doing this together agree.
      const highest = await highestGiven(chapterId);
      try {
        await models.Counter.updateOne({ key }, { $max: { seq: highest } }, { upsert: true });
      } catch (e) {
        if (!(e && e.code === 11000)) throw e; // the other request made it first
        await models.Counter.updateOne({ key }, { $max: { seq: highest } });
      }
    }
    const counter = await models.Counter.findOneAndUpdate({ key }, { $inc: { seq: 1 } }, { new: true }).lean();
    return `${prefixOf(chapterId)}${String(counter.seq).padStart(4, '0')}`;
  }

  async function repairDuplicates({ log = () => {} } = {}) {
    const members = await models.Member.find({ membershipNumber: { $ne: '' } }).lean();
    const byNumber = new Map();
    members.forEach((m) => {
      if (!m.membershipNumber) return;
      const k = `${m.chapterId || ''}::${m.membershipNumber}`;
      if (!byNumber.has(k)) byNumber.set(k, []);
      byNumber.get(k).push(m);
    });
    const changed = [];
    for (const group of byNumber.values()) {
      if (group.length < 2) continue;
      // Whoever has had it longest keeps it.
      group.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0) || String(a.id).localeCompare(String(b.id)));
      for (const m of group.slice(1)) {
        const number = await next(m.chapterId);
        await models.Member.updateOne({ id: m.id }, {
          $set: { membershipNumber: number, previousMembershipNumbers: [...(m.previousMembershipNumbers || []), m.membershipNumber] }
        });
        changed.push({ id: m.id, name: m.name, chapterId: m.chapterId, from: m.membershipNumber, to: number });
        log(`Membership number ${m.membershipNumber} was given twice in ${m.chapterId}; ${m.name || m.id} now has ${number}.`);
      }
    }
    return changed;
  }

  return { next, repairDuplicates, highestGiven };
}

module.exports = { create, prefixOf, counterKey };
