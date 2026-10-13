# Guide for AI assistants (and a short map for people)

This repository holds the extensions (sources) of a compatible app: one small
TypeScript project per site under `src/<language>/<id>` (`src/all` for multi-language sites), built with the published
`@matane-anime/extension-*` packages and signed and published to GitHub Pages when `main` changes.

**To add or change an extension, read [`docs/new-extension.md`](docs/new-extension.md) first.** It has the research
recipe, the file layout, the contract, the pitfalls, the tests and the checklist, with `src/id/sokuja` as a worked example.
Other docs: [`CONTRIBUTING.md`](CONTRIBUTING.md) (pull request checklist, publishing), [`README.md`](README.md).

## Commands

```sh
pnpm install
node scripts/new-extension.mjs --lang id --id my-site --name "My Site" --url https://my-site.example   # scaffold
pnpm --filter ./src/id/my-site build | typecheck | test | test:live                                    # one extension
pnpm exec ma-ext test src/id/my-site --query "word" -v         # whole flow against the real site (Node)
pnpm exec prettier --write src/id/my-site
node scripts/readme-table.mjs                                  # README table from the manifests (CI checks it)
pnpm format:check && pnpm typecheck && pnpm build && pnpm test # everything, as CI runs it
pnpm repo:build:unsigned                                       # the repository as Publish builds it (never publish this)
```

Playing in the real app: load the built extension from its folder in the app's developer mode and play an episode.

## Rules

- **Look at the real site before writing code** (section 1 of the guide), and prove a change with the site, not by
  assumption: `ma-ext test` for the flow, and playing it in the app for "it actually plays". Do not claim a host works unless a
  file of it was opened.
- **Fixtures are real and untouched.** Save pages with `curl` under `test/fixtures/`; never edit or reformat them
  (`.prettierignore` skips them) and never commit one with a login, cookie or other private data.
- **Raise `version` in `manifest.json` (and `package.json`) for every change to an existing extension**, or the app never
  offers it. A new extension starts at `0.1.0`. The `id` never changes.
- **`url` values are paths or slugs**, never full addresses; the domain is a `baseUrl` preference.
- **Qualities are read from the site** (a label, a playlist `RESOLUTION`), as whole numbers of pixels. Never hard-code
  or guess one.
- **No secrets, accounts, cookies, paywall bypasses or anything the site's terms forbid.** Adult sites set `nsfw: true`.
- The code runs in QuickJS: no `fetch`, `require`, `process` or DOM, 2 s of synchronous code, 64 MB. Do not walk a huge
  page node by node; use a regex or an API.
- Copy-pasted helpers (`site.ts`, `hls-quality.ts`) are per extension on purpose: there is no shared package. A fix to
  one belongs in the others that have the same code (search for it).
- **Do not commit, push or publish unless the maintainer asks.** Merging to `main` publishes the repository.
  Commit messages are Conventional Commits (`feat(my-site): …`, `fix(my-site): …`) with no attribution lines.
