// Plugin discovery. A plugin is one `*.mjs` file in the paper's plugin folder, in the
// spirit of Hugo's shortcodes: the author writes `pat:1011` in the paper and the
// plugin says what that means. A plugin may export any of (by name, or together as
// `export default { … }`):
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
// Every function receives `ctx`: { config, flags, warn, esc, plugins }. A function that throws
// produces a warning naming the plugin; the page falls back to showing the source.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Probably meant one of the hooks: other exports are allowed, a plugin may share helpers.
const NEAR_MISSES = { span: 'spans', fence: 'fences', block: 'blocks', comment: 'comments', style: 'styles', script: 'browser', scripts: 'browser' };
const HOOKS = ['spans', 'fences', 'blocks', 'comments', 'browser', 'styles', 'order'];

/** Where in `file` an error happened, as ` line n`, read from its stack; '' if it doesn't say. */
export function locate(error, file) {
  const quote = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:${quote(pathToFileURL(file).href)}|${quote(file)}):(\\d+)`).exec(String(error?.stack ?? ''));
  return m ? ` line ${m[1]}` : '';
}

export async function loadPlugins(dir, warn) {
  if (!dir || !fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.mjs')).sort();
  const plugins = [];
  for (const f of files) {
    const file = path.join(dir, f);
    const name = f.replace(/\.mjs$/, '');
    try {
      const { default: merged, ...named } = await import(pathToFileURL(file).href);
      const isObject = merged !== null && typeof merged === 'object';
      if (merged !== undefined && !isObject) warn(`plugin ${name}: export default must be an object of hooks`);
      const hooks = isObject ? { ...merged, ...named } : named;
      for (const [wrong, right] of Object.entries(NEAR_MISSES)) if (wrong in hooks) warn(`plugin ${name}: exports ${wrong}; did you mean ${right}?`);
      if (!HOOKS.some(hook => hook in hooks)) warn(`plugin ${name}: exports none of ${HOOKS.join(', ')}`);
      if (hooks.order !== undefined && !Number.isFinite(hooks.order)) warn(`plugin ${name}: order must be a number`);
      plugins.push({ ...hooks, name, file, dir, order: Number.isFinite(hooks.order) ? hooks.order : 0 });
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
    // an error from plugin code says whose it is
    const named = (fn, where, self) => (...args) => {
      try { return fn.apply(self, args); }
      catch (e) { throw new Error(`plugin ${p.name}, ${where}${locate(e, p.file)}: ${e?.message ?? e}`, { cause: e }); }
    };
    const entries = (hook, what) => {
      const value = p[hook];
      if (value === undefined) return [];
      if (value === null || typeof value !== 'object' || Array.isArray(value)) { warn(`plugin ${p.name}: ${hook} must be an object of ${what}`); return []; }
      return Object.entries(value);
    };
    const files = hook => {
      if (p[hook] === undefined) return [];
      if (Array.isArray(p[hook]) && p[hook].every(f => typeof f === 'string')) return p[hook].map(f => path.resolve(p.dir, f));
      warn(`plugin ${p.name}: ${hook} must be a list of files`);
      return [];
    };
    for (const [k, fn] of entries('spans', 'functions')) {
      if (typeof fn === 'function') claim(spans, k, named(fn, `span ${k}`, p), p, 'span prefix');
      else warn(`plugin ${p.name}: span ${k} must be a function`);
    }
    for (const [k, fn] of entries('fences', 'functions')) {
      if (typeof fn === 'function') claim(fences, k, named(fn, `fence ${k}`, p), p, 'fence');
      else warn(`plugin ${p.name}: fence ${k} must be a function`);
    }
    for (const [k, def] of entries('blocks', 'block kinds')) {
      if (typeof def?.render !== 'function' || (def.lex !== undefined && typeof def.lex !== 'function')) {
        warn(`plugin ${p.name}: block ${k} must be an object with a render function, as in ${k}: { render(t, api) { … } }`);
        continue;
      }
      const wrapped = { ...def, render: named(def.render, `block ${k}`, def) };
      if (def.lex) wrapped.lex = named(def.lex, `block ${k}`, def);
      claim(blocks, k, wrapped, p, 'block kind');
    }
    if (typeof p.comments === 'function') comments.push(named(p.comments, 'comments', p));
    else if (p.comments !== undefined) warn(`plugin ${p.name}: comments must be a function`);
    browser.push(...files('browser'));
    styles.push(...files('styles'));
  }
  return { spans, fences, blocks, comments, browser, styles };
}
