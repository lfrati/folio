# Configuration and API reference

Agents should start with the [authoring guide](agents.md). Use Node.js 20 or newer.

## Initialize a project

```sh
npx --yes --ignore-scripts --min-release-age=14 --allow-git=all --package=github:lfrati/folio#v0.3.1 folio init my-paper
cd my-paper
npm install
npm run build
```

This creates a minimal config, a Hello, world document, build/watch scripts, and agent instructions. Open `paper.html`, edit `paper.md`, and use `npm run watch` for automatic rebuilds.

If Folio is already available as a command, use `folio init my-paper` directly. The directory defaults to the current directory; existing target files are preserved.

The bootstrap command disables dependency install scripts, requires releases to be at least 14 days old, and allows the Git dependency on Folio, which npm 12 otherwise refuses. New projects record the same settings in `.npmrc`. Commit the generated `package-lock.json`, which is what freezes a project's dependencies, and use `npm ci` for subsequent installs. See [Dependencies](dependencies.md) for the versions and review.

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
| `kinds` | `{}` | Statement types beyond the [built-in ones](markdown.md#statements-and-proofs), or new names and styles for them |
| `macros` | `{}` | KaTeX macros shared by all math, such as `{ '\\R': '\\mathbb{R}' }` |

Additional options are available to plugins through `ctx.config`. CLI flags such as `--snippets` or `--mode=draft` reach plugins as `ctx.flags`.

Other than `--watch`, flags are not checked, because they belong to your plugins. A near miss of `--watch` prints a reminder.

## JavaScript API

```js
import { loadConfig, build, render } from '@lfrati/folio';

const config = await loadConfig(new URL('./paper.config.mjs', import.meta.url));
const { html, warnings, ms } = await build(config);
const preview = await render(config); // same result, without writing output
```

`loadConfig()` accepts a filesystem path, file URL string, or `URL` object. `build()` and `render()` accept its resolved configuration and an optional flags object.

`build()` and `render()` also return a `dependencies` array of input files, including embedded images, and `aiDrafts`, the number of `::: ai` blocks; watch mode follows those files. `build()` refuses to write over the config or an input. The CLI exits with status 1 when warnings occur. API callers receive the warnings and choose how to handle them.

For rendering Markdown fragments, import `createRenderer` from `@lfrati/folio/renderer`. Create one renderer per document, call `parse(text)`, and then `finish()` to collect final diagnostics.

Watch mode rebuilds when any file changes in the folders it watches, because plugins can read files Folio doesn't know about. It ignores the output and what the build itself wrote, so a plugin that generates a file doesn't start a loop; one consequence is that saving a file that isn't an input while a build is running doesn't trigger another build.

## Development

```sh
npm ci
npm test
npm run build:example
```

The tests cover the dialect, CLI, watcher, plugin assets, and installation of the packed package into an unrelated project.

## Column width and placement

The default theme is made for desktop windows. It reserves space for the TOC and sidenotes with body padding, then centers `main` in the remaining space with `margin: 0 auto`.

Set `style` in the config to a CSS file; its rules follow the default theme. These variables control column sizes, shown here with their defaults:

```css
:root {
  --content-width: 57rem;
  --toc-width: 16rem;
  --sn-width: 12rem;
  --sn-gap: 1.5rem;
}
```

The [showcase stylesheet](../examples/showcase/style.css) is an example of a small override.
