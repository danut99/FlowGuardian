import { readStepTimeout, writeStepNote } from '../../lib/stepTimeout'
import { StepSelectorEditor } from './StepSelectorEditor'
import { FlowSchema } from '../../components/FlowSchema'
import { flowGoal } from '../../lib/customerFlows'
import { TestAccount } from './TestAccount'
import { useTestAccount } from '../../lib/useTestAccount'
import { useEffect, useId, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { supabase } from '../../lib/supabase'
import type { Locator, PageCheck, Site, Test, TestKind } from '../../types'

type Action = 'goto' | 'dismiss' | 'click' | 'fill' | 'press' | 'expect_visible' | 'expect_text' | 'expect_url' | 'expect_count'
type Draft = { key: number; action: Action; locators: Locator[]; value: string; note?: string | null; timeout: number }

const ACTIONS: { action: Action; label: string; add: string; target: boolean; value: 'none' | 'required' | 'optional'; valueLabel?: string }[] = [
  { action: 'goto', label: 'Open page', add: 'Open a page', target: false, value: 'optional', valueLabel: 'Address (empty = home page)' },
  { action: 'click', label: 'Click on', add: 'Click', target: true, value: 'none' },
  { action: 'fill', label: 'Type into', add: 'Type text', target: true, value: 'required', valueLabel: 'Text to type' },
  { action: 'press', label: 'Press a key in', add: 'Press Enter', target: true, value: 'optional', valueLabel: 'Key (default Enter)' },
  { action: 'expect_visible', label: 'Check that it appears', add: 'Check an element', target: true, value: 'none' },
  { action: 'expect_text', label: 'Check the text', add: 'Check a text', target: false, value: 'required', valueLabel: 'Text that must appear' },
  { action: 'expect_url', label: 'Check the address', add: 'Check the address', target: false, value: 'required', valueLabel: 'Address must contain' },
  { action: 'expect_count', label: 'Count elements', add: 'Count elements', target: true, value: 'required', valueLabel: 'How many (e.g. 6, >=3)' },
  { action: 'dismiss', label: 'Close if it appears', add: 'Close a banner', target: true, value: 'none' },
]
const info = (a: Action) => ACTIONS.find((x) => x.action === a)!

const LOCATOR_TYPES: { type: string; label: string; hint: string }[] = [
  { type: 'role', label: 'Role + name', hint: 'Recommended: how a screen reader sees it, e.g. button “Add to cart”' },
  { type: 'text', label: 'Visible text', hint: 'The text shown on the element' },
  { type: 'label', label: 'Field label', hint: 'The text next to the field, e.g. “Email”' },
  { type: 'placeholder', label: 'Placeholder', hint: 'The grey text inside the field, e.g. “Search products…”' },
  { type: 'testid', label: 'data-testid', hint: 'For developers: the data-testid attribute' },
  { type: 'css', label: 'CSS (ID, class, name)', hint: '#element-id, .class-name, [name="email"]' },
]
const ROLES = ['button', 'link', 'textbox', 'searchbox', 'checkbox', 'combobox', 'heading', 'img', 'menuitem', 'tab', 'navigation', 'dialog']
const FREQUENCIES = [[15, '15 min'], [30, '30 min'], [60, '1 hour'], [360, '6 hours'], [1440, '1 day']] as const

let nextKey = 1
const draftOf = (action: Action, locators: Locator[] = [], value = '', note: string | null = null): Draft => ({ key: nextKey++, action, locators, value, note, timeout: readStepTimeout(note, action) })
const emptyLocator = (action: Action): Locator =>
  action === 'fill' ? { type: 'role', role: 'textbox', name: '' } : action === 'click' || action === 'dismiss' ? { type: 'role', role: 'button', name: '' } : { type: 'text', value: '' }
const locatorText = (l?: Locator) => (l ? (l.type === 'role' ? l.name : l.value) ?? '' : '')

function deriveKind(steps: Draft[]): TestKind {
  if (steps.some((s) => s.action === 'fill' && s.locators[0]?.role === 'searchbox')) return 'search'
  if (steps.some((s) => s.action === 'fill' || s.action === 'press')) return 'form'
  if (steps.some((s) => s.action === 'click')) return 'click'
  return 'content'
}

function validate(name: string, steps: Draft[], site: Site): string | null {
  if (!name.trim()) return 'Give the test a name.'
  if (!steps.length) return 'Add at least one step.'
  for (const [i, s] of steps.entries()) {
    const a = info(s.action)
    const n = `Step ${i + 1}`
    if (a.target && !s.locators.some((l) => locatorText(l).trim() || (l.type === 'role' && ['navigation', 'dialog'].includes(l.role ?? '')))) {
      return `${n}: say which element to act on.`
    }
    if (a.value === 'required' && !s.value.trim()) return `${n}: fill in “${a.valueLabel}”.`
    if (s.action === 'goto' && s.value.trim()) {
      try {
        if (!['https:', 'http:'].includes(new URL(s.value, site.url).protocol)) return `${n}: enter an HTTP or HTTPS address.`
      } catch { return `${n}: the address isn't valid.` }
    }
  }
  return null
}

export type TestDraft = { name: string; steps: { action: string; locators: Locator[]; value: string | null; note?: string | null }[] }

export function TestEditor({ site, test, draft, pages, onClose, onSaved, flowMode = false }: {
  flowMode?: boolean; site: Site; test: Test | null; draft?: TestDraft | null; pages: PageCheck[]; onClose: () => void; onSaved: () => void
}) {
  const [name, setName] = useState((flowMode ? test?.name.replace(/^\[Flow\] /, '') : test?.name) ?? draft?.name ?? '')
  const [goal, setGoal] = useState(test && flowMode ? flowGoal(test) : '')
  const [expectedText, setExpectedText] = useState(() => { const last = (test ?? draft)?.steps.at(-1); return last?.action === 'expect_text' ? last.value ?? '' : '' })
  const [searchQuery, setSearchQuery] = useState('')
  const [descriptionNotice, setDescriptionNotice] = useState('')
  const [generatedPreview, setGeneratedPreview] = useState(false)
  const [previewStep, setPreviewStep] = useState(0)
  const [editorTab, setEditorTab] = useState<'manual' | 'suggested'>(test ? 'manual' : 'suggested')
  const editorTabsId = useId()
  const [aiRequest, setAiRequest] = useState<string | null>(null)
  const [aiSending, setAiSending] = useState(false)
  useEffect(() => {
    if (!aiRequest) return
    let cancelled = false
    let checking = false
    const started = Date.now()
    const check = async () => {
      if (checking || cancelled) return
      checking = true
      try {
        const { data, error } = await supabase.from('ai_requests').select('status, reply, draft, error').eq('id', aiRequest).single()
        if (cancelled) return
        if (error) { setDescriptionNotice(error.message); setAiRequest(null); return }
        if (data.status === 'error') { setDescriptionNotice(data.error || 'AI generation failed.'); setAiRequest(null); return }
        if (data.status === 'done') {
          setAiRequest(null); setDescriptionNotice(data.reply || 'Review the AI draft before verifying.')
          if (data.draft?.steps?.length) {
            setSteps(data.draft.steps.map((s: TestDraft['steps'][number]) => draftOf(s.action as Action, s.locators, s.value ?? '', s.note ?? null)))
            setName(data.draft.name); setAuthorized(false); setGeneratedPreview(true); setPreviewStep(0); setEditorTab('suggested')
          }
        } else if (Date.now() - started > 180000) { setDescriptionNotice('AI is taking longer than expected. Your existing steps are unchanged; try again later.'); setAiRequest(null) }
      } finally { checking = false }
    }
    check()
    const timer = window.setInterval(check, 2500)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [aiRequest])
  async function generateAiDescription() {
    if (!goal.trim()) { setDescriptionNotice('Describe the journey you want to check.'); return }
    if ((test || generatedPreview) && !window.confirm('Replace the current draft steps with a new AI draft?')) return
    setAiSending(true); setDescriptionNotice('AI is preparing proposed steps from your description and the detected site controls. No interactions are executed.')
    try {
      const prompt = '[FLOW_DRAFT]' + goal.trim() + (expectedText.trim() ? '\nExpected visible text: ' + expectedText.trim() : '') + (searchQuery.trim() ? '\nSearch term: ' + searchQuery.trim() : '')
      const { data, error } = await supabase.rpc('ask_ai', { sid: site.id, purl: null, msg: prompt })
      if (error) { setDescriptionNotice(error.message); return }
      setAiRequest(data)
    } catch { setDescriptionNotice('Could not request an AI draft. Try again.') }
    finally { setAiSending(false) }
  }
  async function generateDescription() {
    if (!goal.trim()) { setDescriptionNotice('Describe the journey first.'); return }
    if ((test || generatedPreview) && !window.confirm('Replace the draft with freshly detected steps?')) return
    setAiSending(true); setDescriptionNotice('Inspecting the website in a fresh browser session, without AI...')
    try {
      const {data,error} = await supabase.rpc('ask_ai', {sid:site.id,purl:null,msg:'[FLOW_DISCOVER]'+JSON.stringify({prompt:goal,expected:expectedText,query:searchQuery})})
      if (error) setDescriptionNotice(error.message); else setAiRequest(data)
    } catch {setDescriptionNotice('Could not start browser discovery.')}
    finally {setAiSending(false)}
  }
  const [freq, setFreq] = useState(test?.frequency_minutes ?? 1440)
  const [steps, setSteps] = useState<Draft[]>(() => (test ?? draft)
    ? (test ?? draft)!.steps.map((s) => draftOf(s.action as Action, s.locators, s.value ?? '', s.note ?? null))
    : flowMode ? [] : [draftOf('goto')])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [authorized, setAuthorized] = useState(false)
  const [additionalOrigins] = useState(() => (test ?? draft)?.steps.find(s => s.action === 'goto')?.locators.find(l => l.type === 'flow_config')?.allowed_origins?.join('\n') ?? '')
  const account = useTestAccount(flowMode ? test?.id : undefined)
  const paths = [...new Set(pages.map((p) => { const u = new URL(p.url); return u.pathname + u.search }))]

  const update = (key: number, patch: Partial<Draft>) => setSteps((s) => s.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  const move = (i: number, d: number) => setSteps((s) => {
    const n = [...s]
    ;[n[i], n[i + d]] = [n[i + d], n[i]]
    return n
  })
  const add = (action: Action) => setSteps((s) => [...s, draftOf(action, info(action).target ? [emptyLocator(action)] : [])])

  async function save(run: boolean) {
    let origins: string[]
    try {
      origins = [...new Set(additionalOrigins.split(/[\n,]+/).map(s => s.trim()).filter(Boolean))]
      if (origins.length > 5 || origins.some(value => { const u = new URL(value); return u.protocol !== 'https:' || u.origin !== value || !!u.username || !!u.password })) throw new Error()
    } catch { return setError('Enter up to five exact HTTPS origins, such as https://account.example.com, without paths.') }
    const problem = validate(name, steps, site)
    if (problem) return setError(problem)
    if (flowMode && (!steps.at(-1)?.action.startsWith('expect_') || !steps.some((s) => ['goto', 'click', 'fill', 'press'].includes(s.action)))) return setError('A flow needs a navigation or interaction step and a final expected-result check.')
    if (flowMode && run && !site.verified_at) return setError('Verify site ownership before running a flow. You can save it paused.')
    if (flowMode && steps.at(-1)?.action === 'expect_url' && ['/', ''].includes(steps.at(-1)!.value.trim())) return setError('Choose a specific destination URL as the expected result, not just /.')
    if (flowMode && !authorized) return setError('Review the steps and confirm the permitted interactions first.')
    const usesAccount = steps.some(step => ['{{test.username}}', '{{test.password}}'].includes(step.value))
    if (flowMode && !account.remove && Boolean(account.username) !== Boolean(account.password)) return setError('Provide both the test username and password to replace the saved account.')
    if (flowMode && usesAccount && run && (!account.ready || account.loading)) return setError('Provide a dedicated test account before verifying this flow.')
    setBusy(true)
    setError(null)
    const firstGoto = steps.find((s) => s.action === 'goto')?.value.trim()
    if (flowMode) {
      // test_steps.note is limited to 160 characters. Keep the revision prefix intact.
      const revisionPrefix = 'Flow v1|' + new Date().toISOString() + '|'
      const revisionNote = writeStepNote(goal.trim(), steps[0]?.timeout ?? 30000, revisionPrefix)
      const flowSteps = steps.map((s, i) => ({ action: s.action, locators: s.action === 'goto' ? [{type:'flow_config',allowed_origins:origins}] : s.locators.slice(0, 1).map((l) => ({ ...l, exact: true, strict: true })), value: s.value.trim() || null, note: i === 0 ? revisionNote : writeStepNote(s.note, s.timeout) }))
      let flowId: string
      if (test) {
        const { error: pauseError } = await supabase.from('tests').update({ enabled: false, status: 'paused' }).eq('id', test.id)
        if (pauseError) { setBusy(false); return setError(pauseError.message) }
        const { data: pending, error: pendingError } = await supabase.from('runs').select('id').eq('test_id', test.id).in('status', ['queued', 'running']).limit(1)
        if (pendingError || pending?.length) { setBusy(false); onSaved(); return setError(pendingError?.message ?? 'Monitoring is paused. Wait for the current run to finish before saving changes.') }
        const { data: savedId, error: saveError } = await supabase.rpc('save_test', { sid: site.id, tid: test.id, tname: '[Flow] ' + name.trim(), tkind: deriveKind(steps), freq, purl: firstGoto ? new URL(firstGoto, site.url).href : site.url, steps: flowSteps })
        if (saveError) { setBusy(false); onSaved(); return setError(saveError.message) }
        flowId = savedId
      } else {
        const { data, error: createError } = await supabase.from('tests').insert({ site_id: site.id, name: '[Flow] ' + name.trim(), kind: deriveKind(steps), status: 'paused', enabled: false, frequency_minutes: freq, page_url: firstGoto ? new URL(firstGoto, site.url).href : site.url }).select('id').single()
        if (createError) { setBusy(false); return setError(createError.message) }
        flowId = data.id
        const { error: stepError } = await supabase.from('test_steps').insert(flowSteps.map((s, i) => ({ ...s, test_id: flowId, position: i + 1 })))
        if (stepError) { await supabase.from('tests').delete().eq('id', flowId); setBusy(false); return setError(stepError.message) }
      }
      try { await account.persist(flowId) }
      catch (error) {
        if (!test) await supabase.from('tests').delete().eq('id', flowId)
        setBusy(false); onSaved(); return setError(error instanceof Error ? error.message : 'The test account could not be saved.')
      }
      if (run) {
        const { error: runError } = await supabase.from('runs').insert({ test_id: flowId })
        if (runError) { setBusy(false); onSaved(); return setError('Flow saved paused. Verification was not queued: ' + runError.message) }
      }
      setBusy(false); onSaved(); onClose(); return
    }
    const { data: id, error } = await supabase.rpc('save_test', {
      sid: site.id,
      tid: test?.id ?? null,
      tname: name.trim(),
      tkind: deriveKind(steps),
      freq,
      purl: firstGoto ? new URL(firstGoto, site.url).href : null,
      steps: steps.map((s) => ({
        action: s.action,
        locators: s.locators.filter((l) => locatorText(l).trim() || l.type === 'role'),
        value: s.value.trim() || null,
        note: writeStepNote(s.note, s.timeout),
      })),
    })
    if (!error && run) await supabase.from('runs').insert({ test_id: id })
    setBusy(false)
    if (error) return setError(error.message)
    onSaved()
    onClose()
  }

  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div className="modal card" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Test editor">
        <div className="row">
          <h2 style={{ margin: 0 }}>{flowMode ? 'Configure customer flow' : test ? 'Edit test' : 'New test'}</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {flowMode && <details className="flow-account-options"><summary>Test account (only for journeys that sign in)</summary><TestAccount account={account} /></details>}
        {flowMode && <div className="flow-editor-tabs" role="tablist" aria-label="Flow building method">{(['manual', 'suggested'] as const).map(tab => <button type="button" key={tab} role="tab" id={`${editorTabsId}-${tab}-tab`} aria-controls={`${editorTabsId}-${tab}-panel`} aria-selected={editorTab === tab} tabIndex={editorTab === tab ? 0 : -1} onClick={() => setEditorTab(tab)} onKeyDown={e => { if (['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 'manual' : e.key === 'End' ? 'suggested' : tab === 'manual' ? 'suggested' : 'manual'; setEditorTab(next); document.getElementById(`${editorTabsId}-${next}-tab`)?.focus() } }}>{tab === 'manual' ? 'Build manually' : 'Suggested flow'}</button>)}</div>}
        <div hidden={flowMode && editorTab !== 'suggested'} role={flowMode ? 'tabpanel' : undefined} id={`${editorTabsId}-suggested-panel`} aria-labelledby={flowMode ? `${editorTabsId}-suggested-tab` : undefined}>
        {flowMode && <section className="flow-description-builder"><h3>Describe what should work</h3><label>Your journey<textarea rows={3} maxLength={1000} value={goal} onChange={e => setGoal(e.target.value)} placeholder='For example: open Contact and check that the email and message fields are visible. Or search for a product and check its result.' /></label><p className="muted small">We inspect public pages in a fresh browser session first, without AI. If these cannot describe your journey, you can choose AI assistance. AI sends your description and detected controls to our provider. Never include passwords.</p><label>Expected visible text (optional for checks of detected controls)<input value={expectedText} onChange={e => setExpectedText(e.target.value)} placeholder="For example: Search results or Message sent" /></label>{/search|(?:caut|c?ut)[^.!?]{0,30}(?:produs|product|query|termen)/i.test(goal) && <label>Search term<input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="For example: thailand" /></label>}<button type="button" className="btn" disabled={aiSending || !!aiRequest} onClick={generateDescription}>{"Prepare from detected controls"}</button>{descriptionNotice && <><p role="status" className="notice">{descriptionNotice}</p><button type="button" className="btn ghost sm" disabled={aiSending || !!aiRequest} onClick={generateAiDescription}>{aiSending || aiRequest ? "Preparing AI draft..." : "Use AI for this description"}</button></>}{steps.length > 0 && <FlowSchema steps={steps.map(s => ({ label: info(s.action).label, action: info(s.action).label, detail: s.action === 'fill' && s.value.startsWith('{{test.') ? 'Use the saved test account' : s.locators[0]?.name || s.locators[0]?.value || s.value, status: 'unknown' }))} selected={previewStep} onSelect={setPreviewStep} />}
          <div className="suggested-draft-steps"><h3>{test ? 'Saved steps / current draft' : 'Current draft steps'}</h3><p className="muted small">These are the steps currently in the editor. Generating again replaces them only after confirmation.</p><ol>{steps.map((s, i) => <li key={s.key}><div className="section-head"><div><b>{i + 1}. {info(s.action).label}</b><p className="muted small">{s.locators[0]?.name || s.locators[0]?.value || (s.action === 'fill' ? 'Test input' : s.value)}</p></div><button type="button" className="btn ghost sm" onClick={() => { setPreviewStep(i); setEditorTab('manual'); window.setTimeout(() => document.getElementById(`${editorTabsId}-step-${s.key}`)?.scrollIntoView({block:'center',behavior:'smooth'}), 0) }}>Edit step</button></div><label>Wait up to (seconds)<input type="number" min={1} max={60} value={s.timeout / 1000} onChange={e => { update(s.key, {timeout: Math.max(1, Math.min(60, Number(e.target.value) || 1)) * 1000}); setAuthorized(false) }} /><span className="muted small">Continue as soon as this step succeeds.</span></label>{info(s.action).target && <StepSelectorEditor site={site} pageUrl={steps.slice(0, i + 1).findLast(step => step.action === 'goto')?.value || site.url} action={s.action} current={s.locators[0]} onApply={locator => { update(s.key, {locators:[locator]}); setAuthorized(false) }} />}</li>)}</ol></div>
          <button type="button" className="btn ghost sm" onClick={() => setEditorTab('manual')}>Edit these steps manually</button></section>}
        </div>
        <div className="editor-grid">
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="E.g. Search finds products" /></label>
          <label>Run
            <select value={freq} onChange={(e) => setFreq(Number(e.target.value))}>
              {FREQUENCIES.map(([v, l]) => <option key={v} value={v}>every {l}</option>)}
            </select>
          </label>
        </div>

        <div hidden={flowMode && editorTab !== 'manual'} role={flowMode ? 'tabpanel' : undefined} id={`${editorTabsId}-manual-panel`} aria-labelledby={flowMode ? `${editorTabsId}-manual-tab` : undefined}>
        {flowMode && <p className="muted small">Build each browser action and expected result. Target elements by role and accessible name, visible text, field label, placeholder, test ID, or CSS: #element-id, .class-name, [name="email"]. Switching tabs keeps this same draft.</p>}
        {flowMode && !steps.length && <p className="notice">No steps yet. Add your first action below, or describe the journey in Suggested flow.</p>}
        <ol className="editor-steps">
          <AnimatePresence initial={false}>
            {steps.map((s, i) => (
              <motion.li key={s.key} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }} className="editor-step" id={`${editorTabsId}-step-${s.key}`}>
                <span className="editor-n">{i + 1}</span>
                <div className="editor-body">
                  <select value={s.action} onChange={(e) => {
                    const action = e.target.value as Action
                    update(s.key, { action, locators: info(action).target ? (s.locators.length ? s.locators : [emptyLocator(action)]) : [] })
                  }}>
                    {ACTIONS.map((a) => <option key={a.action} value={a.action}>{a.label}</option>)}
                  </select>
                  {info(s.action).target && (
                    <><LocatorList strict={flowMode} locators={flowMode ? s.locators.slice(0, 1) : s.locators} onChange={(locators) => { update(s.key, { locators }); setAuthorized(false) }} />{flowMode && <StepSelectorEditor site={site} pageUrl={steps.slice(0, i + 1).findLast(step => step.action === 'goto')?.value || site.url} action={s.action} current={s.locators[0]} onApply={locator => { update(s.key, { locators: [locator] }); setAuthorized(false) }} />}</>
                  )}
                  {info(s.action).value !== 'none' && (
                    <>
                      {flowMode && s.action === 'fill' && <select aria-label={`Value source for step ${i + 1}`} value={['{{test.username}}', '{{test.password}}'].includes(s.value) ? s.value : 'literal'} onChange={event => update(s.key, { value: event.target.value === 'literal' ? '' : event.target.value })}>
                        <option value="literal">Text value</option><option value={'{{test.username}}'}>Test username</option><option value={'{{test.password}}'}>Test password</option>
                      </select>}
                      {!['{{test.username}}', '{{test.password}}'].includes(s.value) &&
                      <input
                        placeholder={info(s.action).valueLabel} value={s.value}
                        list={s.action === 'goto' ? 'editor-paths' : undefined}
                        onChange={(e) => update(s.key, { value: e.target.value })}
                      />
                      }
                    </>
                  )}
                  <label>Wait up to (seconds)<input type="number" min={1} max={60} value={s.timeout / 1000} onChange={e => { update(s.key, {timeout: Math.max(1, Math.min(60, Number(e.target.value) || 1)) * 1000}); setAuthorized(false) }} /><span className="muted small">Maximum wait, not a fixed pause.</span></label>
                </div>
                <div className="editor-tools">
                  <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">↑</button>
                  <button className="icon-btn" disabled={i === steps.length - 1} onClick={() => move(i, 1)} title="Move down">↓</button>
                  <button className="icon-btn" onClick={() => setSteps((x) => x.filter((y) => y.key !== s.key))} title="Delete step">✕</button>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
        <datalist id="editor-paths">{paths.map((p) => <option key={p} value={p} />)}</datalist>

        <div className="editor-add">
          {ACTIONS.map((a) => <button key={a.action} className="chip" onClick={() => add(a.action)}>+ {a.add}</button>)}
        </div>

        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Forms are submitted when the reviewed steps include a “Click on” step for the submit button or an Enter key submission. Check steps are what make the test useful:
          without them, the test only confirms that the elements exist.
        </p>
        {flowMode && <label className="flow-permission"><input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} /> I reviewed every step and authorize these interactions using test data. Do not add real purchases, destructive actions or real customer submissions. Only the final on-page assertion is verified; email delivery and fulfillment are not.</label>}
        {error && <p className="notice error" style={{ margin: 0 }}>{error}</p>}

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <div className="actions">
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn ghost" disabled={busy} onClick={() => save(false)}>{flowMode ? 'Save paused' : 'Save'}</button>
            <button className="btn" disabled={busy} onClick={() => save(true)}>{busy ? <span className="spinner" /> : null} {flowMode ? 'Save and verify' : 'Save and run'}</button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

// First locator is tried first; the others are fallbacks if the page changes
function LocatorList({ locators, onChange, strict = false }: { strict?: boolean; locators: Locator[]; onChange: (l: Locator[]) => void }) {
  const set = (i: number, l: Locator) => onChange(locators.map((x, j) => (j === i ? l : x)))
  return (
    <div className="locators">
      {locators.map((l, i) => {
        const t = LOCATOR_TYPES.find((x) => x.type === l.type)
        return (
          <div key={i} className="locator-row">
            {i > 0 && <span className="muted small">or</span>}
            <select value={l.type} title={t?.hint} onChange={(e) => {
              const type = e.target.value
              set(i, type === 'role' ? { type, role: 'button', name: locatorText(l) } : { type, value: locatorText(l) })
            }} style={{ width: 150 }}>
              {LOCATOR_TYPES.map((x) => <option key={x.type} value={x.type}>{x.label}</option>)}
            </select>
            {l.type === 'role' && (
              <select value={l.role} onChange={(e) => set(i, { ...l, role: e.target.value })} style={{ width: 120 }}>
                {ROLES.map((r) => <option key={r}>{r}</option>)}
              </select>
            )}
            <input
              className={l.type === 'css' || l.type === 'testid' ? 'mono' : undefined}
              placeholder={t?.hint} value={locatorText(l)}
              onChange={(e) => set(i, l.type === 'role' ? { ...l, name: e.target.value } : { ...l, value: e.target.value })}
            />
            {locators.length > 1 && <button className="icon-btn" onClick={() => onChange(locators.filter((_, j) => j !== i))} title="Delete">✕</button>}
          </div>
        )
      })}
      {!strict && locators.length < 4 && (
        <button className="fold" onClick={() => onChange([...locators, { type: 'css', value: '' }])}>+ fallback (in case the page changes)</button>
      )}
    </div>
  )
}
