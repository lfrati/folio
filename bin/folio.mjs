#!/usr/bin/env node
import { run } from '../src/index.mjs';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: folio [paper.config.mjs] [--watch] [--flag=value]

Build a Markdown document into one self-contained HTML file.
The config defaults to paper.config.mjs in the current directory.
--watch rebuilds when the source, config, styles, or plugins change.
Other --flags are passed to plugins. Build warnings cause a nonzero exit.`);
} else {
  try {
    const positional = args.filter(a => !a.startsWith('--'));
    if (positional.length > 1) throw new Error('Expected at most one configuration file; see folio --help.');
    await run(positional[0] || 'paper.config.mjs', args.filter(a => a.startsWith('--')));
  } catch (error) {
    console.error(`folio: ${error.message}`);
    process.exitCode = 1;
  }
}
