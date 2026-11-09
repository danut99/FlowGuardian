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
export function complianceChecks(check, { legal, requests, cookies, services, forms, sales }) {
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
  const linkNote = (l) => `Link g\u0103sit: \u201e${l.text || new URL(l.href).pathname}\u201d`;

  const privacy = find(links, PRIVACY);
  const cookiePolicy = find(links, COOKIE_POLICY);
  const terms = find(links, TERMS);
  const contact = find(links, CONTACT) ?? links.find((l) => /^(mailto|tel):/.test(l.href));
  const out = [
    check('compliance', 'privacy', 'Politic\u0103 de confiden\u021bialitate',
      privacy ? null : collectsData ? 'medium' : 'low',
      privacy ? linkNote(privacy) : `Nu am g\u0103sit un link spre ea${collectsData ? ', de\u0219i site-ul colecteaz\u0103 date (formulare sau tracking)' : ''}`),
    check('compliance', 'consent', 'Acord pentru cookie-uri de urm\u0103rire',
      !tracks ? null : banner ? null : 'medium',
      !tracks ? 'Nu am g\u0103sit cookie-uri de analytics sau marketing, deci nu e nevoie de banner'
        : banner ? `Exist\u0103 banner de consim\u021b\u0103m\u00e2nt${cmp ? ' (platform\u0103 de consim\u021b\u0103m\u00e2nt detectat\u0103)' : ''}`
          : `Folose\u0219te ${[...trackers, ...trackingCookies].slice(0, 3).join(', ')}, dar nu am g\u0103sit un banner care s\u0103 cear\u0103 acordul`),
  ];

  if (tracks && banner) {
    out.push(check('compliance', 'consent_reject', 'Refuzul e la fel de u\u0219or ca acceptul',
      hasReject ? null : hasSettings ? 'low' : cmp && !hasAccept ? 'unknown' : 'low',
      hasReject ? 'Bannerul are buton de refuz'
        : hasSettings ? 'Refuzul e ascuns \u00een set\u0103ri \u2014 trebuie s\u0103 fie un buton direct, ca \u201eAccept\u201d'
          : cmp && !hasAccept ? 'Nu am putut citi butoanele bannerului' : 'Bannerul are doar \u201eAccept\u201d, f\u0103r\u0103 op\u021biune de refuz'));
  }
  if (tracks) {
    out.push(check('compliance', 'tracking_before_consent', 'F\u0103r\u0103 urm\u0103rire \u00eenainte de acord',
      trackingCookies.length ? 'medium' : null,
      trackingCookies.length
        ? `La prima vizit\u0103, \u00eenainte de orice click, se seteaz\u0103 deja: ${trackingCookies.slice(0, 5).join(', ')}`
        : 'Niciun cookie de urm\u0103rire nu e setat \u00eenainte de acord'));
    out.push(check('compliance', 'cookie_policy', 'Politic\u0103 de cookie-uri',
      cookiePolicy || privacy ? null : 'low',
      cookiePolicy ? linkNote(cookiePolicy) : privacy ? 'Inclus\u0103 probabil \u00een politica de confiden\u021bialitate' : 'Nu am g\u0103sit link spre ea'));
  }
  out.push(
    check('compliance', 'terms', 'Termeni \u0219i condi\u021bii',
      terms ? null : sales ? 'medium' : 'low', terms ? linkNote(terms) : 'Nu am g\u0103sit un link spre ei'),
    check('compliance', 'contact', 'Date de contact / identificare',
      contact || legal?.email || legal?.phone ? null : 'low',
      contact ? linkNote(contact) : legal?.email || legal?.phone ? 'Email sau telefon afi\u0219at pe pagin\u0103' : 'Nu am g\u0103sit pagin\u0103 de contact, email sau telefon'),
  );
  if (sales === 'goods') {
    const returns = find(links, RETURNS);
    const shipping = find(links, SHIPPING);
    out.push(
      check('compliance', 'returns', 'Politic\u0103 de retur / rambursare',
        returns ? null : 'medium', returns ? linkNote(returns) : 'Nu am g\u0103sit un link spre ea \u2014 necesar\u0103 pentru c\u0103 site-ul vinde produse cu co\u0219 de cump\u0103r\u0103turi'),
      check('compliance', 'shipping', 'Informa\u021bii despre livrare',
        shipping ? null : 'low', shipping ? linkNote(shipping) : 'Nu am g\u0103sit un link spre ele \u2014 site-ul vinde produse fizice'),
    );
  } else if (sales === 'services') {
    const refund = find(links, RETURNS) ?? find(links, CANCEL);
    out.push(check('compliance', 'refund', 'Politic\u0103 de anulare / rambursare',
      refund ? null : 'low',
      refund ? linkNote(refund) : 'Nu am g\u0103sit un link spre ea \u2014 site-ul pare s\u0103 v\u00e2nd\u0103 abonamente sau servicii online (pre\u021buri / plat\u0103)'));
  }
  const a11y = find(links, A11Y);
  out.push(check('compliance', 'a11y_statement', 'Declara\u021bie de accesibilitate',
    a11y ? null : sales ? 'low' : 'hardening', a11y ? linkNote(a11y) : 'Nu am g\u0103sit un link spre ea'));
  return out;
}
