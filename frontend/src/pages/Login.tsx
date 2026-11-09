import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { supabase } from '../lib/supabase'
import { pendingSite } from '../lib/plan'

export function Login({ mode }: { mode: 'signin' | 'signup' }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const pending = pendingSite.get()
  const host = pending ? new URL(pending).host : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    const { data, error } = mode === 'signin'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
    setBusy(false)
    if (error) return setMessage(error.message)
    // With email confirmation on, sign-up returns no session until the link is clicked
    if (mode === 'signup' && !data.session) setMessage(`Check your email (${email}) and click the link to confirm your account${host ? ` — then we’ll start checking ${host}` : ''}.`)
    else navigate('/')
  }

  return (
    <div className="auth">
      <motion.form className="card auth-card" onSubmit={submit} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Link to="/" className="muted small">← Back</Link>
        <h1>{mode === 'signup' ? 'Create your free account' : 'Welcome back'}</h1>
        {host
          ? <p className="notice">We’ll check <b>{host}</b> as soon as you’re in.</p>
          : <p className="muted">{mode === 'signup' ? 'Free trial: 1 website and 1 AI-written test. No card needed.' : 'Sign in to see your websites.'}</p>}
        <label>
          Email
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" required minLength={8} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="btn" disabled={busy}>{busy ? <span className="spinner" /> : null} {mode === 'signin' ? 'Sign in' : 'Create account'}</button>
        {message && <p className="notice">{message}</p>}
        <Link to={mode === 'signin' ? '/signup' : '/login'} className="btn ghost" style={{ textAlign: 'center' }}>
          {mode === 'signin' ? 'No account? Sign up' : 'Already have an account? Sign in'}
        </Link>
      </motion.form>
    </div>
  )
}
