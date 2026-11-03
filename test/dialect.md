---
title: Dialect $x$ test
author: Nobody
---

# Intro

Inline $a_i + b_{i-1}$ math, a code span `not:a:shortcode`, a `box:hello` span, dashes---like this--and this.
A reference ahead: @lem:one and @eq:main and @tab:t and @fig:f, a citation [@knuth1974], a mail x@y:z stays.

$$
E = mc^2
$$ {#eq:main}

::: lemma {#lem:one title="First"}
Body of the lemma with $\alpha$.

::: center {#fig:f}
`box:inside`
:::
:::

::: proof
<!-- keep: badge -->
First line. Last line.
:::

::: table {#tab:t}
| a | b |
|---|---|
| 1 | `box:2` <!-- dropped --> |

Caption: A caption with $y$.
:::

::: ralign
`box:r1` & $x$ & c
d & e
:::

::: definition
Defined.
:::

::: proof {title="Proof of the claim"}
Text.

1. one
2. two
:::

::: proof
First.

::: center
figure
:::
:::

::: lemma {title="With $y$ and <b>"}
- a list first
:::

::: demo {#fig:d}
Plugin block with `box:in`.
:::

A sidenote[^one] and again[^one] and a missing one[^nope].

[^one]: The note, with @lem:one.
[^unused]: Never referenced.

```echo
raw <!-- comment kept --> body
```

```js
<!-- also kept --> code
```

## Sub {-}

::: wip
::: lemma
Unclosed inner.
::: endwip

::: endnothing

:::

Bad math $\frac{$ and unknown [@nobody] and @lem:missing.

::: lemma {#lem:one}
Duplicate label.
:::

::: center {#fig:c}
`box:x`

Caption: Reads `box:in`.
:::

::: outer
still open at the end
