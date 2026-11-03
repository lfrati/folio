// The `---` block at the top of a document: one `key: value` per line, and nothing else of YAML.
//
//   title: A title with $math$       plain, "double" or 'single' quoted
//   author: Ada Lovelace, Alan Turing
//   abstract: One paragraph.         a longer one is a `::: abstract` block in the text
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

/** Split a document into its front matter and body. `line` is the source line the body starts on;
 *  `lines` holds the source line of each key. A leading `---` that doesn't introduce `key:` lines is
 *  ordinary Markdown, a rule, and left alone. */
export function frontMatter(text, warn = () => {}) {
  const m = /^---[ \t]*\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n|$)/.exec(text);
  const source = (m?.[1] ?? '').split('\n');
  const first = source.find(line => line.trim() && !isComment(line));
  if (!m || (first !== undefined && !/^[\w-]+[ \t]*:/.test(first))) return { meta: {}, lines: {}, body: text, line: 1 };

  const meta = {}, lines = {};
  source.forEach((entry, i) => {
    if (!entry.trim() || isComment(entry)) return;
    const no = i + 2;
    const kv = /^([\w-]+)[ \t]*:[ \t]*(.*?)[ \t]*$/.exec(entry);
    if (!kv) warn(`front matter line ${no}: cannot read "${entry.trim()}"; a value stays on one line, and a long abstract is a ::: abstract block`);
    else if (!KNOWN.includes(kv[1])) warn(`front matter line ${no}: unknown key ${kv[1]}; Folio reads ${KNOWN.join(', ')}`);
    else if (/^(?:[|>][+-]?\d*[+-]?|\[.*\])$/.test(kv[2])) warn(`front matter line ${no}: ${kv[1]}: a value stays on one line, as in author: A, B`);
    else { meta[kv[1]] = unquote(kv[2]); lines[kv[1]] = no; }
  });
  return { meta, lines, body: text.slice(m[0].length), line: m[0].split('\n').length };
}
