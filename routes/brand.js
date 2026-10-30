// The app's colour. One colour, chosen by an admin, becomes the whole palette
// (lib/brand.js).
//
//   GET /theme.css          the palette as a stylesheet, for the national colour or,
//                           with ?chapter=ID (or the X-Chapter-Id header), that
//                           chapter's own where it has chosen one. Public, and read
//                           by every page, so it is installed before the session
//                           and costs one small lookup.
//   GET /api/brand/preview  for the picker: the palette a colour would give, whether
//                           it had to be darkened, and every contrast pair checked.
//
// Saving a colour is part of the existing settings: the national admin's Global
// Settings (PUT /api/admin/settings) and a chapter admin's Chapter Settings
// (PUT /api/admin/chapter-settings), both of which keep their own permission
// checks. brandColor on a record is '' (follow the next level up) or #RRGGBB.

const brand = require('../lib/brand');

const CHAPTER_ID = /^[A-Za-z0-9_-]{1,64}$/;

// The colour a visitor should see: their chapter's, else the national one.
async function brandFor(repo, chapterId) {
  const global = await repo.getSettings();
  let chapter = null;
  if (chapterId && CHAPTER_ID.test(chapterId)) chapter = await repo.getById('chapters', chapterId);
  return brand.resolveBrand({ chapter, global });
}

function registerThemeCss(app, { repo }) {
  app.get('/theme.css', async (req, res) => {
    const asked = String(req.query.chapter || req.headers['x-chapter-id'] || '').trim();
    let color = brand.DEFAULT_BRAND;
    try { color = await brandFor(repo, asked); } catch (e) { /* the default is a safe answer */ }
    // Revalidated every time (the ETag makes that cheap) so a colour an admin has
    // just saved shows on the next page, not tomorrow.
    res.set('Cache-Control', 'no-cache');
    res.type('text/css').send(brand.themeCss(color));
  });
}

function registerBrandApi(app, { requireChapterAdmin }) {
  app.get('/api/brand/preview', requireChapterAdmin, (req, res) => {
    const asked = String(req.query.color || '');
    if (asked && !brand.isHex(asked)) return res.status(400).json({ error: 'Use a colour like #0B1A43 (a # and six letters or digits).' });
    const p = brand.paletteFor(asked || brand.DEFAULT_BRAND);
    res.json({
      requested: p.requested, brand: p.brand, adjusted: p.adjusted, ok: p.ok, pairs: p.pairs,
      css: brand.themeCss(p.requested), presets: brand.PRESETS, defaultBrand: brand.DEFAULT_BRAND
    });
  });
}

module.exports = { registerThemeCss, registerBrandApi, brandFor };
