import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { supabase } from '../lib/supabase'
import { fadeUp, stagger } from '../components/motion'
import { Accordion } from '../components/Accordion'
import type { ApiCheck, ApiHeader, ApiMethod, ApiMonitor, ApiRule, ApiRuleOp } from '../apiTypes'

const METHODS: ApiMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']
const FREQUENCIES = [[15, '15 min'], [30, '30 min'], [60, '1 oră'], [360, '6 ore'], [1440, '1 zi']] as const
const OPS: { op: ApiRuleOp; label: string; needsValue: boolean; needsPath: boolean }[] = [
  { op: '>', label: '>', needsValue: true, needsPath: true },
  { op: '>=', label: '≥', needsValue: true, needsPath: true },
  { op: '<', label: '<', needsValue: true, needsPath: true },
  { op: '<=', label: '≤', needsValue: true, needsPath: true },
  { op: '==', label: '=', needsValue: true, needsPath: true },
  { op: '!=', label: '≠', needsValue: true, needsPath: true },
  { op: 'contains', label: 'conține', needsValue: true, needsPath: true },
  { op: 'exists', label: 'există', needsValue: false, needsPath: true },
  { op: 'not_exists', label: 'nu există', needsValue: false, needsPath: true },
  { op: 'text_contains', label: 'textul răspunsului conține', needsValue: true, needsPath: false },
]
const opInfo = (op: ApiRuleOp) => OPS.find((o) => o.op === op)!
const HISTORY_DAYS = 7

type Draft = Omit<ApiMonitor, 'id' | 'run_requested' | 'last_status' | 'last_checked_at' | 'created_at'>
const EMPTY: Draft = {
  name: '', url: '', method: 'GET', headers: [], body: '', expected_status: 200, max_ms: 2000, rules: [], frequency_minutes: 15, enabled: true,
}

const ago = (iso: string | null, now: number) => {
  if (!iso) return 'încă nu'
  const min = Math.round((now - new Date(iso).getTime()) / 60_000)
  return min < 1 ? 'acum' : min < 60 ? `acum ${min} min` : min < 1440 ? `acum ${Math.round(min / 60)} h` : new Date(iso).toLocaleDateString('ro-RO')
}

export function ApiGuardian() {
  const [monitors, setMonitors] = useState<ApiMonitor[]>([])
  const [checks, setChecks] = useState<ApiCheck[]>([])
  const [now, setNow] = useState(0)
  const [editing, setEditing] = useState<ApiMonitor | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const t = Date.now()
    const since = new Date(t - HISTORY_DAYS * 86_400_000).toISOString()
    const [m, c] = await Promise.all([
      supabase.from('api_monitors').select('*').order('created_at'),
      supabase.from('api_checks').select('*').gte('created_at', since).order('created_at', { ascending: false }).limit(5000),
    ])
    if (m.error ?? c.error) setError((m.error ?? c.error)!.message)
    setMonitors((m.data as ApiMonitor[]) ?? [])
    setChecks((c.data as ApiCheck[]) ?? [])
    setNow(t)
  }, [])

  useEffect(() => {
    load()
    const channel = supabase.channel('api-guardian')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'api_monitors' }, () => load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'api_checks' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  async function act(p: PromiseLike<{ error: { message: string } | null }>) {
    const { error } = await p
    if (error) setError(error.message)
    else load()
  }

  const down = monitors.filter((m) => m.enabled && m.last_status && m.last_status !== 'passed').length

  return (
    <motion.div variants={stagger} initial="hidden" animate="show">
      <motion.div variants={fadeUp} className="section-head" style={{ marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>API Guardian</h1>
          <p className="muted">Verificăm periodic API-urile: răspund, cât de repede și dacă datele sunt corecte.</p>
        </div>
        {editing !== 'new' && <button className="btn" onClick={() => setEditing('new')}>+ Monitor nou</button>}
      </motion.div>
      {error && <p className="notice error">{error}</p>}

      <AnimatePresence>
        {editing === 'new' && (
          <MonitorForm key="new" initial={EMPTY} onCancel={() => setEditing(null)}
            onSave={async (d) => { await act(supabase.from('api_monitors').insert(d)); setEditing(null) }} />
        )}
      </AnimatePresence>

      {monitors.length > 0 && (
        <motion.div variants={fadeUp} className="summary">
          <div className="card stat"><span className="dot pass" /><div><b>{monitors.filter((m) => m.enabled && m.last_status === 'passed').length}</b><div className="muted small">Funcționează</div></div></div>
          <div className="card stat"><span className="dot fail" /><div><b>{down}</b><div className="muted small">Cu probleme</div></div></div>
          <div className="card stat"><span className="dot warn" /><div><b>{monitors.filter((m) => !m.enabled || !m.last_status).length}</b><div className="muted small">În pauză / neverificate</div></div></div>
        </motion.div>
      )}

      {monitors.length === 0 && editing !== 'new' ? (
        <motion.div variants={fadeUp} className="card" style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
          <h3>Niciun API monitorizat încă</h3>
          <p className="muted">Adaugă un endpoint, de exemplu <span className="mono">https://api.magazin.ro/products</span>, cu regula <span className="mono">length &gt; 0</span>.</p>
          <button className="btn" onClick={() => setEditing('new')}>+ Monitor nou</button>
        </motion.div>
      ) : (
        <div className="list">
          {monitors.map((m) => editing !== 'new' && editing?.id === m.id ? (
            <MonitorForm key={m.id} initial={m} onCancel={() => setEditing(null)}
              onSave={async (d) => { await act(supabase.from('api_monitors').update(d).eq('id', m.id)); setEditing(null) }} />
          ) : (
            <MonitorCard key={m.id} monitor={m} checks={checks.filter((c) => c.monitor_id === m.id)} now={now}
              onEdit={() => setEditing(m)}
              onRun={() => act(supabase.from('api_monitors').update({ run_requested: true }).eq('id', m.id))}
              onToggle={() => act(supabase.from('api_monitors').update({ enabled: !m.enabled }).eq('id', m.id))}
              onDelete={() => { if (confirm(`Ștergi monitorul „${m.name}”?`)) act(supabase.from('api_monitors').delete().eq('id', m.id)) }} />
          ))}
        </div>
      )}
    </motion.div>
  )
}

const HTTP_TEXT: Record<number, string> = {
  200: 'OK', 201: 'creat', 202: 'acceptat', 204: 'fără conținut', 301: 'mutat permanent', 302: 'redirecționare', 304: 'nemodificat',
  400: 'cerere greșită', 401: 'lipsește autentificarea', 403: 'acces interzis', 404: 'adresa nu există', 405: 'metodă nepermisă',
  408: 'timp expirat', 429: 'prea multe cereri', 500: 'eroare internă pe server', 502: 'gateway greșit', 503: 'serviciu indisponibil', 504: 'serverul nu a răspuns la timp',
}
const httpLabel = (code: number) => `${code}${HTTP_TEXT[code] ? ` (${HTTP_TEXT[code]})` : ''}`

const OP_WORDS: Partial<Record<ApiRuleOp, string>> = {
  '>': 'mai mare decât', '>=': 'cel puțin', '<': 'mai mic decât', '<=': 'cel mult', '==': 'egal cu', '!=': 'diferit de', contains: 'conține',
}
function ruleText(r: ApiRule) {
  if (r.op === 'text_contains') return <>Răspunsul conține textul <code>{r.value}</code></>
  if (r.op === 'exists') return <>Câmpul <code>{r.path}</code> există în răspuns</>
  if (r.op === 'not_exists') return <>Câmpul <code>{r.path}</code> nu apare în răspuns</>
  const list = r.path.match(/^(.*)\.length$/)
  const subject = list ? <>Numărul de elemente din <code>{list[1] || 'răspuns'}</code></> : <>Valoarea <code>{r.path}</code></>
  return <>{subject} e {OP_WORDS[r.op]} <code>{r.value}</code></>
}

const shortUrl = (raw: string) => {
  try { const u = new URL(raw); return `${u.host}${u.pathname === '/' ? '' : u.pathname}` } catch { return raw }
}
const decode = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }
const when = (iso: string) => new Date(iso).toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short' })

type Mark = 'ok' | 'fail' | 'unknown'

function MonitorCard({ monitor: m, checks, now, onEdit, onRun, onToggle, onDelete }: {
  monitor: ApiMonitor; checks: ApiCheck[]; now: number; onEdit: () => void; onRun: () => void; onToggle: () => void; onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const day = checks.filter((c) => now - new Date(c.created_at).getTime() < 86_400_000)
  const uptime = (list: ApiCheck[]) => (list.length ? `${((list.filter((c) => c.status === 'passed').length / list.length) * 100).toFixed(1)}%` : '—')
  const timed = checks.filter((c) => c.duration_ms != null)
  const avg = timed.length ? Math.round(timed.reduce((s, c) => s + c.duration_ms!, 0) / timed.length) : null
  const last = checks[0]
  const state = !m.enabled ? 'paused' : m.last_status ?? 'pending'
  const freq = FREQUENCIES.find(([v]) => v === m.frequency_minutes)?.[1] ?? `${m.frequency_minutes} min`
  const STATE_LABEL: Record<string, string> = { passed: 'Funcționează', failed: 'Date greșite', error: 'Nu răspunde', paused: 'În pauză', pending: 'Neverificat' }

  return (
    <motion.div variants={fadeUp} className="api-wrap">
      <Accordion
        open={open} onToggle={() => setOpen(!open)} className={`api-card ${state}`}
        title={
          <div className="api-title">
            <span className={`dot ${state === 'passed' ? 'pass' : state === 'paused' || state === 'pending' ? 'warn' : 'fail'}`} />
            <div style={{ minWidth: 0 }}>
              <div className="title truncate">{m.name}</div>
              <div className="muted small truncate"><span className="method">{m.method}</span>{shortUrl(m.url)}</div>
            </div>
          </div>
        }
        aside={
          <div className="api-aside">
            <span className={`api-pill ${state}`}>{STATE_LABEL[state]}</span>
            <span className="muted small nowrap">{avg != null ? `~${avg} ms` : ''}</span>
          </div>
        }
      >
        <div className="api-body">
          <Verdict m={m} last={last} />

          <div className="api-tiles">
            <div><b>{uptime(day)}</b><span>disponibil în ultimele 24h</span></div>
            <div><b>{uptime(checks)}</b><span>disponibil în ultimele {HISTORY_DAYS} zile</span></div>
            <div><b>{avg != null ? `${avg} ms` : '—'}</b><span>timp mediu de răspuns</span></div>
            <div><b>{ago(m.last_checked_at, now)}</b><span>ultima verificare · la fiecare {freq}</span></div>
          </div>

          <section>
            <h4>Ce verificăm</h4>
            <Checklist m={m} last={last} />
          </section>

          {timed.length > 1 && (
            <section>
              <h4>Timp de răspuns <span className="muted small">— ultimele {Math.min(timed.length, 40)} verificări</span></h4>
              <ResponseChart checks={checks.slice(0, 40).reverse()} max={m.max_ms} />
            </section>
          )}

          <section>
            <h4>Adresa</h4>
            <Endpoint m={m} />
          </section>

          <section>
            <h4>Istoric</h4>
            {checks.length === 0 ? <p className="muted small">Nicio verificare în ultimele {HISTORY_DAYS} zile.</p> : <History checks={checks} />}
          </section>

          <div className="actions api-actions">
            <button className="btn sm" disabled={!m.enabled || m.run_requested} onClick={onRun}>{m.run_requested ? 'Programat…' : 'Rulează acum'}</button>
            <button className="btn ghost sm" onClick={onToggle}>{m.enabled ? 'Pune pe pauză' : 'Activează'}</button>
            <button className="btn ghost sm" onClick={onEdit}>Editează</button>
            <button className="btn ghost sm danger" onClick={onDelete}>Șterge</button>
          </div>
        </div>
      </Accordion>
    </motion.div>
  )
}

function Verdict({ m, last }: { m: ApiMonitor; last: ApiCheck | undefined }) {
  if (!m.enabled) return <div className="api-verdict warn"><b>Monitorul e în pauză.</b> Nu mai verificăm acest API până îl reactivezi.</div>
  if (m.run_requested) return <div className="api-verdict warn"><b>Verificare programată.</b> Rulează la următoarea trecere a worker-ului (în maxim 15 minute).</div>
  if (!last) return <div className="api-verdict warn"><b>Încă nu l-am verificat.</b> Prima verificare are loc automat sau apasă „Rulează acum”.</div>
  if (last.status === 'passed') {
    return (
      <div className="api-verdict ok">
        <b>Totul e în regulă.</b> API-ul a răspuns în {last.duration_ms} ms cu {httpLabel(last.http_status!)}
        {m.rules.length > 0 && <>, iar {m.rules.length === 1 ? 'regula ta e respectată' : `toate cele ${m.rules.length} reguli sunt respectate`}</>}.
      </div>
    )
  }
  if (last.status === 'error') {
    return (
      <div className="api-verdict bad">
        <b>Nu am putut contacta API-ul.</b> {last.error}
        <div className="api-tip">Verifică dacă adresa e corectă, dacă serverul e pornit și dacă e accesibil public de pe internet.</div>
      </div>
    )
  }
  return (
    <div className="api-verdict bad">
      <b>API-ul răspunde, dar ceva nu e cum trebuie:</b>
      <ul>{last.failures.map((f, i) => <li key={i}>{f.message}</li>)}</ul>
    </div>
  )
}

function Checklist({ m, last }: { m: ApiMonitor; last: ApiCheck | undefined }) {
  const known = last && last.status !== 'error'
  const mark = (failed: boolean): Mark => (!known ? 'unknown' : failed ? 'fail' : 'ok')
  const has = (kind: string) => !!last?.failures.some((f) => f.kind === kind)
  const ruleFailed = (r: ApiRule) => !!last?.failures.some((f) =>
    f.kind === 'rule' && f.rule?.path === r.path && f.rule?.op === r.op && String(f.rule?.value) === String(r.value))
  const items: { mark: Mark; text: ReactNode; actual?: string }[] = [
    { mark: mark(has('status')), text: <>Răspunde cu codul <code>{httpLabel(m.expected_status)}</code></>, actual: known && last?.http_status != null ? `primit ${httpLabel(last.http_status)}` : undefined },
    { mark: mark(has('speed')), text: <>Răspunde în mai puțin de <code>{m.max_ms} ms</code></>, actual: known && last?.duration_ms != null ? `${last.duration_ms} ms` : undefined },
    ...m.rules.map((r) => ({ mark: mark(ruleFailed(r)), text: ruleText(r) })),
  ]
  return (
    <ul className="api-checklist">
      {items.map((it, i) => (
        <li key={i} className={it.mark}>
          <span className="api-mark">{it.mark === 'ok' ? '✓' : it.mark === 'fail' ? '✕' : '?'}</span>
          <span style={{ flex: 1 }}>{it.text}</span>
          {it.actual && <span className="muted small nowrap">{it.actual}</span>}
        </li>
      ))}
      {m.rules.length === 0 && <li className="hint muted small">Poți adăuga reguli pe conținut (ex. „lista de produse nu e goală”) din Editează.</li>}
    </ul>
  )
}

function Endpoint({ m }: { m: ApiMonitor }) {
  let url: URL | null = null
  try { url = new URL(m.url) } catch { /* shown raw below */ }
  const params = url ? [...url.searchParams.entries()] : []
  return (
    <div className="api-endpoint">
      <div className="api-endpoint-line"><span className="method">{m.method}</span><span className="mono">{url ? `${url.origin}${url.pathname}` : m.url}</span></div>
      {params.length > 0 && (
        <dl className="api-params">
          {params.map(([k, v], i) => <div key={i}><dt className="mono">{k}</dt><dd className="mono">{decode(v)}</dd></div>)}
        </dl>
      )}
      {m.headers.length > 0 && <div className="muted small">Trimitem {m.headers.length} {m.headers.length === 1 ? 'header' : 'headere'}: {m.headers.map((h) => h.name).join(', ')} (valorile rămân ascunse).</div>}
    </div>
  )
}

function History({ checks }: { checks: ApiCheck[] }) {
  const [limit, setLimit] = useState(10)
  const [shown, setShown] = useState<string | null>(null)
  return (
    <ul className="api-history">
      {checks.slice(0, limit).map((c) => {
        const ok = c.status === 'passed'
        const open = shown === c.id
        return (
          <li key={c.id} className={open ? 'open' : undefined}>
            <button className="api-history-row" disabled={!c.response_sample} onClick={() => setShown(open ? null : c.id)}>
              <span className={`hdot ${c.status}`} />
              <span className="muted small nowrap">{when(c.created_at)}</span>
              <span className="api-history-msg">
                {ok ? 'OK' : c.error ?? c.failures.map((f) => f.message).join(' · ')}
              </span>
              <span className="muted small nowrap">{c.http_status ?? '—'} · {c.duration_ms != null ? `${c.duration_ms} ms` : '—'}</span>
              {c.response_sample && <span className="muted small nowrap">{open ? 'ascunde' : 'răspuns ›'}</span>}
            </button>
            {open && c.response_sample && <pre className="api-sample">{c.response_sample}</pre>}
          </li>
        )
      })}
      {checks.length > limit && <li><button className="fold" onClick={() => setLimit(limit + 20)}>Arată mai multe ({checks.length - limit})</button></li>}
    </ul>
  )
}

function ResponseChart({ checks, max }: { checks: ApiCheck[]; max: number }) {
  const top = Math.max(max, ...checks.map((c) => c.duration_ms ?? 0)) * 1.1
  return (
    <div className="api-chart">
      <div className="api-chart-limit" style={{ bottom: `${(max / top) * 100}%` }}><span>limita {max} ms</span></div>
      {checks.map((c, i) => (
        <motion.div
          key={c.id} title={`${when(c.created_at)} · ${c.duration_ms ?? '—'} ms`}
          className={`api-bar ${c.status === 'passed' ? 'ok' : 'bad'}`}
          initial={{ height: 0 }} animate={{ height: `${Math.max(4, ((c.duration_ms ?? top) / top) * 100)}%` }}
          transition={{ duration: 0.4, delay: i * 0.01 }}
        />
      ))}
    </div>
  )
}

function MonitorForm({ initial, onSave, onCancel }: { initial: Draft; onSave: (d: Draft) => Promise<void>; onCancel: () => void }) {
  const [d, setD] = useState<Draft>({
    name: initial.name, url: initial.url, method: initial.method, headers: initial.headers, body: initial.body ?? '',
    expected_status: initial.expected_status, max_ms: initial.max_ms, rules: initial.rules, frequency_minutes: initial.frequency_minutes, enabled: initial.enabled,
  })
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }))
  const setHeader = (i: number, h: Partial<ApiHeader>) => set('headers', d.headers.map((x, j) => (j === i ? { ...x, ...h } : x)))
  const setRule = (i: number, r: Partial<ApiRule>) => set('rules', d.rules.map((x, j) => (j === i ? { ...x, ...r } : x)))
  const hasBody = !['GET', 'HEAD'].includes(d.method)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    await onSave({
      ...d,
      name: d.name.trim() || new URL(d.url).host,
      body: hasBody && d.body ? d.body : null,
      headers: d.headers.filter((h) => h.name.trim()),
      rules: d.rules.filter((r) => !opInfo(r.op).needsPath || r.path.trim()),
    })
    setBusy(false)
  }

  return (
    <motion.form initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="card api-form" onSubmit={submit}>
      <div className="api-form-row">
        <select value={d.method} onChange={(e) => set('method', e.target.value as ApiMethod)} style={{ width: 110 }}>
          {METHODS.map((m) => <option key={m}>{m}</option>)}
        </select>
        <input required type="url" placeholder="https://api.exemplu.ro/v1/products" value={d.url} onChange={(e) => set('url', e.target.value)} style={{ flex: 1 }} />
      </div>
      <div className="api-form-grid">
        <label>Nume<input placeholder="Lista de produse" value={d.name} onChange={(e) => set('name', e.target.value)} /></label>
        <label>Status așteptat<input type="number" min={100} max={599} value={d.expected_status} onChange={(e) => set('expected_status', Number(e.target.value))} /></label>
        <label>Timp maxim (ms)<input type="number" min={100} max={60000} step={100} value={d.max_ms} onChange={(e) => set('max_ms', Number(e.target.value))} /></label>
        <label>Frecvență
          <select value={d.frequency_minutes} onChange={(e) => set('frequency_minutes', Number(e.target.value))}>
            {FREQUENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>

      <fieldset>
        <legend>Headere <span className="muted small">(ex. Authorization — vizibile doar pentru tine)</span></legend>
        {d.headers.map((h, i) => (
          <div key={i} className="api-form-row">
            <input placeholder="Authorization" value={h.name} onChange={(e) => setHeader(i, { name: e.target.value })} style={{ width: 200 }} />
            <input type="password" autoComplete="off" placeholder="Bearer …" value={h.value} onChange={(e) => setHeader(i, { value: e.target.value })} style={{ flex: 1 }} />
            <button type="button" className="btn ghost sm" onClick={() => set('headers', d.headers.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button type="button" className="fold" onClick={() => set('headers', [...d.headers, { name: '', value: '' }])}>+ adaugă header</button>
      </fieldset>

      {hasBody && (
        <fieldset>
          <legend>Body</legend>
          <textarea rows={4} className="mono" placeholder='{"query": "test"}' value={d.body ?? ''} onChange={(e) => set('body', e.target.value)} />
        </fieldset>
      )}

      <fieldset>
        <legend>Reguli pe răspuns <span className="muted small">(ex. <span className="mono">products.length &gt; 0</span>, <span className="mono">data[0].price exists</span>)</span></legend>
        {d.rules.map((r, i) => {
          const info = opInfo(r.op)
          return (
            <div key={i} className="api-form-row">
              {info.needsPath && <input placeholder="products.length" className="mono" value={r.path} onChange={(e) => setRule(i, { path: e.target.value })} style={{ flex: 1 }} />}
              <select value={r.op} onChange={(e) => setRule(i, { op: e.target.value as ApiRuleOp })} style={{ width: info.needsPath ? 130 : 230 }}>
                {OPS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
              </select>
              {info.needsValue && <input placeholder={r.op === 'text_contains' ? 'text' : '0'} className="mono" value={r.value} onChange={(e) => setRule(i, { value: e.target.value })} style={{ flex: 1 }} />}
              <button type="button" className="btn ghost sm" onClick={() => set('rules', d.rules.filter((_, j) => j !== i))}>✕</button>
            </div>
          )
        })}
        <button type="button" className="fold" onClick={() => set('rules', [...d.rules, { path: '', op: '>', value: '0' }])}>+ adaugă regulă</button>
      </fieldset>

      <div className="row">
        <span className="muted small">Verificăm doar adrese publice; redirecționările nu sunt urmate.</span>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onCancel}>Renunță</button>
          <button className="btn" disabled={busy}>{busy ? <span className="spinner" /> : null} Salvează</button>
        </div>
      </div>
    </motion.form>
  )
}
