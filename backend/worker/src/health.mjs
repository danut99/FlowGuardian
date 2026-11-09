// Built-in health checks used by essential tests. Each one loads the page itself because it needs its own listeners/viewport.
import { certDaysLeft, httpRedirectsToHttps } from './overview.mjs';
import { PROFILES, measure } from './network.mjs';

const NAV_TIMEOUT = 30_000;
const MAX_LINKS = 40;

class HealthFailure extends Error {
  constructor(message, screenshot = null) {
    super(message);
    this.screenshot = screenshot;
  }
}

async function open(page, url, waitUntil = 'load') {
  const res = await page.goto(url, { waitUntil, timeout: NAV_TIMEOUT });
  const status = res?.status() ?? 0;
  if (status === 403 || status === 429) {
    const failure = new HealthFailure(`Access was blocked (HTTP ${status}).`);
    failure.kind = 'blocked';
    throw failure;
  }
  if (status >= 400) throw new HealthFailure(`The page responded with HTTP ${status}.`);
  return res;
}

const CHECKS = {
  async speed(page, site, limit) {
    const started = Date.now();
    await open(page, site.href);
    const ms = Date.now() - started;
    if (ms > Number(limit)) throw new HealthFailure(`The page loaded in ${(ms / 1000).toFixed(1)} s (limit: ${limit / 1000} s).`);
  },

  async ssl(_page, site, minDays) {
    const days = await certDaysLeft(site.hostname);
    if (days == null) throw new HealthFailure('Could not read the SSL certificate.');
    if (days < 0) throw new HealthFailure('The SSL certificate has expired.');
    if (days < Number(minDays)) throw new HealthFailure(`The SSL certificate expires in ${days} ${days === 1 ? 'day' : 'days'}.`);
  },

  async https_redirect(page, site) {
    if ((await httpRedirectsToHttps(page.context(), site.host)) === false) {
      throw new HealthFailure('The http:// version no longer redirects to https://.');
    }
  },

  async js_errors(page, site) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await open(page, site.href);
    await page.waitForTimeout(2000);
    if (errors.length) throw new HealthFailure(`${errors.length} JavaScript ${errors.length === 1 ? 'error' : 'errors'}: ${errors[0].slice(0, 200)}`);
  },

  async broken_links(page, site) {
    await open(page, site.href);
    const links = [...new Set(await page.$$eval('a[href]', (as) => as.map((a) => a.href)))]
      .filter((h) => { try { return new URL(h).host === site.host && /^https?:/.test(h); } catch { return false; } })
      .map((h) => h.split('#')[0])
      .slice(0, MAX_LINKS);
    const broken = [];
    const status = async (l) => (await page.context().request.get(l, { timeout: 10_000, maxRedirects: 5 }).catch(() => null))?.status() ?? 0;
    for (let i = 0; i < links.length; i += 8) {
      await Promise.all(links.slice(i, i + 8).map(async (l) => {
        let s = await status(l);
        // One retry: a single dropped request isn't a dead link
        if (s === 0) s = await status(l);
        // Auth/bot statuses aren't proof of a dead link
        if (s === 0 || (s >= 400 && ![401, 403, 405, 429].includes(s))) broken.push(`${l} (${s || 'no response'})`);
      }));
    }
    if (broken.length) throw new HealthFailure(`${broken.length} broken ${broken.length === 1 ? 'link' : 'links'}: ${broken.slice(0, 3).join(', ')}`);
  },

  async broken_images(page, site) {
    const failed = [];
    page.on('response', (r) => { if (r.request().resourceType() === 'image' && r.status() >= 400) failed.push(r.url()); });
    await open(page, site.href);
    await page.waitForTimeout(1500);
    if (failed.length) throw new HealthFailure(`${failed.length} ${failed.length === 1 ? 'image does' : 'images do'} not load: ${failed[0]}`);
  },

  async content(page, site) {
    await open(page, site.href);
    await page.waitForTimeout(1500);
    const { title, text } = await page.evaluate(() => ({ title: document.title.trim(), text: document.body?.innerText.trim().length ?? 0 }));
    if (!title) throw new HealthFailure('The page no longer has a title.');
    if (text < 100) throw new HealthFailure('The page looks empty (almost no visible text).');
  },

  async mobile(page, site) {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, site.href);
    // Splash screens/loaders aren't the real layout
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const r = await page.evaluate(findOverflow);
    if (r.overflow <= 8) return;
    const causes = r.culprits.length ? ` Cause: ${r.culprits.map((c) => c.desc).join(', ')}.` : '';
    const clipY = Math.max(0, Math.min((r.culprits[0]?.top ?? 0) - 120, r.height - 844));
    const shot = await page.screenshot({
      fullPage: true, clip: { x: 0, y: clipY, width: r.width, height: Math.min(844, r.height) },
    }).catch(() => null);
    throw new HealthFailure(`On a phone the page overflows the screen by ${r.overflow}px (horizontal scroll).${causes}`, shot);
  },

  // Watches desktop and phone from the first byte: preloaders that hang or linger, and sideways scroll while loading
  async load_experience(page, site, limit = '5000') {
    const problems = [];
    for (const device of DEVICES) {
      const p = device.phone ? await page.context().newPage() : page;
      try {
        await p.setViewportSize(device.viewport);
        problems.push(...await watchLoad(p, site, device, Number(limit)));
      } finally {
        if (p !== page) await p.close();
      }
      // A hung loader hangs on every device; don't wait another 20 s to say it again
      if (problems.some((x) => x.message.includes('stuck'))) break;
    }
    if (problems.length) {
      // One screenshot per run: the marked overflow says most, then the phone view, desktop last
      const best = [...problems].filter((x) => x.shot).sort((a, b) => a.rank - b.rank)[0];
      throw new HealthFailure(problems.map((x) => x.message).join(' '), best?.shot ?? null);
    }
  },

  async slow_network(page, site, limit) {
    const r = await measure(page.context().browser(), site.href, PROFILES.find((p) => p.id === 'slow4g'));
    if (r.lcp_ms == null) throw new HealthFailure('On slow 4G the main content does not appear within 45 s.');
    if (r.lcp_ms > Number(limit)) {
      throw new HealthFailure(`On slow 4G the main content appears after ${(r.lcp_ms / 1000).toFixed(1)} s (limit: ${limit / 1000} s).`);
    }
  },
};
// Tests created before load_experience existed
CHECKS.mobile_load = CHECKS.load_experience;

const DEVICES = [
  { label: 'Desktop', viewport: { width: 1366, height: 768 }, phone: false },
  { label: 'Phone', viewport: { width: 390, height: 844 }, phone: true },
];
const STUCK_MS = 20_000;
const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;

// Runs in the page. A loader = full-screen, non-interactive overlay on top; consent walls/modals have buttons
function pageState() {
  const doc = document.documentElement;
  const body = document.body;
  const overflow = doc.scrollWidth - doc.clientWidth;
  if (!body) return { ready: false, cover: null, overflow: 0 };
  const vw = innerWidth;
  const vh = innerHeight;
  const scrollLocked = [doc, body].some((el) => /hidden|clip/.test(getComputedStyle(el).overflowY));
  const coverAt = (x, y) => {
    for (let el = document.elementFromPoint(x, y); el && el !== body && el !== doc; el = el.parentElement) {
      const s = getComputedStyle(el);
      // Absolute heroes scroll away; an absolute overlay only blocks the page when scrolling is locked
      if (s.position !== 'fixed' && !(s.position === 'absolute' && scrollLocked)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < vw * 0.9 || r.height < vh * 0.9 || Number(s.opacity) < 0.5 || Number(s.zIndex) < 0) continue;
      if (el.querySelector('a[href], button, input, select, textarea')) return null;
      return el;
    }
    return null;
  };
  // Same overlay at three points, so an empty spot over a fixed background doesn't count
  const hits = [[0.5, 0.5], [0.25, 0.3], [0.75, 0.7]].map(([x, y]) => coverAt(vw * x, vh * y));
  const el = hits[0] && hits.every((h) => h === hits[0]) ? hits[0] : null;
  const cover = el && `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : [...el.classList].slice(0, 2).map((c) => `.${c}`).join('')}>`;
  const hasContent = body.innerText.trim().length >= 20 || document.images.length > 0;
  return { ready: !cover && hasContent, cover, overflow };
}

async function watchLoad(page, site, device, limit) {
  const started = Date.now();
  const since = () => Date.now() - started;
  let loadedAt = null;
  page.waitForLoadState('load', { timeout: NAV_TIMEOUT }).then(() => { loadedAt = Date.now(); }, () => {});
  const res = await page.goto(site.href, { waitUntil: 'commit', timeout: NAV_TIMEOUT });
  if ((res?.status() ?? 0) >= 400) throw new HealthFailure(`The page responded with HTTP ${res.status()}.`);

  let readyAt = null;
  let cover = null;
  let lateShot = null;
  let overflow = null;
  // Keep watching 3 s past load/ready: entrance animations run after the loader goes away
  const settled = () => readyAt != null && loadedAt && Date.now() > Math.max(loadedAt, started + readyAt) + 3000;
  while (since() < STUCK_MS && !settled()) {
    // Execution context is replaced while the document commits; just sample again
    const s = await page.evaluate(pageState).catch(() => null);
    if (s) {
      if (readyAt == null) {
        if (s.ready) readyAt = since();
        else {
          cover = s.cover ?? cover;
          if (!lateShot && since() >= limit) lateShot = await page.screenshot().catch(() => null);
        }
      }
      if (!overflow && s.overflow > 8) {
        const at = since();
        const r = await page.evaluate(findOverflow).catch(() => null);
        const shot = await page.screenshot({
          fullPage: true, clip: { x: 0, y: 0, width: r?.width ?? device.viewport.width + s.overflow, height: device.viewport.height },
        }).catch(() => null);
        await page.evaluate(() => {
          document.querySelectorAll('[data-fg-mark]').forEach((el) => el.remove());
          document.querySelectorAll('[data-fg-overflow]').forEach((el) => el.removeAttribute('data-fg-overflow'));
        }).catch(() => {});
        overflow = { at, px: s.overflow, causes: r?.culprits.map((c) => c.desc) ?? [], shot };
      }
    }
    await page.waitForTimeout(200);
  }

  const problems = [];
  const what = cover ? `the loading screen ${cover}` : 'a blank page';
  const rank = (overflowShot) => (overflowShot ? 0 : 1) + (device.phone ? 0 : 2);
  if (readyAt == null) {
    problems.push({
      message: `${device.label}: the page is stuck on ${what} after ${STUCK_MS / 1000} s.`,
      shot: await page.screenshot().catch(() => null), rank: rank(false),
    });
  } else if (readyAt > limit) {
    problems.push({ message: `${device.label}: ${what} covers the content for ${sec(readyAt)} (limit: ${sec(limit)}).`, shot: lateShot, rank: rank(false) });
  }
  if (overflow) {
    const final = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth).catch(() => 0);
    const causes = overflow.causes.length ? ` Cause: ${overflow.causes.join(', ')}.` : '';
    // Permanent phone overflow is the 'mobile' test's job
    if (final <= 8) {
      problems.push({ message: `${device.label}: while loading (at ${sec(overflow.at)}) the page overflows the screen by ${overflow.px}px.${causes}`, shot: overflow.shot, rank: rank(true) });
    } else if (!device.phone) {
      problems.push({ message: `${device.label}: the page overflows the screen by ${final}px (horizontal scroll).${causes}`, shot: overflow.shot, rank: rank(true) });
    }
  }
  return problems;
}

// Runs in the page: finds the outermost elements that stick out past the phone screen and marks them for the screenshot
function findOverflow() {
  const doc = document.documentElement;
  const vw = doc.clientWidth;
  const width = doc.scrollWidth;
  const height = doc.scrollHeight;
  const overflow = width - vw;
  const culprits = [];
  if (overflow > 8) {
    const sticksOut = (el) => el.getBoundingClientRect().right > vw + 1;
    // Content inside a clipping/scrolling box (carousels) doesn't make the page scroll
    const clipped = (el) => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (getComputedStyle(a).overflowX !== 'visible') return true;
      }
      return false;
    };
    for (const el of document.body.querySelectorAll('*')) {
      if (culprits.length >= 3) break;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.right <= vw + 1) continue;
      if (el.parentElement !== document.body && sticksOut(el.parentElement)) continue;
      if (getComputedStyle(el).position === 'fixed' || clipped(el)) continue;
      el.setAttribute('data-fg-overflow', '');
      const cls = [...el.classList].slice(0, 2).map((c) => `.${c}`).join('');
      culprits.push({ desc: `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : cls}>`, top: rect.top + scrollY });
    }
    const style = document.createElement('style');
    style.setAttribute('data-fg-mark', '');
    style.textContent = '[data-fg-overflow]{outline:3px solid #f43f5e!important;outline-offset:-3px;background-color:rgba(244,63,94,.18)!important}';
    document.head.append(style);
    const beyond = document.createElement('div');
    beyond.setAttribute('data-fg-mark', '');
    beyond.style.cssText = `position:absolute;top:0;left:${vw}px;width:${overflow}px;height:${height}px;`
      + 'background:repeating-linear-gradient(45deg,rgba(244,63,94,.22) 0 10px,rgba(244,63,94,.08) 10px 20px);'
      + 'border-left:3px dashed #f43f5e;z-index:2147483647;pointer-events:none;box-sizing:border-box';
    doc.append(beyond);
  }
  return { overflow, width, height, culprits };
}

export async function runCheck(page, site, spec) {
  const [name, arg] = (spec ?? '').split(':');
  const fn = CHECKS[name];
  if (!fn) throw new Error(`Unknown check: ${spec}`);
  try {
    await fn(page, site, arg);
    return null;
  } catch (e) {
    if (e instanceof HealthFailure) return { message: e.message, screenshot: e.screenshot, kind: e.kind ?? 'real_bug' };
    throw e;
  }
}

// Replaced essentials; removed from sites on the next scan
export const RETIRED_ESSENTIALS = ['mobile_load'];

// Essential tests created for every site. `when` = overview check that must pass now (monitor regressions, not known issues).
export const ESSENTIALS = [
  { key: 'availability', name: 'Site is up', kind: 'page_load', freq: 60, steps: [{ action: 'goto' }] },
  { key: 'speed', name: 'Page loads in under 5 seconds', freq: 360, when: 'load', check: 'speed:5000' },
  { key: 'content', name: 'Page content is visible', freq: 360, when: 'title', check: 'content' },
  { key: 'ssl', name: 'SSL certificate is valid', freq: 1440, when: 'cert', check: 'ssl:14' },
  { key: 'https_redirect', name: 'HTTP redirects to HTTPS', freq: 1440, when: 'redirect', check: 'https_redirect' },
  { key: 'js_errors', name: 'No JavaScript errors', freq: 1440, when: 'js', check: 'js_errors' },
  { key: 'broken_links', name: 'Links on the page work', freq: 1440, when: 'links', check: 'broken_links' },
  { key: 'broken_images', name: 'Images load', freq: 1440, when: 'images', check: 'broken_images' },
  { key: 'mobile', name: 'Page displays correctly on phones', freq: 1440, when: 'viewport', check: 'mobile' },
  { key: 'load_experience', name: 'Loading looks right (preloader, sideways scroll)', freq: 1440, when: 'home', check: 'load_experience:5000' },
  { key: 'slow_network', name: 'Loads acceptably on slow 4G', freq: 1440, when: 'net_lcp', check: 'slow_network:10000' },
];
