'use strict';

(() => {
  const log = (...a) => console.log('[omni]', ...a);
  const setState = s => { document.documentElement.dataset.omniState = s; };

  if (!document.body || !document.body.classList.contains('ns-0')) return;
  if (location.pathname === '/wiki/Main_Page') return;

  const viewLang = OmniWiki.langFromHost(location.hostname);
  if (!viewLang) return;

  let displayNames;
  try {
    displayNames = new Intl.DisplayNames([viewLang, 'en'], { type: 'language' });
  } catch {
    displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
  }
  const langName = code => {
    try { return displayNames.of(code) || code; } catch { return code; }
  };

  async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }));
    return out;
  }

  let running = false;

  async function run(force = false) {
    if (running) return;
    running = true;
    setState('running');
    OmniUI.ensurePill({ rerun: () => run(true) });
    try {
      const S = { ...OmniLib.DEFAULTS, ...(await chrome.storage.sync.get(null)) };
      const title = decodeURIComponent(location.pathname.slice('/wiki/'.length));

      OmniUI.status('finding other language editions…');
      const langlinks = await OmniWiki.getLanglinks(viewLang, title);
      if (!langlinks.length) return finish([], [], null, false, 'no other language editions');

      const pageInfo = await OmniWiki.getInfo(viewLang, title).catch(() => null);
      const infos = (await mapLimit(langlinks.slice(0, 40), 6,
        l => OmniWiki.getInfo(l.lang, l.title).catch(() => null)))
        .filter(i => i && i.lang !== viewLang);
      const sources = OmniLib.pickSources(infos, S);
      if (!sources.length) return finish([], [], null, false, 'other editions are too small to mine');
      log('sources:', sources.map(s => `${s.lang}(${s.length}b)`).join(' '));

      const cacheKey = `cache:${viewLang}:${title}`;
      const fingerprint = JSON.stringify([
        pageInfo && pageInfo.revid,
        sources.map(s => [s.lang, s.revid]),
        S.noveltyThreshold, S.maxLanguages, S.minSourceBytes,
      ]);
      if (!force) {
        const hit = (await chrome.storage.local.get(cacheKey))[cacheKey];
        if (hit && hit.fingerprint === fingerprint && Date.now() - hit.when < 14 * 864e5) {
          log('cache hit:', hit.plan.length, 'blocks');
          render(hit.plan);
          return finish(hit.plan, hit.failures || [], hit.engine, true);
        }
      }

      const page = OmniWiki.pageSections();
      const pageHeadings = page.h2s.map(s => ({ key: s.key }));
      const index = OmniLib.createIndex();
      OmniLib.indexAdd(index, OmniWiki.indexText(page.content));
      OmniLib.indexAdd(index, document.title);

      const plan = [];
      const failures = [];
      const engineNote = { engine: null };
      const MAX_CANDIDATES = 60;
      const LANG_BUDGET_MS = 150000;

      async function processSource(src, name, progress) {
        OmniUI.status(`reading the ${name} edition… ${progress}`);
        const t0 = Date.now();
        const html = await OmniWiki.getArticleHTML(src.lang, src.title);
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const sections = OmniWiki.extractSections(doc.body);
        log(`${src.lang}: fetched ${Math.round(html.length / 1024)}KB, ${sections.length} sections in ${Date.now() - t0}ms`);

        const headingItems = [];
        sections.forEach((s, i) => { if (s.heading) headingItems.push({ id: 'h' + i, text: s.heading }); });
        const hMap = headingItems.length
          ? await OmniTranslate.translateItems(headingItems, src.lang, viewLang, engineNote)
          : {};
        const meta = sections.map((s, i) => {
          const th = s.heading ? OmniLib.cleanText(hMap['h' + i] || s.heading) : null;
          const key = th ? OmniLib.headingKey(th) : null;
          return {
            th,
            skip: key === '__skip',
            target: th && key !== '__skip' ? OmniLib.matchHeading(th, pageHeadings) : null,
          };
        });

        let cands = [];
        sections.forEach((s, i) => {
          if (meta[i].skip) return;
          for (const b of s.blocks) {
            if (!b.small) cands.push({ id: `${i}.${cands.length}`, sec: i, text: b.text });
          }
        });
        if (cands.length > MAX_CANDIDATES) {
          log(`${src.lang}: capping candidates ${cands.length} -> ${MAX_CANDIDATES}`);
          cands = cands.slice(0, MAX_CANDIDATES);
        }
        if (!cands.length) { log(`${src.lang}: no candidate passages`); return []; }

        OmniUI.status(`translating ${cands.length} passages from ${name}… ${progress}`);
        const t1 = Date.now();
        const tMap = await OmniTranslate.translateItems(
          cands.map(c => ({ id: c.id, text: c.text })), src.lang, viewLang, engineNote);
        log(`${src.lang}: translated ${cands.length} passages in ${Math.round((Date.now() - t1) / 1000)}s`);

        const entries = [];
        let nulls = 0;
        const covs = [];
        for (const c of cands) {
          const raw = tMap[c.id];
          if (!raw) { nulls++; continue; }
          const text = OmniLib.cleanText(raw);
          const verdict = OmniLib.isNovel(text, index, S.noveltyThreshold);
          if (verdict.wordCov !== null) covs.push(verdict.wordCov);
          if (!verdict.novel) continue;
          OmniLib.indexAdd(index, text);
          entries.push({
            lang: src.lang,
            langName: name,
            srcUrl: `https://${src.lang}.wikipedia.org/wiki/${encodeURIComponent(src.title.replace(/ /g, '_'))}`,
            secHeading: meta[c.sec].th,
            target: meta[c.sec].target,
            text,
          });
        }
        covs.sort((a, b) => a - b);
        const median = covs.length ? covs[covs.length >> 1] : null;
        log(`${src.lang}: ${entries.length} novel of ${cands.length} (nulls ${nulls}, ` +
          `wordCov min ${covs.length ? covs[0].toFixed(2) : '-'} median ${median !== null ? median.toFixed(2) : '-'}, ` +
          `engine: ${engineNote.engine})`);
        return entries;
      }

      for (let si = 0; si < sources.length; si++) {
        const src = sources[si];
        const name = langName(src.lang);
        try {
          const entries = await Promise.race([
            processSource(src, name, `(${si + 1}/${sources.length})`),
            new Promise((_, rej) => setTimeout(() => rej(new Error('language time budget exceeded')), LANG_BUDGET_MS)),
          ]);
          plan.push(...entries);
        } catch (e) {
          log(src.lang, 'failed:', String(e));
          failures.push(src.lang);
        }
      }

      render(plan);
      await saveCache(cacheKey, {
        when: Date.now(), fingerprint, plan, failures, engine: engineNote.engine,
      });
      finish(plan, failures, engineNote.engine, false);
    } catch (e) {
      log('fatal:', String(e));
      OmniUI.error(`failed: ${String(e).slice(0, 140)}`);
      setState('error');
    } finally {
      running = false;
    }
  }

  function render(plan) {
    OmniUI.reset();
    const page = OmniWiki.pageSections();
    for (const p of plan) {
      const block = OmniUI.makeBlock(p);
      if (p.target != null && page.h2s[p.target]) OmniUI.insertAtSectionEnd(page, p.target, block);
      else OmniUI.tailAdd(page, p, block);
    }
  }

  function finish(plan, failures, engine, cached, emptyReason) {
    let text;
    if (emptyReason) {
      text = emptyReason;
    } else if (!plan.length) {
      text = 'nothing missing — this article already covers the other editions';
    } else {
      const perLang = {};
      for (const p of plan) perLang[p.langName] = (perLang[p.langName] || 0) + 1;
      const parts = Object.entries(perLang).map(([n, c]) => `${n} ${c}`);
      text = `added ${plan.length} translated passages (${parts.join(', ')})`;
    }
    if (cached) text += ' · cached';
    if (failures.length) text += ` · failed: ${failures.join(', ')}`;
    OmniUI.done(text);
    setState('done');
  }

  async function saveCache(key, value) {
    try {
      await chrome.storage.local.set({ [key]: value });
      const all = await chrome.storage.local.get(null);
      const keys = Object.keys(all).filter(k => k.startsWith('cache:'));
      if (keys.length > 40) {
        keys.sort((a, b) => (all[a].when || 0) - (all[b].when || 0));
        await chrome.storage.local.remove(keys.slice(0, keys.length - 40));
      }
    } catch (e) {
      log('cache write failed:', String(e));
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'omni-run') {
      run(!!msg.force);
      sendResponse({ ok: true });
    }
  });

  chrome.storage.sync.get(null).then(s => {
    if ({ ...OmniLib.DEFAULTS, ...s }.autoRun) run();
  });
})();
