import { motion } from 'motion/react'
import type { CheckStatus } from '../types'

function scoreColor(score: number) {
  return score >= 85 ? 'var(--ok)' : score >= 60 ? 'var(--warn)' : 'var(--bad)'
}

export function ScoreRing({ score, size = 72 }: { score: number | null; size?: number }) {
  const stroke = size > 60 ? 7 : 5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const value = score ?? 0
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        {score != null && (
          <motion.circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={scoreColor(value)} strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={c}
            initial={{ strokeDashoffset: c }}
            animate={{ strokeDashoffset: c * (1 - value / 100) }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
          />
        )}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: size > 60 ? '1.25rem' : '0.85rem' }}>
        {score ?? '—'}
      </div>
    </div>
  )
}

export function StatusIcon({ status }: { status: CheckStatus }) {
  return (
    <span className={`status-icon ${status}`}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        {status === 'pass' && <path d="M5 12l5 5L20 7" />}
        {status === 'warn' && <path d="M12 7v6M12 17h.01" />}
        {status === 'fail' && <path d="M6 6l12 12M18 6L6 18" />}
      </svg>
    </span>
  )
}

export function Favicon({ src, large }: { src?: string | null; large?: boolean }) {
  return (
    <div className={`favicon${large ? ' lg' : ''}`}>
      {src ? <img src={src} alt="" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : <Globe />}
    </div>
  )
}

function Globe() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  )
}

export function Radar({ label }: { label: string }) {
  return (
    <div className="scanning">
      <div className="radar">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            initial={{ scale: 0.4, opacity: 0.8 }}
            animate={{ scale: 1.4, opacity: 0 }}
            transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.8, ease: 'easeOut' }}
          />
        ))}
        <motion.i animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 1.6, repeat: Infinity }} />
      </div>
      <h2>{label}</h2>
    </div>
  )
}
