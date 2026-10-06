/* ---------------------------------------------------------------------------
   Fills the page from chapter.js. No framework, no build step, no server.

   The governing rule: ANYTHING LEFT BLANK DISAPPEARS. A chapter can publish
   this with half of it filled in and it still reads as a finished site rather
   than a template someone abandoned. That is what makes it safe to put up
   today and finish later.
--------------------------------------------------------------------------- */
(function () {
  'use strict';
  var C = window.CHAPTER || {};

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function has(v) {
    return Array.isArray(v) ? v.length > 0 : !!(v && String(v).trim());
  }
  function show(el) { if (el) el.hidden = false; }

  // ---- simple text bindings -------------------------------------------
  var TEXT = {
    name: C.name, fullName: C.fullName, institution: C.institution,
    location: C.location, tagline: C.tagline, lede: C.lede, address: C.address,
    story: C.story, belief: C.belief, vision: C.vision, values: C.values,
    verseText: C.verse && C.verse.text, verseRef: C.verse && C.verse.reference,
    churchName: C.church && C.church.name, churchBlurb: C.church && C.church.blurb
  };
  Object.keys(TEXT).forEach(function (key) {
    var value = TEXT[key];
    document.querySelectorAll('[data-bind="' + key + '"]').forEach(function (el) {
      if (has(value)) el.textContent = value;
      else if (el.tagName === 'P' || el.tagName === 'BLOCKQUOTE') el.remove();
    });
  });

  if (has(C.name)) document.title = C.name;

  // The two About cards stand or fall on their own text.
  if (has(C.vision)) show(document.querySelector('[data-card="vision"]'));
  if (has(C.values)) show(document.querySelector('[data-card="values"]'));

  // ---- a photo beside the heading ---------------------------------------
  // A real picture next to the words rather than behind them, so the heading
  // never depends on what was photographed. With no photo the opening is just
  // text, and nothing is left where a picture would have been.
  (function () {
    var hero = document.querySelector('.hero');
    var box = document.getElementById('heroPhoto');
    var img = document.getElementById('heroImg');
    if (!hero || !box || !img) return;
    if (!has(C.heroImage)) { box.remove(); hero.classList.add('no-photo'); return; }
    img.alt = has(C.heroImageAlt) ? C.heroImageAlt : '';
    // A grey block pulses until the picture arrives, so the page does not jump.
    box.hidden = false;
    var done = function () { box.classList.remove('is-loading'); };
    img.addEventListener('load', done);
    img.addEventListener('error', function () { box.remove(); hero.classList.add('no-photo'); });
    img.src = C.heroImage;
    if (img.complete && img.naturalWidth) done();
  })();

  // ---- freshers ---------------------------------------------------------
  // Two kinds of WhatsApp link, and they behave differently:
  //   chat.whatsapp.com/...  a group invite. Cannot carry a prefilled message.
  //   a bare number          a chat with one person, which can.
  // Anything already a URL is left alone rather than guessed at.
  function whatsappLink(raw, message) {
    var v = String(raw || '').trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) {
      // A group invite takes no ?text=, so adding one would break the link.
      if (/chat\.whatsapp\.com/i.test(v)) return v;
      if (/wa\.me|api\.whatsapp\.com/i.test(v) && has(message) && v.indexOf('text=') === -1) {
        return v + (v.indexOf('?') === -1 ? '?' : '&') + 'text=' + encodeURIComponent(message);
      }
      return v;
    }
    var n = waNumber(v);
    if (!n) return '';
    return 'https://wa.me/' + n + (has(message) ? '?text=' + encodeURIComponent(message) : '');
  }

  var F = C.freshers || {};
  var freshersHref = whatsappLink(F.link, F.message);
  if (freshersHref) {
    var fSec = document.querySelector('[data-section="freshers"]');
    var fBtn = document.getElementById('freshersLink');
    fBtn.href = freshersHref;
    fBtn.textContent = has(F.buttonLabel) ? F.buttonLabel : 'Join on WhatsApp';
    var fh = document.querySelector('[data-bind="freshersHeading"]');
    var fb = document.querySelector('[data-bind="freshersBlurb"]');
    if (has(F.heading)) fh.textContent = F.heading; else fh.remove();
    if (has(F.blurb)) fb.textContent = F.blurb; else fb.remove();
    show(fSec);
  }

  // ---- when we meet ----------------------------------------------------
  var services = (C.serviceTimes || []).filter(function (s) { return s && has(s.what); });
  if (services.length) {
    document.getElementById('services').innerHTML = services.map(function (s) {
      return '<li><span class="what">' + esc(s.what) + '</span>'
        + '<span class="when">' + esc(s.when || '') + '</span>'
        + '<span class="where">' + esc(s.where || '') + '</span></li>';
    }).join('');
    show(document.querySelector('[data-section="visit"]'));
    if (has(C.address)) show(document.getElementById('addressLine'));
    if (has(C.mapUrl)) {
      document.querySelectorAll('[data-map-link]').forEach(function (a) {
        a.href = C.mapUrl; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.hidden = false;
      });
    }
  }

  // wa.me wants the full international number with no + and NO LEADING ZERO.
  // A Ghanaian number written the way everybody writes it - 0547541623 - is
  // not that: the 0 is a national trunk prefix, and wa.me/0547541623 simply
  // fails. Nobody should have to know that to paste their own number in.
  function waNumber(raw) {
    var cc = String(C.countryCode || '233').replace(/[^\d]/g, '') || '233';
    var digits = String(raw || '').replace(/[^\d]/g, '');
    if (!digits) return '';
    if (digits.indexOf('00') === 0) digits = digits.slice(2);        // 00233... dialled out
    else if (digits.charAt(0) === '0') digits = cc + digits.slice(1); // 0547... local form
    else if (digits.indexOf(cc) !== 0 && digits.length <= 9) digits = cc + digits; // 547... bare
    return digits;
  }

  // ---- who leads the chapter --------------------------------------------
  // A photo when there is one, initials when there is not. A broken image icon
  // says "this site is unfinished" far louder than a circle with a letter in it,
  // and a chapter should be able to put the names up before the photos exist.
  // Nearly every name here carries a title, and "Apostle Kwame Anane" initialled
  // straight off the front is AK - the A belongs to the office, not the man.
  var TITLE = /^(apostle|prophet|prophetess|evangelist|pastor|rev|reverend|bishop|elder|deacon|deaconess|pas|dr|prof|mr|mrs|ms|miss|sis|sister|bro|brother)\.?$/i;
  function faceHtml(person, cls) {
    if (has(person.photo)) {
      return '<img class="' + cls + '" src="' + esc(person.photo) + '" alt="'
        + esc(person.name || '') + '" loading="lazy">';
    }
    var words = String(person.name || '?').trim().split(/\s+/);
    var named = words.filter(function (w) { return !TITLE.test(w); });
    if (named.length) words = named;   // somebody called only "Elder" keeps it
    var initials = words
      .slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
    return '<span class="' + cls + ' is-initials">' + esc(initials || '?') + '</span>';
  }

  var coordinators = (C.coordinators || []).filter(function (p) { return p && has(p.name); });
  var executives = (C.executives || []).filter(function (p) { return p && (has(p.name) || has(p.position)); });

  if (coordinators.length) {
    document.getElementById('coordinators').innerHTML = coordinators.map(function (p) {
      var lines = [];
      // A blank number is a line that does not appear, not an empty row. The
      // same rule as everywhere else, and here it is also the privacy setting.
      if (has(p.email)) lines.push('<a href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a>');
      // Displayed as they wrote it; dialled in international form, so it works
      // for somebody calling from outside Ghana as well as on campus.
      if (has(p.phone)) lines.push('<a href="tel:+' + esc(waNumber(p.phone)) + '">' + esc(p.phone) + '</a>');
      return '<div class="lead-card">'
        + faceHtml(p, 'lead-face')
        + '<div class="lead-body">'
        + '<h3>' + esc(p.name) + '</h3>'
        + (has(p.role) ? '<p class="lead-role">' + esc(p.role) + '</p>' : '')
        + (has(p.about) ? '<p>' + esc(p.about) + '</p>' : '')
        + (lines.length ? '<p class="lead-contact">' + lines.join('<br>') + '</p>' : '')
        + '</div></div>';
    }).join('');
  }

  if (executives.length) {
    document.getElementById('executives').innerHTML = executives.map(function (p) {
      return '<div class="exec-card">'
        + faceHtml(p, 'exec-face')
        + '<p class="exec-name">' + esc(p.name || '') + '</p>'
        + (has(p.position) ? '<p class="exec-role">' + esc(p.position) + '</p>' : '')
        + '</div>';
    }).join('');
    // The heading only earns its place when there is a list under it, and only
    // when the coordinators above give it something to be distinguished from.
    if (coordinators.length) show(document.getElementById('execHeading'));
  }

  if (coordinators.length || executives.length) show(document.querySelector('[data-section="leadership"]'));

  // ---- the wider church, and the men who began it ------------------------
  // (Higher up the page than this, but it leans on the face helper above.)
  // The chapter is a fraction of the church, so the founders sit under the
  // CHURCH's logo rather than among the chapter's coordinators. The logo and
  // the list stand on their own: a chapter with the mark but no photographs
  // yet still has something true to show.
  var CH = C.church || {};
  var founders = (C.founders || []).filter(function (p) { return p && has(p.name); });

  if (has(CH.logo) || founders.length) {
    var churchLogo = document.getElementById('churchLogo');
    if (has(CH.logo)) {
      churchLogo.src = CH.logo;
      churchLogo.alt = has(CH.name) ? CH.name : '';
      churchLogo.hidden = false;
    } else {
      churchLogo.remove();   // rather than an empty frame where a mark goes
    }

    if (founders.length) {
      document.getElementById('founders').innerHTML = founders.map(function (p) {
        // One of them has gone. That is said in a line under the card rather
        // than done to the picture, so his card reads like the others'.
        return '<div class="founder-card">'
          + faceHtml(p, 'founder-face')
          + '<h3>' + esc(p.name) + '</h3>'
          + (has(p.role) ? '<p class="founder-role">' + esc(p.role) + '</p>' : '')
          + (has(p.about) ? '<p class="founder-about">' + esc(p.about) + '</p>' : '')
          + (p.inMemoriam ? '<p class="founder-memoriam">In loving memory</p>' : '')
          + '</div>';
      }).join('');
      // The heading belongs to the list, not to the logo above it.
      show(document.getElementById('founderHeading'));
    }
    show(document.querySelector('[data-section="heritage"]'));
  }

  // ---- what happens here ----------------------------------------------
  var ministries = (C.ministries || []).filter(function (m) { return m && has(m.name); });
  if (ministries.length) {
    // A photo across the top when there is one. A card without one simply
    // starts at its heading rather than showing a grey box where a picture
    // was meant to be, so the section is worth publishing before every
    // photograph exists.
    document.getElementById('ministries').innerHTML = ministries.map(function (m) {
      return '<div class="card' + (has(m.photo) ? ' has-photo' : '') + '">'
        + (has(m.photo)
            ? '<img class="card-photo" src="' + esc(m.photo) + '" alt="" loading="lazy">'
            : '')
        + '<div class="card-body"><h3>' + esc(m.name) + '</h3>'
        + (has(m.blurb) ? '<p>' + esc(m.blurb) + '</p>' : '')
        + '</div></div>';
    }).join('');
    show(document.querySelector('[data-section="ministries"]'));
  }

  // ---- reports anyone can read -------------------------------------------
  // A row needs both a title and a file. A card that links nowhere is worse
  // than no card, which is the same rule that removes a nav link to a section
  // that is not on the page.
  var reports = (C.reports || []).filter(function (r) {
    return r && has(r.title) && has(r.file);
  });
  if (reports.length) {
    document.getElementById('reports').innerHTML = reports.map(function (r) {
      // The whole card is the link, so there is no small target to miss on a
      // phone. It opens in a new tab rather than navigating away, because a
      // reader who opens the report has not finished with the page.
      return '<a class="card report-card' + (has(r.photo) ? ' has-photo' : '') + '"'
        + ' href="' + esc(r.file) + '" target="_blank" rel="noopener noreferrer">'
        + (has(r.photo)
            ? '<img class="card-photo" src="' + esc(r.photo) + '" alt="" loading="lazy">'
            : '')
        + '<span class="report-row">'
        + '<span class="report-badge" aria-hidden="true">PDF</span>'
        + '<span class="report-body">'
        + '<h3>' + esc(r.title) + '<span class="sr-only"> (PDF, opens in a new tab)</span></h3>'
        + (has(r.date) ? '<span class="report-date">' + esc(r.date) + '</span>' : '')
        + (has(r.blurb) ? '<span class="report-blurb">' + esc(r.blurb) + '</span>' : '')
        + '</span></span></a>';
    }).join('');
    show(document.querySelector('[data-section="reports"]'));
  }

  // ---- the verse --------------------------------------------------------
  if (C.verse && has(C.verse.text)) show(document.querySelector('[data-section="verse"]'));

  // ---- reaching us ------------------------------------------------------
  var K = C.contact || {};
  var rows = [];
  if (has(K.email)) rows.push(['Email', 'mailto:' + K.email, K.email]);
  if (has(K.phone)) rows.push(['Phone', 'tel:' + String(K.phone).replace(/[^\d+]/g, ''), K.phone]);
  if (has(C.address)) rows.push(['Where to find us', null, C.address]);
  document.getElementById('contactList').innerHTML = rows.map(function (r) {
    var body = r[1] ? '<a href="' + esc(r[1]) + '">' + esc(r[2]) + '</a>' : esc(r[2]);
    return '<li><span class="label">' + esc(r[0]) + '</span>' + body + '</li>';
  }).join('');

  // ---- socials ----------------------------------------------------------
  // Only the ones with a handle. A row of dead icons says nobody is home.
  var ICONS = {
    whatsapp: '<path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.1-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2s-.9.2-3-.9a11 11 0 0 1-4.4-4.3c-.3-.6-.9-1.7-.9-3.2s.8-2.2 1.1-2.5a1 1 0 0 1 .8-.3h.6c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .6l-.4.5-.3.3c-.1.2-.3.3-.1.6a9 9 0 0 0 1.6 2 8 8 0 0 0 2.3 1.4c.3.2.5.1.6 0l1-1.2c.2-.2.4-.2.6-.1l2 1c.3.1.4.2.5.3s.1.7-.1 1.4z"/>',
    facebook: '<path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12z"/>',
    instagram: '<path d="M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.2 2.2.4.6.2 1 .5 1.4.9s.7.8.9 1.4c.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.2 1.8-.4 2.2-.2.6-.5 1-.9 1.4s-.8.7-1.4.9c-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.2-2.2-.4-.6-.2-1-.5-1.4-.9s-.7-.8-.9-1.4c-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c.1-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4s.8-.7 1.4-.9c.4-.2 1-.4 2.2-.4 1.3-.1 1.7-.1 4.8-.1zm0 3.2A6.6 6.6 0 1 0 18.6 12 6.6 6.6 0 0 0 12 5.4zm0 10.9A4.3 4.3 0 1 1 16.3 12 4.3 4.3 0 0 1 12 16.3zm6.9-11.1a1.5 1.5 0 1 1-1.6-1.6 1.5 1.5 0 0 1 1.6 1.6z"/>',
    youtube: '<path d="M23 12s0-3.2-.4-4.7a2.5 2.5 0 0 0-1.8-1.8C19.3 5 12 5 12 5s-7.3 0-8.8.5A2.5 2.5 0 0 0 1.4 7.3C1 8.8 1 12 1 12s0 3.2.4 4.7a2.5 2.5 0 0 0 1.8 1.8C4.7 19 12 19 12 19s7.3 0 8.8-.5a2.5 2.5 0 0 0 1.8-1.8C23 15.2 23 12 23 12zM9.8 15.1V8.9l6 3.1z"/>',
    tiktok: '<path d="M16.5 2h-3v13.3a2.6 2.6 0 1 1-2.2-2.6v-3a5.6 5.6 0 1 0 5.2 5.6V8.6a6.6 6.6 0 0 0 4 1.3v-3a3.7 3.7 0 0 1-4-3.6z"/>',
    twitter: '<path d="M17.5 3h3l-6.6 7.5L21.8 21h-6l-4.7-6-5.4 6H2.7l7-8L2.2 3h6.2l4.2 5.6zm-1 16h1.7L7.6 4.8H5.8z"/>',
    telegram: '<path d="M21.9 4.3 18.8 19c-.2 1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9.1-8.2c.4-.3-.1-.5-.6-.2L6.4 12.7 1.6 11.2c-1-.3-1-1 .2-1.5l18.6-7.2c.9-.3 1.6.2 1.5 1.8z"/>'
  };
  function socialHref(key, value) {
    var v = String(value).trim();
    if (/^https?:\/\//i.test(v)) return v;
    if (key === 'whatsapp') return 'https://wa.me/' + waNumber(v);
    return v;
  }
  var socialsEl = document.getElementById('socials');
  var links = Object.keys(ICONS).filter(function (k) { return has(K[k]); }).map(function (k) {
    return '<a href="' + esc(socialHref(k, K[k])) + '" target="_blank" rel="noopener noreferrer" aria-label="' + k.charAt(0).toUpperCase() + k.slice(1) + ' (opens in a new tab)">'
      + '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + ICONS[k] + '</svg></a>';
  });
  if (links.length) socialsEl.innerHTML = links.join('');
  else socialsEl.remove();

  // ---- the app ----------------------------------------------------------
  // Blank appUrl hides every link to it, so this page stands alone until the
  // app is ready for anyone to see.
  if (has(C.appUrl)) {
    document.querySelectorAll('[data-app-link]').forEach(function (a) {
      a.href = C.appUrl; a.hidden = false;
    });
  }

  // ---- the month's theme, and the alumni ---------------------------------
  // These two come from the app, but never from the app while somebody is
  // looking: a scheduled job copies them into data/feed.json (see
  // tools/sync-feed.js). So this is an ordinary file next to the page. If it is
  // missing, empty or unreadable, both sections simply stay hidden.
  var A = C.alumni || {};
  var requestUrl = String(A.requestUrl || '').replace(/\/+$/, '');

  function monthLabel(key) {
    var p = String(key || '').split('-'), y = +p[0], m = +p[1];
    if (!y || !m) return '';
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  function renderTheme(t) {
    if (!t || !has(t.title)) return;
    var monthText = monthLabel(t.month);
    document.getElementById('themeMonth').textContent = monthText ? 'Theme for ' + monthText : 'Theme for this month';
    document.getElementById('themeTitle').textContent = t.title;
    [['themeScripture', t.scripture], ['themeBlurb', t.blurb]].forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      if (has(pair[1])) el.textContent = pair[1]; else el.remove();
    });
    var fl = document.getElementById('themeFlyers');
    var flyers = (t.flyers || []).filter(has);
    if (flyers.length) {
      fl.innerHTML = flyers.map(function (src) {
        return '<a href="' + esc(src) + '" target="_blank" rel="noopener"><img src="' + esc(src)
          + '" alt="Prayer flyer: ' + esc(t.title) + '" loading="lazy"></a>';
      }).join('');
    } else fl.remove();
    show(document.querySelector('[data-section="theme"]'));
  }

  function alumnusMeta(a) {
    return [has(a.classOf) ? 'Class of ' + a.classOf : ''].filter(Boolean).join(' · ');
  }

  function renderAlumni(feed) {
    var people = (feed.alumni || []).filter(function (a) { return a && has(a.name); });
    var spot = feed.spotlight && has(feed.spotlight.name) ? feed.spotlight : null;
    var canAsk = has(requestUrl);
    var skel = document.getElementById('alumniSkeleton');
    if (skel) skel.remove();

    if (spot) {
      document.getElementById('spotlight').innerHTML =
        '<div class="spot-photo">' + faceHtml(spot, 'spot-face') + '</div>'
        + '<div class="spot-body"><p class="meta">Alumnus of the week</p>'
        + '<h3>' + esc(spot.name) + '</h3>'
        + (has(spot.currentWork) ? '<p class="spot-work">' + esc(spot.currentWork) + '</p>' : '')
        + '<p>' + esc(spot.about) + '</p>'
        + (has(alumnusMeta(spot)) ? '<p class="spot-meta">' + esc(alumnusMeta(spot)) + '</p>' : '')
        + '</div>';
      show(document.getElementById('spotlight'));
    }

    if (people.length) {
      // A long wall is a long scroll on a phone. The newest are shown, and the
      // rest are one tap away rather than gone.
      var FIRST = 12;
      var card = function (a) {
        return '<article class="alumnus">' + faceHtml(a, 'alum-face')
          + '<h3>' + esc(a.name) + '</h3>'
          + (has(a.currentWork) ? '<p class="alum-work">' + esc(a.currentWork) + '</p>' : '')
          + (has(a.about) ? '<p class="alum-about">' + esc(a.about) + '</p>' : '')
          + (has(alumnusMeta(a)) ? '<p class="alum-meta">' + esc(alumnusMeta(a)) + '</p>' : '')
          + '</article>';
      };
      var grid = document.getElementById('alumniGrid');
      grid.innerHTML = people.slice(0, FIRST).map(card).join('');
      if (people.length > FIRST) {
        var more = document.getElementById('alumniMore');
        var btn = document.getElementById('alumniMoreBtn');
        btn.textContent = 'Show all ' + people.length;
        btn.addEventListener('click', function () {
          grid.innerHTML = people.map(card).join('');
          more.remove();
        });
        show(more);
      }
    } else {
      var emptyGrid = document.getElementById('alumniGrid');
      if (emptyGrid) emptyGrid.remove();
    }

    // With nobody to show yet, the heading's promise would be an empty room.
    if (!spot && !people.length) {
      document.getElementById('alumniIntro').textContent =
        'Were you a member of ACONSU? You can ask to be listed below.';
    }
    if (canAsk) show(document.getElementById('alumniAsk'));
    // The section stands on its own once there is anyone to show, or a way to be added.
    if (spot || people.length || canAsk) show(document.querySelector('[data-section="alumni"]'));
  }

  // The form sends one request to the app, and only when somebody presses Send.
  function initAskForm() {
    var form = document.getElementById('alumniForm');
    if (!form || !has(requestUrl)) return;
    var photoInput = document.getElementById('alPhoto');
    var preview = document.getElementById('alPreview');
    var about = document.getElementById('alAbout');
    var msg = document.getElementById('alMsg');
    var btn = document.getElementById('alSubmit');

    // Shrunk here first: a 6MB phone photo should not cross a mobile connection
    // to an app that may still be waking up.
    function shrink(file, max) {
      return new Promise(function (resolve) {
        var url = URL.createObjectURL(file);
        var im = new Image();
        im.onload = function () {
          try {
            var scale = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
            var c = document.createElement('canvas');
            c.width = Math.max(1, Math.round(im.naturalWidth * scale));
            c.height = Math.max(1, Math.round(im.naturalHeight * scale));
            var ctx = c.getContext('2d');
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
            ctx.drawImage(im, 0, 0, c.width, c.height);
            c.toBlob(function (blob) { URL.revokeObjectURL(url); resolve(blob || file); }, 'image/jpeg', 0.85);
          } catch (e) { URL.revokeObjectURL(url); resolve(file); }
        };
        im.onerror = function () { URL.revokeObjectURL(url); resolve(file); }; // the app decides what it can read
        im.src = url;
      });
    }

    photoInput.addEventListener('change', function () {
      var f = photoInput.files[0];
      if (!f) { preview.hidden = true; return; }
      preview.src = URL.createObjectURL(f);
      preview.hidden = false;
    });
    about.addEventListener('input', function () { document.getElementById('alCount').textContent = about.value.length; });

    var fields = form.querySelectorAll('input, textarea');
    function clearInvalid() { Array.prototype.forEach.call(fields, function (f) { f.removeAttribute('aria-invalid'); }); }
    // The message is announced by the live region, and focus moves to the field
    // it is about, so a keyboard or screen reader user lands where the fix is.
    function say(text, bad, field) {
      clearInvalid();
      msg.textContent = text;
      msg.className = 'ask-msg' + (bad ? ' is-error' : '');
      if (field) { field.setAttribute('aria-invalid', 'true'); field.focus(); }
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      say('');
      var nameField = document.getElementById('alName');
      var consentField = document.getElementById('alConsent');
      if (!nameField.value.trim()) return say('Enter your name.', true, nameField);
      if (!photoInput.files[0]) return say('Add a photo of you.', true, photoInput);
      if (about.value.trim().length < 15) return say('Write at least a sentence about you (15 characters or more).', true, about);
      if (!consentField.checked) return say('Tick the box to agree that your details are shown publicly.', true, consentField);

      btn.disabled = true; btn.textContent = 'Sending...';
      // The app sleeps when nobody has used it for a while and takes up to a
      // minute to wake. Say so, rather than leave a button that looks dead.
      var waking = setTimeout(function () { say('The app is starting up. This can take up to a minute, so please keep this page open.'); }, 6000);
      var ctl = window.AbortController ? new AbortController() : null;
      var giveUp = setTimeout(function () { if (ctl) ctl.abort(); }, 100000);

      shrink(photoInput.files[0], 1000).then(function (photo) {
        var fd = new FormData();
        fd.append('name', document.getElementById('alName').value);
        fd.append('chapterId', String(A.chapterId || ''));
        fd.append('about', about.value);
        fd.append('currentWork', document.getElementById('alWork').value);
        fd.append('classOf', document.getElementById('alClass').value);
        fd.append('contact', document.getElementById('alContact').value);
        fd.append('company', document.getElementById('alCompany').value);
        fd.append('consent', 'true');
        fd.append('via', 'site');
        fd.append('photo', photo, 'me.jpg');
        return fetch(requestUrl + '/api/public/alumni-requests', { method: 'POST', body: fd, signal: ctl ? ctl.signal : undefined });
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
          document.getElementById('alDoneText').textContent = data.message || 'Your request has been sent to the admins for review.';
          form.hidden = true;
          show(document.getElementById('alDone'));
        });
      }).catch(function (err) {
        // A thrown TypeError / AbortError is "could not reach the app"; an
        // Error we made from the app's own reply carries its own words.
        var unreachable = err && (err.name === 'TypeError' || err.name === 'AbortError');
        say(unreachable
          ? 'The app could not be reached. Try again in a minute.'
          : err.message, true);
      }).then(function () {
        clearTimeout(waking); clearTimeout(giveUp);
        btn.disabled = false; btn.textContent = 'Send request';
      });
    });
  }
  initAskForm();
  if (has(requestUrl)) {
    // The form will be here whatever the feed says, so the section is too; the
    // grey blocks hold the place of the wall until the feed has been read.
    show(document.getElementById('alumniSkeleton'));
    show(document.querySelector('[data-section="alumni"]'));
  }

  // A link to a section that is not on the page is a promise the page does not
  // keep: "Plan a Visit" scrolling nowhere because no service times were filled
  // in is worse than no button. Done once every section has decided whether it
  // exists. The Alumni link waits for the feed, which decides that section.
  function pruneDeadLinks(includeAlumni) {
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      var id = a.getAttribute('href').slice(1);
      if (!id || id === 'top') return;
      if (id === 'alumni' && !includeAlumni) return;
      var target = document.getElementById(id);
      if (!target || target.hidden) a.remove();
    });
    var cta = document.querySelector('.hero-cta');
    if (cta && !cta.children.length) cta.remove();
  }
  pruneDeadLinks(false);

  fetch('data/feed.json', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; })
    .then(function (feed) {
      // One bad field must not take the other section down with it.
      if (feed && feed.version === 1) {
        try { renderTheme(feed.theme); } catch (e) { /* the theme stays hidden */ }
        try { renderAlumni(feed); } catch (e) { /* the alumni stay hidden */ }
      } else {
        // No feed: the wall is empty, but a chapter that can take requests still shows the form.
        try { renderAlumni({}); } catch (e) { /* hidden */ }
      }
      pruneDeadLinks(true);
    });

  var y = document.getElementById('year');
  if (y) y.textContent = String(new Date().getFullYear());
})();
