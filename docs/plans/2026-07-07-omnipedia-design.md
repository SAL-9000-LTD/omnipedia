# OmniPedia — design (2026-07-07)

## Ian's vision (verbatim, 2026-07-07)

> I want you to create an extension chrome/brave that activates on wikipedia articles. It will add in the data from wikipedia in other languages on the same article that is missing from the English article to create a complete and comprehensive set of data. As an example https://en.wikipedia.org/wiki/Heiko_von_der_Leyen there is different information on this person in each language and I want it so that the normal English page would be injected with the missing information from the other languages that go into more depth. It should be an automatic translation and insertion process.

## What it is

A Manifest V3 extension for Chrome and Brave. On any English Wikipedia article it finds the same article in other language editions, translates their content to English, detects which passages carry information the English article does not have, and injects those passages inline into the page, each labelled with its source language and a link to the original. The whole pipeline runs automatically on page load; a status pill shows progress and lets you hide the injected material or re-run.

## Verified ground truth (checked live 2026-07-07)

- Langlinks API returns the per-language titles; they differ from the English title (Arabic title for Heiko is in Arabic script), so every downstream call must use the langlink's own title.
- Article sizes for the example: en 7,960 bytes; es 9,635; fr 7,182; de 5,868; sl 3,339; eo 1,486. Spanish is larger than English, so source ranking must be by size, not by assumption about the subject's home language.
- `https://<lang>.wikipedia.org/api/rest_v1/page/html/<title>` serves Parsoid HTML with CORS.
- `https://translate.googleapis.com/translate_a/t?client=gtx&sl=<l>&tl=en` accepts multiple `q` form fields via POST and returns a JSON array of translations, one per `q`. Verified working. `/translate_a/single` works as a per-item fallback.

## Decisions and alternatives

**Trigger: automatic on article load.** Ian's words: "automatic translation and insertion process." A click-to-run button was considered and rejected as contrary to the vision. Mitigations for cost/latency: caching, a progress pill, and an auto-run toggle in the popup.

**Translation engine: Chrome built-in Translator API when present, Google web endpoint otherwise.** Chrome 138+ ships an on-device Translator API (free, private). Brave strips Google's AI components, so it will almost certainly lack it; there the extension uses the free `client=gtx` web endpoint (no key, unofficial, could in principle break or rate-limit — acceptable for a personal tool; requests are batched and throttled). A paid or local-LLM engine was rejected for v1 under the cost-governance rule. Both engines sit behind one interface; the engine actually used is reported in the pill. Note: with the gtx path, article text is sent to Google.

**Missing-info detection: lexical novelty scoring.** Translate candidate blocks (paragraphs and list items) from each source edition, then score each against a token index of the English article: content-word coverage (share of the block's distinct meaningful words already present anywhere in the English text) plus number/date coverage scored separately, since a paragraph about the same person mentioning new dates, counts, or places is exactly the "missing information" case. Blocks below threshold get injected; accepted blocks feed back into the index so the same fact arriving from a second language is not injected twice (editions are processed in size order, sequentially, so dedup is deterministic). An LLM-based semantic diff would be better and is the natural v2, but is paid/heavy; a Wikidata-only structured diff misses prose depth, which is the actual ask. Thresholds are constants in one place, tuned against the live example article.

**Source selection: rank all langlinks by article byte size.** Fetch `prop=info` per linked edition (concurrency-limited, capped at 40 editions), rank by size descending, take the top N (default 5) above a 2,000-byte floor. No hand-curated language list; the example proves the deep edition can be any language.

**Placement: match sections by translated heading, overflow to a tail section.** Source section headings are translated first (cheap) and matched to English section headings via normalisation plus a synonym map for standard Wikipedia headings (Life/Biography, Career, Works, Personal life, ...). Novel blocks from a matched section are appended at the end of that English section; blocks from unmatched sections go to a new "Additional information from other language editions" section inserted before References. Reference-type sections (References, External links, See also, Bibliography) are never mined. Injected content is inserted as text nodes only — no HTML from remote/translated content ever reaches innerHTML.

**Fetching: everything cross-origin goes through the background service worker.** Host permissions make the worker immune to CORS and keep one code path for Wikipedia APIs and the translator.

**Caching: chrome.storage.local.** Key = title + sorted per-language lastrevids + settings fingerprint. Langlinks and info queries always run live (cheap, ~1 s) so revision changes are always noticed; HTML fetch + translation (the expensive part) only runs on cache miss. 14-day TTL, capped entry count.

## Components

- `manifest.json` — MV3; content scripts on `https://en.wikipedia.org/wiki/*`; host permissions for `*.wikipedia.org` and `translate.googleapis.com`; storage permission.
- `background.js` — message router: `fetch` (URL → text) and `translate` (items, source lang → translated items) with batch packing, throttling, retry/backoff, and the gtx wire formats.
- `content/lib.js` — pure logic: tokeniser, coverage index, novelty scorer, heading normaliser/matcher, batch packer. Loaded both as a content script and by node for tests.
- `content/wiki.js` — Wikipedia API wrappers (langlinks, info, Parsoid HTML) and the block extractor (flat walk of h2–h4/p/li, skipping tables, infoboxes, navboxes, references; per-block source text cleaned of citation markers).
- `content/translate.js` — engine selection: built-in Translator API if available, else background gtx; per-language translator cache.
- `content/inject.js` — DOM: the labelled blocks, per-language colours, the tail section, the status pill, show/hide state.
- `content/main.js` — orchestrator: guards (article namespace only), settings, cache check, source selection, sequential per-language pipeline (extract → translate headings → plan placement → translate blocks → score → inject), cache write, pill updates. Listens for popup messages (run now, force re-run).
- `content/content.css` — block, tail-section, and pill styling; works on Wikipedia's light and dark themes.
- `popup/popup.html|js` — settings (auto-run, max languages, novelty threshold, show/hide), Run now, Clear cache.
- `tests/lib.test.mjs` — node --test suite for lib.js.
- `smoke/smoke.mjs` — Playwright (cached Chromium, `--load-extension`) drives the live Heiko article, asserts injected blocks, dumps per-language counts and sample passages, screenshots.

## Failure handling

Per-language isolation: a fetch or translation failure skips that language and is named in the pill; other languages proceed. Endpoint-down means the page is simply unmodified apart from the pill note. No retries beyond the translator's own backoff; no error states are cached.

## Out of scope for v1 (noted, deliberate)

Infobox/table mining, non-English target wikis, the mobile domain, icons/Web Store packaging, LLM semantic diff, per-block accept/reject UI.
