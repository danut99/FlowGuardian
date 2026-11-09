import { useSignedUrl } from '../../lib/useSignedUrl'
import { DevDetails } from './DevDetails'
import type { Run } from '../../types'

export const FAILURE_LABEL: Record<string, string> = {
  selector_changed: 'Elementul s-a schimbat',
  real_bug: 'Problemă pe site',
  timeout: 'Timp depășit',
  blocked: 'Blocat de site',
}

export function FailureDetails({ run, stepLabel }: { run: Run; stepLabel?: string }) {
  const shot = useSignedUrl('screenshots', run.screenshot_path)
  return (
    <div className="failure">
      <div className="failure-info">
        <b>{run.failure_kind ? FAILURE_LABEL[run.failure_kind] ?? run.failure_kind : 'Eroare la rulare'}</b>
        {stepLabel && <div className="small">La pasul {run.failed_step}: {stepLabel}</div>}
        {run.error && <div className="muted small mono">{run.error}</div>}
        <div className="muted small">{new Date(run.created_at).toLocaleString('ro-RO')}</div>
        <DevDetails run={run} />
      </div>
      {run.screenshot_path && (
        shot ? (
          <figure className="failure-figure">
            <a href={shot} target="_blank" rel="noreferrer" title="Deschide captura completă">
              <img src={shot} alt="Captură de ecran la momentul eșecului" className="failure-shot" />
            </a>
            {run.error?.includes('iese din ecran') && (
              <figcaption className="muted small">Linia punctată = marginea ecranului. Hașurat = iese din ecran. Roșu = elementul vinovat.</figcaption>
            )}
          </figure>
        ) : <span className="spinner" />
      )}
    </div>
  )
}
