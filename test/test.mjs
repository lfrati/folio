// Regression test for the dialect: build test/dialect.md and check the warnings and the markup.
//   node test/test.mjs
import assert from 'node:assert/strict';
import { loadConfig, render } from '@lfrati/folio';

const config = await loadConfig(new URL('./paper.config.mjs', import.meta.url));
const { html, warnings } = await render(config, { snippets: true });
const body = html.slice(html.indexOf('<main>'), html.indexOf('</main>'));

const expectWarnings = [
  '::: endwip at line 86 closes an unclosed lemma',
  'stray ::: endnothing at line 88',
  'stray ::: at line 90',
  'unclosed ::: outer, opened at line 104',
  'sidenote nope has no definition',
  'sidenote unused is never referenced',
  'unknown citation nobody',
  'unresolved reference @lem:missing',
  'duplicate label lem:one at line 94, keeping the first',
];
const katex = warnings.filter(w => w.startsWith('KaTeX: '));
assert.equal(katex.length, 1, 'one KaTeX error expected');
assert.deepEqual(warnings.filter(w => !w.startsWith('KaTeX: ')).sort(), expectWarnings.sort());

const expectMarkup = [
  // title with math, numbered headings and the unnumbered one, the toc
  '<title>Dialect $x$ test</title>',
  '<h1 id="sec-intro"><span class="secno">1</span>Intro</h1>',
  '<h2 id="sec-sub">Sub</h2>',
  '<li class="d1"><a href="#sec-intro"><span class="secno">1</span>Intro</a></li>',
  // inline math survives emphasis rules, ordinary code spans stay code, shortcodes render
  '<span class="katex-mathml">',
  '<code>not:a:shortcode</code>',
  '<b class="box">hello</b>',
  // dashes in prose only
  'dashes—like this–and this',
  // forward references resolved, e-mail-like text untouched
  '<a class="ref" href="#lem:one">Lemma 1</a>', '<a class="ref" href="#eq:main">(1)</a>',
  '<a class="ref" href="#tab:t">Table 1</a>', '<a class="ref" href="#fig:f">Fig. 1</a>',
  '<a class="cite" href="#ref-knuth1974">[Knu74]</a>', 'x@y:z stays',
  // numbered equation
  '<div class="eq" id="eq:main">', '<span class="eqno">(1)</span>',
  // theorem head inside the first paragraph, nested numbered figure, qed at the end of the proof
  '<div class="lemma thm plain" id="lem:one">\n<p><span class="thm-head">Lemma 1 (First).</span> Body of the lemma',
  '<figure class="fig" id="fig:f"><div class="center">', '<span class="figno">Fig. 1</span></figure>',
  '<i>badge</i>', '<p><span class="thm-head">Proof.</span> First line. Last line. <span class="qed"></span></p>',
  // table with caption, comment dropped
  '<figure class="table" id="tab:t">', '<td><b class="box">2</b> </td>', '<figcaption><b>Table 1:</b> A caption with',
  // ralign grid padded to the widest row
  '<div class="ralign" style="grid-template-columns: repeat(3, auto)"><span><b class="box">r1</b></span>', '<span>e</span><span></span></div>',
  // definition style
  '<div class="definition thm defn">',
  // sidenotes: first mention carries the note, later mentions the mark only, missing one flagged
  '<span class="sn"><span class="sn-ref">[1]</span><span class="sn-note"><span class="sn-num">[1]</span>The note, with <a class="ref" href="#lem:one">Lemma 1</a>.</span></span>',
  'again<span class="sn-ref">[1]</span>', '<span class="sn-ref bad">[?]</span>',
  // fences: a plugin fence gets the raw body, a plain fence keeps its comment
  '<pre class="echo">raw <!-- comment kept --> body</pre>', '<code class="language-js">&lt;!-- also kept --&gt; code',
  // ::: endwip closed the wrapper, the stray closers vanished
  '<div class="wip">\n<div class="lemma thm plain">\n<p><span class="thm-head">Lemma 3.</span> Unclosed inner.</p>\n</div>\n</div>',
  // bad math is shown, not swallowed
  '<span class="katex-error"',
  // the unclosed block still renders to the end
  '<div class="outer">\n<p>still open at the end</p>\n</div>',
  // a titled proof: the title stands in for "Proof"; a proof ending in a list or a figure gets its QED on its own line
  '<p><span class="thm-head">Proof of the claim.</span> Text.</p>', '</ol>\n<p> <span class="qed"></span></p>\n</div>',
  '<p>figure</p>\n</div>\n<p> <span class="qed"></span></p>\n</div>',
  // a lemma title is lexed like any inline content (math renders, inline HTML passes as in markdown); a body starting with a list gets a heading paragraph
  '(With <span class="katex">', 'and <b>).</span> </p>\n<ul>',
  // a plugin block kind, numbered as a figure
  '<figure class="fig" id="fig:d"><div class="demo">\n<section><p>Plugin block with <b class="box">in</b>.</p>\n</section></div><span class="figno">Fig. 2</span></figure>',
  // a figure with a Caption: line: the number moves into the caption
  '<figure class="fig captioned" id="fig:c"><div class="center">', '</div><figcaption><b>Fig. 3:</b> Reads <b class="box">in</b>.</figcaption></figure>',
  // references section, plugin assets
  '<section class="references">', '<li id="ref-knuth1974">',
];
for (const s of expectMarkup) assert.ok(body.includes(s) || html.includes(s), `missing: ${s}`);
assert.ok(!body.includes('endnothing') && !body.includes('<!-- dropped -->'), 'stray lines or dropped comments leaked');
assert.ok(html.includes('.box { color: red; }') && html.includes('const demo = 1;'), 'plugin css/js not inlined');
console.log(`ok: ${expectWarnings.length} warnings and ${expectMarkup.length} markup checks`);
