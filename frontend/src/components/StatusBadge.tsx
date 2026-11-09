import type { RunStatus, TestStatus } from '../types'

const LABELS: Record<RunStatus | TestStatus, string> = {
  queued: 'În coadă',
  running: 'Rulează',
  passed: 'OK',
  failed: 'Eșuat',
  error: 'Eroare',
  proposed: 'Propus',
  approved: 'Aprobat',
  paused: 'Pe pauză',
}

export function StatusBadge({ status }: { status: RunStatus | TestStatus }) {
  return <span className={`badge badge-${status}`}>{LABELS[status]}</span>
}
