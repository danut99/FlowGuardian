// Basic scan (phase 1): crawl same-host pages and report HTTP errors, slowness, JS errors, broken links/images.
import os from 'node:os';
import { pageText, textFindings } from './text.mjs';

const NAV_TIMEOUT = 30_000;
// Heavy pages may never fire "load" quickly; past this they count as slow, not broken
const LOAD_WAIT = 20_000;
const MAX_PAGES = 20;
const MAX_LINK_CHECKS = 60;
const MAX_ERRORS_PER_PAGE = 5;
// Small servers (1-2 CPUs) time out when too many pages render at once
const PAGE_CONCURRENCY = os.cpus().length >= 4 ? 4 : 2;
const LINK_CONCURRENCY = 10;
const CRAWL_BUDGET_MS = 90_000;

async function pool(items, size, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

function normalize(href, base) {
  try {
    const u = new URL(href, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

async function checkPage(context, url, host) {
  const page = await context.newPage();
  const jsErrors = [];
  const brokenImages = [];
  page.on('pageerror', (e) => jsErrors.push(e.message.slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') jsErrors.push(m.text().slice(0, 300)); });
  page.on('response', (r) => {
    if (r.request().resourceType() === 'image' && r.status() >= 400) brokenImages.push({ url: r.url(), status: r.status() });
  });
  page.on('requestfailed', (r) => {
    if (r.resourceType() === 'image') brokenImages.push({ url: r.url(), status: 0 });
  });

  const started = Date.now();
  try {
    const go = () => page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    // One retry: a single slow response shouldn't mark the page as down
    const res = await go().catch((e) => (/timeout/i.test(e.message) ? go() : Promise.reject(e)));
    await page.waitForLoadState('load', { timeout: LOAD_WAIT }).catch(() => {});
    const load_ms = Date.now() - started;
    const http_status = res?.status() ?? null;
    const isHtml = (res?.headers()['content-type'] ?? '').includes('text/html');
    const links = isHtml
      ? (await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href'))))
        .map((h) => normalize(h, page.url()))
        .filter((h) => h && new URL(h).host === host)
      : [];
    const meta = isHtml ? await page.evaluate(() => {
      const abs = (a) => { try { return new URL(a || location.href, location.href).href; } catch { return ''; } };
      return {
        title: document.title.trim(),
        description: document.querySelector('meta[name="description"]')?.content?.trim() ?? '',
        imgs: document.images.length,
        imgs_no_alt: [...document.images].filter((i) => !i.hasAttribute('alt')).length,
        // getAttribute: form.action/method get shadowed by inputs named "action"/"method"
        forms: [...document.forms].map((f) => ({
          action: abs(f.getAttribute('action')),
          method: (f.getAttribute('method') || 'get').toLowerCase(),
          password: !!f.querySelector('input[type=password]'),
          search: f.getAttribute('role') === 'search' || !!f.querySelector('input[type=search], input[name=q], input[name=s]'),
          email: !!f.querySelector('input[type=email]'),
          fields: f.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select').length,
        })).filter((f) => f.fields > 0),
      };
    }).catch(() => null) : null;
    const text = isHtml ? textFindings(await pageText(page)) : null;
    return {
      url, http_status, load_ms, links: [...new Set(links)], meta, text,
      js_errors: [...new Set(jsErrors)].slice(0, MAX_ERRORS_PER_PAGE),
      broken_images: brokenImages.slice(0, MAX_ERRORS_PER_PAGE),
    };
  } catch (e) {
    return { url, http_status: null, load_ms: null, links: [], meta: null, js_errors: [], broken_images: [], error: e.message.split('\n')[0] };
  } finally {
    await page.close();
  }
}

const TIMED_OUT = -1;

async function linkStatus(context, url, timeout = 8_000) {
  try {
    let res = await context.request.head(url, { timeout, maxRedirects: 5 });
    if (res.status() === 405 || res.status() === 501) res = await context.request.get(url, { timeout, maxRedirects: 5 });
    return res.status();
  } catch (e) {
    return /timeout/i.test(e?.message ?? '') ? TIMED_OUT : 0;
  }
}

export async function crawlSite(context, siteUrl) {
  const start = normalize(siteUrl, siteUrl);
  const host = new URL(start).host;
  const queue = [start];
  const seen = new Set(queue);
  const depth = new Map([[start, 0]]);
  const parent = new Map();
  const results = [];
  const deadline = Date.now() + CRAWL_BUDGET_MS;

  // Breadth-first in parallel batches; stops at MAX_PAGES or when the time budget runs out
  while (queue.length && results.length < MAX_PAGES && Date.now() < deadline) {
    const batch = queue.splice(0, Math.min(PAGE_CONCURRENCY, MAX_PAGES - results.length));
    for (const r of await Promise.all(batch.map((u) => checkPage(context, u, host)))) {
      results.push(r);
      for (const l of r.links) {
        if (!seen.has(l)) {
          seen.add(l);
          depth.set(l, depth.get(r.url) + 1);
          parent.set(l, r.url);
          queue.push(l);
        }
      }
    }
  }

  // Links we found but did not crawl still get a cheap status check.
  // Crawled pages that failed without an HTTP status (usually a slow load) are rechecked too, not assumed dead.
  const status = new Map(results.filter((r) => r.http_status != null).map((r) => [r.url, r.http_status]));
  const unchecked = [...new Set(results.flatMap((r) => [r.url, ...r.links]))].filter((l) => !status.has(l)).slice(0, MAX_LINK_CHECKS);
  const codes = await pool(unchecked, LINK_CONCURRENCY, (l) => linkStatus(context, l));
  unchecked.forEach((l, i) => status.set(l, codes[i]));
  // Slow or overloaded servers (SSR, small hosts) time out or answer 502/503 under parallel checks: retry those slowly before calling them broken
  const transient = (s) => s === TIMED_OUT || s === 429 || (s >= 500 && s <= 599);
  const slow = unchecked.filter((l) => transient(status.get(l)));
  const retried = await pool(slow, 2, async (l) => {
    await new Promise((r) => setTimeout(r, 500));
    return linkStatus(context, l, 25_000);
  });
  slow.forEach((l, i) => status.set(l, retried[i]));
  // Auth/bot-protection statuses aren't proof of a dead link, and a link that's only slow isn't dead either
  const broken = (s) => s === 0 || (s >= 400 && ![401, 403, 405, 429].includes(s));

  const crawled = new Set(results.map((r) => r.url));
  return results.map(({ links, ...r }) => ({
    ...r,
    depth: depth.get(r.url),
    parent: parent.get(r.url) ?? null,
    internal_links: links.filter((l) => crawled.has(l) && l !== r.url),
    broken_links: links
      .filter((l) => status.has(l) && broken(status.get(l)))
      .map((l) => ({ url: l, status: status.get(l) }))
      .slice(0, MAX_ERRORS_PER_PAGE * 2),
  }));
}
