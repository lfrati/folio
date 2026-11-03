# Markdown syntax

## Metadata and sections

Start with a front-matter block:

```markdown
---
title: My paper
author: My name
abstract: What the paper is about.
---

# Introduction
## Background {#sec:background}
# Appendix {-}
```

| Key | Meaning |
| --- | --- |
| `title` | The title; math and other inline Markdown work |
| `author` or `authors` | A name, or names separated by commas |
| `abstract` | One line of Markdown; a longer abstract is a `::: abstract` block at the top of the text |
| `date` | Shown under the title. Defaults to today; an empty `date:` hides it |
| `lang` | The page's language, `en` by default |

Each key takes one line, with a plain or quoted value. Lines starting with `#` are comments; a `#` later in a line is part of the value. Unknown keys and other YAML forms, such as lists and `|` blocks, produce warnings.

The first two heading levels appear in the table of contents and are numbered. Add `{-}` to leave a heading unnumbered, `{#sec:id}` to give it an ID you can reference, or both as `{#sec:id -}`.

## Math

Use `$x^2$` or `\(x^2\)` inline, and `$$ … $$` or `\[ … \]` as a block of their own for display math. An ID after the closing delimiter numbers the equation:

```markdown
$$
E = mc^2
$$ {#eq:energy}

See @eq:energy.
```

As in pandoc, a `$` opens only before a non-space, and closes only after a non-space and not before a digit, so `$20,000 and $30,000` stays text. Write `\$` for a dollar sign in text that would otherwise read as math. Display math can't contain a blank line.

Use `aligned`, `gathered`, or a starred environment for several lines. `equation`, `align`, `gather`, and `alignat` add KaTeX's own numbers, which Folio doesn't track, so they produce a warning.

A `\newcommand` in one formula carries over to later ones, so change it with `\renewcommand`.

## Statements and proofs

`theorem`, `lemma`, `proposition`, `corollary`, `conjecture`, `definition`, and `remark` work out of the box:

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

Add kinds, or rename and restyle the built-in ones, with `kinds` in the config. The `plain` style sets the text in italics and `defn` keeps it upright:

```js
export default {
  kinds: { claim: { name: 'Claim' }, example: { name: 'Example', style: 'defn' } },
};
```

## Tables

Wrap a Markdown table in `::: table` to give it a number, reference, and caption:

```markdown
::: table {#tab:values}
| Input | Output |
| --- | --- |
| 1 | $|x|$ |
| 2 | 4 |
Caption: Example values.
:::
```

Bars inside math don't split a cell. A caption ends at a blank line or the next block, so it can continue on the following lines.

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

Use `@sec:background`, `@lem:identity`, `@proof:identity`, `@eq:energy`, `@tab:values`, or `@fig:example` to link to a block and preview it on hover. Forward references work, and unresolved references produce warnings. A name without a colon that matches nothing, like `@someone`, stays plain text.

A reference needs something to show. A block with an ID but no number, such as `::: note {#note:x}`, is an anchor you can link to with `[text](#note:x)`, and `@note:x` warns.

Write `A sentence.[^detail]` and define the note with `[^detail]: More detail.` elsewhere in the document; indent following lines to continue the note, which is a single paragraph. The first mention places the note in the margin; later mentions reuse its number.

## Citations

Write `[@key]` to cite an entry in the configured `.bib` file, `[@key, p. 3]` for a page, and `[@a] [@b]` for several. Hovering a citation previews the entry, and cited entries appear in a generated references section.

```bibtex
@article{example2026,
  author = {Author, A.},
  title = {An example paper},
  journal = {Example Journal},
  year = {2026}
}
```

Folio reads what tools like arXiv, Crossref, and Zotero export: `{…}` and `"…"` values, TeX accents, and Crossref's tags in titles. A DOI, arXiv ID, or URL becomes a link. Warnings name entries that can't be read, duplicate keys, and cited entries missing a title, author, or year. `@string` macros and `#` joins also warn, so write the value out; an entry written with parentheses, as in `@misc(…)`, isn't read, and citing it reports an unknown citation.

## AI-authored passages

Wrap AI-drafted prose in `::: ai` and close it with `::: endai`:

```markdown
::: ai
A draft written by an AI agent.
::: endai
```

It is labelled **AI draft**, colored red, and marked with a left border, including its links, sidenotes, and numbers. Keep the wrapper until the human accepts the text; use `wip` separately for unfinished work.

## Other blocks

`::: alpha` gives an ordered list lettered markers, and `::: wip` marks work in progress. Unregistered block names wrap their contents in a matching CSS class.

Any block can take attributes in braces: `::: note {#id .class key="value"}`. Anything else on the opening line produces a warning, and `:::` lines inside fenced code or HTML comments mean nothing.

`::: ralign` and `::: lalign` arrange lines in aligned columns, using ` & ` between cells. `---` and `--` in prose become em and en dashes, while code, math, and bare URLs are preserved.
