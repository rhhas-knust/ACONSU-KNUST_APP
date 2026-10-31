/* The "Header look" control: what colour the words over a header picture are, how
   much the picture is darkened behind them, and a live preview with the contrast
   it gives, before anything is uploaded or saved.

     const look = await HeroLook.mount(container, { textColor: '', veil: null });
     look.setImage(urlOrObjectUrl);     // the picture being previewed
     look.value()                       // { textColor, veil, tone } as the server takes them
     look.ready()                       // true once the preview has measured the picture

   The preview is drawn by the same code the public page uses (hero-tone.js), so
   what an admin approves here is what visitors see. */
(function () {
  var seq = 0;

  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }

  async function mount(root, initial) {
    if (typeof loadHeroTone === 'function') await loadHeroTone();
    var HT = window.HeroTone;
    if (!HT) { root.textContent = 'The preview could not load. You can still save; the header picks a readable colour by itself.'; return null; }
    initial = initial || {};
    var id = 'hl' + (seq += 1);
    var chosen = HT.normaliseColor(initial.textColor);
    var mode = !chosen ? 'auto' : (chosen === HT.LIGHT ? 'light' : (chosen === HT.DARK ? 'dark' : 'custom'));
    var veilAuto = initial.veil === null || initial.veil === undefined || initial.veil === '';
    var veilValue = veilAuto ? 40 : Number(initial.veil);
    var customColor = mode === 'custom' ? chosen : '#F4C430';
    var imageUrl = '';
    var luma = null;
    var measured = true;   // nothing to measure until a picture is chosen
    var current = null;

    var box = el(
      '<div class="hl">' +
      '<div class="hl-preview" role="img" aria-label="Preview of the header with your choices">' +
      '<div class="hl-img"></div><div class="hl-veil"></div>' +
      '<div class="hl-text"><p class="hl-h">The Apostles’ Continuation Students Union</p>' +
      '<p class="hl-p">Services, Bible study and prayer for students.</p>' +
      '<div class="hl-btns"><span class="hl-btn hl-btn-primary">Plan your visit</span><span class="hl-btn hl-btn-outline">Events</span></div></div>' +
      '<p class="hl-empty">Choose a picture to see the preview.</p>' +
      '</div>' +
      '<p class="hl-read" role="status" aria-live="polite"></p>' +
      '<div class="hl-fix" hidden><button type="button" class="btn btn-outline btn-sm hl-fix-btn"></button></div>' +
      '<fieldset class="hl-fields"><legend>Text colour</legend>' +
      '<label class="hl-opt"><input type="radio" name="' + id + '" value="auto"> Automatic (best for this picture)</label>' +
      '<label class="hl-opt"><input type="radio" name="' + id + '" value="light"> White</label>' +
      '<label class="hl-opt"><input type="radio" name="' + id + '" value="dark"> Dark</label>' +
      '<label class="hl-opt"><input type="radio" name="' + id + '" value="custom"> My own colour ' +
      '<input type="color" class="hl-color" aria-label="Pick a text colour"> ' +
      '<input type="text" class="hl-hex" maxlength="7" spellcheck="false" aria-label="Text colour as #RRGGBB" placeholder="#F4C430"></label>' +
      '</fieldset>' +
      '<div class="hl-veil-row"><label class="hl-opt"><input type="checkbox" class="hl-veil-auto"> Choose how much for me</label>' +
      '<label class="hl-range">Darken or lighten the picture behind the words <input type="range" min="0" max="85" step="1" class="hl-range-input"> <output class="hl-range-out"></output></label></div>' +
      '</div>');
    root.innerHTML = '';
    root.appendChild(box);

    var q = function (s) { return box.querySelector(s); };
    var imgEl = q('.hl-img'), veilEl = q('.hl-veil'), textEl = q('.hl-text'), emptyEl = q('.hl-empty');
    var readEl = q('.hl-read'), fixWrap = q('.hl-fix'), fixBtn = q('.hl-fix-btn');
    var radios = box.querySelectorAll('input[type=radio]');
    var colorEl = q('.hl-color'), hexEl = q('.hl-hex'), autoEl = q('.hl-veil-auto'), rangeEl = q('.hl-range-input'), outEl = q('.hl-range-out');

    function chosenColor() {
      if (mode === 'light') return HT.LIGHT;
      if (mode === 'dark') return HT.DARK;
      if (mode === 'custom') return HT.normaliseColor(customColor);
      return '';
    }
    function draw() {
      var p = HT.plan({ luma: luma, textColor: chosenColor(), veil: veilAuto ? null : veilValue });
      current = p;
      textEl.style.setProperty('--ink', p.ink);
      textEl.style.setProperty('--on', p.on);
      veilEl.style.background = p.veil;
      // Show what the automatic veil is without letting the slider fight the person using it.
      if (veilAuto) { rangeEl.value = String(p.veilPercent); }
      outEl.textContent = (veilAuto ? p.veilPercent : veilValue) + '%';
      rangeEl.disabled = veilAuto;
      autoEl.checked = veilAuto;
      colorEl.disabled = mode !== 'custom';
      hexEl.disabled = mode !== 'custom';
      emptyEl.hidden = !!imageUrl;
      textEl.hidden = !imageUrl;
      if (!imageUrl) { readEl.textContent = ''; fixWrap.hidden = true; return; }
      var r = p.ratio.toFixed(1) + ':1';
      readEl.setAttribute('data-kind', p.ok ? 'ok' : 'bad');
      if (p.ok) {
        readEl.textContent = 'Contrast ' + r + '. Easy to read.';
        fixWrap.hidden = true;
      } else {
        readEl.textContent = 'Contrast ' + r + '. Hard to read: visitors need at least 4.5:1.';
        fixWrap.hidden = false;
        if (p.canFix) fixBtn.textContent = 'Fix it: ' + (p.veilKind === 'light' ? 'lighten' : 'darken') + ' the picture to ' + p.fixVeil + '%';
        else fixBtn.textContent = 'Use ' + (p.suggestedInk === HT.LIGHT ? 'white' : 'dark') + ' text instead';
        fixBtn.setAttribute('data-can-fix', p.canFix ? '1' : '');
      }
    }
    function syncControls() {
      radios.forEach(function (r) { r.checked = r.value === mode; });
      colorEl.value = (HT.normaliseColor(customColor) || '#F4C430').toLowerCase();
      hexEl.value = HT.normaliseColor(customColor) || customColor;
      rangeEl.value = String(veilValue);
    }

    radios.forEach(function (r) { r.addEventListener('change', function () { if (r.checked) { mode = r.value; draw(); } }); });
    colorEl.addEventListener('input', function () { customColor = colorEl.value.toUpperCase(); hexEl.value = customColor; mode = 'custom'; syncRadio(); draw(); });
    hexEl.addEventListener('input', function () {
      var v = hexEl.value.trim(); if (v && v.charAt(0) !== '#') v = '#' + v;
      customColor = v.toUpperCase(); if (HT.normaliseColor(v)) { colorEl.value = v.toLowerCase(); mode = 'custom'; syncRadio(); draw(); }
    });
    function syncRadio() { radios.forEach(function (r) { r.checked = r.value === mode; }); }
    autoEl.addEventListener('change', function () { veilAuto = autoEl.checked; if (!veilAuto && current) veilValue = current.veilPercent; draw(); });
    rangeEl.addEventListener('input', function () { veilAuto = false; veilValue = Number(rangeEl.value); draw(); });
    fixBtn.addEventListener('click', function () {
      if (!current) return;
      if (current.canFix) { veilAuto = false; veilValue = current.fixVeil; } else { mode = current.suggestedInk === HT.LIGHT ? 'light' : 'dark'; syncRadio(); }
      draw();
    });

    syncControls();
    draw();

    return {
      setImage: function (url) {
        imageUrl = url || '';
        imgEl.style.backgroundImage = imageUrl ? 'url("' + imageUrl + '")' : '';
        luma = null;
        if (!imageUrl) { measured = true; draw(); return Promise.resolve(); }
        measured = false;
        draw();
        return HT.measure(imageUrl).then(function (l) { luma = l; measured = true; draw(); });
      },
      ready: function () { return measured; },
      hasImage: function () { return !!imageUrl; },
      value: function () {
        var p = current || HT.plan({ luma: luma, textColor: chosenColor(), veil: veilAuto ? null : veilValue });
        return { textColor: chosenColor(), veil: veilAuto ? null : veilValue, tone: p.ink === HT.LIGHT || p.on === HT.DARK ? 'dark' : 'light', ok: p.ok, ratio: p.ratio };
      }
    };
  }

  window.HeroLook = { mount: mount };
})();
