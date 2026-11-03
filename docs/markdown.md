# Markdown syntax

## Metadata and sections

Start with a flat `key: value` front-matter block for `title`, `author`, and `abstract`:

```markdown
---
title: My paper
author: My name
abstract: What the paper is about.
---

# Introduction
## Background
# Appendix {-}
```

The first two heading levels appear in the table of contents and are numbered. Add `{-}` to leave a heading unnumbered.

## Math

Use `$x^2$` inline and a `$$` block for display math. An ID after the closing delimiter numbers the equation:

```markdown
$$
E = mc^2
$$ {#eq:energy}

See @eq:energy.
```

## Statements and proofs

Define statement kinds in the configuration, then use `::: kind` blocks:

```markdown
::: lemma {#lem:identity title="A useful identity"}
$(x+1)^2 = x^2 + 2x + 1$.
:::

::: proof {#proof:identity}
Expand the product.
:::

See @lem:identity and @proof:identity.
```

Each statement kind has its own counter; a proof with an ID can be referenced as `@proof:identity` and appears as “Proof”. Blocks nest, and `::: endkind` closes a named enclosing block.

## Tables

Wrap a Markdown table in `::: table` to give it a number, reference, and caption:

```markdown
::: table {#tab:values}
| Input | Output |
| --- | --- |
| 1 | 2 |
| 2 | 4 |
Caption: Example values.
:::
```

## Figures

A container with a `fig:` ID becomes a numbered figure. `center`, `pair`, `ralign`, and `lalign` have default layout styles, and plugins can generate diagrams inside them.

```markdown
::: center {#fig:example}
![A diagram of the experiment](images/experiment.png)
Caption: The experimental setup.
:::
```

Local images are resolved relative to the Markdown source and embedded as data URLs, including PNG, JPEG, GIF, SVG, WebP, AVIF, BMP, and ICO files. Remote URLs remain external; missing local images produce build warnings.

## References and sidenotes

Use `@lem:identity`, `@proof:identity`, `@eq:energy`, `@tab:values`, or `@fig:example` to link to a block and preview it on hover. Forward references work, and unresolved references produce warnings.

Write `A sentence.[^detail]` and define the note with `[^detail]: More detail.` elsewhere in the document. The first mention places the note in the margin; later mentions reuse its number.

## Citations

Write `[@key]` to cite an entry in the configured `.bib` file. Folio supports a small BibTeX subset with brace-delimited fields, and generates a references section for cited entries.

```bibtex
@article{example2026,
  author = {Author, A.},
  title = {An example paper},
  journal = {Example Journal},
  year = {2026}
}
```

## Other blocks

`::: alpha` gives an ordered list lettered markers, and `::: wip` marks work in progress. Unregistered block names wrap their contents in a matching CSS class.

`::: ralign` and `::: lalign` arrange lines in aligned columns, using ` & ` between cells. `---` and `--` in prose become em and en dashes, while code and math are preserved.
