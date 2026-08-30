'use strict';

importScripts('content/lib.js');

const GTX_T = 'https://translate.googleapis.com/translate_a/t';
const GTX_SINGLE = 'https://translate.googleapis.com/translate_a/single';

// Space out translator calls; the endpoint is unofficial and unauthenticated.
let nextSlot = 0;
function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = now + wait + 250;
  return new Promise(r => setTimeout(r, wait));
}

async function postForm(url, params, retries = 3) {
  for (let attempt = 0; ; attempt++) {
    await throttle();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: params.toString(),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.fatal = true;
        throw err;
      }
      return await res.text();
    } catch (e) {
      if (e.fatal || attempt >= retries) throw e;
      await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
    }
  }
}

async function translateBatch(texts, from) {
  // client/sl/tl must be query params — in the POST body the endpoint 405s.
  const url = `${GTX_T}?` + new URLSearchParams({ client: 'gtx', sl: from, tl: 'en' });
  const params = new URLSearchParams();
  for (const t of texts) params.append('q', t);
  const raw = await postForm(url, params);
  return OmniLib.gtxParseT(raw, texts.length);
}

async function translateSingle(text, from) {
  const params = new URLSearchParams({ client: 'gtx', sl: from, tl: 'en', dt: 't', q: text });
  const raw = await postForm(GTX_SINGLE, params);
  return OmniLib.gtxParseSingle(raw);
}

async function translateItems(items, from) {
  const out = {};
  for (const batch of OmniLib.packBatches(items, 3600)) {
    try {
      const translated = await translateBatch(batch.map(i => i.text), from);
      batch.forEach((item, i) => { out[item.id] = translated[i]; });
    } catch (e) {
      for (const item of batch) {
        try {
          out[item.id] = await translateSingle(item.text, from);
        } catch {
          out[item.id] = null;
        }
      }
    }
  }
  return out;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'fetch') {
    fetch(msg.url, { headers: { Accept: msg.accept || '*/*' } })
      .then(async res => sendResponse({ ok: res.ok, status: res.status, text: await res.text() }))
      .catch(e => sendResponse({ ok: false, status: 0, text: '', error: String(e) }));
    return true;
  }
  if (msg.type === 'translate') {
    translateItems(msg.items, msg.from)
      .then(map => sendResponse({ ok: true, map }))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
});
