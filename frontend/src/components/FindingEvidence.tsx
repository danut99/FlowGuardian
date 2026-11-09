import type { Check } from '../types'

export function FindingEvidence({ check }: { check: Check }) {
  const e = check.evidence
  const review = check.verdict === 'needs_validation'
  const hardening = check.severity === 'hardening'
  return <div className="finding-evidence">
    <div className="finding-meta">
      {check.status !== 'pass' && <span className={`finding-verdict ${review ? 'review' : hardening ? 'hardening' : 'observed'}`}>
        <span className="finding-verdict-dot" />{review ? 'Needs review' : hardening ? 'Hardening' : 'Observed'}
      </span>}
      {e && <span className="finding-timestamp">{new Date(e.observed_at).toLocaleDateString()}</span>}
    </div>
    {e && <details className="finding-disclosure"><summary>View evidence &amp; fix <span aria-hidden="true">+</span></summary>
      <div className="finding-body">
        <div className="finding-section"><h4>Where to look</h4>
          <a className="finding-url" href={e.url} target="_blank" rel="noreferrer">{e.url}</a>
          {e.target && <code className="finding-target">{e.target}</code>}
        </div>
        <div className="finding-section"><h4>What we observed</h4><p>{e.observation}</p>
          {e.expected && <p className="finding-criterion">{e.expected}</p>}
          {e.resources?.map((r, i) => <p className="finding-resource" key={i}>{r.url} {r.status} {r.message}</p>)}
          {e.affected && e.affected.length > 1 && <ul>{e.affected.map((p) => <li key={p.url}><a href={p.url} target="_blank" rel="noreferrer">{p.url}</a> {p.note}</li>)}</ul>}
        </div>
        <div className="finding-section"><h4>Reproduce it</h4><p>{e.reproduce}</p></div>
        {e.fix && <div className="finding-section finding-fix"><h4>Suggested fix <span>Not verified</span></h4><p>{e.fix}</p></div>}
        {e.limitation && <div className="finding-limits"><h4>Limits of this check</h4><p>{e.limitation}</p></div>}
        <div className="finding-timestamp">Checked {new Date(e.observed_at).toLocaleString()}</div>
      </div>
    </details>}
  </div>
}
