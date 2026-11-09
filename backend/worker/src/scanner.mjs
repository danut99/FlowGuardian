// Heuristic test discovery for one page: search, interactions (menus, dialogs), key content, form fill (no submit), navigation.
// AI-based proposals can replace the pick* functions later; output shape stays the same.
import { toLocator } from './locators.mjs';

const NAV_TIMEOUT = 30_000;
const MAX_NAV_TESTS = 2;
const MAX_INTERACTIONS = 3;
const MAX_INTERACTION_TRIES = 6;
const MAX_FORM_FIELDS = 4;
const CART = /add to (cart|bag)|in den warenkorb|adaug[ăa] [îi]n co[șs]|co[șs]/i;

export const RISKY = /log ?out|sign ?out|abmelden|deconect|delete|l[öo]schen|[șs]terge|remove|entfernen|buy|kaufen|cump[ăa]r|checkout|kasse|pl[ăa]te[șs]te|\bpay\b|bezahl|bestell|comand|subscribe|abonn|newsletter/i;
const CONSENT = /^(accept|accept all|accept all cookies|allow all|agree|i agree|alle akzeptieren|akzeptieren|alle zulassen|zustimmen|einverstanden|accept[ăa]|accept[ăa] tot|accept[ăa] toate|sunt de acord|got it)$/i;
// What a shop owner cares about first (docs: search, cart, contact form, products)
const PRIORITY = [/search|such|caut/i, /cart|basket|warenkorb|co[șs]/i, /contact|kontakt/i, /produ|shop|magazin|catalog|angebot|ofert/i];

function priority(text) {
  const i = PRIORITY.findIndex((re) => re.test(text));
  return i === -1 ? PRIORITY.length : i;
}

// Links to single listings (ids in path) change as content changes and would cause false alarms
const DYNAMIC_PATH = /\/[^/]*(\d{4,}|[0-9a-f]{8,}-[0-9a-f]{4,})[^/]*/i;

function sampleValue(type) {
  switch (type) {
    case 'email': return 'test@example.com';
    case 'tel': return '+40700000000';
    case 'number': return '1';
    case 'search': return 'test';
    default: return 'Test FlowGuardian';
  }
}

async function dismissConsent(page) {
  const btn = page.getByRole('button', { name: CONSENT }).first();
  if (!(await btn.isVisible({ timeout: 3000 }).catch(() => false))) return null;
  const name = (await btn.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  await btn.click().catch(() => {});
  await page.waitForTimeout(1000);
  return name ? { action: 'dismiss', locators: [{ type: 'role', role: 'button', name }] } : null;
}

function collect(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
    const cssFor = (el) => el.id ? `#${CSS.escape(el.id)}`
      : el.name ? `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]` : null;

    const clickables = [...document.querySelectorAll('a[href], button, [role="button"], input[type="submit"], input[type="button"]')]
      .filter(visible)
      .map((el) => ({
        role: el.tagName === 'A' ? 'link' : 'button',
        name: clean(el.getAttribute('aria-label') || el.innerText || el.value),
        href: el.tagName === 'A' ? el.href : null,
        testid: el.getAttribute('data-testid'),
        css: el.id ? `#${CSS.escape(el.id)}` : null,
        inForm: !!el.closest('form'),
        inNav: !!el.closest('nav, [role="navigation"], header'),
        controls: el.getAttribute('aria-controls'),
        popup: el.getAttribute('aria-haspopup'),
        expanded: el.getAttribute('aria-expanded'),
      }));

    const isSearch = (el) => el.type === 'search' || el.getAttribute('role') === 'searchbox' || el.name === 'q' || el.name === 's'
      || /search|such|caut/i.test(`${el.name} ${el.id} ${el.placeholder} ${el.getAttribute('aria-label') ?? ''}`);

    const fieldSel = 'input:not([type]), input[type=text], input[type=email], input[type=search], input[type=tel], input[type=number], textarea';
    const field = (el) => ({
      type: /numeric|decimal/.test(el.inputMode) ? 'number' : el.type || 'text',
      label: clean(el.labels?.[0]?.innerText),
      aria: clean(el.getAttribute('aria-label')),
      placeholder: clean(el.placeholder),
      css: cssFor(el),
      search: isSearch(el),
    });
    const groups = [...document.querySelectorAll('form')]
      .filter((f) => !f.querySelector('input[type=password]'))
      .map((f) => [...f.querySelectorAll(fieldSel)].filter((el) => visible(el) && !el.readOnly && !el.disabled).map(field));
    // SPAs often have inputs without a <form>
    groups.push([...document.querySelectorAll(fieldSel)]
      .filter((el) => !el.closest('form') && visible(el) && !el.readOnly && !el.disabled).map(field));

    const fields = groups.flat().concat([...document.querySelectorAll(fieldSel)].filter((el) => !el.closest('form') && visible(el)).map(field));
    const h1 = [...document.querySelectorAll('h1')].find(visible);
    return {
      clickables,
      forms: groups.filter((g) => g.length),
      search: fields.find((f) => f.search) ?? null,
      landmarks: { h1: h1 ? clean(h1.innerText).slice(0, 80) : null },
    };
  });
}

async function pickNavigation(page, clickables, site, pageUrl, prefix) {
  const here = new URL(pageUrl);
  const seen = new Set();
  const candidates = clickables
    .filter((c) => c.role === 'link' && c.name.length >= 2 && c.name.length <= 40 && !RISKY.test(c.name))
    .filter((c) => {
      try {
        const u = new URL(c.href);
        return /^https?:$/.test(u.protocol) && u.host === site.host && u.pathname !== here.pathname
          && !DYNAMIC_PATH.test(u.pathname);
      } catch {
        return false;
      }
    })
    .filter((c) => !seen.has(c.name.toLowerCase()) && seen.add(c.name.toLowerCase()))
    // Main menu links first, then what shop owners care about
    .sort((a, b) => Number(b.inNav) - Number(a.inNav) || priority(`${a.name} ${a.href}`) - priority(`${b.name} ${b.href}`));

  const tests = [];
  let tries = 0;
  for (const c of candidates) {
    if (tests.length >= MAX_NAV_TESTS || tries >= MAX_INTERACTION_TRIES) break;
    const link = page.getByRole('link', { name: c.name }).first();
    if (!(await link.isVisible().catch(() => false))) continue;
    tries++;
    // Follow the link for real: redirects change the final path, overlays can block the click
    const clicked = await link.click({ timeout: 4000 }).then(() => true, () => false);
    if (clicked) await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
    const landed = new URL(page.url());
    await load(page, pageUrl);
    if (!clicked || landed.host !== site.host || landed.pathname === here.pathname || DYNAMIC_PATH.test(landed.pathname)) continue;

    const locators = [{ type: 'role', role: 'link', name: c.name }];
    if (c.testid) locators.push({ type: 'testid', value: c.testid });
    if (c.css) locators.push({ type: 'css', value: c.css });
    tests.push({
      kind: 'click',
      name: `Link-ul „${c.name}” duce la ${landed.pathname}`,
      steps: [...prefix, { action: 'click', locators }, { action: 'expect_url', value: landed.pathname }],
    });
  }
  return tests;
}

function fieldLocators(f) {
  const role = f.type === 'search' ? 'searchbox' : 'textbox';
  return [
    f.label && { type: 'label', value: f.label },
    f.aria && { type: 'role', role, name: f.aria },
    f.placeholder && { type: 'placeholder', value: f.placeholder },
    f.css && { type: 'css', value: f.css },
  ].filter(Boolean);
}

// Custom widgets can look like inputs but reject typing; returns locators with the working one first
async function fillable(page, locators, value) {
  for (let i = 0; i < locators.length; i++) {
    const ok = await toLocator(page, locators[i]).first().fill(value, { timeout: 2000 }).then(() => true, () => false);
    if (ok) return [locators[i], ...locators.filter((_, j) => j !== i)];
  }
  return null;
}

async function pickForm(page, forms, prefix) {
  const scored = forms
    .filter((fields) => !fields.some((f) => f.search))
    .map((fields) => ({ fields, score: Math.min(...fields.map((f) => priority(`${f.label} ${f.aria} ${f.placeholder}`))) }))
    .sort((a, b) => a.score - b.score || b.fields.length - a.fields.length);
  const best = scored[0];
  if (!best) return null;

  const steps = [];
  for (const f of best.fields.slice(0, MAX_FORM_FIELDS)) {
    const value = sampleValue(f.type);
    const locators = await fillable(page, fieldLocators(f), value);
    if (locators) steps.push({ action: 'fill', locators, value });
  }
  if (!steps.length) return null;
  const isContact = priority(best.fields.map((f) => `${f.label} ${f.placeholder}`).join(' ')) === 2;
  return {
    kind: 'form',
    name: `${isContact ? 'Formularul de contact' : 'Formularul'} se poate completa (${steps.length === 1 ? '1 câmp' : `${steps.length} câmpuri`}, fără trimitere)`,
    steps: [...prefix, ...steps],
  };
}

export async function load(page, url) {
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  const status = res?.status() ?? 0;
  if (status === 403 || status === 429) throw new Error(`Accesul a fost blocat (HTTP ${status}).`);
  if (status >= 400) throw new Error(`Pagina a răspuns cu HTTP ${status}.`);
  await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return dismissConsent(page);
}

// Search is safe to submit (GET); we only propose it when it visibly leads somewhere
async function pickSearch(page, pageUrl, field, prefix) {
  if (!field) return null;
  const locators = await fillable(page, fieldLocators({ ...field, type: 'search' }), 'test');
  if (!locators) return null;
  const before = page.url();
  await toLocator(page, locators[0]).first().press('Enter').catch(() => {});
  await page.waitForLoadState('load', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const after = new URL(page.url());
  await load(page, pageUrl);
  if (after.href === before) return null;
  const param = [...after.searchParams].find(([, v]) => /test/i.test(v));
  const expect = param ? `${param[0]}=` : after.pathname;
  return {
    kind: 'search',
    name: 'Căutarea funcționează (deschide rezultatele)',
    steps: [...prefix, { action: 'fill', locators, value: 'test' }, { action: 'press', locators: [locators[0]], value: 'Enter' }, { action: 'expect_url', value: expect }],
  };
}

// Click each candidate on a fresh page and keep only those with a visible, checkable effect
async function pickInteractions(page, clickables, site, pageUrl, prefix) {
  const seen = new Set();
  const candidates = clickables
    .filter((c) => c.role === 'button' && c.name.length >= 2 && c.name.length <= 40 && !c.inForm
      && !RISKY.test(c.name) && !CONSENT.test(c.name))
    .filter((c) => !seen.has(c.name.toLowerCase()) && seen.add(c.name.toLowerCase()))
    .sort((a, b) => Number(!!(b.controls || b.popup || b.expanded)) - Number(!!(a.controls || a.popup || a.expanded))
      || Number(CART.test(b.name)) - Number(CART.test(a.name)))
    .slice(0, MAX_INTERACTION_TRIES);

  const tests = [];
  for (const c of candidates) {
    if (tests.length >= MAX_INTERACTIONS) break;
    const btn = page.getByRole('button', { name: c.name }).first();
    if (!(await btn.isVisible().catch(() => false))) continue;
    const dialogs = () => page.locator('[role="dialog"]:visible, dialog[open]').count().catch(() => 0);
    const target = c.controls ? page.locator(`#${c.controls.replace(/([^\w-])/g, '\\$1')}`).first() : null;
    const before = { url: page.url(), dialogs: await dialogs(), shown: target ? await target.isVisible().catch(() => false) : false };

    const clicked = await btn.click({ timeout: 3000 }).then(() => true, () => false);
    await page.waitForTimeout(1200);
    const after = { url: page.url(), dialogs: await dialogs(), shown: target ? await target.isVisible().catch(() => false) : false };

    const locators = [{ type: 'role', role: 'button', name: c.name }];
    if (c.testid) locators.push({ type: 'testid', value: c.testid });
    if (c.css) locators.push({ type: 'css', value: c.css });
    const click = { action: 'click', locators };

    if (clicked && after.url !== before.url) {
      const u = new URL(after.url);
      if (u.host === site.host && !DYNAMIC_PATH.test(u.pathname)) {
        tests.push({ kind: 'interaction', name: `Butonul „${c.name}” duce la ${u.pathname}`, steps: [...prefix, click, { action: 'expect_url', value: u.pathname }] });
      }
    } else if (clicked && target && !before.shown && after.shown) {
      tests.push({
        kind: 'interaction', name: `Butonul „${c.name}” deschide ${c.popup === 'menu' || /men/i.test(c.name) ? 'meniul' : 'secțiunea'}`,
        steps: [...prefix, click, { action: 'expect_visible', locators: [{ type: 'css', value: `#${c.controls}` }] }],
      });
    } else if (clicked && after.dialogs > before.dialogs) {
      tests.push({
        kind: 'interaction', name: `Butonul „${c.name}” deschide o fereastră`,
        steps: [...prefix, click, { action: 'expect_visible', locators: [{ type: 'role', role: 'dialog' }] }],
      });
    }
    // Every trial may have changed the page; start the next one clean
    if (clicked) await load(page, pageUrl);
  }
  return tests;
}

async function pickContent(page, landmarks, pageLabel, prefix) {
  const candidates = [
    landmarks.h1 && { type: 'role', role: 'heading', name: landmarks.h1 },
    { type: 'role', role: 'navigation' },
    { type: 'role', role: 'contentinfo' },
  ].filter(Boolean);
  const steps = [];
  for (const l of candidates) {
    if (await toLocator(page, l).first().isVisible().catch(() => false)) steps.push({ action: 'expect_visible', locators: [l] });
  }
  if (steps.length < 2) return null;
  return { kind: 'content', name: `Elementele principale apar pe ${pageLabel} (titlu, meniu, subsol)`, steps: [...prefix, ...steps] };
}

// Propose tests for one page of the site. Order = most valuable first.
export async function scanPage(page, siteUrl, pageUrl = siteUrl) {
  const site = new URL(siteUrl);
  const here = new URL(pageUrl);
  if (here.host !== site.host) throw new Error('Pagina nu aparține site-ului.');
  const consent = await load(page, here.href);
  const gotoStep = { action: 'goto', ...(here.href !== site.href ? { value: here.href } : {}) };
  const prefix = [gotoStep, ...(consent ? [consent] : [])];
  const pageLabel = here.href === site.href || here.pathname === '/' ? 'pagina principală' : here.pathname;

  const { clickables, forms, search, landmarks } = await collect(page);
  const tests = [];
  const searchTest = await pickSearch(page, here.href, search, prefix);
  if (searchTest) tests.push(searchTest);
  tests.push(...await pickInteractions(page, clickables, site, here.href, prefix));
  const content = await pickContent(page, landmarks, pageLabel, prefix);
  if (content) tests.push(content);
  const form = await pickForm(page, forms, prefix);
  if (form) tests.push(form);
  tests.push(...await pickNavigation(page, clickables, site, here.href, prefix));
  return tests;
}
