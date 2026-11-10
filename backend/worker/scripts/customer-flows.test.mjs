import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { suggestFlows, discoverFlows, recordPublicJourneys, probeEntryButton } from '../src/customer-flows.mjs';
import { executeTest } from '../src/execution.mjs';
import { runSteps } from '../src/runner.mjs';

test('free discovery suggests at most three different journeys, not duplicate destination labels', () => {
  const flows = suggestFlows('https://example.com/', { links: [
    { href: '/services/contact', text: 'Contact our services team' },
    { href: '/services/contact#form', text: 'Important page' },
    { href: '/products/item?variant=one', text: 'Product one' },
    { href: '/products/item?variant=two', text: 'Same product' },
    { href: '/account/login', text: 'Sign in' },
    { href: '/search', text: 'Search' },
  ] });
  assert.equal(flows.length, 3);
  assert.equal(new Set(flows.map(f => new URL(f.target_url).pathname)).size, 3);
  assert.equal(new Set(flows.map(f => f.kind)).size, 3);
  assert.equal(flows.some(f => f.kind === 'navigation'), false);
  assert.equal(new Set(flows.map(f => JSON.stringify(f.suggested_steps))).size, 3);
  assert.ok(flows.every(f => f.suggested_steps.length === 3));
  assert.equal(suggestFlows('https://example.com/', { links: [{ href: '/contact', text: 'Contact' }] }).length, 1);
  const samePage = suggestFlows('https://example.com/', { observations: [{ url: 'https://example.com/', controls: {
    contact: { evidence: 'Contact form', fields: [] }, search: { evidence: 'Search box', fields: [] },
  } }] });
  assert.deepEqual(samePage.map(c => c.kind), ['request', 'search']);
});

test('browser discovery finds distinct real interaction controls without submitting or claiming completion', async () => {
  let submissions = 0;
  const server = createServer((req, res) => {
    if (req.method !== 'GET') submissions++;
    res.setHeader('Content-Type', 'text/html');
    const pages = {
      '/': '<a href="/products/item">Our product</a><a href="/contact">Contact</a><a href="/contact#form">Contact again</a><a href="/search">Search</a><a href="/account/login">Sign in</a>',
      '/products/item': '<h1>Product</h1><select aria-label="Size"><option>Small</option><option>Large</option></select><button>Add to cart</button>',
      '/contact': '<form method="POST"><label>Email<input type="email" name="email" required></label><label>Message<textarea name="message" required></textarea></label><button>Send</button></form>',
      '/search': '<form><label>Search<input type="search" name="q"></label><button>Search</button></form>',
      '/account/login': '<form method="POST"><input type="email"><input type="password"><button>Login</button></form>',
    };
    res.end(`<html><title>Fixture</title><body>${pages[req.url] ?? ''}</body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  try {
    const found = await discoverFlows(browser, url, { validateUrl: async () => {} });
    assert.deepEqual(found.candidates.map(c => c.kind), ['purchase', 'request', 'search']);
    assert.ok(found.candidates.every(c => c.discovery_strength === 'control_observed'));
    assert.match(found.candidates[1].evidence, /email and message/);
    const results = await recordPublicJourneys(browser, found.candidates, { validateUrl: async () => {} });
    assert.equal(results.flatMap(c => c.public_run.steps).filter(s => s.action === 'probe_form_validation').length, 1);
    assert.equal(results.find(c => c.kind === 'request').public_run.steps.at(-1).result, 'validation_observed');
    for (const result of results) {
      assert.equal(result.state, 'possible');
      assert.ok(['navigation_and_control_inspection', 'navigation_controls_and_form_validation'].includes(result.public_run.scope));
      assert.equal(result.public_run.steps.find(s => s.action === 'inspect_controls').result, 'controls_observed');
    }
    assert.equal(submissions, 0);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});

test('discovery suggestions stay possible and ignore external checkout links', () => {
  const flows = suggestFlows('https://example.com/', { links: [
    { href: '/products/item', text: 'Product' }, { href: '/contact', text: 'Contact' },
    { href: 'https://other.example/account', text: 'Account' },
  ] });
  assert.ok(flows.some((f) => f.kind === 'purchase'));
  assert.ok(flows.some((f) => f.kind === 'request'));
  assert.ok(flows.every((f) => f.state === 'possible'));
  assert.ok(!flows.some((f) => f.kind === 'access'));
  assert.deepEqual(suggestFlows('https://example.com/'), []);
});

test('discovery does not submit; strict replay rejects ambiguous targets and fallback replacements', async () => {
  let submissions = 0;
  const server = createServer((req, res) => {
    if (req.url === '/submit') submissions++;
    res.setHeader('Content-Type', 'text/html');
    res.end('<html><title>Fixture</title><body><a href="/pricing">Pricing</a><form action="/submit"><button>Send</button></form><button>Choose</button><button>Choose</button><button>Replacement</button></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  try {
    const result = await discoverFlows(browser, url, { validateUrl: async () => {} });
    assert.ok(result.candidates.length);
    assert.equal(submissions, 0);
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url);
    await assert.rejects(runSteps(page, [{ position: 1, action: 'click', locators: [{ type: 'role', role: 'button', name: 'Choose' }] }], url, { strict: true }), /saved element was not found/);
    await assert.rejects(runSteps(page, [{ position: 2, action: 'click', locators: [{ type: 'role', role: 'button', name: 'Missing' }, { type: 'role', role: 'button', name: 'Replacement' }] }], url, { strict: true }), /saved element was not found/);
    await runSteps(page, [{ position: 1, action: 'goto', locators: [], value: '/' }, { position: 2, action: 'expect_text', locators: [], value: 'Pricing' }], url, { strict: true });
    assert.equal(submissions, 0);
    await context.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});


test('run evidence records the actual stopping step and redacts entered values', async () => {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/blocked') { res.statusCode = 403; res.end('Blocked'); return; }
    res.end('<html><title>Fixture</title><body><label>Name<input aria-label="Name"></label></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  try {
    const { result, decision } = await executeTest(browser, { name: '[Flow] Trace fixture', site: { url }, steps: [
      { position: 1, action: 'goto', locators: [], value: '/' },
      { position: 2, action: 'fill', locators: [{ type: 'label', value: 'Name' }], value: 'private-fixture-input' },
      { position: 3, action: 'goto', locators: [], value: '/blocked' },
      { position: 4, action: 'expect_text', locators: [], value: 'Should not execute' },
    ] });
    const trace = result.debug.step_trace;
    assert.equal(trace.length, 3);
    assert.equal(trace[1].status, 'passed');
    assert.equal(trace[1].value, '[redacted]');
    assert.equal(trace[2].status, 'failed');
    assert.match(trace[2].url, /blocked/);
    assert.equal(result.failure.position, 3);
    assert.equal(decision.outcome, 'blocked');
    assert.ok(!JSON.stringify(trace).includes('private-fixture-input'));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});


test('public journeys contain actual page captures and preserve an HTTP failure', async () => {
  let submissions = 0;
  const server = createServer((req, res) => {
    if (req.method !== 'GET') submissions++;
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/missing') { res.statusCode = 404; res.end('<html><title>Missing page</title><body>Not found</body></html>'); }
    else res.end('<html><title>Starting page</title><body><h1>Actual fixture</h1></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  try {
    const [result] = await recordPublicJourneys(browser, [{ kind: 'navigation', entry_url: url, target_url: url + 'missing' }], { validateUrl: async () => {} });
    assert.equal(result.public_run.scope, 'page_navigation_only');
    assert.equal(result.public_run.steps[0].http_status, 200);
    assert.equal(result.public_run.steps[1].http_status, 404);
    assert.equal(result.public_run.steps[1].result, 'http_error');
    assert.equal(result.public_run.steps[1].title, 'Missing page');
    assert.equal(result.public_run.steps[0].screenshot, undefined);
    assert.match(result.public_run.steps[1].screenshot, /^data:image\/jpeg;base64,/);
    assert.equal(submissions, 0);
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});


test('button-only SPA probes entry controls without permitting mutating requests', async () => {
  let interactionRequests = 0;
  const server = createServer((req, res) => {
    if (req.url === '/clicked') interactionRequests++;
    res.setHeader('Content-Type', 'text/html');
    res.end(`<html><title>Button app</title><body><button onclick="fetch('/clicked',{method:'POST'})">Sign in</button><button onclick="fetch('/clicked',{method:'POST'})">Play free</button><button disabled>Register</button></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    const result = await discoverFlows(browser, url, { validateUrl: async () => {} });
    assert.equal(result.candidates.length, 2);
    assert.deepEqual(new Set(result.candidates.map(c => c.control_kind)), new Set(['access_entry', 'app_entry']));
    assert.ok(result.candidates.every(c => c.observed_controls.stage === 'entry_inconclusive' && c.state === 'possible'));
    assert.equal(interactionRequests, 0);
    const recorded = await recordPublicJourneys(browser, result.candidates, { validateUrl: async () => {} });
    assert.ok(recorded.every(c => c.public_run.steps.at(-1).result === 'entry_inconclusive'));
    assert.equal(interactionRequests, 0);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});


test('entry probe records an actual click and the account fields it reveals, without submitting', async () => {
  let writes = 0;
  const server = createServer((req, res) => {
    if (req.method !== 'GET') writes++;
    res.setHeader('Content-Type', 'text/html');
    res.end(`<html><body><button type="button" onclick="document.querySelector('#panel').hidden=false">Sign in</button><div id="panel" hidden><form method="post"><label>Email<input type="email" required></label><label>Password<input type="password" required></label><button>Submit</button></form></div></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    const result = await probeEntryButton(browser, `http://127.0.0.1:${server.address().port}/`, 'Sign in', { validateUrl: async () => {} });
    assert.equal(result.opened, true);
    assert.equal(result.steps[1].action, 'click_entry');
    assert.equal(result.steps[1].result, 'entry_opened');
    assert.ok(result.fields.some(f => f.type === 'password'));
    assert.ok(result.fields.some(f => f.type === 'email'));
    assert.equal(writes, 0);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});


test('product discovery recognizes accessible variant buttons without requiring add-to-cart text', async () => {
  let selections = 0;
  const server = createServer((req, res) => {
    if (req.url === '/select') selections++;
    res.setHeader('Content-Type', 'text/html');
    res.end('<main><h1>Travel eSIM</h1><button type="button" data-variant-id="one" aria-label="Select 1GB/7 Days" onclick="fetch(\'/select\')">1 GB / 7 Days / $3.49</button><button type="button" data-variant-id="two" aria-label="Select 3GB/15 Days">3 GB / 15 Days / $4.49</button></main>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    const result = await discoverFlows(browser, `http://127.0.0.1:${server.address().port}/products/esim`, { validateUrl: async () => {} });
    const product = result.candidates.find(c => c.kind === 'purchase');
    assert.ok(product);
    assert.equal(product.discovery_strength, 'control_observed');
    assert.ok(product.observed_controls.buttons.includes('Select 1GB/7 Days'));
    assert.match(product.evidence, /2 visible product-option buttons/);
    const recorded = await recordPublicJourneys(browser, [product], { validateUrl: async () => {} });
    assert.equal(recorded[0].public_run.steps.at(-1).result, 'controls_observed');
    assert.equal(selections, 0);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
