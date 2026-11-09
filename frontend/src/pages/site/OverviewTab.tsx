import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Radar, StatusIcon } from '../../components/ui'
import { fadeUp, stagger } from '../../components/motion'
import { ArchitectureCard, SiteMap } from './SiteSchema'
import { PagesPanel } from './PagesPanel'
import { CHECK_HELP } from '../../components/checkHelp'
import { Accordion } from '../../components/Accordion'
import type { Check, CheckGroup, CheckStatus, NetworkResult, PageCheck, Site } from '../../types'

const CAP_MS = 45_000
const barColor = (ms: number | null | undefined, good: number, ok: number) =>
  ms == null ? 'var(--bad)' : ms <= good ? 'var(--ok)' : ms <= ok ? 'var(--warn)' : 'var(--bad)'

const lcpLabel = (ms: number | null | undefined) => (ms == null ? 'nu apare în 45 s' : `${(ms / 1000).toFixed(1)} s`)

function NetworkBars({ results }: { results: NetworkResult[] }) {
  const rows = results.filter((r) => !r.error)
  return (
    <div style={{ display: 'grid', gap: '0.9rem' }}>
      <p className="muted small" style={{ margin: 0 }}>Telefon simulat, procesor încetinit. Când apare conținutul principal (LCP).</p>
      {rows.map((r) => {
        const ms = r.lcp_ms ?? null
        const pct = Math.min(100, ((ms ?? CAP_MS) / CAP_MS) * 100)
        return (
          <div key={r.id}>
            <div className="row small" style={{ marginBottom: '0.35rem' }}>
              <span>{r.label}</span>
              <span className="muted">{lcpLabel(ms)}{r.bytes ? ` · ${(r.bytes / 1e6).toFixed(1)} MB` : ''}</span>
            </div>
            <div style={{ height: 10, borderRadius: 999, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              <motion.div
                initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1.1, ease: 'easeOut' }}
                style={{ height: '100%', borderRadius: 999, background: barColor(ms, r.id === '3g' ? 8000 : 4000, r.id === '3g' ? 20_000 : 10_000) }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

const GROUPS: { id: CheckGroup; label: string; hint: string }[] = [
  { id: 'availability', label: 'Disponibilitate', hint: 'Site-ul răspunde și e accesibil securizat' },
  { id: 'performance', label: 'Viteză', hint: 'Cât așteaptă vizitatorii' },
  { id: 'network', label: 'Conexiune slabă', hint: 'Simulare telefon pe 4G slab și 3G' },
  { id: 'content', label: 'Funcționalitate', hint: 'Link-uri, imagini și erori în pagină' },
  { id: 'text', label: 'Text și conținut', hint: 'Greșeli de scriere, text uitat, caractere stricate, duplicate' },
  { id: 'seo', label: 'SEO & mobil', hint: 'Cum te văd Google și telefoanele' },
  { id: 'security', label: 'Securitate', hint: 'Recomandări de configurare (nu vulnerabilități)' },
  { id: 'compliance', label: 'Conformitate legală', hint: 'Ce cer legile de protecția datelor și a consumatorilor din majoritatea țărilor' },
]

const worst = (statuses: CheckStatus[]): CheckStatus =>
  statuses.includes('fail') ? 'fail' : statuses.includes('warn') ? 'warn' : 'pass'

// Lower = more urgent: fail > warn (real problem) > hardening > not measured > pass
const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2, hardening: 3 }
function urgency(c: Check) {
  if (c.status === 'pass') return 9
  if (c.verdict === 'needs_validation') return 5
  return SEVERITY_RANK[c.severity ?? ''] ?? (c.status === 'fail' ? 1 : 2)
}
const byUrgency = (a: Check, b: Check) => urgency(a) - urgency(b)

export function OverviewTab({ site, pages, onDeep }: { site: Site; pages: PageCheck[]; onDeep: (pageId: string) => void }) {
  // User toggles override the per-section defaults
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const o = site.overview
  const scanning = site.scan_status === 'pending' || site.scan_status === 'scanning'

  if (scanning && !o?.partial) {
    return (
      <div className="card">
        <Radar label="Analizăm site-ul…" />
        <p className="muted" style={{ textAlign: 'center', marginTop: '-1.5rem' }}>
          Parcurgem paginile, verificăm link-urile, viteza, SEO, securitatea și simulăm o conexiune slabă. Durează în jur de un minut.
        </p>
      </div>
    )
  }
  if (site.scan_status === 'error') {
    return <div className="card"><p className="notice error" style={{ margin: 0 }}>Nu am putut analiza site-ul: {site.scan_error}</p></div>
  }
  if (!o) return <p className="muted">Nicio analiză încă.</p>
  if (o.blocked) {
    return (
      <div className="card">
        <h2>Site-ul blochează vizitatorii automați</h2>
        <p className="muted">
          Serverul a răspuns cu HTTP {o.status} — protecție anti-bot (ex. Cloudflare, Akamai). Ca să putem testa,
          proprietarul site-ului trebuie să permită accesul FlowGuardian (allowlist).
        </p>
      </div>
    )
  }

  const counts = { fail: 0, warn: 0, pass: 0 }
  o.checks.forEach((c) => counts[c.status]++)
  const { broken_links = [], broken_images = [], js_errors = [], slow_pages = [] } = o.issues
  const hasIssues = broken_links.length + broken_images.length + js_errors.length + slow_pages.length > 0

  const groups = GROUPS
    .map((g) => ({ ...g, checks: o.checks.filter((c) => c.group === g.id).sort(byUrgency) }))
    .filter((g) => g.checks.length)
  const problemGroups = groups
    .filter((g) => g.checks.some((c) => c.status !== 'pass'))
    .sort((a, b) => urgency(a.checks[0]) - urgency(b.checks[0])
      || b.checks.filter((c) => c.status !== 'pass').length - a.checks.filter((c) => c.status !== 'pass').length)
  const okGroups = groups.filter((g) => g.checks.every((c) => c.status === 'pass'))
  const network = (o.network ?? []).filter((r) => !r.error)
  const issueCount = broken_links.length + broken_images.length + js_errors.length + slow_pages.length

  // Closed sections still show a one-line summary; only the most urgent things start open
  const defaults: Record<string, boolean> = {
    ...Object.fromEntries(problemGroups.map((g, i) => [g.id, i === 0 || g.checks.some((c) => c.status === 'fail')])),
    ok: false, network: false, issues: broken_links.length > 0, schema: false, pages: false,
  }
  const isOpen = (id: string) => toggled[id] ?? defaults[id] ?? false
  const toggle = (id: string) => setToggled((s) => ({ ...s, [id]: !(s[id] ?? defaults[id] ?? false) }))
  const setAll = (v: boolean) => setToggled(Object.fromEntries(Object.keys(defaults).map((k) => [k, v])))
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

  return (
    <motion.div variants={stagger} initial="hidden" animate="show">
      {scanning && (
        <div className="notice-progress">
          <span className="spinner" />
          <span>Primele rezultate, din pagina principală. Continuăm cu restul paginilor, textul (greșeli, duplicate), link-urile și conexiunea slabă — se actualizează singur în ~2 minute.</span>
        </div>
      )}
      <motion.div className="summary" variants={stagger}>
        {([['fail', 'Probleme'], ['warn', 'Recomandări'], ['pass', 'În regulă']] as const).map(([k, label]) => (
          <motion.div key={k} variants={fadeUp} className="card stat">
            <span className={`dot ${k}`} />
            <div><b>{counts[k]}</b><div className="muted small">{label}</div></div>
          </motion.div>
        ))}
      </motion.div>

      <div className="acc-toolbar">
        <button className="fold" onClick={() => setAll(true)}>Deschide tot</button>
        <span className="muted small">·</span>
        <button className="fold" onClick={() => setAll(false)}>Închide tot</button>
      </div>

      <motion.div className="acc-list" variants={stagger}>
        {problemGroups.map((g) => {
          const fails = g.checks.filter((c) => c.status === 'fail').length
          const warns = g.checks.filter((c) => c.status === 'warn').length
          const passed = g.checks.length - fails - warns
          return (
            <motion.div key={g.id} variants={fadeUp}>
              <Accordion
                open={isOpen(g.id)} onToggle={() => toggle(g.id)} className={`group ${worst(g.checks.map((c) => c.status))}`}
                title={<h3><StatusIcon status={worst(g.checks.map((c) => c.status))} /> {g.label}</h3>}
                summary={[fails && plural(fails, 'problemă', 'probleme'), warns && plural(warns, 'recomandare', 'recomandări')].filter(Boolean).join(' · ') + ` — ${g.hint}`}
                aside={<span className="muted small">{passed}/{g.checks.length} OK</span>}
              >
                <GroupBody checks={g.checks} />
              </Accordion>
            </motion.div>
          )
        })}

        {network.length > 0 && (
          <motion.div variants={fadeUp}>
            <Accordion
              open={isOpen('network')} onToggle={() => toggle('network')}
              title={<h3>Cum arată site-ul pe o conexiune slabă</h3>}
              summary={network.map((r) => `${r.label}: ${lcpLabel(r.lcp_ms)}`).join(' · ')}
            >
              <NetworkBars results={network} />
            </Accordion>
          </motion.div>
        )}

        {hasIssues && (
          <motion.div variants={fadeUp}>
            <Accordion
              open={isOpen('issues')} onToggle={() => toggle('issues')}
              title={<h3>Ce trebuie reparat</h3>}
              summary={[
                broken_links.length && plural(broken_links.length, 'link stricat', 'link-uri stricate'),
                broken_images.length && plural(broken_images.length, 'imagine lipsă', 'imagini lipsă'),
                js_errors.length && plural(js_errors.length, 'eroare JS', 'erori JS'),
                slow_pages.length && plural(slow_pages.length, 'pagină lentă', 'pagini lente'),
              ].filter(Boolean).join(' · ')}
              aside={<span className="count">{issueCount}</span>}
            >
              <div className="list">
                <IssueBlock title="Link-uri stricate" status="fail" items={broken_links.map((l) => ({
                  key: l.url, main: l.url, side: `${l.status || 'fără răspuns'} · pe ${l.pages} ${l.pages === 1 ? 'pagină' : 'pagini'}`,
                }))} />
                <IssueBlock title="Imagini care nu se încarcă" status="warn" items={broken_images.map((i) => ({
                  key: i.url, main: i.url, side: `${i.status || 'eșuat'} · pe ${i.pages} ${i.pages === 1 ? 'pagină' : 'pagini'}`,
                }))} />
                <IssueBlock title="Erori JavaScript" status="warn" items={js_errors.map((e) => ({
                  key: e.message, main: e.message, side: `pe ${e.pages} ${e.pages === 1 ? 'pagină' : 'pagini'}`,
                }))} />
                <IssueBlock title="Pagini lente" status="warn" items={slow_pages.map((p) => ({
                  key: p.url, main: p.url, side: `${(p.load_ms / 1000).toFixed(1)} s`,
                }))} />
              </div>
            </Accordion>
          </motion.div>
        )}

        {okGroups.length > 0 && (
          <motion.div variants={fadeUp}>
            <Accordion
              open={isOpen('ok')} onToggle={() => toggle('ok')} className="group pass"
              title={<h3><StatusIcon status="pass" /> Totul în regulă</h3>}
              summary={okGroups.map((g) => g.label).join(' · ')}
              aside={<span className="muted small">{okGroups.reduce((s, g) => s + g.checks.length, 0)} verificări</span>}
            >
              <div className="groups-ok">
                {okGroups.map((g) => <GroupCard key={g.id} label={g.label} hint={g.hint} checks={g.checks} compact />)}
              </div>
            </Accordion>
          </motion.div>
        )}

        {(o.map?.nodes.length || o.architecture) && (
          <motion.div variants={fadeUp}>
            <Accordion
              open={isOpen('schema')} onToggle={() => toggle('schema')}
              title={<h3>Schema site-ului</h3>}
              summary={[
                o.map?.nodes.length && plural(o.map.nodes.length, 'pagină în hartă', 'pagini în hartă'),
                o.architecture?.services.length && plural(o.architecture.services.length, 'serviciu extern', 'servicii externe'),
                o.architecture?.forms.length && plural(o.architecture.forms.length, 'formular', 'formulare'),
              ].filter(Boolean).join(' · ') || 'Harta paginilor și tehnologiile folosite'}
            >
              <div style={{ display: 'grid', gap: '0.9rem' }}>
                {!!o.map?.nodes.length && <SiteMap map={o.map} />}
                {o.architecture && <ArchitectureCard overview={o} />}
              </div>
            </Accordion>
          </motion.div>
        )}

        {pages.length > 0 && (
          <motion.div variants={fadeUp}>
            <Accordion
              open={isOpen('pages')} onToggle={() => toggle('pages')}
              title={<h3>Analiza fiecărei pagini</h3>}
              summary={`${plural(pages.length, 'pagină verificată', 'pagini verificate')}${pages.some((p) => (p.score ?? 100) < 60) ? ` · ${pages.filter((p) => (p.score ?? 100) < 60).length} cu scor slab` : ''}`}
              aside={<span className="count">{pages.length}</span>}
            >
              <PagesPanel site={site} pages={pages} onDeep={onDeep} />
            </Accordion>
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  )
}

function GroupBody({ checks }: { checks: Check[] }) {
  const [open, setOpen] = useState(false)
  const problems = checks.filter((c) => c.status !== 'pass')
  const passed = checks.filter((c) => c.status === 'pass')
  return (
    <>
      <div className="group-checks">{problems.map((c) => <CheckRow key={c.id} c={c} />)}</div>
      {passed.length > 0 && (
        <>
          <button className="fold" onClick={() => setOpen(!open)}>
            <motion.span animate={{ rotate: open ? 90 : 0 }} style={{ display: 'inline-block' }}>›</motion.span>
            {open ? 'Ascunde' : `${passed.length} ${passed.length === 1 ? 'verificare' : 'verificări'} în regulă`}
          </button>
          <AnimatePresence initial={false}>
            {open && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
                <div className="group-checks" style={{ marginTop: '0.5rem' }}>{passed.map((c) => <CheckRow key={c.id} c={c} />)}</div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </>
  )
}

function CheckRow({ c }: { c: Check }) {
  const [info, setInfo] = useState(false)
  const [showPages, setShowPages] = useState(false)
  const help = CHECK_HELP[c.id]
  return (
    <div className={`check ${c.status}`}>
      <StatusIcon status={c.status} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="label">{c.label}</div>
        <div className="detail">
          {c.detail}
          {c.verdict === 'needs_validation' && <span className="chip" style={{ marginLeft: '0.4rem' }}>nemăsurat</span>}
        </div>
        {!!c.pages?.length && (
          <button className="fold" onClick={() => setShowPages(!showPages)}>
            <motion.span animate={{ rotate: showPages ? 90 : 0 }} style={{ display: 'inline-block' }}>›</motion.span>
            {showPages ? 'Ascunde paginile' : `Vezi ${c.pages.length === 1 ? 'pagina' : `cele ${c.pages.length} pagini`}`}
          </button>
        )}
        <AnimatePresence initial={false}>
          {showPages && c.pages && (
            <motion.ul className="page-list" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
              {c.pages.map((p) => {
                const u = new URL(p.url)
                return (
                  <li key={p.url}>
                    <a href={p.url} target="_blank" rel="noreferrer" className="mono truncate" title={p.url}>{u.pathname + u.search}</a>
                    <span className="muted small">{p.note}</span>
                  </li>
                )
              })}
            </motion.ul>
          )}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {info && help && (
            <motion.div
              className="help" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            >
              <p><b>De ce contează:</b> {help.why}</p>
              {c.status !== 'pass' && <p><b>Cum repari:</b> {help.fix}</p>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {help && (
        <button className={`info-btn${info ? ' on' : ''}`} onClick={() => setInfo(!info)} aria-label="Detalii" title="De ce contează și cum repari">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="12" cy="12" r="9.5" /><path d="M12 11v6M12 7.5h.01" />
          </svg>
        </button>
      )}
    </div>
  )
}

// Problem groups: full width, problems listed. OK groups: compact, checks folded.
function GroupCard({ label, hint, checks, compact }: { label: string; hint: string; checks: Check[]; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const problems = checks.filter((c) => c.status !== 'pass')
  const passed = checks.filter((c) => c.status === 'pass')
  return (
    <motion.div variants={fadeUp} initial="hidden" animate="show" className={`card group ${worst(checks.map((c) => c.status))}`}>
      <div className="group-head">
        <h3><StatusIcon status={worst(checks.map((c) => c.status))} /> {label}</h3>
        <span className="muted small">{passed.length}/{checks.length} OK</span>
      </div>
      {!compact && <p className="muted small" style={{ margin: '-0.3rem 0 0.7rem' }}>{hint}</p>}
      {problems.length > 0 && <div className="group-checks">{problems.map((c) => <CheckRow key={c.id} c={c} />)}</div>}
      {passed.length > 0 && (
        <>
          <button className="fold" onClick={() => setOpen(!open)}>
            <motion.span animate={{ rotate: open ? 90 : 0 }} style={{ display: 'inline-block' }}>›</motion.span>
            {open ? 'Ascunde' : `${passed.length} ${passed.length === 1 ? 'verificare' : 'verificări'} în regulă`}
          </button>
          <AnimatePresence initial={false}>
            {open && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
                <div className="group-checks">{passed.map((c) => <CheckRow key={c.id} c={c} />)}</div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </motion.div>
  )
}

function IssueBlock({ title, status, items }: { title: string; status: CheckStatus; items: { key: string; main: string; side: string }[] }) {
  if (!items.length) return null
  return (
    <details className="card" open={status === 'fail'}>
      <summary className="row">
        <h3 style={{ margin: 0, display: 'flex', gap: '0.5rem', alignItems: 'center' }}><StatusIcon status={status} /> {title}</h3>
        <span className="count">{items.length}</span>
      </summary>
      <div className="issue-list">
        {items.map((i) => (
          <div key={i.key} className="issue">
            <span className="mono truncate">{i.main}</span>
            <span className="muted small" style={{ whiteSpace: 'nowrap' }}>{i.side}</span>
          </div>
        ))}
      </div>
    </details>
  )
}
