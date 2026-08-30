import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const L = require('../content/lib.js');

// --- tokenize ---

test('tokenize extracts lowercased content words, dropping stopwords and short words', () => {
  const t = L.tokenize('He was the Medical Director of a hospital in Hannover.');
  assert.ok(t.words.has('medical'));
  assert.ok(t.words.has('director'));
  assert.ok(t.words.has('hospital'));
  assert.ok(t.words.has('hannover'));
  assert.ok(!t.words.has('the'));
  assert.ok(!t.words.has('was'));
  assert.ok(!t.words.has('he'));
  assert.ok(!t.words.has('of'));
});

test('tokenize extracts numbers with thousands separators stripped', () => {
  const t = L.tokenize('In 1992 he earned 12,500 dollars and a 3.5 rating.');
  assert.ok(t.numbers.has('1992'));
  assert.ok(t.numbers.has('12500'));
  assert.ok(t.numbers.has('3.5'));
});

test('tokenize handles unicode letters', () => {
  const t = L.tokenize('Studied in Düsseldorf and worked with José María.');
  assert.ok(t.words.has('düsseldorf'));
  assert.ok(t.words.has('josé'));
});

// --- index + coverage ---

test('coverage reflects the fraction of block tokens already in the index', () => {
  const idx = L.createIndex();
  L.indexAdd(idx, 'He studied medicine in Hannover and Berlin in 1990.');
  const covered = L.coverage(L.tokenize('He studied medicine in Berlin in 1990.'), idx);
  assert.equal(covered.word, 1);
  assert.equal(covered.number, 1);
  const half = L.coverage(L.tokenize('He studied astrophysics in Berlin.'), idx);
  assert.ok(half.word > 0 && half.word < 1);
});

test('coverage returns null for token kinds the block does not have', () => {
  const idx = L.createIndex();
  L.indexAdd(idx, 'Some background text.');
  const c = L.coverage(L.tokenize('Completely wordless? No: words exist here today.'), idx);
  assert.equal(c.number, null);
});

// --- novelty ---

test('isNovel accepts a paragraph mostly absent from the index', () => {
  const idx = L.createIndex();
  L.indexAdd(idx, 'Heiko von der Leyen is a German physician. He is married to Ursula von der Leyen.');
  const block = 'From 1992 he worked at the Hannover Medical School on gene therapy research, leading a cardiology laboratory funded by the German Research Foundation.';
  const r = L.isNovel(block, idx, 0.5);
  assert.equal(r.novel, true);
});

test('isNovel rejects a paragraph that restates indexed content', () => {
  const idx = L.createIndex();
  L.indexAdd(idx, 'Heiko von der Leyen is a German physician and university professor. He is married to Ursula von der Leyen, President of the European Commission. They have seven children.');
  const block = 'Heiko von der Leyen is a German physician married to Ursula von der Leyen. They have seven children.';
  const r = L.isNovel(block, idx, 0.5);
  assert.equal(r.novel, false);
});

test('isNovel rejects blocks with too few content words to judge', () => {
  const idx = L.createIndex();
  const r = L.isNovel('Born 1955.', idx, 0.5);
  assert.equal(r.novel, false);
});

test('isNovel accepts a same-topic paragraph whose numbers are new', () => {
  const idx = L.createIndex();
  L.indexAdd(idx, 'He joined the pharmaceutical company as medical director, overseeing clinical trials of cardiovascular drugs for the company in Hannover.');
  const block = 'As medical director he oversaw clinical trials at the company from 2005 until 2019, managing a budget of 40 million euros in Hannover.';
  const r = L.isNovel(block, idx, 0.5);
  assert.equal(r.novel, true);
});

// --- accepted blocks feed the index (cross-language dedup) ---

test('indexAdd after acceptance makes the same fact from another language non-novel', () => {
  const idx = L.createIndex();
  L.indexAdd(idx, 'Short English article about a physician.');
  const german = 'He led the gene therapy research laboratory at Hannover Medical School from 1992, studying cardiovascular gene transfer.';
  assert.equal(L.isNovel(german, idx, 0.5).novel, true);
  L.indexAdd(idx, german);
  const french = 'From 1992 he led a laboratory for gene therapy research at the Hannover Medical School.';
  assert.equal(L.isNovel(french, idx, 0.5).novel, false);
});

// --- headings ---

test('headingKey canonicalises synonymous section headings', () => {
  assert.equal(L.headingKey('Biography'), L.headingKey('Life'));
  assert.equal(L.headingKey('Early life'), L.headingKey('Life'));
  assert.equal(L.headingKey('Career'), L.headingKey('Professional career'));
  assert.equal(L.headingKey('Private life'), L.headingKey('Personal life'));
  assert.equal(L.headingKey('Honours'), L.headingKey('Awards'));
});

test('headingKey flags reference-type sections as skippable', () => {
  for (const h of ['References', 'External links', 'See also', 'Notes', 'Sources', 'Further reading', 'Bibliography']) {
    assert.equal(L.headingKey(h), '__skip', h);
  }
});

test('matchHeading finds exact canonical matches', () => {
  const english = [{ key: L.headingKey('Career') }, { key: L.headingKey('Personal life') }];
  assert.equal(L.matchHeading('Professional career', english), 0);
  assert.equal(L.matchHeading('Private life', english), 1);
});

test('matchHeading falls back to token overlap and returns null when nothing fits', () => {
  const english = [{ key: L.headingKey('Medical career') }];
  assert.equal(L.matchHeading('Career in medicine', english), 0);
  assert.equal(L.matchHeading('Controversies', english), null);
});

// --- batching ---

test('packBatches groups items under the char limit preserving order', () => {
  const items = [
    { id: 'a', text: 'x'.repeat(40) },
    { id: 'b', text: 'y'.repeat(40) },
    { id: 'c', text: 'z'.repeat(40) },
  ];
  const batches = L.packBatches(items, 100);
  assert.equal(batches.length, 2);
  assert.deepEqual(batches[0].map(i => i.id), ['a', 'b']);
  assert.deepEqual(batches[1].map(i => i.id), ['c']);
});

test('packBatches gives an oversized item its own batch', () => {
  const items = [{ id: 'big', text: 'x'.repeat(500) }, { id: 'small', text: 'y'.repeat(10) }];
  const batches = L.packBatches(items, 100);
  assert.equal(batches.length, 2);
  assert.equal(batches[0][0].id, 'big');
});

// --- text cleaning ---

test('cleanText collapses whitespace and strips citation remnants', () => {
  assert.equal(L.cleanText('He  worked[1] in\nHannover.[2][3]'), 'He worked in Hannover.');
});

test('cleanText decodes common HTML entities from the translator', () => {
  assert.equal(L.cleanText('Ursula&#39;s husband &amp; family &quot;doctor&quot;'), 'Ursula\'s husband & family "doctor"');
});

// --- gtx wire formats ---

test('gtxParseT parses a multi-q array response', () => {
  const out = L.gtxParseT('["Good day","He is a doctor."]', 2);
  assert.deepEqual(out, ['Good day', 'He is a doctor.']);
});

test('gtxParseT wraps a bare-string single response', () => {
  const out = L.gtxParseT('"Good day"', 1);
  assert.deepEqual(out, ['Good day']);
});

test('gtxParseT throws on count mismatch', () => {
  assert.throws(() => L.gtxParseT('["only one"]', 2));
});

test('gtxParseSingle joins translation segments', () => {
  const raw = JSON.stringify([[['Good day.\n\n', 'Guten Tag.\n\n', null, null, 10], ['He is a doctor.', 'Er ist Arzt.', null, null, 3]], null, 'de']);
  assert.equal(L.gtxParseSingle(raw), 'Good day.\n\nHe is a doctor.');
});

// --- source ranking ---

test('pickSources ranks by byte size, applies the floor, and caps the count', () => {
  const infos = [
    { lang: 'eo', length: 1486 },
    { lang: 'es', length: 9635 },
    { lang: 'sl', length: 3339 },
    { lang: 'de', length: 5868 },
    { lang: 'fr', length: 7182 },
  ];
  const picked = L.pickSources(infos, { maxLanguages: 3, minSourceBytes: 2000 });
  assert.deepEqual(picked.map(p => p.lang), ['es', 'fr', 'de']);
});
