import { FlowSchema } from '../../components/FlowSchema'
import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { Run, Test, TestStep } from '../../types'

const LABEL: Record<string, string> = { goto: 'Open a page', click: 'Click an element', fill: 'Enter test data', press: 'Press a key', dismiss: 'Dismiss if present', expect_url: 'Check the destination', expect_visible: 'Check visibility', expect_text: 'Check the content', expect_count: 'Check the count' }
function instruction(step: TestStep) {
  const locator = step.locators[0]
  const target = locator?.name ?? locator?.value ?? 'the configured element'
  if (step.action === 'goto') return `Open ${step.value || 'the home page'} in the browser.`
  if (step.action === 'click') return `Click the ${locator?.role ?? 'element'} named "${target}".`
  if (step.action === 'fill') return `Enter the configured test value into "${target}".`
  if (step.action === 'press') return `Press ${step.value || 'Enter'} in "${target}".`
  if (step.action === 'dismiss') return `Close "${target}" only if it appears.`
  if (step.action === 'expect_url') return `Confirm the page address contains "${step.value}".`
  if (step.action === 'expect_text') return `Confirm "${step.value}" is visible on the page.`
  if (step.action === 'expect_count') return `Confirm the configured elements match the count ${step.value}.`
  return `Confirm "${target}" is visible.`
}
export function FlowJourney({ flow, run }: { flow: Test; run?: Run }) {
  const [selection, setSelection] = useState<{ runId?: string; index: number } | null>(null)
  const [view, setView] = useState<{ runId?: string; mode: 'configuration' | 'execution' } | null>(null)
  const hasTrace = !!run?.debug?.step_trace?.length
  const showRun = hasTrace && (view?.runId !== run?.id || view?.mode !== 'configuration')
  const failedIndex = flow.steps.findIndex(s => s.position === run?.failed_step)
  const selected = selection && selection.runId === run?.id ? selection.index : showRun && failedIndex >= 0 ? failedIndex : 0
  const setSelected = (index: number) => setSelection({ runId: run?.id, index })
  const reduced = useReducedMotion()
  const index = Math.min(selected, Math.max(0, flow.steps.length - 1))
  const step = flow.steps[index]
  if (!step) return <p className="muted">No steps configured yet.</p>
  const trace = run?.debug?.step_trace?.find((t) => t.position === step.position)
  const target = step.locators[0]
  return <div>
    <div className="flow-detail-intro"><div><b>{showRun ? 'What actually happened' : 'The journey, step by step'}</b><div className="muted small">{showRun ? 'Recorded evidence from the latest run of this version.' : 'Saved configuration. This preview does not execute your website.'}</div></div>
      {!!run?.debug?.step_trace?.length && <button className="btn ghost sm" onClick={() => setView({ runId: run?.id, mode: showRun ? 'configuration' : 'execution' })}>{showRun ? 'View configuration' : 'View last execution'}</button>}
    </div>
    <FlowSchema selected={index} onSelect={setSelected} steps={flow.steps.map((s) => {
      const recorded = showRun ? run?.debug?.step_trace?.find((t) => t.position === s.position) : undefined
      const status = recorded?.status === 'passed' ? 'passed' : recorded?.status === 'failed' ? 'failed' : showRun && run?.failed_step != null && s.position > run.failed_step ? 'skipped' : showRun ? 'unrecorded' : 'unknown'
      const name = s.locators[0]?.name ?? s.locators[0]?.value
      return { label: s.action.startsWith('expect_') ? name ? `Verify ${name}` : LABEL[s.action] ?? 'Expected result' : s.action === 'goto' ? 'Open starting page' : name ?? 'Next state', detail: s.action === 'fill' ? 'Configured test input' : name && s.action.startsWith('expect_') ? `Find the exact ${s.locators[0]?.type ?? 'element'}` : s.value ?? s.locators[0]?.role ?? '', action: LABEL[s.action] ?? s.action, status }
    })} />
    <div className="flow-stepper">
      <div className="flow-step-list" aria-label="Flow steps">{flow.steps.map((s, i) => <button key={s.position} className={`flow-step-button ${showRun ? run?.debug?.step_trace?.find(t => t.position === s.position)?.status ?? 'unrecorded' : ''}`} aria-pressed={i === index} onClick={() => setSelected(i)}><span>{showRun && run?.debug?.step_trace?.find(t => t.position === s.position)?.status === 'passed' ? '\u2713' : showRun && run?.debug?.step_trace?.find(t => t.position === s.position)?.status === 'failed' ? '!' : String(i + 1).padStart(2, '0')}</span>{LABEL[s.action] ?? s.action}</button>)}</div>
      <AnimatePresence mode="wait" initial={false}><motion.div key={`${index}-${showRun}`} className={`flow-step-stage ${showRun ? trace?.status ?? 'unrecorded' : ''}`} initial={{ opacity: 0, y: reduced ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -5 }} transition={{ duration: reduced ? 0 : .18 }} aria-live="polite">
        <div className="flow-step-kicker">Step {index + 1} of {flow.steps.length} / {showRun ? trace?.status ?? (run?.failed_step != null && step.position > run.failed_step ? 'Not executed / earlier step failed' : 'No execution evidence') : step.action.startsWith('expect_') ? 'Expected outcome' : 'Configured action'}</div>
        <h4>{LABEL[step.action] ?? step.action}</h4><p className="muted">{instruction(step)}</p>
        {target && <code>{target.role ? `${target.role}: ` : `${target.type}: `}{target.name ?? target.value}</code>}
        {step.action === 'goto' && <code>{step.value || 'Home page'}</code>}
        {showRun ? <div className={`flow-step-outcome ${trace?.status ?? 'unrecorded'}`}>{trace ? <><b>{trace.status === 'passed' ? 'Completed in this run' : 'Stopped here'}</b><p>{trace.url}</p><p>{trace.duration_ms} ms{trace.error ? ` / ${trace.error}` : ''}</p></> : 'No execution recorded for this step. Steps after a failure are not run.'}</div> : step.action.startsWith('expect_') && <div className="flow-step-outcome">This condition must pass before the flow can be verified. On-page confirmation does not establish email delivery, payment or fulfillment.</div>}
        <div className="actions" style={{ marginTop: '1.2rem' }}><button className="btn ghost sm" disabled={index === 0} onClick={() => setSelected(index - 1)}>Previous</button><button className="btn ghost sm" disabled={index === flow.steps.length - 1} onClick={() => setSelected(index + 1)}>Next step</button></div>
      </motion.div></AnimatePresence>
    </div>
  </div>
}
