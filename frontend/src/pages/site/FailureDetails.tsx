import { useSignedUrl } from '../../lib/useSignedUrl'
import { DevDetails } from './DevDetails'
import type { Run } from '../../types'

export const FAILURE_LABEL: Record<string, string> = {
  selector_changed: 'The element changed',
  real_bug: 'Problem on the site',
  timeout: 'Timed out',
  blocked: 'Blocked by the site',
}

export function FailureDetails({ run, stepLabel }: { run: Run; stepLabel?: string }) {
  const shot = useSignedUrl('screenshots', run.screenshot_path)
  return (
    <div className="failure">
      <div className="failure-info">
        <b>{run.failure_kind ? FAILURE_LABEL[run.failure_kind] ?? run.failure_kind : 'Run error'}</b>
        {stepLabel && <div className="small">At step {run.failed_step}: {stepLabel}</div>}
        {run.error && <div className="muted small mono">{run.error}</div>}
        <div className="muted small">{new Date(run.created_at).toLocaleString('en-GB')}</div>
        <DevDetails run={run} />
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
