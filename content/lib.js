'use strict';

// Pure logic shared by the content scripts, the service worker (importScripts),
// and the node test suite. No DOM, no chrome.* APIs in this file.

const OmniLib = (() => {
  const DEFAULTS = {
    autoRun: true,
    maxLanguages: 5,
    noveltyThreshold: 0.5,
    minSourceBytes: 2000,
  };

  const MIN_WORDS = 6;

  const STOPWORDS = new Set((
    'a an the and or but if then else when while of in on at by for with about against between into through ' +
    'during before after above below to from up down out off over under again further once here there where why ' +
    'how all any both each few more most other some such no nor not only own same so than too very can will just ' +
    'should now he she it they them him his her hers its their theirs this that these those i you we me us my your ' +
    'yours our ours is are was were be been being have has had having do does did doing as until unless also may ' +
    'might must shall would could am what which who whom whose because per via since within without upon among ' +
    'along across behind beyond however moreover therefore thus although though still yet even ever never always ' +
    'often later became become becomes born known named called made make makes making took take takes taking went ' +
    'goes going came come comes coming one two three first second new old many much well part also'
  ).split(/\s+/));

  function tokenize(text) {
    const words = new Set();
    const numbers = new Set();
    for (const m of text.match(/\d[\d,.]*/g) || []) {
      const n = m.replace(/,/g, '').replace(/[.,]+$/, '');
      if (n) numbers.add(n);
    }
    for (const m of text.match(/\p{L}+/gu) || []) {
      const w = m.toLowerCase();
      if (w.length >= 3 && !STOPWORDS.has(w)) words.add(w);
    }
    return { words, numbers };
  }

  function createIndex() {
    return { words: new Set(), numbers: new Set() };
  }

  function indexAdd(index, text) {
    const t = tokenize(text);
    for (const w of t.words) index.words.add(w);
    for (const n of t.numbers) index.numbers.add(n);
  }

  function ratioCovered(set, indexSet) {
    if (set.size === 0) return null;
    let hit = 0;
    for (const x of set) if (indexSet.has(x)) hit++;
    return hit / set.size;
  }

  function coverage(tokens, index) {
    return {
      word: ratioCovered(tokens.words, index.words),
      number: ratioCovered(tokens.numbers, index.numbers),
    };
  }

  // A block is worth injecting when most of its vocabulary is absent from the
  // article you are reading, or when it is on-topic but carries mostly new figures.
  function isNovel(text, index, threshold) {
    const t = tokenize(text);
    const cov = coverage(t, index);
    const out = { novel: false, wordCov: cov.word, numCov: cov.number, words: t.words.size };
    if (t.words.size < MIN_WORDS) return out;
    if (cov.word < threshold) out.novel = true;
    else if (t.numbers.size >= 2 && cov.number !== null && cov.number <= 0.34 && cov.word < Math.min(1, threshold + 0.3)) out.novel = true;
    return out;
  }

  const HEADING_GROUPS = {
    life: ['life', 'biography', 'early life', 'early years', 'childhood', 'youth', 'life and career',
      'leben', 'biografie', 'biographie', 'biografía', 'biografia', 'vita', 'leven', 'биография'],
    career: ['career', 'professional career', 'medical career', 'academic career', 'professional life',
      'karriere', 'carrière', 'carrera', 'carriera', 'loopbaan', 'карьера'],
    works: ['works', 'work', 'oeuvre', 'publications', 'selected works', 'selected publications', 'writings',
      'werke', 'werk', 'obras', 'opere', 'werken', 'работы', 'труды'],
    'personal life': ['personal life', 'private life', 'family', 'personal', 'marriage and family',
      'privatleben', 'vie privée', 'vida personal', 'vita privata', 'privéleven', 'личная жизнь'],
    awards: ['awards', 'honours', 'honors', 'awards and honours', 'awards and honors', 'recognition', 'prizes', 'distinctions',
      'auszeichnungen', 'ehrungen', 'récompenses', 'premios', 'premi', 'onderscheidingen', 'награды'],
    education: ['education', 'studies', 'education and training',
      'ausbildung', 'bildung', 'études', 'educación', 'istruzione', 'opleiding', 'образование'],
    death: ['death', 'death and legacy', 'later life and death',
      'tod', 'mort', 'muerte', 'morte', 'overlijden', 'смерть'],
    __skip: ['references', 'notes', 'citations', 'footnotes', 'sources', 'external links', 'see also',
      'further reading', 'bibliography', 'literature', 'web links', 'links', 'gallery', 'commons',
      'individual evidence', 'individual records',
      'einzelnachweise', 'weblinks', 'literatur', 'siehe auch', 'anmerkungen', 'quellen', 'fußnoten', 'fussnoten',
      'références', 'notes et références', 'liens externes', 'voir aussi', 'bibliographie', 'annexes',
      'referencias', 'enlaces externos', 'véase también', 'bibliografía', 'notas',
      'note', 'bibliografia', 'collegamenti esterni', 'voci correlate',
      'referências', 'ligações externas', 'ver também',
      'referenties', 'externe links', 'zie ook', 'literatuur', 'voetnoten', 'bronnen',
      'przypisy', 'linki zewnętrzne', 'zobacz też',
      'примечания', 'ссылки', 'см. также', 'литература'],
  };

  const HEADING_LOOKUP = (() => {
    const m = new Map();
    for (const [key, phrases] of Object.entries(HEADING_GROUPS)) {
      for (const p of phrases) m.set(p, key);
    }
    return m;
  })();

  function normHeading(text) {
    return String(text).toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  }

  function headingKey(text) {
    const n = normHeading(text);
    return HEADING_LOOKUP.get(n) || n;
  }

  function headingTokens(key) {
    const t = new Set();
    for (const w of key.split(' ')) if (w.length >= 3 && !STOPWORDS.has(w)) t.add(w);
    return t;
  }

  function tokensAlike(a, b) {
    if (a === b) return true;
    const n = Math.min(a.length, b.length);
    return n >= 5 && a.slice(0, 5) === b.slice(0, 5);
  }

  function matchHeading(heading, pageHeadings) {
    const key = headingKey(heading);
    if (key === '__skip') return null;
    for (let i = 0; i < pageHeadings.length; i++) {
      if (pageHeadings[i].key === key) return i;
    }
    const ht = [...headingTokens(key)];
    if (ht.length === 0) return null;
    let best = null;
    let bestScore = 0;
    for (let i = 0; i < pageHeadings.length; i++) {
      if (pageHeadings[i].key === '__skip') continue;
      const et = [...headingTokens(pageHeadings[i].key)];
      if (et.length === 0) continue;
      let hits = 0;
      for (const t of ht) if (et.some(e => tokensAlike(t, e))) hits++;
      const score = hits / Math.min(ht.length, et.length);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return bestScore >= 0.6 ? best : null;
  }

  function packBatches(items, maxChars) {
    const batches = [];
    let current = [];
    let len = 0;
    for (const item of items) {
      if (current.length > 0 && len + item.text.length > maxChars) {
        batches.push(current);
        current = [];
        len = 0;
      }
      current.push(item);
      len += item.text.length;
    }
    if (current.length > 0) batches.push(current);
    return batches;
  }

  function decodeEntities(s) {
    return s
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ');
  }

  function cleanText(s) {
    return decodeEntities(String(s))
      .replace(/\[\d+\]/g, '')
      .replace(/\[citation needed\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // translate_a/t returns a bare string for one q, an array of strings for
  // several, and [translation, lang] pairs when sl=auto (which we never use,
  // but tolerate).
  function gtxParseT(jsonText, expectedCount) {
    let p = JSON.parse(jsonText);
    if (typeof p === 'string') p = [p];
    if (!Array.isArray(p)) throw new Error('gtx /t: unexpected response shape');
    const out = p.map(x => (Array.isArray(x) ? String(x[0]) : String(x)));
    if (out.length !== expectedCount) {
      throw new Error(`gtx /t: expected ${expectedCount} translations, got ${out.length}`);
    }
    return out;
  }

  function gtxParseSingle(jsonText) {
    const p = JSON.parse(jsonText);
    if (!Array.isArray(p) || !Array.isArray(p[0])) throw new Error('gtx /single: unexpected response shape');
    return p[0].map(seg => (seg && seg[0]) || '').join('');
  }

  function pickSources(infos, { maxLanguages, minSourceBytes }) {
    return infos
      .filter(i => (i.length || 0) >= minSourceBytes)
      .sort((a, b) => b.length - a.length)
      .slice(0, maxLanguages);
  }

  return {
    DEFAULTS, STOPWORDS, tokenize, createIndex, indexAdd, coverage, isNovel,
    headingKey, matchHeading, packBatches, cleanText, decodeEntities,
    gtxParseT, gtxParseSingle, pickSources,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = OmniLib;
if (typeof globalThis !== 'undefined') globalThis.OmniLib = OmniLib;
