// Confirmation means the same explicit assertion failed in two fresh sessions.
// It does not establish global downtime or identify the underlying cause.
export function classifyAttempts(attempts) {
  const last = attempts.at(-1);
  const f = last.failure;
  if (!f) return { status: 'passed', outcome: 'passed', severity: null };
  if (f.kind === 'blocked') return { status: 'error', outcome: 'blocked', severity: null };
  if (f.kind === 'selector_changed') return { status: 'error', outcome: 'maintenance', severity: 'maintenance' };
  const first = attempts[0].failure;
  const confirmed = attempts.length >= 2 && f.kind === 'real_bug'
    && first?.kind === 'real_bug' && first.position === f.position
    && (first.confirmation_key ?? first.message) === (f.confirmation_key ?? f.message);
  return confirmed
    ? { status: 'failed', outcome: 'confirmed', severity: 'critical' }
    : { status: 'error', outcome: 'inconclusive', severity: null };
}
