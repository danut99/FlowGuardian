import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { supabase } from '../lib/supabase'
import { Favicon, ScoreRing } from '../components/ui'
import { fadeUp, stagger } from '../components/motion'
import type { Site } from '../types'

function normalizeUrl(input: string) {
  const trimmed = input.trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

export function Sites() {
  const [sites, setSites] = useState<Site[]>([])
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  async function load() {
    const { data, error } = await supabase.from('sites').select('*').order('created_at', { ascending: false })
    if (error) setError(error.message)
    else setSites(data)
  }

  useEffect(() => {
    load()
    const channel = supabase.channel('sites-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sites' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  async function addSite(e: FormEvent) {
    e.preventDefault()
    setError(null)
    let parsed: URL
    try {
      parsed = new URL(normalizeUrl(url))
    } catch {
      setError('Invalid URL.')
      return
    }
    setBusy(true)
    const { data, error } = await supabase.from('sites')
      .insert({ url: parsed.href, name: parsed.host }).select('id').single()
    setBusy(false)
    if (error) setError(error.message)
    else navigate(`/sites/${data.id}`)
  }

  async function deleteSite(s: Site) {
    if (!confirm(`Delete ${s.name ?? s.url}? Its tests, runs and reports will be deleted too.`)) return
    const { error } = await supabase.from('sites').delete().eq('id', s.id)
    if (error) setError(error.message)
    else setSites((prev) => prev.filter((x) => x.id !== s.id))
  }

  return (
    <motion.div variants={stagger} initial="hidden" animate="show">
      <section className="hero-box">
        <motion.div variants={fadeUp}><span className="chip accent">Website Tester</span></motion.div>
        <motion.h1 variants={fadeUp} className="gradient-text" style={{ marginTop: '1rem' }}>
          Enter a URL and find out<br />what’s not working on your website
        </motion.h1>
        <motion.p variants={fadeUp} className="muted">
          We check availability, speed, links, SEO and security. Then we keep monitoring your site.
        </motion.p>
        <motion.form variants={fadeUp} className="url-form" onSubmit={addSite}>
          <input placeholder="my-store.com" value={url} onChange={(e) => setUrl(e.target.value)} required />
          <motion.button className="btn" disabled={busy} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
            {busy ? <span className="spinner" /> : null} Analyze
          </motion.button>
        </motion.form>
        {error && <p className="notice error">{error}</p>}
        <motion.div variants={fadeUp} className="hero-chips">
          {['Availability', 'Speed', 'Broken links', 'SEO & mobile', 'Security'].map((c) => (
            <span key={c} className="chip">{c}</span>
          ))}
        </motion.div>
      </section>

      <div className="section-head">
        <h2>My sites</h2>
        <span className="muted small">{sites.length} {sites.length === 1 ? 'site' : 'sites'}</span>
      </div>
      {sites.length === 0 ? (
        <p className="muted">No sites yet. Enter your first URL above.</p>
      ) : (
        <motion.div className="grid" variants={stagger}>
          {sites.map((s) => {
            const scanning = s.scan_status === 'pending' || s.scan_status === 'scanning'
            const o = s.overview
            return (
              <motion.div key={s.id} variants={fadeUp} layout whileHover={{ y: -3 }} className="site-item">
                <Link to={`/sites/${s.id}`} className="card hover site-card">
                  <Favicon src={o?.icon} />
                  <div className="info">
                    <div className="title truncate">{o?.title ?? s.name ?? s.url}</div>
                    <div className="muted small truncate">{s.url}</div>
                    <div className="chips" style={{ marginTop: '0.45rem' }}>
                      {scanning && <span className="chip"><span className="spinner" /> Analyzing</span>}
                      {s.scan_status === 'error' && <span className="badge badge-error">Analysis error</span>}
                      {o?.blocked && <span className="badge badge-paused">Blocked by site</span>}
                      {o?.type && <span className="chip">{o.type}</span>}
                    </div>
                  </div>
                  {!scanning && o && !o.blocked && <ScoreRing score={o.score} size={52} />}
                </Link>
                <button className="site-delete" title="Delete site" aria-label={`Delete ${s.name ?? s.url}`} onClick={() => deleteSite(s)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
                  </svg>
                </button>
              </motion.div>
            )
          })}
        </motion.div>
      )}
    </motion.div>
  )
}
