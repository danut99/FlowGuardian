import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { executeTest } from '../../src/execution.mjs';
import { startFixtures } from './fixtures.mjs';

const repetitions = Number(process.argv.find((arg) => arg.startsWith('--repetitions='))?.split('=')[1] ?? 1);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 100) {
  throw new Error('--repetitions must be an integer from 1 to 100');
}
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const output = path.join(root, 'benchmark-results', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
await writeFile(path.join(root, 'benchmark-results', '.gitignore'), '*\n!.gitignore\n');
const step = (action, value, locators = []) => ({ action, value, locators });
const button = [{ type: 'role', role: 'button', name: 'Contact' }];
const form = [{ type: 'css', value: 'form' }];
const scenarios = [
  { id: 'healthy-form', path: '/healthy', outcome: 'passed', severity: null, attempts: 1,
    steps: [step('click', null, button), step('expect_visible', null, form)] },
  { id: 'broken-form', path: '/broken-form', outcome: 'confirmed', severity: 'critical', attempts: 2,
    steps: [step('click', null, button), step('expect_visible', null, form)] },
  { id: 'server-error', path: '/server-error', outcome: 'confirmed', severity: 'critical', attempts: 2 },
  { id: 'slow-navigation', path: '/slow', outcome: 'inconclusive', severity: null, attempts: 2 },
  { id: 'blocked-403', path: '/blocked', outcome: 'blocked', severity: null, attempts: 1 },
  { id: 'limited-429', path: '/limited', outcome: 'blocked', severity: null, attempts: 1 },
  { id: 'changed-selector', path: '/changed-selector', outcome: 'maintenance', severity: 'maintenance', attempts: 1,
    steps: [step('click', null, [{ type: 'css', value: '#old-contact' }])] },
  { id: 'transient-recovery', path: '/transient', outcome: 'passed', severity: null, attempts: 2 },
];
const rows = [];
let browser, fixtures;
try {
  fixtures = await startFixtures();
  browser = await chromium.launch({ headless: true });
  for (let repeat = 1; repeat <= repetitions; repeat++) {
    for (const scenario of scenarios) {
      fixtures.reset();
      console.log(`[${repeat}/${repetitions}] ${scenario.id}${scenario.id === 'slow-navigation' ? ' (at least 61s plus bounded evidence capture)' : ''}`);
      const started = Date.now();
      const { attempts, decision } = await executeTest(browser, {
        site: { url: fixtures.origin },
        steps: [step('goto', scenario.path), ...(scenario.steps ?? [])].map((s, i) => ({ ...s, position: i + 1 })),
      });
      const evidence = [];
      for (const [index, attempt] of attempts.entries()) {
        const screenshot = attempt.screenshot ? `${scenario.id}-${repeat}-attempt-${index + 1}.png` : null;
        if (screenshot) await writeFile(path.join(output, screenshot), attempt.screenshot);
        evidence.push({
          number: index + 1, started_at: attempt.started_at, finished_at: attempt.finished_at,
          passed: !attempt.failure, kind: attempt.failure?.kind ?? null,
          failed_step: attempt.failure?.position ?? null, error: attempt.failure?.message ?? null,
          screenshot, screenshot_available: Boolean(screenshot), debug: attempt.debug ?? null,
        });
      }
      const evidenceComplete = evidence.every((a) => a.started_at && a.finished_at && a.debug?.url
        && (a.passed || (a.error && typeof a.screenshot_available === 'boolean')));
      const matches = decision.outcome === scenario.outcome && decision.severity === scenario.severity
        && attempts.length === scenario.attempts && Boolean(evidenceComplete);
      rows.push({ scenario: scenario.id, repeat, expected: { outcome: scenario.outcome, severity: scenario.severity, attempts: scenario.attempts },
        actual: decision, matches, evidence_complete: Boolean(evidenceComplete), duration_ms: Date.now() - started, attempts: evidence });
      console.log(`  ${matches ? 'PASS' : 'FAIL'}: ${decision.outcome}, incident severity: ${decision.severity ?? 'none'}`);
    }
  }
} catch (error) {
  rows.push({ scenario: 'benchmark-execution', matches: false, error: error.message });
  console.error(error);
} finally {
  await browser?.close();
  await fixtures?.close();
}

const observed = rows.filter((r) => r.actual);
const truePositives = observed.filter((r) => r.expected.outcome === 'confirmed' && r.actual.outcome === 'confirmed').length;
const falsePositives = observed.filter((r) => r.expected.outcome !== 'confirmed' && r.actual.outcome === 'confirmed').length;
const falseNegatives = observed.filter((r) => r.expected.outcome === 'confirmed' && r.actual.outcome !== 'confirmed').length;
const percentage = (n, d) => d ? Math.round(n / d * 10000) / 100 : null;
const report = {
  generated_at: new Date().toISOString(), node: process.version, browser: browser?.version() ?? null,
  scope: 'Local controlled fixtures; shared production browser execution, retries and classification. No database, storage upload, alert delivery, geographic verification or production accuracy assessment.',
  repetitions, planned: scenarios.length * repetitions, completed: observed.length,
  passed: rows.filter((r) => r.matches).length,
  metrics: { true_positives: truePositives, false_positives: falsePositives, false_negatives: falseNegatives,
    alert_precision_percent: percentage(truePositives, truePositives + falsePositives),
    detection_recall_percent: percentage(truePositives, truePositives + falseNegatives) }, rows,
};
await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
await writeFile(path.join(output, 'report.md'), [
  '# Controlled browser benchmark', '', report.generated_at, '', report.scope, '',
  `Scenarios passed: ${report.passed}/${report.planned}. Completed: ${report.completed}.`,
  `False critical alerts: ${falsePositives}. Missed injected defects: ${falseNegatives}.`, '',
  '| Scenario | Expected | Actual | Incident severity | Attempt metadata | Screenshots | Result |',
  '|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.scenario} | ${r.expected?.outcome ?? '-'} | ${r.actual?.outcome ?? 'execution error'} | ${r.actual?.severity ?? 'none'} | ${r.evidence_complete ? 'recorded' : 'incomplete'} | ${r.attempts?.filter((a) => a.screenshot_available).length ?? 0}/${r.attempts?.filter((a) => !a.passed).length ?? 0} failed attempts | ${r.matches ? 'PASS' : 'FAIL'} |`),
  '', 'Full attempt diagnostics, timestamps, durations and screenshot filenames are in report.json.',
].join('\n'));
console.log(`Report: ${output}`);
if (report.completed !== report.planned || rows.some((r) => !r.matches)) process.exitCode = 1;
