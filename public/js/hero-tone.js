/* How the words over a header picture are drawn, and whether they can be read.

   plan({ luma, textColor, veil }) works out the text colour, the veil laid over
   the picture (dark under light text, light under dark text) and the contrast
   that results. Left on automatic, it picks whichever of white or dark needs the
   lighter veil and darkens only as much as 4.5:1 takes, so the picture stays as
   visible as it can while the heading stays readable. An admin can set the
   colour and the veil by hand; plan() then says whether that reads, and what
   veil would make it read.

   luma is how bright the picture is behind the text, 0 (black) to 255 (white),
   measured from the picture itself (measure()). It is the same code in the
   admin's preview and on the public page, so what the admin approves is what
   visitors see. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); // eslint-disable-line no-undef
  else root.HeroTone = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  var HEX = /^#[0-9a-fA-F]{6}$/;
  var LIGHT = '#FFFFFF';
  var DARK = '#0B1220';
  var AA = 4.5;
  var MAX_VEIL = 0.85;

  function toRgb(hex) { var n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function lin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function lum(rgb) { return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]); }
  function contrastRgb(a, b) { var la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
  function contrast(hexA, hexB) { return contrastRgb(toRgb(hexA), toRgb(hexB)); }

  // A pale ink gets a dark veil; a dark ink gets a light one.
  function veilRgb(inkRgb) { return lum(inkRgb) > 0.4 ? [8, 12, 24] : [255, 255, 255]; }
  // What the picture looks like once the veil is laid on it, at its busiest
  // (the brighter or darker quarter of it, whichever is worse for the ink).
  function background(luma, v, alpha) {
    var c = Math.round((1 - alpha) * luma + alpha * v);
    return [c, c, c];
  }
  // The least veil that lets this ink reach AA, or null if none up to the maximum does.
  function neededVeil(inkRgb, luma) {
    var v = veilRgb(inkRgb)[0];
    if (contrastRgb(inkRgb, background(luma, v, 0)) >= AA) return 0;
    var lo = 0, hi = MAX_VEIL;
    if (contrastRgb(inkRgb, background(luma, v, hi)) < AA) return null;
    for (var i = 0; i < 24; i += 1) {
      var mid = (lo + hi) / 2;
      if (contrastRgb(inkRgb, background(luma, v, mid)) >= AA) hi = mid; else lo = mid;
    }
    return hi;
  }

  function normaliseColor(c) { return typeof c === 'string' && HEX.test(c.trim()) ? c.trim().toUpperCase() : ''; }
  function percent(v) { var n = (v === '' || v === null || v === undefined) ? NaN : Number(v); return isFinite(n) ? Math.max(0, Math.min(85, Math.round(n))) : null; }

  function plan(opts) {
    opts = opts || {};
    var luma = typeof opts.luma === 'number' && isFinite(opts.luma) ? opts.luma : 110;
    var chosen = normaliseColor(opts.textColor);
    var chosenVeil = percent(opts.veil);
    var auto = !chosen;

    var ink = chosen;
    if (auto) {
      var nLight = neededVeil(toRgb(LIGHT), luma);
      var nDark = neededVeil(toRgb(DARK), luma);
      var costLight = nLight === null ? 9 : nLight;
      var costDark = nDark === null ? 9 : nDark;
      // Light text is the house style over a photograph; dark wins only when it clearly needs less veil.
      ink = costDark + 0.08 < costLight ? DARK : LIGHT;
    }
    var inkRgb = toRgb(ink);
    var v = veilRgb(inkRgb)[0];
    var needed = neededVeil(inkRgb, luma);
    var alpha;
    if (chosenVeil !== null) alpha = chosenVeil / 100;
    else alpha = needed === null ? MAX_VEIL : Math.max(needed + 0.02, 0.18);
    alpha = Math.min(MAX_VEIL, alpha);
    var ratio = contrastRgb(inkRgb, background(luma, v, alpha));
    var vr = veilRgb(inkRgb);
    return {
      ink: ink,
      on: contrast(ink, LIGHT) >= contrast(ink, DARK) ? LIGHT : DARK, // the label colour on a button filled with the ink
      veil: 'rgba(' + vr.join(',') + ',' + (Math.round(alpha * 100) / 100) + ')',
      veilPercent: Math.round(alpha * 100),
      veilKind: v > 128 ? 'light' : 'dark',
      ratio: Math.round(ratio * 100) / 100,
      ok: ratio >= AA,
      auto: auto,
      autoVeilManual: chosenVeil !== null,
      // what to set to make this ink readable, if it is not
      fixVeil: needed === null ? Math.round(MAX_VEIL * 100) : Math.ceil((needed + 0.02) * 100),
      canFix: needed !== null,
      suggestedInk: contrast(LIGHT, background(luma, 8, 0.5)) >= contrast(DARK, background(luma, 255, 0.5)) ? LIGHT : DARK
    };
  }

  // Sets what a header needs (see .hero[data-hero-look] in style.css).
  function apply(hero, p) {
    if (!hero || !p) return;
    hero.style.setProperty('--hero-ink', p.ink);
    hero.style.setProperty('--hero-on', p.on);
    hero.style.setProperty('--hero-veil', p.veil);
    hero.setAttribute('data-hero-look', '');
  }

  // How bright the picture is, 0 to 255: the brighter quarter of it, as a small
  // sample. Needs a browser. Resolves to null when the picture cannot be read
  // (the caller then plans for a middling picture, which is safe).
  function measure(url) {
    return new Promise(function (resolve) {
      if (typeof document === 'undefined') return resolve(null);
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        try {
          var size = 48;
          var canvas = document.createElement('canvas');
          canvas.width = size; canvas.height = size;
          var ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, size, size);
          var data = ctx.getImageData(0, 0, size, size).data;
          var values = [];
          for (var i = 0; i < data.length; i += 4) values.push((data[i] + data[i + 1] + data[i + 2]) / 3);
          values.sort(function (a, b) { return a - b; });
          resolve(values[Math.floor(values.length * 0.75)]);
        } catch (e) { resolve(null); }
      };
      img.onerror = function () { resolve(null); };
      img.src = url;
    });
  }

  return { plan: plan, apply: apply, measure: measure, contrast: contrast, LIGHT: LIGHT, DARK: DARK, AA: AA, normaliseColor: normaliseColor };
}));
