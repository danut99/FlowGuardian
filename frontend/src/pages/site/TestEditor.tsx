import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { supabase } from '../../lib/supabase'
import type { Locator, PageCheck, Site, Test, TestKind } from '../../types'

type Action = 'goto' | 'dismiss' | 'click' | 'fill' | 'press' | 'expect_visible' | 'expect_text' | 'expect_url' | 'expect_count'
type Draft = { key: number; action: Action; locators: Locator[]; value: string; note?: string | null }

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
  { type: 'css', label: 'CSS selector', hint: 'For developers, e.g. #add-to-cart' },
]
const ROLES = ['button', 'link', 'textbox', 'searchbox', 'checkbox', 'combobox', 'heading', 'img', 'menuitem', 'tab', 'navigation', 'dialog']
const FREQUENCIES = [[15, '15 min'], [30, '30 min'], [60, '1 hour'], [360, '6 hours'], [1440, '1 day']] as const

let nextKey = 1
const draftOf = (action: Action, locators: Locator[] = [], value = '', note: string | null = null): Draft => ({ key: nextKey++, action, locators, value, note })
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
        if (new URL(s.value, site.url).host !== new URL(site.url).host) return `${n}: we can only open pages on ${new URL(site.url).host}.`
      } catch { return `${n}: the address isn't valid.` }
    }
  }
  return null
}

export type TestDraft = { name: string; steps: { action: string; locators: Locator[]; value: string | null; note?: string | null }[] }

export function TestEditor({ site, test, draft, pages, onClose, onSaved }: {
  site: Site; test: Test | null; draft?: TestDraft | null; pages: PageCheck[]; onClose: () => void; onSaved: () => void
}) {
  const [name, setName] = useState(test?.name ?? draft?.name ?? '')
  const [freq, setFreq] = useState(test?.frequency_minutes ?? 60)
  const [steps, setSteps] = useState<Draft[]>(() => (test ?? draft)
    ? (test ?? draft)!.steps.map((s) => draftOf(s.action as Action, s.locators, s.value ?? '', s.note ?? null))
    : [draftOf('goto')])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const paths = [...new Set(pages.map((p) => { const u = new URL(p.url); return u.pathname + u.search }))]

  const update = (key: number, patch: Partial<Draft>) => setSteps((s) => s.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  const move = (i: number, d: number) => setSteps((s) => {
    const n = [...s]
    ;[n[i], n[i + d]] = [n[i + d], n[i]]
    return n
  })
  const add = (action: Action) => setSteps((s) => [...s, draftOf(action, info(action).target ? [emptyLocator(action)] : [])])

  async function save(run: boolean) {
    const problem = validate(name, steps, site)
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    const firstGoto = steps.find((s) => s.action === 'goto')?.value.trim()
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
        note: s.note ?? null,
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
          <h2 style={{ margin: 0 }}>{test ? 'Edit test' : 'New test'}</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="editor-grid">
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="E.g. Search finds products" /></label>
          <label>Run
            <select value={freq} onChange={(e) => setFreq(Number(e.target.value))}>
              {FREQUENCIES.map(([v, l]) => <option key={v} value={v}>every {l}</option>)}
            </select>
          </label>
        </div>

        <ol className="editor-steps">
          <AnimatePresence initial={false}>
            {steps.map((s, i) => (
              <motion.li key={s.key} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }} className="editor-step">
                <span className="editor-n">{i + 1}</span>
                <div className="editor-body">
                  <select value={s.action} onChange={(e) => {
                    const action = e.target.value as Action
                    update(s.key, { action, locators: info(action).target ? (s.locators.length ? s.locators : [emptyLocator(action)]) : [] })
                  }}>
                    {ACTIONS.map((a) => <option key={a.action} value={a.action}>{a.label}</option>)}
                  </select>
                  {info(s.action).target && (
                    <LocatorList locators={s.locators} onChange={(locators) => update(s.key, { locators })} />
                  )}
                  {info(s.action).value !== 'none' && (
                    <>
                      <input
                        placeholder={info(s.action).valueLabel} value={s.value}
                        list={s.action === 'goto' ? 'editor-paths' : undefined}
                        onChange={(e) => update(s.key, { value: e.target.value })}
                      />
                    </>
                  )}
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

        <p className="muted small" style={{ margin: 0 }}>
          Forms are only submitted if you add a “Click on” step for the submit button yourself. Check steps are what make the test useful:
          without them, the test only confirms that the elements exist.
        </p>
        {error && <p className="notice error" style={{ margin: 0 }}>{error}</p>}

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <div className="actions">
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn ghost" disabled={busy} onClick={() => save(false)}>Save</button>
            <button className="btn" disabled={busy} onClick={() => save(true)}>{busy ? <span className="spinner" /> : null} Save and run</button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

// First locator is tried first; the others are fallbacks if the page changes
function LocatorList({ locators, onChange }: { locators: Locator[]; onChange: (l: Locator[]) => void }) {
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
      {locators.length < 4 && (
        <button className="fold" onClick={() => onChange([...locators, { type: 'css', value: '' }])}>+ fallback (in case the page changes)</button>
      )}
    </div>
  )
}
