# Scan methodology and limits

## Controlled browser benchmark

Run `npm run benchmark --prefix backend/worker` from the repository root. Install worker dependencies and Playwright Chromium first (`npm ci --prefix backend/worker`, then `npx playwright install chromium` from `backend/worker`). No environment file, Supabase credentials or external website is needed.

The benchmark starts an HTTP server bound to loopback on an ephemeral port and executes real Chromium checks sequentially. It shares `src/execution.mjs` with the production worker: browser contexts, step execution, timeouts, retry delay and outcome classification are identical. Fixtures cover a healthy contact form, a broken contact button, a persistent HTTP 500, navigation that never responds, HTTP 403 and 429, a changed selector, and HTTP 500 followed by recovery. Each fixture declares the expected outcome, incident severity decision and attempt count before execution.

Reports and failure screenshots are written to a timestamped directory under `benchmark-results/` (generated files are ignored by Git). `report.md` provides the comparison table; `report.json` retains each attempt's timestamps, diagnostics, screenshot filename and duration. The process exits unsuccessfully on a mismatched outcome, severity, attempt count, missing evidence or incomplete execution. The slow-navigation case intentionally takes about 61 seconds because production navigation timeouts are unchanged. The complete suite normally takes around two minutes. Use `npm run benchmark --prefix backend/worker -- --repetitions=3` to repeat it.

Precision is correct confirmed findings divided by all confirmed findings; recall is detected injected defects divided by all injected defects. Zero-denominator metrics are null, not 100%. These percentages describe these controlled scenarios only, not production accuracy. A retry recovery must retain both the initial failure and the passing attempt. Maintenance decisions are evaluated separately from critical alerts.

The benchmark does not exercise database writes, screenshot storage uploads, actual incident creation or notification delivery. It checks the shared decision that determines incident severity. It also does not verify independent geographic probes, real visitor conditions, email delivery or arbitrary third-party websites. CI runs the benchmark for worker changes and uploads reports and screenshots, including failed runs. Existing production reports are not reclassified retroactively.

Evidence capture is bounded to three seconds for a screenshot and three seconds for diagnostics per attempt. A navigation that never responds can also prevent reading its title or user agent; the fallback records the URL, viewport, timestamp and a `collection_error` rather than hanging the worker. Screenshot availability is explicit for every attempt, and unavailable screenshots are not presented as captured evidence. The slow case therefore takes at least 61 seconds plus bounded evidence collection. Passing the metadata check means the attempts and collection limits were recorded; it does not mean every browser diagnostic or screenshot was available.

The overall score summarizes measured automated checks. Findings marked `needs_validation` require review and do not reduce the score. It is not a Lighthouse score or a legal compliance assessment.

## Performance

The quick public scan reports a single fresh desktop browser visit from the worker location. The full slow-network scan performs three sequential cold visits for each profile and reports the median. Profiles use a 390×844 mobile viewport and 4× CPU slowdown: slow 4G is 150 ms latency / 1.6 Mbps down / 750 Kbps up; 3G is 300 ms / 750 Kbps down / 250 Kbps up. Each navigation is capped at 45 seconds. Fewer than two numeric measurements means no reliable median. Missing paint measurements require review and are not proof that visitors see nothing.

LCP element metadata identifies the observed element and resource when Chromium provides them; it does not establish the cause of a delay. No CrUX field data, INP, TBT, or Lighthouse score is currently collected. Median visits reduce outlier sensitivity but cannot reproduce a visitor's device, location or real network. Full scans can take several minutes.

## Consent observations

A fresh context visits the page without clicking consent. Inspection waits at least seven seconds from navigation start, records network request timing, and captures known cookie names without storing cookie values in reports. Banners delayed beyond the observation window, geographic rules, shadow DOM and iframes can escape detection. Known cookie names and missing visible controls are review signals, not confirmed legal violations. Script downloads alone do not establish tracking or consent status.

## Evidence

New overview checks include the inspected URL, timestamp, observed detail and reproduction guidance. Existing reports must be scanned again to acquire this metadata. Public reports expose evidence for their first three findings; older public reports retain their existing payload.

## Remaining work

- Optional field data with explicit URL versus origin scope, collection period and missing-data handling.
- LCP request attribution and render-blocking diagnosis.
- Dedicated mobile phone-link audit and owner-configured business-profile comparison.
- Owner-authorized form submission correlated with a connected test inbox. A success message alone never proves delivery.
- A complete example report from an actual scan, including verified fixes and a rerun.

Reference reviewed: https://github.com/tobbytools/tobbytools.github.io/blob/master/app.js. Its checker requests PageSpeed Insights and displays CrUX field data separately from Lighthouse lab measurements. No code or API credentials were copied.

Validation: `node --test backend/worker/scripts/trust-checks.test.mjs` (requires Playwright Chromium), `npm run build --prefix frontend`, and `npm run lint --prefix frontend`.

## Progressive results

Initial document and response-header checks are published at DOMContentLoaded, before the consent observation window and auxiliary requests. The public report continues polling while showing this snapshot; account reports receive realtime updates with a two-second polling fallback during active scans. Previous results remain visible during rescans until the new initial snapshot arrives. Missing initial meta tags require review until the page settles. Preliminary scores can change as checks complete.

## Finding evidence and confidence

New overview and per-page findings use shared evidence guidance: URL, observed value, inspected header/element/file, reproduction procedure, review criterion, suggested fix, and check-specific limitations. Heuristic SEO, text, privacy and failed-resource signals require review and do not lower the measured score. Missing headers are labeled hardening recommendations, not vulnerabilities. Exact DOM attribution is not available for every check; unsupported attribution is disclosed and the finding requires review. Existing saved reports need a new scan.

A real, narrowly scoped header inspection is recorded in [example-report.md](example-report.md). Its suggested fix has not been applied or verified. It is not presented as a complete audit or a before/after success story.
