// The markdown dialect, as marked extensions.
//
// Every construct of the dialect is one self-contained extension object: a name, a
// `start` that says where it may begin (so it can interrupt a paragraph), a
// `tokenizer` that reads it off the source, and a `renderer` that turns the token
// into HTML. marked lexes the document once and tries these before its own rules,
// and it protects code blocks and code spans for us, so there is no pass ordering
// to get right and nothing to stash. Numbers (equations, tables, figures, theorem
// kinds) are assigned while lexing, in document order; cross-references resolve
// while rendering, when every label is known, so forward references work.
//
// `::: kind … :::` blocks are dispatched through a registry of block kinds (see
// BLOCK KINDS below). The built-in kinds (proof, table, ralign, lalign), the theorem
// kinds of the config and the kinds a plugin registers all use the same interface.
// Plugins also extend the inline dialect: `spans` (code spans with a registered
// prefix, `pat:1011`), `fences` (fenced blocks with a registered language) and
// `comments` (`<!-- … -->` handlers). See plugins.mjs.

import { Marked } from 'marked';
import katex from 'katex';

/** Escape for attribute values and text we build ourselves. */
export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** marked's own text escaping: entities that are already there are left alone. */
const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escText = s => s.replace(/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, c => ENT[c]);

/** TeX-style dashes in prose: `---` is an em dash, `--` an en dash. */
export const dashes = s => s.replace(/---/g, '—').replace(/--/g, '–');

const countLines = s => { let n = 0; for (let i = s.indexOf('\n'); i >= 0; i = s.indexOf('\n', i + 1)) n++; return n; };

/** `{#id .class key="value"}` after a container opener. */
function parseAttrs(s) {
  const a = { classes: [] };
  const m = /\{([^}]*)\}/.exec(s || '');
  if (!m) return a;
  for (const tok of m[1].match(/#[\w:.-]+|\.[\w-]+|\w+="[^"]*"/g) || []) {
    if (tok[0] === '#') a.id = tok.slice(1);
    else if (tok[0] === '.') a.classes.push(tok.slice(1));
    else { const kv = /^(\w+)="([^"]*)"$/.exec(tok); a[kv[1]] = kv[2]; }
  }
  return a;
}

// Container fences. `::: kind [mod] {attrs}` opens, `:::` closes the innermost block,
// `::: endkind` closes the innermost block of that kind (checked before OPEN, since
// "endwip" is also a word).
const OPEN = /^:::[ \t]*([\w-]+)(?:[ \t]+([\w-]+))?[ \t]*(\{.*\})?[ \t]*$/;
const CLOSE = /^:::[ \t]*$/;
const END = /^:::[ \t]*end([\w-]+)[ \t]*$/;

// ---------------------------------------------------------------------------
// BLOCK KINDS
//
// A block kind says what `::: kind … :::` does:
//   label     'Lemma', 'Table', …: the block is numbered (its own counter per kind) and,
//             with an id, can be cited as "Lemma 3"
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

/** A theorem-like kind: "Name n (title)." at the start of the first paragraph. */
export function theoremKind({ name, style = 'plain' }) {
  return {
    label: name,
    figure: false,
    lex(body, t, api) { t.cls.push('thm', style); api.block(body, t.tokens); },
    render(t, api) { api.head(t, { text: `${name} ${t.n}` }); return api.div(t, api.parse(t.tokens)); },
  };
}

const builtinKinds = {
  proof: {
    figure: false,
    lex(body, t, api) { t.cls.push('thm'); api.block(body, t.tokens); },
    render(t, api) { api.head(t, { text: 'Proof', titleReplaces: true }); api.qed(t); return api.div(t, api.parse(t.tokens)); },
  },
  table: {
    label: 'Table',
    figure: false,
    lex(body, t, api) {
      // the caption line is lifted out (replaced by a blank line, so line numbers stay right)
      const c = /^Caption:[ \t]*(.*)$/m.exec(body);
      if (c) { t.caption = api.inline(c[1].trim()); body = body.slice(0, c.index) + body.slice(c.index + c[0].length); }
      api.block(body, t.tokens);
    },
    render(t, api) {
      const cap = t.caption ? `<figcaption><b>Table ${t.n}:</b> ${api.parseInline(t.caption)}</figcaption>\n` : '';
      return `<figure class="table"${t.attrs.id ? ` id="${t.attrs.id}"` : ''}>\n${api.parse(t.tokens)}${cap}</figure>\n`;
    },
  },
  // rows = non-blank lines, cells split on ' & '; every column right- (resp. left-) aligned
  ralign: { lex: lexRows, render: renderRows },
  lalign: { lex: lexRows, render: renderRows },
};
function lexRows(body, t, api) {
  t.rows = body.split('\n').filter(l => l.trim()).map(l => l.split(/\s+&\s+|^&\s+|\s+&$/).map(c => api.inline(c.trim())));
}
function renderRows(t, api) {
  const ncol = Math.max(0, ...t.rows.map(r => r.length));
  const cells = t.rows.flatMap(r => [...r.map(c => api.parseInline(c)), ...Array(ncol - r.length).fill('')]);
  return api.div(t, cells.map(c => `<span>${c}</span>`).join(''), { style: `grid-template-columns: repeat(${ncol}, auto)`, tight: true });
}

/**
 * Build a renderer for one document.
 *   warn(msg)   collects build warnings
 *   kinds       theorem-like kinds from the config: { lemma: { name: 'Lemma', style: 'plain' }, … }
 *   blocks      block kinds registered by plugins (see BLOCK KINDS)
 *   bib         Map of bibtex entries (see bib.mjs)
 *   spans       { prefix: (arg, ctx) => html }      code spans `prefix:arg`
 *   fences      { lang: (body, ctx) => html }       fenced blocks ```lang
 *   comments    [ (body, ctx) => html | undefined ] HTML comment handlers; unclaimed comments are dropped
 *   ctx         passed through to the plugin functions
 */
export function createRenderer({ warn, kinds = {}, blocks: pluginBlocks = {}, bib = new Map(), spans = {}, fences = {}, comments = [], ctx = {} }) {
  const blocks = { ...builtinKinds };
  for (const [k, v] of Object.entries(kinds)) blocks[k] = theoremKind(v);
  for (const [k, v] of Object.entries(pluginBlocks)) {
    if (blocks[k]) warn(`block kind ${k}: a plugin overrides the ${kinds[k] ? 'configured' : 'built-in'} kind`);
    blocks[k] = v;
  }

  const labels = new Map();                       // id -> { text, n }, filled while lexing
  const counters = { equation: 0, figure: 0 };    // plus one per labelled block kind
  const headings = [];                            // { depth, num, text, id } in document order
  const usedIds = new Set();
  const sec = { h1: 0, h2: 0 };
  const sidenotes = { defs: new Map(), nums: new Map() };
  const cited = new Set();
  // the texts being lexed, innermost last: the document, then each nested block body.
  // `kind` is the enclosing block's kind (null for the document), `base` the line number
  // of the text's first line, `nl` its newline count: a tokenizer holding the remaining
  // source `src` is at line base + nl - newlines(src).
  const units = [];
  const lineOf = src => { const u = units.at(-1); return u ? u.base + u.nl - countLines(src) : 0; };
  const at = line => (line ? ` at line ${line}` : '');

  function tex(src, displayMode, where = '') {
    try {
      return katex.renderToString(src, { displayMode, throwOnError: true, strict: 'ignore' });
    } catch (e) {
      warn(`KaTeX${where}: ${e.message.split('\n')[0]}`);
      return `<span class="katex-error" title="${esc(e.message)}">${esc(src)}</span>`;
    }
  }

  function setLabel(id, text, n, line) {
    if (labels.has(id)) { warn(`duplicate label ${id}${at(line)}, keeping the first`); return; }
    labels.set(id, { text, n });
  }

  // ---------------------------------------------------------------------------
  // Containers

  /** Find where the block opened by `kind` at `line` ends. Returns offsets into src: the
   *  body ends at bodyEnd, the token's raw text at rawEnd (past the closing line, if any). */
  function scan(src, from, kind, line) {
    const stack = [kind];
    let pos = from, ln = line;
    while (pos < src.length) {
      ln++;
      let nl = src.indexOf('\n', pos);
      if (nl < 0) nl = src.length;
      const text = src.slice(pos, nl);
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
      pos = nl + 1;
    }
    if (units.length === 1) warn(`unclosed ::: ${stack.join(' > ')}, opened${at(line)}`);
    return { bodyEnd: src.length, rawEnd: src.length };
  }

  const container = {
    name: 'container', level: 'block',
    childTokens: ['tokens', 'rows', 'caption', 'title'],
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
      if (!open) return;
      const [, kind, mod, attrStr] = open;
      const attrs = parseAttrs(attrStr);
      const { bodyEnd, rawEnd } = scan(src, nl + 1, kind, lineNo);
      let body = src.slice(Math.min(nl + 1, src.length), bodyEnd);
      const def = blocks[kind] || generic;
      const t = {
        type: 'container', raw: src.slice(0, rawEnd), kind, mod, attrs, line: lineNo,
        cls: [kind, mod, ...attrs.classes].filter(Boolean),
        tokens: [], rows: [], caption: null, title: attrs.title ? this.lexer.inline(attrs.title, []) : null,
      };
      if (def.label) {
        t.n = counters[kind] = (counters[kind] || 0) + 1;
        if (attrs.id) setLabel(attrs.id, `${def.label} ${t.n}`, t.n, lineNo);
      } else if (attrs.id?.startsWith('fig:') && def.figure !== false) {
        t.fig = ++counters.figure;
        setLabel(attrs.id, `Fig. ${t.fig}`, t.fig, lineNo);
        // a figure's `Caption:` line is lifted out, as for tables (the line stays blank)
        const c = /^Caption:[ \t]*(.*)$/m.exec(body);
        if (c) { t.caption = this.lexer.inline(c[1].trim(), []); body = body.slice(0, c.index) + body.slice(c.index + c[0].length); }
      }
      const lexer = this.lexer;
      const api = {
        inline: text => lexer.inline(text, []),
        block(text, tokens) {
          const top = lexer.state.top;
          lexer.state.top = true;
          units.push({ kind, base: lineNo + 1, nl: countLines(text) });
          lexer.blockTokens(text, tokens);
          units.pop();
          lexer.state.top = top;
          return tokens;
        },
      };
      (def.lex || ((b, t, api) => api.block(b, t.tokens)))(body, t, api);
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
          const attrs = `class="${t.cls.join(' ')}"${t.attrs.id && !t.fig ? ` id="${t.attrs.id}"` : ''}${style ? ` style="${style}"` : ''}`;
          const div = tight ? `<div ${attrs}>${inner}</div>` : `<div ${attrs}>\n${inner}</div>`;
          if (!t.fig) return `${div}\n`;
          const cap = t.caption ? `<figcaption><b>Fig. ${t.fig}:</b> ${P.parseInline(t.caption)}</figcaption>` : `<span class="figno">Fig. ${t.fig}</span>`;
          return `<figure class="fig${t.caption ? ' captioned' : ''}" id="${t.attrs.id}">${div}${cap}</figure>\n`;
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
      return (blocks[t.kind] || generic).render(t, api);
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
  // Math: $…$ inline, $$ … $$ on its own lines for display; `$$ {#eq:id}` numbers it.

  const displayMath = {
    name: 'displayMath', level: 'block',
    start(src) { const m = /^\$\$[ \t]*$/m.exec(src); return m ? m.index : undefined; },
    tokenizer(src) {
      const m = /^\$\$[ \t]*\n([\s\S]*?)\n\$\$(?:[ \t]*\{#([\w:.-]+)\})?[ \t]*(?:\n|$)/.exec(src);
      if (!m) return;
      const t = { type: 'displayMath', raw: m[0], tex: m[1], id: m[2], line: lineOf(src) };
      if (t.id) { t.n = ++counters.equation; setLabel(t.id, `(${t.n})`, t.n, t.line); }
      return t;
    },
    renderer(t) {
      const k = tex(t.tex, true, at(t.line));
      return t.id ? `<div class="eq" id="${t.id}">${k}<span class="eqno">(${t.n})</span></div>\n` : `<div class="eqd">${k}</div>\n`;
    },
  };

  const math = {
    name: 'math', level: 'inline',
    start(src) { const i = src.indexOf('$'); return i < 0 ? undefined : i; },
    tokenizer(src) {
      const m = /^\$([^$\n]+?)\$/.exec(src);
      if (m) return { type: 'math', raw: m[0], tex: m[1] };
    },
    renderer(t) { return tex(t.tex, false); },
  };

  // ---------------------------------------------------------------------------
  // Code spans with a registered prefix: `pat:1011` → the plugin's HTML.

  const prefixes = Object.keys(spans);
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
      try {
        const html = spans[t.prefix](t.arg, ctx);
        if (typeof html === 'string') return html;
      } catch (e) { warn(e.message); }
      return `<code>${esc(t.text)}</code>`;
    },
  };

  // ---------------------------------------------------------------------------
  // Cross-references @kind:id, citations [@key], sidenotes [^id] … [^id]: body

  const ref = {
    name: 'ref', level: 'inline',
    start(src) { const m = /(^|[^\w@])@[a-z]+:[\w-]/.exec(src); return m ? m.index + m[1].length : undefined; },
    tokenizer(src, tokens) {
      const m = /^@([a-z]+:[\w-]+)/.exec(src);
      if (!m) return;
      const prev = tokens.at(-1);
      if (prev?.type === 'text' && /[\w@]$/.test(prev.raw)) return; // part of a word or an e-mail
      return { type: 'ref', raw: m[0], id: m[1] };
    },
    renderer(t) {
      const l = labels.get(t.id);
      if (!l) { warn(`unresolved reference @${t.id}`); return `<a class="ref bad" href="#${t.id}">??</a>`; }
      return `<a class="ref" href="#${t.id}">${l.text}</a>`;
    },
  };

  const cite = {
    name: 'cite', level: 'inline',
    start(src) { const i = src.indexOf('[@'); return i < 0 ? undefined : i; },
    tokenizer(src) {
      const m = /^\[@([\w:.-]+)\]/.exec(src);
      if (m) return { type: 'cite', raw: m[0], key: m[1] };
    },
    renderer(t) {
      const e = bib.get(t.key);
      if (!e) { warn(`unknown citation ${t.key}`); return '<a class="cite bad">[?]</a>'; }
      cited.add(t.key);
      return `<a class="cite" href="#ref-${t.key}">[${bibLabel(e)}]</a>`;
    },
  };

  const sidenoteDef = {
    name: 'sidenoteDef', level: 'block',
    start(src) { const m = /^\[\^[\w-]+\]:/m.exec(src); return m ? m.index : undefined; },
    tokenizer(src) {
      const m = /^\[\^([\w-]+)\]:[ \t]*(.*)(?:\n|$)/.exec(src);
      if (!m) return;
      if (sidenotes.defs.has(m[1])) warn(`sidenote ${m[1]} defined twice${at(lineOf(src))}, keeping the first`);
      else sidenotes.defs.set(m[1], this.lexer.inline(m[2].trim(), []));
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
      emStrongMask(src) { return src.replace(/\$[^$\n]+?\$/g, m => 'a'.repeat(m.length)); },
    },
    renderer: {
      // numbered headings with ids; `# Title {-}` is unnumbered, as in pandoc
      heading({ tokens, depth }) {
        let text = this.parser.parseInline(tokens);
        let num = '';
        const unnumbered = /\s*\{-\}\s*$/.test(text);
        text = text.replace(/\s*\{-\}\s*$/, '');
        if (!unnumbered) {
          if (depth === 1) { sec.h1++; sec.h2 = 0; num = `${sec.h1}`; }
          else if (depth === 2) { sec.h2++; num = `${sec.h1}.${sec.h2}`; }
        }
        // the id comes from the words alone: math and figures in a heading are left out
        const words = tokens.filter(t => t.type !== 'math' && t.type !== 'shortcode').map(t => t.raw).join('');
        let id = 'sec-' + words.toLowerCase().replace(/\{-\}/g, '').replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (usedIds.has(id)) { let k = 2; while (usedIds.has(`${id}-${k}`)) k++; id = `${id}-${k}`; }
        usedIds.add(id);
        if (depth <= 2) headings.push({ depth, num, text, id });
        return `<h${depth} id="${id}">${num ? `<span class="secno">${num}</span>` : ''}${text}</h${depth}>\n`;
      },
      // fenced blocks whose language a plugin registered
      code({ text, lang }) {
        const f = fences[(lang || '').trim().split(/\s+/)[0]];
        if (!f) return false;
        try { return f(text, ctx); } catch (e) { warn(e.message); return false; }
      },
      // HTML comments: offered to the plugins, otherwise dropped. Other HTML passes through.
      html({ text }) {
        if (!text.includes('<!--')) return false;
        const out = text.replace(/<!--([\s\S]*?)-->/g, (all, body) => {
          for (const h of comments) { const r = h(body, ctx); if (typeof r === 'string') return r; }
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
        return dashes('escaped' in t && t.escaped ? t.text : escText(t.text));
      },
    },
  });

  return {
    /** Render a document. `line` is the source line its first line is on (after front matter). */
    parse(s, { line = 1 } = {}) {
      units.push({ kind: null, base: line, nl: countLines(s) });
      try { return md.parse(s); } finally { units.pop(); }
    },
    parseInline: s => md.parseInline(s),
    labels, headings, sidenotes, cited,
    /** Warnings that need the whole document rendered. */
    finish() {
      for (const id of sidenotes.defs.keys()) if (!sidenotes.nums.has(id)) warn(`sidenote ${id} is never referenced`);
    },
  };
}

/** Citation label: first author's surname, three letters, plus the two-digit year. */
export function bibLabel(e) {
  const surname = (e.author || '?').split(' and ')[0].split(',')[0].trim();
  return `${surname.slice(0, 3)}${(e.year || '').slice(-2)}`;
}
