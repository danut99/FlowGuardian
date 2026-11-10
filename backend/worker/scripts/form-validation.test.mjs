import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { probeFormValidation } from '../src/form-validation.mjs';

test('form interaction observes native rejection and blocks handler requests without submitting', async () => {
  let submissions = 0;
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url === '/side-effect') submissions++;
    response.setHeader('Content-Type', 'text/html');
    const skip = request.url === '/custom';
    response.end(`<form method="POST" ${skip ? 'novalidate' : ''}>
      <label>Email<input type="email" name="email" required oninput="fetch('/side-effect',{method:'POST'})"></label>
      <label>Password<input type="password" required></label><button>Create account</button>
      </form><script>document.querySelector('form').addEventListener('invalid',()=>fetch('/side-effect',{method:'POST'}),true)</script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    const observed = await probeFormValidation(browser, url, 'access', { validateUrl: async () => {} });
    assert.equal(observed.result, 'validation_observed');
    assert.equal(observed.cases.empty_required.accepted, false);
    assert.equal(observed.cases.malformed_email.type_mismatch, true);
    assert.ok(observed.blocked_requests > 0);
    assert.equal(submissions, 0);
    assert.equal(JSON.stringify(observed).includes('not-an-email'), false);
    const custom = await probeFormValidation(browser, url + '/custom', 'access', { validateUrl: async () => {} });
    assert.equal(custom.result, 'validation_inconclusive');
    assert.equal(submissions, 0);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});


test('aria-required without HTML required still allows a malformed-email check, without claiming empty-field enforcement', async () => {
  let submissions = 0;
  const server = createServer((req, res) => {
    if (req.method !== 'GET') submissions++;
    res.setHeader('Content-Type', 'text/html');
    res.end('<form method="post"><label>Email<input type="email" aria-required="true"></label><textarea name="message"></textarea><button>Send</button></form>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    const result = await probeFormValidation(browser, `http://127.0.0.1:${server.address().port}/`, 'contact', { validateUrl: async () => {} });
    assert.equal(result.result, 'validation_partial');
    assert.equal(result.cases.malformed_email.accepted, false);
    assert.equal(result.cases.empty_required.native_required, 0);
    assert.equal(result.cases.empty_required.aria_only_required, 1);
    assert.equal(result.cases.empty_required.result, 'no_native_required_constraint');
    assert.match(result.detail, /Server validation was not tested/);
    assert.equal(submissions, 0);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
