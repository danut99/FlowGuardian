import { runSteps, StepFailure, STEP_TIMEOUT } from './runner.mjs';
import { watchPage } from './debug.mjs';
import { classifyAttempts } from './outcomes.mjs';

async function attempt(browser, test) {
  const started_at = new Date().toISOString();
  let context, page, collectDebug;
  let result;
  try {
    context = await browser.newContext();
    page = await context.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT);
    collectDebug = watchPage(page);
    result = await runSteps(page, test.steps, test.site.url);
  } catch (e) {
    const failure = e instanceof StepFailure ? e : new StepFailure(null, null, e?.message ?? String(e));
    const screenshot = failure.screenshot ?? await page?.screenshot({ timeout: 3000 }).catch(() => null);
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
    await context?.close().catch(() => {});
  }
  return { ...result, started_at, finished_at: new Date().toISOString() };
}

export async function executeTest(browser, test) {
  const attempts = [await attempt(browser, test)];
  if (['real_bug', 'timeout'].includes(attempts[0].failure?.kind)) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    attempts.push(await attempt(browser, test));
  }
  return { attempts, result: attempts.at(-1), decision: classifyAttempts(attempts) };
}
