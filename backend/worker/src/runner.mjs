import { resolve, findSimilar, toLocator } from './locators.mjs';
import { runCheck } from './health.mjs';

export const STEP_TIMEOUT = 10_000;
const NAV_TIMEOUT = 30_000;

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
  const found = await resolve(page, step.locators, STEP_TIMEOUT);
  if (found) return found;
  const similar = await findSimilar(page, step.locators);
  if (similar) {
    throw new StepFailure('selector_changed', step.position,
      'Elementul nu mai corespunde selectorului salvat, dar există unul asemănător.',
      [similar, ...step.locators]);
  }
  throw new StepFailure('real_bug', step.position, 'Elementul nu a fost găsit pe pagină.');
}

async function runStep(page, step, site) {
  switch (step.action) {
    case 'goto': {
      const url = new URL(step.value || site.href, site);
      if (url.host !== site.host) {
        throw new StepFailure(null, step.position, `URL în afara site-ului verificat: ${url.host}`);
      }
      const res = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      const status = res?.status() ?? 0;
      if (status === 403 || status === 429) {
        throw new StepFailure('blocked', step.position, `Accesul a fost blocat (HTTP ${status}).`);
      }
      if (status >= 400) {
        throw new StepFailure('real_bug', step.position, `Pagina a răspuns cu HTTP ${status}.`);
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
        const failure = new StepFailure('real_bug', step.position, problem.message);
        failure.screenshot = problem.screenshot;
        throw failure;
      }
      return null;
    }
    case 'press': {
      const { locator } = await target(page, step);
      await locator.press(step.value || 'Enter');
      await page.waitForLoadState('load', { timeout: STEP_TIMEOUT }).catch(() => {});
      return null;
    }
    case 'click':
    case 'fill': {
      const { locator, index } = await target(page, step);
      if (step.action === 'click') await locator.click();
      else await locator.fill(step.value ?? '');
      // A fallback worked: test passes, but the saved primary selector is stale.
      return index > 0
        ? { position: step.position, locators: [step.locators[index], ...step.locators.filter((_, i) => i !== index)] }
        : null;
    }
    case 'expect_visible': {
      if (!(await resolve(page, step.locators, STEP_TIMEOUT))) {
        throw new StepFailure('real_bug', step.position, 'Elementul așteptat nu este vizibil.');
      }
      return null;
    }
    // value: "6" (exact), ">=3" or "<=10"; locator points at the repeated items (e.g. pricing cards)
    case 'expect_count': {
      const [, op = '=', num] = /^\s*(>=|<=|=)?\s*(\d+)\s*$/.exec(step.value ?? '') ?? [];
      if (!num) throw new StepFailure(null, step.position, `Număr invalid: „${step.value}”.`);
      const items = toLocator(page, step.locators[0]);
      const want = Number(num);
      const matches = (n) => (op === '>=' ? n >= want : op === '<=' ? n <= want : n === want);
      // Items often render progressively: poll until the count matches or the step times out
      const deadline = Date.now() + STEP_TIMEOUT;
      let n = await items.count();
      while (!matches(n) && Date.now() < deadline) {
        await page.waitForTimeout(400);
        n = await items.count();
      }
      if (!matches(n)) throw new StepFailure('real_bug', step.position, `Am găsit ${n} elemente, așteptam ${op === '=' ? '' : op}${want}.`);
      return null;
    }
    case 'expect_text': {
      const scope = step.locators.length ? (await resolve(page, step.locators, STEP_TIMEOUT))?.locator : page.locator('body');
      const ok = scope && await scope.getByText(step.value).first()
        .waitFor({ state: 'visible', timeout: STEP_TIMEOUT }).then(() => true, () => false);
      if (!ok) throw new StepFailure('real_bug', step.position, `Textul „${step.value}” nu apare pe pagină.`);
      return null;
    }
    case 'expect_url': {
      const ok = await page.waitForURL((u) => u.href.includes(step.value), { timeout: STEP_TIMEOUT })
        .then(() => true, () => false);
      if (!ok) throw new StepFailure('real_bug', step.position, `URL-ul nu conține „${step.value}” (actual: ${page.url()}).`);
      return null;
    }
    default:
      throw new StepFailure(null, step.position, `Acțiune necunoscută: ${step.action}`);
  }
}

export async function runSteps(page, steps, siteUrl) {
  const site = new URL(siteUrl);
  let drift = null;
  for (const step of steps) {
    try {
      drift = (await runStep(page, step, site)) ?? drift;
    } catch (e) {
      if (e instanceof StepFailure) throw e;
      if (e?.name === 'TimeoutError') throw new StepFailure('timeout', step.position, e.message);
      throw new StepFailure('real_bug', step.position, e?.message ?? String(e));
    }
  }
  return { drift };
}
