import fs from 'node:fs';
import path from 'node:path';

const packageInfo = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/** Create a minimal document project; preflight all files before writing anything. */
export function initProject(target = '.') {
  const directory = path.resolve(target);
  const name = path.basename(directory).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[._-]+|[._-]+$/g, '').slice(0, 214) || 'folio-paper';
  const manifest = {
    name, private: true, type: 'module',
    scripts: { build: 'folio', watch: 'folio --watch' },
    engines: { node: '>=20' },
    dependencies: { '@lfrati/folio': `github:lfrati/folio#v${packageInfo.version}` },
  };
  const files = {
    'package.json': JSON.stringify(manifest, null, 2) + '\n',
    'paper.config.mjs': "export default {\n  src: 'paper.md',\n  out: 'paper.html',\n};\n",
    'paper.md': '---\ntitle: Hello, world\n---\n\n# Hello\n\n::: ai\nHello, world! Start writing here.\n::: endai\n',
    '.gitignore': 'node_modules/\n/paper.html\n',
    '.npmrc': 'min-release-age=14\nignore-scripts=true\nsave-exact=true\n',
    'AGENTS.md': `# Writing this document

- Read the [Folio agent guide](https://github.com/lfrati/folio/blob/v${packageInfo.version}/docs/agents.md) for syntax and workflow.
- Edit \`paper.md\` and \`paper.config.mjs\`; \`paper.html\` is generated output.
- Wrap new AI-written prose and substantive rewrites in \`::: ai\` … \`::: endai\`.
- Preserve AI markers until the human explicitly accepts that text; a successful build is not acceptance.
- Keep edits small and preserve human text outside the requested change.
- Commit the lockfile after the first install; use \`npm ci\` for repeat installs and keep dependency versions pinned.
- Run \`npm run build\` after edits and resolve build warnings. Use \`npm run watch\` while writing.
`,
  };
  const conflicts = [];
  for (const name of Object.keys(files)) {
    try { fs.lstatSync(path.join(directory, name)); conflicts.push(name); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (conflicts.length) throw new Error(`Cannot initialize ${directory}: already contains ${conflicts.join(', ')}. Choose a new directory.`);

  fs.mkdirSync(directory, { recursive: true });
  const created = [];
  try {
    for (const [name, contents] of Object.entries(files)) {
      const file = path.join(directory, name);
      fs.writeFileSync(file, contents, { flag: 'wx' });
      created.push(file);
    }
  } catch (error) {
    for (const file of created) fs.unlinkSync(file);
    throw error;
  }
  return { directory, files: Object.keys(files) };
}
