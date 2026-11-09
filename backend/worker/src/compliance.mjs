// Legal basics most data-protection and consumer laws share (GDPR/UK GDPR, CCPA, LGPD, PIPEDA, EU consumer rules, ADA/EAA).
// Language-agnostic: link text/URL patterns in EN, DE, FR, ES, IT, PT, NL, PL, RO. Reported as "seems missing", never as legal advice.

const PRIVACY = /privacy|privac|datenschutz|confidentialit|privacidad|riservatezza|privacidade|privacybeleid|prywatno|gdpr|rgpd|dsgvo|datos personales|dati personali|donn[ée]es personnelles|personal data|protec[țt]ia datelor/i;
const COOKIE_POLICY = /cookie/i;
const TERMS = /\bterms\b|\bconditions\b|\bagb\b|nutzungsbedingungen|rechtliche hinweise|legal disclaimer|\bcgv\b|\bcgu\b|t[ée]rminos|condiciones|termini e condizioni|condizioni|\btermos\b|voorwaarden|regulamin|termeni|\btos\b/i;
const CONTACT = /contact|kontakt|contacto|contatti|contato|impressum|imprint|legal notice|mentions l[ée]gales|aviso legal|note legali/i;
const RETURNS = /\breturns?\b|refund|\bretur\b|retururi|r[üu]ckgabe|widerruf|\bretours\b|r[ée]tractation|rembours|devoluci|reembolso|\breso\b|rimborso|zwrot|odst[aą]pien/i;
const CANCEL = /cancel|anul|k[üu]ndig|r[ée]siliation|cancelaci|disdett|rezygnac|opzeggen/i;
const SHIPPING = /shipping|delivery|livrare|versand|lieferung|livraison|env[ií]o|spedizion|entrega|verzending|bezorg|dostaw/i;
const A11Y = /accessib|accesibil|barrierefrei|toegankelijk|dost[eę]pno/i;

const ACCEPT = /accept|agree|allow|got it|akzeptier|zustimm|einverstanden|zulassen|accepter|j'accepte|acept|accett|aceit|akceptuj|zgadzam|de acord|ok\b/i;
const REJECT = /reject|decline|deny|refuse|ablehnen|nur (notwendige|essenzielle)|refuser|rechaz|rifiut|recus|weiger|odrzu|refuz|respin|necessary only|only necessary|essential only|only essential|continue without/i;
const SETTINGS = /settings|preferences|customi[sz]e|manage|einstellungen|anpassen|param[eè]tres|personnaliser|configur|personaliz|impostazioni|instellingen|ustawienia|set[ăa]ri|preferin/i;
// Consent platforms often render in shadow DOM/iframes we can't read; their scripts still show up in the network
const CMP = /onetrust|cookielaw|cookiebot|usercentrics|cookieyes|didomi|iubenda|quantcast|trustarc|termly|osano|complianz|cookiehub|consentmanager|axeptio|klaro|borlabs|cookie-script|cookiefirst|sourcepoint|privacy-mgmt/i;
const TRACKING_COOKIE = /^(_ga|_gid|_gat|_gcl_|_fbp|_fbc|_tt_|_ttp|_hj|_clck|_clsk|_uet|_pin_|_scid|_rdt_|IDE$|NID$|MUID$|li_|bcookie|hubspotutk|__hs|_hp2|ajs_|mp_|amplitude)/i;

// Legal links have short labels; long texts are article headlines that happen to contain a keyword
const find = (links, re) => links.find((l) => (l.text.length <= 50 && re.test(l.text)) || re.test(new URL(l.href, 'https://x').pathname));

// sales: 'goods' (cart, physical products) | 'services' (subscriptions/payments, no cart) | null (doesn't sell online)
export function complianceChecks(check, { legal, requests, cookies, services, forms, sales, observation_ms = 0 }) {
  // Some sites open legal pages from buttons/modals instead of links
  const links = [...(legal?.links ?? []), ...(legal?.buttons ?? []).map((text) => ({ text, href: 'https://x/' }))];
  const buttons = legal?.buttons ?? [];
  const trackers = services.filter((s) => s.category === 'Analytics' || s.category === 'Marketing').map((s) => s.name);
  const trackingCookies = [...new Set(cookies.filter((c) => TRACKING_COOKIE.test(c.name)).map((c) => c.name))];
  const tracks = trackers.length > 0 || trackingCookies.length > 0;
  const cmp = requests.some((r) => CMP.test(r.url));
  const hasAccept = buttons.some((b) => ACCEPT.test(b));
  const hasReject = buttons.some((b) => REJECT.test(b));
  const hasSettings = buttons.some((b) => SETTINGS.test(b));
  const banner = cmp || (hasAccept && (hasReject || hasSettings || buttons.some((b) => /cookie/i.test(b))));
  const collectsData = tracks || forms.length > 0;
  const linkNote = (l) => `Link found: “${l.text || new URL(l.href).pathname}”`;

  const privacy = find(links, PRIVACY);
  const cookiePolicy = find(links, COOKIE_POLICY);
  const terms = find(links, TERMS);
  const contact = find(links, CONTACT) ?? links.find((l) => /^(mailto|tel):/.test(l.href));
  const out = [
    check('compliance', 'privacy', 'Privacy policy',
      privacy ? null : collectsData ? 'medium' : 'low',
      privacy ? linkNote(privacy) : `No link to it found${collectsData ? ', even though the site collects data (forms or tracking)' : ''}`),
    check('compliance', 'consent', 'Consent for tracking cookies',
      !tracks ? null : banner ? null : 'medium',
      !tracks ? 'No known tracking signals observed; consent requirements were not established'
        : banner ? `There is a consent banner${cmp ? ' (consent platform detected)' : ''}`
          : `Uses ${[...trackers, ...trackingCookies].slice(0, 3).join(', ')}, but no banner asking for consent was found`),
  ];

  if (tracks && banner) {
    out.push(check('compliance', 'consent_reject', 'Rejecting is as easy as accepting',
      hasReject ? null : hasSettings ? 'low' : cmp && !hasAccept ? 'unknown' : 'low',
      hasReject ? 'The banner has a reject button'
        : hasSettings ? 'Rejecting is hidden in settings — it should be a direct button, like “Accept”'
          : cmp && !hasAccept ? 'Could not read the banner buttons' : 'The banner only has “Accept”, with no option to reject'));
  }
  if (tracks) {
    out.push(check('compliance', 'tracking_before_consent', 'No tracking before consent',
      'unknown',
      trackingCookies.length
        ? `Before any click, known tracking cookie names were observed (review purpose and configuration): ${trackingCookies.slice(0, 5).join(', ')}`
        : 'No known tracking cookies observed in this visit. Cookieless requests and delayed scripts still need review.'));
    out.push(check('compliance', 'cookie_policy', 'Cookie policy',
      cookiePolicy || privacy ? null : 'low',
      cookiePolicy ? linkNote(cookiePolicy) : privacy ? 'Probably included in the privacy policy' : 'No link to it found'));
  }
  out.push(
    check('compliance', 'terms', 'Terms and conditions',
      terms ? null : sales ? 'medium' : 'low', terms ? linkNote(terms) : 'No link to them found'),
    check('compliance', 'contact', 'Contact / company details',
      contact || legal?.email || legal?.phone ? null : 'low',
      contact ? linkNote(contact) : legal?.email || legal?.phone ? 'Email or phone shown on the page' : 'No contact page, email or phone found'),
  );
  if (sales === 'goods') {
    const returns = find(links, RETURNS);
    const shipping = find(links, SHIPPING);
    out.push(
      check('compliance', 'returns', 'Returns / refund policy',
        returns ? null : 'medium', returns ? linkNote(returns) : 'No link to it found — required because the site sells products with a shopping cart'),
      check('compliance', 'shipping', 'Shipping information',
        shipping ? null : 'low', shipping ? linkNote(shipping) : 'No link to it found — the site sells physical products'),
    );
  } else if (sales === 'services') {
    const refund = find(links, RETURNS) ?? find(links, CANCEL);
    out.push(check('compliance', 'refund', 'Cancellation / refund policy',
      refund ? null : 'low',
      refund ? linkNote(refund) : 'No link to it found — the site seems to sell subscriptions or online services (pricing / payments)'));
  }
  const a11y = find(links, A11Y);
  out.push(check('compliance', 'a11y_statement', 'Accessibility statement',
    a11y ? null : sales ? 'low' : 'hardening', a11y ? linkNote(a11y) : 'No link to it found'));
  return out.map((c) => c.status === 'pass' ? c : { ...c, verdict: 'needs_validation', status: 'warn', severity: undefined });
}
