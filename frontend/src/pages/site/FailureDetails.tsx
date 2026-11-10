import { useSignedUrl } from '../../lib/useSignedUrl'
import { DevDetails } from './DevDetails'
import type { Run } from '../../types'

export const FAILURE_LABEL: Record<string, string> = {
  selector_changed: 'The element changed',
  real_bug: 'Problem on the site',
  timeout: 'Timed out',
  blocked: 'Blocked by the site',
}

export function outcomeLabel(run: Run) {
  const labels = { passed: 'Passed', confirmed: 'Confirmed issue', inconclusive: 'Inconclusive', blocked: 'Blocked', maintenance: 'Test needs maintenance' }
  return run.debug?.outcome ? labels[run.debug.outcome] : run.failure_kind ? FAILURE_LABEL[run.failure_kind] ?? run.failure_kind : run.status === 'passed' ? 'Passed' : 'Run error'
}

function AttemptEvidence({ attempt }: { attempt: NonNullable<NonNullable<Run['debug']>['attempts']>[number] }) {
  const shot = useSignedUrl('screenshots', attempt.screenshot_path)
  return <details className="small">
    <summary>Attempt {attempt.number}: {attempt.passed ? 'Passed' : attempt.error ?? 'Could not complete'}</summary>
    <p>Started: {attempt.started_at} · Finished: {attempt.finished_at} (UTC)</p>
    {attempt.failed_step != null && <p>Step: {attempt.failed_step}</p>}
    <p className="mono">{attempt.debug?.url}</p>
    {shot && <a href={shot} target="_blank" rel="noreferrer">Open attempt screenshot</a>}
    {!attempt.passed && !attempt.screenshot_available && <p>Screenshot unavailable.</p>}
  </details>
}

export function FailureDetails({ run, stepLabel }: { run: Run; stepLabel?: string }) {
  const shot = useSignedUrl('screenshots', run.screenshot_path)
  return (
    <div className="failure">
      <div className="failure-info">
        <b>{outcomeLabel(run)}</b>
        {run.debug?.credential_protected && <p className="small">This run used a saved test account. Screenshots and raw browser diagnostics are disabled; recorded step outcomes are retained.</p>}
        {run.debug?.outcome === 'confirmed' && <p className="small">The same check failed in two fresh browser sessions. This does not establish global downtime.</p>}
        {run.debug?.outcome === 'inconclusive' && <p className="small">We could not verify this result. This is not a confirmed site issue.</p>}
        {stepLabel && <div className="small">At step {run.failed_step}: {stepLabel}</div>}
        {run.error && <div className="muted small mono">{run.error}</div>}
        <div className="muted small">{new Date(run.created_at).toLocaleString('en-GB')}</div>
        <DevDetails run={run} />
        {run.debug?.attempts?.map((attempt) => <AttemptEvidence key={attempt.number} attempt={attempt} />)}
      </div>
      {run.screenshot_path && (
        shot ? (
          <figure className="failure-figure">
            <a href={shot} target="_blank" rel="noreferrer" title="Open the full screenshot">
              <img src={shot} alt="Screenshot at the moment of failure" className="failure-shot" />
            </a>
            {/* Romanian phrase kept so older runs stored in the DB still match */}
            {run.error && /iese din ecran|horizontal scroll|off.?screen|overflow/i.test(run.error) && (
              <figcaption className="muted small">Dotted line = edge of the screen. Hatched = off-screen. Red = the element causing it.</figcaption>
            )}
          </figure>
        ) : <span className="spinner" />
      )}
    </div>
  )
}
