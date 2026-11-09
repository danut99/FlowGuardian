import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { supabase } from '../../lib/supabase'
import { StatusIcon } from '../../components/ui'
import { fadeUp, stagger } from '../../components/motion'
import type { CheckStatus, Run } from '../../types'

type Snapshot = {
  status: number | null; load_ms: number | null; ttfb: number | null; lcp: number | null; cls: number | null
  bytes: number | null; requests: number | null; js_errors: string[]; title: string; noindex: boolean
}
type Finding = { severity: 'high' | 'medium' | 'low' | 'info'; message: string; improved: boolean }
type Deploy = {
  id: string; detected_at: string; status: 'pending' | 'done' | 'error'; error: string | null
  changes: { added?: string[]; removed?: string[]; generator?: { before: string | null; after: string | null } | null }
  before: Snapshot | null; after: Snapshot | null; findings: Finding[]
}
type Tracking = { deploy_checked_at: string | null; deploy_tracking: 'on' | 'unstable' }

const sec = (ms: number | null | undefined) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`)
const findingStatus = (f: Finding): CheckStatus => (f.improved ? 'pass' : f.severity === 'high' || f.severity === 'medium' ? 'fail' : 'warn')

const METRICS: { label: string; get: (s: Snapshot) => number | null; fmt: (v: number) => string; lowerIsBetter: boolean }[] = [
  { label: 'Content (LCP)', get: (s) => s.lcp, fmt: (v) => sec(v), lowerIsBetter: true },
  { label: 'Server (TTFB)', get: (s) => s.ttfb, fmt: (v) => `${Math.round(v)} ms`, lowerIsBetter: true },
  { label: 'Load time', get: (s) => s.load_ms, fmt: (v) => sec(v), lowerIsBetter: true },
  { label: 'Stability (CLS)', get: (s) => s.cls, fmt: (v) => v.toFixed(2), lowerIsBetter: true },
  { label: 'Size', get: (s) => s.bytes, fmt: (v) => `${(v / 1e6).toFixed(1)} MB`, lowerIsBetter: true },
  { label: 'Requests', get: (s) => s.requests, fmt: (v) => String(v), lowerIsBetter: true },
  { label: 'JavaScript errors', get: (s) => s.js_errors.length, fmt: (v) => String(v), lowerIsBetter: true },
]

export function DeploysTab({ siteId, runs }: { siteId: string; runs: Run[] }) {
  const [deploys, setDeploys] = useState<Deploy[]>([])
  const [tracking, setTracking] = useState<Tracking | null>(null)

  const load = useCallback(async () => {
    const [d, s] = await Promise.all([
      supabase.from('deploys').select('*').eq('site_id', siteId).order('detected_at', { ascending: false }).limit(20),
      supabase.from('sites').select('deploy_checked_at, deploy_tracking').eq('id', siteId).single(),
    ])
    setDeploys((d.data as Deploy[]) ?? [])
    setTracking(s.data as Tracking | null)
  }, [siteId])

  useEffect(() => {
    load()
    const channel = supabase.channel(`deploys-${siteId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deploys', filter: `site_id=eq.${siteId}` }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [siteId, load])

  return (
    <motion.div variants={stagger} initial="hidden" animate="show">
      <motion.div variants={fadeUp} className="card" style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ margin: 0 }}>Detected deploys</h2>
        <p className="muted" style={{ margin: '0.3rem 0 0' }}>
          We notice on our own when a new version of the site goes live (we check every ~15 minutes). Then we re-measure the home page,
          compare it with the previous version and run all tests.
        </p>
        <p className="muted small" style={{ margin: '0.5rem 0 0' }}>
          {tracking?.deploy_tracking === 'unstable'
            ? 'The site changes its file addresses on every visit, so we can\'t reliably detect deploys.'
            : tracking?.deploy_checked_at
              ? `Last check: ${new Date(tracking.deploy_checked_at).toLocaleString('en-GB')}`
              : 'Tracking starts on the next worker run.'}
        </p>
      </motion.div>

      {deploys.length === 0 ? (
        <p className="muted">No new deploys detected yet. When you publish a new version, it shows up here with everything that changed.</p>
      ) : (
        <div className="list">
          {deploys.map((d, i) => <DeployCard key={d.id} deploy={d} runs={runs} defaultOpen={i === 0} />)}
        </div>
      )}
    </motion.div>
  )
}

function DeployCard({ deploy: d, runs, defaultOpen }: { deploy: Deploy; runs: Run[]; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const problems = d.findings.filter((f) => !f.improved && f.severity !== 'info')
  // First finished run of each test after the deploy was detected
  const after = new Map<string, Run>()
  for (const r of [...runs].reverse()) {
    if (r.created_at >= d.detected_at && !after.has(r.test_id) && (r.status === 'passed' || r.status === 'failed' || r.status === 'error')) after.set(r.test_id, r)
  }
  const testRuns = [...after.values()]
  const failed = testRuns.filter((r) => r.status !== 'passed')
  const state: CheckStatus = d.status === 'error' ? 'warn' : problems.some((f) => findingStatus(f) === 'fail') || failed.length ? 'fail' : problems.length ? 'warn' : 'pass'

  return (
    <motion.div layout variants={fadeUp} className={`card deploy ${d.status === 'pending' ? 'pending' : state}`}>
      <button className="deploy-head" onClick={() => setOpen(!open)}>
        {d.status === 'pending' ? <span className="spinner" /> : <StatusIcon status={state} />}
        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <div className="title">New version · {new Date(d.detected_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</div>
          <div className="muted small">
            {d.status === 'pending' ? 'Measuring the new version…'
              : d.status === 'error' ? `Couldn't measure: ${d.error}`
              : problems.length ? `${problems.length} ${problems.length === 1 ? 'new problem' : 'new problems'}` : 'No regressions'}
            {testRuns.length > 0 && ` · tests: ${testRuns.length - failed.length}/${testRuns.length} passing`}
          </div>
        </div>
        <motion.span className="muted" animate={{ rotate: open ? 90 : 0 }}>›</motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
            <div className="deploy-body">
              {d.findings.length > 0 && (
                <div>
                  {d.findings.map((f, i) => (
                    <div key={i} className={`check ${findingStatus(f)}`}>
                      <StatusIcon status={findingStatus(f)} />
                      <div className="detail" style={{ color: 'var(--text)', fontSize: '0.9rem' }}>{f.message}</div>
                    </div>
                  ))}
                </div>
              )}

              {d.before && d.after && (
                <table className="table">
                  <thead><tr><th>Home page</th><th>Before</th><th>After</th></tr></thead>
                  <tbody>
                    {METRICS.map((m) => {
                      const b = m.get(d.before!)
                      const a = m.get(d.after!)
                      const cls = a == null || b == null || a === b ? '' : (a < b) === m.lowerIsBetter ? 'better' : 'worse'
                      return (
                        <tr key={m.label}>
                          <td className="muted">{m.label}</td>
                          <td>{b == null ? '—' : m.fmt(b)}</td>
                          <td className={`delta ${cls}`}>{a == null ? '—' : m.fmt(a)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}

              {testRuns.length > 0 && (
                <div>
                  <div className="label" style={{ marginBottom: '0.4rem' }}>Tests run after the deploy</div>
                  {testRuns.map((r) => (
                    <div key={r.id} className={`check ${r.status === 'passed' ? 'pass' : 'fail'}`}>
                      <StatusIcon status={r.status === 'passed' ? 'pass' : 'fail'} />
                      <div style={{ minWidth: 0 }}>
                        <div className="label">{r.test.name}</div>
                        {r.status !== 'passed' && <div className="detail">{r.error}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {(d.changes.added?.length || d.changes.removed?.length || d.changes.generator) && (
                <details>
                  <summary className="muted small">Changed files ({(d.changes.added?.length ?? 0) + (d.changes.removed?.length ?? 0)})</summary>
                  <div className="issue-list">
                    {d.changes.generator && <div className="issue"><span>Platform</span><span className="mono small">{d.changes.generator.before ?? '—'} → {d.changes.generator.after ?? '—'}</span></div>}
                    {d.changes.added?.map((a) => <div key={`+${a}`} className="issue"><span className="mono truncate" title={a}>{a}</span><span className="small" style={{ color: 'var(--ok)' }}>new</span></div>)}
                    {d.changes.removed?.map((a) => <div key={`-${a}`} className="issue"><span className="mono truncate" title={a}>{a}</span><span className="muted small">removed</span></div>)}
                  </div>
                </details>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
