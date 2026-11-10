import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react'
import { motion, useReducedMotion } from 'motion/react'
export type SchemaStep = { label: string; detail: string; action: string; status?: 'passed' | 'failed' | 'partial' | 'skipped' | 'unrecorded' | 'unknown' }

// Adapted from the supplied Graph example: SVG paths, positioned pins and measured path fills.
function pinStyle(pos: [number, number], vb: [number, number], width: number): CSSProperties {
  return { left: `${pos[0] / vb[0] * 100}%`, top: `${pos[1] / vb[1] * 100}%`, width: `${width}%` }
}
function roadFill(length: number, complete: boolean): CSSProperties {
  const total = length || 3000
  return { strokeDasharray: total, strokeDashoffset: complete ? 0 : total }
}
function StepGlyph({ action }: { action: string }) {
  const props = { width: 23, height: 23, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (/click|press/i.test(action)) return <svg {...props}><path d="m6 3 12 8-6 1-3 6-3-15Z" /><path d="m13 14 4 6" /></svg>
  if (/enter|fill/i.test(action)) return <svg {...props}><rect x="3" y="6" width="18" height="12" rx="3" /><path d="M7 10v4m3-2h7" /></svg>
  if (/check|confirm|expect/i.test(action)) return <svg {...props}><rect x="4" y="3" width="16" height="18" rx="3" /><path d="m8 12 3 3 5-6" /></svg>
  return <svg {...props}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 9h18m-14 5h6m-6 3h10" /></svg>
}
function decisionQuestion(action: string) {
  if (/open|navigate|goto/i.test(action)) return 'Did the page respond?'
  if (/click/i.test(action)) return 'Was the target clicked?'
  if (/enter|fill/i.test(action)) return 'Was the field filled?'
  if (/check|confirm|expect/i.test(action)) return 'Was the expected result found?'
  if (/dismiss/i.test(action)) return 'Did this step complete?'
  return 'Did this step succeed?'
}
export function FlowSchema({ steps, selected, onSelect }: { steps: SchemaStep[]; selected: number; onSelect: (index: number) => void }) {
  const [playing, setPlaying] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [lengths, setLengths] = useState<number[]>([])
  const [showBranches, setShowBranches] = useState(true)
  const board = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const id = useId().replace(/:/g, '')
  const reduced = useReducedMotion()
  const height = 175 + steps.length * 240
  const vb: [number, number] = [1000, height]
  const selectedStep = steps[selected]
  const edges = useMemo(() => steps.flatMap((step, i) => {
    const y = 170 + i * 240
    const previous = i === 0 ? 55 : y - 125
    return [
      { d: `M440 ${previous} V${y - 55}`, label: step.action, x: 550, y: (previous + y - 55) / 2, state: step.status === 'passed' ? 'passed' : step.status === 'failed' ? 'failed' : 'unknown', alternative: false },
      { d: `M440 ${y + 55} V${y + 85}`, label: '', x: 0, y: 0, state: step.status === 'passed' ? 'passed' : step.status === 'failed' ? 'failed' : 'unknown', alternative: false },
      { d: `M468 ${y + 115} C590 ${y + 115} 650 ${y + 115} 770 ${y + 115}`, label: 'No / stop', x: 615, y: y + 96, state: step.status === 'failed' ? 'failed' : 'unknown', alternative: true },
    ]
  }), [steps])
  useEffect(() => {
    setLengths(Array.from(svg.current?.querySelectorAll<SVGPathElement>('.branch-edge-measure') ?? []).map((path) => path.getTotalLength()))
  }, [steps.length])
  useEffect(() => {
    if (!playing || hovered || reduced) return
    if (selected >= steps.length - 1) { const end = window.setTimeout(() => setPlaying(false), 1700); return () => window.clearTimeout(end) }
    const timer = window.setTimeout(() => onSelect(selected + 1), 2500)
    return () => window.clearTimeout(timer)
  }, [playing, hovered, reduced, selected, steps.length, onSelect])
  useEffect(() => {
    if (playing) board.current?.querySelector<HTMLElement>(`[data-step="${selected}"]`)?.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'nearest', inline: 'nearest' })
  }, [selected, playing, reduced])
  function pick(index: number) { setPlaying(false); onSelect(index) }
  return <div className="branch-map">
    <header className="branch-toolbar"><div><span className="flow-state">Journey board</span><h3>Your flow, mapped out</h3></div><div className="branch-controls"><button className="btn ghost sm" aria-pressed={showBranches} onClick={() => setShowBranches(!showBranches)}>{showBranches ? 'Hide alternatives' : 'Show alternatives'}</button><button className="btn sm" disabled={!!reduced || !steps.length} onClick={() => { if (playing) setPlaying(false); else { onSelect(0); setPlaying(true) } }}>{playing ? 'Pause walkthrough' : 'Walk through steps'}</button></div></header>
    <p className="branch-subtitle">Real configuration and recorded results. The animation only explores this map.</p>
    <div className="branch-viewport" ref={board} tabIndex={0} aria-label="Scrollable flow board">
      <div className="branch-board" style={{ aspectRatio: `1000 / ${height}` }}>
        <svg ref={svg} className="branch-svg" viewBox={`0 0 1000 ${height}`} aria-hidden="true"><defs><marker id={`${id}-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="m2 1 6 4-6 4" fill="none" stroke="context-stroke" strokeWidth="1.5" /></marker></defs>
          {edges.map((edge, i) => (!edge.alternative || showBranches || edge.state === 'failed') && <g key={i}><path d={edge.d} className={`branch-dash branch-edge-measure ${edge.alternative ? 'alternative' : ''}`} markerEnd={`url(#${id}-arrow)`} />{edge.state !== 'unknown' && <path d={edge.d} className={`branch-flow ${edge.state}`} style={roadFill(lengths[i] ?? 0, true)} markerEnd={`url(#${id}-arrow)`} />}{edge.label && <text className="branch-edge-label" x={edge.x} y={edge.y}>{edge.label}</text>}</g>)}
          {!!steps.length && <path d={`M440 ${170 + (steps.length - 1) * 240 + 135} V${height - 45}`} className={`branch-dash ${steps.at(-1)?.status === 'passed' ? 'branch-last-passed' : ''}`} markerEnd={`url(#${id}-arrow)`} />}
        </svg>
        <div className="branch-start" style={pinStyle([440, 32], vb, 17)}><span>START</span><b>Fresh browser session</b></div>
        {steps.map((step, i) => {
          const y = 170 + i * 240
          const active = selected === i
          return <div className="branch-step-group" key={i}>
            <motion.button data-step={i} aria-pressed={active} className={`branch-pin tone-${i % 4} ${step.status ?? 'unknown'}${active ? ' active' : ''}`} style={{ ...pinStyle([440, y], vb, 25), x: '-50%', y: '-50%' }} onClick={() => pick(i)} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} animate={{ scale: active && !reduced ? 1.035 : 1 }} transition={{ duration: .2 }}>
              <span className="branch-pin-top"><span>STEP {String(i + 1).padStart(2, '0')}</span><span>{step.status === 'passed' ? <>&#10003; Passed</> : step.status === 'failed' ? '! Failed' : step.status === 'partial' ? 'Partly checked' : step.status === 'skipped' ? 'Not executed' : step.status === 'unrecorded' ? 'No evidence' : 'Configured'}</span></span>
              <span className="branch-pin-content"><span className="branch-pin-icon"><StepGlyph action={step.action} /></span><span><b>{step.label}</b><small>{step.detail}</small></span></span>
            </motion.button>
            <div className={`branch-decision ${step.status ?? 'unknown'}`} style={pinStyle([440, y + 115], vb, 20)}><span>{decisionQuestion(step.action)}</span></div>
            {(showBranches || step.status === 'failed') && <button className={`branch-stop${step.status === 'failed' ? ' observed' : ''}`} style={pinStyle([795, y + 115], vb, 22)} onClick={() => pick(i)}><span className="branch-mobile-no">No / stop</span><b>{step.status === 'failed' ? 'Stopped at this step' : 'Stop and report'}</b><small>{step.status === 'failed' ? 'Error observed / select for evidence' : 'On error only / not observed'}</small></button>}
            <span className="branch-continue" style={{ left:'32%',top:`${(y + 132) / height * 100}%` }}>{step.status === 'passed' ? 'Yes / observed' : step.status === 'partial' ? 'Not fully confirmed' : step.status === 'failed' || step.status === 'skipped' ? 'Not continued' : 'Yes / continue'}</span>
          </div>
        })}
        <div className="branch-end" style={pinStyle([440, height - 25], vb, 25)}>{steps.some((s) => s.status === 'failed') ? 'Run stopped / see recorded error' : steps.every((s) => s.status === 'passed') ? 'Recorded sequence complete' : 'End of configured sequence'}</div>
      </div>
    </div>
    <footer className="branch-inspector" aria-live="polite"><span className={`branch-inspector-mark ${selectedStep?.status ?? 'unknown'}`}>{String(selected + 1).padStart(2, '0')}</span><div><b>{selectedStep?.label}</b><p>{selectedStep?.action}{selectedStep?.detail ? ` / ${selectedStep.detail}` : ''}</p></div><span className="branch-inspector-state">{selectedStep?.status === 'passed' ? 'Recorded observation' : selectedStep?.status === 'failed' ? 'Recorded error' : selectedStep?.status === 'partial' ? 'Partial observation / review needed' : selectedStep?.status === 'skipped' ? 'Not executed / prior step failed' : selectedStep?.status === 'unrecorded' ? 'No recorded evidence' : 'Not confirmed by execution'}</span></footer>
    <div className="branch-legend"><span><i className="observed" />Observed result</span><span><i className="error" />Recorded error</span><span><i className="alternative" />Alternative / not executed</span></div>
    <p className="branch-footnote">Branches describe the monitor's continue-or-stop behavior, not inferred rules inside the website. Selecting a node does not execute an action.</p>
  </div>
}
