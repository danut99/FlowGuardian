import { FindingEvidence } from '../../components/FindingEvidence'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { supabase } from '../../lib/supabase'
import { ScoreRing, StatusIcon } from '../../components/ui'
import type { Check, DeepVerdict, PageCheck, Site } from '../../types'

const sec = (ms: number | null | undefined) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`)
const pathOf = (url: string) => { const u = new URL(url); return u.pathname + u.search }

// Bucket is private; signed URLs expire
function useShot(path?: string) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!path) return
    let alive = true
    supabase.storage.from('page-shots').createSignedUrl(path, 3600).then(({ data }) => { if (alive) setUrl(data?.signedUrl ?? null) })
    return () => { alive = false }
  }, [path])
  return path ? url : null
}

export function PagesPanel({ site, pages, onDeep }: { site: Site; pages: PageCheck[]; onDeep: (pageId: string) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const running = site.pages_status === 'pending' || site.pages_status === 'running'
  const done = pages.filter((p) => p.status !== 'pending').length
  // Worst pages first; pages still being analyzed at the end
  const sorted = [...pages].sort((a, b) =>
    (a.status === 'pending' ? 1 : 0) - (b.status === 'pending' ? 1 : 0) || (a.score ?? 101) - (b.score ?? 101))

  return (
    <div className="card">
      <div className="row">
        <div>
          <h3 style={{ margin: 0 }}>Analyzed pages</h3>
          <p className="muted small" style={{ margin: '0.2rem 0 0' }}>Speed, SEO and errors on every page. Click a page for details.</p>
        </div>
        <span className="muted small nowrap">{running ? <><span className="spinner" /> {done}/{pages.length}</> : `${pages.length} pages`}</span>
      </div>
      {running && (
        <div className="progress"><motion.div animate={{ width: `${(done / Math.max(1, pages.length)) * 100}%` }} transition={{ duration: 0.4 }} /></div>
      )}
      <div className="page-list">
        {sorted.map((p) => (
          <PageRow key={p.id} page={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} onDeep={() => onDeep(p.id)} />
        ))}
      </div>
    </div>
  )
}

function PageRow({ page: p, open, onToggle, onDeep }: { page: PageCheck; open: boolean; onToggle: () => void; onDeep: () => void }) {
  const problems = p.checks.filter((c) => c.status !== 'pass')
  const fails = problems.filter((c) => c.status === 'fail').length
  return (
    <div className={`page-row${open ? ' open' : ''}`}>
      <button className="page-head" onClick={onToggle}>
        {p.status === 'pending' ? <span className="page-pending"><span className="spinner" /></span>
          : p.status === 'error' ? <StatusIcon status="fail" />
          : <ScoreRing score={p.score} size={38} />}
        <span className="page-path truncate" title={p.url}>{pathOf(p.url)}</span>
        <span className="page-meta muted small">
          {p.status === 'done' && p.metrics && <>LCP {sec(p.metrics.lcp)} · </>}
          {p.status === 'done' ? (problems.length ? `${problems.length} ${problems.length === 1 ? 'problem' : 'problems'}${fails ? ` (${fails} serious)` : ''}` : 'all OK')
            : p.status === 'error' ? 'couldn\'t analyze' : 'analyzing…'}
        </span>
        <motion.span className="muted" animate={{ rotate: open ? 90 : 0 }}>›</motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
            <PageDetail page={p} onDeep={onDeep} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function PageDetail({ page: p, onDeep }: { page: PageCheck; onDeep: () => void }) {
  const [showOk, setShowOk] = useState(false)
  const problems = p.checks.filter((c) => c.status !== 'pass').sort((a, b) => (a.status === 'fail' ? 0 : 1) - (b.status === 'fail' ? 0 : 1))
  const passed = p.checks.filter((c) => c.status === 'pass')
  const m = p.metrics
  const deepBusy = p.deep_status === 'pending' || p.deep_status === 'running'

  return (
    <div className="page-detail">
      <a href={p.url} target="_blank" rel="noreferrer" className="muted small truncate" style={{ display: 'block' }}>{p.url}</a>
      {p.status === 'error' && <p className="notice error">{p.analysis_error}</p>}

      {m && (
        <div className="metric-grid">
          <Metric label="Load time" value={sec(m.load_ms)} />
          <Metric label="Server (TTFB)" value={m.ttfb == null ? '—' : `${Math.round(m.ttfb)} ms`} />
          <Metric label="Content (LCP)" value={sec(m.lcp)} />
          <Metric label="Stability (CLS)" value={m.cls == null ? '—' : m.cls.toFixed(2)} />
          <Metric label="Size" value={`${(m.bytes / 1e6).toFixed(1)} MB`} sub={`${m.requests} requests`} />
        </div>
      )}

      {p.status === 'done' && (
        <div className="page-checks">
          {problems.map((c) => <MiniCheck key={c.id} c={c} />)}
          {passed.length > 0 && (
            <button className="fold" onClick={() => setShowOk(!showOk)}>
              {showOk ? 'Hide' : `${passed.length} ${passed.length === 1 ? 'check' : 'checks'} OK`}
            </button>
          )}
          {showOk && passed.map((c) => <MiniCheck key={c.id} c={c} />)}
        </div>
      )}

      <div className="deep">
        <div className="row">
          <div>
            <div className="label">In-depth analysis</div>
            <div className="muted small">Slow network (4G/3G), phone layout, preloader and sideways scroll, screenshots.</div>
          </div>
          <button className="btn sm" disabled={deepBusy} onClick={onDeep}>
            {deepBusy ? <><span className="spinner" /> Analyzing…</> : p.deep_status === 'done' ? 'Re-scan' : 'Analyze in depth'}
          </button>
        </div>
        {deepBusy && <p className="muted small">Takes about a minute. Results show up here automatically.</p>}
        {p.deep_status === 'error' && <p className="notice error">{p.deep_error}</p>}
        {p.deep_status === 'done' && p.deep && <DeepResult deep={p.deep} />}
      </div>
    </div>
  )
}

function DeepResult({ deep }: { deep: NonNullable<PageCheck['deep']> }) {
  return (
    <div style={{ display: 'grid', gap: '0.75rem', marginTop: '0.75rem' }}>
      <div className="metric-grid">
        {deep.network.filter((n) => !n.error).map((n) => (
          <Metric key={n.id} label={n.label} value={n.lcp_ms == null ? 'doesn\'t appear within 45 s' : sec(n.lcp_ms)} sub="until content appears" />
        ))}
      </div>
      <Verdict label="Phone layout" v={deep.mobile} />
      <Verdict label="Loading (preloader, sideways scroll)" v={deep.load} />
      <div className="shots">
        <Shot path={deep.shots.mobile_issue} caption="Problem on phone" />
        <Shot path={deep.shots.load_issue} caption="Problem while loading" />
        <Shot path={deep.shots.desktop} caption="Desktop" />
        <Shot path={deep.shots.mobile} caption="Phone" />
      </div>
      <span className="muted small">Analyzed {new Date(deep.analyzed_at).toLocaleString('en-GB')}</span>
    </div>
  )
}

function Verdict({ label, v }: { label: string; v: DeepVerdict }) {
  const status = v.ok === true ? 'pass' : v.ok === false ? 'fail' : 'warn'
  return (
    <div className={`check ${status}`}>
      <StatusIcon status={status} />
      <div style={{ minWidth: 0 }}>
        <div className="label">{label}</div>
        <div className="detail">{v.ok === true ? 'All good' : v.message}</div>
      </div>
    </div>
  )
}

function Shot({ path, caption }: { path?: string; caption: string }) {
  const url = useShot(path)
  if (!path) return null
  return (
    <figure className="shot">
      {url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={caption} /></a> : <span className="spinner" />}
      <figcaption className="muted small">{caption}</figcaption>
    </figure>
  )
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="metric">
      <div className="muted small">{label}</div>
      <b>{value}</b>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  )
}

function MiniCheck({ c }: { c: Check }) {
  return (
    <div className={`check ${c.status}`}>
      <StatusIcon status={c.status} />
      <div style={{ minWidth: 0 }}>
        <div className="label">{c.label}</div>
        <div className="detail">{c.detail}</div><FindingEvidence check={c} />
      </div>
    </div>
  )
}
