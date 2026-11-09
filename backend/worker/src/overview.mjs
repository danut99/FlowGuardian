// Site overview + essential checks every site should pass. Passive only: we read what any visitor gets.
// Security findings follow the "defense-in-depth gaps are hardening notes, not vulnerabilities" rule → warn, never fail.
import tls from 'node:tls';
import { SCHEMA_VERSION, validateOverview } from './report.mjs';
import { complianceChecks } from './compliance.mjs';
import { textChecks } from './text.mjs';

const PLATFORMS = [
  ['Shopify', /cdn\.shopify\.com|Shopify\.theme/i],
  ['WooCommerce', /wp-content\/plugins\/woocommerce|class="[^"]*woocommerce/i],
  ['WordPress', /wp-content|wp-includes/i],
  ['Magento', /Magento|mage\/cookies/i],
  ['PrestaShop', /prestashop/i],
  ['Wix', /static\.wixstatic\.com|wix\.com/i],
  ['Squarespace', /squarespace/i],
  ['Webflow', /webflow/i],
  ['Next.js', /__NEXT_DATA__|\/_next\//],
  ['Nuxt', /__NUXT__|\/_nuxt\//],
  ['Angular', /ng-version=/],
  ['AEM', /\/etc\.clientlibs\//],
];
const SHOP_PLATFORMS = new Set(['Shopify', 'WooCommerce', 'Magento', 'PrestaShop']);
// Only a real cart means physical goods; Product schema alone also appears on catalogs/configurators that don't sell online
const SHOP_SIGNALS = /add to cart|add to bag|in den warenkorb|adaug[ăa] [îi]n co[șs]|co[șs]ul (meu|de cump)|shopping cart|href="[^"]*\/(cart|basket|warenkorb|cos)\b/i;
const SERVICE_SIGNALS = /href="[^"]*\/(pricing|plans|preturi|preise|tarifs|precios|subscribe|subscription|abonament|billing)\b|subscribe now|upgrade to pro|start (your )?free trial|go pro\b|cump[ăa]r[ăa] abonament|jetzt abonnieren/i;
const BLOCKED = new Set([403, 410, 429]);
// Need the crawl or the slow-network runs; left out of the early home-only overview
const SITE_WIDE = new Set(['pages', 'slow', 'links', 'pages_meta', 'net_fcp', 'net_lcp', 'net_3g',
  'text_placeholder', 'text_encoding', 'text_repeated', 'text_cedilla', 'text_spacing', 'text_dup_blocks', 'text_dup_pages']);
const BLOG_SIGNALS = /"@type"\s*:\s*"(BlogPosting|Article)"|\/blog\//i;

const CDNS = [
  ['Cloudflare', (h) => h['cf-ray'] || /cloudflare/i.test(h.server ?? '')],
  ['Fastly', (h) => h['x-fastly-request-id'] || /fastly|^cache-/i.test(h['x-served-by'] ?? '')],
  ['CloudFront', (h) => h['x-amz-cf-id']],
  ['Akamai', (h) => h['x-akamai-transformed'] || /akamai/i.test(h.server ?? '')],
  ['Vercel', (h) => h['x-vercel-id']],
  ['Netlify', (h) => h['x-nf-request-id']],
  ['BunnyCDN', (h) => /bunnycdn/i.test(h.server ?? '')],
];
// Matched against host + path of every request the home page makes
const SERVICES = [
  ['Google Analytics / Tag Manager', 'Analytics', /google-analytics\.com|googletagmanager\.com/],
  ['Hotjar', 'Analytics', /hotjar\.com/],
  ['Microsoft Clarity', 'Analytics', /clarity\.ms/],
  ['Meta Pixel', 'Marketing', /connect\.facebook\.net|facebook\.com\/tr/],
  ['Google Ads', 'Marketing', /googleadservices\.com|doubleclick\.net/],
  ['TikTok Pixel', 'Marketing', /analytics\.tiktok\.com/],
  ['Stripe', 'Payments', /stripe\.com/],
  ['PayPal', 'Payments', /paypal\.com|paypalobjects\.com/],
  ['Netopia', 'Payments', /netopia/],
  ['Paddle', 'Payments', /paddle\.com/],
  ['Lemon Squeezy', 'Payments', /lemonsqueezy\.com/],
  ['Intercom', 'Chat', /intercom\.io|intercomcdn\.com/],
  ['Tawk.to', 'Chat', /tawk\.to/],
  ['Crisp', 'Chat', /crisp\.chat/],
  ['reCAPTCHA', 'Anti-spam', /\/recaptcha\//],
  ['Cookiebot / OneTrust', 'Cookie consent', /cookiebot|onetrust|cookielaw/],
  ['Google Fonts', 'Fonts', /fonts\.(googleapis|gstatic)\.com/],
  ['YouTube', 'Media', /youtube\.com|ytimg\.com/],
  ['jsDelivr / cdnjs / unpkg', 'Public CDN', /jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com/],
];

export function certDaysLeft(host) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: 8000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve(cert?.valid_to ? Math.floor((new Date(cert.valid_to) - Date.now()) / 86_400_000) : null);
    });
    socket.on('error', () => resolve(null));
    socket.on('timeout', () => { socket.destroy(); resolve(null); });
  });
}

export async function httpRedirectsToHttps(context, host) {
  try {
    const res = await context.request.get(`http://${host}/`, { timeout: 8000, maxRedirects: 5 });
    return new URL(res.url()).protocol === 'https:';
  } catch {
    return null;
  }
}

// llms.txt (llmstxt.org): Markdown guide for AI assistants. SPAs answer missing files with index.html, so HTML doesn't count.
async function llmsInfo(context, origin) {
  const present = (file) => context.request.get(`${origin}/${file}`, { timeout: 8000, maxRedirects: 3 })
    .then(async (r) => r.ok() && !/html/i.test(r.headers()['content-type'] ?? '') && /\S/.test(await r.text()), () => false);
  const [llms, full] = await Promise.all([present('llms.txt'), present('llms-full.txt')]);
  return { llms, full };
}

const ORG_TYPE = /^(Organization|Corporation|NGO|Brand)$|(Organization|Business|Store|Restaurant)$/;

// Every @type in the page's JSON-LD, including @graph and nested objects
function schemaTypes(html) {
  const types = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    for (const t of [v['@type']].flat()) if (typeof t === 'string') types.add(t.replace(/^https?:\/\/schema\.org\//, ''));
    Object.values(v).forEach(walk);
  };
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1])); } catch { /* invalid JSON-LD block */ }
  }
  return [...types];
}

async function robotsInfo(context, origin) {
  const text = (u) => context.request.get(u, { timeout: 8000, maxRedirects: 3 })
    .then(async (r) => (r.ok() ? r.text() : null), () => null);
  const body = await text(`${origin}/robots.txt`);
  // SPAs answer every path with index.html
  const robots = body && !body.trimStart().startsWith('<') ? body : null;
  let blocksAll = false;
  let agents = [];
  let inRules = false;
  const sitemaps = [];
  for (const line of (robots ?? '').split(/\r?\n/)) {
    const [k, ...rest] = line.replace(/#.*/, '').split(':');
    const key = k.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      if (inRules) { agents = []; inRules = false; }
      agents.push(value);
    } else if (key === 'disallow' || key === 'allow') {
      inRules = true;
      if (key === 'disallow' && value === '/' && agents.includes('*')) blocksAll = true;
    } else if (key === 'sitemap' && value) sitemaps.push(value);
  }
  let sitemap = sitemaps[0] ?? null;
  if (!sitemap) {
    const xml = await text(`${origin}/sitemap.xml`);
    if (xml && /<(urlset|sitemapindex)/.test(xml)) sitemap = `${origin}/sitemap.xml`;
  }
  return { found: robots != null, blocksAll, sitemap };
}

export async function inspectPage(context, url) {
  const page = await context.newPage();
  const requests = [];
  const sizes = [];
  const jsErrors = [];
  const brokenImages = [];
  page.on('request', (r) => requests.push({ url: r.url(), type: r.resourceType() }));
  page.on('requestfinished', (r) => sizes.push(r.sizes().then((s) => s.responseBodySize + s.responseHeadersSize, () => 0)));
  page.on('pageerror', (e) => jsErrors.push(e.message.slice(0, 300)));
  page.on('response', (r) => {
    if (r.request().resourceType() === 'image' && r.status() >= 400) brokenImages.push({ url: r.url(), status: r.status() });
  });
  try {
    const started = Date.now();
    const go = () => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // One retry: a single slow response (cold cache, busy CI runner) shouldn't sink the whole scan
    const res = await go().catch(go).catch((e) => {
      const code = e.message.match(/net::(ERR_[A-Z_]+)/)?.[1];
      throw new Error(code ? `The site is not responding (${code}).` : 'The site did not respond within 30 seconds (tried twice).');
    });
    // Trackers/long-polling can delay the load event forever; the page is usable without it
    const load_ms = await page.waitForLoadState('load', { timeout: 20_000 }).then(() => Date.now() - started, () => null);
    await page.waitForTimeout(1500);
    // Cookie banners often appear a few seconds after load; give them until ~7 s after start
    await page.waitForFunction(() => [...document.querySelectorAll('button, [role="button"]')].some((b) =>
      /accept|agree|akzept|zustimm|accepter|acept|accett|aceit|akceptuj|zgadzam|de acord|allow/i.test(`${b.innerText} ${b.getAttribute('aria-label') ?? ''}`)),
    null, { timeout: Math.max(0, 7000 - (Date.now() - started)) }).catch(() => {});
    const headers = res?.headers() ?? {};
    const status = res?.status() ?? null;
    const html = await page.content();
    const meta = await page.evaluate(() => {
      const og = (p) => document.querySelector(`meta[property="og:${p}"]`)?.content?.trim() ?? '';
      return {
        title: document.title.trim(),
        description: document.querySelector('meta[name="description"]')?.content?.trim() ?? '',
        viewport: !!document.querySelector('meta[name="viewport"]'),
        lang: document.documentElement.lang || '',
        h1: document.querySelectorAll('h1').length,
        icon: document.querySelector('link[rel~="icon"]')?.href ?? null,
        canonical: document.querySelector('link[rel="canonical"]')?.href ?? null,
        noindex: /noindex/i.test(document.querySelector('meta[name="robots"]')?.content ?? ''),
        og: !!(og('title') && og('image')),
        jsonld: document.querySelectorAll('script[type="application/ld+json"]').length,
        imgs: document.images.length,
        imgs_no_alt: [...document.images].filter((i) => !i.hasAttribute('alt')).length,
        // First visit, before any click: footer links + whatever buttons the cookie banner shows
        legal: (() => {
          const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
          const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
          const text = document.body?.innerText ?? '';
          return {
            links: [...document.querySelectorAll('a[href]')].map((a) => ({ text: clean(a.innerText || a.getAttribute('aria-label') || a.title), href: a.href })).slice(0, 600),
            buttons: [...document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')]
              .filter(vis).map((b) => clean(b.innerText || b.value || b.getAttribute('aria-label'))).filter(Boolean).slice(0, 200),
            email: /[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(text),
            phone: /\+\d[\d\s().-]{7,}\d/.test(text),
          };
        })(),
      };
    });
    // Buffered observers replay LCP/CLS entries recorded before we subscribed
    const vitals = await page.evaluate(() => new Promise((resolve) => {
      const out = { lcp: null, cls: 0 };
      try {
        new PerformanceObserver((l) => { const e = l.getEntries().at(-1); if (e) out.lcp = e.startTime; })
          .observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) out.cls += e.value; })
          .observe({ type: 'layout-shift', buffered: true });
      } catch { /* unsupported entry type */ }
      const nav = performance.getEntriesByType('navigation')[0];
      setTimeout(() => resolve({ ...out, ttfb: nav ? nav.responseStart : null }), 300);
    })).catch(() => ({ lcp: null, cls: null, ttfb: null }));
    const bytes = (await Promise.all(sizes)).reduce((a, b) => a + b, 0);
    return {
      status, finalUrl: page.url(), headers, html, meta, requests, load_ms,
      perf: { ...vitals, bytes, requests: requests.length },
      insecure: requests.filter((r) => r.url.startsWith('http://')).map((r) => r.url),
      js_errors: [...new Set(jsErrors)].slice(0, 5),
      broken_images: brokenImages.slice(0, 5),
    };
  } finally {
    await page.close();
  }
}

const FAIL = new Set(['high', 'medium']);
// finding: null = checked and fine, 'unknown' = could not measure, otherwise the severity of an observed problem
export const check = (group, id, label, finding, detail) => ({
  group, id, label, detail,
  verdict: finding == null ? 'rejected' : finding === 'unknown' ? 'needs_validation' : 'confirmed',
  status: finding == null ? 'pass' : FAIL.has(finding) ? 'fail' : 'warn',
  ...(finding && finding !== 'unknown' ? { severity: finding } : {}),
});
export const grade = (v, good, bad) => (v == null ? 'unknown' : v <= good ? null : v <= bad ? 'low' : 'medium');
// Lets the UI list exactly which pages a site-wide check is about
const withPages = (c, list) => (c.status !== 'pass' && list.length ? { ...c, pages: list.slice(0, 30) } : c);
export const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;
const WEIGHT = { pass: 1, warn: 0.5, fail: 0 };
export const scoreChecks = (checks) => Math.round((checks.reduce((s, c) => s + WEIGHT[c.status], 0) / checks.length) * 100);
export const BLOCKED_STATUS = BLOCKED;
const baseDomain = (host) => host.replace(/^\./, '').split('.').slice(-2).join('.');

// A run that finished but never painted within the cap is an observed problem, not "unknown"
function networkChecks(network) {
  const s4g = network.find((n) => n.id === 'slow4g' && !n.error);
  const g3 = network.find((n) => n.id === '3g' && !n.error);
  const slow = (ms, good, bad) => (ms == null ? 'medium' : grade(ms, good, bad));
  const out = [];
  if (s4g) {
    out.push(
      check('network', 'net_fcp', 'First content on slow 4G', slow(s4g.fcp_ms, 3000, 6000),
        s4g.fcp_ms == null ? 'Nothing visible within 45 s' : `Visitors see something after ${sec(s4g.fcp_ms)}`),
      check('network', 'net_lcp', 'Main content on slow 4G', slow(s4g.lcp_ms, 4000, 10_000),
        s4g.lcp_ms == null ? 'Does not appear within 45 s' : `Appears after ${sec(s4g.lcp_ms)} (good: under 4 s)`),
    );
  }
  if (g3) {
    out.push(check('network', 'net_3g', 'Usable on 3G', slow(g3.lcp_ms, 8000, 20_000),
      g3.lcp_ms == null ? 'Main content does not appear within 45 s' : `Main content appears after ${sec(g3.lcp_ms)}`));
  }
  if (!out.length) out.push(check('network', 'net_lcp', 'Main content on slow 4G', 'unknown', 'Could not simulate the connection'));
  return out;
}

function formKind(f) {
  if (f.password) return 'Login';
  if (f.search) return 'Search';
  if (f.email && f.fields <= 2) return 'Newsletter';
  return f.fields >= 3 ? 'Contact / order' : 'Other';
}

function buildArchitecture(home, cookies, pages, siteHost) {
  const own = baseDomain(siteHost);
  const firstParty = (host) => baseDomain(host) === own;
  const reqs = home.requests
    .map((r) => { try { return { type: r.type, u: new URL(r.url) }; } catch { return null; } })
    .filter((r) => r && /^https?:$/.test(r.u.protocol));

  const hosts = new Map();
  for (const { u } of reqs) if (!firstParty(u.hostname)) hosts.set(u.hostname, (hosts.get(u.hostname) ?? 0) + 1);

  // Same footer newsletter on every page: list it once, with page count
  const forms = new Map();
  for (const p of pages) for (const f of p.meta?.forms ?? []) {
    const kind = formKind(f);
    const key = `${kind}|${f.action}`;
    const prev = forms.get(key);
    if (prev) prev.pages++;
    else forms.set(key, {
      kind, method: f.method, action: f.action, fields: f.fields, page: p.url, pages: 1,
      insecure: f.action.startsWith('http:') || (f.password && p.url.startsWith('http:')),
    });
  }

  return {
    server: home.headers.server ?? null,
    powered_by: home.headers['x-powered-by'] ?? null,
    cdn: CDNS.filter(([, test]) => test(home.headers)).map(([name]) => name),
    services: SERVICES.filter(([, , re]) => reqs.some(({ u }) => re.test(u.hostname + u.pathname)))
      .map(([name, category]) => ({ name, category })),
    third_parties: [...hosts].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([host, requests]) => ({ host, requests })),
    apis: [...new Set(reqs.filter((r) => r.type === 'fetch' || r.type === 'xhr').map(({ u }) => u.origin + u.pathname))]
      .slice(0, 15).map((url) => ({ url, first_party: firstParty(new URL(url).hostname) })),
    forms: [...forms.values()].slice(0, 15),
    // Names and flags only, never values
    cookies: cookies.slice(0, 30).map((c) => ({
      name: c.name, domain: c.domain.replace(/^\./, ''), first_party: firstParty(c.domain),
      secure: c.secure, http_only: c.httpOnly, same_site: c.sameSite, session: c.expires === -1,
    })),
  };
}

function buildMap(pages) {
  const index = new Map(pages.map((p, i) => [p.url, i]));
  return {
    nodes: pages.map((p) => {
      const u = new URL(p.url);
      return {
        url: p.url, path: u.pathname + u.search, depth: p.depth, parent: index.get(p.parent) ?? null,
        status: p.http_status, load_ms: p.load_ms, error: !!p.error,
      };
    }),
    edges: pages.flatMap((p, i) => p.internal_links.map((l) => [i, index.get(l)])).slice(0, 400),
  };
}

// Fresh context so the first-visit speed and cookies aren't hidden by a warm cache
export async function inspectHome(browser, siteUrl) {
  const fresh = await browser.newContext();
  try {
    const home = await inspectPage(fresh, siteUrl);
    return { home, cookies: await fresh.cookies() };
  } finally {
    await fresh.close();
  }
}

// partial: home page only, shown while the crawl and slow-network runs are still going
export async function buildOverview(context, siteUrl, pages, network = [], { inspected, partial = false } = {}) {
  const site = new URL(siteUrl);
  const { home, cookies } = inspected ?? await inspectHome(context.browser(), siteUrl);
  if (partial) {
    pages = [{
      url: home.finalUrl, http_status: home.status, load_ms: home.load_ms, js_errors: home.js_errors,
      broken_images: home.broken_images, broken_links: [], internal_links: [], depth: 0, parent: null,
      meta: { title: home.meta.title, description: home.meta.description, imgs: home.meta.imgs, imgs_no_alt: home.meta.imgs_no_alt, forms: [] },
    }];
  }
  const final = new URL(home.finalUrl);
  const h = home.headers;
  const signals = home.html + JSON.stringify(h);

  const platforms = PLATFORMS.filter(([, re]) => re.test(signals)).map(([name]) => name);
  if (/cloudflare/i.test(h.server ?? '')) platforms.push('Cloudflare');

  // Bot protection: results would describe the block page, not the site
  if (BLOCKED.has(home.status)) {
    return validateOverview({
      schema_version: SCHEMA_VERSION,
      blocked: true, status: home.status, title: site.host, final_url: home.finalUrl, platforms,
      type: null, score: null, pages_checked: 0, checks: [], issues: {}, map: null, architecture: null,
    });
  }

  const type = platforms.some((p) => SHOP_PLATFORMS.has(p)) || SHOP_SIGNALS.test(home.html) ? 'Online store'
    : SERVICE_SIGNALS.test(home.html) ? 'Online services / subscriptions'
      : BLOG_SIGNALS.test(home.html) ? 'Blog / publication' : 'Business website';

  const first = pages[0] ?? {};
  const errorPages = pages.filter((p) => p.error || (p.http_status ?? 0) >= 400);
  const slowPages = pages.filter((p) => (p.load_ms ?? 0) > 5000);
  // Same broken link in header/footer appears on every page: report it once, with how many pages show it
  const uniq = (key, pick) => {
    const m = new Map();
    for (const p of pages) for (const x of p[key]) {
      const k = pick(x);
      const prev = m.get(k);
      m.set(k, prev ? { ...prev, pages: prev.pages + 1 } : { ...(typeof x === 'string' ? { message: x } : x), pages: 1 });
    }
    return [...m.values()].sort((a, b) => b.pages - a.pages);
  };
  const brokenLinks = uniq('broken_links', (l) => l.url);
  const brokenImages = uniq('broken_images', (i) => i.url);
  const jsErrors = uniq('js_errors', (e) => e);

  const https = final.protocol === 'https:';
  const [days, redirects, robots, llms] = await Promise.all([
    https ? certDaysLeft(final.hostname) : null,
    httpRedirectsToHttps(context, site.host),
    robotsInfo(context, final.origin),
    llmsInfo(context, final.origin),
  ]);
  const types = schemaTypes(home.html);
  const hasOrg = types.some((t) => ORG_TYPE.test(t));
  const hasWebSite = types.includes('WebSite');
  const missingCore = [!hasOrg && 'Organization', !hasWebSite && 'WebSite'].filter(Boolean);
  const load = first.load_ms;
  const csp = h['content-security-policy'] ?? '';
  const { perf, meta } = home;
  const architecture = buildArchitecture(home, cookies, pages, final.hostname);

  const htmlPages = pages.filter((p) => p.meta);
  const titles = new Map();
  for (const p of htmlPages) if (p.meta.title) titles.set(p.meta.title, (titles.get(p.meta.title) ?? 0) + 1);
  const pageMeta = [
    [htmlPages.filter((p) => !p.meta.title).length, 'without a title'],
    [htmlPages.filter((p) => !p.meta.description).length, 'without a description'],
    [[...titles.values()].filter((n) => n > 1).reduce((s, n) => s + n, 0), 'with a duplicate title'],
  ].filter(([n]) => n).map(([n, what]) => `${n} ${n === 1 ? 'page' : 'pages'} ${what}`);
  const metaPages = htmlPages.map((p) => ({
    url: p.url,
    note: [
      !p.meta.title && 'no title',
      !p.meta.description && 'no description',
      p.meta.title && titles.get(p.meta.title) > 1 && 'duplicate title',
    ].filter(Boolean).join(', '),
  })).filter((p) => p.note);
  const altPages = htmlPages.filter((p) => p.meta.imgs_no_alt)
    .map((p) => ({ url: p.url, note: `${p.meta.imgs_no_alt} ${p.meta.imgs_no_alt === 1 ? 'image' : 'images'} without alt` }));
  const imgs = htmlPages.reduce((s, p) => s + p.meta.imgs, 0);
  const noAlt = htmlPages.reduce((s, p) => s + p.meta.imgs_no_alt, 0);
  const noindex = meta.noindex || /noindex/i.test(h['x-robots-tag'] ?? '');
  const titleLen = meta.title.length;
  const insecureForms = architecture.forms.filter((f) => f.insecure);
  const looseCookies = architecture.cookies.filter((c) => c.first_party && !c.secure);

  const checks = [
    check('availability', 'home', 'Page responds',
      first.http_status && first.http_status < 400 ? null : 'high',
      first.error ?? `HTTP ${first.http_status ?? '—'}`),
    withPages(check('availability', 'pages', 'Site pages work',
      errorPages.length ? 'medium' : null,
      errorPages.length ? `${errorPages.length} of ${pages.length} pages have errors` : `${pages.length} ${pages.length === 1 ? 'page' : 'pages'} checked`),
      errorPages.map((p) => ({ url: p.url, note: p.error ? 'does not load' : `HTTP ${p.http_status}` }))),
    check('availability', 'https', 'Secure connection (HTTPS)',
      https ? null : 'high', https ? 'The site uses HTTPS' : 'The site does not use HTTPS'),
    check('availability', 'cert', 'Valid SSL certificate',
      days == null ? 'unknown' : days < 0 ? 'high' : days < 14 ? 'low' : null,
      days == null ? 'Could not read the certificate' : days < 0 ? 'The certificate has expired' : `Expires in ${days} ${days === 1 ? 'day' : 'days'}`),
    check('availability', 'redirect', 'HTTP redirects to HTTPS',
      redirects == null ? 'unknown' : redirects ? null : 'low',
      redirects == null ? 'Could not check the http:// version' : redirects ? 'OK' : 'The http:// version does not redirect to https://'),

    check('performance', 'load', 'Full page load',
      grade(load, 2500, 5000), load == null ? 'Not measured' : `${sec(load)} until fully loaded`),
    check('performance', 'ttfb', 'Server response time (TTFB)',
      grade(perf.ttfb, 800, 1800), perf.ttfb == null ? 'Not measured' : `${Math.round(perf.ttfb)} ms to first byte`),
    check('performance', 'lcp', 'Main content appears (LCP)',
      grade(perf.lcp, 2500, 4000), perf.lcp == null ? 'Not measured' : `${sec(perf.lcp)} (good: under 2.5 s)`),
    check('performance', 'cls', 'Visual stability (CLS)',
      grade(perf.cls, 0.1, 0.25), perf.cls == null ? 'Not measured' : `${perf.cls.toFixed(2)} (good: under 0.1)`),
    check('performance', 'weight', 'Page size',
      grade(perf.bytes, 2_000_000, 5_000_000), `${(perf.bytes / 1_000_000).toFixed(1)} MB · ${perf.requests} requests`),
    withPages(check('performance', 'slow', 'Slow pages (over 5 s)',
      slowPages.length ? 'low' : null, slowPages.length ? `${slowPages.length} slow ${slowPages.length === 1 ? 'page' : 'pages'}` : 'No slow pages'),
      slowPages.map((p) => ({ url: p.url, note: sec(p.load_ms) }))),

    check('content', 'links', 'Working links',
      brokenLinks.length ? 'medium' : null, brokenLinks.length ? `${brokenLinks.length} broken ${brokenLinks.length === 1 ? 'link' : 'links'}` : 'No broken links'),
    check('content', 'images', 'Images load',
      brokenImages.length ? 'low' : null, brokenImages.length ? `${brokenImages.length} missing ${brokenImages.length === 1 ? 'image' : 'images'}` : 'All images load'),
    check('content', 'js', 'No JavaScript errors',
      jsErrors.length ? 'low' : null, jsErrors.length ? `${jsErrors.length} distinct ${jsErrors.length === 1 ? 'error' : 'errors'} in the console` : 'The console is clean'),
    ...textChecks(check, withPages, pages),

    check('seo', 'index', 'Page can appear in Google',
      noindex ? 'high' : null, noindex ? 'The home page has noindex' : 'Indexing is allowed'),
    check('seo', 'robots', 'robots.txt',
      robots.blocksAll ? 'high' : robots.found ? null : 'low',
      robots.blocksAll ? 'Blocks all search engines (Disallow: /)' : robots.found ? 'OK' : 'robots.txt is missing'),
    check('seo', 'sitemap', 'XML sitemap',
      robots.sitemap ? null : 'low', robots.sitemap ?? 'No sitemap.xml found'),
    check('seo', 'title', 'Page title',
      !titleLen ? 'medium' : titleLen < 10 || titleLen > 65 ? 'low' : null,
      !titleLen ? '<title> is missing' : titleLen > 65 ? `Too long (${titleLen} characters, Google cuts it after ~60)` : titleLen < 10 ? 'Too short' : meta.title),
    check('seo', 'description', 'Description for Google',
      meta.description ? null : 'low', meta.description ? 'Has a meta description' : 'Meta description is missing'),
    withPages(check('seo', 'pages_meta', 'Titles and descriptions on all pages',
      pageMeta.length ? 'low' : null, pageMeta.length ? pageMeta.join(', ') : `${htmlPages.length} ${htmlPages.length === 1 ? 'page' : 'pages'} checked`), metaPages),
    check('seo', 'canonical', 'Canonical URL',
      meta.canonical ? null : 'low', meta.canonical ?? '<link rel="canonical"> is missing'),
    check('seo', 'viewport', 'Mobile-friendly',
      meta.viewport ? null : 'medium', meta.viewport ? 'Has a meta viewport' : 'Meta viewport is missing'),
    check('seo', 'h1', 'Main heading (H1)',
      meta.h1 ? null : 'low', meta.h1 ? `${meta.h1} H1 ${meta.h1 === 1 ? 'heading' : 'headings'}` : 'No H1 on the page'),
    check('seo', 'lang', 'Page language declared',
      meta.lang ? null : 'low', meta.lang || 'The lang attribute is missing'),
    withPages(check('seo', 'alt', 'Alt text on images',
      noAlt ? 'low' : null, noAlt ? `${noAlt} of ${imgs} images without alt` : `${imgs} ${imgs === 1 ? 'image' : 'images'} checked`), altPages),
    check('seo', 'og', 'Share preview (Open Graph)',
      meta.og ? null : 'low', meta.og ? 'Has og:title and og:image' : 'og:title / og:image are missing'),
    check('seo', 'jsonld', 'Structured data (schema.org)',
      meta.jsonld ? null : 'low', meta.jsonld ? `${meta.jsonld} JSON-LD ${meta.jsonld === 1 ? 'block' : 'blocks'}${types.length ? `: ${types.slice(0, 8).join(', ')}` : ''}` : 'No JSON-LD'),
    check('seo', 'schema_core', 'Site identity in schema.org (Organization, WebSite)',
      !missingCore.length ? null : missingCore.length === 2 ? 'low' : 'hardening',
      !missingCore.length ? 'Has Organization and WebSite'
        : `Missing ${missingCore.join(', ')}${types.length ? ` — found on the home page: ${types.slice(0, 6).join(', ')}` : ''}`),
    check('seo', 'llms_txt', 'Guide for AI assistants (llms.txt)',
      llms.llms ? null : 'hardening',
      llms.llms ? (llms.full ? 'Has /llms.txt and /llms-full.txt' : 'Has /llms.txt (optional /llms-full.txt is missing)')
        : llms.full ? 'Only has /llms-full.txt — /llms.txt, the main file, is missing' : '/llms.txt and /llms-full.txt are missing'),

    check('security', 'forms', 'Forms submit securely',
      insecureForms.length ? 'medium' : null,
      insecureForms.length ? `${insecureForms.length} ${insecureForms.length === 1 ? 'form sends' : 'forms send'} data over http://` : `${architecture.forms.length} ${architecture.forms.length === 1 ? 'form' : 'forms'} checked`),
    check('security', 'mixed', 'No insecure content',
      https && home.insecure.length ? 'low' : null,
      https && home.insecure.length ? `${home.insecure.length} ${home.insecure.length === 1 ? 'resource' : 'resources'} loaded over http://` : 'OK'),
    check('security', 'hsts', 'HSTS (forces HTTPS)',
      h['strict-transport-security'] ? null : 'hardening', h['strict-transport-security'] ? 'Enabled' : 'Recommended: Strict-Transport-Security'),
    check('security', 'nosniff', 'Content type protection',
      /nosniff/i.test(h['x-content-type-options'] ?? '') ? null : 'hardening',
      /nosniff/i.test(h['x-content-type-options'] ?? '') ? 'Enabled' : 'Recommended: X-Content-Type-Options: nosniff'),
    check('security', 'frame', 'Clickjacking protection',
      h['x-frame-options'] || /frame-ancestors/i.test(csp) ? null : 'hardening',
      h['x-frame-options'] || /frame-ancestors/i.test(csp) ? 'Enabled' : 'Recommended: X-Frame-Options or CSP frame-ancestors'),
    check('security', 'csp', 'Content Security Policy',
      csp ? null : 'hardening', csp ? 'Enabled' : 'Recommended: Content-Security-Policy'),
    check('security', 'cookies', 'Cookies marked Secure',
      https && looseCookies.length ? 'hardening' : null,
      https && looseCookies.length ? `${looseCookies.length} first-party ${looseCookies.length === 1 ? 'cookie' : 'cookies'} without Secure` : `${architecture.cookies.length} ${architecture.cookies.length === 1 ? 'cookie' : 'cookies'} checked`),
    ...networkChecks(network),
    ...complianceChecks(check, {
      legal: meta.legal, requests: home.requests, cookies, services: architecture.services,
      forms: architecture.forms,
      sales: type === 'Online store' ? 'goods'
        : type === 'Online services / subscriptions' || architecture.services.some((s) => s.category === 'Payments') ? 'services' : null,
    }),
  ].filter((c) => !partial || !SITE_WIDE.has(c.id));

  const score = scoreChecks(checks);

  return validateOverview({
    schema_version: SCHEMA_VERSION,
    blocked: false,
    ...(partial && { partial: true }),
    title: meta.title || site.host,
    description: meta.description,
    icon: meta.icon,
    lang: meta.lang,
    final_url: home.finalUrl,
    platforms,
    type,
    score,
    pages_checked: pages.length,
    load_ms: load ?? null,
    network,
    checks,
    issues: {
      broken_links: brokenLinks.slice(0, 20),
      broken_images: brokenImages.slice(0, 20),
      js_errors: jsErrors.slice(0, 10),
      slow_pages: slowPages.map((p) => ({ url: p.url, load_ms: p.load_ms })).slice(0, 10),
    },
    map: buildMap(pages),
    architecture,
  });
}
