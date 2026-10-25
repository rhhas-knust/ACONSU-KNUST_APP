/* ============================================================
   Shepherding: Sunday check-in at the door, and bringing the
   chapter's own list in from a spreadsheet (CSV).
   The server side is routes/shepherd-list.js. Loaded before
   shepherd.js, which puts these panels in the portal.
   ============================================================ */

// One key for a person whether they come from the people list or from a
// mark on the register: an account holder by their member id, everyone else
// by their list record.
const ciKey = (p) => (p.memberId ? `m:${p.memberId}` : `r:${p.recordId}`);

// How someone with no account came to be on the list, in a few words.
function listLabel(p) {
  if (p.source !== 'visitor') return '';
  if (p.origin === 'import') return 'On the chapter list. No app account yet';
  if (p.origin === 'checkin') return 'New at the door. No account';
  return 'Visitor. No account';
}

// A name matches when every word typed starts one of its words ("ama ow"
// finds Ama Owusu); three or more digits look in the phone number instead.
function ciMatches(p, term) {
  const t = term.trim().toLowerCase();
  if (!t) return false;
  const digits = t.replace(/\D/g, '');
  if (digits.length >= 3 && /^[\d\s+()-]+$/.test(t)) return (p.phone || '').replace(/\D/g, '').includes(digits.replace(/^233/, '').replace(/^0/, ''));
  const words = (p.name || '').toLowerCase().split(/[\s'’.-]+/).filter(Boolean);
  return t.split(/\s+/).every(w => words.some(part => part.startsWith(w)));
}

function ciTime(at) {
  if (!at) return '';
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---------- Sunday check-in ----------
// The screen for the door. Everyone on the list, and everyone with an
// account, is a name to tap. One tap checks them in and is saved there and
// then, so a phone that sleeps or loses signal halfway through loses nothing
// already done. Several phones can work the door together: each shows the
// same count, refreshed every few seconds.
const checkinState = { date: '', serviceType: 'sunday' };
// Short, so the choice fits beside the date on a phone.
const CI_SERVICE_LABELS = { sunday: 'Sunday', midweek: 'Midweek', special: 'Special' };
let checkinTimer = null;

async function renderCheckIn(el) {
  if (checkinTimer) { clearInterval(checkinTimer); checkinTimer = null; }
  if (!checkinState.date) checkinState.date = todayISO();
  const q = `date=${checkinState.date}&serviceType=${checkinState.serviceType}`;
  let [people, live] = await Promise.all([
    fetchJSON('/api/shepherd/members'),
    fetchJSON(`/api/attendance/checkins?${q}`)
  ]);
  const canEdit = PORTAL.canEdit;
  let present = new Map(live.present.map(m => [ciKey(m), m]));

  el.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Sunday Check-In</h2>
        <p class="sub">Tap each person's name as they arrive. It saves at once, and every phone at the door shows the same count.</p>
      </div>
    </div>

    <div class="portal-card ci-bar">
      <div class="ci-count" aria-live="polite"><b id="ciCount">${present.size}</b> <span>checked in</span></div>
      <div class="inline-form ci-when">
        <div class="field"><label for="ciDate">Date</label><input type="date" id="ciDate" value="${checkinState.date}"></div>
        <div class="field"><label for="ciService">Service</label>
          <select id="ciService">${SERVICE_TYPES.map(s => `<option value="${s.value}" ${checkinState.serviceType === s.value ? 'selected' : ''}>${CI_SERVICE_LABELS[s.value] || s.label}</option>`).join('')}</select>
        </div>
      </div>
    </div>

    ${canEdit ? `
    <div class="portal-card">
      <label class="ci-label" for="ciSearch">Find their name</label>
      <input type="search" id="ciSearch" class="ci-search" placeholder="Type a name or phone number" autocomplete="off" autocapitalize="words" enterkeyhint="search">
      <p class="tiny muted" id="ciHint">${people.length ? `${people.length} people on the list.` : 'Nobody is on the list yet. Bring your list in from Members, or add people as they arrive.'}</p>
      <ul class="ci-results" id="ciResults" aria-label="Matching names"></ul>
      <div id="ciNewWrap"></div>
      <div class="form-msg" id="ciMsg" role="status"></div>
    </div>` : ''}

    <div class="portal-card">
      <h3>Checked in so far</h3>
      <ul class="ci-list" id="ciList"></ul>
    </div>

    ${canEdit ? `
    <div class="portal-card">
      <h3>Scan a membership card</h3>
      <p class="hint">Members with the app can show the QR code on their membership card instead.</p>
      <button type="button" class="btn btn-outline btn-sm" id="startScanBtn">Scan a card</button>
      <div id="scanArea" style="display:none; margin-top:14px;">
        <video id="scanVideo" style="width:100%; max-width:360px; border-radius:12px; background:#000;" playsinline muted></video>
        <div><button type="button" class="btn btn-outline btn-sm" id="stopScanBtn" style="margin-top:8px;">Stop scanning</button></div>
      </div>
    </div>` : ''}
  `;

  const countEl = document.getElementById('ciCount');
  const listEl = document.getElementById('ciList');
  const say = (text, type) => setFormMsg('ciMsg', text, type || '');

  function drawList() {
    countEl.textContent = String(present.size);
    const rows = [...present.values()].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
    listEl.innerHTML = rows.map(m => `
      <li>
        <span class="ci-name">${escapeHtml(m.name)}</span>
        <span class="tiny muted">${ciTime(m.at)}</span>
        ${canEdit ? `<button type="button" class="ci-undo" data-undo="${escapeHtml(ciKey(m))}" aria-label="Take back ${escapeHtml(m.name)}'s check-in">Undo</button>` : ''}
      </li>`).join('') || '<li class="muted">Nobody yet.</li>';
    listEl.querySelectorAll('[data-undo]').forEach(b => b.addEventListener('click', () => undo(b.dataset.undo)));
  }

  const bodyFor = (key) => ({
    ...(key.startsWith('m:') ? { memberId: key.slice(2) } : { recordId: key.slice(2) }),
    date: checkinState.date, serviceType: checkinState.serviceType
  });
  const post = (url, body) => fetchJSON(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  async function checkIn(person) {
    const key = ciKey(person);
    if (present.has(key)) return;
    present.set(key, { memberId: person.memberId, recordId: person.recordId, name: person.name, at: new Date().toISOString() });
    drawList();
    clearSearch();
    try {
      const res = await post('/api/attendance/mark', bodyFor(key));
      countEl.textContent = String(Math.max(present.size, res.present || 0));
      say(`${res.person.name} is checked in.`, 'success');
    } catch (err) {
      present.delete(key);
      drawList();
      say(`${person.name} was not checked in: ${err.message}`, 'error');
    }
  }

  async function undo(key) {
    const was = present.get(key);
    if (!was) return;
    present.delete(key);
    drawList();
    try {
      await post('/api/attendance/unmark', bodyFor(key));
      say(`${was.name}'s check-in was taken back.`, 'success');
    } catch (err) {
      present.set(key, was);
      drawList();
      say(err.message || 'Could not take that back.', 'error');
    }
  }

  // What other phones at the door have done since: their check-ins, and
  // anyone they added who is not on this phone's list yet.
  async function refresh() {
    if (PORTAL.active !== 'checkin' || !document.body.contains(listEl)) {
      clearInterval(checkinTimer); checkinTimer = null; return;
    }
    try {
      live = await fetchJSON(`/api/attendance/checkins?date=${checkinState.date}&serviceType=${checkinState.serviceType}`);
      present = new Map(live.present.map(m => [ciKey(m), m]));
      drawList();
      const known = new Set(people.map(ciKey));
      if (live.present.some(m => !known.has(ciKey(m)))) people = await fetchJSON('/api/shepherd/members');
    } catch (e) { /* the next refresh will try again */ }
  }
  checkinTimer = setInterval(refresh, 15000);

  drawList();

  const reopen = () => {
    checkinState.date = document.getElementById('ciDate').value || todayISO();
    checkinState.serviceType = document.getElementById('ciService').value;
    openPanel('checkin');
  };
  document.getElementById('ciDate').addEventListener('change', reopen);
  document.getElementById('ciService').addEventListener('change', reopen);

  if (!canEdit) return;

  const search = document.getElementById('ciSearch');
  const results = document.getElementById('ciResults');
  const newWrap = document.getElementById('ciNewWrap');

  function clearSearch() {
    search.value = '';
    results.innerHTML = '';
    newWrap.innerHTML = '';
    search.focus({ preventScroll: true });
  }

  function drawResults() {
    const term = search.value;
    if (!term.trim()) { results.innerHTML = ''; newWrap.innerHTML = ''; return; }
    const matches = people.filter(p => ciMatches(p, term)).slice(0, 8);
    results.innerHTML = matches.map((p) => {
      const key = ciKey(p);
      const isIn = present.has(key);
      // The name, and the phone number only: enough to tell two people of the
      // same name apart at the door, short enough to read at a glance.
      return `
        <li>
          <button type="button" class="ci-person ${isIn ? 'is-in' : ''}" data-key="${escapeHtml(key)}" ${isIn ? 'aria-disabled="true"' : ''}>
            ${avatar(p)}
            <span class="who"><strong>${escapeHtml(p.name)}</strong>${p.phone ? `<small>${escapeHtml(p.phone)}</small>` : ''}</span>
            <span class="ci-action">${isIn ? 'Checked in' : 'Check in'}</span>
          </button>
        </li>`;
    }).join('');
    results.querySelectorAll('.ci-person').forEach((b) => b.addEventListener('click', () => {
      const p = people.find(x => ciKey(x) === b.dataset.key);
      if (p && !present.has(b.dataset.key)) checkIn(p);
    }));
    newWrap.innerHTML = term.trim().length >= 2 ? `
      <p class="ci-new-line">${matches.length ? 'Someone else?' : 'Not on the list?'}
        <button type="button" class="link-btn" id="ciNewBtn">Add “${escapeHtml(term.trim())}” as someone new</button>
      </p>` : '';
    const newBtn = document.getElementById('ciNewBtn');
    if (newBtn) newBtn.addEventListener('click', () => openNewcomer(term.trim()));
  }

  // Someone at the door who is not on the list: added (as new, for the team
  // to follow up) and checked in, in one go.
  function openNewcomer(name) {
    newWrap.innerHTML = `
      <form class="ci-new" id="ciNewForm" novalidate>
        <h3>Someone new</h3>
        <div class="field"><label for="ciNewName">Their name</label><input type="text" id="ciNewName" value="${escapeHtml(name)}" autocomplete="off" autocapitalize="words" required></div>
        <div class="field"><label for="ciNewPhone">Phone (so the team can welcome them)</label><input type="tel" id="ciNewPhone" autocomplete="off" inputmode="tel"></div>
        <div class="of-actions">
          <button type="submit" class="btn btn-primary">Add and check in</button>
          <button type="button" class="btn btn-outline" id="ciNewCancel">Cancel</button>
        </div>
      </form>`;
    document.getElementById('ciNewPhone').focus();
    document.getElementById('ciNewCancel').addEventListener('click', clearSearch);
    document.getElementById('ciNewForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('[type="submit"]');
      btn.disabled = true;
      try {
        const res = await post('/api/attendance/newcomer', {
          name: document.getElementById('ciNewName').value,
          phone: document.getElementById('ciNewPhone').value,
          date: checkinState.date, serviceType: checkinState.serviceType
        });
        present.set(ciKey(res.person), { ...res.person, at: new Date().toISOString() });
        drawList();
        clearSearch();
        say(res.wasOnList
          ? `${res.person.name} was already on the list, by their phone number, and is checked in.`
          : `${res.person.name} is added to the list and checked in. Welcome them!`, 'success');
        people = await fetchJSON('/api/shepherd/members');
      } catch (err) {
        say(err.message || 'Could not add them.', 'error');
        btn.disabled = false;
      }
    });
  }

  // A new name typed: what was said about the last person no longer applies.
  search.addEventListener('input', () => { say(''); drawResults(); });
  // Enter checks in the only match, so a quick typist never has to reach for the screen.
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const open = people.filter(p => ciMatches(p, search.value) && !present.has(ciKey(p)));
    if (open.length === 1) checkIn(open[0]);
  });
  // Ready to type, without scrolling the heading away under the top bar.
  search.focus({ preventScroll: true });

  wireCardScan(async (qrToken) => {
    try {
      const res = await post('/api/attendance/scan', { qrToken, date: checkinState.date, serviceType: checkinState.serviceType });
      present.set(ciKey(res.person), { ...res.person, at: new Date().toISOString() });
      drawList();
      say(res.alreadyMarked ? `${res.person.name} was already checked in.` : `${res.person.name} is checked in.`, 'success');
    } catch (err) {
      say(err.message || 'Could not read that card.', 'error');
    }
  }, (text) => say(text, 'error'));
}

// The camera, for the QR code on a membership card. Not every browser can read
// one yet (BarcodeDetector), and then the button says so.
function wireCardScan(onCode, onProblem) {
  const startBtn = document.getElementById('startScanBtn');
  const stopBtn = document.getElementById('stopScanBtn');
  const scanArea = document.getElementById('scanArea');
  const video = document.getElementById('scanVideo');
  if (!startBtn) return;
  if (!('BarcodeDetector' in window)) {
    startBtn.disabled = true;
    startBtn.textContent = 'This browser cannot scan cards. Use the names above';
    return;
  }
  let stream = null;
  let timer = null;
  let last = '';
  const stop = () => {
    if (timer) clearInterval(timer);
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; timer = null;
    scanArea.style.display = 'none';
  };
  startBtn.addEventListener('click', async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream;
      await video.play();
      scanArea.style.display = 'block';
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      let busy = false;
      timer = setInterval(async () => {
        if (busy || !document.body.contains(video)) { if (!document.body.contains(video)) stop(); return; }
        busy = true;
        try {
          const codes = await detector.detect(video);
          // The same card held up for a second is one check-in, not five.
          if (codes.length && codes[0].rawValue !== last) { last = codes[0].rawValue; await onCode(last); }
        } catch (e) { /* a frame it could not read: the next one may */ }
        busy = false;
      }, 800);
    } catch (e) {
      onProblem('Could not open the camera. You can still check people in by name above.');
    }
  });
  stopBtn.addEventListener('click', stop);
}

// ---------- bringing the list in ----------
// The steps are csv-import.js's; what is said at each is the list's.
function openImportList(onDone) {
  const { plural, issues } = CsvImport;
  const why = (p) => (p.action === 'fill' ? `Already on the list as ${p.matchName}. Their missing details are filled in from your file.`
    : p.action === 'same' ? `Already on the list as ${p.matchName}.`
      : `Already has an app account, as ${p.matchName}.`);
  CsvImport.open({
    url: '/api/shepherd/import',
    title: 'Bring in your list',
    steps: [
      'Open your list in Excel or Google Sheets, with a row of headings at the top (Name, Phone, Level, Hall…).',
      'Save it as a CSV file. In Excel: File, Save As, "CSV UTF-8". In Google Sheets: File, Download, "Comma-separated values".',
      'Choose that file here. You will see what it holds before anything is added.'
    ],
    fileLabel: 'Your list (CSV file)',
    headerLabel: 'The first row is headings, not a person',
    templateUrl: '/api/shepherd/import/template.csv',
    templateLabel: 'Download a sample list',
    rowNoun: ['person', 'people'],
    columnsHint: 'Check each column is matched to the right thing. Anything without a place of its own can be kept in the person\'s notes.',
    checkLabel: 'Check the list',
    renderCheck: (res) => {
      const c = res.counts;
      return `
        <ul class="imp-summary">
          <li class="good"><strong>${plural(c.add, 'person', 'people')}</strong> will be added to the list.</li>
          ${c.fill ? `<li><strong>${plural(c.fill, 'person is', 'people are')}</strong> already on the list; blanks in their details will be filled in. Nothing already there is changed.</li>` : ''}
          ${c.same ? `<li><strong>${plural(c.same, 'person is', 'people are')}</strong> already on the list, and the file adds nothing new about them.</li>` : ''}
          ${c.account ? `<li><strong>${plural(c.account, 'person has', 'people have')}</strong> an app account already, so ${c.account === 1 ? 'is' : 'are'} not added again.</li>` : ''}
          ${c.skip ? `<li class="warn"><strong>${plural(c.skip, 'row is', 'rows are')}</strong> left out (below).</li>` : ''}
        </ul>
        ${res.adding.length ? `
          <h4>The first few to be added</h4>
          <div class="table-wrap"><table class="portal-table imp-preview">
            <thead><tr><th>Row</th><th>Name</th><th>Phone</th><th>Level</th><th>Hall / hostel</th></tr></thead>
            <tbody>${res.adding.map(p => `<tr><td>${p.row}</td><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.phone || '-')}</td><td>${escapeHtml(p.level || '-')}</td><td>${escapeHtml(p.address || '-')}</td></tr>`).join('')}</tbody>
          </table></div>` : ''}
        ${issues('Left out', res.notAdding.filter(p => p.action === 'skip'), p => `Row ${p.row}${p.name ? `, ${escapeHtml(p.name)}` : ''}: ${escapeHtml(p.reason)}`, true)}
        ${issues('Worth checking', res.warnings, p => `Row ${p.row}, ${escapeHtml(p.name)}: ${p.warnings.map(escapeHtml).join(' ')}`)}
        ${issues('Already known', res.notAdding.filter(p => ['fill', 'same', 'account'].includes(p.action)), p => `Row ${p.row}, ${escapeHtml(p.name)}: ${escapeHtml(why(p))}`)}`;
    },
    goLabel: (res) => (res.counts.add || res.counts.fill ? `Bring in ${res.counts.add ? plural(res.counts.add, 'person', 'people') : 'the missing details'}` : ''),
    doneMessage: (done) => `${plural(done.added, 'person', 'people')} added${done.filled ? `, ${done.filled} updated` : ''}.`,
    onDone
  });
}
