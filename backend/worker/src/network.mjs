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
      window.__fg = { fcp: null, lcp: null };
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__fg.fcp = e.startTime;
      }).observe({ type: 'paint', buffered: true });
      new PerformanceObserver((l) => {
        const es = l.getEntries();
        window.__fg.lcp = es[es.length - 1].startTime;
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
    const m = await page.evaluate(() => window.__fg).catch(() => null);
    return {
      id: p.id, label: p.label,
      fcp_ms: m?.fcp != null ? Math.round(m.fcp) : null,
      lcp_ms: m?.lcp != null ? Math.round(m.lcp) : null,
      load_ms, bytes,
    };
  } finally {
    await context.close();
  }
}

export async function measureSlowNetwork(browser, url) {
  return Promise.all(PROFILES.map((p) => measure(browser, url, p).catch(() => ({ id: p.id, label: p.label, error: true }))));
}
