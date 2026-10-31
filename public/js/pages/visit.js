// The script of visit.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
(async function () {
  const settings = (await initLayout('/visit.html')) || {};
  const $ = (id) => document.getElementById(id);
  $('whenIcon').innerHTML = svgIcon(ICON_EVENTS);
  $('whereIcon').innerHTML = svgIcon(ICON_PIN);
  $('expectIcon').innerHTML = svgIcon(ICON_INFO);
  const name = settings.chapterName || 'ACONSU';
  $('visitLede').textContent = `New to ${name}? You are welcome. Here is when we meet, where to find us, and what to expect.`;

  // When
  const times = (settings.serviceTimes || []).filter(Boolean);
  $('visitTimes').innerHTML = times.length
    ? times.map(t => `<li>${escapeHtml(t)}</li>`).join('')
    : '<li class="muted">Our meeting times will be posted here soon. Message us in the meantime and we will tell you.</li>';

  // Where: the hall, the address that finds it, and the chapter's own map link
  // (the one its website uses too), with the map itself on request.
  const place = (settings.meetingPlace || '').trim();
  const address = (settings.address || '').trim();
  if (!place && !address && !settings.mapUrl) {
    $('whereCard').hidden = true;
  } else {
    $('visitPlace').textContent = place;
    $('visitPlace').hidden = !place;
    $('visitAddress').textContent = address && address !== place ? address : '';
    $('visitMap').innerHTML = mapBlockHtml({
      url: settings.mapUrl, place: settings.mapPlace, label: place || address,
      fallbackQuery: [place, address].filter(Boolean).join(', ')
    });
  }

  // What to expect: the chapter's own words when it has written them. Without
  // them, only what is certainly true of every chapter: what it gathers for.
  const own = ((settings.about || {}).firstVisit || '').trim();
  $('visitExpect').innerHTML = own
    ? own.split(/\n{2,}/).map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('')
    : `<p>We gather for the four things the first church held to: the apostles' teaching, fellowship, the breaking of bread, and prayer (Acts 2:42). Expect worship, prayer together, and a message from the Bible.</p>
       <p>You do not need to know anyone before you come.</p>`;

  // Ask: the quickest ways in, as the chapter has listed them.
  const wa = settings.whatsapp || settings.phone;
  const waHref = wa ? (String(wa).startsWith('http') ? wa : `https://wa.me/${String(wa).replace(/[^\d]/g, '')}`) : '';
  const contact = [
    waHref && `<a class="btn btn-primary" href="${escapeHtml(waHref)}" target="_blank" rel="noopener">Message us on WhatsApp</a>`,
    settings.phone && `<a class="btn btn-outline" href="tel:${escapeHtml(settings.phone)}">Call ${escapeHtml(settings.phone)}</a>`,
    settings.email && `<a class="btn btn-outline" href="mailto:${escapeHtml(settings.email)}">Email us</a>`,
    '<a class="btn btn-outline" href="/contact.html">Send a message</a>'
  ].filter(Boolean);
  $('visitContact').innerHTML = contact.join('');

  // Coming up: the next two events, so a visit can be planned around one.
  try {
    const events = await fetchJSON('/api/events');
    const now = new Date();
    const next = events
      .filter(e => new Date(`${e.date}T${e.time || '00:00'}:00`) >= now)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 2);
    if (next.length) {
      $('nextCard').hidden = false;
      $('visitNext').innerHTML = next.map(e => {
        const d = new Date(`${e.date}T00:00:00`);
        return `<p class="visit-event"><strong>${escapeHtml(e.title)}</strong><br>
          <span class="muted">${escapeHtml(d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))}${e.time ? `, ${escapeHtml(e.time)}` : ''}${e.location ? `, ${escapeHtml(e.location)}` : ''}</span></p>`;
      }).join('');
    }
  } catch (e) { /* the page stands without it */ }
})();
