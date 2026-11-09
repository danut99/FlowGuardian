import { chromium } from 'playwright';
import { runCheck } from '../src/health.mjs';
import { writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
const b = await chromium.launch();
const cases = [['transient', 'file:///tmp/fg-transient.html'], ['python', 'https://www.python.org/']];
if (existsSync('/tmp/fg-overflow.html')) cases.splice(1, 0, ['permanent', 'file:///tmp/fg-overflow.html']);
for (const check of ['mobile', 'mobile_load']) {
  for (const [name, url] of cases) {
    const ctx = await b.newContext(); const p = await ctx.newPage();
    const t = Date.now();
    const r = await runCheck(p, new URL(url), check).catch(e => ({ message: 'THROW ' + e.message }));
    console.log('==', check, name, ((Date.now()-t)/1000).toFixed(1)+'s', r ? r.message : 'PASS', r?.screenshot ? 'shot' : '');
    if (r?.screenshot) writeFileSync(`/tmp/fg-${check}-${name}.png`, r.screenshot);
    await ctx.close();
  }
}
await b.close();
