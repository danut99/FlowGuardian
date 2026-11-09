import { useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import type { Architecture, CheckStatus, Overview, SiteMapData, SiteMapNode } from '../../types'

const W = 160
const H = 38
const GAP = 22
const PAGE_H = 30
const PAGE_GAP = 8
const PAD = 16
const MAX_SECTIONS = 6
const MAX_PAGES = 5

type Health = CheckStatus | 'muted'
const COLOR: Record<Health, string> = { pass: 'var(--ok)', warn: 'var(--warn)', fail: 'var(--bad)', muted: 'var(--muted)' }

const health = (n: SiteMapNode): CheckStatus =>
  n.error || (n.status ?? 0) >= 400 ? 'fail' : (n.load_ms ?? 0) > 5000 ? 'warn' : 'pass'
const worstOf = (ns: SiteMapNode[]): CheckStatus => {
  const hs = ns.map(health)
  return hs.includes('fail') ? 'fail' : hs.includes('warn') ? 'warn' : 'pass'
}
const short = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s)
const segments = (n: SiteMapNode) => new URL(n.url).pathname.split('/').filter(Boolean)
const tooltip = (n: SiteMapNode) =>
  `${n.url}\n${n.error ? 'error' : `HTTP ${n.status ?? '—'}`}${n.load_ms != null ? ` · ${(n.load_ms / 1000).toFixed(1)} s` : ''}`

type Section = { key: string; label: string; index: SiteMapNode | null; pages: SiteMapNode[]; from: number }

// Logical tree: home → first URL segment (section) → pages in that section
function groupPages(nodes: SiteMapNode[]) {
  const root = nodes.find((n) => n.depth === 0) ?? nodes[0]
  const rest = nodes.filter((n) => n !== root).map((n) => ({ n, s: segments(n) }))
  // Prefixes every page shares (/de-at/...) say nothing about structure
  let skip = 0
  while (rest.length && rest.every((x) => x.s.length > skip + 1 && x.s[skip] === rest[0].s[skip])) skip++

  const groups = new Map<string, Section>()
  for (const { n, s } of rest) {
    const key = s[skip] ?? ''
    const g = groups.get(key) ?? { key, label: key ? `/${key}` : '/', index: null, pages: [], from: skip + 1 }
    if (s.length === skip + 1 && !new URL(n.url).search && !g.index) g.index = n
    else g.pages.push(n)
    groups.set(key, g)
  }
  const size = (g: Section) => g.pages.length + (g.index ? 1 : 0)
  let list = [...groups.values()].sort((a, b) => size(b) - size(a))
  if (list.length > MAX_SECTIONS) {
    const extra = list.slice(MAX_SECTIONS - 1)
    list = [...list.slice(0, MAX_SECTIONS - 1), {
      key: '*', label: `Other (${extra.length})`, index: null, from: skip,
      pages: extra.flatMap((g) => (g.index ? [g.index, ...g.pages] : g.pages)),
    }]
  }
  return { root, sections: list, prefix: skip ? `/${segments(rest[0].n).slice(0, skip).join('/')}` : '' }
}

function pageLabel(n: SiteMapNode, from: number) {
  const u = new URL(n.url)
  const rest = segments(n).slice(from).join('/')
  return (rest ? `/${rest}` : '/') + u.search
}

function Node({ x, y, w, h, label, sub, status, node, delay, strong }: {
  x: number; y: number; w: number; h: number; label: string; sub?: string; status: Health
  node?: SiteMapNode; delay: number; strong?: boolean
}) {
  const chars = Math.floor((w - 30 - (sub ? sub.length * 7 + 6 : 0)) / 6.6)
  const body = (
    <motion.g
      className="map-node"
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: 'easeOut' }}
    >
      <rect x={x} y={y} width={w} height={h} rx={10} stroke={COLOR[status]} />
      <circle cx={x + 13} cy={y + h / 2} r={4} fill={COLOR[status]} />
      <text x={x + 24} y={y + h / 2 + 4} className={strong ? 'strong' : undefined}>{short(label, chars)}</text>
      {sub && <text x={x + w - 10} y={y + h / 2 + 4} textAnchor="end" className="sub">{sub}</text>}
    </motion.g>
  )
  if (!node) return body
  return (
    <a href={node.url} target="_blank" rel="noreferrer">
      <title>{tooltip(node)}</title>
      {body}
    </a>
  )
}

function Edge({ d, delay }: { d: string; delay: number }) {
  return (
    <motion.path
      d={d} className="map-edge" markerEnd="url(#fg-arrow)"
      initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }}
      transition={{ delay, duration: 0.5, ease: 'easeInOut' }}
    />
  )
}

export function SiteMap({ map }: { map: SiteMapData }) {
  const { root, sections, prefix } = groupPages(map.nodes)
  const cols = Math.max(1, sections.length)
  const width = cols * (W + GAP) - GAP + PAD * 2
  const rootW = Math.min(W + 60, width - PAD * 2)
  const rootX = (width - rootW) / 2
  const rootY = PAD
  const secY = rootY + H + 60
  const pageTop = secY + H + 20
  const rows = Math.max(0, ...sections.map((s) => Math.min(s.pages.length, MAX_PAGES) + (s.pages.length > MAX_PAGES ? 1 : 0)))
  const height = (rows ? pageTop + rows * (PAGE_H + PAGE_GAP) : secY + H) + PAD

  return (
    <div className="card">
      <div className="row">
        <h3 style={{ margin: 0 }}>Site map</h3>
        <span className="muted small">{map.nodes.length} pages · {map.edges.length} internal links</span>
      </div>
      <div className="sitemap">
        <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', maxWidth: width, minWidth: Math.min(width, 640) }}>
          <defs>
            <marker id="fg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,1 L9,5 L0,9 z" className="map-arrow" />
            </marker>
          </defs>

          {sections.map((s, i) => {
            const cx = PAD + i * (W + GAP) + W / 2
            const rcx = width / 2
            return <Edge key={`r${s.key}`} delay={0.25 + i * 0.06}
              d={`M${rcx},${rootY + H} C${rcx},${rootY + H + 34} ${cx},${secY - 34} ${cx},${secY - 3}`} />
          })}

          {sections.map((s, i) => {
            const x = PAD + i * (W + GAP)
            const spine = x + 12
            const shown = s.pages.slice(0, MAX_PAGES)
            const more = s.pages.length - shown.length
            const rowsHere = shown.length + (more ? 1 : 0)
            return (
              <g key={s.key}>
                {Array.from({ length: rowsHere }, (_, j) => {
                  const mid = pageTop + j * (PAGE_H + PAGE_GAP) + PAGE_H / 2
                  return <Edge key={j} delay={0.65 + i * 0.06 + j * 0.05}
                    d={`M${spine},${secY + H} V${mid - 6} Q${spine},${mid} ${spine + 6},${mid} H${x + 22}`} />
                })}
                <Node
                  x={x} y={secY} w={W} h={H} label={s.index ? pageLabel(s.index, s.from - 1) : s.label}
                  sub={s.pages.length ? String(s.pages.length + (s.index ? 1 : 0)) : undefined}
                  status={worstOf(s.index ? [s.index, ...s.pages] : s.pages)} node={s.index ?? undefined}
                  delay={0.4 + i * 0.06} strong
                />
                {shown.map((p, j) => (
                  <Node key={p.url} x={x + 24} y={pageTop + j * (PAGE_H + PAGE_GAP)} w={W - 24} h={PAGE_H}
                    label={pageLabel(p, s.from)} status={health(p)} node={p} delay={0.75 + i * 0.06 + j * 0.05} />
                ))}
                {more > 0 && (
                  <Node x={x + 24} y={pageTop + shown.length * (PAGE_H + PAGE_GAP)} w={W - 24} h={PAGE_H}
                    label={`+${more} ${more === 1 ? 'page' : 'pages'}`} status="muted" delay={0.75 + i * 0.06 + shown.length * 0.05} />
                )}
              </g>
            )
          })}

          <Node x={rootX} y={rootY} w={rootW} h={H} label={`Home${prefix ? ` · ${prefix}` : ''}`}
            status={health(root)} node={root} delay={0} strong />
        </svg>
      </div>
      <div className="chips">
        <span className="chip"><span className="dot pass" /> OK</span>
        <span className="chip"><span className="dot warn" /> slow (&gt; 5 s)</span>
        <span className="chip"><span className="dot fail" /> error</span>
        <span className="muted small" style={{ alignSelf: 'center' }}>Click a page to open it</span>
      </div>
    </div>
  )
}

export function ArchitectureCard({ overview }: { overview: Overview }) {
  const a: Architecture = overview.architecture!
  const tech = [...overview.platforms, ...a.cdn.filter((c) => !overview.platforms.includes(c)), a.server, a.powered_by].filter(Boolean) as string[]
  const byCategory = new Map<string, string[]>()
  a.services.forEach((s) => byCategory.set(s.category, [...(byCategory.get(s.category) ?? []), s.name]))
  const shortUrl = (url: string, own: boolean) => {
    const u = new URL(url)
    return own ? u.pathname : u.host + u.pathname
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Detected architecture</h3>
      <div className="arch">
        <Block title="Technology" items={tech.length ? [<div key="t" className="chips" style={{ marginTop: 0 }}>{tech.map((t) => <span key={t} className="chip">{t}</span>)}</div>] : []} />
        <Block title="External services" items={[...byCategory].map(([cat, names]) => (
          <div key={cat} className="small"><span className="muted">{cat}:</span> {names.join(', ')}</div>
        ))} />
        <Block title={`Forms (${a.forms.length})`} items={a.forms.map((f) => (
          <div key={`${f.kind}${f.action}`} className="issue">
            <span className="truncate">{f.kind} · {f.fields} fields · {f.method.toUpperCase()}</span>
            <span className="muted small nowrap">
              {f.insecure ? <b style={{ color: 'var(--bad)' }}>http://</b> : `on ${f.pages} ${f.pages === 1 ? 'page' : 'pages'}`}
            </span>
          </div>
        ))} />
        <Block title={`Cookies on first visit (${a.cookies.length})`} items={a.cookies.map((c) => (
          <div key={`${c.domain}${c.name}`} className="issue">
            <span className="mono truncate" title={c.name}>{c.name}</span>
            <span className="muted small nowrap">
              {c.first_party ? 'first-party' : c.domain}{c.secure ? ' · Secure' : ''}{c.http_only ? ' · HttpOnly' : ''}
            </span>
          </div>
        ))} />
        <Block title={`APIs called (${a.apis.length})`} items={a.apis.map((x) => (
          <div key={x.url} className="issue">
            <span className="mono truncate" title={x.url}>{shortUrl(x.url, x.first_party)}</span>
            <span className="muted small nowrap">{x.first_party ? 'first-party' : 'external'}</span>
          </div>
        ))} />
        <Block title={`Third-party domains (${a.third_parties.length})`} items={a.third_parties.map((t) => (
          <div key={t.host} className="issue">
            <span className="mono truncate" title={t.host}>{t.host}</span>
            <span className="muted small nowrap">{t.requests} requests</span>
          </div>
        ))} />
      </div>
    </div>
  )
}

const PREVIEW = 4

function Block({ title, items }: { title: string; items: ReactNode[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, PREVIEW)
  return (
    <div style={{ minWidth: 0 }}>
      <div className="label" style={{ marginBottom: '0.4rem' }}>{title}</div>
      <div className="issue-list" style={{ marginTop: 0 }}>
        {items.length ? shown : <span className="muted small">Nothing detected</span>}
        {items.length > PREVIEW && (
          <button className="fold" onClick={() => setAll(!all)}>
            {all ? 'Show less' : `+${items.length - PREVIEW} more`}
          </button>
        )}
      </div>
    </div>
  )
}
