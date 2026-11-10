import { assertPublic } from './api.mjs';

// One browser-side negative check. No submit click, credentials or server validation.
export async function probeFormValidation(browser, url, kind, { validateUrl = assertPublic } = {}) {
  const started = Date.now();
  await validateUrl(new URL(url));
  const context = await browser.newContext({ serviceWorkers: 'block' });
  let armed = false, blocked = 0, page;
  const base = { action: 'probe_form_validation', requested_url: url };
  try {
    await context.route('**/*', async route => {
      if (armed) { blocked++; await route.abort(); return; }
      if (route.request().isNavigationRequest()) {
        try { await validateUrl(new URL(route.request().url())); } catch { await route.abort(); return; }
      }
      await route.continue();
    });
    // WebSocket messages bypass HTTP routing; this probe does not need sockets.
    await context.routeWebSocket('**/*', socket => socket.close());
    page = await context.newPage();
    page.setDefaultTimeout(4000);
    page.on('dialog', dialog => dialog.dismiss());
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    if (!response || response.status() >= 400) throw new Error('The form page could not be opened.');
    await page.waitForTimeout(750);
    armed = true;
    const formIndex = await page.evaluate(kind => {
      const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
      return [...document.forms].findIndex(form => visible(form) && !form.noValidate &&
        (kind === 'access' ? [...form.querySelectorAll('input[type=password]')].some(visible) :
          [...form.querySelectorAll('textarea')].some(visible)) &&
        [...form.querySelectorAll('input[type=email],input[required],textarea[required],select[required]')].some(el => visible(el) && !el.disabled));
    }, kind);
    if (formIndex < 0) return result('validation_inconclusive', 'No visible form with enabled native email or required-field constraints was found. Forms that opt out of native validation need a separate configured check; this does not mean their fields are missing.');
    const form = page.locator('form').nth(formIndex);
    const required = form.locator('input[required]:not([type=hidden]):not([type=password]):not([type=checkbox]):not([type=radio]):not([readonly]):not([disabled]),textarea[required]:not([readonly]):not([disabled])');
    for (const field of await required.all()) if (await field.isVisible()) await field.fill('');
    const empty = await form.evaluate(form => {
      const accepted = form.reportValidity();
      const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.disabled;
      const fields = [...form.elements].filter(visible);
      return { accepted, missing: fields.filter(el => el.validity?.valueMissing).length, native_required: fields.filter(el => el.required).length, aria_only_required: fields.filter(el => el.getAttribute('aria-required') === 'true' && !el.required).length };
    });
    const email = form.locator('input[type=email]:not([readonly]):not([disabled])').first();
    let malformed = null;
    if (await email.isVisible().catch(() => false)) {
      await email.fill('not-an-email');
      malformed = await email.evaluate(field => ({ accepted: field.reportValidity(), type_mismatch: field.validity.typeMismatch }));
    }
    const emptyObserved = empty.native_required > 0 && empty.accepted === false && empty.missing > 0;
    const emailObserved = malformed !== null && malformed.accepted === false && malformed.type_mismatch;
    const observed = emptyObserved && (malformed === null || emailObserved);
    const partial = !observed && (emptyObserved || emailObserved);
    const detail = observed
      ? `Browser validation rejected missing required fields${malformed ? ' and a malformed email' : ''}. No form was submitted. Server validation was not tested.`
      : partial
        ? `${emailObserved ? 'Browser validation rejected a malformed email.' : 'Browser validation rejected empty required fields.'} ${empty.native_required === 0 ? 'No HTML required constraint was present; native empty-field blocking was not confirmed.' : 'Not all native constraints were confirmed.'}${empty.aria_only_required ? ' Some fields use aria-required without HTML required; aria-required describes the field but does not enforce browser validation.' : ''} No form was submitted. Server validation was not tested.`
        : 'The expected native validation was not consistently observed. This does not establish a broken form; JavaScript or server validation was not tested.';
    return result(observed ? 'validation_observed' : partial ? 'validation_partial' : 'validation_inconclusive', detail,
      { cases: { empty_required: { ...empty, result: emptyObserved ? 'rejected' : empty.native_required === 0 ? 'no_native_required_constraint' : 'not_confirmed' }, malformed_email: malformed } });
  } catch (error) {
    return result('validation_inconclusive', 'Could not complete the browser-side form check.', { error: error.message.slice(0, 200) });
  } finally { await context.close(); }

  function result(status, detail, extra = {}) {
    return { ...base, url: page?.url() ?? url, result: status, detail,
      observed_at: new Date().toISOString(), duration_ms: Date.now() - started,
      blocked_requests: blocked, scope: 'native_browser_validation_only', ...extra };
  }
}
