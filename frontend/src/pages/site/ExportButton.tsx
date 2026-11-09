import { useDevMode } from '../../lib/devMode'
import { downloadPlaywright, exportable } from '../../lib/playwrightExport'
import type { Site, Test } from '../../types'

export function ExportButton({ site, tests }: { site: Site; tests: Test[] }) {
  const [dev] = useDevMode()
  const count = tests.filter(exportable).length
  if (!dev || !count) return null
  return (
    <button className="btn ghost sm" onClick={() => downloadPlaywright(site, tests)}
      title="Download the tests as a Playwright file (.spec.ts). Automatic checks (SSL, speed…) are not exported.">
      Export Playwright ({count})
    </button>
  )
}
