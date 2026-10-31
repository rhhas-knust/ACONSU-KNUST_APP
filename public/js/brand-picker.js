/* The colour picker an admin uses to set the app's brand colour: the national
   admin for the whole union, a chapter admin for their own chapter.

     const picker = BrandPicker.mount(container, { value: '#0B1A43', inherit: false });
     picker.value()   // '' (follow the national colour) or '#RRGGBB'

   Choosing a colour previews it live on the page itself (the palette comes from
   /api/brand/preview, so the browser and the server can never disagree about it)
   and says plainly if the colour had to be darkened to keep white button text
   readable. Nothing is saved until the form it sits in is saved. */
(function () {
  var HEX = /^#[0-9a-fA-F]{6}$/;

  function mount(root, opts) {
    opts = opts || {};
    var inherit = !!opts.inherit;                 // a chapter may follow the national colour
    var start = HEX.test(opts.value || '') ? opts.value.toUpperCase() : '';
    var following = inherit && !start;            // true while "use the national colour" is ticked
    var current = start || opts.fallback || '#0B1A43';
    var presets = [];
    var timer = null;
    var seq = 0;

    root.innerHTML =
      '<div class="brand-picker">' +
      (inherit ? '<label class="bp-follow"><input type="checkbox" class="bp-follow-box"> Use the national colour' + (opts.fallback ? ' (<span class="bp-follow-hex"></span>)' : '') + '</label>' : '') +
      '<div class="bp-body">' +
      '<div class="bp-swatches" role="group" aria-label="Suggested colours"></div>' +
      '<div class="bp-custom">' +
      '<label class="bp-label" for="bpHex">Or type any colour</label>' +
      '<div class="bp-row"><input type="color" class="bp-native" aria-label="Pick a colour" value="' + current + '">' +
      '<input type="text" id="bpHex" class="bp-hex" inputmode="text" autocomplete="off" spellcheck="false" maxlength="7" placeholder="#0B1A43" value="' + current + '"></div>' +
      '</div>' +
      '<p class="bp-note" role="status" aria-live="polite"></p>' +
      '<button type="button" class="btn btn-outline btn-sm bp-reset">Put back the saved colour</button>' +
      '</div></div>';

    var box = root.querySelector('.bp-follow-box');
    var body = root.querySelector('.bp-body');
    var swatchBox = root.querySelector('.bp-swatches');
    var native = root.querySelector('.bp-native');
    var hex = root.querySelector('.bp-hex');
    var note = root.querySelector('.bp-note');
    var reset = root.querySelector('.bp-reset');
    var followHex = root.querySelector('.bp-follow-hex');
    if (followHex) followHex.textContent = opts.fallback || '';

    function say(text, kind) { note.textContent = text; note.setAttribute('data-kind', kind || ''); }

    function drawSwatches() {
      swatchBox.innerHTML = '';
      presets.forEach(function (p) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'bp-swatch';
        b.setAttribute('aria-pressed', String(current.toUpperCase() === p.hex.toUpperCase()));
        b.title = p.name + ' ' + p.hex;
        b.innerHTML = '<span class="bp-chip" style="background:' + p.hex + '"></span><span class="bp-name"></span>';
        b.querySelector('.bp-name').textContent = p.name;
        b.addEventListener('click', function () { set(p.hex); });
        swatchBox.appendChild(b);
      });
    }

    function applyPreview(css) {
      var tag = document.getElementById('brandPreview');
      if (!tag) { tag = document.createElement('style'); tag.id = 'brandPreview'; document.head.appendChild(tag); }
      tag.textContent = css || '';
    }

    function preview() {
      var mine = ++seq;
      if (following) { applyPreview(''); say(''); return; }
      if (!HEX.test(current)) { say('Type a colour like #0B1A43: a # and six letters or digits.', 'error'); return; }
      fetch('/api/brand/preview?color=' + encodeURIComponent(current), { credentials: 'same-origin' })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Could not check that colour.'); return j; }); })
        .then(function (j) {
          if (mine !== seq) return;
          if (!presets.length) { presets = j.presets || []; drawSwatches(); }
          applyPreview(j.css);
          if (window.ACONSU_BRAND) window.ACONSU_BRAND.color(j.brand);
          if (j.adjusted) say('That colour is a little too light for white text on buttons, so the app will use ' + j.brand + ' instead. Pick something darker to choose it yourself.', 'warn');
          else say('This colour passes the readability checks (' + j.pairs.length + ' of ' + j.pairs.length + '). The page is showing it now; it is saved when you save.', 'ok');
          drawSwatches();
        })
        .catch(function (e) { if (mine === seq) say(e.message || 'Could not check that colour.', 'error'); });
    }

    function set(value) {
      current = String(value || '').toUpperCase();
      if (HEX.test(current)) native.value = current.toLowerCase();
      hex.value = current;
      drawSwatches();
      clearTimeout(timer);
      timer = setTimeout(preview, 200);
    }

    function setFollowing(on) {
      following = on;
      body.hidden = on;
      if (box) box.checked = on;
      if (on) { applyPreview(''); say(''); } else preview();
    }

    native.addEventListener('input', function () { set(native.value); });
    hex.addEventListener('input', function () {
      var v = hex.value.trim();
      if (v && v.charAt(0) !== '#') v = '#' + v;
      current = v.toUpperCase();
      if (HEX.test(current)) native.value = current.toLowerCase();
      clearTimeout(timer);
      timer = setTimeout(preview, 250);
    });
    reset.addEventListener('click', function () {
      set(start || opts.fallback || '#0B1A43');
      if (!start && inherit) setFollowing(true);
    });
    if (box) box.addEventListener('change', function () { setFollowing(box.checked); });

    // Presets are fetched with the first preview; ask for one straight away so
    // the swatches are there before anyone touches anything.
    fetch('/api/brand/preview', { credentials: 'same-origin' }).then(function (r) { return r.json(); })
      .then(function (j) { presets = j.presets || []; drawSwatches(); }).catch(function () { /* the custom box still works */ });
    setFollowing(following);

    return {
      // '' means "follow the national colour"; otherwise a valid #RRGGBB, or null if what is typed is not one.
      value: function () { if (following) return ''; return HEX.test(current) ? current.toUpperCase() : null; },
      isValid: function () { return following || HEX.test(current); },
      focus: function () { (following ? box : hex).focus(); }
    };
  }

  window.BrandPicker = { mount: mount };
})();
