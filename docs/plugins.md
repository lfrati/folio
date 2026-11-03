# Plugins

Each `.mjs` file in the configured plugin directory is loaded automatically. Plugins are ordered by `order` (default 0), then filename.

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

## Block definitions

A definition supplies `render(token, api)` and can supply `lex(body, token, api)`, a numbering `label`, or `figure: false`. By default, the block's body is parsed as Markdown.

```js
export const blocks = {
  callout: {
    render: (token, api) => api.div(token, api.parse(token.tokens)),
  },
};
```

The API includes `parse`, `parseInline`, `div`, `head`, `qed`, `ctx`, `warn`, and `esc`. The full block interface is documented beside `theoremKind()` in `src/render.mjs`.

## Browser scripts

Browser scripts are concatenated in plugin order into a classic inline script, sharing one scope. Simple named `export const`, `export let`, `export function`, `export async function`, and `export class` declarations have their `export` keyword removed so code can also be imported during the build.

Use plain JavaScript without imports, default exports, or duplicate top-level declarations; Folio reports a build warning for invalid combined scripts. Bundle more complex modules before supplying them as browser assets.

## Embedded assets

Folio embeds plugin CSS and JavaScript plus KaTeX fonts. Images, CSS `url()` references, and network requests made by plugins must be embedded or otherwise handled by the plugin to keep the final document fully offline.
