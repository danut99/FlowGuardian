import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, useInView, useScroll, useSpring } from 'motion/react'
import { ScoreRing, StatusIcon } from '../components/ui'
import { BellIcon, LockIcon } from '../components/icons'
import { fadeUp, stagger } from '../components/motion'
import { normalizeUrl, pendingSite } from '../lib/plan'
import { supabase } from '../lib/supabase'

const YEAR = new Date().getFullYear()

export function Landing() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <Link to="/" className="brand"><BrandMark /> FlowGuardian</Link>
        <nav>
          <a href="#how">How it works</a>
          <a href="#plan">Free trial</a>
          <Link to="/login" className="btn ghost sm">Sign in</Link>
          <Link to="/signup" className="btn sm">Get started</Link>
        </nav>
      </header>

      <Hero />
      <HowItWorks />
      <PlanSection />

      <section className="landing-cta">
        <motion.h2 initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
          See what’s broken on your website in two minutes
        </motion.h2>
        <UrlForm />
      </section>

      <footer className="landing-footer muted small">© {YEAR} FlowGuardian</footer>
    </div>
  )
}

export function BrandMark() {
  return (
    <span className="brand-mark">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" /><path d="M8.5 12l2.5 2.5 4.5-5" />
      </svg>
    </span>
  )
}

function UrlForm() {
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  async function submit(e: FormEvent) {
    e.preventDefault()
    const parsed = normalizeUrl(url)
    if (!parsed) return setError('That doesn’t look like a website address. Try something like my-store.com')
    setBusy(true)
    const { data, error } = await supabase.rpc('request_public_scan', { site_url: parsed.origin })
    setBusy(false)
    if (error) return setError(error.message)
    // Added to their account automatically once they sign up
    pendingSite.set(parsed.origin + '/')
    navigate(`/check/${data}`)
  }

  return (
    <>
      <form className="url-form" onSubmit={submit}>
        <input placeholder="your-website.com" value={url} onChange={(e) => { setUrl(e.target.value); setError(null) }} required aria-label="Your website address" />
        <motion.button className="btn" disabled={busy} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
          {busy ? <span className="spinner" /> : null} Check my site
        </motion.button>
      </form>
      {error && <p className="notice error" style={{ textAlign: 'center' }}>{error}</p>}
    </>
  )
}

function Hero() {
  return (
    <motion.section className="hero-box landing-hero" variants={stagger} initial="hidden" animate="show">
      <motion.div variants={fadeUp}><span className="chip accent">Website monitoring for everyone</span></motion.div>
      <motion.h1 variants={fadeUp} className="gradient-text" style={{ marginTop: '1rem' }}>
        Know what’s broken on your website<br />before your visitors do
      </motion.h1>
      <motion.p variants={fadeUp} className="muted">
        Enter your address. We test it like a real visitor: availability, speed, broken links, SEO, security and legal basics.
        Then we keep watching and tell you when something breaks.
      </motion.p>
      <motion.div variants={fadeUp}><UrlForm /></motion.div>
      <motion.p variants={fadeUp} className="muted small" style={{ marginTop: '0.8rem' }}>Free trial · no card needed</motion.p>
      <motion.div variants={fadeUp} className="hero-chips">
        {['Availability', 'Speed', 'Broken links', 'SEO & mobile', 'Security', 'Legal basics'].map((c) => <span key={c} className="chip">{c}</span>)}
      </motion.div>
    </motion.section>
  )
}

const STEPS: { title: string; text: string; visual: () => ReactNode }[] = [
  { title: 'Enter your website', text: 'Just the address. No code to install, no plugin, nothing to configure.', visual: () => <TypingVisual /> },
  { title: 'We check it like a real visitor', text: 'A real browser opens your pages, follows the links and measures what your visitors experience — also on a slow phone connection.', visual: () => <ScanVisual /> },
  { title: 'You get a clear report', text: 'One score and a short list of what to fix first, explained in plain words. Developers get the technical details too.', visual: () => <ReportVisual /> },
  { title: 'We keep watching', text: 'Automatic tests run every hour or every day. If your site goes down or a page breaks, you’ll know.', visual: () => <MonitorVisual /> },
  { title: 'Describe a test, AI builds it', text: 'Write “click Contact and check the form appears”. We find the buttons, try the test and add it to your monitoring.', visual: () => <AiVisual /> },
]

function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 70%', 'end 60%'] })
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30 })
  return (
    <section id="how" className="how-section">
      <motion.div className="section-title" initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
        <span className="chip">How it works</span>
        <h2>From address to peace of mind in five steps</h2>
      </motion.div>
      <div className="timeline" ref={ref}>
        <div className="timeline-track"><motion.div className="timeline-fill" style={{ scaleY: progress }} /></div>
        {STEPS.map((s, i) => <Step key={s.title} n={i + 1} {...s} />)}
      </div>
    </section>
  )
}

function Step({ n, title, text, visual }: { n: number; title: string; text: string; visual: () => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-25% 0px' })
  return (
    <div className="tl-step" ref={ref}>
      <motion.div className="tl-dot" initial={{ scale: 0.6, opacity: 0.4 }} animate={inView ? { scale: 1, opacity: 1 } : {}} transition={{ type: 'spring', stiffness: 300, damping: 18 }}>
        {n}
      </motion.div>
      <motion.div className="tl-text" initial={{ opacity: 0, x: -16 }} animate={inView ? { opacity: 1, x: 0 } : {}} transition={{ duration: 0.45 }}>
        <h3>{title}</h3>
        <p className="muted">{text}</p>
      </motion.div>
      <motion.div className="tl-visual card" initial={{ opacity: 0, y: 24 }} animate={inView ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.5, delay: 0.1 }}>
        {inView && visual()}
      </motion.div>
    </div>
  )
}

function TypingVisual() {
  const full = 'my-store.com'
  const [shown, setShown] = useState('')
  useEffect(() => {
    let i = 0
    const t = setInterval(() => {
      i++
      setShown(full.slice(0, i))
      if (i >= full.length) clearInterval(t)
    }, 90)
    return () => clearInterval(t)
  }, [])
  const done = shown === full
  return (
    <div className="v-typing">
      <div className="url-form" style={{ margin: 0 }}>
        <span className="v-input">{shown}<motion.i animate={{ opacity: [1, 0] }} transition={{ duration: 0.6, repeat: Infinity }}>|</motion.i></span>
        <motion.span className="btn sm" animate={done ? { scale: [1, 0.92, 1] } : {}} transition={{ delay: 0.3 }}>Check my site</motion.span>
      </div>
      {done && <motion.p className="muted small" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>That’s all we need.</motion.p>}
    </div>
  )
}

function ScanVisual() {
  const items = ['Pages respond', 'Speed on 4G', 'Broken links', 'SEO & mobile', 'Security headers', 'Privacy & cookies']
  return (
    <div className="v-scan">
      <div className="radar sm">
        {[0, 1, 2].map((i) => (
          <motion.span key={i} initial={{ scale: 0.4, opacity: 0.8 }} animate={{ scale: 1.4, opacity: 0 }} transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.8 }} />
        ))}
        <motion.i animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 1.6, repeat: Infinity }} />
      </div>
      <ul>
        {items.map((it, i) => (
          <motion.li key={it} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.35 }}>
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.5 + i * 0.35, type: 'spring' }}><StatusIcon status="pass" /></motion.span>
            {it}
          </motion.li>
        ))}
      </ul>
    </div>
  )
}

function ReportVisual() {
  const rows: { s: 'pass' | 'warn' | 'fail'; t: string }[] = [
    { s: 'fail', t: '3 broken links on /contact' },
    { s: 'warn', t: 'Home page is slow on phones (6.2 s)' },
    { s: 'pass', t: 'HTTPS and certificate OK' },
  ]
  return (
    <div className="v-report">
      <ScoreRing score={78} size={84} />
      <div className="v-rows">
        {rows.map((r, i) => (
          <motion.div key={r.t} className={`v-row ${r.s}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 + i * 0.25 }}>
            <StatusIcon status={r.s} /> {r.t}
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function MonitorVisual() {
  const tests = [
    { name: 'Site is up', every: 'every hour', fail: -1 },
    { name: 'Checkout button works', every: 'every 6 hours', fail: 9 },
    { name: 'Images load', every: 'daily', fail: -1 },
  ]
  return (
    <div className="v-monitor">
      {tests.map((t, ti) => (
        <div key={t.name} className="v-test">
          <div><b>{t.name}</b><div className="muted small">{t.every}</div></div>
          <div className="history">
            {Array.from({ length: 12 }, (_, i) => (
              <motion.span key={i} className={`hdot ${i === t.fail ? 'failed' : 'passed'}`}
                initial={{ scaleY: 0 }} animate={{ scaleY: 1 }} transition={{ delay: ti * 0.2 + i * 0.07 }} />
            ))}
          </div>
        </div>
      ))}
      <motion.div className="v-alert" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.6 }}>
        <BellIcon /> “Checkout button works” failed — we’ll show you the screenshot
      </motion.div>
    </div>
  )
}

function AiVisual() {
  const steps = ['Open the home page', 'Click “Contact”', 'Check the contact form is visible']
  return (
    <div className="v-ai">
      <motion.div className="bubble me" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>Click Contact and check the form appears</motion.div>
      <motion.div className="bubble bot" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}>
        <div className="row"><b>Contact form opens</b><motion.span className="badge badge-passed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2 }}>tried: works ✓</motion.span></div>
        <ol className="ai-steps">
          {steps.map((s, i) => (
            <motion.li key={s} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1 + i * 0.3 }}><span>{s}</span></motion.li>
          ))}
        </ol>
      </motion.div>
    </div>
  )
}

function PlanSection() {
  const included = ['1 website, scanned and monitored', 'Full report: speed, links, SEO, security, legal', 'Automatic tests every hour / day', '1 test written with AI']
  const later = ['More websites', 'More AI tests', 'API Guardian (API monitoring)']
  return (
    <section id="plan" className="plan-section">
      <motion.div className="section-title" initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
        <span className="chip">Free trial</span>
        <h2>Start free, no card needed</h2>
      </motion.div>
      <motion.div className="card plan-card" initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
        <div>
          <h3>Included in the free trial</h3>
          <ul className="plan-list">{included.map((i) => <li key={i}><StatusIcon status="pass" /> {i}</li>)}</ul>
        </div>
        <div>
          <h3>Coming with paid plans</h3>
          <ul className="plan-list locked">{later.map((i) => <li key={i}><LockIcon /> {i}</li>)}</ul>
        </div>
        <Link to="/signup" className="btn">Start the free trial</Link>
      </motion.div>
    </section>
  )
}
