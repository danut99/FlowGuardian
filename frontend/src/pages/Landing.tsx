import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, MotionConfig, useReducedMotion, useInView, useScroll, useSpring, useTransform } from 'motion/react'
import { normalizeUrl, pendingSite } from '../lib/plan'
import { supabase } from '../lib/supabase'
import './landing.css'

const YEAR = new Date().getFullYear()

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{diagonal ? <path d="M6 18 18 6M6 6h12v12" /> : <path d="M4 12h16m-6-6 6 6-6 6" />}</svg>
}
function Check() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
}
function FeatureIcon({ type }: { type: 'route' | 'evidence' | 'shield' }) {
  return <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{type === 'route' ? <><circle cx="5" cy="5" r="2" /><circle cx="19" cy="19" r="2" /><path d="M7 5h8a4 4 0 0 1 0 8H9a4 4 0 0 0 0 8h8" /></> : type === 'evidence' ? <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 9h18m-13 5h3m-3 3h8" /></> : <><path d="m12 3 8 3v6c0 4-3 7-8 9-5-2-8-5-8-9V6z" /><path d="m8 12 3 3 5-6" /></>}</svg>
}

export function BrandMark() {
  return <span className="brand-mark"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></svg></span>
}

function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <motion.div className={className} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.1 }} transition={{ duration: 0.5 }}>{children}</motion.div>
}

function UrlForm({ id }: { id: string }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const parsed = normalizeUrl(url)
    if (!parsed) return setError('Enter a website address, like my-store.com.')
    setError(null)
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('request_public_scan', { site_url: parsed.origin })
      if (error) { setError(error.message); return }
      if (!data) { setError('We could not start discovery. Please try again.'); return }
      pendingSite.set(parsed.origin + '/')
      navigate(`/check/${data}`)
    } catch {
      setError('We could not connect. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  return <div className="lp-form-wrap">
    <p className="lp-discovery-promise">Start with your URL. Explore up to 3 suggested journeys on a step-by-step board, with recorded browser observations.</p>
    <form className="lp-url-form" onSubmit={submit} aria-busy={busy}>
      <label htmlFor={id} className="lp-sr-only">Your website address</label>
      <span className="lp-input-icon" aria-hidden="true">www.</span>
      <input id={id} placeholder="your-website.com" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={url} onChange={(e) => { setUrl(e.target.value); setError(null) }} required aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} />
      <button type="submit" className="lp-button" disabled={busy}>{busy ? 'Discovering...' : 'Discover my flows'}<Arrow /></button>
    </form>
    <details className="lp-discovery-scope"><summary>What happens when I run discovery?</summary><p>We open public pages, inspect visible controls and may click entry buttons. Where supported, we try a product-derived search query and check matching results. We may also check browser-side form validation. Discovery does not send contact messages, sign in, create accounts or complete purchases. Suggestions can be incomplete; the report shows what was actually observed.</p></details>
    {error && <p className="lp-form-error" id={`${id}-error`} role="alert">{error}</p>}
  </div>
}

function ProductPreview() {
  const reduced = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const visible = useInView(ref, { amount: 0.2 })
  const [paused, setPaused] = useState(false)
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (paused || reduced || !visible) return
    const timer = window.setInterval(() => setFrame((value) => (value + 1) % 7), 1400)
    return () => window.clearInterval(timer)
  }, [paused, reduced, visible])
  const current = reduced ? 3 : frame
  const stopped = current >= 3
  const nodes = [
    { title: 'Open the website', subtitle: 'Home page is reachable', kind: 'home' },
    { title: 'Follow the journey', subtitle: 'Click the Contact link', kind: 'click' },
    { title: 'Verify the result', subtitle: stopped ? 'Expected form did not appear' : 'Look for the contact form', kind: 'result' },
  ]
  return <div ref={ref} className={`fg-theatre ${paused ? 'is-paused' : ''} ${stopped ? 'has-stopped' : ''}`}>
    <div className="fg-theatre-grid" aria-hidden="true" />
    <div className="fg-theatre-top"><span><span className="fg-signal" />THE FLOW, UNDER WATCH</span><span className="fg-example-tag">Animated illustration</span></div>
    <div className="fg-theatre-heading"><div><span>CONTACT FORM JOURNEY</span><h3>A page being up is only the beginning.</h3></div><div className="fg-last-good"><Check /><span>Last recorded pass<b>09:00</b></span></div></div>
    <div className="fg-flow-stage">
      <div className="fg-flow-wire" aria-hidden="true"><motion.span animate={{ width: `${Math.min(current + 1, 3) / 3 * 100}%` }} transition={{ duration: reduced ? 0 : 1.1 }} /></div>
      {nodes.map((node, i) => {
        const done = current > i
        const failed = i === 2 && stopped
        const active = current === i
        return <div key={node.kind} className={`fg-flow-node ${active ? 'is-active' : ''} ${done ? 'is-done' : ''} ${failed ? 'is-failed' : ''}`}>
          <div className="fg-node-top"><span>0{i + 1}</span><span>{failed ? 'STOPPED' : done ? 'PASSED' : active ? 'CHECKING' : 'NEXT STEP'}</span></div>
          <div className={`fg-node-visual fg-visual-${node.kind}`} aria-hidden="true">
            {node.kind === 'home' ? <div className="fg-mini-site"><div><i /><i /><i /></div><span /><span /><b /><div className="fg-mini-tiles"><i /><i /><i /></div></div> : node.kind === 'click' ? <div className="fg-contact-target"><span>Home</span><b>Contact<svg className={current >= 1 ? 'fg-cursor is-clicking' : 'fg-cursor'} width="29" height="34" viewBox="0 0 29 34" fill="none"><path d="m4 3 21 17-11 1-5 10z" fill="#e1edbb" stroke="#274536" strokeWidth="2" /></svg></b></div> : <div className="fg-form-target">{failed ? <><span className="fg-missing-icon">!</span><b>Form not found</b><small>Step 3 needs review</small></> : <><span className="fg-form-line" /><span className="fg-form-line" /><span className="fg-form-submit" /><i className="fg-scan-line" /></>}</div>}
          </div>
          <h4>{node.title}</h4><p>{node.subtitle}</p>
          <span className="fg-node-anchor">{failed ? '!' : done ? <Check /> : <i />}</span>
        </div>
      })}
    </div>
    <div className="fg-theatre-bottom"><div className="fg-run-caption"><span className={stopped ? 'fg-result-dot is-amber' : 'fg-result-dot'} /><div><b>{stopped ? '10:00 / Flow stopped at step 3' : '10:00 / Checking the current website'}</b><span>{stopped ? 'An earlier check passed. This later check did not. Review the evidence.' : 'The same approved steps. Repeated on your schedule.'}</span></div></div><div className="fg-theatre-actions"><button type="button" onClick={() => { setFrame(0); setPaused(false) }} disabled={Boolean(reduced)}>Replay <span aria-hidden="true">&#8635;</span></button><button type="button" aria-pressed={paused} onClick={() => setPaused(!paused)} disabled={Boolean(reduced)}>{reduced ? 'Motion reduced' : paused ? 'Resume' : 'Pause'}</button></div></div>
    <div className="fg-theatre-footnote">Illustrative results and times. Scheduled checks inspect the current site; past results do not restore old versions.</div>
  </div>
}

function ScrollProgress() {
  const { scrollYProgress } = useScroll()
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30 })
  return <motion.div className="lp-scroll-progress" style={{ scaleX: progress }} aria-hidden="true" />
}

const CADENCES = [
  { minutes: 15, number: '15', unit: 'minutes', label: '15 min' },
  { minutes: 30, number: '30', unit: 'minutes', label: '30 min' },
  { minutes: 60, number: '1', unit: 'hour', label: '1 hour' },
  { minutes: 360, number: '6', unit: 'hours', label: '6 hours' },
  { minutes: 1440, number: '1', unit: 'day', label: '1 day' },
]
function timeAt(minutes: number) {
  return `${minutes >= 1440 ? `+${Math.floor(minutes / 1440)}d ` : ''}${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function RoutineChapter() {
  const [cadenceIndex, setCadenceIndex] = useState(4)
  const [preview, setPreview] = useState(-1)
  const reduced = useReducedMotion()
  const cadence = CADENCES[cadenceIndex]
  const dialRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress: dialProgress } = useScroll({ target: dialRef, offset: ['start end', 'end start'] })
  const dialRotation = useTransform(dialProgress, [0, 1], [-22, 22])
  const running = preview >= 0 && preview < 3
  useEffect(() => {
    if (!running) return
    const timer = window.setTimeout(() => setPreview(value => value + 1), 850)
    return () => window.clearTimeout(timer)
  }, [preview, running])
  return <section id="how" className="atelier-routine" aria-labelledby="routine-title">
    <div className="lp-container">
      <div className="atelier-chapter-line"><span>02 / MAKE IT A ROUTINE</span><span>YOU CHOOSE THE JOURNEY. WE REPEAT THE STEPS.</span></div>
      <div className="atelier-routine-layout">
        <div className="atelier-routine-copy"><Reveal><h2 id="routine-title">Your time.<br /><em>Better spent.</em></h2><p>Not opening the same page. Not clicking the same button. Not wondering whether yesterday's working form still works.</p></Reveal>
          <div className="atelier-saved-flow"><span>ONE APPROVED FLOW</span><h3>Can someone reach my contact form?</h3><ol>{['Open your home page', 'Follow the Contact link', 'Expect the form to appear'].map((step, i) => <li key={step} className={preview === i ? 'is-checking' : preview > i ? 'is-checked' : ''}><span>{preview > i ? <Check /> : `0${i + 1}`}</span><b>{step}</b><small>{preview === i ? 'Checking' : preview > i ? 'Passed' : i === 2 ? 'Success condition' : 'Browser step'}</small></li>)}</ol><div className="atelier-flow-caption"><FeatureIcon type="shield" /><p>Use a freshly checked eligible path to start monitoring, or edit the steps and verify your changes first. You choose the expected result.</p></div></div>
        </div>
        <div ref={dialRef} className="atelier-cadence" aria-label="Interactive example schedule">
          <div className={`atelier-dial ${running ? 'is-running' : ''}`}>
            <motion.svg style={{ rotate: reduced ? 0 : dialRotation }} className="atelier-dial-art" viewBox="0 0 440 440" fill="none" aria-hidden="true"><circle cx="220" cy="220" r="201" stroke="currentColor" strokeOpacity=".13" /><circle cx="220" cy="220" r="184" stroke="currentColor" strokeOpacity=".2" strokeDasharray="1 8" strokeWidth="8" /><motion.circle cx="220" cy="220" r="166" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="1043" animate={{ strokeDashoffset: 1043 - (cadenceIndex + 1) / 5 * 1043 }} transition={{ duration: reduced ? 0 : .8 }} transform="rotate(-90 220 220)" /><circle cx="220" cy="54" r="5" fill="currentColor" /></motion.svg>
            <span className="atelier-dial-top">CHECK. WAIT. REPEAT.</span><div className="atelier-dial-value"><span>every</span><AnimatePresence mode="wait"><motion.b key={cadenceIndex} initial={{ opacity: 0, y: reduced ? 0 : 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -18 }} transition={{ duration: .2 }}>{cadence.number}</motion.b></AnimatePresence><span>{cadence.unit}</span></div><span className="atelier-dial-bottom">THE SAME APPROVED JOURNEY</span>
            <div className="atelier-dial-badge"><span />Scheduled browser check</div>
          </div>
          <fieldset className="atelier-cadence-control"><legend>Find your rhythm</legend><input type="range" min="0" max="4" step="1" value={cadenceIndex} aria-label="Check interval" aria-valuetext={`Every ${cadence.label}`} disabled={running} onChange={event => { setCadenceIndex(Number(event.target.value)); setPreview(-1) }} /><div>{CADENCES.map((item, i) => <button type="button" key={item.label} aria-pressed={i === cadenceIndex} disabled={running} onClick={() => { setCadenceIndex(i); setPreview(-1) }}>{item.label}</button>)}</div></fieldset>
          <div className="atelier-preview-control"><button type="button" className="atelier-play" disabled={running} onClick={() => setPreview(reduced ? 3 : 0)}><span aria-hidden="true">{running ? '...' : '\u25b6'}</span>{running ? 'Following the steps' : preview === 3 ? 'Watch the example again' : 'Watch one example check'}</button><span role="status">{preview === 3 ? 'Example complete. The schedule continues.' : 'An accelerated illustration, not a live check.'}</span></div>
        </div>
      </div>
      <div className="atelier-schedule-strip"><span>YOUR DAY GOES ON.<br /><b>SO DO THE CHECKS.</b></span><div>{[0, 1, 2, 3].map(i => <motion.div key={`${cadenceIndex}-${i}`} initial={{ opacity: 0, y: reduced ? 0 : 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduced ? 0 : i * .09 }}><i /><b>{timeAt(9 * 60 + i * cadence.minutes)}</b><span>{i === 0 ? 'Verified starting point' : 'Next scheduled check'}</span></motion.div>)}</div><a href="#results" aria-label="Continue to the evidence"><Arrow /></a></div>
      <p className="atelier-scope">Illustrative schedule. Monitoring starts only when you enable it on a verified site. Fresh, complete discovery evidence can qualify a path for direct monitoring; incomplete or edited flows need verification. Scheduled checks do not run automatically at deployment time.</p>
    </div>
  </section>
}

function EvidenceChapter() {
  const [record, setRecord] = useState<'passed' | 'stopped'>('stopped')
  const [step, setStep] = useState(2)
  const reduced = useReducedMotion()
  const stopped = record === 'stopped'
  const folioRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress: folioProgress } = useScroll({ target: folioRef, offset: ['start end', 'end start'] })
  const folioAngle = useTransform(folioProgress, [0, .5, 1], [3, 0, -1.5])
  const folioLift = useTransform(folioProgress, [0, 1], [24, -16])
  const showMissing = stopped && step === 2
  const titles = ['Home page opened', 'Contact link followed', showMissing ? 'Expected form did not appear' : 'Contact form was visible']
  return <section id="results" className="atelier-evidence" aria-labelledby="evidence-title"><div className="lp-container">
    <div className="atelier-chapter-line"><span>03 / FOLLOW THE EVIDENCE</span><span>NOT JUST A RED DOT.</span></div>
    <Reveal className="atelier-evidence-heading"><h2 id="evidence-title">Something stopped.<br /><em>Here's where.</em></h2><p>See which step stopped, the page it happened on and the recorded error. Follow the executed steps to reproduce it yourself, with an error screenshot when available.</p></Reveal>
    <div className="atelier-evidence-desk">
      <div className="atelier-case-notes"><span className="atelier-case-label">CONTACT FORM / EXAMPLE RECORDS</span><h3>It worked at 09:00.<br />It stopped at 10:00.</h3><p>Inspect the saved observations. You are selecting run records, not reopening old versions of the website.</p><div className="atelier-records" aria-label="Saved example records">{[{id:'passed' as const,time:'09:00',label:'Last recorded success'},{id:'stopped' as const,time:'10:00',label:'First observed failure'}].map(item => <button key={item.id} type="button" className={item.id === 'stopped' ? 'is-stopped' : ''} aria-pressed={record === item.id} onClick={() => { setRecord(item.id); setStep(2) }}><span /><b>{item.time}</b><span>{item.label}</span><Arrow diagonal /></button>)}</div><div className="atelier-inspect-steps"><span>INSPECT A STEP</span>{['Open home', 'Click Contact', 'Verify form'].map((label, i) => <button type="button" key={label} aria-pressed={step===i} onClick={() => setStep(i)}><span>0{i+1}</span>{label}<span>{stopped && i===2 ? '!' : <Check />}</span></button>)}</div><p className="atelier-case-boundary">This narrows the observation window. It does not prove the exact moment or cause of a regression.</p></div>
      <motion.div ref={folioRef} style={{ rotate: reduced ? 0 : folioAngle, y: reduced ? 0 : folioLift }} className="atelier-evidence-folio"><div className="atelier-folio-back" aria-hidden="true" /><div className="atelier-evidence-sheet"><div className="atelier-sheet-header"><span>OBSERVATION / {stopped ? '10:00' : '09:00'}</span><span>Illustration</span></div><AnimatePresence mode="wait"><motion.div key={`${record}-${step}`} initial={{opacity:0, y:reduced?0:12}} animate={{opacity:1,y:0}} exit={{opacity:0,y:reduced?0:-8}} transition={{duration:.22}}><div className="atelier-sheet-title"><span className={showMissing ? 'atelier-stopped-symbol' : 'atelier-passed-symbol'}>{showMissing ? '!' : <Check />}</span><div><span>STEP 0{step+1}</span><h3>{titles[step]}</h3></div></div>
        <div className={`atelier-browser-evidence ${showMissing?'has-gap':''}`}><div className="atelier-browser-bar"><span className="lp-browser-dots"><i /><i /><i /></span><span>example-store.test/{step===0?'':'contact'}</span></div><div className="atelier-sample-site"><div className="atelier-sample-nav"><b>studio.</b><span>Home</span><span className={step===1?'is-target':''}>Contact</span></div><span className="atelier-sample-kicker">{step===0?'A SMALL STUDIO. A BIG IDEA.':"LET'S MAKE SOMETHING GOOD."}</span><h4>{step===0?'Thoughtful things,\nfor everyday living.':'Good things start\nwith a conversation.'}</h4>{step===0?<div className="atelier-sample-products"><i /><i /><i /></div>:showMissing?<div className="atelier-missing-form"><span>EXPECTED HERE</span><p>Contact form</p><small>Not found in this example run</small><i className="atelier-target-corner" /></div>:<div className="atelier-present-form"><span>Your name</span><span>Your email</span><span>Message</span><b>Send message <Arrow /></b></div>}</div></div>
        <div className="atelier-observation"><span>EXPECTED</span><p>{step===0?'The home page opens.':step===1?'The Contact link opens the intended page.':'A contact form is visible on the page.'}</p><span>OBSERVED</span><p>{titles[step]}.</p></div></motion.div></AnimatePresence><div className="atelier-evidence-stamp"><FeatureIcon type="evidence" /><span>Illustrative evidence, not an actual customer screenshot.</span></div></div></motion.div>
    </div>
    <div className="atelier-trust-line"><span><FeatureIcon type="shield" /><b>Clear about what we know.</b></span><p>Real runs distinguish confirmed issues, blocked checks, changed targets and inconclusive results. Explicit failures need repeat confirmation. Screenshots are captured on errors when available, not on every successful step. Screenshots are disabled for runs using saved test-account credentials.</p><details><summary>Scope &amp; other checks <span>+</span></summary><p>Only the approved steps and expected results are checked. Missing evidence is marked. Optional audits cover speed, links, SEO, security and privacy signals. On-page checks do not automatically verify email delivery, completed payments or fulfillment.</p></details></div>
    <Reveal className="atelier-closing"><div><span>LESS REPEATING. MORE MOVING FORWARD.</span><h3>Put your first flow<br /><em>on watch.</em></h3></div><div><p>One website. Your approved steps. A recurring schedule.<br />Create, edit and save your own flows. Explore the recorded steps, then put the checks that matter on a schedule. Website audits remain available on demand.</p><Link to="/signup" className="lp-button">Find my first flow<Arrow diagonal /></Link><small>No credit card. You decide when monitoring starts.</small></div></Reveal>
  </div></section>
}


function AccountFeatures() {
  return <section className="lp-account-features lp-container" aria-labelledby="account-features-title">
    <Reveal><span className="lp-eyebrow">FROM A SUGGESTION TO YOUR OWN CHECK</span><h2 id="account-features-title">Your flow. Your steps.<br /><em>Your definition of working.</em></h2><p className="lp-account-intro">Discovery gives you a starting point. Create an account to make it yours and keep checking it over time.</p></Reveal>
    <div className="lp-account-grid">
      <Reveal><FeatureIcon type="route" /><h3>Edit a suggestion. Or build your own.</h3><p>Create and save a flow, change its steps and choose the exact element or on-page result to check. Edit it whenever your website changes; changes need fresh verification.</p></Reveal>
      <Reveal><FeatureIcon type="evidence" /><h3>See the journey, step by step.</h3><p>Explore the flow board and inspect recorded steps. Discovery observations include reproduction instructions, so you can check what we saw yourself.</p></Reveal>
      <Reveal><FeatureIcon type="shield" /><h3>Know where it stopped.</h3><p>Review the failed step, page URL, error and available screenshot. Compare saved runs and enable scheduled checks once your path is ready.</p></Reveal>
    </div>
    <Link to="/signup" className="lp-button">Create my first flow<Arrow diagonal /></Link>
    <p className="lp-account-note">Screenshots are captured on errors when available; runs using saved test-account credentials do not capture screenshots. On-page checks do not prove inbox delivery, payment completion or fulfillment.</p>
  </section>
}

function StoryBridge({ dark = false }: { dark?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end center'] })
  const progress = useSpring(scrollYProgress, { stiffness: 80, damping: 25 })
  const route = 'M600 0 V24 C600 65 1000 35 1000 76 C1000 117 200 75 200 117 V150'
  return <div ref={ref} className={`fg-story-bridge ${dark ? 'is-dark' : ''}`} aria-hidden="true"><svg viewBox="0 0 1200 150" fill="none" preserveAspectRatio="none"><path d={route} stroke="currentColor" strokeOpacity=".15" strokeWidth="1.5" /><motion.path d={route} stroke="currentColor" strokeWidth="2" style={{ pathLength: reduced ? 1 : progress }} /><circle cx="600" cy="8" r="4" fill="currentColor" /><circle cx="200" cy="142" r="4" fill="currentColor" /></svg><span>{dark ? 'THE CHECK BECOMES A RECORD' : 'THE JOURNEY BECOMES A ROUTINE'}</span></div>
}

export function Landing() {
  return <MotionConfig reducedMotion="user"><div className="lp-page fg-story-page">
    <ScrollProgress />
    <a className="lp-skip" href="#main">Skip to content</a>
    <header className="lp-nav lp-container">
      <Link to="/" className="brand lp-brand"><BrandMark />FlowGuardian<span className="lp-brand-period">.</span></Link>
      <nav aria-label="Main navigation"><a href="#journey">The journey</a><a href="#how">The routine</a><a href="#results">The evidence</a></nav>
      <div className="lp-nav-actions"><Link to="/login" className="lp-signin">Sign in</Link><Link to="/signup" className="lp-button lp-button-small">Get started<Arrow diagonal /></Link></div>
    </header>
    <main id="main">
      <section id="journey" className="fg-hero lp-container">
        <div className="fg-hero-intro"><Reveal className="fg-hero-heading"><div className="lp-eyebrow"><span className="lp-live-dot" /> 01 / YOU SHIP. THE JOURNEY CHANGES.</div><h1>Ship the update.<br /><em>Keep watch on the flow.</em></h1></Reveal><Reveal className="fg-hero-action"><p>A form worked yesterday. A deploy changed something today. Set your interval and let FlowGuardian recheck the journey, without repeating every click yourself.</p><UrlForm id="hero-website" /><div className="lp-form-benefits"><span><Check />Free trial</span><span><Check />No credit card</span><span><Check />Your schedule</span></div></Reveal></div>
        <Reveal className="fg-hero-centrepiece"><ProductPreview /></Reveal>
        <div className="fg-hero-footer"><span><FeatureIcon type="route" />Contact forms. Product discovery. Account access. Search.</span><a href="#how" className="lp-text-link">Make it a routine<Arrow /></a></div>
      </section>
      <StoryBridge />
      <AccountFeatures />
      <RoutineChapter />
      <StoryBridge dark />
      <EvidenceChapter />
    </main>
    <footer className="lp-footer lp-container"><div><Link to="/" className="brand lp-brand"><BrandMark />FlowGuardian<span className="lp-brand-period">.</span></Link><p>Watch over the journey.</p></div><p>Scheduled checks inspect the current website.<br />You control the approved steps and expected results.</p><span>&copy; {YEAR} FlowGuardian</span></footer>
  </div></MotionConfig>
}
