// Developer mode: what a developer opens DevTools for, captured during a test run and kept only when it fails.
const MAX = 15;

const IGNORED_TYPES = new Set(['image', 'font', 'media']);

export function watchPage(page) {
  const consoleErrors = [];
  const pageErrors = [];
  const network = [];
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const loc = m.location();
    consoleErrors.push({ level: m.type(), text: m.text().slice(0, 500), source: loc?.url ? `${loc.url}:${loc.lineNumber}` : null });
  });
  page.on('pageerror', (e) => pageErrors.push({ message: e.message.slice(0, 500), stack: e.stack?.slice(0, 2000) ?? null }));
  page.on('response', (r) => {
    const type = r.request().resourceType();
    if (r.status() >= 400 && !IGNORED_TYPES.has(type)) {
      network.push({ method: r.request().method(), url: r.url().slice(0, 500), status: r.status(), type });
    }
  });
  page.on('requestfailed', (r) => {
    if (IGNORED_TYPES.has(r.resourceType())) return;
    network.push({ method: r.method(), url: r.url().slice(0, 500), status: 0, type: r.resourceType(), error: r.failure()?.errorText ?? null });
  });

  return async () => ({
    url: page.url(),
    title: await page.title().catch(() => null),
    viewport: page.viewportSize(),
    user_agent: await page.evaluate(() => navigator.userAgent).catch(() => null),
    console: consoleErrors.slice(-MAX),
    page_errors: pageErrors.slice(-MAX),
    network: network.slice(-MAX),
    captured_at: new Date().toISOString(),
  });
}
