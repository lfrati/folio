# Folio

Folio turns Markdown into a single HTML document with math, references, and interactive figures. Styles, KaTeX fonts, and plugin scripts are embedded so the result opens offline.

- **Tables:** Markdown tables with numbered captions and cross-references.
- **Table of contents:** Generated from headings, with section numbering and the current section highlighted as you scroll.
- **Math:** Inline and display equations rendered with KaTeX, with optional equation numbers.
- **Statements and proofs:** Configurable theorem, lemma, and definition blocks, plus proofs with an end marker.
- **Cross-references:** Links to statements, equations, tables, and figures, with hover previews.
- **Figures:** Numbered figure containers and captions; plugins can draw custom diagrams.
- **Sidenotes:** Numbered notes alongside the text.
- **Citations:** BibTeX citations and an automatically generated references section.
- **Plugins:** Custom inline markup, fenced code blocks, and document blocks, with optional JavaScript and CSS.
- **Build feedback:** Watch mode rebuilds on edits, and warnings identify broken references, malformed blocks, and invalid math.

The [showcase](examples/showcase/paper.md) shows Markdown source beside its rendered result for each feature. Run `npm ci && npm run build:demo` to generate `examples/showcase/index.html`, a single file ready to open or host.

See [Getting started](docs/getting-started.md) for installation and usage, [Markdown syntax](docs/markdown.md) for authoring, and [Plugins](docs/plugins.md) for extensions.
