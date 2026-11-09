import type { Locator, Site, Test, TestStep } from '../types'

const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`

function locator(l: Locator): string {
  switch (l.type) {
    case 'role': return `page.getByRole(${q(l.role ?? 'generic')}${l.name ? `, { name: ${q(l.name)} }` : ''})`
    case 'text': return `page.getByText(${q(l.value ?? '')})`
    case 'label': return `page.getByLabel(${q(l.value ?? '')})`
    case 'placeholder': return `page.getByPlaceholder(${q(l.value ?? '')})`
    case 'testid': return `page.getByTestId(${q(l.value ?? '')})`
    default: return `page.locator(${q(l.value ?? '')})`
  }
}

function stepCode(s: TestStep, siteUrl: string): string[] {
  const main = s.locators[0] ? `${locator(s.locators[0])}.first()` : null
  const alt = s.locators.length > 1 ? [`  // alternative: ${s.locators.slice(1).map(locator).join('  |  ')}`] : []
  const at = (line: string) => [...alt, `  ${line}`]
  switch (s.action) {
    case 'goto': return [`  await page.goto(${q(new URL(s.value || siteUrl, siteUrl).href)});`]
    case 'dismiss': return main ? [
      '  // Banner de cookie: închis doar dacă apare',
      `  if (await ${main}.isVisible({ timeout: 3000 }).catch(() => false)) await ${main}.click();`,
    ] : []
    case 'click': return main ? at(`await ${main}.click();`) : []
    case 'fill': return main ? at(`await ${main}.fill(${q(s.value ?? '')});`) : []
    case 'press': return main ? at(`await ${main}.press(${q(s.value || 'Enter')});`) : []
    case 'expect_visible': return main ? at(`await expect(${main}).toBeVisible();`) : []
    case 'expect_text': return at(`await expect(${main ?? "page.locator('body')"}.getByText(${q(s.value ?? '')}).first()).toBeVisible();`)
    case 'expect_url': return [`  await page.waitForURL((u) => u.href.includes(${q(s.value ?? '')}));`]
    default: return [`  // Pasul „${s.action}” nu are echivalent direct în Playwright`]
  }
}

// Health checks (SSL, speed, layout…) run inside FlowGuardian's worker and have no plain Playwright equivalent
export const exportable = (t: Test) => t.steps.some((s) => s.action !== 'check')

export function toPlaywright(site: Site, tests: Test[]): string {
  const list = tests.filter(exportable)
  const body = list.map((t) => [
    `test(${q(t.name)}, async ({ page }) => {`,
    ...t.steps.flatMap((s) => stepCode(s, site.url)),
    '});',
  ].join('\n'))
  return [
    "import { test, expect } from '@playwright/test';",
    '',
    `// Generat de FlowGuardian pentru ${site.url} la ${new Date().toLocaleString('ro-RO')}.`,
    '// Rulează cu: npx playwright test',
    '',
    `test.describe(${q(site.name ?? new URL(site.url).host)}, () => {`,
    ...body.map((b) => b.split('\n').map((l) => `  ${l}`).join('\n')).join('\n\n').split('\n'),
    '});',
    '',
  ].join('\n')
}

export function downloadPlaywright(site: Site, tests: Test[]) {
  const blob = new Blob([toPlaywright(site, tests)], { type: 'text/plain' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${new URL(site.url).host.replace(/[^a-z0-9.-]/gi, '_')}.spec.ts`
  a.click()
  URL.revokeObjectURL(a.href)
}
