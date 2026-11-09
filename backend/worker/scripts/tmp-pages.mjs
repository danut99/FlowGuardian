import { chromium } from 'playwright';
import { analyzePage, deepAnalyze } from '../src/pages.mjs';
import { crawlSite } from '../src/crawler.mjs';
import { buildOverview } from '../src/overview.mjs';
const b = await chromium.launch();
const ctx = await b.newContext();
const pages = await crawlSite(ctx, 'https://www.python.org/');
const o = await buildOverview(ctx, 'https://www.python.org/', pages);
await ctx.close();
console.log('== overview score', o.score, 'pages', pages.length);
let t = Date.now();
for (const p of pages.slice(0, 4)) {
  const s = Date.now();
  try {
    const r = await analyzePage(b, { url: p.url, broken_links: p.broken_links });
    const bad = r.checks.filter(c => c.status !== 'pass').map(c => `${c.status}:${c.id}(${c.detail.slice(0,50)})`);
    console.log('== page', new URL(p.url).pathname, 'score', r.score, ((Date.now()-s)/1000).toFixed(1)+'s', JSON.stringify(r.metrics), bad.join(' | '));
  } catch (e) { console.log('== page ERR', p.url, e.message); }
}
t = Date.now();
const d = await deepAnalyze(b, 'https://www.python.org/about/');
console.log('== deep', ((Date.now()-t)/1000).toFixed(0)+'s', JSON.stringify(d.result), Object.fromEntries(Object.entries(d.images).map(([k,v]) => [k, v ? v.length : null])));
await b.close();
