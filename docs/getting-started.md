# Getting started

Use Node.js 20 or newer. Install Folio from its Git repository:

```sh
npm install github:lfrati/folio#v0.2.0
```

Create `paper.md` and `paper.config.mjs` in your project:

```js
export default {
  src: 'paper.md',
  out: 'paper.html',
  kinds: {
    lemma: { name: 'Lemma', style: 'plain' },
    definition: { name: 'Definition', style: 'defn' },
  },
};
```

Build once or rebuild on edits:

```sh
npx folio paper.config.mjs
npx folio paper.config.mjs --watch
```

The config argument defaults to `paper.config.mjs`. Open the generated HTML directly in a browser.

## Configuration

Paths resolve relative to the config file, so the build works from another directory.

| Option | Default | Purpose |
| --- | --- | --- |
| `src` | `paper.md` | Markdown input |
| `out` | `paper.html` | HTML output; parent directories are created |
| `style` | `null` | Optional CSS appended after the default styles |
| `theme` | `true` | Include the default paper theme; set `false` for a custom theme |
| `navigation` | `true` | Include TOC highlighting and reference preview scripts/styles |
| `bib` | `refs.bib` | Bibliography; missing files are allowed |
| `plugins` | `plugins` | Folder of plugin `.mjs` files; missing folders are allowed |
| `kinds` | `{}` | Named statement types and their display styles |

Additional options are available to plugins through `ctx.config`. CLI flags such as `--snippets` or `--mode=draft` reach plugins as `ctx.flags`.

## JavaScript API

```js
import { loadConfig, build, render } from '@lfrati/folio';

const config = await loadConfig(new URL('./paper.config.mjs', import.meta.url));
const { html, warnings, ms } = await build(config);
const preview = await render(config); // same result, without writing output
```

`loadConfig()` accepts a filesystem path, file URL string, or `URL` object. `build()` and `render()` accept its resolved configuration and an optional flags object.

`build()` and `render()` also return a `dependencies` array of input files, including embedded images; watch mode follows those files. The CLI exits with status 1 when warnings occur. API callers receive the warnings and choose how to handle them.

For rendering Markdown fragments, import `createRenderer` from `@lfrati/folio/renderer`. Create one renderer per document and call `finish()` after parsing to collect final diagnostics.

## Development

```sh
npm ci
npm test
npm run build:example
```

The tests cover the dialect, CLI, watcher, plugin assets, and installation of the packed package into an unrelated project. The engine originated in [lfrati/collatz](https://github.com/lfrati/collatz); that project's figures and interactive lab remain in its own plugins.

## Column width and placement

Set `style` in the config to a CSS file; its rules follow the default theme. These variables control column sizes:

```css
:root {
  --content-width: 57rem;
  --toc-width: 16rem;
  --sn-width: 12rem;
  --sn-gap: 1.5rem;
}
```

`main` controls the content column's margins and placement. The desktop [showcase stylesheet](../examples/showcase/style.css) reserves space for the TOC and sidenotes with body padding, then centers `main` in the remaining space with `margin: 0 auto`.
