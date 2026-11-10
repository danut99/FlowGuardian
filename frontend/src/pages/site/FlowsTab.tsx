import { PublicFlowsReport } from '../PublicFlowsReport'
import { AnimatePresence, motion } from 'motion/react'
import { FlowJourney } from './FlowJourney'
import { FailureDetails } from './FailureDetails'
import { isCustomerFlow, currentFlowRuns, flowGoal, canMonitorDiscovered, discoveredFlowSteps } from '../../lib/customerFlows'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { TestEditor } from './TestEditor'
import type { TestDraft } from './TestEditor'
import type { FlowCandidate, PageCheck, Run, Site, Test } from '../../types'



export function FlowsTab({ site, tests, runs, pages, reload }: { site: Site; tests: Test[]; runs: Run[]; pages: PageCheck[]; reload: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [draft, setDraft] = useState<TestDraft | null>(null)
  const [editing, setEditing] = useState<Test | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const flows = tests.filter(isCustomerFlow)
  const discovering = ['pending', 'scanning'].includes(site.scan_status) && !site.overview?.audit_requested
  useEffect(() => {
    if (!flows.length) return
    const timer = window.setInterval(reload, 4000)
    return () => window.clearInterval(timer)
  }, [flows.length, reload])

  function configure(candidate?: FlowCandidate) {
    setEditing(null)
    const steps: TestDraft['steps'] = [{ action: 'goto', locators: [], value: candidate?.target_url ?? site.url, note: 'Open the discovered interaction page' }]
    if (candidate?.entry_action) steps.push({ action: 'click', locators: [{ type: 'role', role: candidate.entry_action.role, name: candidate.entry_action.name }], value: null, note: 'Open the observed entry screen' })
    for (const field of candidate?.observed_controls?.fields ?? []) {
      if (!field.label) continue
      steps.push({ action: 'expect_visible', locators: [{ type: 'label', value: field.label }], value: null, note: `Check the observed ${field.label} field` })
    }
    for (const button of candidate?.observed_controls?.buttons ?? []) {
      steps.push({ action: 'expect_visible', locators: [{ type: 'role', role: 'button', name: button }], value: null, note: 'Check the observed button without clicking it' })
    }
    if (steps.length === 1) steps.push({ action: 'expect_url', locators: [], value: candidate?.target_url ? new URL(candidate.target_url).pathname : '', note: 'Add the interaction and its expected result before monitoring' })
    setDraft({ name: candidate?.name ?? '', steps })
  }
  async function monitorDiscovered(candidate: FlowCandidate) {
    if (!site.verified_at) { setError('Verify site ownership before activating monitoring.'); return }
    if (!canMonitorDiscovered(candidate, site.url)) { setError('The discovery check is incomplete or older than 30 minutes. Discover again or configure and verify.'); return }
    if (!window.confirm('Monitor this checked path once a day? Only the recorded entry navigation and visible controls will be checked. No credentials or submissions are included.')) return
    setBusy(true); setError('')
    let createdId: string | undefined
    try {
      const steps = discoveredFlowSteps(candidate, site.url)
      const signature = (items: { action: string; value: string | null; locators: Test['steps'][number]['locators'] }[]) => JSON.stringify(items.map(s => ({ action: s.action, value: s.value, locators: s.locators.map(l => ({ type: l.type, role: l.role, name: l.name, value: l.value })) })))
      const existing = flows.find(f => signature(f.steps) === signature(steps))
      if (existing) {
        const { error } = await supabase.from('tests').update({ enabled: true, status: 'approved', frequency_minutes: 1440 }).eq('id', existing.id)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('tests').insert({ site_id: site.id, name: '[Flow] ' + candidate.name, kind: 'interaction', enabled: false, status: 'paused', frequency_minutes: 1440, page_url: steps[0].value }).select('id').single()
        if (error) throw error
        createdId = data.id
        const { error: stepError } = await supabase.from('test_steps').insert(steps.map((s, i) => ({ ...s, test_id: data.id, position: i + 1, note: i === 0 ? 'Flow v1|' + new Date().toISOString() + '|Adopted from recorded discovery' : null })))
        if (stepError) throw stepError
        const { error: enableError } = await supabase.from('tests').update({ enabled: true, status: 'approved', frequency_minutes: 1440 }).eq('id', data.id)
        if (enableError) throw enableError
        createdId = undefined
      }
      reload()
    } catch (e) {
      if (createdId) await supabase.from('tests').delete().eq('id', createdId)
      setError(e instanceof Error ? e.message : (e as { message?: string })?.message ?? 'Monitoring could not be enabled.')
    } finally { setBusy(false) }
  }
  async function update(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true); setError('')
    try { const { error } = await fn(); if (error) setError(error.message); else reload() }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed') }
    finally { setBusy(false) }
  }
  return <div className="flows-report">
    <section className="card flow-intro"><div><span className="chip accent">Customer flow report</span><h2>Can customers finish what they came to do?</h2><p className="muted">See the paths already checked on your site, inspect the recorded steps and choose what to monitor. Edit only when you want a different journey.</p></div><button className="btn" onClick={() => configure()}>Create flow</button></section>
    {error && <p className="notice error">{error}</p>}
    {!site.verified_at && <p className="notice">Verify site ownership before executing a flow. You can prepare and save it paused.</p>}
    {flows.length > 0 && <>
    <section><h3>Your flows</h3>{!flows.length && <p className="muted">No flows configured. Start with a suggestion or create your own.</p>}
      {flows.map((flow, flowIndex) => {
        const history = currentFlowRuns(flow, runs)
        const last = history[0]
        const lastPassed = history.find(run => run.status === 'passed')
        const verified = last?.status === 'passed'
        const active = flow.enabled && flow.status === 'approved'
        const pending = last && ['queued', 'running'].includes(last.status)
        const open = expanded === flow.id
        return <motion.article layout className="card flow-saved" key={flow.id}>
          <div className="flow-card-header"><button className="flow-card-open" aria-expanded={open} aria-controls={`flow-detail-${flow.id}`} onClick={() => setExpanded(open ? null : flow.id)}>
            <span className="flow-card-number">{String(flowIndex + 1).padStart(2, '0')}</span>
            <span className="flow-card-title"><b>{flow.name.slice(7)}</b><small>{flow.steps.length} steps / {flow.frequency_minutes === 1440 ? 'daily' : `every ${flow.frequency_minutes} min`}{last ? ` / last run ${last.status}` : flowGoal(flow) === 'Adopted from recorded discovery' ? ' / discovery checked / first scheduled run pending' : ' / not yet executed'}</small><small className={`flow-last-pass${lastPassed ? ' recorded' : ''}`}>{lastPassed ? <>Last successful check: <time dateTime={lastPassed.created_at}>{new Date(lastPassed.created_at).toLocaleString()}</time></> : 'No successful check recorded for this version yet.'}</small></span>
            <span className="chip">{active ? 'Monitoring' : pending ? 'Verifying' : verified ? 'Verified / paused' : 'Needs verification'}</span>
            <motion.span className="flow-card-arrow" animate={{ rotate: open ? 90 : 0 }} aria-hidden="true">&rsaquo;</motion.span>
          </button>
          <div className="flow-card-quick-actions">
            <button type="button" className="btn ghost sm" disabled={busy || pending} aria-label={`Edit ${flow.name.slice(7)}`} onClick={() => { setEditing(flow); setDraft({ name: flow.name.slice(7), steps: flow.steps }) }}>Edit</button>
            <button type="button" className="btn ghost sm flow-delete-button" disabled={busy || pending} aria-label={`Delete ${flow.name.slice(7)}`} onClick={() => {
              if (window.confirm(`Delete "${flow.name.slice(7)}"? Its saved steps, run history and saved test account will be removed. This cannot be undone.`)) update(() => supabase.from('tests').delete().eq('id', flow.id).eq('site_id', site.id))
            }}>Delete</button>
          </div></div>
          <AnimatePresence initial={false}>{open && <motion.div id={`flow-detail-${flow.id}`} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: .22 }} style={{ overflow: 'hidden' }}><div className="flow-detail">
          {flowGoal(flow) && <p>{flowGoal(flow)}</p>}
          <FlowJourney flow={flow} run={last} />
          <p className="muted small">Expected result: {flow.steps.at(-1)?.action.replaceAll('_', ' ')} {flow.steps.at(-1)?.value ?? flow.steps.at(-1)?.locators[0]?.name}. Only this on-page condition is checked.</p>
          {last?.status === 'passed' && last.debug?.attempts?.some((a) => !a.passed) && <p className="muted small">Passed after a retry; an earlier attempt failed. Review attempt evidence in Runs.</p>}
          {last && <p className="small">Last run: {last.status}{last.failed_step ? ` / stopped at step ${last.failed_step}` : ''} {last.error}</p>}
          <div className="flow-detail-actions"><button className="btn ghost sm" disabled={busy || pending} onClick={() => { setEditing(flow); setDraft({ name: flow.name.slice(7), steps: flow.steps }) }}>Edit flow</button><button className="btn ghost sm" disabled={busy || pending || !site.verified_at} onClick={() => update(() => supabase.from('runs').insert({ test_id: flow.id }))}>Verify flow</button>
          {active ? <button className="btn ghost sm" disabled={busy} onClick={() => update(() => supabase.from('tests').update({ enabled: false, status: 'paused' }).eq('id', flow.id))}>Pause monitoring</button> : <button className="btn sm" disabled={busy || !verified || !site.verified_at} onClick={() => { if (window.confirm('Confirm the verification result and enable these exact steps once a day?')) update(() => supabase.from('tests').update({ enabled: true, status: 'approved', frequency_minutes: 1440 }).eq('id', flow.id)) }}>Enable / daily</button>}</div>
          {last?.debug?.step_trace && <details className="flow-run-trace"><summary>Steps executed / reproduce this run</summary><ol>{last.debug.step_trace.map((step) => <li key={step.position}><b>{step.status} / Step {step.position}: {step.action.replaceAll('_', ' ')}</b> {step.target} {step.value}<div className="muted small">{step.url} / {step.duration_ms} ms</div>{step.error && <p className="notice error">{step.error}</p>}</li>)}</ol><p className="muted small">Repeat these steps in a fresh browser with your configured test data. Entered field values are redacted in this execution log. Steps after a failure were not executed.</p></details>}
          {last && ['failed', 'error'].includes(last.status) && <FailureDetails run={last} />}
          <p className="muted small">Editing pauses monitoring. Previous runs remain in history, but cannot verify an edited flow.</p>
        </div></motion.div>}</AnimatePresence>
        </motion.article>
      })}
    </section>
    </>}
    <section><div className="section-head"><h3>Checked during discovery</h3><button className="btn ghost sm" disabled={['pending', 'scanning'].includes(site.scan_status) || busy} onClick={() => update(() => supabase.from('sites').update({ scan_status: 'pending', scan_error: null }).eq('id', site.id))}>{discovering ? 'Discovering...' : 'Discover again'}</button></div>
      <p className="muted small">The same recorded paths shown in the public report. Open a card to see exactly what ran. Monitoring requires site ownership and your explicit activation.</p>
      {site.scan_status === 'error' && <p className="notice error">Discovery did not finish: {site.scan_error}</p>}
      <PublicFlowsReport embedded title={site.name ?? site.url} candidates={site.overview?.flow_candidates ?? []} pending={discovering} onConfigure={configure} onMonitor={monitorDiscovered} canMonitor={c => !!site.verified_at && canMonitorDiscovered(c, site.url)} busy={busy} />
    </section>
    {draft && <TestEditor flowMode site={site} test={editing} draft={draft} pages={pages} onClose={() => setDraft(null)} onSaved={reload} />}
  </div>
}
