// Build a paper: markdown source -> one self-contained HTML page.
//
//   import { run } from '@lfrati/folio';
//   run(new URL('./paper.config.mjs', import.meta.url), process.argv.slice(2));
//
// The config names the files and the theorem kinds (see paper.config.mjs); the
// dialect lives in render.mjs, paper-specific constructs in the plugin folder.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRenderer, esc } from './render.mjs';
import { loadBib, renderBibliography } from './bib.mjs';
import { loadPlugins, collect } from './plugins.mjs';
import { katexCss, bundleScripts, readAll, imageResolver } from './assets.mjs';

const ENGINE_DIR = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = fileURLToPath(new URL('../assets/', import.meta.url));
const CLI_FILE = fileURLToPath(new URL('../bin/folio.mjs', import.meta.url));

const DEFAULTS = { src: 'paper.md', out: 'paper.html', style: null, bib: 'refs.bib', plugins: 'plugins', kinds: {}, theme: true, navigation: true };

function configURL(value) {
  if (value instanceof URL) return value;
  return value.startsWith('file:') ? new URL(value) : pathToFileURL(path.resolve(value));
}

/** Load a config module; relative paths in it are resolved against its own folder. */
export async function loadConfig(configUrl) {
  const url = configURL(configUrl);
  const dir = path.dirname(fileURLToPath(url));
  const c = { ...DEFAULTS, ...(await import(url)).default };
  const abs = f => (f ? path.resolve(dir, f) : f);
  return { ...c, dir, src: abs(c.src), out: abs(c.out), style: abs(c.style), bib: abs(c.bib), plugins: abs(c.plugins) };
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

/** A leading `---` block of `key: value` lines. `line` is the source line the body starts on. */
function frontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const meta = {};
  if (!m) return { meta, body: text, line: 1 };
  for (const line of m[1].split('\n')) {
    const kv = /^(\w+)\s*:\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: text.slice(m[0].length), line: m[0].split('\n').length };
}

/** Build once and write the page to config.out. Returns { html, warnings, ms, dependencies }. */
export async function build(config, flags = {}) {
  const result = await render(config, flags);
  fs.mkdirSync(path.dirname(config.out), { recursive: true });
  fs.writeFileSync(config.out, result.html);
  return result;
}

/** Render the page without writing it. Returns { html, warnings, ms, dependencies }. */
export async function render(config, flags = {}) {
  const t0 = performance.now();
  const warnings = [];
  const warn = msg => warnings.push(msg);

  const plugins = await loadPlugins(config.plugins, warn);
  const hooks = collect(plugins, warn);
  const ctx = { config, flags, warn, esc, plugins };
  const bib = loadBib(config.bib);
  const images = imageResolver(config.src, warn);
  const R = createRenderer({ warn, kinds: config.kinds, bib, ...hooks, ctx, resolveImage: images.resolve });

  const { meta, body, line } = frontMatter(fs.readFileSync(config.src, 'utf8'));
  const article = R.parse(body, { line });
  const bibliography = renderBibliography(bib, R.cited, R.parseInline);
  if (bibliography) R.headings.push({ depth: 1, num: '', text: 'References', id: 'sec-references' });
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

  const date = new Date().toISOString().slice(0, 10);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title || 'Untitled')}</title>
<style>
${katexCss(warn)}
${readAll(styles)}
</style>
</head>
<body>
${toc}
<main>
<header class="title">
<h1>${R.parseInline(meta.title || 'Untitled')}</h1>
<div class="author">${esc(meta.author || '')}</div>
<div class="date">${date}</div>
</header>
${meta.abstract ? `<div class="abstract"><p>${R.parseInline(meta.abstract)}</p></div>` : ''}
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
  return { html, warnings, ms: performance.now() - t0, dependencies };
}

/** Command line entry: build once, or `--watch` and rebuild on every change. */
export async function run(configUrl, argv = []) {
  const config = await loadConfig(configUrl);
  if (argv.includes('--watch')) return watch(configURL(configUrl), config, argv);
  const { html, warnings, ms, dependencies } = await build(config, parseFlags(argv));
  if (process.env.FOLIO_WATCH_REPORT_FD === '3') {
    fs.writeFileSync(3, JSON.stringify({ out: config.out, directories: [config.dir, config.plugins,
      ...dependencies.map(file => path.dirname(file)),
    ].filter(Boolean) }));
  }
  console.log(`[${new Date().toLocaleTimeString()}] wrote ${path.basename(config.out)} (${(html.length / 1024).toFixed(0)} KB, ${ms.toFixed(0)} ms)`);
  for (const w of warnings) console.log(`  warning: ${w}`);
  process.exitCode = warnings.length ? 1 : 0;
}

function watch(configUrl, config, argv) {
  // A fresh child loads config/plugins on every build. A private pipe reports the
  // directories containing actual inputs, including images outside the project.
  const args = argv.filter(a => a !== '--watch');
  const watchers = new Map();
  let timer = null, out = config.out;
  const trigger = (dir, file) => {
    if (file && path.resolve(dir, file) === out) return;
    clearTimeout(timer);
    timer = setTimeout(rebuild, 80);
  };
  const update = directories => {
    const dirs = new Set([config.dir, ENGINE_DIR, ASSETS_DIR, ...directories].filter(Boolean).map(dir => {
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
    const child = spawnSync(process.execPath, [CLI_FILE, fileURLToPath(configUrl), ...args], {
      stdio: ['ignore', 'inherit', 'inherit', 'pipe'],
      env: { ...process.env, FOLIO_WATCH_REPORT_FD: '3' },
    });
    const report = child.output?.[3]?.toString();
    if (report) {
      const inputs = JSON.parse(report);
      out = inputs.out;
      update(inputs.directories);
    }
  }
  update([config.plugins, path.dirname(config.src)]);
  rebuild();
  console.log(`watching ${[...watchers.keys()].map(dir => path.relative(config.dir, dir) || '.').join(', ')} … (Ctrl-C to stop)`);
}
