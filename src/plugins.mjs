// Plugin discovery. A plugin is one `*.mjs` file in the paper's plugin folder, in the
// spirit of Hugo's shortcodes: the author writes `pat:1011` in the paper and the
// plugin says what that means. A plugin may export any of these, by name:
//
//   spans     { prefix: (arg, ctx) => html }        code span `prefix:arg`
//   fences    { lang: (body, ctx) => html }         fenced block ```lang
//   blocks    { kind: { label?, figure?, caption?, lex?, render } }   a `::: kind … :::` block;
//                                                   the interface is BLOCK KINDS in render.mjs
//   comments  (body, ctx) => html | undefined       an HTML comment `<!-- body -->`; return
//                                                   undefined to leave it to the next plugin
//   browser   ['./file.js', …]                      scripts inlined into the page, in order
//                                                   (a top-level `export` keyword is stripped, so one
//                                                   file can serve both the build and the page)
//   styles    ['./file.css', …]                     stylesheets inlined after the paper's own
//   order     number, default 0                     load order (then by file name); a plugin whose
//                                                   browser script needs another's goes later
//
// Every function receives `ctx`: { config, flags, warn, esc, plugins }. A function that throws,
// or isn't one, produces a warning naming the plugin; the page falls back to showing the source.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HOOKS = ['spans', 'fences', 'blocks', 'comments', 'browser', 'styles', 'order'];

// What stands in for a block kind whose `lex` or `render` failed: it reads and shows as markdown.
const relex = (body, t, api) => { t.tokens = []; t.rows = []; api.block(body, t.tokens); };
const plain = (t, api) => api.div(t, api.parse(t.tokens));

/** Where in `file` an error happened, as ` line n`, read from its stack; '' if it doesn't say. */
export function locate(error, file) {
  const stack = String(error?.stack ?? ''), tail = `/${path.basename(file)}:`, i = stack.indexOf(tail);
  const line = i < 0 ? NaN : parseInt(stack.slice(i + tail.length), 10);
  return line ? ` line ${line}` : '';
}

export async function loadPlugins(dir, warn) {
  if (!dir || !fs.existsSync(dir)) return [];
  const plugins = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.mjs')).sort()) {
    const file = path.join(dir, f);
    const name = f.replace(/\.mjs$/, '');
    try {
      const hooks = await import(pathToFileURL(file).href);
      if (!HOOKS.some(hook => hook in hooks)) warn(`plugin ${name}: exports none of ${HOOKS.join(', ')}, by name`);
      plugins.push({ ...hooks, name, file, dir, order: hooks.order ?? 0 });
    } catch (e) {
      warn(`plugin ${name}${locate(e, file)}: ${e.message}`);
    }
  }
  return plugins.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/** Merge what the plugins export into the hook tables the renderer and the page use. */
export function collect(plugins, warn) {
  const spans = {}, fences = {}, blocks = {}, comments = [], browser = [], styles = [];
  const owner = {};
  const claim = (table, key, value, p, what) => {
    if (owner[what + key]) warn(`${what} ${key}: plugin ${p.name} overrides ${owner[what + key]}`);
    owner[what + key] = p.name;
    table[key] = value;
  };
  for (const p of plugins) {
    // A failure says whose it is, and the fallback stands in; running out of stack isn't the plugin's doing.
    const guard = (fn, where, self, fallback) => (...args) => {
      try { return fn.apply(self, args); }
      catch (e) {
        if (e instanceof RangeError) throw e;
        warn(`plugin ${p.name}, ${where}${locate(e, p.file)}: ${typeof fn === 'function' ? e?.message ?? e : 'not a function'}`);
        return fallback?.(...args);
      }
    };
    for (const [k, fn] of Object.entries(p.spans ?? {})) {
      if (k.includes(':')) warn(`plugin ${p.name}: span prefix ${k} can't contain a colon`);
      claim(spans, k, guard(fn, `span ${k}`, p), p, 'span prefix');
    }
    for (const [k, fn] of Object.entries(p.fences ?? {})) claim(fences, k, guard(fn, `fence ${k}`, p), p, 'fence');
    for (const [k, def] of Object.entries(p.blocks ?? {})) {
      claim(blocks, k, { ...def, render: guard(def?.render, `block ${k}`, def, plain), lex: def?.lex && guard(def.lex, `block ${k}`, def, relex) }, p, 'block kind');
    }
    if (p.comments) comments.push(guard(p.comments, 'comments', p));
    for (const f of p.browser ?? []) browser.push(path.resolve(p.dir, f));
    for (const f of p.styles ?? []) styles.push(path.resolve(p.dir, f));
  }
  return { spans, fences, blocks, comments, browser, styles };
}
