import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Script, createContext } from 'node:vm';
import { loadConfig, build, render } from '@lfrati/folio';
import { createRenderer } from '@lfrati/folio/renderer';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'bin/folio.mjs');

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function document(dir) {
  fs.writeFileSync(path.join(dir, 'paper.md'), `---
title: An unrelated project
---
# Introduction

Math $x^2$, a sidenote[^one], and a reference to @lem:one.

::: lemma {#lem:one}
A numbered statement.
:::

[^one]: A note.
`);
  fs.writeFileSync(path.join(dir, 'paper.config.mjs'), `export default {
    out: 'dist/article.html',
    kinds: { lemma: { name: 'Lemma', style: 'plain' } }
  };`);
  return path.join(dir, 'paper.config.mjs');
}

function command(executable, args, cwd) {
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', timeout: 30000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return result.stdout;
}

test('an external document needs no stylesheet or plugins to build', async t => {
  const dir = temporary(t);
  const configFile = document(dir);
  for (const location of [configFile, pathToFileURL(configFile), pathToFileURL(configFile).href]) {
    const config = await loadConfig(location);
    const result = await build(config);
    assert.deepEqual(result.warnings, []);
    assert.equal(fs.readFileSync(config.out, 'utf8'), result.html);
    assert.ok(result.html.includes('data:font/woff2;base64,'));
    assert.ok(result.html.includes('href="#lem:one">Lemma 1</a>'));
    assert.ok(result.html.includes('.toc a.current'));
    assert.ok(result.html.includes('Cross-reference previews:'));
    assert.ok(result.html.includes('.preview {'));
    assert.doesNotMatch(result.html, /Collatz|binpat|lab-pattern/);
  }
  const renderer = createRenderer({ warn: message => assert.fail(message) });
  assert.match(renderer.parse('**Hello**'), /<strong>Hello<\/strong>/);
});

test('custom theme overrides and navigation opt-out work', async t => {
  const dir = temporary(t);
  const config = await loadConfig(document(dir));
  const style = path.join(dir, 'custom.css');
  fs.writeFileSync(style, 'body { color: purple; }');
  const result = await render({ ...config, style, theme: false, navigation: false });
  assert.deepEqual(result.warnings, []);
  assert.ok(result.html.includes('body { color: purple; }'));
  assert.ok(!result.html.includes('.toc a.current'));
  assert.ok(!result.html.includes('Cross-reference previews:'));
});

test('plugin browser assets execute and unsupported modules produce diagnostics', async t => {
  const dir = temporary(t);
  const config = await loadConfig(document(dir));
  fs.mkdirSync(config.plugins);
  fs.writeFileSync(path.join(config.plugins, 'widget.mjs'), `export const browser = ['./widget.js'];`);
  const scriptFile = path.join(config.plugins, 'widget.js');
  fs.writeFileSync(scriptFile, 'export const answer = 42;\nglobalThis.answer = answer;');
  let result = await render({ ...config, navigation: false });
  assert.deepEqual(result.warnings, []);
  const script = result.html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const context = createContext({});
  new Script(script).runInContext(context);
  assert.equal(context.answer, 42);

  fs.writeFileSync(scriptFile, "import { answer } from './other.js';");
  result = await render({ ...config, navigation: false });
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /browser scripts:.*without imports/);
});

test('the CLI works outside the project and reports failed builds', t => {
  const dir = temporary(t);
  const configFile = document(dir);
  command(process.execPath, [cli, configFile], os.tmpdir());
  assert.ok(fs.existsSync(path.join(dir, 'dist/article.html')));
  command(process.execPath, [cli], dir);
  assert.match(command(process.execPath, [cli, '--help'], dir), /Usage: folio/);

  fs.appendFileSync(path.join(dir, 'paper.md'), '\nSee @lem:missing.\n');
  const result = spawnSync(process.execPath, [cli, configFile], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /unresolved reference @lem:missing/);
});

test('the watcher rebuilds an external document', async t => {
  const dir = temporary(t);
  const configFile = document(dir);
  const images = path.join(dir, 'images', 'nested');
  fs.mkdirSync(images, { recursive: true });
  const imageFile = path.join(images, 'diagram.svg');
  fs.writeFileSync(imageFile, '<svg xmlns="http://www.w3.org/2000/svg"><title>Before</title></svg>');
  fs.appendFileSync(path.join(dir, 'paper.md'), '\n![Diagram](images/nested/diagram.svg)\n');
  const watcher = spawn(process.execPath, [cli, configFile, '--watch'], { cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  watcher.stdout.on('data', data => { output += data; });
  watcher.stderr.on('data', data => { output += data; });
  t.after(async () => {
    if (watcher.exitCode === null) {
      const stopped = new Promise(resolve => watcher.once('exit', resolve));
      watcher.kill();
      await stopped;
    }
  });
  async function until(check) {
    const deadline = Date.now() + 10000;
    while (!check()) {
      assert.equal(watcher.exitCode, null, output);
      assert.ok(Date.now() < deadline, `watcher timed out: ${output}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  await until(() => output.includes('watching '));
  fs.appendFileSync(path.join(dir, 'paper.md'), '\nA change after starting the watcher.\n');
  await until(() => fs.readFileSync(path.join(dir, 'dist/article.html'), 'utf8').includes('A change after starting the watcher.'));
  const updatedImage = '<svg xmlns="http://www.w3.org/2000/svg"><title>After</title></svg>';
  fs.writeFileSync(imageFile, updatedImage);
  await until(() => fs.readFileSync(path.join(dir, 'dist/article.html'), 'utf8').includes(Buffer.from(updatedImage).toString('base64')));
});

test('the packed package installs and builds in a separate project', t => {
  const dir = temporary(t);
  const packed = JSON.parse(command('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', dir], root))[0];
  const files = new Set(packed.files.map(file => file.path));
  for (const file of ['src/index.mjs', 'assets/theme.css', 'assets/navigation.js', 'assets/navigation.css', 'bin/folio.mjs', 'src/init.mjs', 'docs/agents.md', 'docs/dependencies.md', 'npm-shrinkwrap.json', 'examples/showcase/images/triangle.svg']) {
    assert.ok(files.has(file), `package is missing ${file}`);
  }
  assert.ok(!files.has('original-paper.html'));
  assert.ok(!files.has('package-lock.json'));
  assert.ok(![...files].some(file => file.endsWith('.html')), 'built examples should not be packaged');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"private":true,"type":"module"}');
  fs.copyFileSync(path.join(root, '.npmrc'), path.join(dir, '.npmrc'));
  command('npm', ['install', '--prefer-offline', '--ignore-scripts', '--no-audit', '--no-fund', path.join(dir, packed.filename)], dir);
  const reviewedLock = JSON.parse(fs.readFileSync(path.join(root, 'npm-shrinkwrap.json'), 'utf8'));
  const installedRoot = path.join(dir, 'node_modules/@lfrati/folio');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(installedRoot, 'npm-shrinkwrap.json'), 'utf8')), reviewedLock);
  const consumerLock = JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
  const pins = lock => Object.entries(lock.packages)
    .filter(([location]) => location && !location.endsWith('node_modules/@lfrati/folio'))
    .map(([location, info]) => ({ name: location.split('node_modules/').at(-1), version: info.version, integrity: info.integrity }))
    .sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(pins(consumerLock), pins(reviewedLock), 'consumer must install only the reviewed versions and tarballs');
  const configFile = document(dir);
  command(path.join(dir, 'node_modules/.bin/folio'), [configFile], os.tmpdir());
  command(process.execPath, ['--input-type=module', '-e', "import { loadConfig, render } from '@lfrati/folio'; const result = await render(await loadConfig('./paper.config.mjs')); if (result.warnings.length) throw Error(result.warnings.join('\\n'));"], dir);
  const html = fs.readFileSync(path.join(dir, 'dist/article.html'), 'utf8');
  assert.ok(html.includes('An unrelated project') && html.includes('.preview {'));
  const starter = path.join(dir, 'fresh project');
  command(path.join(dir, 'node_modules/.bin/folio'), ['init', starter], dir);
  command('npm', ['install', '--no-save', '--package-lock=false', '--prefer-offline', '--ignore-scripts', '--no-audit', '--no-fund', path.join(dir, packed.filename)], starter);
  command('npm', ['run', 'build'], starter);
  const hello = fs.readFileSync(path.join(starter, 'paper.html'), 'utf8');
  assert.ok(hello.includes('Hello, world! Start writing here.') && hello.includes('class="ai-label">AI draft</p>'));

});

test('the showcase presents every example from a single Markdown source', async () => {
  const config = await loadConfig(new URL('../examples/showcase/paper.config.mjs', import.meta.url));
  const { html, warnings } = await render(config);
  assert.deepEqual(warnings, []);
  assert.equal((html.match(/class="example-source"/g) || []).length, 10);
  assert.equal((html.match(/class="example-result"/g) || []).length, 10);
  assert.ok(html.includes('&lt;') || html.includes('::: lemma {#lem:square'));
  assert.ok(html.includes('id="lem:square"'));
  assert.ok(html.includes('class="square-demo"') && html.includes('value * value'));
  assert.ok(html.includes('id="ref-example2026"'));
});


test('proof references work without numbering the proof or changing lemma numbers', () => {
  const warnings = [];
  const renderer = createRenderer({ warn: warning => warnings.push(warning), kinds: { lemma: { name: 'Lemma' } } });
  const html = renderer.parse(`See @proof:first and @proof:second, then @lem:first.

::: proof {#proof:first}
A proof.
:::

::: proof {#proof:second title="Proof of the identity"}
A titled proof.
:::

::: lemma {#lem:first}
A statement.
:::
`);
  renderer.finish();
  assert.deepEqual(warnings, []);
  assert.ok(html.includes('href="#proof:first">Proof</a>'));
  assert.ok(html.includes('href="#proof:second">Proof</a>'));
  assert.ok(html.includes('href="#lem:first">Lemma 1</a>'));
  assert.ok(html.includes('class="proof thm" id="proof:first"'));
  assert.ok(html.includes('Proof of the identity.</span>'));
});

test('local Markdown images are embedded relative to the source with figure captions and references', async t => {
  const dir = temporary(t);
  const config = await loadConfig(document(dir));
  const source = path.join(dir, 'manuscript');
  fs.mkdirSync(path.join(source, 'images'), { recursive: true });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" id="triangle"><path d="M0 0 L1 1"/></svg>';
  const imageFile = path.join(source, 'images', 'a diagram.svg');
  fs.writeFileSync(imageFile, svg);
  const markdown = `::: center {#fig:image}
![A & **B**](images/a%20diagram.svg#triangle "A title")
Caption: An image from a local file.
:::

See @fig:image.
`;
  fs.writeFileSync(path.join(source, 'chapter.md'), markdown);
  const result = await build({ ...config, src: path.join(source, 'chapter.md') });
  assert.deepEqual(result.warnings, []);
  assert.ok(result.html.includes(`src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}#triangle"`));
  assert.ok(result.html.includes('alt="A &amp; B" title="A title"'));
  assert.ok(result.html.includes('href="#fig:image">Fig. 1</a>'));
  assert.ok(result.html.includes('<figcaption><b>Fig. 1:</b> An image from a local file.</figcaption>'));
  assert.ok(result.dependencies.includes(imageFile));
  assert.equal(fs.readFileSync(config.out, 'utf8'), result.html);
});

test('remote and data images are retained, while missing local files cause a diagnostic', async t => {
  const dir = temporary(t);
  const config = await loadConfig(document(dir));
  const data = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
  fs.writeFileSync(config.src, `![Remote](https://example.com/image.png)\n![Embedded](${data})\n![Missing](missing.png)\n`);
  const result = await render(config);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /^image missing\.png:/);
  assert.ok(result.html.includes('src="https://example.com/image.png"'));
  assert.ok(result.html.includes(`src="${data}"`));
});


test('init creates a minimal project with a working config and agent-labelled Hello World', async t => {
  const dir = temporary(t);
  const destination = path.join(dir, 'nested', 'My Paper');
  const output = command(process.execPath, [cli, 'init', destination], dir);
  assert.match(output, /npm install/);
  assert.match(output, /npm run build/);
  assert.deepEqual(fs.readdirSync(destination).sort(), ['.gitignore', '.npmrc', 'AGENTS.md', 'package.json', 'paper.config.mjs', 'paper.md'].sort());
  const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'package.json'), 'utf8'));
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  assert.equal(manifest.name, 'my-paper');
  assert.equal(manifest.dependencies['@lfrati/folio'], `github:lfrati/folio#v${version}`);
  assert.equal(manifest.scripts.build, 'folio');
  assert.equal(manifest.scripts.watch, 'folio --watch');
  assert.match(fs.readFileSync(path.join(destination, 'AGENTS.md'), 'utf8'), /Preserve AI markers until the human explicitly accepts/);
  const config = await loadConfig(path.join(destination, 'paper.config.mjs'));
  const result = await build(config);
  assert.deepEqual(result.warnings, []);
  assert.ok(result.html.includes('Hello, world! Start writing here.'));
  assert.ok(result.html.includes('<div class="ai">'));
  assert.ok(result.html.includes('<p class="ai-label">AI draft</p>'));
  assert.ok(!fs.existsSync(path.join(destination, 'node_modules')));
});

test('init works in the current directory and preserves unrelated files', t => {
  const dir = temporary(t);
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'existing notes');
  command(process.execPath, [cli, 'init'], dir);
  assert.equal(fs.readFileSync(path.join(dir, 'notes.txt'), 'utf8'), 'existing notes');
  assert.ok(fs.existsSync(path.join(dir, 'paper.config.mjs')));
});

test('init checks all conflicting files before creating any starter files', t => {
  for (const name of ['paper.md', 'paper.config.mjs', 'AGENTS.md', 'package.json', '.npmrc', '.gitignore']) {
    const dir = temporary(t);
    fs.writeFileSync(path.join(dir, name), 'Keep this file exactly.');
    const result = spawnSync(process.execPath, [cli, 'init', dir], { encoding: 'utf8', cwd: os.tmpdir() });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /already contains/);
    assert.equal(fs.readFileSync(path.join(dir, name), 'utf8'), 'Keep this file exactly.');
    assert.deepEqual(fs.readdirSync(dir), [name]);
  }
  const dir = temporary(t);
  fs.symlinkSync(path.join(dir, 'missing-target'), path.join(dir, 'paper.md'));
  const result = spawnSync(process.execPath, [cli, 'init', dir], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.deepEqual(fs.readdirSync(dir), ['paper.md']);
  assert.ok(fs.lstatSync(path.join(dir, 'paper.md')).isSymbolicLink());
});

test('init rejects unsupported arguments without creating a project', t => {
  const dir = temporary(t);
  const destination = path.join(dir, 'unused');
  const result = spawnSync(process.execPath, [cli, 'init', destination, '--force'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: folio init/);
  assert.ok(!fs.existsSync(destination));
});

test('AI drafts remain explicitly marked around nested Markdown constructs', () => {
  const warnings = [];
  const renderer = createRenderer({ warn: message => warnings.push(message), kinds: { lemma: { name: 'Lemma' } } });
  const html = renderer.parse(`Human text before.

::: ai
A proposed **explanation** with $x^2$.

::: lemma {#lem:draft}
A proposed statement.
:::
::: endai

Human text after. See @lem:draft.
`);
  renderer.finish();
  assert.deepEqual(warnings, []);
  assert.ok(html.startsWith('<p>Human text before.</p>'));
  assert.ok(html.includes('<div class="ai">\n<p class="ai-label">AI draft</p>'));
  assert.ok(html.includes('<strong>explanation</strong>'));
  assert.ok(html.includes('class="lemma thm plain" id="lem:draft"'));
  assert.ok(html.includes('</div>\n<p>Human text after.'));
  assert.ok(html.includes('href="#lem:draft">Lemma 1</a>'));
});
