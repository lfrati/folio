# Dependencies

Folio has two direct dependencies and no development dependencies. Use Node built-ins for argument handling, watching, filesystem access, tests, and packaging; add another package only when a concrete requirement cannot reasonably use the existing code or platform.

## Reviewed versions

Reviewed on 2026-11-03.

| Package | Version | Published | Purpose | License |
| --- | --- | --- | --- | --- |
| [marked](https://github.com/markedjs/marked) | 18.0.10 | 2026-08-18 | Markdown lexer/parser and extension API | MIT |
| [katex](https://github.com/KaTeX/KaTeX) | 0.18.4 | 2026-08-10 | Build-time math rendering, CSS, and fonts | MIT |
| [commander](https://github.com/tj/commander.js) | 8.3.0 | 2021-10-22 | KaTeX's transitive CLI dependency | MIT |

Folio does not use Commander: KaTeX's `cli.js` imports it, but the rendering entry point does not. Removing it from the install would require maintaining a repackaged KaTeX; we retain this one upstream dependency rather than maintaining a fork.

Folio's own CLI, watch mode, initializer, and tests need no additional packages. The generated document embeds rendered math, CSS, and fonts without fetching these packages or loading third-party scripts from a CDN.

## Pins and installation

`package.json` pins both direct versions exactly. [`npm-shrinkwrap.json`](../npm-shrinkwrap.json) records all three versions, registry tarball URLs, and SHA-512 integrity hashes, and is explicitly included in the package so the same locked dependency subtree travels with Folio.

A normal `package-lock.json` does not travel with an installed package. We intentionally use [npm's publishable lockfile](https://docs.npmjs.com/cli/v11/configuring-npm/npm-shrinkwrap-json/) for this document-building tool; changing its dependencies requires a reviewed Folio release, including when using the JavaScript API.

The starter pins a Folio Git tag. Commit the consumer's generated `package-lock.json` to also lock the Git commit, and use `npm ci` on subsequent installs.

The repository and starter `.npmrc` set `save-exact=true`, `ignore-scripts=true`, and `min-release-age=14`. The 14-day cooling-off period complements the reviewed versions and integrity checks; the documented `npx` bootstrap applies the same install-script and age settings to that single command. npm measures `min-release-age` in days, not minutes.

## Review results

- All three package manifests point to their expected upstream repositories and use MIT licenses. None declares a `preinstall`, `install`, or `postinstall` hook; KaTeX declares a development `prepare` hook, which our installation commands disable.
- `npm audit` reports zero known vulnerabilities for this dependency tree.
- `npm audit signatures` verifies all three registry signatures and Marked's provenance attestation. KaTeX and Commander do not publish provenance attestations for these versions.
- The recent [Marked recursion advisory](https://github.com/markedjs/marked/security/advisories/GHSA-6v9c-7cg6-27q7) affects 18.0.0–18.0.1 and is fixed in 18.0.2; our 18.0.10 pin includes the fix.
- The recent [KaTeX prototype-pollution trust bypass advisory](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-238p-pmpm-9mq7) is fixed in 0.18.2; our 0.18.4 pin includes the fix.
- The package installation test checks the shipped lock, installed dependency versions and integrity hashes, and a build from a freshly initialized project.

This is a manifest, entry-point, provenance, and known-advisory review, not a complete source-code security audit. Folio compiles trusted local documents: Markdown permits raw HTML, and project plugins execute JavaScript, so it is not an untrusted-upload sandbox or HTML sanitizer.

## Updating dependencies

1. Check the concrete reason for the change, upstream release notes and advisories, licenses, new transitive packages, and installation hooks.
2. Install the reviewed exact version with scripts disabled; inspect the `package.json` and `npm-shrinkwrap.json` diff, including URLs and integrity hashes.
3. Run `npm ci`, `npm audit`, `npm audit signatures`, `npm test`, and `npm run build:demo`. Inspect a desktop build if rendering changed.
4. Update this review and release a new Folio version. Update consumers deliberately, commit their lockfiles, and verify their documents still build.
