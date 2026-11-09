// Text mistakes we can detect without AI or dictionaries: leftover placeholders, broken encoding,
// repeated words, old cedilla diacritics, missing spaces, duplicated paragraphs and near-identical pages.

const SKIP = 'nav, header, footer, aside, [role=navigation], [role=banner], [role=contentinfo], [aria-hidden=true], '
  + '.slick-cloned, .swiper-slide-duplicate, pre, code, kbd, samp, script, style, noscript, template, textarea, [contenteditable]';
const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, figcaption, dd, dt, summary, caption, label, button, div, section, article, main';

// Runs in the page: visible content text grouped by its nearest block element (menus, footers and code left out).
// Separate text nodes are joined with SEP, so words split across elements ("Alex</span><span>Alex") don't read as typos.
export function pageText(page) {
  return page.evaluate(({ skip, block, sep }) => {
    const groups = new Map();
    const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = n.parentElement;
      if (!parent || !n.nodeValue.trim() || parent.closest(skip)) continue;
      const el = parent.closest(block) ?? parent;
      groups.set(el, groups.has(el) ? groups.get(el) + sep + n.nodeValue : n.nodeValue);
    }
    const out = [];
    for (const [el, text] of groups) {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || s.visibility === 'hidden' || s.display === 'none') continue;
      // Code samples styled as plain divs (editors, demos)
      if (/mono|courier|consolas|menlo/i.test(s.fontFamily)) continue;
      const t = text.replace(/\s+/g, ' ').trim();
      if (t) out.push(t.slice(0, 2000));
      if (out.length >= 800) break;
    }
    return { lang: document.documentElement.lang || '', blocks: out };
  }, { skip: SKIP, block: BLOCK, sep: SEP }).catch(() => null);
}

const SEP = '\u2060';
const CODEISH = /\b(const|let|var|function|return|await|import|def|class)\b[^]*[;{}=]|=>/;

const PLACEHOLDERS = [
  [/lorem ipsum|dolor sit amet/i, 'text de umplutur\u0103 \u201eLorem ipsum\u201d', true],
  [/\[object Object\]/, '[object Object]', true],
  [/\{\{\s*[\w.]+\s*\}\}|\$\{\s*[\w.]+\s*\}|%%\w+%%/, 'variabil\u0103 ne\u00eenlocuit\u0103', true],
  [/\b(TODO|FIXME)\b/, 'not\u0103 de lucru (TODO)', true],
];
// Only in short labels/prices ("Pre\u021b: NaN lei"); in prose they're usually a programming tutorial talking about them
const MISSING_VALUE = /(^|[\s:=(])(undefined|NaN)(?=$|[\s.,;)!?]|\s*(lei|ron|eur|usd|\u20ac|\$|%))/;
const MOJIBAKE = /\u00c3[\u0080-\u00bf]|\u00c2[\u00a0-\u00bf]|\u00e2\u20ac|\u00c4[\u0080-\u00bf]|\u00c5[\u0080-\u00bf]|\u00c8[\u2122\u203a\u0161]|\ufffd/;
// Hyphen: "și și-a" is correct Romanian
const REPEATED = /(?<![\p{L}\p{N}])(\p{L}{2,})\s+\1(?![\p{L}\p{N}-])/iu;
// Doubled on purpose often enough to not be worth flagging
const REPEAT_OK = new Set(['that', 'had', 'bye', 'ha', 'he', 'hi', 'no', 'nu', 'da', 'la', 'na', 'so', 'very', 'mai', 'cha', 'tam', 'pe']);
const RO_CHARS = /[\u0103\u00e2\u00ee\u0219\u021b\u0102\u00c2\u00ce\u0218\u021a]/;
const CEDILLA = /[\u015f\u0163\u015e\u0162]/;
// Lowercase word before the mark: "Libera.Chat" or "JavaScript,TypeScript" are names, "navigarea.Mai" is a typo
const NO_SPACE = /(?<!\p{L})\p{Ll}{2,}[,;]\p{L}{2,}|(?<!\p{L})\p{Ll}{3,}[.!?]\p{Lu}\p{Ll}{2,}/u;
const LINKISH = /\S+@\S+|https?:\/\/\S+|www\.\S+|\S+\.(com|ro|net|org|io|de|eu)\b\S*/gi;

const snippet = (text, index, len = 70) => {
  const start = Math.max(0, index - 25);
  const s = `${start ? '\u2026' : ''}${text.slice(start, start + len).trim()}${start + len < text.length ? '\u2026' : ''}`;
  return s.replaceAll(SEP, '');
};
const first = (blocks, test) => {
  for (const b of blocks) {
    const m = test(b);
    if (m) return { block: b, m };
  }
  return null;
};

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function textFindings(text) {
  if (!text?.blocks.length) return null;
  const { lang } = text;
  const blocks = text.blocks.filter((b) => !CODEISH.test(b));
  if (!blocks.length) return null;
  const out = {};

  const placeholders = [];
  for (const [re, kind, severe] of PLACEHOLDERS) {
    const hit = first(blocks, (b) => b.match(re));
    if (hit) placeholders.push({ kind, severe, sample: snippet(hit.block, hit.m.index) });
  }
  const missing = first(blocks, (b) => b.length <= 60 && b.match(MISSING_VALUE));
  if (missing) placeholders.push({ kind: 'valoare lips\u0103 (undefined/NaN)', severe: false, sample: missing.block.replaceAll(SEP, '') });
  if (placeholders.length) out.placeholders = placeholders;

  const moji = first(blocks, (b) => b.match(MOJIBAKE));
  if (moji) out.mojibake = snippet(moji.block, moji.m.index);

  const rep = first(blocks, (b) => { const m = b.match(REPEATED); return m && !REPEAT_OK.has(m[1].toLowerCase()) ? m : null; });
  if (rep) out.repeated = snippet(rep.block, rep.m.index, 50);

  const all = blocks.join('\n').replaceAll(SEP, ' ');
  if (!/^tr\b/i.test(lang) && (/^ro\b/i.test(lang) || RO_CHARS.test(all))) {
    const ced = first(blocks, (b) => b.match(CEDILLA));
    if (ced) out.cedilla = snippet(ced.block, ced.m.index, 50);
  }

  const sp = first(blocks, (b) => b.replace(LINKISH, ' ').match(NO_SPACE));
  if (sp) out.spacing = snippet(sp.block.replace(LINKISH, ' '), sp.m.index, 50);

  // Long paragraphs only: a headline shown both as "featured" and in a list is intentional
  const seen = new Map();
  for (const b of blocks) {
    if (b.length < 150) continue;
    const k = b.replaceAll(SEP, '').toLowerCase();
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const dup = [...seen].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
  if (dup.length) out.dup_blocks = { count: dup.length, sample: `${dup[0][0].slice(0, 60)}\u2026 (\u00d7${dup[0][1]})` };

  const words = all.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  out.words = words.length;
  const shingles = new Set();
  for (let i = 0; i + 5 <= words.length && shingles.size < 3000; i++) shingles.add(hash(words.slice(i, i + 5).join(' ')));
  out.shingles = shingles;
  return out;
}

const MIN_WORDS_FOR_DUP = 150;
const DUP_SIMILARITY = 0.85;

function similarPages(pages) {
  const list = pages.filter((p) => p.text?.words >= MIN_WORDS_FOR_DUP);
  const pairs = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i].text.shingles;
      const b = list[j].text.shingles;
      let common = 0;
      for (const h of a) if (b.has(h)) common++;
      const sim = common / (a.size + b.size - common || 1);
      if (sim >= DUP_SIMILARITY && !samePage(list[i].url, list[j].url)) pairs.push([list[i], list[j], sim]);
    }
  }
  return pairs;
}

const path = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return url; } };
const samePage = (a, b) => path(a).replace(/\/$/, '') === path(b).replace(/\/$/, '');
const quote = (s) => `\u201e${s}\u201d`;

export function textChecks(check, withPages, pages) {
  const analysed = pages.filter((p) => p.text);
  const having = (key) => analysed.filter((p) => p.text[key]);
  const n = analysed.length;
  if (!n) return [];
  const scope = (list) => `${list.length} din ${n} ${n === 1 ? 'pagin\u0103' : 'pagini'}`;
  const out = [];

  const ph = having('placeholders');
  out.push(withPages(check('text', 'text_placeholder', 'F\u0103r\u0103 text de umplutur\u0103 sau variabile uitate',
    !ph.length ? null : ph.some((p) => p.text.placeholders.some((x) => x.severe)) ? 'medium' : 'low',
    ph.length ? `${scope(ph)}: ${ph[0].text.placeholders[0].kind} \u2014 ${quote(ph[0].text.placeholders[0].sample)}` : `${n} pagini verificate`),
  ph.map((p) => ({ url: p.url, note: p.text.placeholders.map((x) => `${x.kind}: ${quote(x.sample)}`).join(' \u00b7 ') }))));

  const simple = [
    ['mojibake', 'text_encoding', 'Caractere afi\u0219ate corect', 'medium', 'caractere stricate'],
    ['repeated', 'text_repeated', 'F\u0103r\u0103 cuvinte repetate', 'low', 'cuv\u00e2nt repetat'],
    ['cedilla', 'text_cedilla', 'Diacritice corecte (\u0219, \u021b)', 'low', '\u015f/\u0163 cu sedil\u0103'],
    ['spacing', 'text_spacing', 'Spa\u021biu dup\u0103 punctua\u021bie', 'low', 'lipse\u0219te spa\u021biul'],
  ];
  for (const [key, id, label, severity, what] of simple) {
    const list = having(key);
    out.push(withPages(check('text', id, label, list.length ? severity : null,
      list.length ? `${scope(list)}, ex. ${quote(list[0].text[key])}` : `${n} pagini verificate`),
    list.map((p) => ({ url: p.url, note: `${what}: ${quote(p.text[key])}` }))));
  }

  const dupBlocks = having('dup_blocks');
  out.push(withPages(check('text', 'text_dup_blocks', 'F\u0103r\u0103 paragrafe duplicate pe aceea\u0219i pagin\u0103',
    dupBlocks.length ? 'low' : null,
    dupBlocks.length ? `${scope(dupBlocks)}, ex. ${quote(dupBlocks[0].text.dup_blocks.sample)}` : `${n} pagini verificate`),
  dupBlocks.map((p) => ({ url: p.url, note: `${p.text.dup_blocks.count} paragrafe repetate, ex. ${quote(p.text.dup_blocks.sample)}` }))));

  const pairs = similarPages(analysed);
  out.push(withPages(check('text', 'text_dup_pages', 'Pagini cu con\u021binut propriu',
    pairs.length ? 'low' : null,
    pairs.length ? `${pairs.length} ${pairs.length === 1 ? 'pereche' : 'perechi'} de pagini aproape identice` : `${n} pagini comparate`),
  pairs.map(([a, b, sim]) => ({ url: a.url, note: `${Math.round(sim * 100)}% identic\u0103 cu ${path(b.url)}` }))));

  return out;
}
