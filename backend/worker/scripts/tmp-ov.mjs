import { chromium } from 'playwright';
import { crawlSite } from '../src/crawler.mjs';
import { buildOverview } from '../src/overview.mjs';
const b = await chromium.launch();
for (const url of ['https://www.emag.ro/', 'https://www.python.org/']) {
  const ctx = await b.newContext(); const t = Date.now();
  try { const o = await buildOverview(ctx, url, await crawlSite(ctx, url)); console.log('==', url, 'score', o.score, 'blocked', o.blocked, ((Date.now()-t)/1000).toFixed(0)+'s'); }
  catch (e) { console.log('== ERR', url, e.message); }
  await ctx.close();
}
await b.close();
