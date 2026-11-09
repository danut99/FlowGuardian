import type { RunStatus, TestStatus } from '../types'

const LABELS: Record<RunStatus | TestStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  passed: 'OK',
  failed: 'Failed',
  error: 'Error',
  proposed: 'Proposed',
  approved: 'Approved',
  paused: 'Paused',
}

export function StatusBadge({ status }: { status: RunStatus | TestStatus }) {
  return <span className={`badge badge-${status}`}>{LABELS[status]}</span>
}
