// The script of give.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
// Giving, for anyone (Phase 6). The chapter's own account is shown; the giver
// sends from their own phone and tells us here. A member's gifts are listed
// below; someone without an account gets a receipt link of their own instead
// (routes/giving.js). The amount they type is what they say they sent: the
// team confirms what actually arrived.
const PURPOSE_LABELS = { tithe: 'Tithe', offertory: 'Offering', harvest: 'Harvest', momo: 'General giving', other: 'Other' };
const niceDate = (d) => {
  if (!d) return '';
  const dt = new Date(d);
  return isNaN(dt) ? String(d) : dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
const cedis = (n) => `GH₵ ${Number(n || 0).toFixed(2)}`;
const $ = (id) => document.getElementById(id);
let MEMBER = null;
let INFO = null;
let GIVE_CHAPTER = '';   // the chapter whose account is on screen

function giveStatusLine(g) {
  if (g.status === 'confirmed') {
    const who = g.reviewedBy ? ` by ${escapeHtml(g.reviewedBy)}` : '';
    const on = g.receivedOn ? ` on ${escapeHtml(niceDate(g.receivedOn))}` : '';
    const got = g.amountReceived && Number(g.amountReceived) !== Number(g.amount) ? `: ${cedis(g.amountReceived)} arrived` : '';
    return `<span class="tiny" style="color:var(--ok-ink); font-weight:700;">Received${on}${who}${got}</span>`;
  }
  if (g.status === 'rejected') {
    return `<span class="tiny" style="color:var(--bad-ink, #A93226); font-weight:700;">Not found in the account${g.reviewNotes || g.note ? ': ' + escapeHtml(g.reviewNotes || g.note) : ''}</span>`;
  }
  return '<span class="tiny muted">Waiting for the team to check the account</span>';
}

// A receipt: what, how much, where it stands. The same card whether it is
// shown straight after giving or opened later from its link.
function showReceipt(r, link) {
  const card = $('receiptCard');
  const state = r.status === 'confirmed' ? 'Received' : r.status === 'rejected' ? 'Not found yet' : 'Waiting to be confirmed';
  card.innerHTML = `
    <p class="receipt-state receipt-${escapeHtml(r.status)}">${state}</p>
    <h2>${r.firstName ? `Thank you, ${escapeHtml(r.firstName)}.` : 'Thank you.'}</h2>
    <dl class="receipt-lines">
      <dt>Chapter</dt><dd>${escapeHtml(r.chapterName)}</dd>
      <dt>For</dt><dd>${escapeHtml(PURPOSE_LABELS[r.purpose] || 'Giving')}${r.toWelfare ? ' (to the Welfare account)' : ''}</dd>
      <dt>You said you sent</dt><dd>${cedis(r.amount)}</dd>
      ${r.status === 'confirmed' ? `<dt>The account received</dt><dd>${cedis(r.amountReceived || r.amount)}${r.receivedOn ? `, ${escapeHtml(niceDate(r.receivedOn))}` : ''}</dd>` : ''}
      <dt>Told us</dt><dd>${escapeHtml(niceDate(r.loggedOn))}</dd>
    </dl>
    ${r.status === 'pending' ? '<p class="muted">The team checks the account and confirms it, usually within a few days. You will get a text when they do, where your chapter can send texts.</p>' : ''}
    ${r.status === 'rejected' ? `<p class="muted">${r.note ? escapeHtml(r.note) + ' ' : ''}If you did send it, show the confirmation text to the finance team.</p>` : ''}
    ${link ? `<div class="receipt-link"><p><strong>Keep this link</strong> to see when it arrives:</p><p class="tiny receipt-url">${escapeHtml(link)}</p>
      <button type="button" class="btn btn-outline btn-sm" id="copyReceipt">Copy the link</button></div>` : ''}`;
  card.hidden = false;
  card.focus();
  const copy = $('copyReceipt');
  if (copy) copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(link); copy.textContent = 'Copied'; } catch (e) { copy.textContent = 'Select the link above to copy it'; }
  });
}

async function loadHistory() {
  const wrap = $('giveHistory');
  if (!MEMBER) { wrap.innerHTML = ''; return; }
  $('historyHead').hidden = false;
  try {
    const items = await fetchJSON('/api/giving/mine');
    wrap.innerHTML = items.map(g => `
      <div class="give-history-row">
        <span>
          ${escapeHtml(PURPOSE_LABELS[g.purpose] || g.purpose)}: ${cedis(g.amount)}
          <br>${giveStatusLine(g)}
        </span>
      </div>
    `).join('') || '<p class="empty-state">No giving yet.</p>';
  } catch (e) {
    wrap.innerHTML = '<p class="empty-state">Could not load your giving.</p>';
  }
}

// Tithe goes to Welfare's own account. Telling somebody that in a footnote
// while showing them the chapter number is how money ends up in the wrong
// purse, so the number on screen changes with the purpose.
function renderPayInfo() {
  if (!INFO) return;
  const toWelfare = (INFO.welfarePurposes || []).includes($('purpose').value);
  const p = toWelfare ? INFO.welfare : INFO.general;
  $('payInfo').innerHTML = `
    <div class="pay-details">
      <h2 style="margin-bottom:4px; font-size:1.2rem;">${escapeHtml(INFO.chapterName)}</h2>
      ${toWelfare ? '<p class="pill amber" style="margin:6px 0 12px;">Tithe goes to the Welfare account</p>' : ''}
      ${!toWelfare && INFO.label ? `<dt>Giving channel</dt><dd>${escapeHtml(INFO.label)}</dd>` : ''}
      ${p.momoNumber
        ? `<dt>${toWelfare ? 'Welfare Mobile Money' : 'Mobile Money'}</dt><dd>${escapeHtml(p.momoNumber)}${p.momoName ? ': ' + escapeHtml(p.momoName) : ''}</dd>`
        : `<p class="empty-state" style="margin:8px 0;">${toWelfare
            ? 'Welfare has not published its account yet. Ask the Welfare team before sending your tithe.'
            : 'No Mobile Money number on file yet.'}</p>`}
      ${p.bankName ? `<dt>Bank</dt><dd>${escapeHtml(p.bankName)}</dd>` : ''}
      ${p.bankAccountNumber ? `<dt>Account</dt><dd>${escapeHtml(p.bankAccountName || '')} ${escapeHtml(p.bankAccountNumber)}</dd>` : ''}
      <p style="font-size:0.8rem; color:var(--ink-faint); margin-top:14px;">You send it with your own MoMo or bank app. This page takes no payment itself.</p>
    </div>`;
}

async function loadChapter(chapterId) {
  INFO = null;
  GIVE_CHAPTER = chapterId || '';
  $('giveForm').hidden = true;
  if (!chapterId) { $('payInfo').innerHTML = '<p class="empty-state">Choose your chapter to see where to give.</p>'; return; }
  try {
    INFO = await fetchJSON(`/api/giving/info?chapterId=${encodeURIComponent(chapterId)}`);
  } catch (e) {
    $('payInfo').innerHTML = '<p class="empty-state">Could not load the giving details right now.</p>';
    return;
  }
  if (!INFO.configured) {
    $('payInfo').innerHTML = `<p class="empty-state">${escapeHtml(INFO.chapterName || 'This chapter')} has not set up giving details yet. Check back soon.</p>`;
    INFO = null;
    return;
  }
  const nets = $('payerNetwork');
  nets.innerHTML = '<option value="">Choose one</option>' + Object.entries(INFO.networks || {}).map(([k, v]) => `<option value="${escapeHtml(k)}">${escapeHtml(v)}</option>`).join('');
  renderPayInfo();
  $('giveForm').hidden = false;
}

(async function () {
  await initLayout('/give.html');
  const params = new URLSearchParams(location.search);
  const receipt = params.get('receipt');
  if (receipt) {
    try { showReceipt(await fetchJSON(`/api/giving/receipt/${encodeURIComponent(receipt)}`), ''); }
    catch (e) { $('receiptCard').innerHTML = `<p class="empty-state">${escapeHtml(e.message || 'There is no receipt at this link.')}</p>`; $('receiptCard').hidden = false; }
  }
  const authRes = await fetchJSON('/api/auth/me').catch(() => ({ member: null }));
  MEMBER = authRes.member;
  // Someone without an account gives their name and agrees to it being kept;
  // a member is known already.
  document.querySelectorAll('[data-guest]').forEach(el => { el.hidden = !!MEMBER; });
  document.querySelectorAll('[data-member]').forEach(el => { el.hidden = !MEMBER; });
  if (MEMBER && MEMBER.phone) $('payerNumber').value = MEMBER.phone;
  let chapterId = MEMBER ? MEMBER.chapterId : getSelectedChapterId();
  if (!MEMBER) {
    try {
      const chapters = await fetchJSON('/api/chapters');
      if (chapters.length > 1) {
        const pick = $('giveChapter');
        pick.innerHTML = '<option value="">Choose your chapter</option>' + chapters.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
        pick.value = chapters.some(c => c.id === chapterId) ? chapterId : '';
        chapterId = pick.value;
        $('chapterPick').hidden = false;
        pick.addEventListener('change', () => { setSelectedChapterId(pick.value); loadChapter(pick.value); });
      } else if (chapters.length === 1) chapterId = chapters[0].id;
    } catch (e) { /* the selected chapter, if any, is enough */ }
  }
  await loadChapter(chapterId);
  $('purpose').addEventListener('change', renderPayInfo);
  loadHistory();
})();

$('giveForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('giveSubmitBtn');
  const msg = $('giveMsg');
  const say = (text, focus) => { msg.textContent = text; msg.className = 'form-msg error'; if (focus) $(focus).focus(); };
  const amount = Number(String($('amount').value).replace(/[^\d.]/g, ''));
  if (!(amount > 0)) return say('Type the amount you sent, in cedis.', 'amount');
  if (!MEMBER) {
    if ($('giverName').value.trim().length < 2) return say('Type your name, so the team knows whose gift it is.', 'giverName');
    if ($('payerNumber').value.replace(/\D/g, '').length < 9) return say('Type the phone number you sent it from.', 'payerNumber');
    if (!$('giveConsent').checked) return say('Tick the box to say we may keep these details with your gift.', 'giveConsent');
  }
  btn.disabled = true;
  const body = {
    amount, purpose: $('purpose').value, method: $('method').value, reference: $('reference').value,
    payerNumber: $('payerNumber').value, payerNetwork: $('payerNetwork').value
  };
  try {
    if (MEMBER) {
      await fetchJSON('/api/giving/intents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      msg.textContent = 'Thank you. The team will confirm it against the account, and you will be told here.';
      msg.className = 'form-msg success';
      $('giveForm').reset();
      loadHistory();
    } else {
      const out = await fetchJSON('/api/giving/guest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, chapterId: GIVE_CHAPTER, name: $('giverName').value, consent: true, website: $('giveWebsite').value })
      });
      $('giveForm').hidden = true;
      msg.textContent = '';
      if (out.receipt) showReceipt(out.receipt, `${location.origin}/give.html?receipt=${out.receipt.token}`);
      window.scrollTo(0, 0);
    }
  } catch (err) {
    say(err.message || 'Could not record this.');
  } finally {
    btn.disabled = false;
  }
});
