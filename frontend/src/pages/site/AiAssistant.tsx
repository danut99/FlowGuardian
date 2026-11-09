import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { supabase } from '../../lib/supabase'
import type { Locator, Site } from '../../types'
import type { TestDraft } from './TestEditor'

type AiDraft = TestDraft & { kind: string; page_url: string }
type AiRequest = {
  id: string
  page_url: string | null
  prompt: string
  status: 'pending' | 'running' | 'done' | 'error'
  reply: string | null
  draft: AiDraft | null
  verified: boolean | null
  verify_error: string | null
  error: string | null
  created_at: string
}

const EXAMPLES = [
  'Scrie „test” în căutare, apasă Enter și verifică că adresa conține search',
  'Apasă pe Contact și verifică că adresa conține /contact',
  'Apasă pe meniu și verifică că apare link-ul Despre noi',
]

// What a non-developer can read: role + visible name; developer details in the tooltip
function selectorLabel(l?: Locator) {
  if (!l) return null
  if (l.type === 'role') {
    const active = ['pressed', 'selected', 'checked', 'expanded'].some((k) => (l as Record<string, unknown>)[k] === true)
    return `${l.role}${l.name ? ` „${l.name}”` : ''}${active ? ' · activ' : ''}`
  }
  if (l.type === 'css' || l.type === 'testid') return l.type === 'testid' ? `data-testid="${l.value}"` : l.value
  return `${l.type} „${l.value}”`
}

export function AiAssistant({ site, pageOptions, pageLabel, onEdit, onSaved }: {
  site: Site
  pageOptions: string[]
  pageLabel: (url: string) => string
  onEdit: (draft: AiDraft) => void
  onSaved: () => void
}) {
  const [page, setPage] = useState(site.url)
  const [msg, setMsg] = useState('')
  const [reqs, setReqs] = useState<AiRequest[]>([])
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('ai_requests').select('*').eq('site_id', site.id)
      .order('created_at', { ascending: false }).limit(5)
    if (data) setReqs((data as AiRequest[]).reverse())
  }, [site.id])

  useEffect(() => {
    load()
    const channel = supabase.channel(`ai-${site.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_requests', filter: `site_id=eq.${site.id}` }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [site.id, load])

  const thinking = reqs.some((r) => r.status === 'pending' || r.status === 'running')

  async function send() {
    const text = msg.trim()
    if (text.length < 3 || thinking) return
    setSending(true)
    setError(null)
    const { error } = await supabase.rpc('ask_ai', { sid: site.id, purl: page === site.url ? null : page, msg: text })
    setSending(false)
    if (error) return setError(error.message)
    setMsg('')
    load()
  }

  async function save(r: AiRequest) {
    if (!r.draft) return
    const { error } = await supabase.rpc('save_test', {
      sid: site.id, tid: null, tname: r.draft.name, tkind: r.draft.kind, freq: 1440,
      purl: r.draft.page_url === site.url ? null : r.draft.page_url, steps: r.draft.steps,
    })
    if (error) return setError(error.message)
    setSaved((s) => new Set(s).add(r.id))
    onSaved()
  }

  return (
    <div className="card ai-card">
      <h2 style={{ margin: 0 }}>Descrie testul, îl construim noi</h2>
      <p className="muted" style={{ margin: '0.3rem 0 0.8rem' }}>
        Scrie pașii cu cuvintele tale. Deschidem pagina, găsim elementele și încercăm testul înainte să ți-l arătăm.
      </p>

      {reqs.length > 0 && (
        <div className="ai-thread">
          <AnimatePresence initial={false}>
            {reqs.map((r) => (
              <motion.div key={r.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="ai-turn">
                <div className="bubble me">
                  {r.prompt}
                  {r.page_url && <div className="muted small">pe {pageLabel(r.page_url)}</div>}
                </div>
                <div className="bubble bot">
                  {(r.status === 'pending' || r.status === 'running') && (
                    <span className="muted"><span className="spinner" /> Deschidem pagina și construim testul…</span>
                  )}
                  {r.status === 'error' && <span className="notice error">{r.error}</span>}
                  {r.status === 'done' && (
                    <>
                      <div>{r.reply}</div>
                      {r.draft && (
                        <div className="ai-draft">
                          <div className="row">
                            <b>{r.draft.name}</b>
                            {r.verified
                              ? <span className="badge badge-passed">încercat: merge ✓</span>
                              : <span className="badge badge-failed">încercat: nu a mers</span>}
                          </div>
                          {!r.verified && r.verify_error && <p className="muted small" style={{ margin: '0.3rem 0 0' }}>{r.verify_error}</p>}
                          <ol className="ai-steps">
                            {r.draft.steps.map((s, i) => (
                              <li key={i}>
                                <span>{s.note || s.action}</span>
                                {s.locators[0] && (
                                  <code className="sel" title={s.locators.map(selectorLabel).join('\nsau ')}>
                                    {selectorLabel(s.locators[0])}{s.locators.length > 1 ? ` +${s.locators.length - 1}` : ''}
                                  </code>
                                )}
                              </li>
                            ))}
                          </ol>
                          <div className="actions" style={{ justifyContent: 'flex-end' }}>
                            <button className="btn ghost sm" onClick={() => onEdit(r.draft!)}>Editează</button>
                            {saved.has(r.id)
                              ? <span className="badge badge-approved">salvat ✓</span>
                              : <button className="btn sm" onClick={() => save(r)}>Salvează și monitorizează</button>}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <div className="ai-examples">
        {EXAMPLES.map((e) => <button key={e} className="chip" onClick={() => setMsg(e)}>{e}</button>)}
      </div>
      <div className="ai-input">
        <select value={page} onChange={(e) => setPage(e.target.value)} title="Pe ce pagină">
          {pageOptions.map((u) => <option key={u} value={u}>{pageLabel(u)}</option>)}
        </select>
        <textarea
          rows={2} maxLength={1000} value={msg} placeholder="Ex: scrie „pantofi” în căutare, apasă Enter și verifică că apar rezultate"
          onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        />
        <button className="btn" disabled={sending || thinking || msg.trim().length < 3} onClick={send}>
          {sending || thinking ? <span className="spinner" /> : 'Creează'}
        </button>
      </div>
      {error && <p className="notice error">{error}</p>}
    </div>
  )
}
