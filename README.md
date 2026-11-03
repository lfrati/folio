# Folio

Folio turns Markdown into a single HTML document with math, references, and interactive figures. Styles, KaTeX fonts, and plugin scripts are embedded so the result opens offline.

- **Tables:** Markdown tables with numbered captions and cross-references.
- **Table of contents:** Generated from headings, with section numbering and the current section highlighted as you scroll.
- **Math:** Inline and display equations rendered with KaTeX, with optional equation numbers and document-wide macros.
- **Statements and proofs:** Theorem, lemma, definition, and similar blocks that work out of the box and can be extended, plus proofs with an end marker.
- **Cross-references:** Hover over a reference to a section, statement, proof, equation, table, or figure, or over a citation, to preview its contents.
- **Figures:** Images and plugin-generated diagrams with numbered captions and references; local image files are embedded in the HTML.
- **Sidenotes:** Numbered notes alongside the text.
- **AI drafts:** Explicitly labelled AI-authored passages, shown in red with a left margin marker; the build counts how many are pending.
- **Citations:** BibTeX citations from real-world exports, with page locators and an automatically generated references section.
- **Plugins:** Custom inline markup, fenced code blocks, and document blocks, with optional JavaScript and CSS.
- **Build feedback:** Watch mode rebuilds on edits, and warnings identify broken references, malformed blocks, invalid math, and failing plugins.

The [showcase](examples/showcase/paper.md) shows Markdown source beside its rendered result for each feature. Run `npm ci && npm run build:demo` to generate `examples/showcase/index.html`, a single file ready to open or host.

Start a minimal document with:

```sh
npx --yes --ignore-scripts --min-release-age=14 --allow-git=all --package=github:lfrati/folio#v0.4.0 folio init my-paper
cd my-paper
npm install
npm run build
```

Agents should start with the [authoring guide](docs/agents.md), then use the [syntax](docs/markdown.md), [configuration/API](docs/getting-started.md), and [plugin](docs/plugins.md) references.

Only three exact dependencies: `marked` for Markdown, `katex` for math, and `commander`, which KaTeX requires and Folio pins; the CLI, watcher, and tests use Node built-ins. The [dependency review](docs/dependencies.md) records what those pins guarantee and how to upgrade them.

MIT licensed; see [LICENSE](LICENSE).
