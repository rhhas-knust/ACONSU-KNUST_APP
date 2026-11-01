/* ============================================================
   Giving cards (routes/giving-cards.js): one card for each person
   who gives, with every gift of theirs, totalled by purpose and by
   year. Offerings are never on a card. Drawn the same way for
   Finance and Welfare (a card for every giver), for a member (their
   own, on the Give page) and for someone without an account (theirs,
   by their receipt link).
   ============================================================ */
(function () {
  'use strict';
  const esc = (v) => (typeof escapeHtml === 'function' ? escapeHtml(String(v == null ? '' : v)) : String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const cedis = (n) => `GH₵ ${Number(n || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const day = (d) => {
    if (!d) return '';
    const t = new Date(`${d}T12:00:00`);
    return Number.isNaN(t.getTime()) ? d : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  // One card. `staff` shows how to reach someone without an account.
  function cardHtml(card, { staff = false, open = false } = {}) {
    const who = card.source === 'member' ? 'App member' : `No account${staff && card.phone ? ` · ${esc(card.phone)}` : ''}`;
    return `
      <article class="giver-card">
        <header class="giver-head">
          <h3>${esc(card.name || 'Someone who gave')}</h3>
          ${staff ? `<p class="giver-sub">${who}</p>` : ''}
        </header>
        <p class="giver-total"><strong>${cedis(card.totals.confirmed)}</strong> received${card.totals.waiting ? ` <span class="giver-waiting">· ${cedis(card.totals.waiting)} waiting to be confirmed</span>` : ''}</p>
        ${card.byPurpose.length ? `<dl class="giver-split">${card.byPurpose.map(p => `<div><dt>${esc(p.label)}</dt><dd>${cedis(p.total)}</dd></div>`).join('')}</dl>` : ''}
        ${card.byYear.length ? `<p class="giver-years">${card.byYear.map(y => `<span>${esc(y.year)}: ${cedis(y.total)}</span>`).join('')}</p>` : ''}
        <details class="giver-gifts"${open ? ' open' : ''}>
          <summary>Every gift (${card.count})</summary>
          <ul>
            ${card.gifts.map(g => `
              <li>
                <span>${esc(day(g.date))} · ${esc(g.purposeLabel)}</span>
                <span class="giver-amount">${cedis(g.amount)}${g.status === 'waiting' ? ' <em>waiting</em>' : ''}</span>
              </li>`).join('')}
          </ul>
        </details>
      </article>`;
  }

  // A spreadsheet of the cards shown, for Finance's or Welfare's records.
  function csvOf(cards) {
    const purposes = [...new Set(cards.flatMap(c => c.byPurpose.map(p => p.label)))];
    const cell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = [['Name', 'Account', 'Number', ...purposes, 'Received', 'Waiting', 'Gifts', 'Last gift']];
    cards.forEach((c) => rows.push([
      c.name, c.source === 'member' ? 'App member' : 'No account', c.phone || '',
      ...purposes.map(label => (c.byPurpose.find(p => p.label === label) || {}).total || 0),
      c.totals.confirmed, c.totals.waiting, c.count, c.lastGift
    ]));
    return rows.map(r => r.map(cell).join(',')).join('\r\n');
  }

  // Finance's or Welfare's panel: a card for every giver, found by name or number.
  async function renderPanel(el, { url, title, intro, file }) {
    el.innerHTML = `<div class="panel-head"><div><h2>${esc(title)}</h2><p class="sub">${esc(intro)}</p></div></div><p class="empty-state">Loading…</p>`;
    let cards;
    try { cards = (await fetchJSON(url)).cards || []; } catch (e) {
      el.innerHTML = `<div class="panel-head"><div><h2>${esc(title)}</h2></div></div><p class="empty-state">${esc(e.message || 'Could not load the giving cards.')}</p>`;
      return;
    }
    const received = cards.reduce((s, c) => s + c.totals.confirmed, 0);
    el.innerHTML = `
      <div class="panel-head">
        <div><h2>${esc(title)}</h2><p class="sub">${esc(intro)}</p></div>
        ${cards.length ? '<div class="panel-actions"><button type="button" class="btn btn-outline btn-sm" id="giverCsv">Download (CSV)</button></div>' : ''}
      </div>
      ${cards.length ? `
        <p class="giver-summary">${cards.length} ${cards.length === 1 ? 'giver' : 'givers'} · ${cedis(received)} received</p>
        <div class="field" style="max-width:420px;"><label for="giverSearch">Find a giver</label><input type="search" id="giverSearch" placeholder="Name or number" autocomplete="off"></div>
        <div class="giver-grid" id="giverGrid"></div>` : '<p class="empty-state">Nobody has given yet, apart from offerings (which are not on a card).</p>'}`;
    if (!cards.length) return;
    const grid = el.querySelector('#giverGrid');
    const draw = () => {
      const term = el.querySelector('#giverSearch').value.trim().toLowerCase();
      const digits = term.replace(/\D/g, '');
      const shown = cards.filter(c => !term || c.name.toLowerCase().includes(term) || (digits.length >= 3 && String(c.phone || '').replace(/\D/g, '').includes(digits)));
      grid.innerHTML = shown.map(c => cardHtml(c, { staff: true })).join('') || '<p class="empty-state">Nobody by that name or number.</p>';
    };
    el.querySelector('#giverSearch').addEventListener('input', draw);
    el.querySelector('#giverCsv').addEventListener('click', () => {
      const blob = new Blob(['\uFEFF' + csvOf(cards)], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${file}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    draw();
  }

  window.GivingCards = { cardHtml, renderPanel, csvOf };
})();
