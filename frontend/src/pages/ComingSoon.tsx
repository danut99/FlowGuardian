import { motion } from 'motion/react'
import { fadeUp, stagger } from '../components/motion'
import { LockIcon } from '../components/icons'

const CONTENT = {
  api: {
    title: 'API Guardian',
    tagline: 'Monitor your APIs: availability, speed and correct responses.',
    features: [
      ['Availability', 'We check every endpoint regularly and let you know when it stops responding.'],
      ['Speed', 'Get an alert when response time goes over your limit (e.g. 2 seconds).'],
      ['HTTP status', 'We detect 4xx/5xx errors and unexpected changes.'],
      ['JSON rules', 'E.g. products.length > 0 — a 200 with an empty list is still a problem.'],
    ],
  },
  flowfix: {
    title: 'FlowFix',
    tagline: 'When a problem appears, FlowFix takes action automatically.',
    features: [
      ['Email', 'Instant alerts for critical incidents, a daily digest for maintenance.'],
      ['Tickets', 'Automatically creates tasks in your team’s tool.'],
      ['Diagnosis', 'Changed selector or real bug? We tell you the difference.'],
      ['Actions', 'Webhooks and other automations triggered by incidents.'],
    ],
  },
} as const

export function ComingSoon({ module, locked }: { module: keyof typeof CONTENT; locked?: boolean }) {
  const c = CONTENT[module]
  return (
    <motion.div className="coming" variants={stagger} initial="hidden" animate="show">
      <motion.span variants={fadeUp} className="chip accent">{locked ? <><LockIcon /> Not included in the free trial</> : 'Coming soon'}</motion.span>
      <motion.h1 variants={fadeUp} className="gradient-text" style={{ fontSize: '2.4rem', marginTop: '1rem' }}>{c.title}</motion.h1>
      <motion.p variants={fadeUp} className="muted" style={{ fontSize: '1.05rem' }}>{c.tagline}</motion.p>
      <motion.div className="feature-grid" variants={stagger}>
        {c.features.map(([title, text]) => (
          <motion.div key={title} variants={fadeUp} className="card">
            <h3>{title}</h3>
            <p className="muted" style={{ margin: 0 }}>{text}</p>
          </motion.div>
        ))}
      </motion.div>
      {locked && <motion.p variants={fadeUp} className="muted" style={{ marginTop: '1.5rem' }}>API Guardian comes with paid plans.</motion.p>}
    </motion.div>
  )
}
