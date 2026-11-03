// A small BibTeX reader and the References section. It takes what real exports contain (arXiv,
// Crossref, Zotero, Google Scholar): nested braces, quotes, @string macros, one-line entries.

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const MONTHS = { jan: 'January', feb: 'February', mar: 'March', apr: 'April', may: 'May', jun: 'June', jul: 'July', aug: 'August', sep: 'September', oct: 'October', nov: 'November', dec: 'December' };

const ENTRY_TYPE = /[A-Za-z]+/y;
const ENTRY_KEY = /[^\s,{}()=]+/y;
const FIELD_NAME = /[^\s,=#{}()"]+/y;
const BARE_VALUE = /[^\s,#{}()"=]+/y;

/** Parse BibTeX into a Map of key -> { type, typeField, citekey, label, ...fields }. Field names are
 *  lower-cased and values kept as TeX. Problems are warned about, and reading goes on at the next entry. */
export function parseBib(text, warn = () => {}) {
  const entries = new Map();
  const macros = Object.assign(Object.create(null), MONTHS);
  const lineAt = i => text.slice(0, i).split('\n').length;
  let pos = 0;

  const skipSpace = () => { while (pos < text.length && /\s/.test(text[pos])) pos++; };
  const word = re => {
    re.lastIndex = pos;
    const m = re.exec(text);
    if (m) pos = re.lastIndex;
    return m?.[0];
  };

  // BibTeX balances braces without regard to backslashes, so anything it accepts reads the same here.
  function braced() {
    const start = pos;
    for (let depth = 0; pos < text.length; pos++) {
      if (text[pos] === '{') depth++;
      else if (text[pos] === '}' && --depth === 0) return text.slice(start + 1, pos++);
    }
    throw new Error(`unclosed { at line ${lineAt(start)}`);
  }

  function quoted() {
    const start = pos++;
    for (let depth = 0; pos < text.length; pos++) {
      if (text[pos] === '{') depth++;
      else if (text[pos] === '}') depth--;
      else if (text[pos] === '"' && depth <= 0) return text.slice(start + 1, pos++);
    }
    throw new Error(`unclosed " at line ${lineAt(start)}`);
  }

  /** A value: `{…}`, `"…"`, a number or a macro name, joined by `#`. */
  function value() {
    let out = '';
    for (;;) {
      skipSpace();
      if (text[pos] === '{') out += braced();
      else if (text[pos] === '"') out += quoted();
      else {
        const start = pos;
        const w = word(BARE_VALUE);
        if (!w) throw new Error(`expected a value at line ${lineAt(pos)}`);
        if (/^\d+$/.test(w)) out += w;
        else if (w.toLowerCase() in macros) out += macros[w.toLowerCase()];
        else { warn(`bib: unknown @string ${w} at line ${lineAt(start)}`); out += w; }
      }
      skipSpace();
      if (text[pos] !== '#') return out;
      pos++;
    }
  }

  function readEntry(type, close, start) {
    const key = word(ENTRY_KEY);
    if (!key) throw new Error(`entry without a key at line ${lineAt(start)}`);
    const entry = { type, citekey: key };
    if (entries.has(key)) warn(`bib: duplicate key ${key} at line ${lineAt(start)}, keeping the first`);
    else entries.set(key, entry);
    for (;;) {
      skipSpace();
      if (pos >= text.length) throw new Error(`entry ${key} opened at line ${lineAt(start)} is not closed`);
      if (text[pos] === close) { pos++; return; }
      if (text[pos] === ',') { pos++; continue; }
      const at = pos;
      const name = word(FIELD_NAME)?.toLowerCase();
      skipSpace();
      if (!name || text[pos] !== '=') throw new Error(`entry ${key}: expected field = value at line ${lineAt(at)}`);
      pos++;
      const v = value();
      if (name === 'type') entry.typeField = v;
      else entry[name] = v;
    }
  }

  while ((pos = text.indexOf('@', pos)) >= 0) {
    const start = pos++;
    skipSpace();
    const type = word(ENTRY_TYPE)?.toLowerCase();
    skipSpace();
    const open = text[pos];
    if (!type || (open !== '{' && open !== '(')) continue; // BibTeX ignores text outside entries, like me@example.org
    try {
      if (type === 'comment' || type === 'preamble') {
        if (open === '{') braced();
        continue;
      }
      const close = open === '{' ? '}' : ')';
      pos++;
      skipSpace();
      if (type === 'string') {
        const name = word(FIELD_NAME);
        skipSpace();
        if (!name || text[pos] !== '=') throw new Error(`@string: expected name = value at line ${lineAt(start)}`);
        pos++;
        macros[name.toLowerCase()] = value();
        skipSpace();
        if (text[pos] !== close) throw new Error(`@string ${name} at line ${lineAt(start)} is not closed`);
        pos++;
      } else {
        readEntry(type, close, start);
      }
    } catch (e) {
      warn(`bib: ${e.message}`);
      const next = text.indexOf('\n@', start);
      pos = next < 0 ? text.length : next + 1;
    }
  }

  // Labels: [Knu74], with a suffix wherever two entries of the file would share one.
  const groups = new Map();
  for (const key of [...entries.keys()].sort()) {
    const label = bibLabel(entries.get(key));
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(entries.get(key));
  }
  for (const [label, group] of groups) {
    group.forEach((e, i) => { e.label = group.length > 1 ? `${label}${(i + 10).toString(36)}` : label; });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// TeX in field values

const NAMED = { ss: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', aa: 'å', AA: 'Å', o: 'ø', O: 'Ø', l: 'ł', L: 'Ł', i: 'ı', j: 'ȷ' };
const SYMBOL_ACCENTS = { '`': 0x300, "'": 0x301, '^': 0x302, '~': 0x303, '=': 0x304, '.': 0x307, '"': 0x308 }; // combining marks
const LETTER_ACCENTS = { u: 0x306, v: 0x30C, H: 0x30B, c: 0x327, d: 0x323, b: 0x331, r: 0x30A, k: 0x328 };
const BIB_MATH = /((?<!\\)\$(?:\\.|[^$\\])+?\$)/s;

function accent(mark, body = '') {
  const [first, ...rest] = body.trim();
  if (!first) return '';
  return (first === 'ı' ? 'i' : first === 'ȷ' ? 'j' : first) + String.fromCharCode(mark) + rest.join('');
}

/** TeX text (no math) to plain Unicode: `G\"{o}del` → Gödel, `{OpenAI}` → OpenAI. */
function cleanText(s) {
  return s
    .replace(/\\\\/g, ' ')
    .replace(/\\(ss|ae|AE|oe|OE|aa|AA|o|O|l|L|i|j)(?![a-zA-Z])(?:\{\}|\s+)?/g, (all, name) => NAMED[name])
    .replace(/\\(LaTeX|TeX)(?![a-zA-Z])(?:\{\})?/g, '$1')
    .replace(/\\([`'^~=."])\s*(?:\{\s*([^{}]*?)\s*\}|(\S))/g, (all, a, group, letter) => accent(SYMBOL_ACCENTS[a], group ?? letter))
    .replace(/\\([uvHcdbrk])(?:\s*\{\s*([^{}]*?)\s*\}|\s+(\S))/g, (all, a, group, letter) => accent(LETTER_ACCENTS[a], group ?? letter))
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

/** Field text as inline markdown for the renderer. A bibliography's text is data, not markup,
 *  so everything is escaped except what TeX authors mean by it: math, and `--` for a dash. */
function toInline(s) {
  return s.split(BIB_MATH).map((part, i) => (i % 2 ? part : cleanText(part).replace(/&/g, '&amp;').replace(/[\\`*_[\]<>~|!@$]/g, '\\$&'))).join('').trim();
}

// ---------------------------------------------------------------------------
// Names

/** Split at a separator outside braces. `separator` is a sticky regex. */
function splitTop(s, separator) {
  const parts = [];
  let depth = 0, from = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') depth--;
    else if (depth === 0) {
      separator.lastIndex = i;
      const m = separator.exec(s);
      if (m) { parts.push(s.slice(from, i)); i += m[0].length - 1; from = i + 1; }
    }
  }
  parts.push(s.slice(from));
  return parts;
}

const words = s => splitTop(s, /\s+/y).filter(Boolean);
const isLower = w => !/^\{[^\\]/.test(w) && /^\p{Ll}/u.test(cleanText(w).trim());

/** Where the surname starts in "von Last": after the last lowercase word, but never empty. */
function surnameStart(ws) {
  let i = ws.length - 1;
  while (i > 0 && !isLower(ws[i - 1])) i--;
  return i;
}

function parseName(raw) {
  const s = raw.trim();
  if (s.toLowerCase() === 'others') return { others: true };
  if (/^\{.*\}$/s.test(s) && words(s).length === 1) return { last: s }; // {Corporate Author}
  const commas = splitTop(s, /,/y).map(p => p.trim());
  if (commas.length > 1) {
    const ws = words(commas[0]);
    const i = surnameStart(ws);
    return { von: ws.slice(0, i).join(' '), last: ws.slice(i).join(' '), jr: commas.length > 2 ? commas[1] : '', first: commas.at(-1) };
  }
  const ws = words(s);
  const lower = ws.slice(0, -1).findIndex(isLower);
  if (lower < 0) return { first: ws.slice(0, -1).join(' '), last: ws.at(-1) ?? '' };
  const rest = ws.slice(lower);
  const i = surnameStart(rest);
  return { first: ws.slice(0, lower).join(' '), von: rest.slice(0, i).join(' '), last: rest.slice(i).join(' ') };
}

const parseNames = field => splitTop(field ?? '', /\s+and\s+/iy).filter(n => n.trim()).map(parseName);

const formatNames = names => names.map(n => (n.others ? 'et al.' : [n.first, n.von, n.last, n.jr].filter(Boolean).join(' '))).join(', ');

/** Citation label: the first author's surname, three letters, plus the two-digit year. */
export function bibLabel(e) {
  const first = parseNames(e.author ?? e.editor)[0];
  const who = first?.last || e.organization || e.institution || e.publisher || e.title || e.key || e.citekey || '';
  const letters = cleanText(who).replace(/[^\p{L}\p{N}]+/gu, '');
  const year = /\d{4}/.exec(`${e.year ?? e.date ?? ''}`)?.[0] ?? `${e.year ?? ''}`.replace(/\D/g, '');
  return `${[...letters].slice(0, 3).join('') || '?'}${year.slice(-2)}`;
}

// ---------------------------------------------------------------------------
// The References section

const unescapeUrl = s => s.trim().replace(/\\([_%&#~])/g, '$1');

/** Take `\url{…}` and `\href{…}` out of a field, so the address isn't read as text. */
function pullUrl(s) {
  let url = '';
  const text = (s ?? '').replace(/\\(?:url|href)\s*\{([^{}]*)\}/g, (all, u) => { url ||= u; return ''; }).trim();
  return { text, url };
}

function thesisKind(e) {
  const declared = (e.typeField ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (e.type === 'phdthesis' || declared === 'phdthesis') return 'PhD thesis';
  if (e.type === 'mastersthesis' || declared === 'mastersthesis' || declared === 'mathesis') return "Master's thesis";
  if (['thesis', 'techreport', 'report'].includes(e.type) && e.typeField) return e.typeField;
  if (e.type === 'thesis') return 'Thesis';
  if (e.type === 'techreport' || e.type === 'report') return 'Technical report';
  return '';
}

const ARXIV_ID = /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/;

function referenceHtml(e, key, inline, warn) {
  const missing = [];
  if (!e.title) missing.push('title');
  if (!(e.author || e.editor || e.organization || e.institution || e.publisher)) missing.push('author');
  if (!(e.year || e.date)) missing.push('year');
  if (missing.length) warn(`reference ${key}: missing ${missing.join(', ')}`);

  const how = pullUrl(e.howpublished);
  const note = pullUrl(e.note);
  const venue = [];
  const journal = e.journal ?? e.journaltitle;
  if (journal) {
    let s = `<em>${inline(journal)}</em>`;
    if (e.volume) s += `, ${inline(e.volume)}${e.number ? `(${inline(e.number)})` : ''}`;
    else if (e.number) s += `, no. ${inline(e.number)}`;
    if (e.pages) s += `${e.volume || e.number ? ':' : ', '}${inline(e.pages)}`;
    venue.push(s);
  } else {
    if (e.booktitle) venue.push(`In <em>${inline(e.booktitle)}</em>${e.volume ? `, vol. ${inline(e.volume)}` : ''}`);
    if (e.pages) venue.push(`pages ${inline(e.pages)}`);
  }
  const kind = thesisKind(e);
  if (kind) venue.push(inline(e.number ? `${kind} ${e.number}` : kind));
  for (const part of [e.school, e.institution, e.organization, e.publisher, how.text]) if (part) venue.push(inline(part));
  const year = e.year ?? /^\d{4}/.exec(e.date ?? '')?.[0] ?? e.date;
  if (year) venue.push(inline(year));

  const editors = !e.author && e.editor ? parseNames(e.editor) : null;
  const who = e.author ? formatNames(parseNames(e.author)) : editors ? `${formatNames(editors)} (${editors.length > 1 ? 'eds' : 'ed'}.)` : '';
  const sentences = [who && inline(who), e.title && inline(e.title), venue.join(', '), note.text && inline(note.text)]
    .filter(Boolean)
    .map(s => (/[.!?…]$/.test(s.replace(/<[^>]*>/g, '')) ? s : `${s}.`));

  const links = [];
  const doi = e.doi && unescapeUrl(e.doi).replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '');
  if (doi) links.push(`<a href="https://doi.org/${esc(encodeURI(doi))}">doi:${esc(doi)}</a>`);
  const archive = (e.archiveprefix ?? e.eprinttype ?? '').toLowerCase();
  const eprint = e.eprint?.trim().replace(/^arxiv:/i, '');
  const arxiv = eprint && (archive === 'arxiv' || (!archive && ARXIV_ID.test(eprint))) ? eprint : '';
  if (arxiv) links.push(`<a href="https://arxiv.org/abs/${esc(encodeURI(arxiv))}">arXiv:${esc(arxiv)}</a>`);
  const url = unescapeUrl(e.url ?? how.url ?? '') || unescapeUrl(note.url);
  if (url && !/^https?:\/\//i.test(url)) warn(`reference ${key}: not linking ${url}, only http and https addresses`);
  else if (url && !(doi && url.toLowerCase().includes(doi.toLowerCase())) && !(arxiv && url.includes(arxiv))) links.push(`<a href="${esc(url)}">${esc(url)}</a>`);

  return [...sentences, ...links].join(' ');
}

/** The References section for the cited keys, or '' if nothing was cited. */
export function renderBibliography(bib, cited, parseInline, { id = 'sec-references', warn = () => {} } = {}) {
  const inline = s => parseInline(toInline(String(s)));
  const items = [...cited]
    .filter(key => bib.has(key))
    .map(key => ({ key, e: bib.get(key), label: bib.get(key).label ?? bibLabel(bib.get(key)) }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key))
    .map(({ key, e, label }) => `<li id="ref-${esc(key)}"><span>[${esc(label)}]</span><span>${referenceHtml(e, key, inline, warn)}</span></li>`);
  if (!items.length) return '';
  return `<section class="references"><h1 id="${esc(id)}">References</h1><ol>${items.join('')}</ol></section>`;
}
