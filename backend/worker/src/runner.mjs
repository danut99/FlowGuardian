import { resolve, findSimilar, toLocator } from './locators.mjs';
import { runCheck } from './health.mjs';

export const STEP_TIMEOUT = 10_000;
const NAV_TIMEOUT = 30_000;
export function stepTimeout(step) {
  const configured = Number(step.note?.match(/(?:^|\|)Timeout v1\|(\d+)\|/)?.[1]);
  return configured >= 1000 && configured <= 60000 ? configured : step.action === 'goto' ? NAV_TIMEOUT : STEP_TIMEOUT;
}

// kind = null means a configuration/worker error, not a site problem.
export class StepFailure extends Error {
  constructor(kind, position, message, proposed = null) {
    super(message);
    this.kind = kind;
    this.position = position;
    this.proposed = proposed;
  }
}

async function target(page, step) {
  const found = await resolve(page, step.locators, stepTimeout(step));
  if (found) return found;
  if (step.locators[0]?.strict) throw new StepFailure('selector_changed', step.position, 'The saved element was not found uniquely. Customer flows require the exact saved target; no replacement was used.');
  const similar = await findSimilar(page, step.locators);
  if (similar) {
    throw new StepFailure('selector_changed', step.position,
      'The element no longer matches the saved selector, but a similar one exists.',
      [similar, ...step.locators]);
  }
  throw new StepFailure('selector_changed', step.position, 'The saved element was not found. Review the test and page state before treating this as a site issue.');
}

async function runStep(page, step, site) {
  const timeout = stepTimeout(step);
  switch (step.action) {
    case 'goto': {
      const url = new URL(step.value || site.href, site);
      if (url.host !== site.host) {
        throw new StepFailure(null, step.position, `URL outside the monitored site: ${url.host}`);
      }
      const res = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout });
      const status = res?.status() ?? 0;
      if (status === 403 || status === 429) {
        throw new StepFailure('blocked', step.position, `Access was blocked (HTTP ${status}).`);
      }
      if (status >= 400) {
        throw new StepFailure('real_bug', step.position, `The page responded with HTTP ${status}.`);
      }
      return null;
    }
    case 'dismiss': {
      const found = await resolve(page, step.locators, 3000);
      if (found) await found.locator.click().catch(() => {});
      return null;
    }
    case 'check': {
      const problem = await runCheck(page, site, step.value);
      if (problem) {
        const failure = new StepFailure(problem.kind, step.position, problem.message);
        failure.screenshot = problem.screenshot;
        throw failure;
      }
      return null;
    }
    case 'press': {
      const { locator } = await target(page, step);
      await locator.press(step.value || 'Enter', { timeout });
      await page.waitForLoadState('load', { timeout }).catch(() => {});
      return null;
    }
    case 'click':
    case 'fill': {
      if (step.credential && new URL(page.url()).origin !== site.origin) {
        throw new StepFailure(null, step.position, 'Test-account fields can only be filled on the configured site origin.');
      }
      const { locator, index } = await target(page, step);
      if (step.action === 'click') await locator.click({ timeout });
      else await locator.fill(step.value ?? '', { timeout });
      // A fallback worked: test passes, but the saved primary selector is stale.
      return index > 0
        ? { position: step.position, locators: [step.locators[index], ...step.locators.filter((_, i) => i !== index)] }
        : null;
    }
    case 'expect_visible': {
      if (!(await resolve(page, step.locators, stepTimeout(step)))) {
        throw new StepFailure('real_bug', step.position, 'The expected element is not visible.');
      }
      return null;
    }
    // value: "6" (exact), ">=3" or "<=10"; locator points at the repeated items (e.g. pricing cards)
    case 'expect_count': {
      const [, op = '=', num] = /^\s*(>=|<=|=)?\s*(\d+)\s*$/.exec(step.value ?? '') ?? [];
      if (!num) throw new StepFailure(null, step.position, `Invalid number: “${step.value}”.`);
      const items = toLocator(page, step.locators[0]);
      const want = Number(num);
      const matches = (n) => (op === '>=' ? n >= want : op === '<=' ? n <= want : n === want);
      // Items often render progressively: poll until the count matches or the step times out
      const deadline = Date.now() + timeout;
      let n = await items.count();
      while (!matches(n) && Date.now() < deadline) {
        await page.waitForTimeout(400);
        n = await items.count();
      }
      if (!matches(n)) throw new StepFailure('real_bug', step.position, `Found ${n} ${n === 1 ? 'element' : 'elements'}, expected ${op === '=' ? '' : op}${want}.`);
      return null;
    }
    case 'expect_text': {
      const scope = step.locators.length ? (await resolve(page, step.locators, stepTimeout(step)))?.locator : page.locator('body');
      const ok = scope && await scope.getByText(step.value, { exact: Boolean(step.strict) }).first()
        .waitFor({ state: 'visible', timeout }).then(() => true, () => false);
      if (!ok) throw new StepFailure('real_bug', step.position, `The text “${step.value}” does not appear on the page.`);
      return null;
    }
    case 'expect_url': {
      const exactPath = step.strict && /^(\/|https?:\/\/)/.test(step.value ?? '') ? new URL(step.value, site) : null;
      const ok = await page.waitForURL((u) => exactPath
        ? u.origin === exactPath.origin && u.pathname === exactPath.pathname && (!exactPath.search || u.search === exactPath.search)
        : u.href.includes(step.value), { timeout })
        .then(() => true, () => false);
      if (!ok) throw new StepFailure('real_bug', step.position, `The URL does not contain “${step.value}” (actual: ${page.url()}).`);
      return null;
    }
    default:
      throw new StepFailure(null, step.position, `Unknown action: ${step.action}`);
  }
}

export async function runSteps(page, steps, siteUrl, { strict = false } = {}) {
  if (strict) steps = steps.map((s) => ({ ...s, strict: true, locators: (s.locators ?? []).slice(0, 1).map((l) => ({ ...l, exact: true, strict: true })) }));
  const site = new URL(siteUrl);
  let drift = null;
  const trace = [];
  for (const step of steps) {
    const started = Date.now();
    const entry = { position: step.position, action: step.action, target: step.locators?.[0]?.name ?? step.locators?.[0]?.value ?? '', value: step.action === 'fill' ? '[redacted]' : step.value, status: 'passed', url: (page.url?.() ?? siteUrl), duration_ms: 0 };
    try {
      page.setDefaultTimeout?.(stepTimeout(step));
      drift = (await runStep(page, step, site)) ?? drift;
      entry.url = (page.url?.() ?? siteUrl);
      entry.duration_ms = Date.now() - started;
      trace.push(entry);
    } catch (e) {
      const failure = e instanceof StepFailure ? e : e?.name === 'TimeoutError' ? new StepFailure('timeout', step.position, e.message) : new StepFailure(null, step.position, e?.message ?? String(e));
      entry.status = 'failed'; entry.url = (page.url?.() ?? siteUrl); entry.duration_ms = Date.now() - started;
      entry.error = step.action === 'fill' ? 'The configured field could not be filled; input value withheld.' : failure.message;
      trace.push(entry); failure.step_trace = trace;
      throw failure;
    }
  }
  return { drift, step_trace: trace };
}
