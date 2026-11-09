import type { ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { motion } from 'motion/react'
import { supabase } from '../lib/supabase'
import { useDevMode } from '../lib/devMode'

const MODULES = [
  { to: '/', label: 'Website Tester', match: (p: string) => p === '/' || p.startsWith('/sites') },
  { to: '/api', label: 'API Guardian', match: (p: string) => p.startsWith('/api') },
  { to: '/flowfix', label: 'FlowFix', soon: true, match: (p: string) => p.startsWith('/flowfix') },
]

export function Layout({ email, children }: { email?: string; children: ReactNode }) {
  const { pathname } = useLocation()
  const [dev, setDev] = useDevMode()
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" /><path d="M8.5 12l2.5 2.5 4.5-5" />
            </svg>
          </span>
          FlowGuardian
        </Link>
        <nav className="modules">
          {MODULES.map((m) => {
            const active = m.match(pathname)
            return (
              <NavLink key={m.to} to={m.to} className={`module-link${active ? ' active' : ''}`}>
                {active && <motion.div layoutId="module-pill" className="module-pill" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
                <span>{m.label}</span>
                {m.soon && <em className="soon">soon</em>}
              </NavLink>
            )
          })}
        </nav>
        <div className="topbar-right">
          <button className={`dev-toggle${dev ? ' on' : ''}`} onClick={() => setDev(!dev)} title="Show technical details: stack traces, failed requests, Playwright export">
            <span className="dev-switch"><motion.span layout className="dev-knob" /></span> Developer mode
          </button>
          <span className="muted small">{email}</span>
          <button className="btn ghost sm" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>
      <main className="content">{children}</main>
    </div>
  )
}
