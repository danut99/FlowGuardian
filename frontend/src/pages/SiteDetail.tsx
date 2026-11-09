import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { supabase } from '../lib/supabase'
import { Favicon, ScoreRing } from '../components/ui'
import { OverviewTab } from './site/OverviewTab'
import { TestsTab } from './site/TestsTab'
import { RunsTab } from './site/RunsTab'
import { DeploysTab } from './site/DeploysTab'
import { HistoryTab } from './site/HistoryTab'
import type { PageCheck, Run, Site, Test } from '../types'

type Tab = 'overview' | 'tests' | 'runs' | 'deploys' | 'history'

const PAGE_COLUMNS = 'id, url, http_status, load_ms, error, status, analysis_error, score, metrics, checks, deep_status, deep, deep_error'

export function SiteDetail() {
  const { id } = useParams<{ id: string }>()
  const [site, setSite] = useState<Site | null>(null)
  const [tests, setTests] = useState<Test[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [pages, setPages] = useState<PageCheck[]>([])
  const [tab, setTab] = useState<Tab>('overview')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    const [siteRes, testsRes, runsRes, pagesRes] = await Promise.all([
      supabase.from('sites').select('*').eq('id', id).single().then((result) => {
        if (result.data) setSite(result.data)
        return result
      }),
      supabase.from('tests')
        .select('*, steps:test_steps(position, action, locators, value, note)')
        .eq('site_id', id)
        .order('created_at')
        .order('position', { referencedTable: 'test_steps' }),
      supabase.from('runs')
        .select('id, test_id, status, failure_kind, error, failed_step, screenshot_path, debug, duration_ms, created_at, test:tests!inner(name, site_id)')
        .eq('test.site_id', id)
        .order('created_at', { ascending: false })
        .limit(30),
      supabase.from('page_checks').select(PAGE_COLUMNS).eq('site_id', id).order('checked_at'),
    ])
    const firstError = siteRes.error ?? testsRes.error ?? runsRes.error ?? pagesRes.error
    if (firstError) setError(firstError.message)
    setSite(siteRes.data)
    setTests(testsRes.data ?? [])
    setRuns((runsRes.data as unknown as Run[]) ?? [])
    setPages((pagesRes.data as unknown as PageCheck[]) ?? [])
  }, [id])

  // Per-page results stream in one row at a time; refetch only the pages, not the whole site
  const loadPages = useCallback(async () => {
    if (!id) return
    const { data } = await supabase.from('page_checks').select(PAGE_COLUMNS).eq('site_id', id).order('checked_at')
    if (data) setPages(data as unknown as PageCheck[])
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  // RLS limits events to the user's own runs
  useEffect(() => {
    const channel = supabase.channel(`site-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'runs' }, () => load())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sites', filter: `id=eq.${id}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'page_checks', filter: `site_id=eq.${id}` }, () => loadPages())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [id, load, loadPages])

  const scanStatus = site?.scan_status

  // Poll active scans as a fallback when realtime delivery is unavailable.
  useEffect(() => {
    if (!id || !scanStatus || !['pending', 'scanning'].includes(scanStatus)) return
    let cancelled = false
    const timer = window.setInterval(async () => {
      const { data } = await supabase.from('sites').select('*').eq('id', id).single()
      if (!cancelled && data) setSite(data)
    }, 2000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [id, scanStatus])

  async function act(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    const { error } = await fn()
    if (error) setError(error.message)
    else load()
  }

  if (!site) return <p className="muted">{error ?? 'Loading…'}</p>

  const scanning = site.scan_status === 'pending' || site.scan_status === 'scanning'
  const o = site.overview
  const proposedCount = tests.filter((t) => t.status === 'proposed').length
  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'tests', label: 'Tests', count: tests.length - proposedCount || undefined },
    { id: 'runs', label: 'Runs', count: runs.length || undefined },
    { id: 'deploys', label: 'Deploys' },
    { id: 'history', label: 'History' },
  ]

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="site-head">
        <Favicon src={o?.icon} large />
        <div className="info">
          <h1 className="truncate">{o?.title ?? site.name ?? site.url}</h1>
          <a href={site.url} target="_blank" rel="noreferrer" className="muted small truncate" style={{ display: 'block' }}>{site.url}</a>
          <div className="chips">
            {o?.type && <span className="chip accent">{o.type}</span>}
            {o?.platforms.map((p) => <span key={p} className="chip">{p}</span>)}
            {o && !o.blocked && !scanning && <span className="chip">{o.pages_checked} {o.pages_checked === 1 ? 'page' : 'pages'} checked</span>}
            {site.scanned_at && !scanning && (
              <span className="chip">analyzed {new Date(site.scanned_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</span>
            )}
          </div>
        </div>
        {!scanning && (
          <button className="btn ghost sm" onClick={() => act(() => supabase.rpc('request_scan', { sid: site.id }))}>
            Analyze again
          </button>
        )}
        {o && !o.blocked && !scanning && <ScoreRing score={o.score} size={84} />}
      </div>
      {error && <p className="notice error">{error}</p>}

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
            {t.count != null && <span className="count">{t.count}</span>}
            {tab === t.id && <motion.div layoutId="tab-line" className="tab-line" />}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
          {tab === 'overview' && <OverviewTab site={site} pages={pages} onDeep={(pid: string) => act(() => supabase.rpc('request_page_deep', { pid }))} />}
          {tab === 'tests' && <TestsTab site={site} tests={tests} runs={runs} pages={pages} act={act} />}
          {tab === 'runs' && <RunsTab runs={runs} />}
          {tab === 'deploys' && <DeploysTab siteId={site.id} runs={runs} />}
          {tab === 'history' && <HistoryTab siteId={site.id} />}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  )
}
