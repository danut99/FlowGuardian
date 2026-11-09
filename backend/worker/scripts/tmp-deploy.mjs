import { chromium } from 'playwright';
import { currentFingerprint, snapshot, compare, fingerprint, assetChanges } from '../src/deploys.mjs';
const b = await chromium.launch();
const ctx = await b.newContext();
for (const url of ['https://www.python.org/', 'https://wordpress.org/news/', 'https://nodejs.org/en', 'https://books.toscrape.com/', 'https://www.allbirds.com/']) {
  const fp = await currentFingerprint(ctx, url).catch(e => ({ err: e.message }));
  console.log('== fp', url, fp?.err ?? (fp == null ? 'null' : fp.unstable ? 'UNSTABLE' : `stripQuery=${fp.stripQuery} assets=${fp.assets.length} gen=${fp.generator}`), JSON.stringify(fp?.assets?.slice(0,3)));
}
const t = Date.now();
const snap = await snapshot(b, 'https://www.python.org/');
console.log('== snap', ((Date.now()-t)/1000).toFixed(0)+'s', JSON.stringify(snap));
const after = { ...snap, lcp: snap.lcp + 1500, noindex: true, js_errors: [...snap.js_errors, 'TypeError: x is undefined'], bytes: snap.bytes * 2 + 400000, title: 'New title' };
console.log('== compare', JSON.stringify(compare(snap, after)));
const f1 = fingerprint('<script src="/a.123.js"></script><link rel="stylesheet" href="/s.css?ver=1"><script src="https://cdn.x.com/t.js"></script>', 'https://ex.com/');
const f2 = fingerprint('<script src="/a.456.js"></script><link href="/s.css?ver=2" rel="stylesheet">', 'https://ex.com/');
console.log('== assets', JSON.stringify(f1.assets), JSON.stringify(f2.assets), JSON.stringify(assetChanges(f1.assets, f2.assets)));
await b.close();
