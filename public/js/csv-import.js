/* ============================================================
   Bringing a spreadsheet in, saved as CSV: choose the file, say
   what each column holds, check what would happen, bring it in.
   Nothing is written until the last step. Each step sends the
   same file again, so nothing half-read waits on the server,
   which reads the file itself (lib/csvTable.js).

   Used for Shepherding's list (shepherd-list.js) and for the
   books the Financial Secretary already keeps (office-books.js).
   Each says what it is bringing in; this is the steps between.
   ============================================================ */
window.CsvImport = (function () {
  // cfg:
  //   url             the import route (answers 'read', 'check', 'import')
  //   title           the first step's heading
  //   steps           how to get the file out of Excel or Google Sheets, as list items
  //   fileLabel       the file box's label
  //   headerLabel     "The first row is headings, not a ..."
  //   templateUrl, templateLabel   a sample to download
  //   rowNoun         [one, many] for "12 people in members.csv"
  //   columnsHint     the sentence under "What is in each column?"
  //   checkLabel      the button that checks ("Check the list")
  //   renderCheck(res)   the summary, as HTML
  //   goLabel(res)       the button that brings them in, or '' when there is nothing to
  //   doneMessage(done)  the toast afterwards
  //   onDone()           after the import
  function open(cfg) {
    const state = { file: null, hasHeader: true, columns: [], fields: [], mapping: [], rowCount: 0 };
    const noun = (n) => `${n} ${n === 1 ? cfg.rowNoun[0] : cfg.rowNoun[1]}`;

    const send = async (step) => {
      const fd = new FormData();
      fd.append('file', state.file);
      fd.append('step', step);
      fd.append('hasHeader', state.hasHeader ? '1' : '0');
      if (step !== 'read') fd.append('mapping', JSON.stringify(state.mapping));
      return fetchJSON(cfg.url, { method: 'POST', body: fd });
    };

    function stepChoose(message) {
      showModal(`
        <h3>${escapeHtml(cfg.title)}</h3>
        <ol class="imp-how">${cfg.steps.map(s => `<li>${s}</li>`).join('')}</ol>
        <div class="field">
          <label for="impFile">${escapeHtml(cfg.fileLabel)}</label>
          <input type="file" id="impFile" accept=".csv,text/csv,text/plain">
        </div>
        <label class="of-check-line"><input type="checkbox" id="impHeader" ${state.hasHeader ? 'checked' : ''}> ${escapeHtml(cfg.headerLabel)}</label>
        <p class="tiny"><a href="${cfg.templateUrl}">${escapeHtml(cfg.templateLabel)}</a> to see the layout, or to start from.</p>
        <div class="form-msg ${message ? 'error' : ''}" id="impMsg" role="alert">${message ? escapeHtml(message) : ''}</div>
        <div class="of-actions"><button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button></div>
      `);
      document.getElementById('impFile').addEventListener('change', async (e) => {
        state.file = e.target.files[0];
        state.hasHeader = document.getElementById('impHeader').checked;
        if (!state.file) return;
        setFormMsg('impMsg', 'Reading the file…', '');
        try {
          const res = await send('read');
          state.columns = res.columns;
          state.fields = res.fields;
          state.mapping = res.columns.map(c => c.field);
          state.rowCount = res.rowCount;
          stepColumns();
        } catch (err) {
          stepChoose(err.message);
        }
      });
    }

    function stepColumns(message) {
      const options = (current) => state.fields.map(f => `<option value="${f.key}" ${f.key === current ? 'selected' : ''}>${escapeHtml(f.label)}</option>`).join('');
      showModal(`
        <h3>What is in each column?</h3>
        <p class="tiny muted">${noun(state.rowCount)} in ${escapeHtml(state.file.name)}. ${escapeHtml(cfg.columnsHint)}</p>
        <ul class="imp-cols">
          ${state.columns.map((c, i) => `
            <li>
              <label for="impCol${i}">${escapeHtml(c.heading || `Column ${i + 1}`)}</label>
              <span class="imp-eg" id="impEg${i}">${c.samples.length ? `For example: ${c.samples.map(s => escapeHtml(s)).join(' · ')}` : 'Empty'}</span>
              <select id="impCol${i}" data-col="${i}" aria-describedby="impEg${i}">${options(state.mapping[i])}</select>
            </li>`).join('')}
        </ul>
        <div class="form-msg ${message ? 'error' : ''}" id="impMsg" role="alert">${message ? escapeHtml(message) : ''}</div>
        <div class="of-actions">
          <button type="button" class="btn btn-primary" id="impCheck">${escapeHtml(cfg.checkLabel)}</button>
          <button type="button" class="btn btn-outline" id="impBack">Choose another file</button>
        </div>
      `, true);
      document.querySelectorAll('[data-col]').forEach(sel => sel.addEventListener('change', () => {
        const i = Number(sel.dataset.col);
        state.mapping[i] = sel.value;
        // One column per thing: choosing Phone here moves the old Phone column to 'keep'.
        if (!['note', 'skip'].includes(sel.value)) {
          state.mapping.forEach((f, j) => {
            if (j !== i && f === sel.value) {
              state.mapping[j] = 'note';
              document.getElementById(`impCol${j}`).value = 'note';
            }
          });
        }
      }));
      document.getElementById('impBack').addEventListener('click', () => stepChoose());
      document.getElementById('impCheck').addEventListener('click', async (e) => {
        e.target.disabled = true;
        setFormMsg('impMsg', 'Checking every row…', '');
        try {
          stepCheck(await send('check'));
        } catch (err) {
          e.target.disabled = false;
          setFormMsg('impMsg', err.message, 'error');
        }
      });
    }

    function stepCheck(res) {
      const go = cfg.goLabel(res);
      showModal(`
        <h3>Before anything is added</h3>
        ${cfg.renderCheck(res)}
        <div class="form-msg" id="impMsg" role="alert"></div>
        <div class="of-actions">
          ${go ? `<button type="button" class="btn btn-primary" id="impGo">${escapeHtml(go)}</button>` : ''}
          <button type="button" class="btn btn-outline" id="impBack">Back to the columns</button>
        </div>
      `, true);
      document.getElementById('impBack').addEventListener('click', () => stepColumns());
      const btn = document.getElementById('impGo');
      if (btn) btn.addEventListener('click', async () => {
        btn.disabled = true;
        setFormMsg('impMsg', 'Bringing them in…', '');
        try {
          const done = (await send('import')).done;
          closeModal();
          showToast(cfg.doneMessage(done), 'success');
          if (cfg.onDone) cfg.onDone();
        } catch (err) {
          btn.disabled = false;
          setFormMsg('impMsg', err.message, 'error');
        }
      });
    }

    stepChoose();
  }

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  // The rows left out, and anything worth a second look, as the two imports show them.
  const issues = (title, rows, line, openIt) => (rows.length ? `
    <details class="of-past" ${openIt ? 'open' : ''}><summary>${escapeHtml(title)} (${rows.length})</summary>
      <ul class="imp-issues">${rows.map(r => `<li>${line(r)}</li>`).join('')}</ul>
    </details>` : '');

  return { open, plural, issues };
})();
