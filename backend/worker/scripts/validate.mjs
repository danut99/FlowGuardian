// Prototype validation (docs: 20–30 sites, >85% success): scan each site, run every proposal, report pass rate.
// Usage: node scripts/validate.mjs [url ...]   (no DB writes)
import { chromium } from 'playwright';
import { scanSite } from '../src/scanner.mjs';
import { runSteps } from '../src/runner.mjs';

const SITES = process.argv.slice(2).length ? process.argv.slice(2) : [
  'https://books.toscrape.com/',
  'https://quotes.toscrape.com/',
  'https://www.saucedemo.com/',
  'https://www.demoblaze.com/',
  'https://automationexercise.com/',
  'https://the-internet.herokuapp.com/',
  'https://practicesoftwaretesting.com/',
  'https://magento.softwaretestingboard.com/',
  'https://www.wikipedia.org/',
  'https://developer.mozilla.org/en-US/',
  'https://www.python.org/',
  'https://nodejs.org/en',
  'https://www.emag.ro/',
  'https://www.olx.ro/',
  'https://www.bmw.at/de-at/sl/stocklocator/results?sortField=PRODUCTION_DATE&sortOrder=DESC',
];

async function validate(browser, url) {
  const scanCtx = await browser.newContext();
  let tests;
  try {
    tests = await scanSite(await scanCtx.newPage(), url);
  } catch (e) {
    return { url, scanError: e.message.split('\n')[0].slice(0, 80), results: [] };
  } finally {
    await scanCtx.close();
  }
  const results = [];
  for (const t of tests) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.setDefaultTimeout(10_000);
    const steps = t.steps.map((s, i) => ({ position: i + 1, locators: [], value: null, ...s }));
    try {
      await runSteps(page, steps, url);
      results.push({ name: t.name, ok: true });
    } catch (e) {
      results.push({ name: t.name, ok: false, why: `${e.kind ?? 'err'} @${e.position}: ${e.message.split('\n')[0].slice(0, 70)}` });
    } finally {
      await ctx.close();
    }
  }
  return { url, results };
}

const browser = await chromium.launch();
let pass = 0, total = 0, blocked = 0;
for (const url of SITES) {
  const r = await validate(browser, url);
  if (r.scanError) {
    blocked++;
    console.log(`\n✗ ${url}\n   SCAN: ${r.scanError}`);
    continue;
  }
  const ok = r.results.filter((x) => x.ok).length;
  pass += ok;
  total += r.results.length;
  console.log(`\n${ok === r.results.length ? '✓' : '~'} ${url}  ${ok}/${r.results.length}`);
  for (const x of r.results) console.log(`   ${x.ok ? 'PASS' : 'FAIL'} ${x.name}${x.why ? '  — ' + x.why : ''}`);
}
await browser.close();
console.log(`\nTOTAL: ${pass}/${total} tests passed (${total ? Math.round((100 * pass) / total) : 0}%), ${SITES.length - blocked}/${SITES.length} sites scanned`);
