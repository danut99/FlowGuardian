import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { fadeUp, stagger } from '../../components/motion'
import { TEST_HELP } from '../../components/checkHelp'
import { supabase } from '../../lib/supabase'
import { outcomeLabel, FailureDetails } from './FailureDetails'
import { ExportButton } from './ExportButton'
import { TestEditor } from './TestEditor'
import type { TestDraft } from './TestEditor'
import { AiAssistant } from './AiAssistant'
import type { Locator, PageCheck, Run, Site, Test, TestStep } from '../../types'

type Act = (fn: () => PromiseLike<{ error: { message: string } | null }>) => void

// Built-in health checks run worker code, so only step-based tests are editable
const editable = (t: Test) => !t.essential_key && t.steps.every((s) => s.action !== 'check')

const KIND: Record<Test['kind'], string> = {
  search: 'Search', interaction: 'Interaction', content: 'Content', form: 'Form',
  click: 'Navigation', page_load: 'Availability', health: 'Automatic check',
}

const ROLE_LABEL: Record<string, string> = { navigation: 'the menu', contentinfo: 'the page footer', dialog: 'the dialog' }

function targetLabel(l?: Locator) {
  if (!l) return ''
  if (l.type === 'role' && !l.name && l.role) return ROLE_LABEL[l.role] ?? l.role
  if (l.type === 'role' && l.role === 'heading') return `the heading “${l.name}”`
  if (l.type === 'css') return 'the open section'
  return `“${l.name ?? l.value}”`
}

function describeStep(s: TestStep) {
  if (s.note) return s.note
  const target = targetLabel(s.locators[0])
  switch (s.action) {
    case 'goto': return s.value ? `Open ${new URL(s.value, 'https://x').pathname}` : 'Open the page'
    case 'check': return 'Automatic check'
    case 'dismiss': return `Close the cookie banner (${target}), if it appears`
    case 'click': return `Click ${target}`
    case 'fill': return `Type “${s.value}” into ${target}`
    case 'press': return `Press the ${s.value ?? 'Enter'} key`
    case 'expect_url': return `Check that ${s.value} opens`
    case 'expect_visible': return `Check that ${target} appears`
    case 'expect_text': return `Check for the text “${s.value}”`
    case 'expect_count': return `Check that there are ${s.value} elements`
    default: return s.action
  }
}

function pageLabel(url: string | null | undefined, site: Site) {
  if (!url || url === site.url) return 'Home page'
  const u = new URL(url)
  return u.pathname === '/' ? 'Home page' : u.pathname + u.search
}

function frequency(min: number) {
  if (min % 1440 === 0) return min === 1440 ? 'daily' : `every ${min / 1440} days`
  if (min % 60 === 0) return min === 60 ? 'hourly' : `every ${min / 60} hours`
  return `every ${min} min`
}

function ago(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  if (min < 1440) return `${Math.round(min / 60)} h ago`
  const days = Math.round(min / 1440)
  return `${days} ${days === 1 ? 'day' : 'days'} ago`
}

const isFail = (r?: Run) => r?.status === 'failed' || r?.status === 'error'
const isBusy = (r?: Run) => r?.status === 'queued' || r?.status === 'running'

function History({ runs }: { runs: Run[] }) {
  const last = runs.slice(0, 10).reverse()
  if (!last.length) return <span className="muted small">no runs yet</span>
  return (
    <div className="history" title="Latest runs (newest on the right)">
      {last.map((r) => (
        <span key={r.id} className={`hdot ${r.status}`} title={`${new Date(r.created_at).toLocaleString('en-GB')}`} />
      ))}
    </div>
  )
}

function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9.5" /><path d="M12 11v6M12 7.5h.01" />
    </svg>
  )
}

function PlayIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z" /></svg>
}

export function TestsTab({ site, tests, runs, pages, act }: { site: Site; tests: Test[]; runs: Run[]; pages: PageCheck[]; act: Act }) {
  const [target, setTarget] = useState(site.url)
  const [editing, setEditing] = useState<Test | 'new' | null>(null)
  const [aiDraft, setAiDraft] = useState<TestDraft | null>(null)
  const edit = (t: Test) => (editable(t) ? () => setEditing(t) : undefined)
  const runsOf = (t: Test) => runs.filter((r) => r.test_id === t.id)
  const lastDone = (t: Test) => runsOf(t).find((r) => !isBusy(r))
  const active = tests.filter((t) => t.status !== 'proposed')
  const proposed = tests.filter((t) => t.status === 'proposed')
  const failing = active.filter((t) => isFail(lastDone(t)))
  const passing = active.filter((t) => lastDone(t)?.status === 'passed')
  const busy = active.some((t) => isBusy(runsOf(t)[0]))
  const lastCheck = runs.find((r) => !isBusy(r))
  const suggesting = site.suggest_status === 'pending' || site.suggest_status === 'running'
  const runAll = () => act(() => supabase.from('runs').insert(active.map((t) => ({ test_id: t.id }))))

  // Failing first so problems are never buried below green tiles
  const monitored = [...active].sort((a, b) => Number(isFail(lastDone(b))) - Number(isFail(lastDone(a))))
  const pageOptions = [site.url, ...new Set(pages.map((p) => p.url).filter((u) => u !== site.url))]
  const byPage = new Map<string, Test[]>()
  for (const t of proposed) {
    const key = t.page_url ?? site.url
    byPage.set(key, [...(byPage.get(key) ?? []), t])
  }

  return (
    <motion.div variants={stagger} initial="hidden" animate="show">
      <AnimatePresence>
        {editing && (
          <TestEditor site={site} test={editing === 'new' ? null : editing} pages={pages}
            onClose={() => setEditing(null)} onSaved={() => act(() => Promise.resolve({ error: null }))} />
        )}
        {aiDraft && (
          <TestEditor site={site} test={null} draft={aiDraft} pages={pages}
            onClose={() => setAiDraft(null)} onSaved={() => act(() => Promise.resolve({ error: null }))} />
        )}
      </AnimatePresence>
      <motion.div variants={fadeUp} className={`card status-hero ${failing.length ? 'bad' : 'good'}`}>
        <div className="status-mark">
          {failing.length ? (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 7v6M12 17h.01" /></svg>
          ) : (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
          )}
        </div>
        <div className="info">
          <h2 style={{ margin: 0 }}>
            {!active.length ? 'Setting up monitoring' : failing.length
              ? `${failing.length} ${failing.length === 1 ? 'check needs' : 'checks need'} attention`
              : busy && !passing.length ? 'Checking the site…' : 'Everything works'}
          </h2>
          <p className="muted" style={{ margin: '0.2rem 0 0' }}>
            {active.length
              ? <>{passing.length} of {active.length} tests passing{lastCheck && <> · last check {ago(lastCheck.created_at)}</>}</>
              : 'Automatic tests appear after the first scan of the site.'}
          </p>
        </div>
        {active.length > 0 && (
          <motion.button className="btn ghost" disabled={busy} whileTap={{ scale: 0.97 }} onClick={runAll}>
            {busy ? <><span className="spinner" /> Running…</> : <><PlayIcon /> Check everything now</>}
          </motion.button>
        )}
      </motion.div>

      <motion.div variants={fadeUp} className="how">
        {[
          ['1', 'We check automatically', 'On a schedule, like a real visitor.'],
          ['2', 'We alert you', 'Only when something breaks.'],
          ['3', 'We show you what to fix', 'With a screenshot and steps.'],
        ].map(([n, t, d]) => (
          <div key={n} className="how-step"><span className="how-n">{n}</span><div><b>{t}</b><div className="muted small">{d}</div></div></div>
        ))}
      </motion.div>

      <AnimatePresence>
        {failing.length > 0 && (
          <motion.section initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <h2>Needs attention</h2>
            <div className="list">
              {failing.map((t) => <AttentionCard key={t.id} test={t} run={lastDone(t)!} act={act} />)}
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {active.length > 0 && (
        <section>
          <div className="section-head">
            <div>
              <h2>Automatic monitoring</h2>
              <p className="muted small">These run on their own. Click ⓘ to see what each one checks.</p>
            </div>
            <div className="actions">
              <ExportButton site={site} tests={active} />
              <button className="btn ghost sm" onClick={() => setEditing('new')}>+ New test</button>
            </div>
          </div>
          <motion.div className="tile-grid" variants={stagger}>
            {monitored.map((t) => <TestTile key={t.id} test={t} runs={runsOf(t)} page={t.page_url && t.page_url !== site.url ? pageLabel(t.page_url, site) : null} act={act} onEdit={edit(t)} />)}
          </motion.div>
        </section>
      )}

      <section>
        <AiAssistant
          site={site} pageOptions={pageOptions} pageLabel={(u) => pageLabel(u, site)}
          onEdit={setAiDraft} onSaved={() => act(() => Promise.resolve({ error: null }))}
        />
      </section>

      <section>
        <motion.div variants={fadeUp} className="card finder">
          <h2 style={{ margin: 0 }}>Tests for a specific page</h2>
          <p className="muted" style={{ margin: '0.3rem 0 0.8rem' }}>
            Pick a page. We open it, try what can be used on it and only suggest the tests that work.
          </p>
          <div className="finder-kinds">
            {[
              ['Search', 'type and search'],
              ['Interaction', 'menus, dialogs, buttons'],
              ['Content', 'heading, menu, footer'],
              ['Form', 'filling in, no submitting'],
              ['Navigation', 'the important links'],
            ].map(([k, d]) => <span key={k} className="chip"><b>{k}</b>&nbsp;· {d}</span>)}
          </div>
          <div className="finder-row">
            <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={suggesting}>
              {pageOptions.map((u) => <option key={u} value={u}>{pageLabel(u, site)}</option>)}
            </select>
            <motion.button
              className="btn" disabled={suggesting} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              onClick={() => act(() => supabase.rpc('request_suggestions', { sid: site.id, page_url: target === site.url ? null : target }))}
            >
              {suggesting ? <><span className="spinner" /> Analyzing {pageLabel(site.suggest_url, site)}…</> : 'Find tests'}
            </motion.button>
          </div>
          {suggesting && <p className="muted small" style={{ margin: '0.6rem 0 0' }}>Takes between 15 seconds and a minute — we really try every button.</p>}
          {site.suggest_status === 'error' && <p className="notice error">Couldn't analyze the page: {site.suggest_error}</p>}
        </motion.div>

        <AnimatePresence>
          {[...byPage].map(([url, list]) => (
            <motion.div key={url} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} style={{ marginTop: '1.25rem' }}>
              <div className="section-head">
                <div>
                  <h2>Suggestions for {pageLabel(url, site)} <span className="count">{list.length}</span></h2>
                  <p className="muted small">Try them once if you like, then choose what we monitor.</p>
                </div>
              </div>
              <ul className="list"><AnimatePresence>{list.map((t) => <ProposalCard key={t.id} test={t} runs={runsOf(t)} act={act} onEdit={edit(t)} />)}</AnimatePresence></ul>
            </motion.div>
          ))}
        </AnimatePresence>
        {site.suggest_status === 'done' && proposed.length === 0 && (
          <p className="muted" style={{ marginTop: '1rem' }}>No pending suggestions. Pick another page to find more tests.</p>
        )}
      </section>
    </motion.div>
  )
}

function AttentionCard({ test, run, act }: { test: Test; run: Run; act: Act }) {
  const help = test.essential_key ? TEST_HELP[test.essential_key] : null
  const failedStep = test.steps.length > 1 ? test.steps.find((s) => s.position === run.failed_step) : undefined
  return (
    <motion.div layout variants={fadeUp} className="card attention">
      <div className="row">
        <div style={{ minWidth: 0 }}>
          <div className="title">{test.name}</div>
          <div className="muted small">
            {outcomeLabel(run)} · {ago(run.created_at)}
          </div>
        </div>
        <button className="btn sm" onClick={() => act(() => supabase.from('runs').insert({ test_id: test.id }))}>
          <PlayIcon /> Check again
        </button>
      </div>
      {help && run.debug?.outcome === 'confirmed' && (
        <div className="explain">
          <p><b>What we check:</b> {help.what}</p>
          <p><b>How to fix:</b> {help.fix}</p>
        </div>
      )}
      <FailureDetails run={run} stepLabel={failedStep && describeStep(failedStep)} />
    </motion.div>
  )
}

function TestTile({ test, runs, page, act, onEdit }: { test: Test; runs: Run[]; page: string | null; act: Act; onEdit?: () => void }) {
  const [info, setInfo] = useState(false)
  const latest = runs[0]
  const done = runs.find((r) => !isBusy(r))
  const state = isBusy(latest) ? 'running' : !done ? 'idle' : isFail(done) ? 'fail' : 'pass'
  const help = test.essential_key ? TEST_HELP[test.essential_key] : null
  return (
    <motion.div layout variants={fadeUp} className={`card tile ${state}`}>
      <div className="tile-head">
        <span className={`sdot ${state}`} />
        <div className="title" style={{ flex: 1, minWidth: 0 }}>{test.name}</div>
        {onEdit && (
          <button className="info-btn" onClick={onEdit} aria-label="Edit test" title="Edit test">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z" /></svg>
          </button>
        )}
        <button className={`info-btn${info ? ' on' : ''}`} onClick={() => setInfo(!info)} aria-label="What the test checks" title="What the test checks">
          <InfoIcon />
        </button>
      </div>
      <div className="muted small">
        {!test.essential_key && <span className={`kind kind-${test.kind}`}>{KIND[test.kind]}</span>}
        {page && <span className="chip" style={{ marginRight: '0.35rem' }}>{page}</span>}
        {done && !isBusy(latest) && <span>{outcomeLabel(done)} · </span>}
        {state === 'running' ? 'Running now…' : done ? `Checked ${ago(done.created_at)}` : 'Not run yet'} · {frequency(test.frequency_minutes)}
        {test.status === 'paused' && ' · paused'}
      </div>
      <AnimatePresence initial={false}>
        {info && (
          <motion.div className="help" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            {help ? <p>{help.what}</p> : (
              <ol className="steps" style={{ marginTop: '0.5rem' }}>{test.steps.map((s) => <li key={s.position}>{describeStep(s)}</li>)}</ol>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="tile-foot">
        <History runs={runs} />
        <button className="icon-btn" disabled={state === 'running'} title="Run now"
          onClick={() => act(() => supabase.from('runs').insert({ test_id: test.id }))}>
          <PlayIcon />
        </button>
      </div>
    </motion.div>
  )
}

function ProposalCard({ test, runs, act, onEdit }: { test: Test; runs: Run[]; act: Act; onEdit?: () => void }) {
  const tried = runs[0]
  return (
    <motion.li layout variants={fadeUp} initial="hidden" animate="show" exit={{ opacity: 0, x: -20 }} className="card">
      <div className="row">
        <div style={{ minWidth: 0 }}>
          <span className={`kind kind-${test.kind}`}>{KIND[test.kind]}</span>
          <div className="title" style={{ marginTop: '0.35rem' }}>{test.name}</div>
          <div className="muted small">
            {tried ? (isBusy(tried) ? 'Trying…' : tried.status === 'passed' ? 'Tried: works ✓' : 'Tried: didn\'t work') : 'Not tried yet'}
          </div>
        </div>
        <div className="actions">
          <button className="btn ghost sm" disabled={isBusy(tried)} onClick={() => act(() => supabase.from('runs').insert({ test_id: test.id }))}>
            Try once
          </button>
          {onEdit && <button className="btn ghost sm" onClick={onEdit}>Edit</button>}
          <button className="btn sm" onClick={() => act(() => supabase.from('tests').update({ status: 'approved' }).eq('id', test.id))}>
            Monitor
          </button>
          <button className="btn ghost sm" onClick={() => act(() => supabase.from('tests').delete().eq('id', test.id))}>
            Not needed
          </button>
        </div>
      </div>
      <ol className="steps">{test.steps.map((s) => <li key={s.position}>{describeStep(s)}</li>)}</ol>
      {tried && isFail(tried) && <FailureDetails run={tried} />}
    </motion.li>
  )
}
