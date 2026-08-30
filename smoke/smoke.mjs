// End-to-end smoke: loads the unpacked extension into Chrome for Testing,
// opens the live Heiko von der Leyen article, and asserts that translated
// blocks from other language editions were injected.
//
//   node smoke/smoke.mjs [url]
//   OMNI_SMOKE_TIMEOUT=15000 node smoke/smoke.mjs   (short run)
//   OMNI_HEADED=1 node smoke/smoke.mjs              (watch it)

import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_TO_TEST = process.argv[2] || 'https://en.wikipedia.org/wiki/Heiko_von_der_Leyen';
const TIMEOUT = Number(process.env.OMNI_SMOKE_TIMEOUT || 180000);
const CHROME = process.env.OMNI_CHROME || path.join(
  os.homedir(),
  'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
);

if (!fs.existsSync(CHROME)) {
  console.error(`No browser at ${CHROME} — set OMNI_CHROME`);
  process.exit(2);
}

const profile = path.join(ROOT, 'smoke', 'profile');
fs.rmSync(profile, { recursive: true, force: true });

const context = await chromium.launchPersistentContext(profile, {
  headless: !process.env.OMNI_HEADED,
  executablePath: CHROME,
  viewport: { width: 1440, height: 1000 },
  args: [
    `--disable-extensions-except=${ROOT}`,
    `--load-extension=${ROOT}`,
  ],
});

let exitCode = 1;
try {
  const page = await context.newPage();
  page.on('console', msg => {
    const t = msg.text();
    if (t.startsWith('[omni]')) console.log(' ', t);
  });
  page.on('pageerror', err => console.log('  [pageerror]', String(err).slice(0, 300)));

  console.log(`opening ${URL_TO_TEST}`);
  await page.goto(URL_TO_TEST, { waitUntil: 'domcontentloaded', timeout: 60000 });

  await page.waitForSelector('.omni-pill', { timeout: 30000 });
  console.log('pill appeared, waiting for pipeline to finish…');

  await page.waitForFunction(
    () => ['done', 'error'].includes(document.documentElement.dataset.omniState),
    null, { timeout: TIMEOUT }
  );

  const stats = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('.omni-block')];
    const byLang = {};
    for (const b of blocks) byLang[b.dataset.lang] = (byLang[b.dataset.lang] || 0) + 1;
    return {
      state: document.documentElement.dataset.omniState,
      total: blocks.length,
      byLang,
      inMatchedSections: blocks.filter(b => !b.closest('.omni-tail')).length,
      inTailSection: blocks.filter(b => b.closest('.omni-tail')).length,
      pill: document.querySelector('.omni-pill')?.innerText.replace(/\n/g, ' | '),
      samples: blocks.slice(0, 4).map(b => ({
        lang: b.dataset.lang,
        text: (b.querySelector('.omni-text')?.textContent || '').slice(0, 260),
      })),
    };
  });

  console.log(JSON.stringify(stats, null, 2));

  if (stats.total > 0) {
    await page.evaluate(() => document.querySelector('.omni-block').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: path.join(ROOT, 'smoke', 'last-run.png') });
  console.log('screenshot -> smoke/last-run.png');

  if (stats.state !== 'done') throw new Error(`pipeline state = ${stats.state}`);
  if (stats.total < 1) throw new Error('no blocks were injected');

  console.log('reloading to verify the cache path…');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => ['done', 'error'].includes(document.documentElement.dataset.omniState),
    null, { timeout: 30000 }
  );
  const second = await page.evaluate(() => ({
    total: document.querySelectorAll('.omni-block').length,
    pill: document.querySelector('.omni-pill')?.innerText.replace(/\n/g, ' | '),
  }));
  console.log(`after reload: ${second.total} blocks, pill: ${second.pill}`);
  if (!/cached/.test(second.pill || '')) throw new Error('reload did not hit the cache');
  if (second.total !== stats.total) throw new Error(`cache replay mismatch: ${second.total} vs ${stats.total}`);

  console.log(`SMOKE PASS — ${stats.total} blocks from ${Object.keys(stats.byLang).join(', ')}, cache replay ok`);
  exitCode = 0;
} catch (e) {
  console.error('SMOKE FAIL —', e.message);
} finally {
  await context.close();
  process.exit(exitCode);
}
