import { assertPublic } from './api.mjs';

// Search discovery uses a term from a real product link and permits read requests only.
export async function probeSearch(browser, url, { validateUrl = assertPublic } = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const steps = [];
  let query = '';
  const record = (page, action, result, detail) => steps.push({ action, result, detail, target_label: query, requested_url: url, url: page.url(), observed_at: new Date().toISOString(), duration_ms: 0 });
  try {
    await context.routeWebSocket('**/*', socket => socket.close());
    await context.route('**/*', async route => {
      const request = route.request();
      if (!['GET', 'HEAD'].includes(request.method())) return route.abort();
      try { await validateUrl(new URL(request.url())); } catch { return route.abort(); }
      return route.continue();
    });
    await validateUrl(new URL(url));
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1000);
    const seed = await page.evaluate(() => {
      const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
      const inputs = [...document.querySelectorAll('input')].filter(visible).filter(el => el.type === 'search' || /search|query|zoeken|caut/i.test([el.name, el.placeholder, el.getAttribute('aria-label')].join(' ')));
      if (inputs.length !== 1) return null;
      const product = [...document.querySelectorAll('a[href]')].find(a => visible(a) && /\/products?\//i.test(a.pathname) && a.origin === location.origin);
      if (!product) return null;
      const words = decodeURIComponent(product.pathname.split('/').filter(Boolean).at(-1)).split('-').filter(w => /^[a-z]{3,}$/i.test(w) && !/^(esim|product|travel|the|for)$/i.test(w));
      if (!words.length) return null;
      const input = inputs[0];
      input.setAttribute('data-fg-search-probe', 'true');
      return { query: words[0], source: product.href, label: input.getAttribute('aria-label') || input.placeholder || input.name };
    });
    if (!seed) { record(page, 'search_results', 'search_inconclusive', 'No unambiguous search field and product-derived query were available. No query was entered.'); return steps; }
    query = seed.query;
    const input = page.locator('[data-fg-search-probe=true]');
    await input.fill(query);
    record(page, 'fill_search', 'search_query_entered', `Entered "${query}" in "${seed.label}". Query derived from ${seed.source}.`);
    // Only submit an explicitly declared GET search form. Otherwise inspect predictive results.
    const getForm = await input.evaluate(el => !!el.form && el.form.method.toLowerCase() === 'get');
    if (getForm) {
      await input.press('Enter');
      record(page, 'submit_search', 'search_requested', `Pressed Enter in the GET search form for "${query}".`);
    }
    await page.waitForTimeout(2000);
    const results = await page.evaluate(({ query, getForm }) => {
      const roots = [...document.querySelectorAll('[role=listbox], [id*=predictive], [class*=search-results], [id*=search-results]')];
      if (getForm && /search/i.test(location.pathname)) roots.push(document.querySelector('main') ?? document.body);
      return [...new Set(roots.flatMap(root => [...root.querySelectorAll('a[href]')]).filter(a => a.getClientRects().length && getComputedStyle(a).visibility !== 'hidden' && /\/products?\//i.test(a.pathname) && a.textContent.toLowerCase().includes(query.toLowerCase())).map(a => `${a.textContent.trim().replace(/\s+/g, ' ').slice(0,160)} - ${a.href}`))].slice(0,5);
    }, { query, getForm });
    record(page, 'search_results', results.length ? 'search_results_observed' : 'search_inconclusive', results.length ? `Visible results for "${query}": ${results.join('; ')}` : `Entered "${query}", but matching results were not confirmed in an identifiable search-results region. This does not establish a broken search.`);
  } catch (error) {
    steps.push({ action: 'search_results', result: 'search_inconclusive', detail: error.message.slice(0,250), target_label: query, requested_url: url, url, observed_at: new Date().toISOString(), duration_ms: 0 });
  } finally { await context.close(); }
  return steps;
}
