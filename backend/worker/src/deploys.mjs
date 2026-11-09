// Deploy detection without CI: a new production version ships new JS/CSS asset URLs (hashes, ?ver=, build IDs).
import { inspectPage, sec } from './overview.mjs';

const ASSET_REL = /\b(stylesheet|modulepreload|preload)\b/i;

function attr(tag, name) {
  return tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(1).find((v) => v != null) ?? null;
}

// Same-host scripts/styles only: third-party tags (analytics, chat) change without the site being redeployed
export function fingerprint(html, pageUrl, { stripQuery = false } = {}) {
  const host = new URL(pageUrl).host;
  const assets = new Set();
  const add = (raw) => {
    if (!raw) return;
    try {
      const u = new URL(raw, pageUrl);
      if (u.host !== host) return;
      assets.add(stripQuery ? u.pathname : u.pathname + u.search);
    } catch { /* not a URL */ }
  };
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) add(attr(tag, 'src'));
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) if (ASSET_REL.test(attr(tag, 'rel') ?? '')) add(attr(tag, 'href'));
  const generator = html.match(/<meta[^>]+name=["']generator["'][^>]*>/i)?.[0];
  const list = [...assets].sort();
  return { key: `${generator ? attr(generator, 'content') : ''}|${list.join('\n')}`, assets: list, generator: generator ? attr(generator, 'content') : null };
}

async function fetchHtml(context, url) {
  const res = await context.request.get(url, { timeout: 20_000, maxRedirects: 5 });
  if (!res.ok() || !(res.headers()['content-type'] ?? '').includes('html')) return null;
  return { html: await res.text(), url: res.url() };
}

// Two fetches: if they disagree the page randomizes asset URLs and would fake a deploy every run
export async function currentFingerprint(context, url) {
  const [a, b] = [await fetchHtml(context, url), await fetchHtml(context, url)];
  if (!a || !b) return null;
  let fa = fingerprint(a.html, a.url);
  let fb = fingerprint(b.html, b.url);
  if (fa.key === fb.key) return { ...fa, stripQuery: false };
  fa = fingerprint(a.html, a.url, { stripQuery: true });
  fb = fingerprint(b.html, b.url, { stripQuery: true });
  return fa.key === fb.key ? { ...fa, stripQuery: true } : { unstable: true };
}

// Two measurements, best of each: one slow sample on a shared runner shouldn't look like a regression
export async function snapshot(browser, url) {
  const samples = [];
  for (let i = 0; i < 2; i++) {
    const context = await browser.newContext();
    try {
      samples.push(await inspectPage(context, url));
    } catch (e) {
      if (!samples.length && i === 1) throw e;
    } finally {
      await context.close();
    }
  }
  const best = (f) => {
    const v = samples.map(f).filter((x) => x != null);
    return v.length ? Math.min(...v) : null;
  };
  const p = samples[samples.length - 1];
  return {
    status: p.status,
    load_ms: best((s) => s.load_ms),
    ttfb: best((s) => s.perf.ttfb),
    lcp: best((s) => s.perf.lcp),
    cls: best((s) => s.perf.cls),
    bytes: best((s) => s.perf.bytes),
    requests: best((s) => s.perf.requests),
    js_errors: [...new Set(samples.flatMap((s) => s.js_errors))].slice(0, 10),
    title: p.meta.title,
    description: p.meta.description,
    canonical: p.meta.canonical,
    noindex: p.meta.noindex || /noindex/i.test(p.headers['x-robots-tag'] ?? ''),
    h1: p.meta.h1,
    measured_at: new Date().toISOString(),
  };
}

const mb = (b) => `${(b / 1e6).toFixed(1)} MB`;

export function compare(before, after) {
  const out = [];
  const add = (severity, message, improved = false) => out.push({ severity, message, improved });
  const worse = (a, b, ratio, abs) => a != null && b != null && b - a > abs && b > a * ratio;

  if ((after.status ?? 0) >= 400 && (before.status ?? 0) < 400) add('high', `Pagina principală răspunde acum cu HTTP ${after.status}.`);
  if (after.noindex && !before.noindex) add('high', 'Pagina a primit „noindex”: Google o va scoate din rezultate.');
  if (!after.noindex && before.noindex) add('info', '„noindex” a fost scos: pagina poate apărea din nou în Google.', true);

  const newErrors = after.js_errors.filter((e) => !before.js_errors.includes(e));
  const fixedErrors = before.js_errors.filter((e) => !after.js_errors.includes(e));
  if (newErrors.length) add('medium', `${newErrors.length} ${newErrors.length === 1 ? 'eroare JavaScript nouă' : 'erori JavaScript noi'}: ${newErrors[0].slice(0, 160)}`);
  if (fixedErrors.length) add('info', `${fixedErrors.length} ${fixedErrors.length === 1 ? 'eroare JavaScript a dispărut' : 'erori JavaScript au dispărut'}.`, true);

  if (worse(before.lcp, after.lcp, 1.25, 500)) add('medium', `Conținutul principal apare mai târziu: ${sec(before.lcp)} → ${sec(after.lcp)}.`);
  else if (worse(after.lcp, before.lcp, 1.25, 500)) add('info', `Conținutul principal apare mai repede: ${sec(before.lcp)} → ${sec(after.lcp)}.`, true);
  if (worse(before.ttfb, after.ttfb, 1.5, 300)) add('low', `Serverul răspunde mai greu: ${Math.round(before.ttfb)} ms → ${Math.round(after.ttfb)} ms.`);
  if (after.cls != null && before.cls != null && after.cls > 0.1 && after.cls - before.cls > 0.05) {
    add('low', `Pagina „sare” mai mult la încărcare (CLS ${before.cls.toFixed(2)} → ${after.cls.toFixed(2)}).`);
  }
  if (worse(before.bytes, after.bytes, 1.3, 300_000)) add('low', `Pagina e mai grea: ${mb(before.bytes)} → ${mb(after.bytes)}.`);
  else if (worse(after.bytes, before.bytes, 1.3, 300_000)) add('info', `Pagina e mai ușoară: ${mb(before.bytes)} → ${mb(after.bytes)}.`, true);
  if (worse(before.requests, after.requests, 1.3, 15)) add('low', `Mai multe cereri: ${before.requests} → ${after.requests}.`);

  if (before.title && !after.title) add('medium', 'Pagina nu mai are titlu.');
  else if (before.title !== after.title) add('info', `Titlul s-a schimbat: „${before.title}” → „${after.title}”.`);
  if (before.description && !after.description) add('low', 'Descrierea pentru Google (meta description) a dispărut.');
  if (before.canonical !== after.canonical) add('low', `Adresa canonică s-a schimbat: ${before.canonical ?? '—'} → ${after.canonical ?? '—'}.`);
  if (before.h1 && !after.h1) add('low', 'Pagina nu mai are titlu principal (H1).');

  const rank = { high: 0, medium: 1, low: 2, info: 3 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function assetChanges(before, after) {
  const b = new Set(before ?? []);
  const a = new Set(after ?? []);
  return { added: [...a].filter((x) => !b.has(x)).slice(0, 20), removed: [...b].filter((x) => !a.has(x)).slice(0, 20) };
}
