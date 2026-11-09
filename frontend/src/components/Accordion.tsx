import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'

type Props = {
  title: ReactNode
  summary?: ReactNode
  aside?: ReactNode
  open: boolean
  onToggle: () => void
  className?: string
  children: ReactNode
}

// Header always visible with a one-line summary, so a closed section still tells you what's inside
export function Accordion({ title, summary, aside, open, onToggle, className = '', children }: Props) {
  return (
    <motion.div layout="position" className={`card acc ${open ? 'open' : ''} ${className}`}>
      <button className="acc-head" onClick={onToggle} aria-expanded={open}>
        <div className="acc-title">
          {title}
          {summary && <div className="acc-summary muted small">{summary}</div>}
        </div>
        {aside && <div className="acc-aside">{aside}</div>}
        <motion.svg
          width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
          animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} className="acc-chevron"
        >
          <path d="M6 9l6 6 6-6" />
        </motion.svg>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body" className="acc-body"
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            <div className="acc-inner">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
