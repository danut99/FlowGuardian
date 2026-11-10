import { runSteps, StepFailure, STEP_TIMEOUT } from './runner.mjs';
import { randomBytes } from 'node:crypto';
import { watchPage } from './debug.mjs';
import { classifyAttempts } from './outcomes.mjs';
import { needsTestCredentials, resolveCredentialSteps, protectCredentialEvidence } from './test-credentials.mjs';

async function attempt(browser, test) {
  const started_at = new Date().toISOString();
  let context, page, collectDebug;
  let result;
  try {
    context = await browser.newContext({ serviceWorkers: test.credentialRun ? 'block' : 'allow' });
    if (test.credentialRun) {
      const origin = new URL(test.site.url).origin;
      await context.route('**/*', async route => {
        if (route.request().isNavigationRequest() && new URL(route.request().url()).origin !== origin) {
          await route.abort(); return;
        }
        await route.continue();
      });
    }
    page = await context.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT);
    collectDebug = test.credentialRun ? null : watchPage(page);
    result = await runSteps(page, test.steps, test.site.url, { strict: test.credentialRun || test.name?.startsWith('[Flow] ') });
  } catch (e) {
    const failure = e instanceof StepFailure ? e : new StepFailure(null, null, e?.message ?? String(e));
    const screenshot = test.credentialRun ? null : failure.screenshot ?? await page?.screenshot({ timeout: 3000 }).catch(() => null);
    result = { failure, screenshot };
  } finally {
    if (result && collectDebug) {
      let timer;
      try {
        result.debug = await Promise.race([
          collectDebug(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Diagnostic collection timed out')), 3000); }),
        ]);
      } catch (error) {
        result.debug = {
          url: page.url(), title: null, viewport: page.viewportSize(), user_agent: null,
          console: [], page_errors: [], network: [], captured_at: new Date().toISOString(),
          collection_error: error.message,
        };
      } finally {
        clearTimeout(timer);
      }
    }
    if (result?.debug) result.debug.step_trace = result.step_trace ?? result.failure?.step_trace ?? [];
    await context?.close().catch(() => {});
  }
  if (test.credentialRun) result = protectCredentialEvidence(result, test.site.url, test.evidenceComparisonKey);
  return { ...result, started_at, finished_at: new Date().toISOString() };
}

export async function executeTest(browser, test, { credentials, allowHttpForTests = false } = {}) {
  if (needsTestCredentials(test.steps)) {
    const url = new URL(test.site.url);
    if (url.protocol !== 'https:' && !(allowHttpForTests && ['127.0.0.1', 'localhost'].includes(url.hostname))) {
      throw new Error('A verified HTTPS site is required for test-account flows.');
    }
    test = { ...test, credentialRun: true, evidenceComparisonKey: randomBytes(32), steps: resolveCredentialSteps(test.steps, credentials) };
  }
  const attempts = [await attempt(browser, test)];
  if (['real_bug', 'timeout'].includes(attempts[0].failure?.kind)) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    attempts.push(await attempt(browser, test));
  }
  return { attempts, result: attempts.at(-1), decision: classifyAttempts(attempts) };
}
