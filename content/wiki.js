'use strict';

// Wikipedia access + article structure extraction.
const OmniWiki = (() => {
  const SKIP_SEL = 'table, .infobox, .navbox, .vertical-navbox, .sidebar, .metadata, .reflist, ' +
    '.mw-references-wrap, ol.references, .refbegin, figure, .thumb, .hatnote, .ambox, .toc, #toc, ' +
    '.catlinks, .printfooter, .mw-authority-control, .omni-block, .omni-tail, [role="navigation"]';

  function langFromHost(hostname) {
    const m = String(hostname).match(/^([a-z0-9-]+)\.wikipedia\.org$/i);
    if (!m) return null;
    const lang = m[1].toLowerCase();
    if (lang === 'www' || lang === 'm') return null;
    return lang;
  }

  function bgFetch(url, accept) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'fetch', url, accept }, res => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res || !res.ok) return reject(new Error(`fetch ${res ? res.status : 'no-response'}: ${url.slice(0, 100)}`));
        resolve(res.text);
      });
    });
  }

  async function api(host, params) {
    const url = `https://${host}/w/api.php?` +
      new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
    return JSON.parse(await bgFetch(url, 'application/json'));
  }

  async function getLanglinks(lang, title) {
    const d = await api(`${lang}.wikipedia.org`, {
      action: 'query', titles: title, prop: 'langlinks', lllimit: '500', redirects: '1',
    });
    const page = d.query && d.query.pages && d.query.pages[0];
    return (page && page.langlinks) || [];
  }

  async function getInfo(lang, title) {
    const d = await api(`${lang}.wikipedia.org`, {
      action: 'query', titles: title, prop: 'info', redirects: '1',
    });
    const page = d.query && d.query.pages && d.query.pages[0];
    if (!page || page.missing) throw new Error(`${lang}: page missing`);
    return { lang, title: page.title, length: page.length || 0, revid: page.lastrevid || 0 };
  }

  async function getArticleHTML(lang, title) {
    try {
      const t = encodeURIComponent(title.replace(/ /g, '_'));
      return await bgFetch(`https://${lang}.wikipedia.org/api/rest_v1/page/html/${t}`, 'text/html');
    } catch {
      const d = await api(`${lang}.wikipedia.org`, { action: 'parse', page: title, prop: 'text', redirects: '1' });
      return d.parse.text;
    }
  }

  function cleanNodeText(node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll('sup, sub, style, script, math, .mw-editsection, .noprint, .mw-cite-backlink, .mw-ref, .reference')
      .forEach(el => el.remove());
    return OmniLib.cleanText(clone.textContent);
  }

  // Flat document-order walk that works on both Parsoid HTML (foreign
  // editions) and the live rendered page DOM.
  function extractSections(container) {
    const sections = [{ heading: null, level: 2, blocks: [], headingEl: null }];
    for (const el of container.querySelectorAll('h2, h3, h4, p, li')) {
      if (el.closest(SKIP_SEL)) continue;
      const tag = el.tagName;
      if (tag === 'H2' || tag === 'H3' || tag === 'H4') {
        const heading = cleanNodeText(el);
        if (heading) sections.push({ heading, level: Number(tag[1]), blocks: [], headingEl: el });
      } else {
        if (tag === 'LI' && el.querySelector('li')) continue; // parent of a nested list: children carry the text
        const text = cleanNodeText(el);
        if (text.length >= 15) {
          sections[sections.length - 1].blocks.push({ text, small: text.length < 80, el });
        }
      }
    }
    return sections;
  }

  function pageSections() {
    const content = document.querySelector('#mw-content-text .mw-parser-output')
      || document.querySelector('#mw-content-text');
    const sections = extractSections(content);
    const h2s = sections.filter(s => s.level === 2 && s.heading);
    for (const s of h2s) s.key = OmniLib.headingKey(s.heading);
    return { content, sections, h2s };
  }

  // Broad coverage text for the novelty index: everything the page you are
  // reading already states (prose, infobox, captions), minus reference lists
  // and navboxes whose text would mask genuinely missing facts.
  function indexText(container) {
    const clone = container.cloneNode(true);
    clone.querySelectorAll('.reflist, .mw-references-wrap, ol.references, .refbegin, .navbox, ' +
      '.vertical-navbox, .catlinks, .mw-editsection, sup, style, script, .omni-block, .omni-tail')
      .forEach(el => el.remove());
    return OmniLib.cleanText(clone.textContent);
  }

  return { langFromHost, getLanglinks, getInfo, getArticleHTML, extractSections, pageSections, indexText };
})();
