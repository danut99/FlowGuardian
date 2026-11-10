import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { probeSearch } from '../src/search-discovery.mjs';

test('search enters a product-derived query and distinguishes matching results from an inconclusive result', async () => {
  let writes = 0;
  const server = createServer((req, res) => {
    if (req.method !== 'GET') writes++;
    res.setHeader('Content-Type', 'text/html');
    const searching = req.url.startsWith('/search?');
    res.end(searching ? '<main><a href="/products/thailand">Thailand plan</a></main>' : '<main><a href="/products/esim-thailand">Thailand plan</a><form action="/search" method="get"><input type="search" name="q"><button>Search</button></form></main>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    const steps = await probeSearch(browser, `http://127.0.0.1:${server.address().port}/`, { validateUrl: async () => {} });
    assert.deepEqual(steps.map(s => s.result), ['search_query_entered', 'search_requested', 'search_results_observed']);
    assert.equal(steps[0].target_label, 'thailand');
    assert.match(steps.at(-1).detail, /Thailand plan/);
    assert.doesNotMatch(steps.at(-1).detail, /\ufffd/);
    assert.match(steps.at(-1).detail, /Thailand plan - http/);
    assert.equal(writes, 0);
    const missing = await probeSearch(browser, `http://127.0.0.1:${server.address().port}/search?q=unknown`, { validateUrl: async () => {} });
    assert.equal(missing.at(-1).result, 'search_inconclusive');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
