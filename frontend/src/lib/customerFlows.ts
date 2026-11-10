import { stripTimeout } from './stepTimeout'
import type { Test, Run, FlowCandidate } from '../types'
export function distinctSuggestions(candidates: FlowCandidate[]) {
  const targets = new Map<string, FlowCandidate[]>(), kinds = new Set<string>()
  return [...candidates].sort((a, b) => Number(a.kind === 'navigation') - Number(b.kind === 'navigation')).filter(candidate => {
    let target: string
    try { const url = new URL(candidate.target_url); target = url.origin + url.pathname.replace(/\/$/, '').toLowerCase() } catch { return false }
    const existing = targets.get(target) ?? []
    if (kinds.has(candidate.kind) || existing.length && !(candidate.discovery_strength === 'control_observed' && existing.every(c => c.discovery_strength === 'control_observed'))) return false
    targets.set(target, [...existing, candidate]); kinds.add(candidate.kind)
    return true
  }).slice(0, 3)
}
export const isCustomerFlow = (test: Test) => test.name.startsWith('[Flow] ')
export function flowRevision(test: Test) { return test.steps[0]?.note?.startsWith('Flow v1|') ? test.steps[0].note.split('|')[1] : null }
export function flowGoal(test: Test) { return test.steps[0]?.note?.startsWith('Flow v1|') ? stripTimeout(test.steps[0].note.split('|').slice(2).join('|')) : '' }
export function currentFlowRuns(test: Test, runs: Run[]) {
  const revision = flowRevision(test)
  return runs.filter((r) => r.test_id === test.id && (!revision || Date.parse(r.created_at) >= Date.parse(revision)))
}

// Only concrete, recent browser evidence can be adopted without manual configuration.
export function discoveredFlowSteps(candidate: FlowCandidate, siteUrl: string) {
  const steps: { action: string; locators: { type: string; role?: string; name?: string; value?: string; exact?: boolean; strict?: boolean }[]; value: string | null; note?: string }[] = [
    { action: 'goto', locators: [], value: candidate.entry_action ? candidate.entry_url : candidate.target_url },
  ]
  if (candidate.entry_action) steps.push({ action: 'click', locators: [{ type: 'role', role: candidate.entry_action.role, name: candidate.entry_action.name, exact: true, strict: true }], value: null })
  for (const field of candidate.observed_controls?.fields ?? []) if (field.label) steps.push({ action: 'expect_visible', locators: [{ type: 'label', value: field.label, exact: true, strict: true }], value: null })
  if (!candidate.entry_action) for (const name of candidate.observed_controls?.buttons ?? []) steps.push({ action: 'expect_visible', locators: [{ type: 'role', role: 'button', name, exact: true, strict: true }], value: null })
  try { if (new URL(steps[0].value!, siteUrl).origin !== new URL(siteUrl).origin) return [] } catch { return [] }
  return steps
}
export function canMonitorDiscovered(candidate: FlowCandidate, siteUrl: string, now = Date.now()) {
  const recorded = candidate.public_run?.steps
  if (!recorded?.length || !recorded.some(s => ['controls_observed', 'entry_opened'].includes(s.result))) return false
  if (recorded.some(s => !['page_responded', 'controls_observed', 'entry_opened', 'validation_observed'].includes(s.result))) return false
  const observedAt = Date.parse(recorded.at(-1)!.observed_at)
  if (!Number.isFinite(observedAt) || now - observedAt < -60000 || now - observedAt > 30 * 60000) return false
  const steps = discoveredFlowSteps(candidate, siteUrl)
  return steps.length > 1 && steps.at(-1)?.action === 'expect_visible'
}
