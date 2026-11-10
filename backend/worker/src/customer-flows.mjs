import { probeSearch } from './search-discovery.mjs';
import { probeFormValidation } from './form-validation.mjs';
import { assertPublic } from './api.mjs';
export const FLOW_PREFIX = '[Flow] ';
export const isFlow = (test) => test.name?.startsWith(FLOW_PREFIX);

export function distinctFlows(candidates, limit = 3) {
  const targets = new Map(), kinds = new Set();
  return candidates.filter((candidate) => {
    let key;
    try { const u = new URL(candidate.target_url); key = u.origin + u.pathname.replace(/\/$/, '').toLowerCase(); } catch { return false; }
    const existing = targets.get(key) ?? [];
    if (kinds.has(candidate.kind) || existing.length && !(candidate.discovery_strength === 'control_observed' && existing.every(c => c.discovery_strength === 'control_observed'))) return false;
    targets.set(key, [...existing, candidate]); kinds.add(candidate.kind); return true;
  }).slice(0, limit);
}

export function suggestFlows(url, { links = [], forms = [], observations = [], limit = 3 } = {}) {
  const origin = new URL(url).origin;
  const own = links.filter((l) => { try { return new URL(l.href, url).origin === origin && !/logout|signout|delete|unsubscribe/i.test(l.href); } catch { return false; } });
  const definitions = [
    ['purchase', 'Choose a product and inspect purchase options', /products?\/|collections?\/|\/cart\b/i, 'product', ['Open the product page', 'Choose available product options', 'Check the intended option and price before adding to cart'], 'Choose a product option and expected price. Review cart actions before enabling them; no order is placed automatically.'],
    ['request', 'Open the contact form and check required fields', /contact|demo|quote/i, 'contact', ['Follow the contact link', 'Locate the contact form', 'Check the required fields and submit control'], 'Configure test inputs and the expected on-page confirmation. Submission requires review; inbox delivery is not verified.'],
    ['search', 'Search and check the expected result', /search/i, 'search', ['Locate the search field', 'Enter an owner-selected query', 'Check that the expected result appears'], 'Choose a query and expected result before running the configured search.'],
    ['access', 'Reach the sign-in form and inspect account inputs', /login|sign.?up|register|account/i, 'access', ['Follow the account link', 'Locate the sign-in or registration form', 'Check the required account inputs'], 'Configure test credentials and the expected signed-in state. Authentication is not tested during public discovery.'],
    ['interaction', 'Open the main app experience', /start|play|get started/i, 'app_entry', ['Open the starting page', 'Activate the observed entry button', 'Check the expected next screen'], 'Choose the expected screen and review the entry action before execution. Gameplay and account creation are not verified during discovery.'],
    ['navigation', 'Explore services or pricing', /pricing|about|plans|services/i, 'navigation', ['Follow the service or pricing link', 'Inspect the destination content', 'Define the specific content or next action to monitor'], 'Choose a specific expected heading or content. A reachable page alone does not verify a customer journey.'],
  ];
  const candidates = definitions.flatMap(([kind, name, re, control, plan, expected]) => {
    const observed = observations.find((o) => o.controls?.[control] || kind === 'access' && (o.controls?.access_entry || o.controls?.account_email));
    const actualControl = observed?.controls?.[control] ? control : kind === 'access' && observed?.controls?.access_entry ? 'access_entry' : kind === 'access' && observed?.controls?.account_email ? 'account_email' : control;
    const observedControl = observed?.controls?.[actualControl];
    const link = (kind === 'purchase' ? own.find((l) => /\/products?\//i.test(new URL(l.href, url).pathname)) : null) ?? own.find((l) => re.test(new URL(l.href, url).pathname + ' ' + l.text));
    if (!observed && !link && !(kind === 'request' && forms.some((f) => f.contact))) return [];
    const target = observed?.url ?? (link ? new URL(link.href, url).href : url);
    const sourceLink = own.find(l => new URL(l.href, url).href === target) ?? link;
    return [{ kind, name: actualControl === 'access_entry' ? 'Open the sign-in entry point' : name, entry_url: url, target_url: target, target_name: sourceLink?.text ?? '',
      evidence: observed ? observedControl.evidence : link ? `Found link: ${link.text || new URL(link.href, url).pathname}` : 'Found a contact-form signal',
      expected, state: 'possible', control_kind: actualControl, suggested_steps: actualControl === 'access_entry' ? ['Locate the observed sign-in button', 'Open the sign-in dialog or account screen', 'Check the expected account inputs'] : plan,
      discovery_strength: observed ? 'control_observed' : 'link_only',
      destination_origin: observed?.destination_origin, observed_controls: observedControl ?? null }];
  });
  // Prefer observed controls over keyword matches; semantic types and target pages must be distinct.
  candidates.sort((a,b) => Number(b.discovery_strength === 'control_observed') - Number(a.discovery_strength === 'control_observed'));
  return distinctFlows(candidates, limit);
}

async function inspectSignals(page) {
  return page.evaluate(() => {
    const visible = (el) => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    const inputs = [...document.querySelectorAll('input:not([type=hidden]),textarea,select')].filter(visible);
    const describe = el => ({ tag: el.tagName.toLowerCase(), type: el.getAttribute('type') ?? '', name: el.getAttribute('name') ?? '', label: el.getAttribute('aria-label') || el.labels?.[0]?.textContent?.trim().slice(0,100) || el.getAttribute('placeholder') || '', required: Boolean(el.required || el.getAttribute('aria-required') === 'true'), native_required: Boolean(el.required), aria_required: el.getAttribute('aria-required') === 'true' });
    const formList = [...document.forms].filter(visible);
    const search = inputs.find(el => el.type === 'search' || /search|query|zoeken|caut/i.test([el.name,el.placeholder,el.getAttribute('aria-label')].join(' ')));
    const password = inputs.find(el => el.type === 'password');
    const contact = formList.find(f => f.querySelector('textarea') && f.querySelector('input[type=email],input[name*=email]') && !f.querySelector('input[type=password]'));
    const productRoot = document.querySelector('main') ?? document;
    const productButtons = [...productRoot.querySelectorAll('button,input[type=submit],[role=button]')].filter(visible).filter(el => /add to cart|add to bag|buy now|adauga|adaug[a?]|check\s*out|purchase/i.test((el.getAttribute('aria-label') ?? '') + ' ' + (el.textContent || el.value || '')));
    const optionButtons = [...productRoot.querySelectorAll('button,[role=button]')].filter(visible).filter(el => el.hasAttribute('data-variant-id') || el.hasAttribute('data-option-value') || /^select\s+.+/i.test(el.getAttribute('aria-label') ?? ''));
    const variantFields = [...productRoot.querySelectorAll('select,input[type=radio],input[type=number]')].filter(visible);
    const product = /products?\//i.test(location.pathname) && (productButtons.length > 0 || optionButtons.length > 0 || variantFields.length > 0);
    const controls = {};
    const entryButtons = [...document.querySelectorAll('button,[role="button"]')].filter(visible).filter(el => !el.disabled && el.getAttribute('aria-disabled') !== 'true');
    const buttonName = el => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
    const accessEntry = entryButtons.find(el => /^(sign[ -]?in|log[ -]?in|i have an account|create (an )?account|sign[ -]?up|register|autentificare|conectare|conecteaz[a?]-?te|intra in cont)$/i.test(buttonName(el)));
    const appEntry = entryButtons.find(el => /^(play( free| now)?|start( game| playing)?|get started|launch (app|game)|try (it|now|free)|joac[a?]( gratis)?|[i?]ncepe( jocul)?)$/i.test(buttonName(el)));
    if (accessEntry && !password) controls.access_entry = { evidence: `Observed visible account-entry button: "${buttonName(accessEntry)}". The account form was not opened.`, fields: [], buttons: [buttonName(accessEntry)], stage: 'entry_button_only' };
    if (appEntry) controls.app_entry = { evidence: `Observed visible application-entry button: "${buttonName(appEntry)}". The next screen was not opened.`, fields: [], buttons: [buttonName(appEntry)], stage: 'entry_button_only' };
    if(search) controls.search = { evidence: 'Observed a visible search input', fields: [describe(search)] };
    if (!password && /login|authentication|account/i.test(location.pathname) && inputs.some(el=>el.type==='email')) controls.account_email = {evidence:'Observed account email form on the sign-in destination. Authentication was not submitted.',fields:inputs.filter(el=>el.type==='email').map(describe)};
    if(password) controls.access = { evidence: 'Observed a visible password field and account inputs', fields: inputs.filter(el=>el.type==='email'||el.type==='password'||/user|login/i.test(el.name)).map(describe) };
    if(contact) controls.contact = { evidence: 'Observed a contact form with email and message fields', fields: [...contact.querySelectorAll('input:not([type=hidden]),textarea,select')].filter(visible).map(describe) };
    if(product) controls.product = { evidence: optionButtons.length ? `Observed ${optionButtons.length} visible product-option buttons${productButtons.length ? ' and purchase controls' : ''}. Selection, cart and checkout were not tested.` : 'Observed product options or purchase controls. Selection, cart and checkout were not tested.', fields: variantFields.map(describe), buttons: [...new Set([...optionButtons, ...productButtons].map(buttonName).filter(Boolean))].slice(0, 20), stage: 'product_controls_observed' };
    return { url: location.href, title: document.title, screen_text: document.body.innerText.slice(0, 4000), visible_inputs: inputs.map(describe), dialog_count: [...document.querySelectorAll('[role=dialog],dialog[open]')].filter(visible).length, icon: document.querySelector('link[rel~="icon"]')?.href ?? null,
      links: [...document.querySelectorAll('a[href]')].filter(visible).slice(0,500).map(a=>({href:a.href,text:a.textContent.trim().slice(0,100)})),
      forms: formList.map(f=>({contact:f===contact})), controls };
  });
}

export async function probeEntryButton(browser, url, label, { validateUrl = assertPublic } = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const steps = [];
  let armed = false, blocked = 0;
  try {
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.route('**/*', async route => {
      const req = route.request();
      if (armed && (!['GET', 'HEAD'].includes(req.method()) || /\/(logout|signout|delete|cart\/add|unsubscribe)(?:[/?]|$)/i.test(req.url()))) { blocked++; await route.abort(); return; }
      if (req.isNavigationRequest()) { try { await validateUrl(new URL(req.url())); } catch { await route.abort(); return; } }
      await route.continue();
    });
    await validateUrl(new URL(url));
    const page = await context.newPage();
    await page.addInitScript(() => document.addEventListener('submit', e => { e.preventDefault(); e.stopImmediatePropagation(); }, true));
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(500);
    const before = await inspectSignals(page);
    steps.push({ action: 'direct_navigation', requested_url: url, url: page.url(), title: before.title, http_status: response?.status(), duration_ms: 0, observed_at: new Date().toISOString(), result: response?.ok() ? 'page_responded' : 'http_error' });
    const target = page.getByRole('button', { name: label, exact: true });
    const eligible = [];
    for (let i = 0; i < await target.count(); i++) if (await target.nth(i).isVisible()) eligible.push(target.nth(i));
    if (eligible.length !== 1) throw new Error('The entry button was missing or ambiguous; no replacement was clicked.');
    if (await eligible[0].evaluate(el => !!el.closest('form') && (!el.getAttribute('type') || el.getAttribute('type') === 'submit'))) throw new Error('This button submits a form; discovery stopped before submission.');
    armed = true;
    const started = Date.now();
    await eligible[0].click({ timeout: 5000 });
    await page.waitForTimeout(1200);
    const after = await inspectSignals(page);
    const changed = after.url !== before.url || after.visible_inputs.length > before.visible_inputs.length || after.dialog_count > before.dialog_count || after.screen_text !== before.screen_text;
    const step = { action: 'click_entry', target_label: label, requested_url: url, url: page.url(), title: after.title, duration_ms: Date.now() - started,
      observed_at: new Date().toISOString(), result: changed ? 'entry_opened' : 'entry_inconclusive', fields: after.visible_inputs,
      detail: changed ? `Clicked "${label}"; observed ${after.visible_inputs.length} visible input fields${after.dialog_count ? ' and an open dialog' : ''}.` : `Clicked "${label}", but the expected next state was not confirmed.`,
      blocked_requests: blocked };
    steps.push(step);
    return { opened: changed, fields: after.visible_inputs, url: after.url, steps, buttons: Object.values(after.controls).flatMap(c => c.buttons ?? []) };
  } catch (error) {
    steps.push({ action: 'click_entry', target_label: label, requested_url: url, url, duration_ms: 0, observed_at: new Date().toISOString(), result: 'entry_inconclusive', detail: error.message.slice(0, 250) });
    return { opened: false, fields: [], url, steps, buttons: [] };
  } finally { await context.close(); }
}

export async function discoverFlows(browser, url, { validateUrl = assertPublic, limit = 3 } = {}) {
  await validateUrl(new URL(url));
  const context = await browser.newContext();
  try {
    await context.route('**/*', async route => {
      if (route.request().isNavigationRequest()) {
        try { await validateUrl(new URL(route.request().url())); } catch { await route.abort(); return; }
      }
      await route.continue();
    });
    const page = await context.newPage();
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!res || res.status() >= 400) throw new Error(`Discovery could not open the page: HTTP ${res?.status() ?? 'unknown'}`);
    await page.waitForTimeout(1200);
    const signals = await inspectSignals(page);
    const observations = [signals];
    const origin = new URL(signals.url).origin;
    const seen = new Set([signals.url]);
    const categories = new Map();
    const targets = signals.links.filter(l => {
      try { const target = new URL(l.href); target.hash=''; if(target.origin!==origin || seen.has(target.href) || /logout|signout|delete|unsubscribe/i.test(target.href) || !/products?\/|contact|demo|quote|search|login|sign.?up|account|register|pricing|services/i.test(target.pathname+' '+l.text))return false;const category = /products?\//i.test(target.pathname) ? 'product' : /contact|demo|quote/i.test(target.pathname+' '+l.text) ? 'contact' : /search/i.test(target.pathname+' '+l.text) ? 'search' : /login|sign.?up|account|register/i.test(target.pathname+' '+l.text) ? 'account' : 'navigation'; if((categories.get(category) ?? 0)>=1)return false;categories.set(category,1);seen.add(target.href);return true; } catch{return false;}
    }).slice(0,8);
    for(const target of targets) {
      try {
        const response=await page.goto(target.href,{waitUntil:'domcontentloaded',timeout:12000});
        if(!response || response.status()>=400)continue;
        await page.waitForTimeout(500);
        const observation = await inspectSignals(page);
        if (new URL(observation.url).origin !== origin) { observation.destination_origin = new URL(observation.url).origin; observation.url = target.href; }
        observations.push(observation);
      } catch { /* Unreadable pages do not establish functional controls. */ }
    }
    const candidates = suggestFlows(signals.url, { ...signals, observations, limit });
    for (const candidate of candidates) {
      if (!['access_entry', 'app_entry'].includes(candidate.control_kind)) continue;
      const label = candidate.observed_controls?.buttons?.[0];
      if (!label) continue;
      const probe = await probeEntryButton(browser, candidate.target_url, label, { validateUrl });
      candidate.entry_action = { role: 'button', name: label };
      candidate.observed_controls = { evidence: probe.steps.at(-1).detail, fields: probe.fields, buttons: [], stage: probe.opened ? 'entry_opened' : 'entry_inconclusive' };
      candidate.evidence = probe.steps.at(-1).detail;
      candidate.suggested_steps = ['Open the starting page', `Click "${label}"`, probe.fields.length ? `Check the ${probe.fields.length} observed input fields` : 'Check the expected next screen'];
      candidate.public_run = { scope: 'entry_navigation_only', steps: probe.steps, limitation: 'The observed entry button was clicked in a fresh browser session. No values were entered, forms submitted or account created. Mutating requests and WebSocket connections were blocked. This verifies entry navigation only, not successful authentication or gameplay.' };
    }
    return { ...signals, observations, candidates };
  } finally { await context.close(); }
}

// Public evidence performs only direct page navigation. It never submits a form or claims checkout success.
export async function recordPublicJourneys(browser, candidates, { validateUrl = assertPublic } = {}) {
  const cache = new Map();
  async function visit(url) {
    if (cache.has(url)) return cache.get(url);
    await validateUrl(new URL(url));
    const context = await browser.newContext({ viewport: { width: 1100, height: 720 } });
    const started = Date.now();
    let evidence;
    try {
      await context.route('**/*', async (route) => {
        if (route.request().isNavigationRequest() && route.request().frame() === route.request().frame().page().mainFrame()) {
          try { await validateUrl(new URL(route.request().url())); } catch { await route.abort(); return; }
        }
        await route.continue();
      });
      const page = await context.newPage();
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(1000);
      const signals = await inspectSignals(page);
      evidence = { controls: signals.controls, requested_url: url, url: page.url(), title: await page.title(), http_status: response?.status() ?? null,
        duration_ms: Date.now() - started, observed_at: new Date().toISOString(), action: 'direct_navigation',
        ...(response && response.status() >= 400 ? { screenshot: 'data:image/jpeg;base64,' + (await page.screenshot({ type: 'jpeg', quality: 48, timeout: 3000 })).toString('base64') } : {}),
        result: response && response.status() < 400 ? 'page_responded' : 'http_error' };
    } catch (error) {
      evidence = { requested_url: url, url, observed_at: new Date().toISOString(), action: 'direct_navigation', duration_ms: Date.now() - started, result: 'could_not_verify', error: error.message.slice(0, 250) };
    } finally { await context.close(); }
    cache.set(url, evidence);
    return evidence;
  }
  const results = [];
  const chosen = distinctFlows(candidates);
  const formCandidate = chosen.find(c => c.control_kind === 'access' && c.discovery_strength === 'control_observed') ?? chosen.find(c => c.control_kind === 'contact' && c.discovery_strength === 'control_observed');
  for (const candidate of chosen) {
    if (candidate.public_run?.scope === 'entry_navigation_only') { results.push(candidate); continue; }
    const steps = [await visit(candidate.entry_url)];
    if (candidate.target_url !== candidate.entry_url) steps.push(await visit(candidate.target_url));
    const destination = steps.at(-1);
    if (candidate.control_kind && candidate.control_kind !== 'navigation' && destination.result === 'page_responded') {
      const observed = destination.controls?.[candidate.control_kind];
      steps.push({ requested_url: candidate.target_url, url: destination.url, title: destination.title,
        observed_at: new Date().toISOString(), duration_ms: 0, action: 'inspect_controls',
        result: observed ? 'controls_observed' : 'control_not_observed',
        detail: observed?.evidence ?? 'The suggested interaction was not visible during this observation. Configure and review before execution.',
        fields: observed?.fields ?? [], buttons: observed?.buttons ?? [] });
    }
    if (candidate.control_kind === 'search') steps.push(...await probeSearch(browser, candidate.target_url, { validateUrl }));
    if (candidate === formCandidate) steps.push(await probeFormValidation(browser, candidate.target_url, candidate.control_kind, { validateUrl }));
    results.push({ ...candidate, public_run: { scope: candidate === formCandidate ? 'navigation_controls_and_form_validation' : candidate.control_kind ? 'navigation_and_control_inspection' : 'page_navigation_only', steps, limitation: 'Real browser page visits; screenshots are captured only on errors. The discovered link was not clicked; destination pages were opened directly. Visible controls are inspected; at most one suitable form gets a native browser validation check using empty fields and a malformed email, with outbound requests blocked during the probe. No submit button is clicked. Search candidates also attempt a product-derived query using GET search or predictive results; the recorded steps state whether matching results appeared. Login, cart actions, payments and fulfillment were not tested. This is not a verified end-to-end flow.' } });
  }
  return results;
}
