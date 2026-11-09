// What visitors on a weak connection experience: throttled network + slower phone CPU (Chromium CDP).
const CAP_MS = 45_000;

// Lighthouse-style mobile profiles; throughput in bytes/s
export const PROFILES = [
  { id: 'slow4g', label: 'Slow 4G', latency: 150, down: 1.6e6 / 8, up: 750e3 / 8, cpu: 4 },
  { id: '3g', label: '3G', latency: 300, down: 750e3 / 8, up: 250e3 / 8, cpu: 4 },
];

export async function measure(browser, url, p) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    const cdp = await context.newCDPSession(page);
    let bytes = 0;
    cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength; });
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: p.latency, downloadThroughput: p.down, uploadThroughput: p.up,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu });
    await page.addInitScript(() => {
      window.__fg = { fcp: null, lcp: null, lcp_element: null };
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__fg.fcp = e.startTime;
      }).observe({ type: 'paint', buffered: true });
      new PerformanceObserver((l) => {
        const es = l.getEntries();
        const entry = es[es.length - 1];
        window.__fg.lcp = entry.startTime;
        const el = entry.element;
        window.__fg.lcp_element = el ? { tag: el.tagName.toLowerCase(), id: el.id || null, resource: entry.url ? new URL(entry.url).origin + new URL(entry.url).pathname : null } : null;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    });

    const started = Date.now();
    let load_ms = null;
    try {
      await page.goto(url, { waitUntil: 'load', timeout: CAP_MS });
      load_ms = Date.now() - started;
    } catch {
      // Didn't finish loading within the cap; paint metrics may still exist
    }
    await page.waitForTimeout(1000);
    const m = await page.evaluate(() => window.__fg).catch(() => null);
    return {
      id: p.id, label: p.label,
      fcp_ms: m?.fcp != null ? Math.round(m.fcp) : null,
      lcp_ms: m?.lcp != null ? Math.round(m.lcp) : null,
      load_ms, bytes, lcp_element: m?.lcp_element ?? null,
    };
  } finally {
    await context.close();
  }
}

// Run sequentially so competing browsers do not distort the median.
export function summarizeRuns(p, runs) {
  const valid = runs.filter((r) => !r.error);
  const median = (key) => {
    const values = runs.map((r) => Number.isFinite(r[key]) ? r[key] : null);
    if (values.filter((v) => v !== null).length < 2) return null;
    return values.sort((a, b) => (a ?? Infinity) - (b ?? Infinity))[1];
  };
  const lcp = median('lcp_ms');
  return {
    id: p.id, label: p.label, source: 'lab', aggregation: 'median', runs: runs.length,
    successful_runs: valid.length, error: valid.length < 2,
    fcp_ms: median('fcp_ms'), lcp_ms: lcp, load_ms: median('load_ms'), bytes: median('bytes'),
    lcp_element: runs.find((r) => r.lcp_ms === lcp)?.lcp_element ?? null,
    samples: runs.map(({ fcp_ms, lcp_ms, load_ms, error }) => ({ fcp_ms, lcp_ms, load_ms, error })),
    conditions: { viewport: '390x844', latency_ms: p.latency, download_bps: p.down * 8, cpu_slowdown: p.cpu },
  };
}

export async function measureSlowNetwork(browser, url) {
  const results = [];
  for (const p of PROFILES) {
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await measure(browser, url, p).catch(() => ({ error: true })));
    results.push(summarizeRuns(p, runs));
  }
  return results;
}
