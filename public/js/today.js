/* ============================================================
   "Today": the first screen of every leaders' portal. At most five
   big buttons for what this office does every week, each with how
   many are waiting where there is such a number, and everything
   else under "All tools" (the menu, folded away on a phone).

   Under it, for someone new to the office, a short list of first
   steps with the how-to video. It is kept per account on the
   server (routes/today.js), ticks itself off as each step's screen
   is opened, and can be hidden for good.

   Only a way of laying out what is already there: every count is
   read from a route the office already uses, so a count this
   account may not see is simply left off, and every button opens
   a screen the portal already shows it.
   Requires main.js (fetchJSON, escapeHtml).
   ============================================================ */
window.AconsuToday = (function () {
  const VIDEO = '/video/how-to-aconsu.mp4';
  const MAX_ACTIONS = 5;
  const setups = {}; // portal -> { checklist }
  let state = null; // { [portal]: { done: [], hidden } } for this account

  async function loadState() {
    if (state) return state;
    try { state = (await fetchJSON('/api/portal/first-run')).portals || {}; } catch (e) { state = {}; }
    return state;
  }
  function mine(portal) {
    const s = (state && state[portal]) || {};
    return { done: Array.isArray(s.done) ? s.done : [], hidden: !!s.hidden };
  }
  async function save(portal, body) {
    try {
      const out = await fetchJSON('/api/portal/first-run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ portal, ...body })
      });
      if (out && out.portals) state = out.portals;
    } catch (e) { /* the list is a help, not a record: a lost tick is fine */ }
  }

  // Opening a step's screen, from the list or the menu, ticks the step off.
  function visited(portal, key) {
    const setup = setups[portal];
    if (!setup || !state) return;
    const s = mine(portal);
    if (s.hidden || s.done.includes(key) || !setup.checklist.some((c) => c.key === key)) return;
    save(portal, { done: key });
  }

  // Each fetch once per screen, however many buttons read from it.
  function reader() {
    const seen = new Map();
    return (url) => { if (!seen.has(url)) seen.set(url, fetchJSON(url)); return seen.get(url); };
  }

  // "3 waiting", or the office's own words for it ("not seen in a month").
  function countText(a, n) {
    return (n === 1 ? a.one : a.many) || 'waiting';
  }

  function checklistHtml(portal, steps) {
    const s = mine(portal);
    const left = steps.filter((c) => !s.done.includes(c.key));
    if (s.hidden || !left.length) return '';
    return `
      <div class="today-start" id="todayStart">
        <div class="today-start-head">
          <h3>First steps in this office</h3>
          <button type="button" class="btn btn-outline btn-sm" data-today-hide>Hide this list</button>
        </div>
        <p class="muted">${steps.length - left.length} of ${steps.length} done. Each one ticks itself off once you have opened it.</p>
        <ol class="today-steps">
          ${steps.map((c) => {
            const done = s.done.includes(c.key);
            const inner = `<span class="today-tick" aria-hidden="true">${done ? '&#10003;' : ''}</span><span>${escapeHtml(c.label)}</span>${done ? '<span class="sr-only"> (done)</span>' : ''}`;
            return `<li class="${done ? 'done' : ''}">${c.href
              ? `<a href="${escapeHtml(c.href)}" target="_blank" rel="noopener" data-today-step="${escapeHtml(c.key)}">${inner}</a>`
              : `<button type="button" data-today-step="${escapeHtml(c.key)}" data-today-open="${escapeHtml(c.panel || c.key)}">${inner}</button>`}</li>`;
          }).join('')}
        </ol>
      </div>`;
  }

  // el: where to draw. opts.portal names the office (and its first-run list);
  // opts.actions and opts.checklist are the office's own (see each portal);
  // opts.has(panel) says whether this account has that screen; opts.open(panel)
  // opens it; opts.allTools() unfolds the menu.
  async function render(el, opts) {
    const has = opts.has || (() => true);
    const actions = (opts.actions || []).filter((a) => has(a.panel)).slice(0, MAX_ACTIONS);
    const steps = [
      ...(opts.checklist || []).filter((c) => has(c.panel || c.key)).slice(0, 5),
      { key: 'video', label: 'Watch the how-to video (3 minutes)', href: VIDEO }
    ];
    setups[opts.portal] = { checklist: steps };
    await loadState();

    el.innerHTML = `
      <section class="today" aria-labelledby="todayTitle">
        <div class="panel-head">
          <div>
            <h2 id="todayTitle">Today</h2>
            <p class="sub">${escapeHtml(opts.intro || 'What this office does each week, and what is waiting for you.')}</p>
          </div>
        </div>
        <div class="today-actions">
          ${actions.map((a, i) => `
            <button type="button" class="today-action" data-today-open="${escapeHtml(a.panel)}" data-today-action="${i}">
              ${a.count ? '<span class="today-count" aria-hidden="true"></span>' : ''}
              <span class="today-label">${escapeHtml(a.label)}</span>
              ${a.count ? '<span class="today-waiting muted"></span>' : ''}
            </button>`).join('')}
        </div>
        <button type="button" class="btn btn-outline today-all" data-today-all aria-controls="${escapeHtml(opts.menuId || '')}">All tools</button>
        ${checklistHtml(opts.portal, steps)}
      </section>`;

    el.querySelectorAll('[data-today-open]').forEach((b) => b.addEventListener('click', () => opts.open(b.dataset.todayOpen)));
    el.querySelectorAll('a[data-today-step]').forEach((a) => a.addEventListener('click', () => {
      save(opts.portal, { done: a.dataset.todayStep }).then(() => render(el, opts));
    }));
    const all = el.querySelector('[data-today-all]');
    if (all) all.addEventListener('click', () => opts.allTools && opts.allTools());
    const hide = el.querySelector('[data-today-hide]');
    if (hide) hide.addEventListener('click', async () => {
      await save(opts.portal, { hidden: true });
      const start = el.querySelector('#todayStart');
      if (start) start.remove();
    });

    // The numbers arrive after the buttons, so a slow one never holds the
    // screen up. One that cannot be read (not this account's to see, or the
    // network) is left off rather than shown as nothing waiting.
    const get = reader();
    actions.forEach((a, i) => {
      if (!a.count) return;
      const btn = el.querySelector(`[data-today-action="${i}"]`);
      Promise.resolve().then(() => a.count(get)).then((n) => {
        if (typeof n !== 'number' || !btn) return;
        btn.querySelector('.today-count').textContent = String(n);
        btn.querySelector('.today-waiting').textContent = countText(a, n);
        btn.classList.toggle('has-waiting', n > 0);
        btn.setAttribute('aria-label', `${a.label}: ${n} ${countText(a, n)}`);
      }).catch(() => {});
    });
  }

  return { render, visited, MAX_ACTIONS, VIDEO };
})();
