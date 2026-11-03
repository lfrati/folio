// A small bibtex reader and the References section.

import fs from 'node:fs';
import { bibLabel } from './render.mjs';

/** Parse a .bib file into a Map of key -> { type, ...fields }. Missing file: empty map. */
export function loadBib(file) {
  const entries = new Map();
  if (!file || !fs.existsSync(file)) return entries;
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/@(\w+)\s*\{\s*([^,\s]+)\s*,([\s\S]*?)\n\}/g)) {
    const fields = {};
    for (const f of m[3].matchAll(/(\w+)\s*=\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)) fields[f[1]] = f[2];
    entries.set(m[2], { type: m[1], ...fields });
  }
  return entries;
}

function formatAuthors(a) {
  return a.split(' and ').map(n => {
    const [last, first] = n.split(',').map(s => s.trim());
    return first ? `${first} ${last}` : last;
  }).join(', ');
}

/** The References section for the cited keys, or '' if nothing was cited. */
export function renderBibliography(bib, cited, parseInline) {
  if (!cited.size) return '';
  const items = [...cited].sort().map(key => {
    const e = bib.get(key);
    const title = parseInline(e.title.replace(/[{}]/g, ''));
    let where = e.journal ? `<em>${e.journal}</em>` : '';
    if (e.volume) where += `, ${e.volume}` + (e.number ? `(${e.number})` : '');
    if (e.pages) where += `:${e.pages.replace('--', '–')}`;
    const doi = e.doi ? ` <a href="https://doi.org/${e.doi}">doi:${e.doi}</a>` : '';
    return `<li id="ref-${key}"><span>[${bibLabel(e)}]</span><span>${formatAuthors(e.author)}. ${title}. ${where}, ${e.year}.${doi}</span></li>`;
  });
  return `<section class="references"><h1 id="sec-references">References</h1><ol>${items.join('')}</ol></section>`;
}
