// Plugin discovery. A plugin is one `*.mjs` file in the paper's plugin folder, in the
// spirit of Hugo's shortcodes: the author writes `pat:1011` in the paper and the
// plugin says what that means. A plugin may export any of:
//
//   spans     { prefix: (arg, ctx) => html }        code span `prefix:arg`
//   fences    { lang: (body, ctx) => html }         fenced block ```lang
//   blocks    { kind: { label?, figure?, lex?, render } }   a `::: kind … :::` block; the
//                                                   interface is BLOCK KINDS in render.mjs
//   comments  (body, ctx) => html | undefined       an HTML comment `<!-- body -->`; return
//                                                   undefined to leave it to the next plugin
//   browser   ['./file.js', …]                      scripts inlined into the page, in order
//                                                   (a top-level `export` keyword is stripped, so one
//                                                   file can serve both the build and the page)
//   styles    ['./file.css', …]                     stylesheets inlined after the paper's own
//   order     number, default 0                     load order (then by file name); a plugin whose
//                                                   browser script needs another's goes later
//
// Every function receives `ctx`: { config, flags, warn, esc, plugins }.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadPlugins(dir, warn) {
  if (!dir || !fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.mjs')).sort();
  const plugins = [];
  for (const f of files) {
    const file = path.join(dir, f);
    try {
      const mod = await import(pathToFileURL(file).href);
      plugins.push({ ...mod, name: f.replace(/\.mjs$/, ''), file, dir, order: mod.order ?? 0 });
    } catch (e) {
      warn(`plugin ${f}: ${e.message}`);
    }
  }
  return plugins.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/** Merge what the plugins export into the hook tables the renderer and the page use. */
export function collect(plugins, warn) {
  const spans = {}, fences = {}, blocks = {}, comments = [], browser = [], styles = [];
  const owner = {};
  const claim = (table, key, fn, p, what) => {
    if (owner[what + key]) warn(`${what} ${key}: plugin ${p.name} overrides ${owner[what + key]}`);
    owner[what + key] = p.name;
    table[key] = fn;
  };
  for (const p of plugins) {
    for (const [k, fn] of Object.entries(p.spans ?? {})) claim(spans, k, fn, p, 'span prefix');
    for (const [k, fn] of Object.entries(p.fences ?? {})) claim(fences, k, fn, p, 'fence');
    for (const [k, def] of Object.entries(p.blocks ?? {})) claim(blocks, k, def, p, 'block kind');
    if (typeof p.comments === 'function') comments.push(p.comments);
    for (const f of p.browser ?? []) browser.push(path.resolve(p.dir, f));
    for (const f of p.styles ?? []) styles.push(path.resolve(p.dir, f));
  }
  return { spans, fences, blocks, comments, browser, styles };
}
