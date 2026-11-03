# Working on Folio

- `src/` contains the reusable renderer, asset handling, and project initializer; `bin/folio.mjs` is the CLI.
- `assets/` contains the default theme and document navigation; project-specific behavior belongs in plugins.
- `docs/agents.md` is the authoring entry point for agents. The desktop showcase is the primary guide for humans.
- For prose drafted into a user's manuscript, use `::: ai` … `::: endai` and preserve the marker until the human accepts the text. Documentation and syntax examples should explain and demonstrate that convention.
- Keep `folio init` minimal and preserve existing files. Generated projects must build using the installed package without reaching back into this checkout.
- Run `npm test` for engine or CLI changes and `npm run build:demo` for showcase changes. Use desktop browser checks for layout and interactions.
- Keep the README concise, with at most two sentences per feature; detailed instructions belong in `docs/`.
- Keep dependencies minimal: use Node built-ins for tooling, justify additions by a concrete need, and follow `docs/dependencies.md` when changing the shipped dependency lock.
