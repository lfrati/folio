---
title: A small example
author: Folio
abstract: A Markdown document with math, numbered statements, tables, and sidenotes.
---

# A simple identity

For every real number $x$, @lem:square follows by expanding the product.[^note]

::: lemma {#lem:square title="A square"}
$(x+1)^2 = x^2 + 2x + 1$.
:::

::: proof
Multiply $(x+1)$ by itself and collect terms.
:::

[^note]: Hover over the reference to preview the lemma.

# A small table

::: table {#tab:values}
| $x$ | $(x+1)^2$ |
| --- | --- |
| 0 | 1 |
| 1 | 4 |
| 2 | 9 |
Caption: Some values of the square in @lem:square.
:::

The table of contents and @tab:values are generated automatically.
