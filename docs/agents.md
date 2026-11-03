# Agent authoring guide

Use this guide when creating or editing a document with Folio. The [demo](../examples/showcase/paper.md) is the human-facing feature tour; the other files in `docs/` are technical references.

## Start a document

```sh
npx --yes --ignore-scripts --min-release-age=14 --allow-git=all --package=github:lfrati/folio#v0.4.0 folio init my-paper
cd my-paper
npm install
npm run build
```

`folio init` with no directory initializes the current directory. It creates `paper.md`, `paper.config.mjs`, `package.json`, `AGENTS.md`, `.gitignore`, and `.npmrc`; if any target file already exists, it stops before writing.

The starter uses Folio's built-in theme and needs no stylesheet, plugin directory, or build wrapper. Add those only when the document needs them.

Commit the `package-lock.json` created by the first `npm install`, then use `npm ci` on other machines. Keep install scripts disabled and dependencies pinned; see the [dependency review](dependencies.md) before changing them.

## Mark AI-written text

Wrap new manuscript prose and substantive rewrites in an `ai` block:

```markdown
::: ai
This text was drafted by an AI agent.

It can contain multiple paragraphs, math, tables, and statement blocks.
::: endai
```

The block renders an **AI draft** label, red text, and a red left border. Keep the marker until the human explicitly accepts that text; successful rendering or verification does not remove the authorship marker.

Use `::: wip` for unfinished work, and `::: ai` for AI authorship. Preserve existing human text outside the requested edit and make small, targeted changes.

When editing an existing AI block, modify its contents instead of nesting another AI block. Metadata and configuration changes do not need manuscript authorship wrappers.

## Know the files

| File | Role |
| --- | --- |
| `paper.md` | Editable manuscript source |
| `paper.config.mjs` | Source/output paths, styles, statement types, plugins |
| `paper.html` | Generated output; rebuild instead of editing it |
| `AGENTS.md` | Document-specific authoring instructions |
| `package.json` | Folio version and build/watch commands |

Read the document's own instructions and configuration before editing. Follow any project-specific verification requirements for mathematical or factual claims.

## Use the dialect

Read [Markdown syntax](markdown.md) for statement blocks, proofs, tables, figure images, citations, sidenotes, and references. `theorem`, `lemma`, `proposition`, `corollary`, `conjecture`, `definition`, `remark`, `proof`, `table`, and `ai` are built in; `kinds` in the config adds other statement types.

Give referenced elements stable IDs such as `sec:methods`, `lem:identity`, `proof:identity`, `tab:measurements`, or `fig:setup`. Local Markdown images are resolved relative to the source file and embedded in the output; remote images retain their network dependency.

Use [Plugins](plugins.md) when a reusable document construct needs custom rendering. Use [Configuration and API](getting-started.md) for programmatic builds and CSS controls.

## Validate edits

Run `npm run build` and resolve warnings about missing references, invalid math, malformed blocks, failing plugins, or missing local images; the build exits with status 1 until there are none. For layout or interactive changes, inspect the generated document in a desktop browser.

Use `npm run watch` while writing. Keep AI markers in both the source and the generated output until the human approves their removal. The build's summary line counts the AI drafts still pending; that count is information, not a warning.
