export function toLocator(page, l) {
  switch (l.type) {
    case 'role': {
      // State filters (e.g. pressed: true) let a test check that a toggle/tab became active
      const opts = { ...(l.name && { name: l.name }), ...(l.exact && { exact: true }) };
      for (const k of ['pressed', 'selected', 'checked', 'expanded']) if (l[k] != null) opts[k] = l[k];
      return page.getByRole(l.role, Object.keys(opts).length ? opts : undefined);
    }
    case 'text': return page.getByText(l.value, { exact: Boolean(l.exact) });
    case 'label': return page.getByLabel(l.value, { exact: Boolean(l.exact) });
    case 'placeholder': return page.getByPlaceholder(l.value, { exact: Boolean(l.exact) });
    case 'testid': return page.getByTestId(l.value);
    case 'css': return page.locator(l.value);
    default: throw new Error(`Unknown locator type: ${l.type}`);
  }
}

// The primary locator gets the full timeout; fallbacks only a short check since the page is already loaded.
export async function resolve(page, locators, timeout) {
  for (let i = 0; i < locators.length; i++) {
    const loc = toLocator(page, locators[i]).first();
    try {
      await loc.waitFor({ state: 'visible', timeout: i === 0 ? timeout : 1000 });
      if (locators[i].strict && await toLocator(page, locators[i]).count() !== 1) return null;
      return { locator: loc, index: i };
    } catch {
      // try next fallback
    }
  }
  return null;
}

// Heuristic until AI diagnosis exists: look for a visible element with the same human-readable text.
export async function findSimilar(page, locators) {
  const texts = locators.map((l) => l.name ?? (l.type !== 'css' ? l.value : null)).filter(Boolean);
  for (const text of texts) {
    const candidates = [
      { type: 'role', role: 'button', name: text },
      { type: 'role', role: 'link', name: text },
      { type: 'text', value: text },
    ];
    for (const c of candidates) {
      if (await toLocator(page, c).first().isVisible().catch(() => false)) return c;
    }
  }
  return null;
}
