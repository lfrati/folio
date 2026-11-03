#!/usr/bin/env node
import { run } from '../src/index.mjs';
import { initProject } from '../src/init.mjs';

const args = process.argv.slice(2).map(arg => (arg === '-w' ? '--watch' : arg));
if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: folio [paper.config.mjs] [--watch] [--flag=value]
       folio init [directory]

Build a Markdown document into one self-contained HTML file.
The config defaults to paper.config.mjs in the current directory.
--watch (-w) rebuilds when the source, config, styles, plugins, or images change.
Other --flags are passed to plugins. Build warnings cause a nonzero exit.

init creates a minimal project in the given directory (default: current directory).
It includes a Hello, world document, config, npm scripts, and agent instructions.
Existing files are preserved; dependencies are installed separately with npm install.`);
} else {
  try {
    if (args[0] === 'init') {
      const rest = args.slice(1);
      if (rest.length > 1 || rest.some(arg => arg.startsWith('-'))) throw new Error('Usage: folio init [directory]');
      const { directory, files } = initProject(rest[0]);
      const quote = text => "'" + text.replaceAll("'", "'\\''") + "'";
      console.log(`Created ${directory}:\n${files.map(file => `  ${file}`).join('\n')}\n\nNext:`);
      if (directory !== process.cwd()) console.log(`  cd ${quote(directory)}`);
      console.log('  npm install\n  npm run build\n\nOpen paper.html, or run npm run watch while editing.');
    } else {
      const option = args.find(arg => /^-(?!-)/.test(arg));
      if (option) throw new Error(`unknown option ${option}; see folio --help.`);
      const positional = args.filter(arg => !arg.startsWith('--'));
      if (positional.length > 1) throw new Error('Expected at most one configuration file; see folio --help.');
      const config = positional[0] || 'paper.config.mjs';
      if (!/\.m?js$/.test(config)) throw new Error(`${config} is not a config file. Folio builds from a config such as paper.config.mjs, whose src names the document; folio init creates one.`);
      await run(config, args.filter(arg => arg.startsWith('--')));
    }
  } catch (error) {
    console.error(`folio: ${error.message}`);
    process.exitCode = 1;
  }
}
