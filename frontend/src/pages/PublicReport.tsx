import { FindingEvidence } from '../components/FindingEvidence'
import type { Check } from '../types'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { supabase } from '../lib/supabase'
import { Favicon, ScoreRing, StatusIcon } from '../components/ui'
import { LockIcon } from '../components/icons'
import { fadeUp, stagger } from '../components/motion'
import { BrandMark } from './Landing'

type Teaser = {
  title: string
  icon: string | null
  type: string | null
  platforms: string[]
  score: number
  counts: { fail: number; warn: number; pass: number }
  groups: { id: string; fail: number; warn: number; pass: number }[]
  top: (Omit<Check, 'id' | 'detail'> & { id?: string; detail?: string })[]
  partial?: boolean
  hidden: number
}
type Scan = { url: string; status: 'pending' | 'running' | 'done' | 'error'; teaser: Teaser | null; error: string | null }

const GROUP_LABEL: Record<string, string> = {
  availability: 'Availability', performance: 'Speed', network: 'Slow connection', content: 'Functionality',
  text: 'Text & content', seo: 'SEO & mobile', security: 'Security', compliance: 'Privacy & policy review',
}
const CHECKING = ['Opening your home page like a real visitor', 'Measuring speed', 'Checking HTTPS and the certificate', 'Reading SEO and mobile basics', 'Looking at security headers', 'Checking privacy and cookie basics']
// Placeholder rows behind the lock: never real data, so there is nothing to uncover in the page source
const LOCKED_ROWS = ['Which pages are affected and why', 'Step-by-step fix for each problem', 'All pages of the site, not just the home page', 'Broken links and images across the site', 'Speed on a slow phone connection']

export function PublicReport() {
  const { token } = useParams()
  const [scan, setScan] = useState<Scan | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const { data } = await supabase.rpc('get_public_scan', { scan_token: token })
      if (stop) return
      if (!data) return setMissing(true)
      setScan(data as Scan)
      if (data.status === 'pending' || data.status === 'running') timer = setTimeout(poll, 2000)
    }
    poll()
    return () => { stop = true; clearTimeout(timer) }
  }, [token])

  const host = scan ? new URL(scan.url).host : ''

  return (
    <div className="landing">
      <header className="landing-nav">
        <Link to="/" className="brand"><BrandMark /> FlowGuardian</Link>
        <nav>
          <Link to="/login" className="btn ghost sm">Sign in</Link>
          <Link to="/signup" className="btn sm">Create free account</Link>
        </nav>
      </header>

      {missing && (
        <div className="card report-empty">
          <h2>This check has expired</h2>
          <p className="muted">Free checks are kept for 7 days.</p>
          <Link to="/" className="btn">Check a site</Link>
        </div>
      )}

      {scan && (scan.status === 'pending' || scan.status === 'running') && !scan.teaser && <Checking host={host} />}

      {scan?.status === 'error' && (
        <div className="card report-empty">
          <h2>We couldn’t check {host}</h2>
          <p className="muted">{scan.error}</p>
          <Link to="/" className="btn">Try another address</Link>
        </div>
      )}

      {scan?.teaser && scan.status !== 'error' && <>{scan.status !== 'done' && <p className="notice-progress">First results are ready. Checking performance, privacy and the remaining home page checks...</p>}<Report host={host} t={scan.teaser} /></>}
    </div>
  )
}

function Checking({ host }: { host: string }) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, CHECKING.length - 1)), 2200)
    return () => clearInterval(t)
  }, [])
  return (
    <motion.div className="card report-checking" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
      <div className="radar sm">
        {[0, 1, 2].map((i) => (
          <motion.span key={i} initial={{ scale: 0.4, opacity: 0.8 }} animate={{ scale: 1.4, opacity: 0 }} transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.8 }} />
        ))}
        <motion.i animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 1.6, repeat: Infinity }} />
      </div>
      <div>
        <h2 style={{ marginTop: 0 }}>Checking {host}…</h2>
        <p className="muted">Usually takes 10–20 seconds.</p>
        <ul className="checking-list">
          {CHECKING.map((c, i) => (
            <motion.li key={c} initial={{ opacity: 0, x: 8 }} animate={{ opacity: i <= step ? 1 : 0.35, x: 0 }} transition={{ delay: i * 0.05 }}>
              {i < step ? <StatusIcon status="pass" /> : i === step ? <span className="spinner" /> : <span className="dot-idle" />}
              {c}
            </motion.li>
          ))}
        </ul>
      </div>
    </motion.div>
  )
}

function Report({ host, t }: { host: string; t: Teaser }) {
  const issues = t.counts.fail + t.counts.warn
  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="report">
      <motion.div variants={fadeUp} className="card report-head">
        <Favicon src={t.icon} large />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="muted small">{t.partial ? 'Preliminary check / results still arriving' : 'Free check / home page'}</div>
          <h1 className="truncate" style={{ margin: '0.15rem 0' }}>{t.title || host}</h1>
          <div className="chips">
            <span className="chip">{host}</span>
            {t.type && <span className="chip accent">{t.type}</span>}
            {t.platforms.map((p) => <span key={p} className="chip">{p}</span>)}
          </div>
        </div>
        <ScoreRing score={t.score} size={96} />
      </motion.div>

      <p className="muted small">The score summarizes automated checks. Speed readings are single desktop lab observations, not Lighthouse scores or real-user Core Web Vitals. Privacy findings need review and are not legal advice. Passive scans do not submit forms or verify email delivery.</p>
      <motion.div variants={fadeUp} className="summary">
        {([['fail', 'Problems'], ['warn', 'Recommendations'], ['pass', 'All good']] as const).map(([k, label]) => (
          <div key={k} className="card stat"><span className={`dot ${k}`} /><div><b>{t.counts[k]}</b><div className="muted small">{label}</div></div></div>
        ))}
      </motion.div>

      <motion.div variants={fadeUp} className="report-groups">
        {t.groups.map((g) => (
          <div key={g.id} className={`card report-group ${g.fail ? 'fail' : g.warn ? 'warn' : 'pass'}`}>
            <StatusIcon status={g.fail ? 'fail' : g.warn ? 'warn' : 'pass'} />
            <div>
              <b>{GROUP_LABEL[g.id] ?? g.id}</b>
              <div className="muted small">
                {g.fail + g.warn ? [g.fail && `${g.fail} problem${g.fail === 1 ? '' : 's'}`, g.warn && `${g.warn} to improve`].filter(Boolean).join(' · ') : 'All good'}
              </div>
            </div>
          </div>
        ))}
      </motion.div>

      {issues > 0 && (
        <motion.div variants={fadeUp} className="card">
          <h3 style={{ marginTop: 0 }}>What to fix first</h3>
          <div className="report-issues">
            {t.top.map((c) => (
              <div key={c.label} className="report-issue">
                <StatusIcon status={c.status} />
                <div style={{ flex: 1 }}><b>{c.label}</b>{c.detail && <p className="muted small">{c.detail}</p>}<FindingEvidence check={{ ...c, id: c.id ?? c.label, detail: c.detail ?? '' }} /></div>
                <span className="muted small">{GROUP_LABEL[c.group] ?? c.group}</span>

              </div>
            ))}
          </div>
        </motion.div>
      )}

      <motion.div variants={fadeUp} className="locked-zone">
        <div className="locked-rows" aria-hidden="true">
          {t.hidden > 0 && <div className="report-issue"><StatusIcon status="warn" /> {t.hidden} more issue{t.hidden === 1 ? '' : 's'} on this page</div>}
          {LOCKED_ROWS.map((r) => <div key={r} className="report-issue"><StatusIcon status="pass" /> {r}</div>)}
        </div>
        <motion.div className="locked-cta card" style={{ x: '-50%', y: '-50%' }} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5 }}>
          <span className="lock-badge"><LockIcon /></span>
          <h2>See the full report for {host}</h2>
          <p className="muted">
            {issues > 0 ? `All ${issues} findings with the affected pages and how to fix them` : 'The full report'}, a check of every page,
            and automatic monitoring that tells you when something breaks.
          </p>
          <div className="actions" style={{ justifyContent: 'center' }}>
            <Link to="/signup" className="btn">Create free account</Link>
            <Link to="/login" className="btn ghost">I have an account</Link>
          </div>
          <p className="muted small" style={{ marginBottom: 0 }}>Free trial · no card needed · {host} is added to your account automatically</p>
        </motion.div>
      </motion.div>
    </motion.div>
  )
}
