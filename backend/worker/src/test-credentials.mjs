export const CREDENTIAL_REFS = { '{{test.username}}': 'username', '{{test.password}}': 'password' };
export const needsTestCredentials = steps => steps.some(step => Object.hasOwn(CREDENTIAL_REFS, step.value ?? ''));

export function resolveCredentialSteps(steps, account) {
  return steps.map(step => {
    const key = Object.hasOwn(CREDENTIAL_REFS, step.value ?? '') ? CREDENTIAL_REFS[step.value] : null;
    if (!key) return step;
    if (step.action !== 'fill') throw new Error('Test-account references can only be used in fill steps.');
    if (!account || typeof account[key] !== 'string' || !account[key]) throw new Error('Save a dedicated test account before running this flow.');
    return { ...step, value: account[key], credential: true };
  });
}

// Preserve status and timing, omit raw browser artifacts in credential-bearing runs.
export function protectCredentialEvidence(result, siteUrl, comparisonKey) {
  const url = new URL(siteUrl).origin;
  const trace = (result.step_trace ?? result.failure?.step_trace ?? []).map(step => ({
    position: step.position, action: step.action, target: '[configured target]',
    value: step.action === 'fill' ? '[redacted]' : null, status: step.status,
    url, duration_ms: step.duration_ms,
    ...(step.status === 'failed' ? { error: 'The configured step did not complete.' } : {}),
  }));
  if (result.failure) {
    if (comparisonKey) Object.defineProperty(result.failure, 'confirmation_key', {
      value: createHmac('sha256', comparisonKey).update(result.failure.message).digest('hex'),
      enumerable: false, configurable: true,
    });
    result.failure.message = {
      selector_changed: 'The configured target could not be matched uniquely.',
      real_bug: 'The configured expected result was not observed.',
      blocked: 'The website blocked the check.', timeout: 'The configured step timed out.',
    }[result.failure.kind] ?? 'The credential-bearing check could not complete.';
    result.failure.stack = `${result.failure.name}: ${result.failure.message}`;
    result.failure.proposed = null;
    result.failure.screenshot = null;
    result.failure.step_trace = trace;
  }
  result.screenshot = null;
  result.step_trace = trace;
  result.debug = { url, title: null, viewport: null, user_agent: null,
    console: [], page_errors: [], network: [], captured_at: new Date().toISOString(),
    credential_protected: true, step_trace: trace };
  return result;
}
import { createHmac } from 'node:crypto';
