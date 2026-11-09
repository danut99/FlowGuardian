import { Fragment, useState } from 'react'
import { motion } from 'motion/react'
import { StatusBadge } from '../../components/StatusBadge'
import { FAILURE_LABEL, FailureDetails } from './FailureDetails'
import type { Run } from '../../types'

export function RunsTab({ runs }: { runs: Run[] }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!runs.length) return <p className="muted">No runs yet. Click “Run now” on a test.</p>
  return (
    <motion.div className="card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} style={{ padding: '0.4rem 0.8rem' }}>
      <table className="table">
        <thead><tr><th>Test</th><th>Status</th><th>Duration</th><th>Details</th><th>When</th></tr></thead>
        <tbody>
          {runs.map((r) => {
            const failed = r.status === 'failed' || r.status === 'error'
            return (
              <Fragment key={r.id}>
                <motion.tr layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className={failed ? 'clickable' : undefined} onClick={failed ? () => setOpen(open === r.id ? null : r.id) : undefined}>
                  <td>{r.test.name}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="muted">{r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)} s` : '—'}</td>
                  <td className="muted small">
                    {r.error ?? (r.failure_kind ? FAILURE_LABEL[r.failure_kind] : '')}
                    {failed && <span className="muted small"> · {open === r.id ? 'hide' : r.screenshot_path ? 'see screenshot' : 'details'}</span>}
                  </td>
                  <td className="muted small">{new Date(r.created_at).toLocaleString('en-GB')}</td>
                </motion.tr>
                {open === r.id && (
                  <tr><td colSpan={5}><FailureDetails run={r} /></td></tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </motion.div>
  )
}
