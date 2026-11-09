import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAttempts } from '../src/outcomes.mjs';
import { runSteps } from '../src/runner.mjs';

const failed = (kind, message = 'Expected contact form', position = 2) => ({ failure: { kind, message, position } });

test('a repeatable explicit assertion is confirmed, but a single observation is not', () => {
  assert.equal(classifyAttempts([failed('real_bug')]).outcome, 'inconclusive');
  assert.deepEqual(classifyAttempts([failed('real_bug'), failed('real_bug')]), {
    status: 'failed', outcome: 'confirmed', severity: 'critical',
  });
});

test('different failures must not confirm one another', () => {
  for (const second of [failed('real_bug', 'Different failure'), failed('real_bug', undefined, 3), failed('timeout'), failed(null)]) {
    assert.equal(classifyAttempts([failed('real_bug'), second]).outcome, 'inconclusive');
  }
});

test('timeouts and worker failures never open critical incidents', () => {
  for (const kind of ['timeout', null]) {
    const result = classifyAttempts([failed(kind), failed(kind)]);
    assert.equal(result.status, 'error');
    assert.equal(result.severity, null);
  }
});

test('blocked and changed selectors are distinct from confirmed failures', () => {
  assert.equal(classifyAttempts([failed('blocked')]).outcome, 'blocked');
  assert.deepEqual(classifyAttempts([failed('selector_changed')]), {
    status: 'error', outcome: 'maintenance', severity: 'maintenance',
  });
});

test('recovery passes while the caller retains the initial evidence', () => {
  const attempts = [failed('real_bug'), {}];
  assert.equal(classifyAttempts(attempts).outcome, 'passed');
  assert.equal(attempts[0].failure.message, 'Expected contact form');
});

test('HTTP access blocks, server errors and browser errors remain distinct', async () => {
  for (const [status, kind] of [[403, 'blocked'], [429, 'blocked'], [500, 'real_bug']]) {
    await assert.rejects(runSteps({ goto: async () => ({ status: () => status }) }, [
      { action: 'goto', position: 1, value: '/' },
    ], 'https://example.com'), (error) => error.kind === kind);
  }
  await assert.rejects(runSteps({ goto: async () => { throw new Error('Browser disconnected'); } }, [
    { action: 'goto', position: 1, value: '/' },
  ], 'https://example.com'), (error) => error.kind === null);
  const timeout = Object.assign(new Error('Navigation timed out'), { name: 'TimeoutError' });
  await assert.rejects(runSteps({ goto: async () => { throw timeout; } }, [
    { action: 'goto', position: 1, value: '/' },
  ], 'https://example.com'), (error) => error.kind === 'timeout');
  await runSteps({ goto: async () => ({ status: () => 200 }) }, [
    { action: 'goto', position: 1, value: '/' },
  ], 'https://example.com');
});
