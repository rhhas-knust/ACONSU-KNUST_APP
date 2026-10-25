/* ============================================================
   The chapter's money, for the Financial Secretary and the
   Treasurer: each Sunday's offering (the Treasurer counts and
   files it), the Sundays side by side with their attendance,
   and the books the chapter already keeps, brought in from a
   spreadsheet (the Financial Secretary).
   Server side: routes/books.js. Requires office-ui.js and
   csv-import.js.
   ============================================================ */
window.OfficeBooks = (function () {
  const U = OfficeUI;
  const esc = U.esc;
  const SERVICES = [['sunday', 'Sunday'], ['midweek', 'Midweek'], ['special', 'Special programme']];

  // ---------- the Sundays, side by side ----------
  // How many came, and what was given, for each recent service. A Sunday with
  // people checked in and no offering filed stands out, and so does the reverse.
  // Recorded, still waiting, or nothing filed, written out rather than left to a colour.
  const offeringCell = (s) => {
    const parts = [];
    if (s.recorded) parts.push(`${esc(U.cedi(s.recorded))}<br><span class="tiny muted">recorded</span>`);
    if (s.waiting) parts.push(`${esc(U.cedi(s.waiting))}<br><span class="tiny muted">waiting to be recorded</span>`);
    if (s.sentBack) parts.push(`<span class="tiny muted">${s.sentBack} sent back</span>`);
    return parts.join('<br>') || '<span class="muted">none filed</span>';
  };

  async function renderSundays(host) {
    let rows = [];
    try { rows = await fetchJSON('/api/executive/finance/sundays'); } catch (e) { rows = null; }
    host.innerHTML = `
      <h3>The Sundays</h3>
      <p class="hint">How many were checked in at the door (with walk-ins), beside what was given. Attendance comes from Shepherding's Sunday check-in.</p>
      ${rows === null ? '<p class="empty-state">Could not load the Sundays.</p>' : rows.length ? `
        <div class="table-wrap"><table class="portal-table bk-sundays">
          <thead><tr><th>Service</th><th class="num">People</th><th class="num">Offering</th></tr></thead>
          <tbody>${rows.map(s => `
            <tr>
              <td>${esc(U.dayLabel(s.date))}<br><span class="tiny muted">${esc(s.label)}</span></td>
              <td class="num">${s.attendance === null ? '<span class="muted">not taken</span>' : esc(s.attendance)}</td>
              <td class="num">${offeringCell(s)}</td>
            </tr>`).join('')}</tbody>
        </table></div>` : '<p class="empty-state">No Sundays yet. They appear as Shepherding checks people in and offerings are filed.</p>'}`;
  }

  // ---------- the Treasurer: this Sunday's offering ----------
  // On a phone, straight after the count: the amount, who counted it with
  // them, and a photo of the count. It waits for the Financial Secretary, as
  // every filing does.
  function offeringForm(host, onDone) {
    host.innerHTML = `
      <h3>This Sunday's offering</h3>
      <p class="hint">After the count: the amount, who counted it with you, and a photo of the counted money or the count sheet. The Financial Secretary records it.</p>
      <form id="offeringForm" novalidate>
        <div class="field-row">
          <div class="field"><label for="offDate">Service date</label><input type="date" id="offDate" value="${lastSundayISO()}" max="${todayISO()}" required></div>
          <div class="field"><label for="offService">Service</label>
            <select id="offService">${SERVICES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
          </div>
        </div>
        <div class="field-row">
          <div class="field"><label for="offAmount">Amount counted (GHS)</label><input type="number" id="offAmount" inputmode="decimal" step="0.01" min="0.01" required></div>
          <div class="field"><label for="offMethod">How it came</label>
            <select id="offMethod"><option value="cash">Cash</option><option value="momo">MoMo</option><option value="bank">Bank</option><option value="other">Other</option></select>
          </div>
        </div>
        <div class="field"><label for="offCounted">Counted with (name)</label><input type="text" id="offCounted" autocomplete="off" placeholder="Who counted it with you"></div>
        <div class="field"><label for="offPhoto">Photo of the count</label><input type="file" id="offPhoto" accept="image/*" capture="environment" required></div>
        <div class="field"><label for="offNote">Anything to note</label><input type="text" id="offNote" placeholder="Optional. Harvest Sunday, a torn note, etc."></div>
        <button type="submit" class="btn btn-primary">File the offering</button>
        <div class="form-msg" id="offMsg" role="alert"></div>
      </form>`;
    host.querySelector('#offeringForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('[type="submit"]');
      const photo = document.getElementById('offPhoto').files[0];
      if (!document.getElementById('offAmount').value) return setFormMsg('offMsg', 'Type the amount counted.', 'error');
      if (!photo) return setFormMsg('offMsg', 'Add a photo of the count. An offering without it cannot be recorded.', 'error');
      const fd = new FormData();
      fd.append('date', document.getElementById('offDate').value);
      fd.append('serviceType', document.getElementById('offService').value);
      fd.append('amount', document.getElementById('offAmount').value);
      fd.append('method', document.getElementById('offMethod').value);
      fd.append('countedWith', document.getElementById('offCounted').value);
      fd.append('note', document.getElementById('offNote').value);
      fd.append('photo', photo);
      btn.disabled = true;
      try {
        await fetchJSON('/api/executive/treasury/offering', { method: 'POST', body: fd });
        showToast('The offering is filed. The Financial Secretary will record it.', 'success');
        if (onDone) onDone();
      } catch (err) {
        btn.disabled = false;
        setFormMsg('offMsg', err.message || 'Could not file the offering.', 'error');
      }
    });
  }

  // ---------- the Financial Secretary: the books kept before ----------
  function openImport(onDone) {
    const { plural, issues } = CsvImport;
    const kind = (e) => (e.entryType === 'income' ? 'in' : 'out');
    CsvImport.open({
      url: '/api/executive/finance/import',
      title: 'Bring in the books you already keep',
      steps: [
        'Open your books in Excel or Google Sheets, with a row of headings at the top (Date, Details, Money in, Money out…). One Amount column with an In / Out column works too.',
        'Save them as a CSV file. In Excel: File, Save As, "CSV UTF-8". In Google Sheets: File, Download, "Comma-separated values".',
        'Choose that file here. You will see the totals and every row before anything is added.'
      ],
      fileLabel: 'Your books (CSV file)',
      headerLabel: 'The first row is headings, not an entry',
      templateUrl: '/api/executive/finance/import/template.csv',
      templateLabel: 'Download a sample',
      rowNoun: ['row', 'rows'],
      columnsHint: 'Check each column is matched to the right thing. A running balance is left out: the ledger works it out. Anything else can be kept in the entry\'s details.',
      checkLabel: 'Check the books',
      renderCheck: (res) => {
        const c = res.counts;
        return `
          <ul class="imp-summary">
            <li class="good"><strong>${plural(c.add, 'entry', 'entries')}</strong> will be added to the ledger${c.add ? `: <strong>${esc(U.cedi(res.totals.in))}</strong> in and <strong>${esc(U.cedi(res.totals.out))}</strong> out, from ${esc(res.from)} to ${esc(res.to)}` : ''}. Check these against your book before you go on.</li>
            ${c.same ? `<li><strong>${plural(c.same, 'entry is', 'entries are')}</strong> already in the ledger, so ${c.same === 1 ? 'is' : 'are'} not added again.</li>` : ''}
            ${c.skip ? `<li class="warn"><strong>${plural(c.skip, 'row is', 'rows are')}</strong> left out (below).</li>` : ''}
          </ul>
          ${res.adding.length ? `
            <h4>The first few to be added</h4>
            <div class="table-wrap"><table class="portal-table imp-preview">
              <thead><tr><th>Row</th><th>Date</th><th>In / out</th><th>What</th><th class="num">Amount</th></tr></thead>
              <tbody>${res.adding.map(p => `<tr><td>${p.row}</td><td>${esc(p.date)}</td><td>${kind(p)}</td><td>${esc(p.category)}${p.description ? `<br><span class="tiny muted">${esc(p.description)}</span>` : ''}</td><td class="num">${esc(U.cedi(p.amount))}</td></tr>`).join('')}</tbody>
            </table></div>` : ''}
          ${issues('Left out', res.notAdding.filter(p => p.action === 'skip'), p => `Row ${p.row}: ${esc(p.reason)}`, true)}
          ${issues('Worth checking', res.warnings, p => `Row ${p.row}: ${p.warnings.map(esc).join(' ')}`)}
          ${issues('Already in the ledger', res.notAdding.filter(p => p.action === 'same'), p => `Row ${p.row}: ${esc(p.date)}, ${esc(U.cedi(p.amount))} ${kind(p)}${p.description ? `, ${esc(p.description)}` : ''}`)}`;
      },
      goLabel: (res) => (res.counts.add ? `Add ${plural(res.counts.add, 'entry', 'entries')} to the ledger` : ''),
      doneMessage: (done) => `${plural(done.added, 'entry', 'entries')} added to the ledger.`,
      onDone
    });
  }

  return { renderSundays, offeringForm, openImport };
})();
