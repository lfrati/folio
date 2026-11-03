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
});

test('the packed package installs and builds in a separate project', t => {
  const dir = temporary(t);
  const packed = JSON.parse(command('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', dir], root))[0];
  const files = new Set(packed.files.map(file => file.path));
  for (const file of ['src/index.mjs', 'assets/theme.css', 'assets/navigation.js', 'assets/navigation.css', 'bin/folio.mjs']) {
    assert.ok(files.has(file), `package is missing ${file}`);
  }
  assert.ok(!files.has('original-paper.html'));
  assert.ok(![...files].some(file => file.endsWith('.html')), 'built examples should not be packaged');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"private":true,"type":"module"}');
  fs.copyFileSync(path.join(root, '.npmrc'), path.join(dir, '.npmrc'));
  command('npm', ['install', '--prefer-offline', '--ignore-scripts', '--no-audit', '--no-fund', path.join(dir, packed.filename)], dir);
  const configFile = document(dir);
  command(path.join(dir, 'node_modules/.bin/folio'), [configFile], os.tmpdir());
  command(process.execPath, ['--input-type=module', '-e', "import { loadConfig, render } from '@lfrati/folio'; const result = await render(await loadConfig('./paper.config.mjs')); if (result.warnings.length) throw Error(result.warnings.join('\\n'));"], dir);
  const html = fs.readFileSync(path.join(dir, 'dist/article.html'), 'utf8');
  assert.ok(html.includes('An unrelated project') && html.includes('.preview {'));
});

test('the showcase presents every example from a single Markdown source', async () => {
  const config = await loadConfig(new URL('../examples/showcase/paper.config.mjs', import.meta.url));
  const { html, warnings } = await render(config);
  assert.deepEqual(warnings, []);
  assert.equal((html.match(/class="example-source"/g) || []).length, 9);
  assert.equal((html.match(/class="example-result"/g) || []).length, 9);
  assert.ok(html.includes('&lt;') || html.includes('::: lemma {#lem:square'));
  assert.ok(html.includes('id="lem:square"'));
  assert.ok(html.includes('class="square-demo"') && html.includes('value * value'));
  assert.ok(html.includes('id="ref-example2026"'));
});
