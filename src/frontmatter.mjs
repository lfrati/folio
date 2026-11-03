// The `---` block at the top of a document: the small part of YAML a paper's title page needs.
//
//   title: A title with $math$       plain, "double" or 'single' quoted
//   author: [Ada Lovelace, Alan Turing]     or a `- item` list on the following lines
//   abstract: |                      `|` keeps lines and `>` folds them; blank lines separate paragraphs
//     First paragraph.
//   date:                            empty hides the date; absent means today
//   lang: en
//
// Only whole lines are comments: `title: Issue #5` means what it says.

const KNOWN = ['title', 'author', 'authors', 'abstract', 'date', 'lang'];

const isComment = line => /^\s*#/.test(line);

function unquote(s) {
  if (s.length >= 2 && s[0] === '"' && s.endsWith('"')) return s.slice(1, -1).replace(/\\(["\\nt])/g, (all, c) => ({ n: '\n', t: '\t' })[c] ?? c);
  if (s.length >= 2 && s[0] === "'" && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

const flowList = s => (s.match(/\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^,]+)/g) ?? []).map(item => unquote(item.trim())).filter(Boolean);

function blockScalar(lines, style) {
  const filled = lines.filter(line => line.trim());
  const indent = Math.min(...filled.map(line => /^[ \t]*/.exec(line)[0].length));
  const text = lines.map(line => line.slice(indent)).join('\n').trim();
  return style === '|' ? text : text.replace(/([^\n])\n(?!\n)/g, '$1 ');
}

/** Split a document into its front matter and body. `line` is the source line the body starts on;
 *  `lines` holds the source line of each key. A leading `---` that doesn't introduce `key:` lines is
 *  ordinary Markdown, a rule, and left alone. */
export function frontMatter(text, warn = () => {}) {
  const none = { meta: {}, lines: {}, body: text, line: 1 };
  const m = /^---[ \t]*\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/.exec(text);
  if (!m) return none;
  const source = (m[1] ?? '').split('\n');
  const first = source.find(line => line.trim() && !isComment(line));
  if (first !== undefined && !/^[\w-]+[ \t]*:/.test(first)) return none;

  const meta = {}, lines = {};
  for (let i = 0; i < source.length; i++) {
    if (!source[i].trim() || isComment(source[i])) continue;
    const no = i + 2;
    const kv = /^([\w-]+)[ \t]*:[ \t]*(.*?)[ \t]*$/.exec(source[i]);
    if (!kv) { warn(`front matter line ${no}: cannot read "${source[i].trim()}"`); continue; }
    const [, key, raw] = kv;
    let end = i + 1;
    while (end < source.length && (!source[end].trim() || /^[ \t]/.test(source[end]) || /^-(?:\s|$)/.test(source[end]))) end++;
    const following = source.slice(i + 1, end);
    i = end - 1;
    const content = following.filter(line => line.trim() && !isComment(line));
    let value;
    const block = /^([|>])[+-]?\d*[+-]?$/.exec(raw);
    if (block) value = blockScalar(following, block[1]);
    else if (!raw && content.length && content.every(line => /^\s*-(?:\s|$)/.test(line))) value = content.map(line => unquote(line.replace(/^\s*-\s*/, '').trim()));
    else if (/^\[.*\]$/.test(raw) && !content.length) value = flowList(raw.slice(1, -1));
    else value = unquote([raw, ...content.map(line => line.trim())].join(' ').trim());
    if (!KNOWN.includes(key)) { warn(`front matter line ${no}: unknown key ${key}; Folio reads ${KNOWN.join(', ')}`); continue; }
    meta[key] = Array.isArray(value) ? value.join(', ') : value;
    lines[key] = block ? no + 1 : no;
  }
  return { meta, lines, body: text.slice(m[0].length), line: m[0].split('\n').length };
}
