import os from 'node:os';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { runSteps, StepFailure, STEP_TIMEOUT } from './runner.mjs';
import { scanPage } from './scanner.mjs';
import { crawlSite } from './crawler.mjs';
import { buildOverview, inspectHome } from './overview.mjs';
import { ESSENTIALS, RETIRED_ESSENTIALS } from './health.mjs';
import { measureSlowNetwork } from './network.mjs';
import { analyzePage, deepAnalyze } from './pages.mjs';
import { checkApi } from './api.mjs';
import { watchPage } from './debug.mjs';
import { assetChanges, compare, currentFingerprint, snapshot } from './deploys.mjs';
import { aiEnabled } from './ai.mjs';
import { answer } from './assistant.mjs';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  // Node < 22 has no native WebSocket
  realtime: { transport: ws },
});
const BUDGET_MS = Number(process.env.WORKER_BUDGET_MS ?? 10 * 60_000);
// More parallel pages skews timings on a 2-CPU runner and looks like a bot to the site
const PAGE_CONCURRENCY = 3;
const SEVERITY = { selector_changed: 'maintenance', blocked: 'maintenance', real_bug: 'critical', timeout: 'critical' };

async function attempt(browser, test) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT);
  const collectDebug = watchPage(page);
  try {
    return await runSteps(page, test.steps, test.site.url);
  } catch (e) {
    const failure = e instanceof StepFailure ? e : new StepFailure(null, null, e?.message ?? String(e));
    // Some checks capture a purpose-made screenshot (e.g. mobile overflow highlighted)
    const screenshot = failure.screenshot ?? await page.screenshot().catch(() => null);
    const debug = await collectDebug().catch(() => null);
    return { failure, screenshot, debug };
  } finally {
    await context.close();
  }
}

async function finish(run, fields, started) {
  const { error } = await db.from('runs')
    .update({ ...fields, duration_ms: Date.now() - started, finished_at: new Date().toISOString() })
    .eq('id', run.id);
  if (error) console.error(`Run ${run.id}: could not save result`, error.message);
}

async function openIncident(run, severity, message, proposed) {
  if (severity === 'maintenance') {
    const { count } = await db.from('incidents').select('id', { count: 'exact', head: true })
      .eq('test_id', run.test_id).eq('severity', 'maintenance').eq('status', 'open');
    if (count) return;
  }
  const { error } = await db.from('incidents').insert({
    run_id: run.id, test_id: run.test_id, severity, message, proposed_locators: proposed,
  });
  if (error) console.error(`Run ${run.id}: could not open incident`, error.message);
}

async function processRun(browser, run) {
  const started = Date.now();
  const { data: test, error } = await db.from('tests')
    .select('id, name, site:sites(url, verified_at), steps:test_steps(position, action, locators, value)')
    .eq('id', run.test_id)
    .order('position', { referencedTable: 'test_steps' })
    .single();
  if (error) return finish(run, { status: 'error', error: error.message }, started);
  // Runs can be queued manually from the dashboard, so re-check ownership verification here.
  if (!test.site.verified_at) return finish(run, { status: 'error', error: 'Site not verified.' }, started);

  let result = await attempt(browser, test);
  if (result.failure?.kind === 'real_bug' || result.failure?.kind === 'timeout') {
    result = await attempt(browser, test);
  }

  if (!result.failure) {
    await finish(run, { status: 'passed' }, started);
    if (result.drift) {
      await openIncident(run, 'maintenance',
        `${test.name}: step ${result.drift.position} only worked with a fallback selector.`, result.drift.locators);
    }
    console.log(`PASS ${test.name}`);
    return;
  }

  const f = result.failure;
  let screenshot_path = null;
  if (result.screenshot) {
    const path = `${test.id}/${run.id}.png`;
    const { error: upErr } = await db.storage.from('screenshots').upload(path, result.screenshot, { contentType: 'image/png' });
    if (upErr) console.error(`Run ${run.id}: screenshot upload failed`, upErr.message);
    else screenshot_path = path;
  }
  await finish(run, {
    status: f.kind ? 'failed' : 'error',
    failure_kind: f.kind,
    failed_step: f.position,
    error: f.message,
    screenshot_path,
    debug: result.debug ?? null,
  }, started);
  if (f.kind) await openIncident(run, SEVERITY[f.kind], `${test.name}: ${f.message}`, f.proposed);
  console.log(`${f.kind ? 'FAIL' : 'ERROR'} ${test.name}: ${f.message}`);
}

async function ensureEssentialTests(site, overview) {
  if (overview.blocked) return [];
  await db.from('tests').delete().eq('site_id', site.id).in('essential_key', RETIRED_ESSENTIALS);
  const { data: existing } = await db.from('tests').select('essential_key').eq('site_id', site.id).not('essential_key', 'is', null);
  const have = new Set((existing ?? []).map((t) => t.essential_key));
  const passing = new Set(overview.checks.filter((c) => c.status === 'pass').map((c) => c.id));
  const created = [];
  for (const e of ESSENTIALS) {
    if (have.has(e.key) || (e.when && !passing.has(e.when))) continue;
    const { data: test, error } = await db.from('tests').insert({
      site_id: site.id, name: e.name, kind: e.kind ?? 'health', status: 'approved', frequency_minutes: e.freq, essential_key: e.key,
    }).select('id').single();
    if (error) throw error;
    const steps = e.steps ?? [{ action: 'check', value: e.check }];
    const { error: stepErr } = await db.from('test_steps').insert(steps.map((s, i) => ({ test_id: test.id, position: i + 1, ...s })));
    if (stepErr) throw stepErr;
    created.push(e.key);
  }
  return created;
}

// Automatic on every new site: overview + essential checks + uptime test. No proposals here.
async function processScan(browser, site) {
  const context = await browser.newContext();
  try {
    // Home page first (~10 s) so the dashboard has results while the crawl runs
    const inspected = await inspectHome(browser, site.url);
    const quick = await buildOverview(context, site.url, [], [], { inspected, partial: true });
    if (!quick.blocked) await db.from('sites').update({ overview: quick }).eq('id', site.id);
    const [pages, network] = quick.blocked ? [[], []]
      // On small servers the throttled phone runs would starve the crawl (and skew both timings)
      : os.cpus().length >= 4 ? await Promise.all([crawlSite(context, site.url), measureSlowNetwork(browser, site.url)])
        : [await crawlSite(context, site.url), await measureSlowNetwork(browser, site.url)];
    const overview = quick.blocked ? quick : await buildOverview(context, site.url, pages, network, { inspected });
    await db.from('page_checks').delete().eq('site_id', site.id);
    await removeFolder(db.storage.from('page-shots'), site.id);
    const { error } = await db.from('page_checks').insert(pages.map((p) => ({
      site_id: site.id, url: p.url, http_status: p.http_status, load_ms: p.load_ms, error: p.error ?? null,
      js_errors: p.js_errors, broken_links: p.broken_links, broken_images: p.broken_images,
    })));
    if (error) console.error(`Scan ${site.url}: could not save page checks`, error.message);
    const created = await ensureEssentialTests(site, overview);
    await db.from('sites')
      .update({
        overview, scan_status: 'done', scanned_at: new Date().toISOString(),
        pages_status: overview.blocked || !pages.length ? 'idle' : 'pending',
      })
      .eq('id', site.id);
    console.log(`SCAN ${site.url}: ${overview.blocked ? 'blocked' : `score ${overview.score}`}, ${pages.length} pages, +${created.length} essential tests`);
    if (!overview.blocked) await recordMetrics(site.id, 'scan', { load_ms: overview.load_ms }, overview.score);
  } catch (e) {
    await db.from('sites').update({ scan_status: 'error', scan_error: e?.message ?? String(e) }).eq('id', site.id);
    console.log(`SCAN ERROR ${site.url}: ${e?.message ?? e}`);
  } finally {
    await context.close();
  }
}

// Stage 2, right after the scan: every crawled page gets speed + SEO + errors. Rows update live in the dashboard.
async function processPages(browser, site) {
  const { data: rows, error } = await db.from('page_checks')
    .select('id, url, broken_links').eq('site_id', site.id).eq('status', 'pending');
  if (error) {
    await db.from('sites').update({ pages_status: 'error' }).eq('id', site.id);
    return console.log(`PAGES ERROR ${site.url}: ${error.message}`);
  }
  let i = 0;
  await Promise.all(Array.from({ length: PAGE_CONCURRENCY }, async () => {
    while (i < rows.length) {
      const row = rows[i++];
      const fields = await analyzePage(browser, row)
        .then((r) => ({ status: 'done', analysis_error: null, ...r }))
        .catch((e) => ({ status: 'error', analysis_error: e?.message?.split('\n')[0] ?? String(e) }));
      const { error: upErr } = await db.from('page_checks').update(fields).eq('id', row.id);
      if (upErr) console.error(`Page ${row.url}: could not save`, upErr.message);
    }
  }));
  await db.from('sites').update({ pages_status: 'done' }).eq('id', site.id);
  console.log(`PAGES ${site.url}: ${rows.length} analyzed`);
}

// Stage 3, on demand for one page ("Analizează în detaliu").
async function processDeep(browser, row) {
  try {
    const { result, images } = await deepAnalyze(browser, row.url);
    const bucket = db.storage.from('page-shots');
    const shots = {};
    for (const [name, buf] of Object.entries(images)) {
      if (!buf) continue;
      const path = `${row.site_id}/${row.id}/${name}.png`;
      const { error } = await bucket.upload(path, buf, { contentType: 'image/png', upsert: true });
      if (error) console.error(`Deep ${row.url}: ${name} upload failed`, error.message);
      else shots[name] = path;
    }
    await db.from('page_checks')
      .update({ deep_status: 'done', deep: { ...result, shots, analyzed_at: new Date().toISOString() } })
      .eq('id', row.id);
    console.log(`DEEP ${row.url}`);
  } catch (e) {
    await db.from('page_checks').update({ deep_status: 'error', deep_error: e?.message ?? String(e) }).eq('id', row.id);
    console.log(`DEEP ERROR ${row.url}: ${e?.message ?? e}`);
  }
}

// On demand only (user picks a page and clicks "Găsește teste").
async function processSuggest(browser, site) {
  const context = await browser.newContext();
  // Never trust the requested page blindly: it must be on the site's own host
  let pageUrl = site.url;
  try {
    if (site.suggest_url && new URL(site.suggest_url).host === new URL(site.url).host) pageUrl = site.suggest_url;
  } catch { /* invalid URL: fall back to the site URL */ }
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT);
    const proposals = await scanPage(page, site.url, pageUrl);

    // New suggestions for this page replace earlier ones for the same page; approved tests stay untouched.
    await db.from('tests').delete().eq('site_id', site.id).eq('status', 'proposed').eq('page_url', pageUrl);
    // Proposals made before per-page suggestions have no page_url and belonged to the home page
    if (pageUrl === site.url) await db.from('tests').delete().eq('site_id', site.id).eq('status', 'proposed').is('page_url', null);
    for (const p of proposals) {
      const { data: test, error } = await db.from('tests')
        .insert({ site_id: site.id, name: p.name, kind: p.kind, page_url: pageUrl }).select('id').single();
      if (error) throw error;
      const { error: stepErr } = await db.from('test_steps').insert(p.steps.map((s, i) => ({
        test_id: test.id, position: i + 1, action: s.action, locators: s.locators ?? [], value: s.value ?? null,
      })));
      if (stepErr) throw stepErr;
    }
    await db.from('sites').update({ suggest_status: 'done' }).eq('id', site.id);
    console.log(`SUGGEST ${pageUrl}: ${proposals.length} tests`);
  } catch (e) {
    await db.from('sites').update({ suggest_status: 'error', suggest_error: e?.message ?? String(e) }).eq('id', site.id);
    console.log(`SUGGEST ERROR ${site.url}: ${e?.message ?? e}`);
  } finally {
    await context.close();
  }
}

async function drain(rpc, deadline, handle, before) {
  while (Date.now() < deadline) {
    await before?.();
    const { data, error } = await db.rpc(rpc);
    if (error) throw error;
    if (!data?.[0]) return;
    await handle(data[0]);
  }
}

// Storage objects don't cascade with rows: drop screenshot folders ({test_id}/...) of deleted tests.
async function cleanupOrphanScreenshots() {
  const bucket = db.storage.from('screenshots');
  const { data: folders, error } = await bucket.list('', { limit: 1000 });
  if (error || !folders?.length) return;
  const ids = folders.filter((f) => f.id === null).map((f) => f.name);
  if (!ids.length) return;
  const { data: alive } = await db.from('tests').select('id').in('id', ids);
  const orphans = ids.filter((id) => !alive?.some((t) => t.id === id));
  for (const id of orphans) {
    const { data: files } = await bucket.list(id, { limit: 1000 });
    if (files?.length) await bucket.remove(files.map((f) => `${id}/${f.name}`));
  }
  if (orphans.length) console.log(`Cleanup: removed screenshots of ${orphans.length} deleted tests`);
}

// Storage list() is one level deep: walk {site_id}/{page_id}/files
async function removeFolder(bucket, prefix) {
  const { data: entries } = await bucket.list(prefix, { limit: 1000 });
  if (!entries?.length) return;
  const files = entries.filter((e) => e.id !== null).map((e) => `${prefix}/${e.name}`);
  if (files.length) await bucket.remove(files);
  for (const dir of entries.filter((e) => e.id === null)) await removeFolder(bucket, `${prefix}/${dir.name}`);
}

async function cleanupOrphanPageShots() {
  const bucket = db.storage.from('page-shots');
  const { data: folders, error } = await bucket.list('', { limit: 1000 });
  if (error || !folders?.length) return;
  const ids = folders.filter((f) => f.id === null).map((f) => f.name);
  if (!ids.length) return;
  const { data: alive } = await db.from('sites').select('id').in('id', ids);
  const orphans = ids.filter((id) => !alive?.some((s) => s.id === id));
  for (const id of orphans) await removeFolder(bucket, id);
  if (orphans.length) console.log(`Cleanup: removed page screenshots of ${orphans.length} deleted sites`);
}

// Stored as "<mode>:<generator>|<asset>\n<asset>..."; mode q = with query strings, p = paths only
const fingerprintKey = (fp) => `${fp.stripQuery ? 'p' : 'q'}:${fp.generator ?? ''}|${fp.assets.join('\n')}`;
function parseFingerprint(key) {
  const body = key.slice(2);
  const i = body.indexOf('|');
  return { generator: body.slice(0, i) || null, assets: body.slice(i + 1).split('\n').filter(Boolean) };
}

async function checkDeploy(browser, context, site) {
  const now = new Date().toISOString();
  const touch = (fields = {}) => db.from('sites').update({ deploy_checked_at: now, ...fields }).eq('id', site.id);
  const fp = await currentFingerprint(context, site.url);
  if (!fp) return touch();
  if (fp.unstable) return touch({ deploy_tracking: 'unstable' });
  const key = fingerprintKey(fp);
  const prev = site.deploy_fingerprint;

  // First check (or detection mode changed): this version becomes the reference, no deploy recorded
  if (!prev || !site.baseline || prev[0] !== key[0]) {
    const baseline = site.baseline ?? await snapshot(browser, site.url);
    if (!site.baseline) await recordMetrics(site.id, 'daily', baseline);
    return touch({ deploy_fingerprint: key, deploy_tracking: 'on', baseline });
  }
  if (prev === key) return touch({ deploy_tracking: 'on' });

  const old = parseFingerprint(prev);
  const { data: deploy, error } = await db.from('deploys').insert({
    site_id: site.id,
    before: site.baseline,
    changes: { ...assetChanges(old.assets, fp.assets), generator: old.generator !== fp.generator ? { before: old.generator, after: fp.generator } : null },
  }).select('id').single();
  if (error) throw error;
  // Saved before measuring so a crash mid-way doesn't record the same deploy again next run
  await touch({ deploy_fingerprint: key, deploy_tracking: 'on' });

  const { data: tests } = await db.from('tests').select('id').eq('site_id', site.id).eq('status', 'approved').eq('enabled', true);
  if (tests?.length) await db.from('runs').insert(tests.map((t) => ({ test_id: t.id })));

  try {
    const after = await snapshot(browser, site.url);
    const findings = compare(site.baseline, after);
    await db.from('deploys').update({ status: 'done', after, findings }).eq('id', deploy.id);
    await db.from('sites').update({ baseline: after }).eq('id', site.id);
    await recordMetrics(site.id, 'deploy', after);
    console.log(`DEPLOY ${site.url}: ${findings.length} changes, ${tests?.length ?? 0} tests queued`);
  } catch (e) {
    await db.from('deploys').update({ status: 'error', error: e?.message ?? String(e) }).eq('id', deploy.id);
  }
}

// Every worker run: cheap HTTP fingerprint per site; browser work only when a new version is detected
async function checkDeploys(browser) {
  const { data: sites, error } = await db.from('sites')
    .select('id, url, overview, deploy_fingerprint, baseline').eq('scan_status', 'done');
  if (error) throw error;
  const context = await browser.newContext();
  try {
    for (const site of sites ?? []) {
      if (!site.overview || site.overview.blocked) continue;
      await checkDeploy(browser, context, site).catch((e) => console.error(`Deploy check ${site.url}:`, e?.message ?? e));
      await dailySample(browser, site).catch((e) => console.error(`Daily sample ${site.url}:`, e?.message ?? e));
    }
  } finally {
    await context.close();
  }
  const cutoff = new Date(Date.now() - METRICS_RETENTION_DAYS * 86_400_000).toISOString();
  await db.from('site_metrics').delete().lt('measured_at', cutoff);
}

const METRICS_RETENTION_DAYS = 180;

async function recordMetrics(siteId, source, s, score = null) {
  const int = (v) => (v == null ? null : Math.round(v));
  const { error } = await db.from('site_metrics').insert({
    site_id: siteId, source, score,
    load_ms: int(s.load_ms), ttfb: int(s.ttfb), lcp: int(s.lcp), cls: s.cls ?? null,
    bytes: int(s.bytes), requests: int(s.requests), js_errors: s.js_errors?.length ?? null,
  });
  if (error) console.error(`Metrics ${siteId}: could not save`, error.message);
}

// One home-page measurement per day per site, so speed trends exist even without deploys
async function dailySample(browser, site) {
  const since = new Date(Date.now() - 23 * 3_600_000).toISOString();
  const { count } = await db.from('site_metrics').select('id', { count: 'exact', head: true })
    .eq('site_id', site.id).in('source', ['daily', 'deploy']).gte('measured_at', since);
  if (count) return;
  await recordMetrics(site.id, 'daily', await snapshot(browser, site.url));
}

const API_CONCURRENCY = 10;
const API_RETENTION_DAYS = 30;

async function runApiMonitors() {
  let total = 0;
  for (;;) {
    const { data: monitors, error } = await db.rpc('claim_due_api_monitors', { batch: 50 });
    if (error) throw error;
    if (!monitors?.length) break;
    let i = 0;
    await Promise.all(Array.from({ length: API_CONCURRENCY }, async () => {
      while (i < monitors.length) {
        const m = monitors[i++];
        let r = await checkApi(m);
        // One retry before recording a failure: a single dropped request isn't an outage
        if (r.status !== 'passed') r = await checkApi(m);
        const { error: insErr } = await db.from('api_checks').insert({ monitor_id: m.id, ...r });
        if (insErr) console.error(`API ${m.name}: could not save`, insErr.message);
        await db.from('api_monitors').update({ last_status: r.status }).eq('id', m.id);
      }
    }));
    total += monitors.length;
  }
  const cutoff = new Date(Date.now() - API_RETENTION_DAYS * 86_400_000).toISOString();
  await db.from('api_checks').delete().lt('created_at', cutoff);
  if (total) console.log(`API Guardian: ${total} checks`);
}

async function processAi(browser, req) {
  const fail = (error) => db.from('ai_requests').update({ status: 'error', error }).eq('id', req.id);
  if (!aiEnabled()) return fail('The AI assistant is not configured (GEMINI_API_KEY is missing).');
  const { data: site } = await db.from('sites').select('url').eq('id', req.site_id).single();
  if (!site) return fail('Site not found.');
  let pageUrl = site.url;
  try {
    if (req.page_url && new URL(req.page_url).host === new URL(site.url).host) pageUrl = req.page_url;
  } catch { /* invalid URL: use the site URL */ }
  try {
    const r = await answer(browser, { siteUrl: site.url, pageUrl, prompt: req.prompt });
    await db.from('ai_requests').update({
      status: 'done', reply: r.reply, draft: r.draft, verified: r.verified ?? null, verify_error: r.verify_error ?? null,
    }).eq('id', req.id);
    console.log(`AI ${pageUrl}: ${r.draft ? (r.verified ? 'test verified' : 'test failed dry-run') : 'no test'}`);
  } catch (e) {
    await fail(/Gemini/.test(e?.message) ? 'The AI assistant is not responding right now. Try again in a minute.' : (e?.message ?? String(e)).split('\n')[0]);
    console.log(`AI ERROR: ${e?.message ?? e}`);
  }
}

async function main() {
  // interactive: only claim queued jobs. Scheduling and maintenance stay in the single scheduled worker so parallel runs don't duplicate them.
  const full = process.env.WORKER_MODE !== 'interactive';
  if (full) {
    const { data: queued, error } = await db.rpc('enqueue_due_runs');
    if (error) throw error;
    if (queued) console.log(`Enqueued ${queued} due runs`);
    await cleanupOrphanScreenshots().catch((e) => console.error('Cleanup failed:', e?.message ?? e));
    await cleanupOrphanPageShots().catch((e) => console.error('Cleanup failed:', e?.message ?? e));
    // Plain HTTP, no browser: run first so API checks keep their schedule even when browser jobs are slow
    await runApiMonitors().catch((e) => console.error('API Guardian failed:', e?.message ?? e));
  }

  const browser = await chromium.launch();
  const deadline = Date.now() + BUDGET_MS;
  try {
    // Someone is waiting on these: chat, new-site scans and test runs go first, and again between every background job.
    // Test runs take seconds each, so scheduled ones riding along with "Rulează" clicks cost little.
    const interactive = async () => {
      await drain('claim_next_ai', deadline, (r) => processAi(browser, r));
      await drain('claim_next_scan', deadline, (s) => processScan(browser, s));
      await drain('claim_next_run', deadline, (r) => processRun(browser, r));
    };
    await interactive();
    if (full) await checkDeploys(browser).catch((e) => console.error('Deploy detection failed:', e?.message ?? e));
    await drain('claim_next_deep', deadline, (p) => processDeep(browser, p), interactive);
    await drain('claim_next_pages', deadline, (s) => processPages(browser, s), interactive);
    await drain('claim_next_suggest', deadline, (s) => processSuggest(browser, s), interactive);
  } finally {
    await browser.close();
  }
}

// Most urgent first: someone is waiting on chat, scans and test runs
const QUEUES = [
  ['claim_next_ai', processAi], ['claim_next_scan', processScan], ['claim_next_run', processRun],
  ['claim_next_deep', processDeep], ['claim_next_pages', processPages], ['claim_next_suggest', processSuggest],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function maintain(browser, last) {
  const now = Date.now();
  const { data: queued, error } = await db.rpc('enqueue_due_runs');
  if (error) throw error;
  if (queued) console.log(`Enqueued ${queued} due runs`);
  await runApiMonitors();
  if (now - last.deploys > 10 * 60_000) {
    last.deploys = now;
    await checkDeploys(browser);
  }
  if (now - last.cleanup > 60 * 60_000) {
    last.cleanup = now;
    await cleanupOrphanScreenshots();
    await cleanupOrphanPageShots();
  }
}

// Always-on server: WORKER_SLOTS jobs in parallel, picked up within seconds; scheduling and maintenance every minute.
// Only slot 0 polls while idle; it wakes the others when it finds work, so an idle server makes ~1 query/s.
async function daemon() {
  const slots = Number(process.env.WORKER_SLOTS ?? 3);
  let browser = await chromium.launch();
  const getBrowser = async () => {
    if (!browser.isConnected()) browser = await chromium.launch();
    return browser;
  };
  let stopping = false;
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { stopping = true; wakeAll(); });
  let waiters = [];
  const wakeAll = () => { waiters.forEach((w) => w()); waiters = []; };
  const idle = (ms) => new Promise((r) => {
    const t = setTimeout(r, ms);
    waiters.push(() => { clearTimeout(t); r(); });
  });

  const takeOne = async () => {
    for (const [rpc, handle] of QUEUES) {
      const { data, error } = await db.rpc(rpc);
      if (error) throw error;
      if (data?.[0]) {
        wakeAll();
        await handle(await getBrowser(), data[0]);
        return true;
      }
    }
    return false;
  };
  const slot = async (i) => {
    while (!stopping) {
      let worked = false;
      try {
        worked = await takeOne();
      } catch (e) {
        console.error(`Slot ${i}:`, e?.message ?? e);
      }
      if (!worked && !stopping) await idle(i === 0 ? 2_000 : 60_000);
    }
  };
  const last = { deploys: 0, cleanup: 0 };
  const maintenance = async () => {
    while (!stopping) {
      await maintain(await getBrowser(), last).catch((e) => console.error('Maintenance failed:', e?.message ?? e));
      for (let s = 0; s < 60 && !stopping; s++) await sleep(1_000);
    }
  };

  console.log(`Worker always-on: ${slots} parallel jobs`);
  await Promise.all([...Array.from({ length: slots }, (_, i) => slot(i)), maintenance()]);
  await browser.close();
}

(process.env.WORKER_MODE === 'daemon' ? daemon() : main()).catch((e) => {
  console.error(e);
  process.exit(1);
});
