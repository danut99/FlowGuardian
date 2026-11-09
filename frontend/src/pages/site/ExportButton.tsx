import { useDevMode } from '../../lib/devMode'
import { downloadPlaywright, exportable } from '../../lib/playwrightExport'
import type { Site, Test } from '../../types'

export function ExportButton({ site, tests }: { site: Site; tests: Test[] }) {
  const [dev] = useDevMode()
  const count = tests.filter(exportable).length
  if (!dev || !count) return null
  return (
    <button className="btn ghost sm" onClick={() => downloadPlaywright(site, tests)}
      title="Descarcă testele ca fișier Playwright (.spec.ts). Verificările automate (SSL, viteză…) nu se exportă.">
      Exportă Playwright ({count})
    </button>
  )
}
