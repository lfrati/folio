// A small BibTeX reader and the References section. It takes what exports contain (arXiv, Crossref,
// Zotero): nested braces, quotes, one-line entries. `@string` and `#` warn; write the value out.

import { esc } from './render.mjs';

const WORD = /[^\s,=#{}()"]+/y;
const MONTH = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$/i;

/** Parse BibTeX into a Map of key -> { entrytype, citekey, label, ...fields }. Field names are
 *  lower-cased and values kept as TeX. Problems are warned about, and reading goes on at the next entry. */
export function parseBib(text, warn) {
  const entries = new Map();
  const lineAt = i => text.slice(0, i).split('\n').length;
  let pos = 0;

  const skipSpace = () => { while (pos < text.length && /\s/.test(text[pos])) pos++; };
  const word = () => {
    WORD.lastIndex = pos;
    const m = WORD.exec(text);
    if (m) pos = WORD.lastIndex;
    return m?.[0];
  };

  // BibTeX balances braces without regard to backslashes, so anything it accepts reads the same here.
  function delimited() {
    const start = pos, close = text[pos] === '"' ? '"' : '}';
    let depth = 0;
    for (pos++; pos < text.length; pos++) {
      if (text[pos] === close && depth <= 0) return text.slice(start + 1, pos++);
      if (text[pos] === '{') depth++;
      else if (text[pos] === '}') depth--;
    }
    throw new Error(`unclosed ${text[start]} at line ${lineAt(start)}`);
  }

  function value() {
    skipSpace();
    if (text[pos] === '{' || text[pos] === '"') return delimited();
    const at = pos, w = word();
    if (!w) throw new Error(`expected a value at line ${lineAt(at)}`);
    if (!/^\d+$/.test(w) && !MONTH.test(w)) warn(`bib: @string ${w} at line ${lineAt(at)} is not supported; write the value out`);
    return w;
  }

  while ((pos = text.indexOf('@', pos)) >= 0) {
    const start = pos++;
    skipSpace();
    const type = word()?.toLowerCase();
    skipSpace();
    if (!type || text[pos] !== '{') continue; // BibTeX ignores text outside entries, like me@example.org
    try {
      if (type === 'comment' || type === 'preamble' || type === 'string') {
        delimited();
        if (type === 'string') warn(`bib: @string at line ${lineAt(start)} is not supported; write the value where it is used`);
        continue;
      }
      pos++;
      skipSpace();
      const key = word();
      if (!key) throw new Error(`entry without a key at line ${lineAt(start)}`);
      const entry = { entrytype: type, citekey: key };
      if (entries.has(key)) warn(`bib: duplicate key ${key} at line ${lineAt(start)}, keeping the first`);
      else entries.set(key, entry);
      for (;;) {
        skipSpace();
        if (pos >= text.length) throw new Error(`entry ${key} opened at line ${lineAt(start)} is not closed`);
        if (text[pos] === '}') { pos++; break; }
        if (text[pos] === ',') { pos++; continue; }
        const at = pos, name = word()?.toLowerCase();
        skipSpace();
        if (!name || text[pos] !== '=') throw new Error(`entry ${key}: expected field = value at line ${lineAt(at)}`);
        pos++;
        entry[name] = value();
      }
    } catch (e) {
      warn(`bib: ${e.message}`);
      const next = text.indexOf('\n@', start);
      pos = next < 0 ? text.length : next + 1;
    }
  }

  // Labels: [Knu74], with a suffix on later entries of the file that would share one.
  const seen = new Map();
  for (const entry of entries.values()) {
    const label = bibLabel(entry), n = seen.get(label) ?? 0;
    seen.set(label, n + 1);
    entry.label = n ? `${label}${(n + 10).toString(36)}` : label;
  }
  return entries;
}

// ---------------------------------------------------------------------------
// TeX in field values

const NAMED = { ss: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', aa: 'å', AA: 'Å', o: 'ø', O: 'Ø', l: 'ł', L: 'Ł', i: 'ı', j: 'ȷ' };
const SYMBOL_ACCENTS = { '`': 0x300, "'": 0x301, '^': 0x302, '~': 0x303, '=': 0x304, '.': 0x307, '"': 0x308 }; // combining marks
const LETTER_ACCENTS = { u: 0x306, v: 0x30C, H: 0x30B, c: 0x327, d: 0x323, b: 0x331, r: 0x30A, k: 0x328 };
const HTTP = String.raw`https?:\/\/[^\s{}]*[^\s{}.,;:]`;
const VERBATIM = new RegExp(String.raw`((?<!\\)\$(?:\\.|[^$\\])+?\$|${HTTP})`, 's'); // math and addresses

function accent(mark, body) {
  const [first, ...rest] = body.trim();
  if (!first) return '';
  return (first === 'ı' ? 'i' : first === 'ȷ' ? 'j' : first) + String.fromCharCode(mark) + rest.join('');
}

/** TeX text (no math) to plain Unicode: `G\"{o}del` → Gödel, `{OpenAI}` → OpenAI. Crossref's face
 *  markup goes too; anything else that looks like a tag stays visible. */
function cleanText(s) {
  return s
    .replace(/<\/?(?:b|i|u|ovl|sup|sub|scp|tt)>/g, '')
    .replace(/\\\\/g, ' ')
    .replace(/\\(ss|ae|AE|oe|OE|aa|AA|o|O|l|L|i|j)(?![a-zA-Z])(?:\{\}|\s+)?/g, (all, name) => NAMED[name])
    .replace(/\\(LaTeX|TeX)(?![a-zA-Z])(?:\{\})?/g, '$1')
    .replace(/\\([`'^~=."])\s*(?:\{([^{}]*)\}|(\S))/g, (all, a, group, letter) => accent(SYMBOL_ACCENTS[a], group ?? letter))
    .replace(/\\([uvHcdbrk])(?:\s*\{([^{}]*)\}|\s+(\S))/g, (all, a, group, letter) => accent(LETTER_ACCENTS[a], group ?? letter))
    .replace(/\\([&%$#_])/g, '$1')
    .replace(/\\[ \n,;:]/g, ' ')
    .replace(/\\[-/!]/g, '')
    .replace(/\\[a-zA-Z]+\*?\s*/g, '')
    .replace(/``/g, '“').replace(/''/g, '”')
    .replace(/~/g, ' ')
    .replace(/\\([{}])|[{}]/g, (all, escaped) => escaped ?? '') // grouping braces go, \{ and \} stay
    .replace(/\s+/g, ' ')
    .normalize('NFC');
}

const unescapeUrl = s => s.trim().replace(/\\([_%&#~])/g, '$1');

/** Field text as inline markdown for the renderer. A bibliography's text is data, not markup, so
 *  everything is escaped except what TeX authors mean by it: math, addresses, and `--` for a dash. */
function toInline(s) {
  return s.replace(/\\href\s*\{([^{}]*)\}\{([^{}]*)\}/g, '$2 $1').split(VERBATIM).map((part, i) => {
    if (i % 2 === 0) return cleanText(part).replace(/&/g, '&amp;').replace(/[\\`*_[\]<>~|!@$.]/g, '\\$&');
    return part[0] === '$' ? part : `<${unescapeUrl(part)}>`;
  }).join('').trim();
}

// ---------------------------------------------------------------------------
// Names

// Braces hold a corporate name or a protected word together, up to three levels deep.
const BRACED = /\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}/g;

/** Split at a separator outside braces. `separator` is a /g regex. */
function splitTop(s, separator) {
  const parts = [];
  let from = 0;
  for (const m of s.replace(BRACED, b => '_'.repeat(b.length)).matchAll(separator)) { parts.push(s.slice(from, m.index)); from = m.index + m[0].length; }
  parts.push(s.slice(from));
  return parts;
}

function parseName(raw) {
  const s = raw.trim();
  if (s.toLowerCase() === 'others') return { others: true };
  const commas = splitTop(s, /,/g).map(p => p.trim());
  if (commas.length > 1) return { last: commas[0], jr: commas.length > 2 ? commas[1] : '', first: commas.at(-1) };
  const ws = splitTop(s, /\s+/g).filter(Boolean);
  return { first: ws.slice(0, -1).join(' '), last: ws.at(-1) ?? '' };
}

const parseNames = field => splitTop(field ?? '', /\s+and\s+/gi).filter(n => n.trim()).map(parseName);

const formatNames = names => names.map(n => (n.others ? 'et al.' : [n.first, n.last, n.jr].filter(Boolean).join(' '))).join(', ');

/** Citation label: the first author's surname without its "van der", three letters, plus the two-digit year. */
function bibLabel(e) {
  const surname = cleanText(parseNames(e.author ?? e.editor)[0]?.last ?? '').replace(/^(?:\p{Ll}\S*\s+)+/u, '');
  const who = surname || cleanText(e.organization || e.institution || e.publisher || e.title || e.key || e.citekey || '');
  const letters = who.replace(/[^\p{L}\p{N}]+/gu, '');
  const year = /\d{4}/.exec(`${e.year ?? e.date ?? ''}`)?.[0] ?? `${e.year ?? ''}`.replace(/\D/g, '');
  return `${[...letters].slice(0, 3).join('') || '?'}${year.slice(-2)}`;
}

// ---------------------------------------------------------------------------
// The References section

const KINDS = { __proto__: null, phdthesis: 'PhD thesis', mastersthesis: "Master's thesis", mathesis: "Master's thesis", thesis: 'Thesis', techreport: 'Technical report', report: 'Technical report' };
const ARXIV_ID = /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/;

function referenceHtml(e, key, inline, warn) {
  const missing = [];
  if (!e.title) missing.push('title');
  if (!(e.author || e.editor || e.organization || e.institution || e.publisher)) missing.push('author');
  if (!(e.year || e.date)) missing.push('year');
  if (missing.length) warn(`reference ${key}: missing ${missing.join(', ')}`);

  const journal = e.journal ?? e.journaltitle;
  const place = journal && e.volume
    ? `${e.volume}${e.number ? `(${e.number})` : ''}${e.pages ? `:${e.pages}` : ''}`
    : [e.volume && `vol. ${e.volume}`, e.number && `no. ${e.number}`, e.pages && `pages ${e.pages}`].filter(Boolean).join(', ');
  const venue = [journal ? `<em>${inline(journal)}</em>` : e.booktitle && `In <em>${inline(e.booktitle)}</em>`];
  // `type = {phdthesis}` as biblatex has it, a free-text type, or what the entry type implies
  for (const part of [place, KINDS[e.type?.toLowerCase()] ?? e.type ?? KINDS[e.entrytype], e.school, e.institution, e.organization, e.publisher, e.howpublished, e.year ?? /^\d{4}/.exec(e.date ?? '')?.[0] ?? e.date]) {
    if (part) venue.push(inline(part));
  }

  const editors = !e.author && e.editor ? parseNames(e.editor) : null;
  const who = e.author ? formatNames(parseNames(e.author)) : editors ? `${formatNames(editors)} (${editors.length > 1 ? 'eds' : 'ed'}.)` : '';
  const sentences = [who && inline(who), e.title && inline(e.title), venue.filter(Boolean).join(', '), e.note && inline(e.note)]
    .filter(Boolean)
    .map(s => (/[.!?…]$/.test(s.replace(/<[^>]*>/g, '')) ? s : `${s}.`));

  const links = [];
  const doi = e.doi && unescapeUrl(e.doi).replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '');
  if (doi) links.push(`<a href="https://doi.org/${esc(encodeURI(doi))}">doi:${esc(doi)}</a>`);
  const archive = (e.archiveprefix ?? e.eprinttype ?? '').toLowerCase();
  const eprint = e.eprint?.trim().replace(/^arxiv:/i, '');
  const arxiv = eprint && (archive === 'arxiv' || (!archive && ARXIV_ID.test(eprint))) ? eprint : '';
  if (arxiv) links.push(`<a href="https://arxiv.org/abs/${esc(encodeURI(arxiv))}">arXiv:${esc(arxiv)}</a>`);
  const url = e.url && unescapeUrl(e.url);
  if (url && !/^https?:\/\//i.test(url)) warn(`reference ${key}: not linking ${url}, only http and https addresses`);
  else if (url && !(doi && url.toLowerCase().includes(doi.toLowerCase())) && !(arxiv && url.includes(arxiv))) links.push(`<a href="${esc(url)}">${esc(url)}</a>`);

  return [...sentences, ...links].join(' ');
}

/** The References section for the cited keys, or '' if nothing was cited. */
export function renderBibliography(bib, cited, parseInline, { id, warn }) {
  if (!cited.size) return '';
  const inline = s => parseInline(toInline(String(s)));
  const items = [...cited]
    .sort((a, b) => bib.get(a).label.localeCompare(bib.get(b).label) || a.localeCompare(b))
    .map(key => `<li id="ref-${esc(key)}"><span>[${esc(bib.get(key).label)}]</span><span>${referenceHtml(bib.get(key), key, inline, warn)}</span></li>`);
  return `<section class="references"><h1 id="${esc(id)}">References</h1><ol>${items.join('')}</ol></section>`;
}
