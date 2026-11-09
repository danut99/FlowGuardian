import test from 'node:test';
import assert from 'node:assert/strict';
import { attachEvidence } from '../src/evidence.mjs';
import { check } from '../src/overview.mjs';
import { validateChecks } from '../src/report.mjs';

test('hardening includes the exact header, reproduction and an unverified fix', () => {
  const c = attachEvidence(check('security', 'nosniff', 'Content type protection', 'hardening', 'Header missing'), { url: 'https://example.com/' });
  assert.equal(c.severity, 'hardening');
  assert.match(c.evidence.reproduce, /Response Headers: X-Content-Type-Options/);
  assert.match(c.evidence.expected, /nosniff/);
  assert.match(c.evidence.limitation, /not proof/);
  validateChecks([c]);
});

test('heuristics keep evidence and affected resources but do not assert confirmed impact', () => {
  for (const [group, id] of [['seo', 'schema_core'], ['content', 'links'], ['compliance', 'privacy'], ['text', 'text_repeated']]) {
    const c = attachEvidence(check(group, id, id, 'medium', 'Observed signal'), {
      url: 'https://example.com/', resources: [{ url: 'https://example.com/missing', status: 403 }],
    });
    assert.equal(c.verdict, 'needs_validation');
    assert.equal(c.severity, undefined);
    assert.equal(c.evidence.resources[0].status, 403);
    assert.ok(c.evidence.fix && c.evidence.expected && c.evidence.limitation);
    validateChecks([c]);
  }
});
