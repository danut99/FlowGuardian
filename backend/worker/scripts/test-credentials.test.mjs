import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { executeTest } from '../src/execution.mjs';
import { resolveCredentialSteps, protectCredentialEvidence } from '../src/test-credentials.mjs';
import { classifyAttempts } from '../src/outcomes.mjs';
import { StepFailure } from '../src/runner.mjs';

test('redacting different failure messages must not turn them into a confirmed repeated issue', () => {
  const key = Buffer.alloc(32, 7);
  const protect = message => protectCredentialEvidence({ failure: new StepFailure('real_bug', 3, message) }, 'https://fixture.example/', key);
  const first = protect('First confidential observation');
  const different = protect('Different confidential observation');
  assert.equal(first.failure.message, different.failure.message);
  assert.equal(classifyAttempts([first, different]).outcome, 'inconclusive');
  assert.equal(classifyAttempts([first, protect('First confidential observation')]).outcome, 'confirmed');
  assert.ok(!JSON.stringify(first).includes('confirmation_key'));
  assert.ok(!first.failure.stack.includes('confidential'));
});

test('credential references only resolve for fill steps and never use inherited keys', () => {
  assert.throws(() => resolveCredentialSteps([{ action: 'fill', value: '{{test.password}}' }], null), /Save a dedicated/);
  assert.throws(() => resolveCredentialSteps([{ action: 'goto', value: '{{test.password}}' }], { password: 'fixture' }), /only be used in fill/);
  assert.equal(resolveCredentialSteps([{ action: 'fill', value: 'toString' }], null)[0].value, 'toString');
});

test('test account signs in in fresh sessions and credential-bearing errors leave no raw artifacts', async () => {
  const credentials = { username: 'fixture-user@example.test', password: ' fixture-password-with-spaces ' };
  let logins = 0, anonymousLoginVisits = 0;
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/login') {
      if (!request.headers.cookie) anonymousLoginVisits++;
      response.end('<form action="/session" method="POST"><label>Email<input name="email"></label><label>Password<input type="password" name="password"></label><button>Login</button></form>');
    } else if (request.url === '/session') {
      let body = '';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        const data = new URLSearchParams(body);
        if (data.get('email') !== credentials.username || data.get('password') !== credentials.password) {
          response.statusCode = 401; response.end('Rejected'); return;
        }
        logins++;
        response.writeHead(302, { 'Set-Cookie': 'fixture_session=ok; HttpOnly; Path=/', Location: '/account' }); response.end();
      });
    } else if (request.url === '/account' && request.headers.cookie?.includes('fixture_session=ok')) {
      // Deliberate leakage by the fixture page; the worker must not save this content.
      response.end(`<h1>Account dashboard</h1><p>${credentials.password}</p><script>console.error(${JSON.stringify(credentials.password)})</script>`);
    } else { response.writeHead(302, { Location: '/login?next=/account' }); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const steps = [
    { action: 'goto', value: '/login', locators: [] },
    { action: 'fill', value: '{{test.username}}', locators: [{ type: 'label', value: 'Email' }] },
    { action: 'fill', value: '{{test.password}}', locators: [{ type: 'label', value: 'Password' }] },
    { action: 'click', locators: [{ type: 'role', role: 'button', name: 'Login' }] },
    { action: 'expect_url', value: '/account', locators: [] },
    { action: 'expect_visible', locators: [{ type: 'role', role: 'heading', name: 'Account dashboard' }] },
  ].map((step, i) => ({ ...step, position: i + 1 }));
  const flow = { name: '[Flow] Login', site: { url }, steps };
  const browser = await chromium.launch();
  try {
    await assert.rejects(executeTest(browser, flow, { credentials }), /HTTPS/);
    for (let i = 0; i < 2; i++) {
      const run = await executeTest(browser, flow, { credentials, allowHttpForTests: true });
      assert.equal(run.decision.outcome, 'passed');
      assert.equal(run.result.debug.credential_protected, true);
      assert.equal(run.result.debug.step_trace.length, 6);
      assert.equal(run.result.screenshot, null);
      assert.ok(!JSON.stringify(run).includes(credentials.password));
      assert.ok(!JSON.stringify(run).includes(credentials.username));
    }
    assert.equal(logins, 2);
    assert.equal(anonymousLoginVisits, 2);
    const failed = await executeTest(browser, { ...flow, steps: [...steps, { position: 7, action: 'not_supported', value: credentials.password }] }, { credentials, allowHttpForTests: true });
    assert.equal(failed.decision.outcome, 'inconclusive');
    assert.equal(failed.result.screenshot, null);
    assert.ok(!JSON.stringify(failed).includes(credentials.password));
    assert.ok(!JSON.stringify(failed).includes(credentials.username));
    assert.equal(steps[2].value, '{{test.password}}');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
