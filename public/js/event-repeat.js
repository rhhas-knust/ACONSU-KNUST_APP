// "Repeats" on an event form, and "Call off the next one" / "Move the next
// one" on a repeating event: shared by the admin and Publicity portals. The
// server works the series out (lib/recurrence.js); this only asks for the rule
// and shows it in words as it is chosen.
window.AconsuRepeat = (function () {
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const ORD = ['First', 'Second', 'Third', 'Fourth'];
  const parse = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? new Date(`${s}T00:00:00Z`) : null);
  const nth = (d) => { const n = Math.ceil(d.getUTCDate() / 7); return n >= 5 ? 'Last' : ORD[n - 1]; };
  const ordinal = (n) => n + ((n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
  const dayLabel = (s) => { const d = parse(s); return d ? d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }) : ''; };

  function words(every, monthBy, date, until) {
    const d = parse(date);
    if (!every || !d) return '';
    const wd = WEEKDAYS[d.getUTCDay()];
    let w = every === 'week' ? `Every ${wd}`
      : every === '2weeks' ? `Every other ${wd}`
        : monthBy === 'weekday' ? `${nth(d)} ${wd} of every month` : `Monthly on the ${ordinal(d.getUTCDate())}`;
    if (until) w += `, until ${dayLabel(until)}`;
    return w;
  }

  // The fields, for a form whose date box is `dateSelector`.
  function fieldsHtml(event) {
    const r = (event && event.repeat) || {};
    const every = r.every || '';
    return `
      <fieldset class="field repeat-box" data-repeat-box>
        <legend>Repeats</legend>
        <select data-repeat-every aria-label="How often it repeats">
          <option value="" ${!every ? 'selected' : ''}>Does not repeat</option>
          <option value="week" ${every === 'week' ? 'selected' : ''}>Every week</option>
          <option value="2weeks" ${every === '2weeks' ? 'selected' : ''}>Every other week</option>
          <option value="month" ${every === 'month' ? 'selected' : ''}>Every month</option>
        </select>
        <div data-repeat-month ${every === 'month' ? '' : 'hidden'}>
          <label class="choice-line"><input type="radio" name="repeatMonthBy" value="date" ${r.monthBy !== 'weekday' ? 'checked' : ''}> <span data-repeat-bydate>On the same date</span></label>
          <label class="choice-line"><input type="radio" name="repeatMonthBy" value="weekday" ${r.monthBy === 'weekday' ? 'checked' : ''}> <span data-repeat-byweekday>On the same weekday</span></label>
        </div>
        <div data-repeat-more ${every ? '' : 'hidden'}>
          <label for="repeatUntil">Until (optional)</label>
          <input type="date" id="repeatUntil" data-repeat-until value="${r.until || ''}">
          <p class="hint" data-repeat-words aria-live="polite"></p>
          <p class="hint">After each one, the event moves to the next date by itself. Registrations start afresh for each one, and the deadline below is only for events that do not repeat.</p>
        </div>
      </fieldset>`;
  }

  function wire(root, dateSelector) {
    const box = root.querySelector('[data-repeat-box]');
    if (!box) return;
    const dateEl = root.querySelector(dateSelector);
    const sel = box.querySelector('[data-repeat-every]');
    const update = () => {
      const every = sel.value;
      box.querySelector('[data-repeat-month]').hidden = every !== 'month';
      box.querySelector('[data-repeat-more]').hidden = !every;
      const d = parse(dateEl && dateEl.value);
      if (d) {
        box.querySelector('[data-repeat-bydate]').textContent = `On the ${ordinal(d.getUTCDate())} of each month`;
        box.querySelector('[data-repeat-byweekday]').textContent = `On the ${nth(d).toLowerCase()} ${WEEKDAYS[d.getUTCDay()]} of each month`;
      }
      const r = read(root);
      box.querySelector('[data-repeat-words]').textContent = r.every
        ? (d ? `${words(r.every, r.monthBy, dateEl.value, r.until)}.` : 'Choose the first date above.')
        : '';
    };
    [sel, dateEl, box.querySelector('[data-repeat-until]'), ...box.querySelectorAll('input[name="repeatMonthBy"]')]
      .filter(Boolean).forEach(x => x.addEventListener('change', update));
    update();
  }

  function read(root) {
    const box = root.querySelector('[data-repeat-box]');
    if (!box) return undefined;
    const every = box.querySelector('[data-repeat-every]').value;
    const by = box.querySelector('input[name="repeatMonthBy"]:checked');
    return { every, monthBy: by ? by.value : 'date', until: every ? box.querySelector('[data-repeat-until]').value : '' };
  }

  // "Call off" and "Move" for the next time, opened from an events table.
  // `base` is the portal's events address (/api/admin/events or
  // /api/publicity/events); `done` redraws the table.
  function openNextOne(event, base, done) {
    showModal(`
      <h3>${escapeHtml(event.title)}: ${escapeHtml(dayLabel(event.date))}</h3>
      <p class="hint">${escapeHtml(event.recurring || 'Repeats')}. Only this one changes; the rest of the series stays as it is. The chapter is told.</p>
      <form id="moveNextForm">
        <div class="field-row">
          <div class="field"><label for="mnDate">New date</label><input type="date" id="mnDate" value="${escapeHtml(event.date)}" required></div>
          <div class="field"><label for="mnTime">New time</label><input type="time" id="mnTime" value="${escapeHtml(event.time || '')}"></div>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button type="submit" class="btn btn-primary">Move this one</button>
          <button type="button" class="btn btn-danger" id="skipNextBtn">Call this one off</button>
          <button type="button" class="btn btn-outline" id="cancelModalBtn">Cancel</button>
        </div>
        <div class="form-msg" id="nextOneMsg" role="status"></div>
      </form>`);
    const msg = document.getElementById('nextOneMsg');
    const fail = (err) => { msg.textContent = err.message || 'Could not do that.'; msg.className = 'form-msg error'; };
    document.getElementById('cancelModalBtn').addEventListener('click', closeModal);
    document.getElementById('moveNextForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await fetchJSON(`${base}/${encodeURIComponent(event.id)}/move-next`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: document.getElementById('mnDate').value, time: document.getElementById('mnTime').value })
        });
        closeModal();
        done();
      } catch (err) { fail(err); }
    });
    document.getElementById('skipNextBtn').addEventListener('click', async () => {
      if (!window.confirm(`Call off ${event.title} on ${dayLabel(event.date)}? The event moves to the one after.`)) return;
      try {
        await fetchJSON(`${base}/${encodeURIComponent(event.id)}/skip-next`, { method: 'POST' });
        closeModal();
        done();
      } catch (err) { fail(err); }
    });
  }

  return { fieldsHtml, wire, read, words, openNextOne, dayLabel };
})();
