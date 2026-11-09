import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    const { error } = mode === 'signin'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password })
    setBusy(false)
    if (error) setMessage(error.message)
    else if (mode === 'signup') setMessage('Check your email to confirm your account.')
  }

  return (
    <div className="auth">
      <form className="card auth-card" onSubmit={submit}>
        <h1>FlowGuardian</h1>
        <p className="muted">Find out what’s not working on your website.</p>
        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="btn" disabled={busy}>{mode === 'signin' ? 'Sign in' : 'Create account'}</button>
        {message && <p className="notice">{message}</p>}
        <button type="button" className="btn ghost" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'No account? Sign up' : 'Already have an account? Sign in'}
        </button>
      </form>
    </div>
  )
}
