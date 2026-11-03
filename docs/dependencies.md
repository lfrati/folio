# Dependencies

Folio has three direct dependencies and no development dependencies. Use Node built-ins for argument handling, watching, filesystem access, tests, and packaging; add another package only when a concrete requirement cannot reasonably use the existing code or platform.

## Reviewed versions

Reviewed on 2026-11-03.

| Package | Version | Published | Purpose | License |
| --- | --- | --- | --- | --- |
| [marked](https://github.com/markedjs/marked) | 18.0.10 | 2026-08-18 | Markdown lexer/parser and extension API | MIT |
| [katex](https://github.com/KaTeX/KaTeX) | 0.18.4 | 2026-08-10 | Build-time math rendering, CSS, and fonts | MIT |
| [commander](https://github.com/tj/commander.js) | 8.3.0 | 2021-10-22 | Required by KaTeX's CLI; pinned here, not used by Folio | MIT |

Folio does not use Commander: KaTeX's `cli.js` imports it, but the rendering entry point does not. Removing it from the install would require maintaining a repackaged KaTeX; we retain this one upstream dependency rather than maintaining a fork.

Folio's own CLI, watch mode, initializer, and tests need no additional packages. The generated document embeds rendered math, CSS, and fonts without fetching these packages or loading third-party scripts from a CDN.

## What freezes the versions

**Exact direct pins are what travel with Folio.** npm reads a dependency's `package.json` wherever the package comes from, so all three versions are pinned there. KaTeX asks for `commander` at `^8.3.0`, and a direct pin is what makes npm settle on 8.3.0 instead of the newest 8.x. Every package in the lockfile must be a direct exact pin, and a test enforces that, so a future dependency of a dependency can't drift unnoticed.

**A project's own lockfile is the real freeze.** The starter pins a Folio Git tag. Commit the project's generated `package-lock.json` to lock the Git commit and every version and integrity hash, and use `npm ci` on subsequent installs.

**One exception needs that lockfile.** If a project also requires `commander` from another major version, npm can't share one copy, and KaTeX gets its own newest 8.x until a lockfile records it.

**Folio's `package-lock.json` is for developing Folio.** npm ignores a dependency's `package-lock.json`, so it isn't included in the package. Folio doesn't ship an `npm-shrinkwrap.json` either. npm honors one only when the registry says a package has it, so it has no effect on a Git or tarball install, and [npm 12 no longer loads it at all](https://github.blog/changelog/2026-06-09-upcoming-breaking-changes-for-npm-v12/).

## Installation settings

The repository and starter `.npmrc` set `save-exact=true`, `ignore-scripts=true`, and `min-release-age=14`; the documented `npx` bootstrap applies the same install-script and age settings to that single command. npm measures `min-release-age` in days, and npm 10 ignores the setting without saying so, so the age check needs npm 11 or newer.

[npm 12 refuses Git dependencies by default](https://github.blog/changelog/2026-06-09-upcoming-breaking-changes-for-npm-v12/), and a Folio project depends on Folio's Git tag. The bootstrap command and the starter `.npmrc` both opt in with `allow-git=all`, because npm 11.12 rejects `root` for this install. The setting also permits Git dependencies of dependencies, so a project's lockfile is what shows if one appears.

The bootstrap, `npm install`, `npm run build`, and `npm ci` were tested with these settings on npm 10.9.9, 11.12.1, 11.21.1, and 12.2.1.

## Review results

- All three package manifests point to their expected upstream repositories and use MIT licenses. None declares a `preinstall`, `install`, or `postinstall` hook; KaTeX declares a development `prepare` hook, which our installation commands disable.
- `npm audit` reports zero known vulnerabilities for this dependency tree.
- `npm audit signatures` verifies all three registry signatures and Marked's provenance attestation. KaTeX and Commander do not publish provenance attestations for these versions.
- The recent [Marked recursion advisory](https://github.com/markedjs/marked/security/advisories/GHSA-6v9c-7cg6-27q7) affects 18.0.0–18.0.1 and is fixed in 18.0.2; our 18.0.10 pin includes the fix.
- The recent [KaTeX prototype-pollution trust bypass advisory](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-238p-pmpm-9mq7) is fixed in 0.18.2; our 0.18.4 pin includes the fix.
- The package installation test checks the lockfile against the pins, the installed versions and integrity hashes, and a build from a freshly initialized project.

This is a manifest, entry-point, provenance, and known-advisory review, not a complete source-code security audit. Folio compiles trusted local documents: Markdown permits raw HTML, and project plugins execute JavaScript, so it is not an untrusted-upload sandbox or HTML sanitizer.

## Updating dependencies

1. Check the concrete reason for the change, upstream release notes and advisories, licenses, new transitive packages, and installation hooks.
2. Install the reviewed exact version with scripts disabled; inspect the `package.json` and `package-lock.json` diff, including URLs and integrity hashes. Any new package in the lock must be added to `package.json` as an exact pin too.
3. Run `npm ci`, `npm audit`, `npm audit signatures`, `npm test`, and `npm run build:demo`. Inspect a desktop build if rendering changed.
4. Update this review and release a new Folio version. Update consumers deliberately, commit their lockfiles, and verify their documents still build.
