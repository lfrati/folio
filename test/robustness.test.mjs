// One test per way a document or project used to come out silently wrong, or crash.
// The contract: Folio either does what the source says, or a warning says why it didn't.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, build, render } from '@lfrati/folio';
import { createRenderer } from '@lfrati/folio/renderer';
import { parseBib } from '../src/bib.mjs';
import { frontMatter } from '../src/frontmatter.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'bin/folio.mjs');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function dialect(source, options = {}) {
  const warnings = [];
  const renderer = createRenderer({ warn: message => warnings.push(message), ...options });
  const html = renderer.parse(source);
  renderer.finish();
  return { html, warnings, renderer };
}

function project(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries({ 'paper.config.mjs': 'export default {};', ...files })) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

async function page(t, files) {
  const dir = project(t, files);
  const config = await loadConfig(path.join(dir, 'paper.config.mjs'));
  const result = await render(config);
  return { dir, config, ...result, main: result.html.slice(result.html.indexOf('<main>'), result.html.indexOf('</main>')) };
}

const folio = (args, cwd) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 30000 });

// -- statements ------------------------------------------------------------------------------

test('common statements work without configuring them', () => {
  const { html, warnings } = dialect('::: theorem {#t}\nA.\n:::\n\n::: lemma\nB.\n:::\n\n::: definition\nC.\n:::\n\nSee @t.');
  assert.deepEqual(warnings, []);
  assert.match(html, /class="theorem thm plain" id="t"/);
  assert.match(html, /Lemma 1\./);
  assert.match(html, /class="definition thm defn"/);
  assert.match(html, /href="#t">Theorem 1</);
});

test('the config adds and restyles kinds; a name is required', () => {
  const { html, warnings } = dialect('::: claim\nA.\n:::\n\n::: lemma\nB.\n:::\n\n::: odd\nC.\n:::', {
    kinds: { claim: 'Claim', lemma: { name: 'Hilfssatz', style: 'defn' }, odd: { style: 'plain' } },
  });
  assert.match(html, /Claim 1\./);
  assert.match(html, /class="lemma thm defn"/);
  assert.match(html, /Hilfssatz 1\./);
  assert.match(html, /<div class="odd">/);
  assert.deepEqual(warnings, ["kinds.odd: expected a name, as in odd: { name: 'Lemma', style: 'plain' }"]);
});

test('overriding a built-in or configured kind warns; overriding a default statement does not', () => {
  const block = { render: () => '<i>mine</i>\n' };
  assert.deepEqual(dialect('x', { blocks: { lemma: block } }).warnings, []);
  assert.deepEqual(dialect('x', { blocks: { ai: block } }).warnings, ['block kind ai: a plugin overrides the built-in kind']);
  assert.deepEqual(dialect('x', { kinds: { claim: 'Claim' }, blocks: { claim: block } }).warnings, ['block kind claim: a plugin overrides the configured kind']);
  assert.deepEqual(dialect('x', { kinds: { table: 'Tabelle' } }).warnings, ['kinds.table: overrides the built-in kind']);
});

test('a title that would not be shown is reported', () => {
  assert.match(dialect('::: claim {title="Lost"}\nA.\n:::').warnings[0], /::: claim at line 1: this kind does not show a title; is claim missing from kinds\?/);
  assert.match(dialect('::: ai {title="Lost"}\nA.\n:::').warnings[0], /::: ai at line 1: this kind does not show a title$/);
  assert.deepEqual(dialect('::: lemma {title="Shown"}\nA.\n:::').warnings, []);
  assert.deepEqual(dialect('::: x {title="Mine"}\nA.\n:::', { blocks: { x: { render: t => `<p>${t.attrs.title}</p>` } } }).warnings, []);
});

// -- blocks ----------------------------------------------------------------------------------

test('block markers inside code fences and comments are not markers', () => {
  const { html, warnings } = dialect('::: note\n```\n:::\n::: endnote\n```\n\n~~~~\n:::\n~~~\n~~~~\n\n<!--\n:::\n-->\nStill inside.\n:::\n\nAfter.');
  assert.deepEqual(warnings, []);
  const block = html.slice(0, html.indexOf('After.'));
  assert.ok(block.includes(':::\n::: endnote\n</code></pre>'));
  assert.match(block, /Still inside\.<\/p>\n<\/div>\n<p>$/);
});

test('only a block\'s own caption is lifted, and it can continue on the next lines', () => {
  const inFence = dialect('::: table\n```\nCaption: not this\n```\n\nCaption: this one\nand this\n\nAfter.\n:::');
  assert.ok(inFence.html.includes('<figcaption><b>Table 1:</b> this one and this</figcaption>'));
  assert.ok(inFence.html.includes('Caption: not this'));
  assert.ok(inFence.html.includes('<p>After.</p>'));
  const nested = dialect('::: center {#fig:outer}\n::: table\n| a |\n|---|\n| 1 |\nCaption: inner\n:::\n:::');
  assert.ok(nested.html.includes('<span class="figno">Fig. 1</span>'));
  assert.ok(nested.html.includes('<b>Table 1:</b> inner'));
});

test('a table keeps its classes and is always labelled', () => {
  const { html } = dialect('::: table {.wide}\n| a |\n|---|\n| 1 |\n:::');
  assert.ok(html.includes('<figure class="table wide">'));
  assert.ok(html.includes('<figcaption><b>Table 1</b></figcaption>'));
});

test('attributes are read or reported', () => {
  const good = dialect('::: note {#a .b .c d="e" f=\'g\'}\nx\n:::');
  assert.deepEqual(good.warnings, []);
  assert.ok(good.html.includes('<div class="note b c" id="a">'));
  assert.deepEqual(dialect('::: note wide\nx\n:::').warnings, ['::: note at line 1: cannot read "wide"; attributes go in braces, as in {#id .class key="value"}']);
  assert.deepEqual(dialect('::: note {bad}\nx\n:::').warnings, ['::: note at line 1: cannot read "bad"']);
  assert.deepEqual(dialect('::: note {classes="x"}\nx\n:::').warnings, ['::: note at line 1: cannot read "classes="x""']);
  const malformed = dialect('::: {#x}\ntext');
  assert.deepEqual(malformed.warnings, ['malformed ::: {#x} at line 1: a block opens with ::: kind {attributes}']);
  assert.ok(malformed.html.includes('::: {#x}'));
  const attr = dialect('::: note {id="a&quot;><b>"}\nx\n:::');
  assert.ok(!attr.html.includes('<b>'), 'an id in key form is escaped');
});

test('names from a document never reach Object.prototype', () => {
  const { html, warnings } = dialect('::: constructor\nx\n:::\n\n::: __proto__\ny\n:::\n\n`constructor:x`\n\n```constructor\nz\n```', { spans: { other: () => '' } });
  assert.deepEqual(warnings, []);
  assert.ok(html.includes('<div class="constructor">'));
  assert.ok(html.includes('<code>constructor:x</code>'));
  assert.ok(html.includes('language-constructor'));
});

test('nesting too deep to render is reported instead of crashing', () => {
  const { html, warnings } = dialect('::: a\n'.repeat(5000));
  assert.ok(warnings.some(w => w.includes('nested more than 100 deep')));
  assert.ok(warnings.some(w => w.startsWith('unclosed ::: a > a > a > a > a > …, opened at line 1')));
  assert.ok(html.includes('class="a"'));
});

test('warnings name the right line, through front matter, lists and quotes', async t => {
  const lines = dialect('Intro.\n\n- a list item\n\n  ::: foo nonsense\n  :::\n\nText.\n\n> ::: bar nonsense\n> :::\n\n$$\nx\n\n::: baz nonsense\n:::');
  assert.ok(lines.warnings.some(w => w.startsWith('::: foo at line 5:')), lines.warnings.join('\n'));
  assert.ok(lines.warnings.some(w => w.startsWith('::: bar at line 10:')), lines.warnings.join('\n'));
  assert.ok(lines.warnings.includes('unclosed $$ at line 13'), lines.warnings.join('\n'));
  assert.ok(lines.warnings.some(w => w.startsWith('::: baz at line 16:')), lines.warnings.join('\n'));
  const { warnings } = await page(t, { 'paper.md': '---\ntitle: T\n---\n\n::: foo nonsense\n:::\n' });
  assert.match(warnings[0], /^::: foo at line 5:/);
});

test('a warning that repeats is reported once', async t => {
  const { warnings } = await page(t, { 'paper.md': '[@nobody] and [@nobody] and [@nobody].\n' });
  assert.deepEqual(warnings, ['unknown citation nobody']);
});

// -- references ------------------------------------------------------------------------------

test('sections can be referenced in both directions', () => {
  const { html, warnings, renderer } = dialect('# Intro {#sec:intro}\n\nSee @sec:back and @sec:intro.\n\n## Sub\n\n# Back matter {#sec:back -}\n\nSee @sec:sub.\n\n## Named {#sec:sub}');
  assert.deepEqual(warnings, []);
  assert.ok(html.includes('<h1 id="sec:intro"><span class="secno">1</span>Intro</h1>'));
  assert.ok(html.includes('<h1 id="sec:back">Back matter</h1>'));
  assert.ok(html.includes('href="#sec:back">Back matter</a>'));
  assert.ok(html.includes('href="#sec:intro">Section 1</a>'));
  assert.ok(html.includes('href="#sec:sub">Section 1.2</a>'));
  assert.deepEqual(renderer.headings.map(h => h.id), ['sec:intro', 'sec-sub', 'sec:back', 'sec:sub']);
});

test('heading ids handle any words, and never collide with each other or with blocks', () => {
  const { html, warnings } = dialect('## First\n\n# Résumé\n\n# Résumé\n\n# !!!\n\n# $x$\n\n# Clash {#fig:a}\n\n::: center {#fig:a}\nx\n:::\n\n# Sec\n\n::: note {#sec-sec}\ny\n:::');
  assert.ok(html.includes('<h2 id="sec-first"><span class="secno">1</span>First</h2>'), 'no section 0.1');
  assert.ok(html.includes('id="sec-résumé"'));
  assert.ok(html.includes('id="sec-résumé-2"'));
  assert.ok(html.includes('<h1 id="sec">'));
  assert.ok(html.includes('<h1 id="sec-2">'));
  assert.ok(html.includes('<h1 id="fig:a-2">'));
  assert.deepEqual(warnings, ['duplicate label fig:a, keeping the first']);
  assert.ok(html.includes('id="sec-sec-2"'), 'a slug avoids a block id');
  assert.ok(html.includes('<div class="note" id="sec-sec">'));
});

test('the table of contents gets plain text, and a heading renders its side effects once', () => {
  const { html, warnings, renderer } = dialect('# A [link](https://x.org)[^n] and @sec:b and [@k] $\\newcommand{\\foo}{y}\\foo$ ![pic](p.png) <!-- gone -->\n\n[^n]: A note.\n\n# Other {#sec:b}', { bib: new Map([['k', { author: 'Knuth, D.', year: '1974' }]]) });
  assert.deepEqual(warnings, []);
  const toc = renderer.headings[0].text;
  assert.doesNotMatch(toc, /<a[\s>]/);
  assert.ok(!toc.includes('sn-'), toc);
  assert.ok(!toc.includes('<img'), toc);
  assert.ok(toc.includes('A link and Section 2 and [Knu74]'), toc);
  assert.ok(toc.includes('katex'), toc);
  assert.equal(renderer.sidenotes.nums.get('n'), 1);
  assert.equal((html.match(/class="sn-note"/g) || []).length, 1);
});

test('duplicate ids warn wherever they are; a reference says what is wrong with an anchor', () => {
  assert.deepEqual(dialect('::: note {#a}\nx\n:::\n\n::: other {#a}\ny\n:::').warnings, ['duplicate label a at line 5, keeping the first']);
  const dupEq = dialect('$$x$$ {#eq:a}\n\n$$y$$ {#eq:a}');
  assert.deepEqual(dupEq.warnings, ['duplicate label eq:a at line 3, keeping the first']);
  assert.equal((dupEq.html.match(/id="eq:a"/g) || []).length, 1);
  const anchor = dialect('::: note {#note:x}\nx\n:::\n\n[go](#note:x) and @note:x.');
  assert.deepEqual(anchor.warnings, ['unresolved reference @note:x: ::: note at line 1 has this id but no number to show']);
  assert.ok(anchor.html.includes('<a class="ref bad" href="#note:x">??</a>'));
});

test('references end where their label ends; handles stay text', () => {
  const { html, warnings } = dialect('::: lemma {#lem:a.b-c}\nx\n:::\n\nSee @lem:a.b-c. Ask @someone or @some-one, write to me@example.org, and read x@y:z.');
  assert.deepEqual(warnings, []);
  assert.ok(html.includes('href="#lem:a.b-c">Lemma 1</a>.'));
  assert.ok(html.includes('Ask @someone or @some-one,'));
  assert.ok(html.includes('href="mailto:me@example.org"'));
  assert.ok(html.includes('x@y:z'));
  assert.deepEqual(dialect('Text @a:b--c.').warnings, ['unresolved reference @a:b']);
});

test('citations take locators and groups; anything else in brackets is left alone', () => {
  const bib = new Map([['knuth:1974', { author: 'Knuth, D.', year: '1974' }], ['a/b+c', { author: 'Lamport, L.', year: '1986', label: 'Lam86' }]]);
  const { html, warnings, renderer } = dialect('[@knuth:1974, pp. 3--5] [@a/b+c p. 7] [@knuth:1974; @a/b+c, ch. 2] [@knuth:1974, @a/b+c] [@nope] [@a/b+c; @nope]\n\n[@a/b+c](https://x.org) [@note] [a @b] [^]', { bib });
  assert.deepEqual(warnings, ['unknown citation nope', 'unknown citation nope', 'unknown citation note']);
  assert.ok(html.includes('<a class="cite" href="#ref-knuth:1974">[Knu74, pp. 3–5]</a>'));
  assert.ok(html.includes('<a class="cite" href="#ref-a/b+c">[Lam86, p. 7]</a>'));
  assert.ok(html.includes('[<a class="cite" href="#ref-knuth:1974">Knu74</a>; <a class="cite" href="#ref-a/b+c">Lam86, ch. 2</a>]'));
  assert.ok(html.includes('<a class="cite bad">[?]</a>'));
  assert.ok(html.includes('[<a class="cite" href="#ref-a/b+c">Lam86</a>; <a class="cite bad">?</a>]'));
  assert.ok(html.includes('<a href="https://x.org">@a/b+c</a>'), 'a link stays a link');
  assert.deepEqual([...renderer.cited].sort(), ['a/b+c', 'knuth:1974']);
});

test('sidenotes can continue on indented lines', () => {
  const { html, warnings } = dialect('A note[^n] and text.\n\n[^n]: First line\n    second line\n    third.\n\nNext paragraph.');
  assert.deepEqual(warnings, []);
  assert.match(html, /<span class="sn-num">\[1\]<\/span>First line\nsecond line\nthird\.<\/span>/);
  assert.ok(html.includes('<p>Next paragraph.</p>'));
});

test('dashes apply to prose, not to bare URLs', () => {
  const { html } = dialect('https://example.com/a--b and <https://x.org/c--d> and www.x.org/e--f and a--b@c.org and [t--x](https://y.org/g--h) and a--b.');
  for (const url of ['>https://example.com/a--b</a>', '>https://x.org/c--d</a>', '>www.x.org/e--f</a>', '>a--b@c.org</a>', 'href="https://y.org/g--h">t–x</a>', 'and a–b.']) assert.ok(html.includes(url), `${url}\n${html}`);
});

// -- math ------------------------------------------------------------------------------------

test('dollar signs follow pandoc: money stays money', () => {
  for (const text of ['It costs $20,000 and $30,000.', 'From $5 to $10.', '$ x $ is text.', 'A lone $ sign.']) {
    const { html, warnings } = dialect(text);
    assert.deepEqual(warnings, []);
    assert.ok(!html.includes('katex'), `${text} became math`);
  }
  const escaped = dialect('\\$5 and $x$ and \\$6.');
  assert.deepEqual(escaped.warnings, []);
  assert.ok(escaped.html.startsWith('<p>$5 and <span class="katex">'));
  assert.ok(escaped.html.includes('and $6.'));
  assert.ok(dialect('$x$').html.includes('katex'));
  assert.ok(dialect('$a\\$b$').html.includes('katex'));
});

test('every display form works, and a numbered one can be referenced', () => {
  const { html, warnings } = dialect('$$x$$\n\n$$\ny\n$$ {#eq:a}\n\n\\[z\\] {#eq:b}\n\n\\[\nw\n\\]\n\nInline \\(v\\) and $$u$$ in a sentence, see @eq:a, @eq:b.');
  assert.deepEqual(warnings, []);
  assert.equal((html.match(/<div class="eqd">/g) || []).length, 2);
  assert.ok(html.includes('<div class="eq" id="eq:a">'));
  assert.ok(html.includes('<span class="eqno">(2)</span>'));
  assert.ok(html.includes('href="#eq:b">(2)</a>'));
  assert.equal((html.match(/katex-display/g) || []).length, 5);
});

test('unclosed or self-numbering display math is reported; blank lines end it', () => {
  assert.deepEqual(dialect('$$\nx\n\nProse with $y$.\n\n$$\nz\n$$').warnings, ['unclosed $$ at line 1']);
  const prose = dialect('$$\nx\n\nProse with $y$.');
  assert.ok(prose.html.includes('Prose with <span class="katex">'));
  assert.match(dialect('$$\n\\begin{align}a\\end{align}\n$$').warnings[0], /^math at line 1: \\begin\{align\} adds KaTeX's own equation numbers/);
  assert.deepEqual(dialect('$$\n\\begin{aligned}a\\end{aligned}\n$$').warnings, []);
  assert.deepEqual(dialect('$$\n\\begin{align*}a\\end{align*}\n$$').warnings, []);
});

test('macros are shared by all math, from the config and from the document', () => {
  const { html, warnings } = dialect('$\\R$ and $\\newcommand{\\foo}{x}\\foo$ and $\\foo$.', { macros: { '\\R': '\\mathbb{R}' } });
  assert.deepEqual(warnings, []);
  assert.ok(!html.includes('katex-error'));
  const macros = { '\\R': '\\mathbb{R}' };
  dialect('$\\newcommand{\\foo}{x}$', { macros });
  assert.deepEqual(Object.keys(macros), ['\\R'], 'the config is not written to');
  assert.deepEqual(dialect('x', { macros: 'nope' }).warnings, ["macros: expected an object, as in { '\\\\R': '\\\\mathbb{R}' }"]);
});

test('math survives emphasis and table cells', () => {
  const em = dialect('*a $b*c$ d* and _x $y_z$ w_');
  assert.deepEqual(em.warnings, []);
  assert.ok(em.html.startsWith('<p><em>a <span class="katex">'));
  assert.ok(em.html.includes('<em>x <span class="katex">'));
  const cells = dialect('| $|x|$ | b |\n|---|---|\n| $\\|y\\|$ | \\(|z|\\) |\n| `a` | $p$ |');
  assert.deepEqual(cells.warnings, []);
  assert.equal((cells.html.match(/<td>/g) || []).length, 4);
  assert.equal((cells.html.match(/<th>/g) || []).length, 2);
  assert.ok(cells.html.includes('∥'), '\\| stays a double bar');
  const fenced = dialect('```\n| $|x|$ |\n|---|\n| $|y|$ |\n```');
  assert.ok(fenced.html.includes('| $|y|$ |'), 'code is untouched');
});

test('an & in math or code does not split an aligned row', () => {
  const { html } = dialect('::: ralign\n$\\begin{matrix}a & b\\end{matrix}$ & `c & d` & e\n:::');
  assert.ok(html.includes('repeat(3, auto)'), html);
});

// -- front matter ----------------------------------------------------------------------------

test('front matter reads the YAML papers use', () => {
  const warnings = [];
  const { meta, lines, line, body } = frontMatter(`---
# a comment
title: "A: quoted \\"title\\""
author:
  - Ada Lovelace
  - 'Alan Turing'
authors: [Grace Hopper, "Hopper, G."]
date:
abstract: |
  First.

  Second.
lang: de
---
Body.
`, m => warnings.push(m));
  assert.deepEqual(warnings, []);
  assert.equal(meta.title, 'A: quoted "title"');
  assert.equal(meta.author, 'Ada Lovelace, Alan Turing');
  assert.equal(meta.authors, 'Grace Hopper, Hopper, G.');
  assert.equal(meta.date, '');
  assert.equal(meta.abstract, 'First.\n\nSecond.');
  assert.equal(meta.lang, 'de');
  assert.equal(lines.abstract, 10);
  assert.equal(line, 15);
  assert.equal(body, 'Body.\n');
});

test('front matter keeps what plain values used to lose', () => {
  assert.equal(frontMatter('---\ntitle: Issue #5\n---\n').meta.title, 'Issue #5');
  assert.equal(frontMatter('---\nabstract: A long abstract\n  on two lines\n  or three.\ntitle: T\n---\n').meta.abstract, 'A long abstract on two lines or three.');
  assert.equal(frontMatter('---\nabstract: >\n  Folded\n  text.\n\n  Next.\n---\n').meta.abstract, 'Folded text.\n\nNext.');
  assert.equal(frontMatter("---\ntitle: 'It''s'\n---\n").meta.title, "It's");
  assert.equal(frontMatter('---\ntitle: No newline at the end\n---').meta.title, 'No newline at the end');
  assert.deepEqual(frontMatter('---\n---\nBody').meta, {});
  assert.equal(frontMatter('---\n---\nBody').body, 'Body');
});

test('front matter says what it could not read', () => {
  const warnings = [];
  frontMatter('---\ntitle: T\nsubtitle: S\nno colon here\n---\n', m => warnings.push(m));
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /^front matter line 3: unknown key subtitle;/);
  assert.match(warnings[1], /^front matter line 4: cannot read "no colon here"/);
});

test('a rule at the top of a document is not front matter', () => {
  const { meta, body } = frontMatter('---\n\nJust text.\n\n---\nMore.\n');
  assert.deepEqual(meta, {});
  assert.ok(body.startsWith('---'));
});

test('title, date, language, abstract and byte-order marks reach the page', async t => {
  const { html, main, warnings } = await page(t, {
    'paper.md': '\uFEFF---\r\ntitle: "T & $x$"\r\nauthor: A <b>\r\ndate: 2020-01-02\r\nlang: "fr\'"\r\nabstract: |\r\n  One[^a].\r\n\r\n  Two.\r\n---\r\n\r\nText[^b].\r\n\r\n[^a]: First.\r\n[^b]: Second.\r\n',
  });
  assert.deepEqual(warnings, []);
  assert.ok(html.includes('<html lang="fr\'">'));
  assert.ok(html.includes('<title>T &amp; $x$</title>'));
  assert.ok(main.includes('<h1>T &amp; <span class="katex">'));
  assert.ok(main.includes('<div class="author">A &lt;b&gt;</div>'));
  assert.ok(main.includes('<div class="date">2020-01-02</div>'));
  assert.match(main, /<div class="abstract"><p>One<span class="sn"><span class="sn-ref">\[1\]/);
  assert.ok(main.includes('</p>\n<p>Two.</p>\n</div>'));
  assert.match(main, /Text<span class="sn"><span class="sn-ref">\[2\]/);
  const hidden = await page(t, { 'paper.md': '---\ntitle: T\ndate:\n---\n' });
  assert.ok(!hidden.main.includes('class="date"'));
  assert.ok(!hidden.main.includes('class="author"'));
  const today = await page(t, { 'paper.md': '---\ntitle: T\n---\n' });
  assert.ok(today.main.includes(`<div class="date">${new Date().toISOString().slice(0, 10)}</div>`));
});

// -- bibliography ----------------------------------------------------------------------------

const REAL_BIB = `% A comment mentioning me@example.org and {braces.
Some text between entries.
@string{jacm = "Journal of the {ACM}"}
@comment{ @article{ignored, title={Hidden}} }
@preamble{ "\\newcommand{\\noop}[1]{}" }
@article{knuth1974, author = {Donald E. Knuth}, title = {Structured Programming with {\\tt go to} Statements}, journal = jacm # " Surveys", year = 1974, month = dec, pages = {261--301},}
@ARTICLE{godel,
  AUTHOR = "G{\\"o}del, Kurt and {\\v S}a{\\v s}ek, Ana and others",
  TITLE = {{\\"U}ber formal unentscheidbare S\\"atze & $x^2$ *stars* <b>},
  JOURNALTITLE = {Monatshefte},
  volume = 38, number = {1},
  DATE = {1931-01-01},
  DOI = {https://doi.org/10.1007/BF01700692}
}
@misc(openai, author={{OpenAI}}, title={GPT-4 Technical Report}, year={2023}, eprint={2303.08774}, archivePrefix={arXiv}, url={https://arxiv.org/abs/2303.08774})
@book{waals, author={van der Waals, J. D.}, title={A book.}, publisher={Pub} year=1873}
@phdthesis{thesis, author={Ludwig van Beethoven}, title={On Music}, school={Bonn}, year={1800}, note={Available at \\url{https://example.com/a\\_b}}}
@misc{unsafe, author={A, B}, title={T}, year={2000}, url={javascript:alert(1)}}
@inproceedings{conf, editor={Ed, A.}, title={Conf}, booktitle={Proc \\& Co}, pages={1--2}, year={2001}}
@article{same1, author={Smith, A.}, title={One}, year={2020}}
@article{same2, author={Smith, B.}, title={Two}, year={2020}}
@article{same1, author={Other, Z.}, title={Duplicate}, year={1999}}
@article{empty}
@article{odd, title = unknownmacro, year = {2002}, author={A, B}}
@article{broken, author={A, title={Unclosed}
@article{after, author={Later, A.}, title={After the broken one}, year={2001}}
`;
const BIB_KEYS = ['knuth1974', 'godel', 'openai', 'waals', 'thesis', 'unsafe', 'conf', 'same1', 'same2', 'empty', 'odd', 'after'];

test('real BibTeX reads as BibTeX reads it', () => {
  const warnings = [];
  const bib = parseBib(REAL_BIB, m => warnings.push(m));
  assert.equal(bib.get('knuth1974').journal, 'Journal of the {ACM} Surveys');
  assert.equal(bib.get('knuth1974').month, 'December');
  assert.equal(bib.get('knuth1974').label, 'Knu74');
  assert.equal(bib.get('godel').journaltitle, 'Monatshefte');
  assert.equal(bib.get('godel').volume, '38');
  assert.equal(bib.get('godel').label, 'Göd31');
  assert.equal(bib.get('openai').label, 'Ope23');
  assert.equal(bib.get('waals').label, 'Waa73');
  assert.equal(bib.get('waals').publisher, 'Pub', 'a missing comma is forgiven');
  assert.equal(bib.get('thesis').label, 'Bee00');
  assert.equal(bib.get('same1').label, 'Smi20a');
  assert.equal(bib.get('same2').label, 'Smi20b');
  assert.equal(bib.get('same1').title, 'One', 'the first of a duplicate stays');
  assert.ok(!bib.has('ignored'));
  assert.equal(bib.get('after').title, 'After the broken one');
  assert.ok(warnings.some(w => w.startsWith('bib: duplicate key same1 at line')), warnings.join('\n'));
  assert.ok(warnings.includes('bib: unknown @string unknownmacro at line 24'), warnings.join('\n'));
  assert.ok(warnings.includes('bib: unclosed { at line 25'), warnings.join('\n'));
  assert.equal(warnings.length, 3, warnings.join('\n'));
});

test('a value BibTeX itself rejects is reported, not guessed at', () => {
  const warnings = [];
  const bib = parseBib('@article{x, author = "G\\"{o}del, K.", title = {T}}\n@article{y, title = {Next}}\n', m => warnings.push(m));
  assert.deepEqual(warnings, ['bib: entry x: expected field = value at line 1']);
  assert.equal(bib.get('y').title, 'Next');
});

test('references come out right from real entries', async t => {
  const { main, warnings } = await page(t, {
    'refs.bib': REAL_BIB,
    'paper.md': `${BIB_KEYS.map(key => `[@${key}]`).join(' ')}\n`,
  });
  const references = main.slice(main.indexOf('<section class="references">'));
  const entry = key => references.slice(references.indexOf(`<li id="ref-${key}">`), references.indexOf('</li>', references.indexOf(`<li id="ref-${key}">`)));
  assert.ok(entry('knuth1974').includes('Donald E. Knuth. Structured Programming with go to Statements. <em>Journal of the ACM Surveys</em>, 261–301, 1974.'), entry('knuth1974'));
  assert.ok(entry('godel').includes('Kurt Gödel, Ana Šašek, et al. Über formal unentscheidbare Sätze &amp; <span class="katex">'), entry('godel'));
  assert.ok(entry('godel').includes('*stars* &lt;b&gt;.'), `bib data is not markup: ${entry('godel')}`);
  assert.ok(entry('godel').includes('<em>Monatshefte</em>, 38(1), 1931.'), entry('godel'));
  assert.ok(entry('godel').includes('<a href="https://doi.org/10.1007/BF01700692">doi:10.1007/BF01700692</a>'), entry('godel'));
  assert.ok(entry('openai').includes('OpenAI. GPT-4 Technical Report. 2023. <a href="https://arxiv.org/abs/2303.08774">arXiv:2303.08774</a>'), entry('openai'));
  assert.equal((entry('openai').match(/<a /g) || []).length, 1, 'a URL repeating the arXiv link is dropped');
  assert.ok(entry('waals').includes('J. D. van der Waals. A book. Pub, 1873.'), entry('waals'));
  assert.ok(entry('thesis').includes('Ludwig van Beethoven. On Music. PhD thesis, Bonn, 1800. Available at. <a href="https://example.com/a_b">'), entry('thesis'));
  assert.ok(!entry('unsafe').includes('javascript:'), entry('unsafe'));
  assert.ok(entry('conf').includes('A. Ed (ed.). Conf. In <em>Proc &amp; Co</em>, pages 1–2, 2001.'), entry('conf'));
  assert.ok(references.includes('[Smi20a]') && references.includes('[Smi20b]'));
  assert.ok(main.includes('href="#ref-same1">[Smi20a]</a>'));
  assert.ok(warnings.includes('reference empty: missing title, author, year'), warnings.join('\n'));
  assert.ok(warnings.some(w => w.startsWith('reference unsafe: not linking javascript:')), warnings.join('\n'));
  for (const bad of ['undefined', '..', '. ,', ' ,', 'null']) {
    assert.ok(!references.replace(/<[^>]*>/g, '').replace(/\.\.\./g, '').includes(bad), `"${bad}" in ${references}`);
  }
});

test('the references heading never takes a section\'s id', async t => {
  const { main, html } = await page(t, {
    'refs.bib': '@book{k, author={A, B}, title={T}, year={2000}}',
    'paper.md': '# References\n\n[@k]\n',
  });
  assert.ok(main.includes('<h1 id="sec-references"><span class="secno">1</span>References</h1>'));
  assert.ok(main.includes('<h1 id="sec-references-2">References</h1>'));
  assert.ok(html.includes('<a href="#sec-references-2">References</a>'));
});

// -- pages and files -------------------------------------------------------------------------

test('a build refuses to write over its own inputs', async t => {
  const dir = project(t, { 'paper.md': 'Precious.\n', 'style.css': 'a{}' });
  const config = await loadConfig(path.join(dir, 'paper.config.mjs'));
  for (const out of ['paper.md', './paper.md', 'paper.config.mjs']) {
    await assert.rejects(build({ ...config, out: path.join(dir, out) }), /would overwrite an input/, out);
  }
  await assert.rejects(build({ ...config, style: path.join(dir, 'style.css'), out: path.join(dir, 'style.css') }), /would overwrite an input/);
  fs.symlinkSync(path.join(dir, 'paper.md'), path.join(dir, 'link.html'));
  await assert.rejects(build({ ...config, out: path.join(dir, 'link.html') }), /would overwrite an input/);
  assert.equal(fs.readFileSync(path.join(dir, 'paper.md'), 'utf8'), 'Precious.\n');
  await build({ ...config, out: path.join(dir, 'new/dir/page.html') });
  assert.ok(fs.existsSync(path.join(dir, 'new/dir/page.html')));
});

test('plugin assets cannot break out of their element', async t => {
  const { html, warnings } = await page(t, {
    'paper.md': 'x\n',
    'plugins/p.mjs': "export const browser = ['./p.js']; export const styles = ['./p.css'];",
    'plugins/p.js': 'globalThis.s = "</script><b>" + "<!--" + "$&$1";',
    'plugins/p.css': '.a::after { content: "</style><i>$&$1"; }',
  });
  assert.deepEqual(warnings, []);
  assert.ok(html.includes('"<\\/script><b>"'));
  assert.ok(html.includes('"<\\!--"'));
  assert.ok(html.includes('"$&$1"'));
  assert.ok(html.includes('"<\\/style><i>$&$1"'));
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
  assert.equal((html.match(/<\/style>/g) || []).length, 1);
});

test('missing style and script files are warnings, not crashes', async t => {
  const { warnings } = await page(t, {
    'paper.config.mjs': "export default { style: 'nope.css' };",
    'paper.md': 'x\n',
    'plugins/p.mjs': "export const browser = ['./gone.js']; export const styles = ['./gone.css'];",
  });
  for (const file of ['nope.css', 'gone.js', 'gone.css']) assert.ok(warnings.some(w => w.includes(file) && w.includes('file not found')), warnings.join('\n'));
});

test('the page says what is broken, and marks drafts all the way through', () => {
  const css = read('assets/theme.css');
  assert.match(css, /\.ref\.bad, \.cite\.bad, \.sn-ref\.bad, \.katex-error \{ color: var\(--error\); \}/);
  assert.match(css, /^\.ai \{ --mark: var\(--ai\); \}$/m);
  // whatever has a colour of its own asks for --mark first
  for (const selector of ['a', 'figure.table figcaption', 'figure.table figcaption b', '.eq .eqno', 'figure.fig .figno', '.sn-ref', '.sn-note .sn-num', '.sn:hover .sn-ref, .sn:hover .sn-note']) {
    const rule = css.slice(css.indexOf(`\n${selector} {`));
    assert.match(rule.slice(0, rule.indexOf('}')), /color: var\(--mark,/, selector);
  }
  assert.doesNotMatch(css, /@media/, 'one layout, for desktop');
  assert.doesNotMatch(css, /\.big\b/);
});

test('the AI draft count reaches the build and the command line', async t => {
  const dir = project(t, { 'paper.md': '::: ai\nOne.\n::: endai\n\n::: ai\nTwo.\n:::\n' });
  const config = await loadConfig(path.join(dir, 'paper.config.mjs'));
  assert.equal((await render(config)).aiDrafts, 2);
  const run = folio([], dir);
  assert.equal(run.status, 0, 'a pending draft is not a warning');
  assert.match(run.stdout, /2 AI drafts pending/);
  fs.writeFileSync(path.join(dir, 'paper.md'), 'None.\n');
  assert.doesNotMatch(folio([], dir).stdout, /AI draft/);
});

// -- plugins ---------------------------------------------------------------------------------

test('failing plugin code is named, and the page falls back to the source', async t => {
  const { main, warnings } = await page(t, {
    'paper.md': '`boom:x` `none:y`\n\n```boom\nf\n```\n\n```none\ng\n```\n\n<!-- hello -->\n\n::: lexfail\nh\n:::\n\n::: renderfail\ni\n:::\n\n::: silent\nj\n:::\n',
    'plugins/p.mjs': `export const spans = {
  boom() { throw new Error('bad span'); },
  none() {},
};
export const fences = {
  boom() { throw new Error('bad fence'); },
  none() {},
};
export const comments = () => { throw new Error('bad comment'); };
export const blocks = {
  lexfail: { lex() { throw new Error('bad lex'); }, render: (t, api) => api.div(t, api.parse(t.tokens)) },
  renderfail: { render() { throw new Error('bad render'); } },
  silent: { render() {} },
};`,
    'plugins/q.mjs': "export const comments = body => `<em>${body.trim()}</em>`;",
  });
  assert.deepEqual([...warnings].sort(), [
    'block kind silent at line 21: render returned no HTML',
    'plugin p, block lexfail line 11: bad lex',
    'plugin p, block renderfail line 12: bad render',
    'plugin p, comments line 9: bad comment',
    'plugin p, fence boom line 6: bad fence',
    'plugin p, span boom line 2: bad span',
  ].sort());
  assert.ok(main.includes('<code>boom:x</code>') && main.includes('<code>none:y</code>'));
  assert.ok(main.includes('<code class="language-boom">f') && main.includes('<code class="language-none">g'), main);
  assert.ok(main.includes('<em>hello</em>'), 'the next comment handler takes over');
  assert.ok(main.includes('<div class="lexfail">\n<p>h</p>'));
  assert.ok(main.includes('<div class="renderfail">\n<p>i</p>'));
  assert.ok(main.includes('<div class="silent">\n<p>j</p>'));
});

test('hooks keep their "this" and may be exported together', async t => {
  const { main, warnings } = await page(t, {
    'paper.md': '`up:a`\n\n::: shout\nb\n:::\n',
    'plugins/p.mjs': `export default {
  prefix: 'pre-',
  spans: { up(arg) { return this.prefix + arg.toUpperCase(); } },
  blocks: { shout: { mark: '!', render(t, api) { return api.div(t, this.mark); } } },
};
export function helper() {}`,
  });
  assert.deepEqual(warnings, []);
  assert.ok(main.includes('pre-A'), main);
  assert.ok(main.includes('<div class="shout">\n!</div>'), main);
});

test('a plugin of the wrong shape is reported, whatever is wrong with it', async t => {
  const { warnings } = await page(t, {
    'paper.md': 'x\n',
    'plugins/a.mjs': `export const spans = { s: 'not a function' };
export const fences = { f: 1 };
export const blocks = { b() {}, c: { render: 1 }, d: { render() {}, lex: 1 } };
export const comments = 'nope';
export const browser = 'one.js';
export const styles = [1];
export const order = 'first';`,
    'plugins/b.mjs': "export const span = {}; export const script = [];",
    'plugins/c.mjs': 'export const nothing = 1;',
    'plugins/d.mjs': 'export default 5;',
    'plugins/e.mjs': 'export const spans = [];',
    'plugins/f.mjs': 'syntax error here\n',
    'plugins/g.mjs': "\n\nthrow new Error('at load');",
  });
  for (const expected of [
    /^plugin a: span s must be a function/, /^plugin a: fence f must be a function/,
    /^plugin a: block b must be an object with a render function/, /^plugin a: block c /, /^plugin a: block d /,
    /^plugin a: comments must be a function/, /^plugin a: browser must be a list of files/, /^plugin a: styles must be a list of files/,
    /^plugin a: order must be a number/,
    /^plugin b: exports span; did you mean spans\?/, /^plugin b: exports script; did you mean browser\?/,
    /^plugin c: exports none of/, /^plugin d: export default must be an object of hooks/,
    /^plugin e: spans must be an object/, /^plugin f.*: /, /^plugin g line 3: at load/,
  ]) assert.ok(warnings.some(w => expected.test(w)), `${expected}\n${warnings.join('\n')}`);
});

// -- command line ----------------------------------------------------------------------------

test('the command line explains what it can\'t do', t => {
  const dir = project(t, { 'paper.md': 'x\n' });
  let run = folio(['-x'], dir);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /unknown option -x; see folio --help\./);
  run = folio(['paper.md'], dir);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /paper\.md is not a config file\..*folio init/);
  run = folio(['a.mjs', 'b.mjs'], dir);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /at most one/);
  run = folio(['missing.config.mjs'], dir);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /config file not found: .*missing\.config\.mjs\. "folio init"/);
  fs.rmSync(path.join(dir, 'paper.md'));
  run = folio([], dir);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /source file not found: .*paper\.md/);
  assert.doesNotMatch(run.stderr, /\n\s+at /, 'no stack trace');
});

test('a mistyped --watch gets a reminder and still builds', t => {
  const dir = project(t, { 'paper.md': 'x\n' });
  const run = folio(['--wacth'], dir);
  assert.equal(run.status, 0);
  assert.match(run.stderr, /did you mean --watch\?/);
  assert.ok(fs.existsSync(path.join(dir, 'paper.html')));
  assert.doesNotMatch(folio(['--width=3'], dir).stderr, /did you mean/);
});

test('a broken config names its file and line', t => {
  const syntax = project(t, { 'paper.config.mjs': 'export default {\n  src: oops oops\n};\n' });
  let run = folio([], syntax);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /^folio: paper\.config\.mjs( line 2)?: /);
  const thrown = project(t, { 'paper.config.mjs': "const a = 1;\nthrow new Error('in config');\n" });
  run = folio([], thrown);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /^folio: paper\.config\.mjs line 2: in config/);
  for (const source of ['export const src = "a.md";', 'export default 5;', 'export default null;']) {
    const shape = project(t, { 'paper.config.mjs': source });
    run = folio([], shape);
    assert.equal(run.status, 1, source);
    assert.match(run.stderr, /paper\.config\.mjs: expected export default \{ src: 'paper\.md'/, source);
  }
  for (const [source, message] of [
    ["export default { style: ['a.css', 'b.css'] };", /style must be one path, as a string/],
    ['export default { src: 5 };', /src must be one path, as a string/],
    ["export default { src: '' };", /src must be a path/],
    ['export default { out: null };', /out must be a path/],
  ]) {
    run = folio([], project(t, { 'paper.config.mjs': source }));
    assert.equal(run.status, 1, source);
    assert.match(run.stderr, message, source);
    assert.doesNotMatch(run.stderr, /\n\s+at /, 'no stack trace');
  }
});

// -- watch -----------------------------------------------------------------------------------

function watcher(t, dir, args = ['--watch']) {
  const child = spawn(process.execPath, [cli, ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { output: '', builds: () => (state.output.match(/ wrote /g) || []).length };
  child.stdout.on('data', data => { state.output += data; });
  child.stderr.on('data', data => { state.output += data; });
  t.after(async () => {
    if (child.exitCode === null) {
      const stopped = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await stopped;
    }
  });
  state.until = async check => {
    const deadline = Date.now() + 10000;
    while (!check()) {
      assert.ok(Date.now() < deadline, `watcher timed out: ${state.output}`);
      await sleep(25);
    }
  };
  return state;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('a plugin that writes files does not make the watcher rebuild forever', async t => {
  const dir = project(t, {
    'paper.md': '`gen:1`\n',
    'data.json': '{}',
    'plugins/gen.mjs': `import fs from 'node:fs';
export const spans = { gen() {
  fs.writeFileSync(new URL('../output.json', import.meta.url), JSON.stringify({ at: Date.now() }));
  fs.writeFileSync(new URL('../data.json', import.meta.url), '{}');
  return 'generated';
} };`,
  });
  const watch = watcher(t, dir);
  await watch.until(() => watch.output.includes('watching '));
  const folders = /watching (.*) … \(/.exec(watch.output)[1].split(', ');
  assert.equal(new Set(folders).size, folders.length, `each folder once: ${watch.output}`);
  await sleep(1500);
  assert.equal(watch.builds(), 1, watch.output);
  fs.appendFileSync(path.join(dir, 'paper.md'), '\nAn edit.\n');
  await watch.until(() => fs.readFileSync(path.join(dir, 'paper.html'), 'utf8').includes('An edit.'));
  await sleep(1000);
  assert.equal(watch.builds(), 2, watch.output);
});

test('the watcher rebuilds for files only a plugin knows about, and survives a failing build', async t => {
  const dir = project(t, {
    'paper.md': '`snippet:x`\n',
    'snippet.txt': 'first',
    'plugins/s.mjs': `import fs from 'node:fs';
export const spans = { snippet: () => fs.readFileSync(new URL('../snippet.txt', import.meta.url), 'utf8') };`,
  });
  const watch = watcher(t, dir, ['-w']);
  await watch.until(() => watch.output.includes('watching '));
  await sleep(1200);
  fs.writeFileSync(path.join(dir, 'snippet.txt'), 'second');
  await watch.until(() => fs.readFileSync(path.join(dir, 'paper.html'), 'utf8').includes('second'));
  await sleep(1200);
  fs.writeFileSync(path.join(dir, 'paper.config.mjs'), 'export default {;');
  await watch.until(() => /folio: paper\.config\.mjs/.test(watch.output));
  fs.writeFileSync(path.join(dir, 'paper.config.mjs'), 'export default {};');
  fs.writeFileSync(path.join(dir, 'paper.md'), '`snippet:x` recovered\n');
  await watch.until(() => fs.readFileSync(path.join(dir, 'paper.html'), 'utf8').includes('recovered'));
});

// -- the project itself ----------------------------------------------------------------------

test('every package in the lock is pinned exactly, directly, so that pins travel with Folio', () => {
  const manifest = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.packages[''].version, manifest.version);
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
  for (const [location, info] of Object.entries(lock.packages)) {
    if (!location) continue;
    const name = location.split('node_modules/').at(-1);
    assert.equal(manifest.dependencies[name], info.version, `${name} must be a direct exact pin`);
    assert.ok(!location.includes('/node_modules/'), `${location} is a second copy`);
    assert.match(info.integrity, /^sha512-/);
  }
  for (const version of Object.values(manifest.dependencies)) assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.ok(!fs.existsSync(path.join(root, 'npm-shrinkwrap.json')), 'npm 12 ignores it, and a Git install always has');
});

test('the project is licensed, and the docs agree on how to start', () => {
  const manifest = JSON.parse(read('package.json'));
  assert.equal(manifest.license, 'MIT');
  assert.match(read('LICENSE'), /^MIT License/);
  assert.ok(manifest.files.every(file => fs.existsSync(path.join(root, file))));
  const command = `npx --yes --ignore-scripts --min-release-age=14 --allow-git=all --package=github:lfrati/folio#v${manifest.version} folio init my-paper`;
  for (const file of ['README.md', 'docs/agents.md', 'docs/getting-started.md', 'examples/showcase/paper.md']) {
    assert.ok(read(file).includes(command), `${file} should say: ${command}`);
  }
});

test('a new project opts in to its Git dependency and points agents at the installed guide', t => {
  const dir = project(t, {});
  fs.rmSync(path.join(dir, 'paper.config.mjs'));
  const run = folio(['init'], dir);
  assert.equal(run.status, 0, run.stderr);
  assert.match(fs.readFileSync(path.join(dir, '.npmrc'), 'utf8'), /^allow-git=all$/m);
  const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.ok(agents.includes('node_modules/@lfrati/folio/docs/agents.md'));
  assert.ok(!agents.includes('github.com'), 'a link would need access to the repository');
  assert.ok(fs.existsSync(path.join(root, 'docs/agents.md')));
});
