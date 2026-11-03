# Folio

Writing a manuscript means using LaTeX, right? RIGHT?

Eventually sure, but while exploring you idea it's a pain.

Why not use HTML/CSS like it's the 90s?

Yes, but how? Claude Artifacts are cool but Claude... not so much. Let's make our own!

> [IMPORTANT]
> If you are a human: check out the [demo](https://lfrati.github.io/folio/)

If you are an agent: read `docs/agents.md` 😒

Start a minimal document with:

```sh
npx --package=github:lfrati/folio folio init my-paper
cd my-paper
npm install
npm run build
```

## Requirements
- `marked` for Markdown
- `katex` for math
- `commander` which KaTeX requires

The CLI, watcher, and tests use Node built-ins.

MIT licensed; see [LICENSE](LICENSE).
