// Evidence describes observations, never inferred business impact or legal conclusions.
const HEADERS = {
  nosniff: 'X-Content-Type-Options', hsts: 'Strict-Transport-Security', csp: 'Content-Security-Policy',
  frame: 'X-Frame-Options or Content-Security-Policy frame-ancestors', index: 'X-Robots-Tag and meta[name="robots"]',
};
const ELEMENTS = {
  title: 'title', description: 'meta[name="description"]', viewport: 'meta[name="viewport"]',
  h1: 'h1', lang: 'html[lang]', canonical: 'link[rel="canonical"]', alt: 'img:not([alt])',
  og: 'meta[property="og:title"], meta[property="og:image"]', jsonld: 'script[type="application/ld+json"]',
  schema_core: 'script[type="application/ld+json"]: Organization and WebSite types',
};
const FILES = { robots: '/robots.txt', sitemap: '/sitemap.xml', llms_txt: '/llms.txt' };
const POLICY = { privacy: 'privacy policy', terms: 'terms and conditions', contact: 'contact/company details', returns: 'returns/refund policy', shipping: 'shipping policy', refund: 'refund/cancellation policy', a11y_statement: 'accessibility statement', cookie_policy: 'cookie policy' };
const REVIEW = new Set(['title', 'schema_core', 'llms_txt', 'sitemap', 'robots', 'index', 'canonical', 'jsonld', 'h1', 'description', 'og']);

export function attachEvidence(c, { url, home = {}, network = [], resources = [], observedAt = new Date().toISOString() }) {
  const affected = c.pages?.length ? c.pages : [{ url, note: c.detail }];
  const target = HEADERS[c.id] ?? ELEMENTS[c.id] ?? FILES[c.id] ?? POLICY[c.id];
  let reproduce, expected, fix, limitation;
  if (HEADERS[c.id]) {
    reproduce = `Open DevTools > Network, reload the affected URL, select the main document and inspect Response Headers: ${HEADERS[c.id]}.`;
    expected = c.id === 'nosniff' ? 'X-Content-Type-Options: nosniff' : `Review the ${HEADERS[c.id]} configuration for this page.`;
    fix = c.id === 'nosniff' ? 'Configure X-Content-Type-Options: nosniff at the server/CDN if your host supports custom response headers.' : 'Review the named header with the site maintainer; configure and test the policy at the server/CDN.';
    limitation = 'A missing header is a configuration recommendation, not proof of an exploitable vulnerability. Hosting capabilities and intended behavior matter.';
  } else if (ELEMENTS[c.id]) {
    reproduce = `Open DevTools > Elements and search for ${ELEMENTS[c.id]}. Compare the rendered value with the observation below. For JSON-LD, inspect the parsed @type values, including @graph.`;
    expected = `Review ${ELEMENTS[c.id]} for the intended page content.`;
    fix = 'Update the named element in the page template where appropriate, then rerun the check.';
    limitation = 'Presence or absence is observed; SEO impact and the correct content require human review. Missing alt attributes do not prove the image needs descriptive text.';
  } else if (FILES[c.id]) {
    reproduce = `Open ${new URL(FILES[c.id], url).href}. Inspect the HTTP status, content type and body; an HTML fallback is not the requested file. For sitemaps, also inspect Sitemap directives in robots.txt.`;
    expected = `A valid ${FILES[c.id]} file if required by your publishing strategy.`;
    fix = 'Publish or correct the file only if appropriate for this site. A sitemap may use a different URL.';
    limitation = 'These files can be optional. Missing files do not establish a broken site, SEO penalty, or inability of AI tools to read the site.';
  } else if (c.group === 'compliance') {
    reproduce = POLICY[c.id] ? `Open a fresh browser profile, visit the affected page and search the header/footer, menus and dialogs for ${POLICY[c.id]}. Follow the link and check its actual content.` : 'Open a fresh browser profile with no stored consent. Open DevTools > Network and Application > Cookies before navigation. Visit the URL without clicking the banner; compare cookie names and consent controls with the observation. Repeat after rejecting, and separately after accepting.';
    expected = 'A human review of the applicable policy, cookie purposes and consent behavior.';
    fix = 'Review the evidence with the site owner and appropriate privacy adviser; adjust the policy or consent configuration only after confirming the requirement.';
    limitation = 'Heuristic review prompt, not legal advice or a compliance certification. Geographic rules, late banners, shadow DOM and iframes can change results. Script requests and cookie names alone do not establish unlawful tracking.';
  } else if (c.group === 'performance' || c.group === 'network') {
    reproduce = c.group === 'network' ? 'Use a fresh 390x844 mobile browser context with 4x CPU slowdown. Slow 4G: 150 ms latency, 1.6 Mbps down/750 Kbps up; 3G: 300 ms, 750/250 Kbps. Repeat three cold visits sequentially and compare the median. Inspect Performance > Timings for LCP and Layout Shifts.' : 'Use a fresh desktop browser context, open DevTools > Performance and Network, record a navigation and inspect the named timing, layout-shift entries or transferred bytes. Compare the observation, not a Lighthouse score.';
    expected = 'Compare the named metric with the threshold stated in the finding.';
    fix = 'Profile the recorded navigation before changing code. Inspect LCP resources, server response and rendering work; rerun under the same conditions.';
    limitation = 'Lab observation from the worker, not real-user CrUX data. Hardware, location and network vary. LCP element identification does not establish the cause of a delay. No INP or TBT is measured.';
  } else if (c.group === 'availability') {
    reproduce = c.id === 'cert' ? 'Open the affected HTTPS URL, inspect the browser certificate viewer and compare the certificate expiration date with the recorded days remaining.' : c.id === 'redirect' ? 'Open DevTools > Network with Preserve log. Navigate to the http:// version of the affected URL and inspect each redirect and the final scheme.' : 'Open DevTools > Network, reload each affected URL and inspect the main document HTTP status and any browser connection error.';
    expected = 'A reachable page with the intended response, valid TLS certificate and secure navigation.';
    fix = 'Correct the observed hosting, certificate or redirect configuration after reproducing the failure.';
    limitation = 'An observed response describes this visit only. Access controls, intended error pages and temporary failures can change its meaning.';
  } else if (['links', 'images', 'mixed', 'js'].includes(c.id)) {
    reproduce = c.id === 'js' ? 'Open DevTools > Console, enable Preserve log, reload the affected page and locate the exact error message below.' : 'Open DevTools > Network, enable Preserve log, reload the affected page and locate the resource URLs below. Inspect status, redirects and the initiating element. For links, follow the link manually in a fresh session.';
    expected = c.id === 'mixed' ? 'Resources use HTTPS on an HTTPS page.' : 'Resources respond as intended; inspect whether the observed error affects the user flow.';
    fix = 'Correct the listed URL or underlying resource/error after reproducing it. Check access controls before treating an automated request failure as a broken resource.';
    limitation = 'A failed automated request or console error does not establish a broken user flow. Authentication, anti-bot rules and temporary responses require review.';
  } else {
    reproduce = `Open each affected URL and compare the recorded observation for "${c.label}" with the page, response or text sample. Exact element attribution is unavailable for this check; confirm manually before acting.`;
    expected = 'Manually confirm the recorded observation and whether it is intentional.';
    fix = 'Confirm the observation first; change only the affected configuration or content and rerun.';
    limitation = 'This check lacks complete element-level attribution and requires review; it does not establish user impact. Passive scans do not submit forms, confirm inbox delivery or compare Google business profiles.';
  }
  const uncertain = c.group === 'compliance' || c.group === 'text' || REVIEW.has(c.id) || ['links', 'images', 'js'].includes(c.id) || !target && !['performance', 'network', 'availability'].includes(c.group);
  const next = { ...c };
  if (next.status !== 'pass' && uncertain && next.severity !== 'hardening') {
    next.verdict = 'needs_validation'; next.status = 'warn'; delete next.severity;
  }
  next.evidence = { url: affected[0].url, observed_at: observedAt, observation: c.detail, target: target ?? c.label,
    reproduce, expected, fix, limitation, affected, resources: resources.slice(0, 20).map((r) => typeof r === 'string' ? { message: r } : r) };
  return next;
}
