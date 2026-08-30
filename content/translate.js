'use strict';

// One interface, two engines: the browser's on-device Translator API when a
// language pack is actually available (Chrome 138+), otherwise the free
// Google web endpoint via the service worker.
const OmniTranslate = (() => {
  const builtins = new Map();

  async function builtinFor(lang) {
    if (builtins.has(lang)) return builtins.get(lang);
    let t = null;
    try {
      if (typeof Translator !== 'undefined' && Translator.availability) {
        const a = await Translator.availability({ sourceLanguage: lang, targetLanguage: 'en' });
        if (a === 'available') t = await Translator.create({ sourceLanguage: lang, targetLanguage: 'en' });
      }
    } catch {
      t = null;
    }
    builtins.set(lang, t);
    return t;
  }

  function bgTranslate(items, from) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'translate', items, from }, res => {
        if (chrome.runtime.lastError || !res || !res.ok) resolve(null);
        else resolve(res.map);
      });
    });
  }

  // items: [{id, text}] -> {id: translatedText | null}
  async function translateItems(items, from, note) {
    const out = {};
    const bi = await builtinFor(from);
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
      const map = await bgTranslate(pack, from);
      if (map) Object.assign(out, map);
      else pack.forEach(i => { out[i.id] = null; });
    }
    return out;
  }

  return { translateItems };
})();
