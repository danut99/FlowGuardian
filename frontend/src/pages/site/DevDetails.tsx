import { useState } from 'react'
import { useDevMode } from '../../lib/devMode'
import type { Run, RunDebug } from '../../types'

function asMarkdown(run: Run, d: RunDebug) {
  return [
    `### ${run.test.name}: ${run.error ?? run.failure_kind ?? 'failure'}`,
    '',
    `- URL: ${d.url}`,
    `- When: ${new Date(run.created_at).toISOString()}`,
    `- Step: ${run.failed_step ?? '—'}`,
    `- Viewport: ${d.viewport ? `${d.viewport.width}×${d.viewport.height}` : '—'}`,
    `- User agent: ${d.user_agent ?? '—'}`,
    ...(d.page_errors.length ? ['', '**JavaScript errors**', ...d.page_errors.map((e) => `\`\`\`\n${e.stack ?? e.message}\n\`\`\``)] : []),
    ...(d.console.length ? ['', '**Console**', ...d.console.map((c) => `- [${c.level}] ${c.text}${c.source ? ` (${c.source})` : ''}`)] : []),
    ...(d.network.length ? ['', '**Failed requests**', ...d.network.map((n) => `- ${n.method} ${n.url} → ${n.status || n.error}`)] : []),
  ].join('\n')
}

export function DevDetails({ run }: { run: Run }) {
  const [dev] = useDevMode()
  const [copied, setCopied] = useState(false)
  const d = run.debug
  if (!dev || !d) return null
  if (d.credential_protected) return <p className="muted small">Raw diagnostics are disabled for this test-account run. Inspect the recorded step outcomes instead.</p>

  async function copy() {
    await navigator.clipboard.writeText(asMarkdown(run, d!))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="dev">
      <div className="row">
        <span className="dev-tag">DEV</span>
        <button className="btn ghost sm" onClick={copy}>{copied ? 'Copied ✓' : 'Copy for ticket'}</button>
      </div>
      <dl className="dev-meta">
        <dt>URL</dt><dd className="mono">{d.url}</dd>
        {d.viewport && <><dt>Viewport</dt><dd className="mono">{d.viewport.width}×{d.viewport.height}</dd></>}
        {d.title && <><dt>Title</dt><dd>{d.title}</dd></>}
      </dl>
      {d.page_errors.length > 0 && (
        <details open>
          <summary>JavaScript errors ({d.page_errors.length})</summary>
          {d.page_errors.map((e, i) => <pre key={i} className="dev-pre">{e.stack ?? e.message}</pre>)}
        </details>
      )}
      {d.network.length > 0 && (
        <details open>
          <summary>Failed requests ({d.network.length})</summary>
          <div className="issue-list">
            {d.network.map((n, i) => (
              <div key={i} className="issue">
                <span className="mono truncate" title={n.url}><b>{n.method}</b> {n.url}</span>
                <span className="mono small nowrap" style={{ color: 'var(--bad)' }}>{n.status || n.error}</span>
              </div>
            ))}
          </div>
        </details>
      )}
      {d.console.length > 0 && (
        <details>
          <summary>Console ({d.console.length})</summary>
          {d.console.map((c, i) => (
            <div key={i} className={`dev-log ${c.level}`}>
              <span className="mono">{c.text}</span>
              {c.source && <span className="muted small mono"> {c.source}</span>}
            </div>
          ))}
        </details>
      )}
      {!d.page_errors.length && !d.network.length && !d.console.length && (
        <p className="muted small">No console errors and no failed requests during the test.</p>
      )}
    </div>
  )
}
