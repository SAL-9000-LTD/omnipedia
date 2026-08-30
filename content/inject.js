'use strict';

// All DOM the extension adds: provenance-labelled blocks, the tail section,
// and the status pill. Translated text is only ever inserted as text nodes.
const OmniUI = (() => {
  const LANG_COLORS = {
    de: '#b8860b', fr: '#1f6feb', es: '#c05717', it: '#2e8b57', ru: '#b22222',
    pt: '#8b008b', nl: '#bf7900', pl: '#c71585', ja: '#7c4a1e', zh: '#a52a2a',
    ar: '#0f766e', uk: '#946800', sv: '#3557a6',
  };
  const EXTRA = ['#7d3ca3', '#0f766e', '#946800', '#3557a6', '#8a3324'];
  const assigned = new Map();

  function colorFor(lang) {
    if (LANG_COLORS[lang]) return LANG_COLORS[lang];
    if (!assigned.has(lang)) assigned.set(lang, EXTRA[assigned.size % EXTRA.length]);
    return assigned.get(lang);
  }

  let pill = null;
  let statusEl = null;

  function ensurePill(handlers) {
    if (pill) return;
    pill = document.createElement('div');
    pill.className = 'omni-pill';
    const brand = document.createElement('strong');
    brand.textContent = 'OmniPedia';
    statusEl = document.createElement('span');
    const hideBtn = document.createElement('button');
    hideBtn.textContent = 'Hide';
    hideBtn.addEventListener('click', () => {
      const hidden = document.documentElement.classList.toggle('omni-hidden');
      hideBtn.textContent = hidden ? 'Show' : 'Hide';
    });
    const rerunBtn = document.createElement('button');
    rerunBtn.textContent = '↻';
    rerunBtn.title = 'Re-run, ignoring the cache';
    rerunBtn.addEventListener('click', () => handlers.rerun());
    pill.append(brand, statusEl, hideBtn, rerunBtn);
    document.body.append(pill);
  }

  function status(t) {
    if (statusEl) statusEl.textContent = t;
    if (pill) pill.classList.remove('omni-error');
  }

  function done(t) {
    if (statusEl) statusEl.textContent = t;
  }

  function error(t) {
    if (statusEl) statusEl.textContent = t;
    if (pill) pill.classList.add('omni-error');
  }

  function makeBlock({ lang, langName, srcUrl, text }) {
    const div = document.createElement('div');
    div.className = 'omni-block';
    div.dataset.lang = lang;
    div.style.setProperty('--omni-c', colorFor(lang));
    const head = document.createElement('div');
    head.className = 'omni-block-head';
    const label = document.createElement('span');
    label.textContent = `${langName} Wikipedia · machine translated · `;
    const a = document.createElement('a');
    a.href = srcUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'original';
    head.append(label, a);
    const body = document.createElement('div');
    body.className = 'omni-text';
    body.textContent = text;
    div.append(head, body);
    return div;
  }

  function wrapperOf(headingEl) {
    return headingEl.closest('.mw-heading') || headingEl;
  }

  function insertAtSectionEnd(eng, idx, block) {
    const next = eng.h2s[idx + 1];
    if (next) wrapperOf(next.headingEl).before(block);
    else eng.content.append(block);
  }

  let tail = null;
  const groups = new Map();

  function ensureTail(eng) {
    if (tail) return tail;
    tail = document.createElement('div');
    tail.className = 'omni-tail';
    const h = document.createElement('h2');
    h.textContent = 'Additional information from other language editions';
    tail.append(h);
    const firstSkip = eng.h2s.find(s => s.key === '__skip');
    if (firstSkip) wrapperOf(firstSkip.headingEl).before(tail);
    else eng.content.append(tail);
    return tail;
  }

  function tailAdd(eng, p, block) {
    const t = ensureTail(eng);
    const gk = `${p.lang}|${p.secHeading || ''}`;
    let g = groups.get(gk);
    if (!g) {
      g = document.createElement('div');
      g.className = 'omni-tail-group';
      const h = document.createElement('h3');
      h.textContent = `${p.secHeading || 'Introduction'} — ${p.langName} Wikipedia`;
      g.append(h);
      t.append(g);
      groups.set(gk, g);
    }
    g.append(block);
  }

  function reset() {
    document.querySelectorAll('.omni-block, .omni-tail').forEach(el => el.remove());
    tail = null;
    groups.clear();
  }

  return { ensurePill, status, done, error, makeBlock, insertAtSectionEnd, tailAdd, reset };
})();
