// Build a paper: markdown source -> one self-contained HTML page.
//
//   import { run } from '@lfrati/folio';
//   run(new URL('./paper.config.mjs', import.meta.url), process.argv.slice(2));
//
// The config names the files and the theorem kinds (see paper.config.mjs); the
// dialect lives in render.mjs, paper-specific constructs in the plugin folder.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRenderer, esc } from './render.mjs';
import { parseBib, renderBibliography } from './bib.mjs';
import { frontMatter } from './frontmatter.mjs';
import { loadPlugins, collect, locate } from './plugins.mjs';
import { katexCss, bundleScripts, readAll, imageResolver } from './assets.mjs';

const ENGINE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = fileURLToPath(new URL('../assets/', import.meta.url));
const CLI_FILE = fileURLToPath(new URL('../bin/folio.mjs', import.meta.url));

const DEFAULTS = { src: 'paper.md', out: 'paper.html', style: null, bib: 'refs.bib', plugins: 'plugins', kinds: {}, macros: {}, theme: true, navigation: true };

function configURL(value) {
  if (value instanceof URL) return value;
  return value.startsWith('file:') ? new URL(value) : pathToFileURL(path.resolve(value));
}

/** A text file as the rest of the engine expects it: no byte-order mark, \n line ends. */
function readText(file) {
  const text = fs.readFileSync(file, 'utf8');
  return (text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text).replace(/\r\n?/g, '\n');
}

/** Load a config module; relative paths in it are resolved against its own folder. */
export async function loadConfig(configUrl) {
  const url = configURL(configUrl);
  const configFile = fileURLToPath(url);
  const dir = path.dirname(configFile);
  const name = path.basename(configFile);
  if (!fs.existsSync(configFile)) throw new Error(`config file not found: ${configFile}. "folio init" creates a project with one.`);
  let module;
  try { module = await import(url); }
  catch (error) { throw new Error(`${name}${locate(error, configFile)}: ${error.message}`, { cause: error }); }
  const own = module.default;
  if (own === null || typeof own !== 'object') throw new Error(`${name}: expected export default { src: 'paper.md', … }`);
  const c = { ...DEFAULTS, ...own };
  for (const key of ['src', 'out', 'style', 'bib', 'plugins']) {
    if (c[key] && typeof c[key] !== 'string') throw new Error(`${name}: ${key} must be one path, as a string`);
  }
  if (!c.src || !c.out) throw new Error(`${name}: ${c.src ? 'out' : 'src'} must be a path`);
  const abs = f => (f ? path.resolve(dir, f) : f);
  return { ...c, configFile, dir, src: abs(c.src), out: abs(c.out), style: abs(c.style), bib: abs(c.bib), plugins: abs(c.plugins) };
}

/** `--flag` and `--key=value` from argv, as an object. */
export function parseFlags(argv) {
  const flags = {};
  for (const a of argv) {
    const m = /^--([\w-]+)(?:=(.*))?$/.exec(a);
    if (m) flags[m[1]] = m[2] ?? true;
  }
  return flags;
}

/** The real path of a file that may not exist yet. */
function realPath(file) {
  try { return fs.realpathSync(file); } catch { /* not there yet */ }
  try { return path.join(fs.realpathSync(path.dirname(file)), path.basename(file)); } catch { return path.resolve(file); }
}

/** Build once and write the page to config.out. Returns { html, warnings, ms, dependencies, aiDrafts }. */
export async function build(config, flags = {}) {
  const result = await render(config, flags);
  const out = realPath(config.out);
  const input = [config.configFile, ...result.dependencies].filter(Boolean).find(file => realPath(file) === out);
  if (input) throw new Error(`out would overwrite an input: ${input}. Point out at a new .html file.`);
  fs.mkdirSync(path.dirname(config.out), { recursive: true });
  fs.writeFileSync(config.out, result.html);
  return result;
}

/** Render the page without writing it. Returns { html, warnings, ms, dependencies, aiDrafts }. */
export async function render(config, flags = {}) {
  const t0 = performance.now();
  const warnings = new Set();
  const warn = msg => warnings.add(msg);

  const plugins = await loadPlugins(config.plugins, warn);
  const hooks = collect(plugins, warn);
  const ctx = { config, flags, warn, esc, plugins };
  const bib = config.bib && fs.existsSync(config.bib) ? parseBib(readText(config.bib), warn) : new Map();
  const images = imageResolver(config.src, warn);
  const R = createRenderer({ warn, kinds: config.kinds, macros: config.macros, bib, ...hooks, ctx, resolveImage: images.resolve });

  if (!fs.existsSync(config.src)) throw new Error(`source file not found: ${config.src}`);
  const { meta, lines, body, line } = frontMatter(readText(config.src), warn);
  // Numbers and labels first, then everything in reading order, so that references work
  // in both directions and the notes of an abstract come before those of the text.
  const tokens = R.lex(body, { line });
  const title = meta.title || 'Untitled';
  const author = meta.author || meta.authors;
  const date = 'date' in meta ? meta.date : new Date().toISOString().slice(0, 10);
  const heading = R.parseInline(title);
  const abstract = meta.abstract ? `<div class="abstract">${R.parse(meta.abstract, { line: lines.abstract })}</div>` : '';
  const article = R.render(tokens);
  const referencesId = R.uniqueId('sec-references');
  const bibliography = renderBibliography(bib, R.cited, R.parseInline, { id: referencesId, warn });
  if (bibliography) R.headings.push({ depth: 1, num: '', text: 'References', id: referencesId });
  R.finish();
  const toc = `<nav class="toc"><ul>${R.headings.map(h =>
    `<li class="d${h.depth}"><a href="#${h.id}">${h.num ? `<span class="secno">${h.num}</span>` : ''}${h.text}</a></li>`).join('')}</ul></nav>`;

  const styles = [
    ...(config.theme === false ? [] : [path.join(ASSETS_DIR, 'theme.css')]),
    ...(config.navigation === false ? [] : [path.join(ASSETS_DIR, 'navigation.css')]),
    ...(config.style ? [config.style] : []),
    ...hooks.styles,
  ];
  const scripts = [
    ...(config.navigation === false ? [] : [path.join(ASSETS_DIR, 'navigation.js')]),
    ...hooks.browser,
  ];

  const html = `<!doctype html>
<html lang="${esc(meta.lang || 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
${katexCss(warn)}
${readAll(styles, warn)}
</style>
</head>
<body>
${toc}
<main>
<header class="title">
<h1>${heading}</h1>
${author ? `<div class="author">${esc(author)}</div>\n` : ''}${date ? `<div class="date">${esc(date)}</div>\n` : ''}</header>
${abstract}
${article}
${bibliography}
</main>
<script>
${bundleScripts(scripts, warn)}
</script>
</body>
</html>
`;
  const dependencies = [...new Set([config.src, config.style, config.bib,
    ...plugins.map(plugin => plugin.file), ...styles, ...scripts, ...images.files,
  ].filter(Boolean))];
  return { html, warnings: [...warnings], ms: performance.now() - t0, dependencies, aiDrafts: R.aiDrafts };
}

/** Command line entry: build once, or `--watch` and rebuild on every change. */
export async function run(configUrl, argv = []) {
  for (const a of argv) {
    if (/^--w[watch]{3,5}$/i.test(a) && a !== '--watch') console.error(`folio: did you mean --watch? ${a} is only passed to plugins.`);
  }
  const config = await loadConfig(configUrl);
  if (argv.includes('--watch')) return watch(configURL(configUrl), config, argv);
  const { html, warnings, ms, dependencies, aiDrafts } = await build(config, parseFlags(argv));
  if (process.env.FOLIO_WATCH_REPORT_FD === '3') {
    fs.writeFileSync(3, JSON.stringify({
      out: config.out,
      files: [config.configFile, ...dependencies],
      directories: [config.dir, config.plugins, ...dependencies.map(file => path.dirname(file))].filter(Boolean),
    }));
  }
  const pending = aiDrafts ? `, ${aiDrafts} AI draft${aiDrafts === 1 ? '' : 's'} pending` : '';
  console.log(`[${new Date().toLocaleTimeString()}] wrote ${path.basename(config.out)} (${(html.length / 1024).toFixed(0)} KB, ${ms.toFixed(0)} ms${pending})`);
  for (const w of warnings) console.log(`  warning: ${w}`);
  process.exitCode = warnings.length ? 1 : 0;
}

function watch(configUrl, config, argv) {
  // A fresh child loads config/plugins on every build. A private pipe reports the inputs and
  // the directories containing them, including images outside the project.
  const args = argv.filter(a => a !== '--watch');
  const watchers = new Map();
  let timer = null, out = config.out;
  let inputs = new Set();     // what the last build read
  let before = new Map();     // what those files contained when it started
  let started = 0, finished = 0;
  const digest = file => {
    try { return createHash('sha1').update(fs.readFileSync(file)).digest('base64'); } catch { return null; }
  };
  // Any change beside the paper rebuilds, since a plugin may read files Folio can't know about.
  // A build's own writes must not, or a plugin generating a file would rebuild forever. A file
  // touched during the last build is taken to be its own unless it is an input that really changed.
  const ownWrite = file => {
    let mtime;
    try { mtime = fs.statSync(file).mtimeMs; }
    catch { return !inputs.has(file); } // gone already: an editor's temporary file
    if (mtime < started - 1000 || mtime > finished + 50) return false;
    return !inputs.has(file) || digest(file) === before.get(file);
  };
  const trigger = (dir, file) => {
    if (file) {
      const changed = path.resolve(dir, String(file));
      if (changed === out || ownWrite(changed)) return;
    }
    clearTimeout(timer);
    timer = setTimeout(rebuild, 80);
  };
  const update = directories => {
    const dirs = new Set([config.dir, ENGINE_DIR, ASSETS_DIR, ...directories].filter(Boolean).map(dir => {
      dir = path.resolve(dir);
      while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
      return dir;
    }));
    for (const [dir, watcher] of watchers) {
      if (!dirs.has(dir)) { watcher.close(); watchers.delete(dir); }
    }
    for (const dir of dirs) {
      if (!watchers.has(dir)) watchers.set(dir, fs.watch(dir, (evt, file) => trigger(dir, file)));
    }
  };
  function rebuild() {
    before = new Map([...inputs].map(file => [file, digest(file)]));
    started = Date.now();
    const child = spawnSync(process.execPath, [CLI_FILE, fileURLToPath(configUrl), ...args], {
      stdio: ['ignore', 'inherit', 'inherit', 'pipe'],
      env: { ...process.env, FOLIO_WATCH_REPORT_FD: '3' },
    });
    finished = Date.now();
    const report = child.output?.[3]?.toString();
    if (report) {
      const built = JSON.parse(report);
      out = built.out;
      inputs = new Set(built.files);
      update(built.directories);
    }
  }
  update([config.plugins, path.dirname(config.src)]);
  rebuild();
  console.log(`watching ${[...watchers.keys()].map(dir => path.relative(config.dir, dir) || '.').join(', ')} … (Ctrl-C to stop)`);
}
