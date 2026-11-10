import test from 'node:test';
import assert from 'node:assert/strict';
import { currentFlowRuns, flowGoal, canMonitorDiscovered, discoveredFlowSteps } from '../src/lib/customerFlows.ts';

test('editing invalidates previous verification while retaining newer runs', () => {
  const flow = { id: 'flow', steps: [{ note: 'Flow v1|2026-11-10T10:00:00.000Z|Reach the correct plan' }] };
  const runs = [
    { test_id: 'flow', status: 'passed', created_at: '2026-11-10T09:00:00.000Z' },
    { test_id: 'flow', status: 'failed', created_at: '2026-11-10T10:01:00.000Z' },
    { test_id: 'other', status: 'passed', created_at: '2026-11-10T10:02:00.000Z' },
  ];
  assert.equal(currentFlowRuns(flow, runs).length, 1);
  assert.equal(currentFlowRuns(flow, runs)[0].status, 'failed');
  assert.equal(flowGoal(flow), 'Reach the correct plan');
});


test('a fresh recorded entry can be adopted as exact steps, but stale or incomplete observations cannot', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  const candidate = { entry_url: 'https://example.com/', target_url: 'https://example.com/', entry_action: { role: 'button', name: 'Sign in' }, observed_controls: { fields: [{ label: 'Email' }, { label: 'Password' }] }, public_run: { steps: [{ result: 'page_responded', observed_at: '2026-11-10T11:59:00Z' }, { result: 'entry_opened', observed_at: '2026-11-10T11:59:01Z' }] } };
  assert.equal(canMonitorDiscovered(candidate, 'https://example.com/', now), true);
  assert.deepEqual(discoveredFlowSteps(candidate, 'https://example.com/').map(s => s.action), ['goto', 'click', 'expect_visible', 'expect_visible']);
  assert.equal(canMonitorDiscovered(candidate, 'https://example.com/', now + 31 * 60000), false);
  assert.equal(canMonitorDiscovered({ ...candidate, observed_controls: { fields: [] } }, 'https://example.com/', now), false);
  assert.equal(canMonitorDiscovered({ ...candidate, public_run: { steps: [{ result: 'entry_inconclusive', observed_at: '2026-11-10T11:59:00Z' }] } }, 'https://example.com/', now), false);
  assert.equal(canMonitorDiscovered(candidate, 'https://other.example/', now), false);
});
