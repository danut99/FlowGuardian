// Timeout metadata stays in the existing note field so older workers/rows remain readable.
const tag = /(?:^|\|)Timeout v1\|(\d+)\|/
export function readStepTimeout(note: string | null | undefined, action: string) {
  const value = Number(note?.match(tag)?.[1])
  return value >= 1000 && value <= 60000 ? value : action === 'goto' ? 30000 : 10000
}
export function stripTimeout(note: string) { return note.replace(/Timeout v1\|\d+\|/, '') }
export function writeStepNote(note: string | null | undefined, timeout: number, revisionPrefix = '') {
  const prefix = revisionPrefix + `Timeout v1|${Math.max(1000, Math.min(60000, timeout))}|`
  return prefix + Array.from(stripTimeout(note ?? '')).slice(0, 160 - prefix.length).join('')
}
