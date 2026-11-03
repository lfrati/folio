// Everything the page inlines so that it stays a single file.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Script } from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

/** KaTeX's stylesheet with its fonts embedded as data URIs. */
export function katexCss(warn) {
  const dist = path.dirname(require.resolve('katex'));
  let css = fs.readFileSync(path.join(dist, 'katex.min.css'), 'utf8');
  css = css.replace(/url\(fonts\/([\w-]+)\.woff2\) format\("woff2"\),url\([^)]*\) format\("woff"\),url\([^)]*\) format\("truetype"\)/g,
    (_, name) => {
      const b64 = fs.readFileSync(path.join(dist, 'fonts', `${name}.woff2`)).toString('base64');
      return `url(data:font/woff2;base64,${b64}) format("woff2")`;
    });
  if (/url\(fonts\//.test(css)) warn('katex.css still references external fonts');
  return css;
}

/** Concatenate scripts for the page. A top-level `export` is stripped so that an ES
 *  module used by the build can also run inline in the browser. */
export function bundleScripts(files, warn = () => {}) {
  const script = files.map(f => fs.readFileSync(f, 'utf8').replace(/^export ((?:async )?function |const |let |class )/gm, '$1')).join('\n;\n');
  try { new Script(script); }
  catch (error) {
    warn(`browser scripts: ${error.message}; use plain scripts without imports, default exports, or duplicate top-level names`);
  }
  return script;
}

export function readAll(files) {
  return files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
}

const IMAGE_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.avif': 'image/avif', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
};

/** Embed local Markdown images relative to the source document; retain remote URLs. */
export function imageResolver(sourceFile, warn) {
  const files = new Set();
  const cache = new Map();
  function resolve(href) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href) && !href.startsWith('file:')) return href;
    try {
      const url = new URL(href, pathToFileURL(sourceFile));
      const file = fileURLToPath(url);
      files.add(file);
      if (!cache.has(file)) {
        const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
        if (!type) throw new Error('unsupported image format');
        cache.set(file, `data:${type};base64,${fs.readFileSync(file).toString('base64')}`);
      }
      return cache.get(file) + url.hash;
    } catch (error) {
      warn(`image ${href}: ${error.message}`);
      return href;
    }
  }
  return { resolve, files };
}
