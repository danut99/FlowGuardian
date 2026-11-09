// Per-page analysis. Stage 2 (automatic after the scan): speed, SEO and errors for every crawled page.
// Stage 3 (on demand, one page): slow network, phone layout, load experience and screenshots.
import { BLOCKED_STATUS, check, grade, inspectPage, scoreChecks, sec } from './overview.mjs';
import { validateChecks } from './report.mjs';
import { measureSlowNetwork } from './network.mjs';
import { runCheck } from './health.mjs';

const DESKTOP = { viewport: { width: 1366, height: 768 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

export async function analyzePage(browser, row) {
  // Fresh context per page: a visitor landing here from Google has a cold cache
  const context = await browser.newContext(DESKTOP);
  try {
    const p = await inspectPage(context, row.url);
    if (BLOCKED_STATUS.has(p.status)) throw new Error(`Access was blocked (HTTP ${p.status}).`);
    const { meta, perf } = p;
    const titleLen = meta.title.length;
    const noindex = meta.noindex || /noindex/i.test(p.headers['x-robots-tag'] ?? '');
    const brokenLinks = row.broken_links ?? [];
    const https = new URL(p.finalUrl).protocol === 'https:';

    const checks = validateChecks([
      check('availability', 'status', 'Page responds', p.status && p.status < 400 ? null : 'high', `HTTP ${p.status ?? '—'}`),

      check('performance', 'load', 'Full page load', grade(p.load_ms, 2500, 5000), p.load_ms == null ? 'Did not finish within 20 s' : sec(p.load_ms)),
      check('performance', 'ttfb', 'Server response time (TTFB)', grade(perf.ttfb, 800, 1800), perf.ttfb == null ? 'Not measured' : `${Math.round(perf.ttfb)} ms`),
      check('performance', 'lcp', 'Main content appears (LCP)', grade(perf.lcp, 2500, 4000), perf.lcp == null ? 'Not measured' : `${sec(perf.lcp)} (good: under 2.5 s)`),
      check('performance', 'cls', 'Visual stability (CLS)', grade(perf.cls, 0.1, 0.25), perf.cls == null ? 'Not measured' : `${perf.cls.toFixed(2)} (good: under 0.1)`),
      check('performance', 'weight', 'Page size', grade(perf.bytes, 2_000_000, 5_000_000), `${(perf.bytes / 1e6).toFixed(1)} MB · ${perf.requests} requests`),

      check('content', 'links', 'Working links', brokenLinks.length ? 'medium' : null,
        brokenLinks.length ? `${brokenLinks.length} broken ${brokenLinks.length === 1 ? 'link' : 'links'}: ${brokenLinks.slice(0, 2).map((l) => l.url).join(', ')}` : 'No broken links'),
      check('content', 'images', 'Images load', p.broken_images.length ? 'low' : null,
        p.broken_images.length ? `${p.broken_images.length} missing ${p.broken_images.length === 1 ? 'image' : 'images'}: ${p.broken_images[0].url}` : 'All images load'),
      check('content', 'js', 'No JavaScript errors', p.js_errors.length ? 'low' : null,
        p.js_errors.length ? `${p.js_errors.length} ${p.js_errors.length === 1 ? 'error' : 'errors'}: ${p.js_errors[0].slice(0, 160)}` : 'The console is clean'),

      check('seo', 'title', 'Page title', !titleLen ? 'medium' : titleLen < 10 || titleLen > 65 ? 'low' : null,
        !titleLen ? '<title> is missing' : titleLen > 65 ? `Too long (${titleLen} characters)` : titleLen < 10 ? 'Too short' : meta.title),
      check('seo', 'description', 'Description for Google', meta.description ? null : 'low', meta.description || 'Meta description is missing'),
      check('seo', 'h1', 'Main heading (H1)', meta.h1 ? null : 'low', meta.h1 ? `${meta.h1} H1 ${meta.h1 === 1 ? 'heading' : 'headings'}` : 'No H1'),
      check('seo', 'canonical', 'Canonical URL', meta.canonical ? null : 'low', meta.canonical ?? '<link rel="canonical"> is missing'),
      // On inner pages noindex is often deliberate (cart, account), so it's only a warning
      check('seo', 'index', 'Page can appear in Google', noindex ? 'low' : null, noindex ? 'Has noindex — is that intentional?' : 'Indexing is allowed'),
      check('seo', 'alt', 'Alt text on images', meta.imgs_no_alt ? 'low' : null,
        meta.imgs_no_alt ? `${meta.imgs_no_alt} of ${meta.imgs} images without alt` : `${meta.imgs} ${meta.imgs === 1 ? 'image' : 'images'} checked`),
      check('seo', 'og', 'Share preview', meta.og ? null : 'low', meta.og ? 'Has og:title and og:image' : 'og:title / og:image are missing'),

      check('security', 'mixed', 'No insecure content', https && p.insecure.length ? 'low' : null,
        https && p.insecure.length ? `${p.insecure.length} ${p.insecure.length === 1 ? 'resource' : 'resources'} over http://` : 'OK'),
    ]);

    return {
      score: scoreChecks(checks),
      metrics: { load_ms: p.load_ms, ttfb: perf.ttfb, lcp: perf.lcp, cls: perf.cls, bytes: perf.bytes, requests: perf.requests },
      checks,
    };
  } finally {
    await context.close();
  }
}

async function withPage(browser, options, fn) {
  const context = await browser.newContext(options);
  try {
    return await fn(await context.newPage());
  } finally {
    await context.close();
  }
}

async function snapshot(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return page.screenshot();
}

// ok: true = fine, false = problem found, null = could not check
async function verdict(browser, options, url, spec) {
  return withPage(browser, options, (page) => runCheck(page, new URL(url), spec))
    .then((r) => (r ? { ok: false, message: r.message, shot: r.screenshot } : { ok: true }))
    .catch((e) => ({ ok: null, message: `Could not check: ${e.message.split('\n')[0]}` }));
}

export async function deepAnalyze(browser, url) {
  // Sequential on purpose: throttled runs and layout checks would skew each other's timings
  const network = await measureSlowNetwork(browser, url);
  const mobile = await verdict(browser, PHONE, url, 'mobile');
  const load = await verdict(browser, DESKTOP, url, 'load_experience:5000');
  const desktopShot = await withPage(browser, DESKTOP, (p) => snapshot(p, url)).catch(() => null);
  const mobileShot = await withPage(browser, PHONE, (p) => snapshot(p, url)).catch(() => null);
  const strip = ({ shot, ...rest }) => rest;
  return {
    result: { network, mobile: strip(mobile), load: strip(load) },
    images: { desktop: desktopShot, mobile: mobileShot, mobile_issue: mobile.shot ?? null, load_issue: load.shot ?? null },
  };
}
