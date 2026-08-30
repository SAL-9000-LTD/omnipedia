'use strict';

// One interface, two engines: the browser's on-device Translator API when a
// language pack is actually available (Chrome 138+), otherwise the free
// Google web endpoint via the service worker.
const OmniTranslate = (() => {
  const builtins = new Map();

  // Wikipedia edition codes that are not Translator / gtx language codes.
  function translateCode(wikiLang) {
    if (wikiLang === 'simple') return 'en';
    return wikiLang;
  }

  async function builtinFor(from, to) {
    const key = `${from}|${to}`;
    if (builtins.has(key)) return builtins.get(key);
    let t = null;
    try {
      if (typeof Translator !== 'undefined' && Translator.availability) {
        const a = await Translator.availability({ sourceLanguage: from, targetLanguage: to });
        if (a === 'available') t = await Translator.create({ sourceLanguage: from, targetLanguage: to });
      }
    } catch {
      t = null;
    }
    builtins.set(key, t);
    return t;
  }

  function bgTranslate(items, from, to) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'translate', items, from, to }, res => {
        if (chrome.runtime.lastError || !res || !res.ok) resolve(null);
        else resolve(res.map);
      });
    });
  }

  // items: [{id, text}] -> {id: translatedText | null}
  async function translateItems(items, from, to, note) {
    const sl = translateCode(from);
    const tl = translateCode(to);
    if (sl === tl) {
      const out = {};
      for (const item of items) out[item.id] = item.text;
      return out;
    }
    const out = {};
    const bi = await builtinFor(sl, tl);
    if (bi) {
      note.engine = 'on-device';
      for (const item of items) {
        try {
          out[item.id] = await bi.translate(item.text);
        } catch {
          out[item.id] = null;
        }
      }
      return out;
    }
    note.engine = 'Google web endpoint';
    for (const pack of OmniLib.packBatches(items, 3600)) {
      const map = await bgTranslate(pack, sl, tl);
      if (map) Object.assign(out, map);
      else pack.forEach(i => { out[i.id] = null; });
    }
    return out;
  }

  return { translateItems };
})();
