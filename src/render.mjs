// The markdown dialect, as marked extensions.
//
// Every construct of the dialect is one self-contained extension object: a name, a
// `start` that says where it may begin (so it can interrupt a paragraph), a
// `tokenizer` that reads it off the source, and a `renderer` that turns the token
// into HTML. marked lexes the document once and tries these before its own rules,
// and it protects code blocks and code spans for us, so there is no pass ordering
// to get right and nothing to stash. Numbers (equations, tables, figures, theorem
// kinds) are assigned while lexing and sections right after it, in document order;
// cross-references resolve while rendering, when every label is known, so forward
// references work.
//
// `::: kind … :::` blocks are dispatched through a registry of block kinds (see
// BLOCK KINDS below). The built-in kinds (ai, proof, table, ralign, lalign and the
// common statements), the theorem kinds of the config and the kinds a plugin
// registers all use the same interface. Plugins also extend the inline dialect:
// `spans` (code spans with a registered prefix, `pat:1011`), `fences` (fenced blocks
// with a registered language) and `comments` (`<!-- … -->` handlers). See plugins.mjs.

import { Marked, Renderer } from 'marked';
import katex from 'katex';
import { bibLabel } from './bib.mjs';

export { bibLabel };

/** Escape for attribute values and text we build ourselves. */
export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** marked's own text escaping: entities that are already there are left alone. */
const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escText = s => s.replace(/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, c => ENT[c]);

/** TeX-style dashes in prose: `---` is an em dash, `--` an en dash. */
export const dashes = s => s.replace(/---/g, '—').replace(/--/g, '–');

const countLines = s => { let n = 0; for (let i = s.indexOf('\n'); i >= 0; i = s.indexOf('\n', i + 1)) n++; return n; };

/** A lookup table a document can't reach Object.prototype through (`::: constructor`). */
const table = o => Object.assign(Object.create(null), o);

const idAttr = id => (id ? ` id="${esc(id)}"` : '');

// Labels: word characters, with `:` `.` `-` only between them, so that the period ending
// a sentence or the `--` of an en dash is never part of a reference.
const ID = String.raw`\w+(?:[:.-]\w+)*`;

const ATTR = new RegExp(String.raw`\s*(?:#(${ID})|\.([\w-]+)|([\w-]+)=(?:"([^"]*)"|'([^']*)'))(?=\s|$)`, 'y');

/** The inside of `{#id .class key="value"}`. `complain` hears about whatever can't be read. */
function parseAttrs(s, complain) {
  const a = { classes: [] };
  const text = s.trim();
  ATTR.lastIndex = 0;
  while (ATTR.lastIndex < text.length) {
    const from = ATTR.lastIndex;
    const m = ATTR.exec(text);
    if (!m || m[3] === 'classes') { complain(`cannot read "${text.slice(from).trim()}"`); break; }
    if (m[1]) a.id = m[1];
    else if (m[2]) a.classes.push(m[2]);
    else a[m[3]] = m[4] ?? m[5];
  }
  return a;
}

// Container fences. `::: kind {attrs}` opens, `:::` closes the innermost block, `::: endkind`
// closes the innermost block of that kind (checked before OPEN, since "endwip" is also a word).
const OPEN = /^:::[ \t]*([\w-]+)(?:[ \t]+(.*?))?[ \t]*$/;
const CLOSE = /^:::[ \t]*$/;
const END = /^:::[ \t]*end([\w-]+)[ \t]*$/;

/** Feed it lines in order; it says which are verbatim: inside a fenced code block or an HTML
 *  comment, as CommonMark reads them, where `:::` and `Caption:` mean nothing. */
function verbatimLines() {
  let fence = null, comment = false;
  return line => {
    if (fence) {
      const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      return true;
    }
    if (comment) { comment = !line.includes('-->'); return true; }
    const m = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/.exec(line);
    if (m) { fence = m[1]; return true; }
    if (/^ {0,3}<!--/.test(line)) { comment = !line.includes('-->'); return true; }
    return false;
  };
}

// Where a caption's continuation lines stop: the next line that starts a block of its own.
const BLOCK_START = /^(?:\||:::|```|~~~|\$\$|\\\[|#{1,6}\s|[-*+]\s|\d+[.)]\s|>|!\[|<)/;

/** Lift the block's own `Caption:` line, and any lines continuing it, out of its body. They are
 *  blanked, not removed, so line numbers stay right. Fences and nested blocks are left alone. */
function liftCaption(body) {
  const lines = body.split('\n');
  const verbatim = verbatimLines();
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    if (verbatim(lines[i])) continue;
    if (END.test(lines[i]) || CLOSE.test(lines[i])) { depth = Math.max(0, depth - 1); continue; }
    if (OPEN.test(lines[i])) { depth++; continue; }
    const m = depth ? null : /^Caption:[ \t]*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const parts = [m[1]];
    let end = i + 1;
    while (end < lines.length && lines[end].trim() && !BLOCK_START.test(lines[end])) parts.push(lines[end++].trim());
    lines.fill('', i, end);
    return { caption: parts.join(' ').trim(), body: lines.join('\n') };
  }
  return { caption: '', body };
}

// Math delimiters follow pandoc: a `$` opens only before a non-space and closes only after a
// non-space and not before a digit, so "$20,000 and $30,000" stays text; `\$` is a dollar sign.
const DOLLARS = String.raw`\$\$((?:\\.|[^$\\]|\$(?!\$))+?)\$\$`;
const DOLLAR = String.raw`\$(?=[^\s$])((?:\\.|[^$\\])+?)(?<=\S)\$(?!\d)`;
const PARENS = String.raw`\\\(((?:\\[^)]|[^\\])+?)\\\)`;
const INLINE_MATH = new RegExp(`^(?:${DOLLARS}|${DOLLAR}|${PARENS})`, 's');
const ANY_MATH = new RegExp(String.raw`(?<!\\)(?:${DOLLARS}|${DOLLAR})|${PARENS}`, 'gs');
// `$$ … $$` or `\[ … \]` as a block of its own; as in TeX, a blank line can't be part of it.
const DISPLAY_LINE_BREAK = String.raw`\n(?![ \t]*\n)`;
const DISPLAY_MATH = new RegExp(String.raw`^(?:\$\$((?:\\[\s\S]|[^$\\\n]|\$(?!\$)|${DISPLAY_LINE_BREAK})+?)\$\$|\\\[((?:\\(?!\])[\s\S]|[^\\\n]|${DISPLAY_LINE_BREAK})+?)\\\])(?:[ \t]*\{#(${ID})\})?[ \t]*(?:\n|$)`);
// KaTeX numbers these on its own, out of step with Folio's equation counter.
const SELF_NUMBERING = /\\begin\{(equation|align|alignat|gather)\}/;

const TABLE_RULE = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/** A table splits its rows at every `|`, even inside math, and turns `\|` into `|`. Escape the bars
 *  in the math of table rows so that `| $|x|$ |` and `| $\|x\|$ |` both mean what they say. */
function escapeTableMath(text) {
  if (!text.includes('|') || (!text.includes('$') && !text.includes('\\('))) return text;
  const escapeRow = row => row.replace(ANY_MATH, m => m.replace(/\\\|/g, '\\Vert{}').replace(/\|/g, '\\|'));
  const lines = text.split('\n');
  const verbatim = verbatimLines();
  const isVerbatim = lines.map(line => verbatim(line));
  for (let i = 1; i < lines.length; i++) {
    if (isVerbatim[i] || !lines[i].includes('|') || !TABLE_RULE.test(lines[i])) continue;
    lines[i - 1] = escapeRow(lines[i - 1]);
    for (let j = i + 1; j < lines.length && lines[j].trim() && !isVerbatim[j] && !/^(?:Caption:|:::)/.test(lines[j]); j++) lines[j] = escapeRow(lines[j]);
  }
  return lines.join('\n');
}

// A citation: `[@key]`, `[@key, p. 3]`, `[@a; @b]`. Anything else in brackets is ordinary text.
const CITE_ITEM = /^\s*@(\w(?:[\w:./+-]*\w)?)(?:(?:\s*,\s*|\s+)(\S[^;]*?))?\s*$/;
function parseCites(inner) {
  const items = [];
  for (const part of inner.split(/;|,(?=\s*@)/)) {
    const m = CITE_ITEM.exec(part);
    if (!m) return null;
    items.push({ key: m[1], locator: m[2] ?? '' });
  }
  return items;
}

// `# Heading {-}`, `{#sec:id}`, `{#sec:id -}`: read off the end of the heading's last text token.
const HEADING_ATTRS = new RegExp(String.raw`[ \t]*\{[ \t]*(?:#(${ID}))?[ \t]*(-)?[ \t]*\}[ \t]*$`);

/** A heading's words, for its id and label: math, figures and notes are left out. */
const NOT_WORDS = new Set(['math', 'shortcode', 'sidenoteRef', 'html']);
const wordsOf = tokens => tokens.map(t => (NOT_WORDS.has(t.type) ? '' : t.tokens ? wordsOf(t.tokens) : t.text ?? t.raw ?? '')).join('');

// ---------------------------------------------------------------------------
// BLOCK KINDS
//
// A block kind says what `::: kind … :::` does:
//   label     'Lemma', 'Table', …: the block is numbered (its own counter per kind) and,
//             with an id, can be cited as "Lemma 3"
//   reference 'Proof', …: reference text for an unnumbered block with an id
//   figure    default true: a block with a {#fig:x} id is numbered as a figure ("Fig. n"
//             at its bottom right); false for kinds that are never figures (proof)
//   lex(body, t, api)   optional. Turn the body text into tokens on t; the default lexes it
//             as markdown into t.tokens. api.block(text, tokens) lexes nested markdown,
//             api.inline(text) queues inline content and returns its (future) tokens.
//   render(t, api)      required. api.parse(tokens) and api.parseInline(tokens) render
//             tokens; api.div(t, inner) wraps inner in the block's <div class="kind …"> (and
//             its <figure> when numbered); api.head(t) / api.qed(t) place a theorem heading
//             or a QED box on the tokens; api.ctx, api.warn, api.esc as for plugins.
// A kind with no registration renders as <div class="kind"> around its markdown.

const generic = { render: (t, api) => api.div(t, api.parse(t.tokens)) };
const lexMarkdown = (body, t, api) => api.block(body, t.tokens);

/** A theorem-like kind: "Name n (title)." at the start of the first paragraph. */
export function theoremKind({ name, style = 'plain' }) {
  return {
    label: name,
    figure: false,
    lex(body, t, api) { t.cls.push('thm', style); api.block(body, t.tokens); },
    render(t, api) { api.head(t, { text: `${name} ${t.n}` }); return api.div(t, api.parse(t.tokens)); },
  };
}

// These work out of the box; `kinds` in the config adds to them and restyles them.
const statementKinds = {
  theorem: { name: 'Theorem' },
  lemma: { name: 'Lemma' },
  proposition: { name: 'Proposition' },
  corollary: { name: 'Corollary' },
  conjecture: { name: 'Conjecture' },
  definition: { name: 'Definition', style: 'defn' },
  remark: { name: 'Remark', style: 'defn' },
};

const builtinKinds = {
  ai: {
    figure: false,
    render(t, api) {
      return api.div(t, `<p class="ai-label">AI draft</p>\n${api.parse(t.tokens)}`);
    },
  },
  proof: {
    reference: 'Proof',
    figure: false,
    lex(body, t, api) { t.cls.push('thm'); api.block(body, t.tokens); },
    render(t, api) { api.head(t, { text: 'Proof', titleReplaces: true }); api.qed(t); return api.div(t, api.parse(t.tokens)); },
  },
  table: {
    label: 'Table',
    figure: false,
    lex(body, t, api) {
      const lifted = liftCaption(body);
      if (lifted.caption) t.caption = api.inline(lifted.caption);
      api.block(lifted.body, t.tokens);
    },
    render(t, api) {
      const cap = t.caption ? `<b>Table ${t.n}:</b> ${api.parseInline(t.caption)}` : `<b>Table ${t.n}</b>`;
      return `<figure class="${t.cls.join(' ')}"${idAttr(t.attrs.id)}>\n${api.parse(t.tokens)}<figcaption>${cap}</figcaption>\n</figure>\n`;
    },
  },
  // rows = non-blank lines, cells split on ' & '; every column right- (resp. left-) aligned
  ralign: { lex: lexRows, render: renderRows },
  lalign: { lex: lexRows, render: renderRows },
};

const CODE_OR_MATH = new RegExp(`${ANY_MATH.source}|\`[^\`]*\``, 'gs');
function splitRow(line) {
  const masked = line.replace(CODE_OR_MATH, m => 'x'.repeat(m.length)); // an & in math or code is not a separator
  const cells = [];
  let from = 0;
  for (const m of masked.matchAll(/\s+&\s+|^&\s+|\s+&$/g)) { cells.push(line.slice(from, m.index)); from = m.index + m[0].length; }
  cells.push(line.slice(from));
  return cells;
}
function lexRows(body, t, api) {
  t.rows = body.split('\n').filter(l => l.trim()).map(l => splitRow(l).map(c => api.inline(c.trim())));
}
function renderRows(t, api) {
  const ncol = Math.max(0, ...t.rows.map(r => r.length));
  const cells = t.rows.flatMap(r => [...r.map(c => api.parseInline(c)), ...Array(ncol - r.length).fill('')]);
  return api.div(t, cells.map(c => `<span>${c}</span>`).join(''), { style: `grid-template-columns: repeat(${ncol}, auto)`, tight: true });
}

const MAX_NESTING = 100;

/**
 * Build a renderer for one document.
 *   warn(msg)   collects build warnings
 *   kinds       theorem-like kinds from the config: { lemma: { name: 'Lemma', style: 'plain' }, … }
 *   macros      KaTeX macros shared by all math: { '\\R': '\\mathbb{R}' }
 *   blocks      block kinds registered by plugins (see BLOCK KINDS)
 *   bib         Map of bibtex entries (see bib.mjs)
 *   spans       { prefix: (arg, ctx) => html }      code spans `prefix:arg`
 *   fences      { lang: (body, ctx) => html }       fenced blocks ```lang
 *   comments    [ (body, ctx) => html | undefined ] HTML comment handlers; unclaimed comments are dropped
 *   ctx         passed through to the plugin functions
 *   resolveImage optional image URL transform; the full-page builder embeds local files
 */
export function createRenderer({ warn, kinds, macros, blocks: pluginBlocks, bib = new Map(), spans, fences, comments = [], ctx = {}, resolveImage = href => href }) {
  const blocks = table(builtinKinds);
  for (const [k, v] of Object.entries(statementKinds)) blocks[k] = theoremKind(v);
  for (const [k, v] of Object.entries(kinds ?? {})) {
    const spec = typeof v === 'string' ? { name: v } : v;
    if (typeof spec?.name !== 'string' || !spec.name) { warn(`kinds.${k}: expected a name, as in ${k}: { name: 'Lemma', style: 'plain' }`); continue; }
    if (Object.hasOwn(builtinKinds, k)) warn(`kinds.${k}: overrides the built-in kind`);
    blocks[k] = theoremKind(spec);
  }
  for (const [k, v] of Object.entries(pluginBlocks ?? {})) {
    const replaces = Object.hasOwn(kinds ?? {}, k) ? 'configured' : Object.hasOwn(builtinKinds, k) ? 'built-in' : null;
    if (replaces) warn(`block kind ${k}: a plugin overrides the ${replaces} kind`);
    blocks[k] = v;
  }
  const spanTable = table(spans), fenceTable = table(fences);
  if (macros && typeof macros !== 'object') warn(`macros: expected an object, as in { '\\\\R': '\\\\mathbb{R}' }`);
  const texMacros = typeof macros === 'object' ? { ...macros } : {}; // shared by all math, so \newcommand carries over

  const labels = new Map();                       // id -> { text, n }, filled while lexing
  const unnumbered = new Map();                   // id -> { kind, line } of blocks with an id but no number
  const counts = table({});                       // one counter per labelled block kind
  let equations = 0, figures = 0;
  const headings = [];                            // { depth, num, text, id } in document order
  const usedIds = new Set();
  const sec = { h1: 0, h2: 0 };
  const sidenotes = { defs: new Map(), nums: new Map() };
  const cited = new Set();
  let aiDrafts = 0;
  let inToc = false;                              // rendering a heading's copy for the table of contents
  // the texts being lexed, innermost last: the document, then each nested block body.
  // `kind` is the enclosing block's kind (null for the document), `base` the line number
  // of the text's first line. A tokenizer holding the remaining source `src` is usually
  // holding a suffix of `text`. Inside a list item or a quote, marked lexes a rewritten copy,
  // so there `lineOf` looks for src's first line, moving forward through the text.
  const units = [];
  const lineOf = src => {
    const u = units.at(-1);
    if (!u) return 0;
    const tail = u.text.length - src.length;
    if (tail >= 0 && u.text.startsWith(src.slice(0, 80), tail)) {
      u.cursor = tail;
    } else {
      const nl = src.indexOf('\n');
      const first = (nl < 0 ? src : src.slice(0, nl)).trim();
      const i = u.text.indexOf(first, u.cursor);
      if (i >= 0) u.cursor = i;
    }
    return u.base + countLines(u.text.slice(0, u.cursor));
  };
  const at = line => (line ? ` at line ${line}` : '');

  /** Run plugin code: a failure becomes a warning, and the caller's fallback stands in for it. */
  const attempt = (fn, fallback) => {
    try { return fn(); } catch (e) { warn(e?.message ?? String(e)); return fallback?.(); }
  };

  function tex(src, displayMode, where = '') {
    const own = displayMode && SELF_NUMBERING.exec(src);
    if (own) warn(`math${where}: \\begin{${own[1]}} adds KaTeX's own equation numbers, which Folio does not track. Use aligned, gathered or a starred form, and number it with $$ … $$ {#eq:id}`);
    try {
      return katex.renderToString(src, { displayMode, throwOnError: true, strict: 'ignore', macros: texMacros, globalGroup: true });
    } catch (e) {
      warn(`KaTeX${where}: ${e.message.split('\n')[0]}`);
      return `<span class="katex-error" title="${esc(e.message)}">${esc(src)}</span>`;
    }
  }

  /** Reserve an id for an element. False, with a warning, if the document already used it. */
  function claimId(id, line) {
    if (usedIds.has(id)) { warn(`duplicate label ${id}${at(line)}, keeping the first`); return false; }
    usedIds.add(id);
    return true;
  }

  function setLabel(id, text, n, line) {
    if (!claimId(id, line)) return false;
    labels.set(id, { text, n });
    return true;
  }

  const uniqueId = id => {
    let out = id;
    for (let k = 2; usedIds.has(out); k++) out = `${id}-${k}`;
    usedIds.add(out);
    return out;
  };

  // ---------------------------------------------------------------------------
  // Sections: numbered once lexing is done (a heading's inline tokens are queued until then),
  // so that @sec: references resolve in both directions.

  function numberHeading(t) {
    if (t.sec) return t.sec;
    let id, plain = false;
    const last = t.tokens.at(-1);
    const attrs = last?.type === 'text' ? HEADING_ATTRS.exec(last.text) : null;
    if (attrs && (attrs[1] || attrs[2])) {
      id = attrs[1];
      plain = !!attrs[2];
      last.text = last.raw = last.text.slice(0, attrs.index);
    }
    let num = '';
    if (!plain) {
      if (t.depth === 1) { sec.h1++; sec.h2 = 0; num = `${sec.h1}`; }
      else if (t.depth === 2) { sec.h2++; num = sec.h1 ? `${sec.h1}.${sec.h2}` : `${sec.h2}`; }
    }
    const words = wordsOf(t.tokens).trim();
    let anchor;
    if (id && setLabel(id, num ? `Section ${num}` : esc(words) || 'Section', num || null)) anchor = id;
    else {
      const slug = words.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
      anchor = uniqueId(id ?? (slug ? `sec-${slug}` : 'sec'));
    }
    t.sec = { num, id: anchor };
    return t.sec;
  }

  function numberHeadings(tokens) {
    for (const t of tokens) {
      if (t.type === 'heading') numberHeading(t);
      else if (t.type === 'list') numberHeadings(t.items);
      else if (t.tokens) numberHeadings(t.tokens);
    }
  }

  // ---------------------------------------------------------------------------
  // Containers

  /** Find where the block opened by `kind` at `line` ends. Returns offsets into src: the
   *  body ends at bodyEnd, the token's raw text at rawEnd (past the closing line, if any). */
  function scan(src, from, kind, line) {
    const stack = [kind];
    const verbatim = verbatimLines();
    let pos = from, ln = line;
    while (pos < src.length) {
      ln++;
      let nl = src.indexOf('\n', pos);
      if (nl < 0) nl = src.length;
      const text = src.slice(pos, nl);
      if (!verbatim(text)) {
        const end = END.exec(text);
        if (end) {
          const x = end[1];
          if (stack.includes(x)) {
            while (stack.at(-1) !== x) warn(`::: end${x}${at(ln)} closes an unclosed ${stack.pop()}`);
            stack.pop();
            if (!stack.length) return { bodyEnd: pos, rawEnd: Math.min(nl + 1, src.length) };
          } else if (units.some(u => u.kind === x)) {
            return { bodyEnd: pos, rawEnd: pos }; // an ancestor's closer: this block ends here, unclosed
          }
          // otherwise a stray closer: it stays in the body and is reported when lexed
        } else if (CLOSE.test(text)) {
          stack.pop();
          if (!stack.length) return { bodyEnd: pos, rawEnd: Math.min(nl + 1, src.length) };
        } else {
          const open = OPEN.exec(text);
          if (open) stack.push(open[1]);
        }
      }
      pos = nl + 1;
    }
    if (units.length === 1) warn(`unclosed ::: ${stack.slice(0, 5).join(' > ')}${stack.length > 5 ? ' > …' : ''}, opened${at(line)}`);
    return { bodyEnd: src.length, rawEnd: src.length };
  }

  const container = {
    name: 'container', level: 'block',
    start(src) { const m = /^:::/m.exec(src); return m ? m.index : undefined; },
    tokenizer(src) {
      if (!src.startsWith(':::')) return;
      let nl = src.indexOf('\n');
      if (nl < 0) nl = src.length;
      const line = src.slice(0, nl);
      const lineNo = lineOf(src);
      if (END.test(line) || CLOSE.test(line)) {
        warn(`stray ${line.trim()}${at(lineNo)}`);
        return { type: 'containerStray', raw: src.slice(0, Math.min(nl + 1, src.length)) };
      }
      const open = OPEN.exec(line);
      if (!open) { warn(`malformed ${line.trim()}${at(lineNo)}: a block opens with ::: kind {attributes}`); return; }
      const [, kind, rest] = open;
      const complain = message => warn(`::: ${kind}${at(lineNo)}: ${message}`);
      const braces = rest ? /^\{(.*)\}$/.exec(rest) : null;
      if (rest && !braces) complain(`cannot read "${rest}"; attributes go in braces, as in {#id .class key="value"}`);
      const attrs = parseAttrs(braces ? braces[1] : '', complain);
      const { bodyEnd, rawEnd } = scan(src, nl + 1, kind, lineNo);
      let body = src.slice(Math.min(nl + 1, src.length), bodyEnd);
      const def = blocks[kind] ?? generic;
      if (kind === 'ai') aiDrafts++;
      const t = {
        type: 'container', raw: src.slice(0, rawEnd), kind, attrs, line: lineNo,
        cls: [kind, ...attrs.classes],
        tokens: [], rows: [], caption: null, title: attrs.title ? this.lexer.inline(attrs.title, []) : null,
      };
      const label = (text, n) => { if (attrs.id && !setLabel(attrs.id, text, n, lineNo)) delete attrs.id; };
      if (def.label) {
        t.n = counts[kind] = (counts[kind] ?? 0) + 1;
        label(`${def.label} ${t.n}`, t.n);
      } else if (def.reference) {
        label(def.reference, null);
      } else if (attrs.id?.startsWith('fig:') && def.figure !== false) {
        t.fig = ++figures;
        label(`Fig. ${t.fig}`, t.fig);
        // a figure's `Caption:` line is lifted out, as for tables
        const lifted = liftCaption(body);
        if (lifted.caption) t.caption = this.lexer.inline(lifted.caption, []);
        body = lifted.body;
      } else if (attrs.id) {
        if (claimId(attrs.id, lineNo)) unnumbered.set(attrs.id, { kind, line: lineNo });
        else delete attrs.id;
      }
      const lexer = this.lexer;
      const api = {
        ctx, warn, esc,
        inline: text => lexer.inline(text, []),
        block(text, tokens) {
          if (units.length > MAX_NESTING) {
            complain(`blocks nested more than ${MAX_NESTING} deep; the rest is shown as text`);
            tokens.push({ type: 'code', raw: text, text });
            return tokens;
          }
          const top = lexer.state.top;
          lexer.state.top = true;
          units.push({ kind, base: lineNo + 1, text, cursor: 0 });
          try { lexer.blockTokens(text, tokens); }
          finally { units.pop(); lexer.state.top = top; }
          return tokens;
        },
      };
      attempt(() => (def.lex ? def.lex(body, t, api) : lexMarkdown(body, t, api)), () => {
        t.tokens = [];
        t.rows = [];
        lexMarkdown(body, t, api);
      });
      return t;
    },
    renderer(t) {
      const P = this.parser;
      const api = {
        ctx, warn, esc,
        parse: tokens => P.parse(tokens),
        parseInline: tokens => P.parseInline(tokens),
        /** The block's own wrapper: <div class="kind …" id> and, when it is a numbered figure, the
         *  <figure>, with "Fig. n" at the bottom right or, when the block had a Caption: line, a figcaption. */
        div(t, inner, { style, tight } = {}) {
          const attrs = `class="${t.cls.join(' ')}"${t.fig ? '' : idAttr(t.attrs.id)}${style ? ` style="${style}"` : ''}`;
          const div = tight ? `<div ${attrs}>${inner}</div>` : `<div ${attrs}>\n${inner}</div>`;
          if (!t.fig) return `${div}\n`;
          const cap = t.caption ? `<figcaption><b>Fig. ${t.fig}:</b> ${P.parseInline(t.caption)}</figcaption>` : `<span class="figno">Fig. ${t.fig}</span>`;
          return `<figure class="fig${t.caption ? ' captioned' : ''}"${idAttr(t.attrs.id)}>${div}${cap}</figure>\n`;
        },
        /** "Text n (title)." at the start of the first paragraph (one is made if there is none).
         *  With titleReplaces, a title stands in for the text, as in `::: proof {title="Proof of …"}`. */
        head(t, { text, titleReplaces = false }) {
          if (t.headPlaced) return;
          t.headPlaced = true;
          const tok = { type: 'thmHead', raw: '', text, title: t.title, titleReplaces };
          const i = t.tokens.findIndex(x => !PASSIVE.has(x.type));
          if (i >= 0 && t.tokens[i].type === 'paragraph') t.tokens[i].tokens.unshift(tok);
          else t.tokens.splice(i < 0 ? t.tokens.length : i, 0, { type: 'paragraph', raw: '', text: '', tokens: [tok] });
        },
        /** A QED box at the end of the last paragraph (on its own line after anything else). */
        qed(t) {
          if (t.qedPlaced) return;
          t.qedPlaced = true;
          const tok = { type: 'qed', raw: '' };
          let i = t.tokens.length - 1;
          while (i >= 0 && PASSIVE.has(t.tokens[i].type)) i--;
          if (i >= 0 && t.tokens[i].type === 'paragraph') t.tokens[i].tokens.push(tok);
          else t.tokens.push({ type: 'paragraph', raw: '', text: '', tokens: [tok] });
        },
      };
      const def = blocks[t.kind] ?? generic;
      let threw = false;
      let html = attempt(() => def.render(t, api), () => { threw = true; });
      if (typeof html !== 'string') {
        if (!threw) warn(`block kind ${t.kind}${at(t.line)}: render returned no HTML`);
        html = attempt(() => generic.render(t, api), () => '');
      }
      // A plugin kind may show its title on its own terms; every other kind shows it through head.
      if (t.title && !t.headPlaced && !Object.hasOwn(pluginBlocks ?? {}, t.kind)) {
        warn(`::: ${t.kind}${at(t.line)}: this kind does not show a title${blocks[t.kind] ? '' : `; is ${t.kind} missing from kinds?`}`);
      }
      return html;
    },
  };
  const PASSIVE = new Set(['space', 'html', 'sidenoteDef', 'containerStray']); // tokens that are not content
  const containerStray = { name: 'containerStray', renderer: () => '' };
  const thmHead = {
    name: 'thmHead',
    renderer(t) {
      const title = t.title ? this.parser.parseInline(t.title) : '';
      const text = t.title && t.titleReplaces ? title : `${t.text}${title ? ` (${title})` : ''}`;
      return `<span class="thm-head">${text}.</span> `;
    },
  };
  const qed = { name: 'qed', renderer: () => ' <span class="qed"></span>' };

  // ---------------------------------------------------------------------------
  // Math: $…$ or \(…\) inline; $$…$$ or \[…\] for display; `$$ {#eq:id}` numbers it.
  // The rendered HTML is kept on the token: a heading's math renders again for the table of
  // contents, and a formula with \newcommand must not run twice.

  const displayMath = {
    name: 'displayMath', level: 'block',
    start(src) { const m = /^(?:\$\$|\\\[)/m.exec(src); return m ? m.index : undefined; },
    tokenizer(src) {
      if (!src.startsWith('$$') && !src.startsWith('\\[')) return;
      const m = DISPLAY_MATH.exec(src);
      if (!m) {
        const blank = /\n[ \t]*\n/.exec(src);
        const paragraph = blank ? src.slice(0, blank.index) : src;
        if (src.startsWith('$$') && paragraph.indexOf('$$', 2) < 0) warn(`unclosed $$${at(lineOf(src))}`);
        return;
      }
      const t = { type: 'displayMath', raw: m[0], tex: (m[1] ?? m[2]).trim(), id: m[3], line: lineOf(src) };
      if (t.id) {
        t.n = ++equations;
        t.anchor = setLabel(t.id, `(${t.n})`, t.n, t.line);
      }
      return t;
    },
    renderer(t) {
      t.html ??= tex(t.tex, true, at(t.line));
      return t.id ? `<div class="eq"${t.anchor ? idAttr(t.id) : ''}>${t.html}<span class="eqno">(${t.n})</span></div>\n` : `<div class="eqd">${t.html}</div>\n`;
    },
  };

  const math = {
    name: 'math', level: 'inline',
    start(src) { const m = /\$|\\\(/.exec(src); return m ? m.index : undefined; },
    tokenizer(src) {
      const m = INLINE_MATH.exec(src);
      if (m) return { type: 'math', raw: m[0], tex: (m[1] ?? m[2] ?? m[3]).trim(), display: m[1] !== undefined };
    },
    renderer(t) { return t.html ??= tex(t.tex, t.display); },
  };

  // ---------------------------------------------------------------------------
  // Code spans with a registered prefix: `pat:1011` → the plugin's HTML.

  const prefixes = Object.keys(spanTable).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const spanRe = prefixes.length ? new RegExp(`^(${prefixes.join('|')})[ \\t]*:[ \\t]*([\\s\\S]*)$`) : null;
  const shortcode = {
    name: 'shortcode', level: 'inline',
    start(src) { const i = src.indexOf('`'); return i < 0 ? undefined : i; },
    tokenizer(src) {
      if (!spanRe) return;
      const m = /^`([^`\n]+)`/.exec(src);
      if (!m) return;
      const s = spanRe.exec(m[1].trim());
      if (!s) return; // an ordinary code span
      return { type: 'shortcode', raw: m[0], text: m[1], prefix: s[1], arg: s[2] };
    },
    renderer(t) {
      if (t.html === undefined) {
        const html = attempt(() => spanTable[t.prefix](t.arg, ctx));
        t.html = typeof html === 'string' ? html : `<code>${esc(t.text)}</code>`;
      }
      return t.html;
    },
  };

  // ---------------------------------------------------------------------------
  // Cross-references @kind:id, citations [@key], sidenotes [^id] … [^id]: body

  const REF = new RegExp(`^@(${ID})`);
  const ref = {
    name: 'ref', level: 'inline',
    start(src) { const m = /(^|[^\w@])@\w/.exec(src); return m ? m.index + m[1].length : undefined; },
    tokenizer(src, tokens) {
      const m = REF.exec(src);
      if (!m) return;
      const prev = tokens.at(-1);
      if (prev?.type === 'text' && /[\w@]$/.test(prev.raw)) return; // part of a word or an e-mail
      return { type: 'ref', raw: m[0], id: m[1] };
    },
    renderer(t) {
      const l = labels.get(t.id);
      if (l) return inToc ? l.text : `<a class="ref" href="#${t.id}">${l.text}</a>`;
      const block = unnumbered.get(t.id);
      if (!block && !t.id.includes(':')) return esc(t.raw); // a handle like @someone, not a reference
      if (!inToc) warn(block ? `unresolved reference @${t.id}: ::: ${block.kind}${at(block.line)} has this id but no number to show` : `unresolved reference @${t.id}`);
      return inToc ? '??' : `<a class="ref bad" href="#${t.id}">??</a>`;
    },
  };

  const cite = {
    name: 'cite', level: 'inline',
    start(src) { const i = src.indexOf('[@'); return i < 0 ? undefined : i; },
    tokenizer(src) {
      const m = /^\[(\s*@[^[\]]*)\](?![([])/.exec(src);
      const items = m && parseCites(m[1]);
      if (items) return { type: 'cite', raw: m[0], items };
    },
    renderer(t) {
      const parts = t.items.map(({ key, locator }) => {
        const e = bib.get(key);
        if (!inToc) { if (e) cited.add(key); else warn(`unknown citation ${key}`); }
        const text = `${e ? e.label ?? bibLabel(e) : '?'}${locator ? `, ${dashes(esc(locator))}` : ''}`;
        return { text, open: e ? `<a class="cite" href="#ref-${esc(key)}">` : '<a class="cite bad">' };
      });
      if (inToc) return `[${parts.map(p => p.text).join('; ')}]`;
      if (parts.length === 1) return `${parts[0].open}[${parts[0].text}]</a>`;
      return `[${parts.map(p => `${p.open}${p.text}</a>`).join('; ')}]`;
    },
  };

  const sidenoteDef = {
    name: 'sidenoteDef', level: 'block',
    start(src) { const m = /^\[\^[\w-]+\]:/m.exec(src); return m ? m.index : undefined; },
    tokenizer(src) {
      const m = /^\[\^([\w-]+)\]:[ \t]*(.*(?:\n[ \t]+\S.*)*)(?:\n|$)/.exec(src);
      if (!m) return;
      if (sidenotes.defs.has(m[1])) warn(`sidenote ${m[1]} defined twice${at(lineOf(src))}, keeping the first`);
      else sidenotes.defs.set(m[1], this.lexer.inline(m[2].replace(/\n[ \t]+/g, '\n').trim(), []));
      return { type: 'sidenoteDef', raw: m[0], id: m[1] };
    },
    renderer() { return ''; },
  };

  const sidenoteRef = {
    name: 'sidenoteRef', level: 'inline',
    start(src) { const i = src.indexOf('[^'); return i < 0 ? undefined : i; },
    tokenizer(src) {
      const m = /^\[\^([\w-]+)\]/.exec(src);
      if (m) return { type: 'sidenoteRef', raw: m[0], id: m[1] };
    },
    renderer(t) {
      if (inToc) return '';
      const body = sidenotes.defs.get(t.id);
      if (body === undefined) { warn(`sidenote ${t.id} has no definition`); return '<span class="sn-ref bad">[?]</span>'; }
      if (sidenotes.nums.has(t.id)) return `<span class="sn-ref">[${sidenotes.nums.get(t.id)}]</span>`; // later mentions: mark only
      const n = sidenotes.nums.size + 1;
      sidenotes.nums.set(t.id, n);
      return `<span class="sn"><span class="sn-ref">[${n}]</span><span class="sn-note"><span class="sn-num">[${n}]</span>${this.parser.parseInline(body)}</span></span>`;
    },
  };

  // ---------------------------------------------------------------------------

  const md = new Marked({
    extensions: [container, containerStray, thmHead, qed, displayMath, sidenoteDef, math, shortcode, cite, sidenoteRef, ref],
    hooks: {
      // keep the `_` and `*` inside math out of emphasis matching
      emStrongMask(src) { return src.replace(ANY_MATH, m => 'a'.repeat(m.length)); },
    },
    renderer: {
      image(token) {
        if (inToc) return esc(token.text ?? '');
        return Renderer.prototype.image.call(this, { ...token, href: resolveImage(token.href) });
      },
      // numbered headings with ids; the table of contents gets a copy without links or notes
      heading(t) {
        const { num, id } = numberHeading(t);
        const text = this.parser.parseInline(t.tokens);
        if (t.depth <= 2) {
          inToc = true;
          try { headings.push({ depth: t.depth, num, text: this.parser.parseInline(t.tokens), id }); }
          finally { inToc = false; }
        }
        return `<h${t.depth} id="${id}">${num ? `<span class="secno">${num}</span>` : ''}${text}</h${t.depth}>\n`;
      },
      // a bare URL stays as written: its -- is not a dash. In the table of contents, text only.
      link(t) {
        if (inToc) return this.parser.parseInline(t.tokens);
        if (t.href === t.text || t.href === `mailto:${t.text}` || t.href === `http://${t.text}`) {
          for (const child of t.tokens ?? []) if (child.type === 'text') child.plain = true;
        }
        return false;
      },
      // fenced blocks whose language a plugin registered
      code({ text, lang }) {
        const f = fenceTable[(lang || '').trim().split(/\s+/)[0]];
        if (!f) return false;
        const html = attempt(() => f(text, ctx));
        return typeof html === 'string' ? html : false;
      },
      // HTML comments: offered to the plugins, otherwise dropped. Other HTML passes through.
      html({ text }) {
        if (!text.includes('<!--')) return false;
        if (inToc) return '';
        const out = text.replace(/<!--([\s\S]*?)-->/g, (all, body) => {
          for (const h of comments) { const r = attempt(() => h(body, ctx)); if (typeof r === 'string') return r; }
          return '';
        });
        return out.trim() ? out : '';
      },
      // a cell's content is trimmed (a dropped comment may leave a space behind)
      tablecell(token) {
        const content = this.parser.parseInline(token.tokens).trim();
        const tag = token.header ? 'th' : 'td';
        const align = token.align ? ` align="${token.align}"` : '';
        return `<${tag}${align}>${content}</${tag}>\n`;
      },
      // prose gets TeX-style dashes; code and math never reach here
      text(t) {
        if ('tokens' in t && t.tokens) return false;
        const s = 'escaped' in t && t.escaped ? t.text : escText(t.text);
        return t.plain ? s : dashes(s);
      },
    },
  });

  /** Lex a document. `line` is the source line its first line is on (after front matter). */
  function lex(s, { line = 1 } = {}) {
    const text = escapeTableMath(s.replace(/\r\n?/g, '\n'));
    units.push({ kind: null, base: line, text, cursor: 0 });
    try {
      const tokens = md.lexer(text);
      numberHeadings(tokens);
      return tokens;
    } finally { units.pop(); }
  }

  return {
    lex,
    render: tokens => md.parser(tokens),
    /** Lex and render. */
    parse: (s, options) => md.parser(lex(s, options)),
    parseInline: s => md.parseInline(s),
    uniqueId,
    labels, headings, sidenotes, cited,
    get aiDrafts() { return aiDrafts; },
    /** Warnings that need the whole document rendered. */
    finish() {
      for (const id of sidenotes.defs.keys()) if (!sidenotes.nums.has(id)) warn(`sidenote ${id} is never referenced`);
    },
  };
}
