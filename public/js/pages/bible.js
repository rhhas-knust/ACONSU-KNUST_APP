// The script of bible.html, moved out of the page so the browser
// can refuse any script written into a page (lib/securityHeaders.js).
let BOOKS = [];
let EXTERNAL_VERSIONS = [];
let CURRENT_VERSES = [];
let CURRENT_REFERENCE = '';
let CURRENT_VERSION_LABEL = '';
let selectedVerse = null;
let firstRender = true;

// How someone likes to read is theirs, and it should survive the next visit -
// including the chapter they were on, so the app opens where they left off.
const PREF = {
  read(key, fallback) {
    try { const v = localStorage.getItem('aconsu.bible.' + key); return v === null ? fallback : v; }
    catch (e) { return fallback; }
  },
  write(key, value) {
    try { localStorage.setItem('aconsu.bible.' + key, String(value)); } catch (e) { /* private mode */ }
  }
};

const MIN_SIZE = 0.92, MAX_SIZE = 1.6;

(async function () {
  await initLayout('/bible.html');
  applyTheme(PREF.read('theme', 'day'));
  applySize(Number(PREF.read('size', '1.08')));
  applyFlow(PREF.read('flow', 'verse'));

  try {
    const { books, translations, externalVersions } = await fetchJSON('/api/bible/books');
    BOOKS = books;
    EXTERNAL_VERSIONS = externalVersions || [];

    // Deep-linkable (e.g. from a Bible Study's scripture reference):
    // /bible.html?book=John&chapter=3
    const params = new URLSearchParams(location.search);
    const wantedBook = params.get('book');
    const wantedChapter = params.get('chapter');

    const bookSelect = document.getElementById('bookSelect');
    bookSelect.innerHTML = books.map(b => `<option value="${escapeHtml(b.name)}">${escapeHtml(b.name)}</option>`).join('');
    const lastBook = PREF.read('book', '');
    bookSelect.value = (wantedBook && books.some(b => b.name === wantedBook)) ? wantedBook
      : (lastBook && books.some(b => b.name === lastBook)) ? lastBook
      : 'John';

    renderVersionOptions(translations || [], EXTERNAL_VERSIONS);

    populateChapters();
    document.getElementById('chapterSelect').value =
      wantedChapter || (wantedBook ? 1 : PREF.read('chapter', '3'));

    loadPassage();

    // check whether admin has set up a downloadable Bible versions bookshelf page
    try {
      const pages = await fetchJSON('/api/pages');
      const bookshelfPage = pages.find(p => p.type === 'bookshelf' && /bible|scripture/i.test(p.title + p.slug));
      if (bookshelfPage) {
        document.getElementById('fullVersionLink').href = `/page.html?slug=${encodeURIComponent(bookshelfPage.slug)}`;
        document.getElementById('fullVersionHint').hidden = false;
      }
    } catch (e) { /* optional */ }
  } catch (e) {
    document.getElementById('verseWrap').innerHTML = '<p class="empty-state">Could not load the Bible reader right now.</p>';
  }

  document.getElementById('bookSelect').addEventListener('change', () => { populateChapters(); loadPassage(); });
  document.getElementById('chapterSelect').addEventListener('change', loadPassage);
  document.getElementById('translationSelect').addEventListener('change', loadPassage);
  document.getElementById('prevChapterBtn').addEventListener('click', () => stepChapter(-1));
  document.getElementById('nextChapterBtn').addEventListener('click', () => stepChapter(1));
  document.getElementById('downloadChapterBtn').addEventListener('click', downloadChapter);

  document.getElementById('fontUpBtn').addEventListener('click', () => stepSize(0.08));
  document.getElementById('fontDownBtn').addEventListener('click', () => stepSize(-0.08));
  document.getElementById('themeGroup').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-theme]');
    if (btn) applyTheme(btn.dataset.theme);
  });
  document.getElementById('flowBtn').addEventListener('click', () => {
    applyFlow(document.getElementById('flowBtn').getAttribute('aria-pressed') === 'true' ? 'verse' : 'paragraph');
  });

  document.getElementById('copyVerseBtn').addEventListener('click', copySelectedVerse);
  document.getElementById('shareVerseBtn').addEventListener('click', shareSelectedVerse);
  document.getElementById('imageVerseBtn').addEventListener('click', shareSelectedVerseImage);

  // Tapping a verse selects it; tapping anywhere that isn't a verse or the
  // action bar lets it go again.
  document.addEventListener('click', (e) => {
    const line = e.target.closest('.verse-line');
    if (line) return selectVerse(line);
    if (!e.target.closest('.verse-action-bar')) clearSelection();
  });

  // Page through chapters with the arrow keys, the way a reader expects.
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'ArrowRight') stepChapter(1);
    else if (e.key === 'ArrowLeft') stepChapter(-1);
    else if (e.key === 'Escape') clearSelection();
  });
})();

// Versions are grouped by language so the English ones a chapter actually
// reads are not buried among the others.
function renderVersionOptions(translations, external) {
  const select = document.getElementById('translationSelect');
  const byLanguage = new Map();
  translations.forEach(t => {
    const lang = t.language || 'Other';
    if (!byLanguage.has(lang)) byLanguage.set(lang, []);
    byLanguage.get(lang).push(t);
  });

  let html = '';
  byLanguage.forEach((list, lang) => {
    html += `<optgroup label="${escapeHtml(lang)}">` +
      list.map(t => `<option value="${escapeHtml(t.code)}">${escapeHtml(t.label)}</option>`).join('') +
      '</optgroup>';
  });
  if (external.length) {
    html += '<optgroup label="Read elsewhere">' +
      external.map(v => `<option value="${escapeHtml(v.code)}">${escapeHtml(v.label)}</option>`).join('') +
      '</optgroup>';
  }
  select.innerHTML = html;

  const last = PREF.read('translation', 'kjv');
  const codes = translations.map(t => t.code).concat(external.map(v => v.code));
  select.value = codes.includes(last) ? last : (codes.includes('kjv') ? 'kjv' : codes[0]);
}

function populateChapters() {
  const bookName = document.getElementById('bookSelect').value;
  const book = BOOKS.find(b => b.name === bookName);
  const chapterSelect = document.getElementById('chapterSelect');
  const count = book ? book.chapters : 1;
  const current = Number(chapterSelect.value) || 1;
  chapterSelect.innerHTML = Array.from({ length: count }, (_, i) => i + 1)
    .map(c => `<option value="${c}">Chapter ${c}</option>`).join('');
  chapterSelect.value = Math.min(current, count);
}

function stepChapter(delta) {
  const chapterSelect = document.getElementById('chapterSelect');
  const bookSelect = document.getElementById('bookSelect');
  let chapter = Number(chapterSelect.value) + delta;
  const bookIndex = BOOKS.findIndex(b => b.name === bookSelect.value);
  const book = BOOKS[bookIndex];
  if (!book) return;

  if (chapter < 1) {
    if (bookIndex > 0) {
      bookSelect.value = BOOKS[bookIndex - 1].name;
      populateChapters();
      chapterSelect.value = BOOKS[bookIndex - 1].chapters;
    }
  } else if (chapter > book.chapters) {
    if (bookIndex < BOOKS.length - 1) {
      bookSelect.value = BOOKS[bookIndex + 1].name;
      populateChapters();
      chapterSelect.value = 1;
    }
  } else {
    chapterSelect.value = chapter;
  }
  loadPassage();
}

async function loadPassage() {
  const book = document.getElementById('bookSelect').value;
  const chapter = document.getElementById('chapterSelect').value;
  const select = document.getElementById('translationSelect');
  const translation = select.value;
  const wrap = document.getElementById('verseWrap');
  CURRENT_VERSION_LABEL = select.options[select.selectedIndex] ? select.options[select.selectedIndex].text : '';
  clearSelection();

  PREF.write('book', book);
  PREF.write('chapter', chapter);
  PREF.write('translation', translation);

  // A version the app is not licensed to reproduce never goes to the server -
  // it is offered as a link to the publisher's own reader instead.
  const external = EXTERNAL_VERSIONS.find(v => v.code === translation);
  if (external) return renderExternalVersion(external, `${book} ${chapter}`);

  wrap.innerHTML = '<div class="skeleton skeleton-card" style="height:320px;"></div>';

  try {
    const data = await fetchJSON(`/api/bible/passage?book=${encodeURIComponent(book)}&chapter=${chapter}&translation=${encodeURIComponent(translation)}`);
    CURRENT_VERSES = data.verses;
    CURRENT_REFERENCE = data.reference;
    wrap.innerHTML = `
      <div class="reader" id="reader">
        <div class="reader-head">
          <h2>${escapeHtml(data.reference)}</h2>
          <span class="reader-version">${escapeHtml(CURRENT_VERSION_LABEL)}</span>
        </div>
        <div class="verse-block">
          ${data.verses.map(v => `<p class="verse-line" data-verse="${v.verse}"><span class="verse-num">${v.verse}</span>${escapeHtml(v.text)}</p>`).join('')}
        </div>
      </div>
    `;
    syncReaderPrefs();
    scrollToReader(wrap);
    fetchJSON('/api/member/bible-read', { method: 'POST' }).catch(() => {}); // only counts if logged in; silently skips otherwise
  } catch (e) {
    CURRENT_VERSES = [];
    wrap.innerHTML = `<p class="empty-state">${escapeHtml(e.message || 'Could not load this passage right now.')}</p>`;
  }
}

// Landing on the page should show the page, so the first chapter is left
// where it is; changing chapter afterwards brings the new one up to just below
// the toolbar, which is sticky and would otherwise cover its heading.
function scrollToReader(wrap) {
  if (firstRender) { firstRender = false; return; }
  const bar = document.querySelector('.reader-bar');
  const offset = (bar ? bar.offsetHeight : 0) + 24;
  const top = wrap.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

function renderExternalVersion(version, reference) {
  CURRENT_VERSES = [];
  CURRENT_REFERENCE = reference;
  const url = version.urlTemplate.replace('{reference}', encodeURIComponent(reference));
  const wrap = document.getElementById('verseWrap');
  wrap.innerHTML = `
    <div class="external-version">
      <h3>${escapeHtml(version.label)}</h3>
      <p>${escapeHtml(version.note)}</p>
      <a class="btn btn-flame btn-sm" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
        Open ${escapeHtml(reference)} in this version &rarr;
      </a>
      <p style="margin:16px auto 0; font-size:0.8rem; opacity:0.75;">
        Published by ${escapeHtml(version.publisher || 'its publisher')}.
      </p>
    </div>
  `;
  scrollToReader(wrap);
}

// ---------- reading preferences ----------
function applyTheme(theme) {
  const valid = ['day', 'sepia', 'night'].includes(theme) ? theme : 'day';
  PREF.write('theme', valid);
  document.querySelectorAll('#themeGroup [data-theme]').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.theme === valid));
  });
  syncReaderPrefs();
}

function applySize(size) {
  const clamped = Math.min(MAX_SIZE, Math.max(MIN_SIZE, Number(size) || 1.08));
  PREF.write('size', clamped.toFixed(2));
  syncReaderPrefs();
}

function stepSize(delta) {
  applySize(Number(PREF.read('size', '1.08')) + delta);
}

function applyFlow(flow) {
  const valid = flow === 'paragraph' ? 'paragraph' : 'verse';
  PREF.write('flow', valid);
  document.getElementById('flowBtn').setAttribute('aria-pressed', String(valid === 'paragraph'));
  syncReaderPrefs();
}

// The preferences live on the reader element, which is replaced on every
// chapter load - so they are re-applied rather than set once.
function syncReaderPrefs() {
  const reader = document.getElementById('reader');
  if (!reader) return;
  reader.dataset.theme = PREF.read('theme', 'day');
  reader.dataset.flow = PREF.read('flow', 'verse');
  reader.style.setProperty('--reader-size', PREF.read('size', '1.08') + 'rem');
}

// ---------- one verse at a time ----------
function selectVerse(line) {
  document.querySelectorAll('.verse-line.is-active').forEach(el => el.classList.remove('is-active'));
  line.classList.add('is-active');
  selectedVerse = Number(line.dataset.verse);
  document.getElementById('verseActions').hidden = false;
}

function clearSelection() {
  document.querySelectorAll('.verse-line.is-active').forEach(el => el.classList.remove('is-active'));
  selectedVerse = null;
  const bar = document.getElementById('verseActions');
  if (bar) bar.hidden = true;
}

function selectedVerseParts() {
  const verse = CURRENT_VERSES.find(v => v.verse === selectedVerse);
  if (!verse) return null;
  const book = CURRENT_REFERENCE.replace(/\s*\d+$/, '');
  const chapter = document.getElementById('chapterSelect').value;
  return { text: verse.text, reference: `${book} ${chapter}:${verse.verse}` };
}

async function copySelectedVerse() {
  const parts = selectedVerseParts();
  if (!parts) return;
  const line = `"${parts.text}" (${parts.reference})`;
  try {
    await navigator.clipboard.writeText(line);
    showToast('Verse copied.', 'success');
  } catch (e) {
    showToast('Could not copy the verse.', 'error');
  }
  clearSelection();
}

function shareSelectedVerse() {
  const parts = selectedVerseParts();
  if (!parts) return;
  shareContent({
    title: parts.reference,
    text: `"${parts.text}" (${parts.reference})`,
    url: `${location.origin}/bible.html?book=${encodeURIComponent(document.getElementById('bookSelect').value)}&chapter=${document.getElementById('chapterSelect').value}`
  });
  clearSelection();
}

async function shareSelectedVerseImage() {
  const parts = selectedVerseParts();
  if (!parts) return;
  clearSelection();
  // The picker, the share sheet and the download fallback all live in
  // main.js, so the home screen and this page offer exactly the same thing.
  await shareVerseCard({ text: parts.text, reference: parts.reference });
}

function downloadChapter() {
  if (!CURRENT_VERSES.length) return showToast('Nothing to save on this screen.', 'error');
  const text = `${CURRENT_REFERENCE} (${CURRENT_VERSION_LABEL})\n\n` +
    CURRENT_VERSES.map(v => `${v.verse}. ${v.text}`).join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${CURRENT_REFERENCE.replace(/\s+/g, '_')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Chapter saved to your device.', 'success');
}
