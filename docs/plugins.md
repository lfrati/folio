# Plugins

Each `.mjs` file in the configured plugin directory is loaded automatically. Plugins are ordered by `order` (default 0), then filename. Export the hooks below by name; a file exporting none of them produces a warning, and helper exports alongside them are fine.

| Export | Purpose |
| --- | --- |
| `spans` | Map code-span prefixes to `(argument, ctx) => html` functions |
| `fences` | Map fenced-block languages to `(body, ctx) => html` functions |
| `blocks` | Map `::: kind` names to block definitions |
| `comments` | Handle an HTML comment, returning HTML or `undefined` |
| `browser` | Array of browser script paths relative to the plugin file |
| `styles` | Array of CSS paths relative to the plugin file |
| `order` | Numeric loading order |

```js
export const spans = {
  badge: (text, ctx) => `<strong class="badge">${ctx.esc(text)}</strong>`,
};
export const styles = ['./badge.css'];
```

Write `` `badge:hello` `` in Markdown to use this plugin. Unregistered prefixes remain ordinary code spans.

## Context

Handlers receive `{ config, flags, warn, esc, plugins }`. Use `warn(message)` for diagnostics and `esc(text)` when inserting plain text into HTML.

A handler that throws produces a warning naming the plugin and line, and the page falls back: a span shows as code, a fence as a code block, and a block as its plain Markdown. Returning something other than a string declines in the same way, so return `undefined` to leave a span or fence as written.

## Block definitions

A definition supplies `render(token, api)` and can supply `lex(body, token, api)`, a numbering `label`, an unnumbered `reference` label, `figure: false`, or `caption: true` to move a `Caption:` line to `token.caption`. By default, the block's body is parsed as Markdown.

```js
export const blocks = {
  callout: {
    render: (token, api) => api.div(token, api.parse(token.tokens)),
  },
};
```

While rendering, the API includes `parse`, `parseInline`, `div`, `head`, `qed`, `ctx`, `warn`, and `esc`. While lexing, it includes `block`, `inline`, `ctx`, `warn`, and `esc`. The full block interface is documented beside `theoremKind()` in `src/render.mjs`.

Inside `::: ai` and `::: wip`, the theme's `--accent`, `--muted`, and `--fg` all become the block's color, so plugin styles that use them keep a draft visibly marked. A hard-coded color stays as written.

## Browser scripts

Browser scripts are concatenated in plugin order into a classic inline script, sharing one scope. Simple named `export const`, `export let`, `export function`, `export async function`, and `export class` declarations have their `export` keyword removed so code can also be imported during the build.

Use plain JavaScript without imports, default exports, or duplicate top-level declarations; Folio reports a build warning for invalid combined scripts. Bundle more complex modules before supplying them as browser assets.

## Embedded assets

Folio embeds plugin CSS and JavaScript plus KaTeX fonts. Local Markdown images are also embedded, relative to the source document. Raw HTML images, remote image URLs, CSS `url()` references, and network requests made by plugins retain their external dependencies.
