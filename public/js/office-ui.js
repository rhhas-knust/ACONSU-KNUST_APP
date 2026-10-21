/* ============================================================
   The small toolkit the offices' forms are built from: the
   semester outline, budget requests, minutes, announcements.

   Every file that draws one of those screens shares a page with
   main.js, portal.js and a portal script, and all of them share
   ONE global scope. So nothing here is a top-level name except
   `OfficeUI`; the rest lives inside it.
   Requires main.js (fetchJSON, escapeHtml, showToast) and
   portal.js (setFormMsg) first.
   ============================================================ */
window.OfficeUI = (function () {
  // Numbers and blanks are welcome too: a cost or a count is not a string.
  const esc = (value) => escapeHtml(String(value == null ? '' : value));

  // What each state is called to a person, and how loudly. The wording says what
  // happens next ("Waiting for Finance"), not the database value.
  const STATUS = {
    outline: {
      draft: ['Draft', 'amber'], returned: ['Sent back', 'red'],
      submitted: ['With the Chapter Coordinator', 'amber'], approved: ['Approved and shared', 'green']
    },
    budget: {
      draft: ['Not sent yet', 'amber'], returned: ['Sent back', 'red'], submitted: ['Waiting for Finance', 'amber'],
      recommended: ['Waiting for the Vice President', 'amber'], approved: ['Approved', 'green'], declined: ['Declined', 'red']
    },
    minutes: {
      draft: ['Draft', 'amber'], in_review: ['With the other secretary', 'amber'], approved: ['Shared', 'green'], adopted: ['Shared', 'green']
    },
    call: { open: ['Open', 'green'], closed: ['Closed', 'grey'] },
    seat: { current: ['In office', 'green'], ending: ['Term ending soon', 'amber'], ended: ['Term has ended', 'red'], vacant: ['Empty', 'red'] }
  };

  function chip(text, tone) {
    return `<span class="pill of-chip ${tone || 'grey'}">${esc(text)}</span>`;
  }
  function statusChip(kind, status) {
    const hit = (STATUS[kind] || {})[status];
    return hit ? chip(hit[0], hit[1]) : chip(String(status || ''), 'grey');
  }
  const statusLabel = (kind, status) => (((STATUS[kind] || {})[status]) || [String(status || '')])[0];

  // Plain text in, safe HTML out, line breaks kept.
  const lines = (text) => esc(String(text || '')).replace(/\n/g, '<br>');

  function send(url, method, body) {
    return fetchJSON(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  }

  // Run a button's action once at a time, and say so while it runs.
  async function busy(button, work) {
    if (!button) return work();
    const label = button.textContent;
    button.disabled = true;
    try { return await work(); } finally { button.disabled = false; button.textContent = label; }
  }

  // ---- form fields -------------------------------------------------------
  // One label per control, tied to it, with the hint read out after the label.
  function field(o) {
    const id = o.id;
    const hintId = o.hint ? `${id}-hint` : '';
    const common = `id="${id}"${o.name ? ` name="${esc(o.name)}"` : ''}${o.required ? ' required' : ''}${hintId ? ` aria-describedby="${hintId}"` : ''}${o.attrs ? ' ' + o.attrs : ''}`;
    let control;
    if (o.type === 'textarea') {
      control = `<textarea ${common} rows="${o.rows || 3}"${o.placeholder ? ` placeholder="${esc(o.placeholder)}"` : ''}>${esc(o.value || '')}</textarea>`;
    } else if (o.type === 'select') {
      control = `<select ${common}>${(o.options || []).map(opt => {
        const [value, label] = Array.isArray(opt) ? opt : [opt, opt];
        return `<option value="${esc(value)}"${String(value) === String(o.value || '') ? ' selected' : ''}>${esc(label)}</option>`;
      }).join('')}</select>`;
    } else {
      control = `<input type="${o.type || 'text'}" ${common} value="${esc(o.value == null ? '' : o.value)}"${o.placeholder ? ` placeholder="${esc(o.placeholder)}"` : ''}${o.min !== undefined ? ` min="${o.min}"` : ''}${o.step ? ` step="${o.step}"` : ''}${o.list ? ` list="${id}-list"` : ''}>`
        + (o.list ? `<datalist id="${id}-list">${o.list.map(x => `<option value="${esc(x.name)}"></option>`).join('')}</datalist>` : '');
    }
    return `<div class="field"><label for="${id}">${esc(o.label)}${o.required ? '' : ' <span class="muted">(optional)</span>'}</label>${control}${o.hint ? `<small class="hint" id="${hintId}">${esc(o.hint)}</small>` : ''}</div>`;
  }

  // A numbered stage of a long form. The number is text, so it reads out.
  function section(n, title, intro, body) {
    return `<section class="of-section" aria-labelledby="of-sec-${n}">
      <h3 id="of-sec-${n}"><span class="of-num" aria-hidden="true">${n}</span>${esc(title)}</h3>
      ${intro ? `<p class="of-intro">${esc(intro)}</p>` : ''}
      ${body}
    </section>`;
  }

  // Where a piece of work stands, in words. "Step 2 of 4" is written out so it is
  // never carried by colour alone.
  function steps(labels, current) {
    return `<ol class="of-steps" aria-label="Where this stands">${labels.map((label, i) => {
      const state = i < current ? 'done' : i === current ? 'now' : 'next';
      return `<li class="${state}"${state === 'now' ? ' aria-current="step"' : ''}><span class="of-step-n">Step ${i + 1} of ${labels.length}</span>${esc(label)}</li>`;
    }).join('')}</ol>`;
  }

  function notice(html, tone) {
    return `<div class="of-notice ${tone || ''}" role="${tone === 'bad' ? 'alert' : 'status'}">${html}</div>`;
  }

  // ---- repeating rows ----------------------------------------------------
  // A list the person grows: goals, programmes, budget lines, agenda items.
  // `rowHtml(row, index)` draws one row; every input in it carries data-k="name".
  // The rows are read back with collectRows, so there is no hidden state to drift.
  function repeater(id, rows, rowHtml, o) {
    const opts = o || {};
    return `<div class="of-rows" id="${id}" data-add-label="${esc(opts.addLabel || 'Add another')}">
      ${(rows.length ? rows : (opts.blank !== undefined ? [opts.blank] : [])).map((row, i) => `<div class="of-row" data-row>${rowHtml(row, i)}<button type="button" class="of-remove" data-remove aria-label="Remove this row">Remove</button></div>`).join('')}
    </div>
    <button type="button" class="btn btn-outline btn-sm of-add" data-add-for="${id}">${esc(opts.addLabel || 'Add another')}</button>`;
  }

  function wireRepeaters(root, rowHtmlFor, blankFor) {
    root.addEventListener('click', (e) => {
      const remove = e.target.closest('[data-remove]');
      if (remove) {
        const row = remove.closest('[data-row]');
        const host = row.parentElement;
        row.remove();
        host.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      const add = e.target.closest('[data-add-for]');
      if (add) {
        const id = add.dataset.addFor;
        const host = root.querySelector(`#${id}`);
        const wrap = document.createElement('div');
        wrap.className = 'of-row';
        wrap.setAttribute('data-row', '');
        wrap.innerHTML = rowHtmlFor(id, blankFor(id), host.children.length) + '<button type="button" class="of-remove" data-remove aria-label="Remove this row">Remove</button>';
        host.appendChild(wrap);
        const first = wrap.querySelector('input, select, textarea');
        if (first) first.focus();
        host.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  function collectRows(root, id) {
    const host = root.querySelector(`#${id}`);
    if (!host) return [];
    return [...host.querySelectorAll('[data-row]')].map(row => {
      const out = {};
      row.querySelectorAll('[data-k]').forEach(input => {
        out[input.dataset.k] = input.type === 'checkbox' ? input.checked : input.value;
      });
      return out;
    });
  }

  // A row input: label sits above it, so a row is readable on its own.
  function cell(label, key, value, o) {
    const opts = o || {};
    const type = opts.type || 'text';
    let control;
    if (type === 'select') {
      control = `<select data-k="${key}">${(opts.options || []).map(opt => {
        const [v, l] = Array.isArray(opt) ? opt : [opt, opt];
        return `<option value="${esc(v)}"${String(v) === String(value || '') ? ' selected' : ''}>${esc(l)}</option>`;
      }).join('')}</select>`;
    } else if (type === 'textarea') {
      control = `<textarea data-k="${key}" rows="${opts.rows || 2}">${esc(value || '')}</textarea>`;
    } else if (type === 'checkbox') {
      control = `<input type="checkbox" data-k="${key}"${value ? ' checked' : ''}>`;
    } else {
      control = `<input type="${type}" data-k="${key}" value="${esc(value == null ? '' : value)}"${opts.min !== undefined ? ` min="${opts.min}"` : ''}${opts.step ? ` step="${opts.step}"` : ''}${opts.placeholder ? ` placeholder="${esc(opts.placeholder)}"` : ''}>`;
    }
    return `<label class="of-cell${opts.wide ? ' wide' : ''}"><span>${esc(label)}</span>${control}</label>`;
  }

  // Money in the same form the rest of the portals print it.
  const cedi = (n) => (typeof money === 'function' ? money(n) : `GH₵ ${Number(n || 0).toFixed(2)}`);

  const dayLabel = (v) => (typeof shortDate === 'function' ? shortDate(v) : String(v || ''));

  return { esc, STATUS, chip, statusChip, statusLabel, lines, send, busy, field, section, steps, notice, repeater, wireRepeaters, collectRows, cell, cedi, dayLabel };
})();
