import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { supabase } from '../../lib/supabase'
import { fadeUp, stagger } from '../../components/motion'

type Metric = { measured_at: string; source: 'scan' | 'deploy' | 'daily'; score: number | null; lcp: number | null; ttfb: number | null; load_ms: number | null; bytes: number | null; js_errors: number | null }
type HRun = { id: string; test_id: string; status: string; duration_ms: number | null; created_at: string; test: { name: string; essential_key: string | null } }
type Point = { t: number; v: number; bad?: boolean }

const DAY = 86_400_000
const RANGES = [[7, '7 days'], [30, '30 days'], [90, '90 days']] as const
const done = (r: HRun) => r.status === 'passed' || r.status === 'failed' || r.status === 'error'
const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
const pct = (ok: number, total: number) => (total ? `${((ok / total) * 100).toFixed(ok === total ? 0 : 2)}%` : '—')
const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`
const day = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export function HistoryTab({ siteId }: { siteId: string }) {
  const [range, setRange] = useState<number>(30)
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [runs, setRuns] = useState<HRun[]>([])
  const [deploys, setDeploys] = useState<number[]>([])
  const [now, setNow] = useState(0)

  const load = useCallback(async () => {
    const t = Date.now()
    const since = new Date(t - range * DAY).toISOString()
    const [m, r, d] = await Promise.all([
      supabase.from('site_metrics').select('measured_at, source, score, lcp, ttfb, load_ms, bytes, js_errors')
        .eq('site_id', siteId).gte('measured_at', since).order('measured_at'),
      supabase.from('runs').select('id, test_id, status, duration_ms, created_at, test:tests!inner(name, site_id, essential_key)')
        .eq('test.site_id', siteId).gte('created_at', since).order('created_at').limit(10000),
      supabase.from('deploys').select('detected_at').eq('site_id', siteId).gte('detected_at', since),
    ])
    setMetrics((m.data as Metric[]) ?? [])
    setRuns(((r.data as unknown as HRun[]) ?? []).filter(done))
    setDeploys((d.data ?? []).map((x: { detected_at: string }) => new Date(x.detected_at).getTime()))
    setNow(t)
  }, [siteId, range])

  useEffect(() => { load() }, [load])

  const from = now - range * DAY
  const availability = runs.filter((r) => r.test.essential_key === 'availability')
  const regression = useMemo(() => lcpRegression(metrics, now), [metrics, now])

  const perTest = useMemo(() => {
    const m = new Map<string, HRun[]>()
    for (const r of runs) m.set(r.test_id, [...(m.get(r.test_id) ?? []), r])
    return [...m.values()].sort((a, b) => passRate(a) - passRate(b))
  }, [runs])

  if (!now) return <p className="muted">Loading…</p>

  return (
    <motion.div variants={stagger} initial="hidden" animate="show">
      <motion.div variants={fadeUp} className="section-head">
        <div>
          <h2 style={{ margin: 0 }}>History</h2>
          <p className="muted small">How the site has changed over time. Vertical lines mark detected deploys.</p>
        </div>
        <div className="seg">
          {RANGES.map(([v, l]) => <button key={v} className={range === v ? 'on' : ''} onClick={() => setRange(v)}>{l}</button>)}
        </div>
      </motion.div>

      {regression && (
        <motion.div variants={fadeUp} className="card regression">
          <b>The site has become slower.</b> Since {day(regression.since)}, the main content appears in {sec(regression.recent)} compared to {sec(regression.before)} before.
        </motion.div>
      )}

      <motion.div variants={fadeUp} className="card">
        <div className="row">
          <h3 style={{ margin: 0 }}>Availability</h3>
          <div className="api-stats">
            {[1, 7, range].filter((d, i, a) => a.indexOf(d) === i && d <= range).map((d) => {
              const list = availability.filter((r) => new Date(r.created_at).getTime() >= now - d * DAY)
              return <div key={d}><b>{pct(list.filter((r) => r.status === 'passed').length, list.length)}</b><span className="muted small">{d === 1 ? '24h' : `${d} days`}</span></div>
            })}
          </div>
        </div>
        {availability.length ? <UptimeBars runs={availability} from={from} days={range} /> : <p className="muted small">No availability checks yet.</p>}
      </motion.div>

      <div className="history-grid">
        <ChartCard title="Response time" hint="How long the home page takes to open (availability test)"
          points={availability.filter((r) => r.duration_ms != null).map((r) => ({ t: new Date(r.created_at).getTime(), v: r.duration_ms!, bad: r.status !== 'passed' }))}
          from={from} to={now} deploys={deploys} fmt={(v) => (v >= 1000 ? sec(v) : `${Math.round(v)} ms`)} />
        <ChartCard title="Main content appears (LCP)" hint="Measured daily and after every deploy. Good: under 2.5 s"
          points={metrics.filter((m) => m.lcp != null).map((m) => ({ t: new Date(m.measured_at).getTime(), v: m.lcp!, bad: m.lcp! > 4000 }))}
          from={from} to={now} deploys={deploys} fmt={sec} threshold={2500} />
        <ChartCard title="Overall score" hint="On every full scan"
          points={metrics.filter((m) => m.score != null).map((m) => ({ t: new Date(m.measured_at).getTime(), v: m.score! }))}
          from={from} to={now} deploys={deploys} fmt={(v) => String(Math.round(v))} min={0} max={100} />
        <ChartCard title="Page size" hint="Total downloaded on the first visit"
          points={metrics.filter((m) => m.bytes != null).map((m) => ({ t: new Date(m.measured_at).getTime(), v: m.bytes! }))}
          from={from} to={now} deploys={deploys} fmt={(v) => `${(v / 1e6).toFixed(1)} MB`} />
      </div>

      <motion.div variants={fadeUp} className="card" style={{ marginTop: '0.9rem' }}>
        <h3 style={{ marginTop: 0 }}>Tests in the last {range} days</h3>
        {perTest.length === 0 ? <p className="muted small">No runs in this period.</p> : (
          <table className="table">
            <thead><tr><th>Test</th><th>Runs</th><th>Passed</th><th>Latest runs</th></tr></thead>
            <tbody>
              {perTest.map((list) => (
                <tr key={list[0].test_id}>
                  <td>{list[0].test.name}</td>
                  <td className="muted">{list.length}</td>
                  <td className={passRate(list) < 1 ? 'delta worse' : 'delta better'}>{pct(list.filter((r) => r.status === 'passed').length, list.length)}</td>
                  <td><div className="history">{list.slice(-24).map((r) => <span key={r.id} className={`hdot ${r.status}`} title={new Date(r.created_at).toLocaleString('en-GB')} />)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </motion.div>
    </motion.div>
  )
}

const passRate = (list: HRun[]) => list.filter((r) => r.status === 'passed').length / list.length

// Last 3 days vs the 7 days before: flags a lasting slowdown, not one bad sample
function lcpRegression(metrics: Metric[], now: number) {
  const pts = metrics.filter((m) => m.lcp != null).map((m) => ({ t: new Date(m.measured_at).getTime(), v: m.lcp! }))
  const recentPts = pts.filter((p) => p.t >= now - 3 * DAY)
  const recent = median(recentPts.map((p) => p.v))
  const before = median(pts.filter((p) => p.t < now - 3 * DAY && p.t >= now - 10 * DAY).map((p) => p.v))
  if (recent == null || before == null || recentPts.length < 2) return null
  return recent > before * 1.3 && recent - before > 500 ? { recent, before, since: recentPts[0].t } : null
}

function UptimeBars({ runs, from, days }: { runs: HRun[]; from: number; days: number }) {
  const buckets = Array.from({ length: days }, (_, i) => {
    const start = from + i * DAY
    const list = runs.filter((r) => { const t = new Date(r.created_at).getTime(); return t >= start && t < start + DAY })
    const ok = list.filter((r) => r.status === 'passed').length
    return { start, total: list.length, ok }
  })
  return (
    <div className="uptime-bars">
      {buckets.map((b, i) => {
        const ratio = b.total ? b.ok / b.total : null
        const cls = ratio == null ? 'none' : ratio === 1 ? 'pass' : ratio >= 0.95 ? 'warn' : 'fail'
        return (
          <motion.span key={b.start} className={`ubar ${cls}`} initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: i * 0.01 }}
            title={`${day(b.start)}: ${b.total ? `${b.ok}/${b.total} checks passed` : 'no data'}`} />
        )
      })}
    </div>
  )
}

function ChartCard({ title, hint, points, from, to, deploys, fmt, threshold, min, max }: {
  title: string; hint: string; points: Point[]; from: number; to: number; deploys: number[]
  fmt: (v: number) => string; threshold?: number; min?: number; max?: number
}) {
  const W = 520
  const H = 150
  const P = { l: 8, r: 8, t: 10, b: 20 }
  const vals = points.map((p) => p.v)
  const lo = min ?? Math.min(...vals, threshold ?? Infinity) * 0.9
  const hi = max ?? Math.max(...vals, threshold ?? -Infinity) * 1.1
  const x = (t: number) => P.l + ((t - from) / Math.max(1, to - from)) * (W - P.l - P.r)
  const y = (v: number) => H - P.b - ((v - lo) / Math.max(1e-9, hi - lo)) * (H - P.t - P.b)
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const last = points.at(-1)

  return (
    <motion.div variants={fadeUp} className="card chart-card">
      <div className="row">
        <h3 style={{ margin: 0 }}>{title}</h3>
        {last && <b>{fmt(last.v)}</b>}
      </div>
      <p className="muted small" style={{ margin: '0.2rem 0 0.5rem' }}>{hint}</p>
      {points.length < 2 ? <p className="muted small">Not enough measurements yet. Check back in a few days.</p> : (
        <svg viewBox={`0 0 ${W} ${H}`} className="chart">
          {threshold != null && threshold > lo && threshold < hi && (
            <line x1={P.l} x2={W - P.r} y1={y(threshold)} y2={y(threshold)} className="chart-threshold" />
          )}
          {deploys.filter((t) => t >= from).map((t) => <line key={t} x1={x(t)} x2={x(t)} y1={P.t} y2={H - P.b} className="chart-deploy" />)}
          <motion.path d={line} className="chart-line" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: 'easeOut' }} />
          {points.map((p, i) => p.bad && <circle key={i} cx={x(p.t)} cy={y(p.v)} r={3} fill="var(--bad)" />)}
          <text x={P.l} y={H - 4} className="chart-label">{day(from)}</text>
          <text x={W - P.r} y={H - 4} textAnchor="end" className="chart-label">today</text>
          <text x={W - P.r} y={P.t + 8} textAnchor="end" className="chart-label">{fmt(hi)}</text>
        </svg>
      )}
    </motion.div>
  )
}
