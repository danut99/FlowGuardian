import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRuns } from '../src/network.mjs';
import { complianceChecks } from '../src/compliance.mjs';
import { check, scoreChecks } from '../src/overview.mjs';
import { validateChecks } from '../src/report.mjs';
import { inspectHome } from '../src/overview.mjs';
import { chromium } from 'playwright';
import { createServer } from 'node:http';

test('median resists an outlier and retains the matching LCP element', () => {
  const p = { id: 'test', label: 'Test', down: 100, latency: 10, cpu: 4 };
  const result = summarizeRuns(p, [1000, 9000, 2000].map((lcp_ms) => ({ lcp_ms, lcp_element: { tag: String(lcp_ms) } })));
  assert.equal(result.lcp_ms, 2000);
  assert.equal(result.lcp_element.tag, '2000');
  assert.equal(result.source, 'lab');
  assert.equal(summarizeRuns(p, [{ lcp_ms: 1000 }, {}, {}]).lcp_ms, null);
  assert.equal(summarizeRuns(p, [{ error: true }, { error: true }, {}]).error, true);
});

test('cookie evidence and unreadable consent banners never become confirmed legal violations', () => {
  const results = complianceChecks(check, {
    legal: { links: [], buttons: [] }, requests: [{ url: 'https://cdn.cookiebot.com/script.js' }],
    cookies: [{ name: '_ga' }], services: [{ name: 'Analytics', category: 'Analytics' }], forms: [], sales: null,
  });
  validateChecks(results);
  assert.equal(results.find((c) => c.id === 'tracking_before_consent').verdict, 'needs_validation');
  assert.equal(results.find((c) => c.id === 'consent_reject').verdict, 'needs_validation');
  assert.equal(results.some((c) => c.verdict === 'confirmed'), false);
});

test('fresh visit captures a late banner without accepting it or submitting a form', async () => {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<html><title>Fixture</title><body><h1>Test</h1><script>
      document.cookie = '_ga=fixture; path=/';
      setTimeout(() => { document.body.insertAdjacentHTML('beforeend', '<button>Accept all cookies</button><button>Reject all</button>'); }, 4000);
      </script></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch();
    const started = Date.now();
    let firstAt;
    let early;
    const { home, cookies } = await inspectHome(browser, `http://127.0.0.1:${server.address().port}`, {
      onEarly: async (o) => { firstAt = Date.now() - started; early = o; },
    });
    assert.ok(firstAt < home.observation_ms - 3000, 'initial results precede the consent observation window');
    assert.equal(early.stage, 'initial');
    assert.equal(early.checks.some((c) => c.group === 'compliance' || c.group === 'performance'), false);
    assert.equal(early.checks.find((c) => c.id === 'home').status, 'pass');
    assert.ok(home.meta.legal.buttons.includes('Reject all'));
    assert.ok(cookies.some((c) => c.name === '_ga'));
    assert.ok(home.observation_ms >= 7000);
    assert.ok(home.requests.every((r) => r.at_ms >= 0));
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('review-only findings do not lower the measured score', () => {
  assert.equal(scoreChecks([check('availability', 'home', 'Home', null, 'HTTP 200'), check('compliance', 'consent', 'Consent', 'unknown', 'Needs review')]), 100);
});


test('a page without consent buttons completes the observation window', async () => {
  const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<html><title>No banner</title><body><h1>Static page</h1></body></html>'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch();
    const result = await Promise.race([
      inspectHome(browser, `http://127.0.0.1:${server.address().port}`),
      new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Consent observation did not finish')), 15000); timer.unref(); }),
    ]);
    assert.equal(result.home.meta.title, 'No banner');
    assert.ok(result.home.observation_ms >= 7000);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
