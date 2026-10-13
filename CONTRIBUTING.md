# Contributing

Extensions are small TypeScript projects that run in Matane Anime's sandbox (QuickJS, no Node.js APIs, the network only through the app). The reference is `docs/extensions.md` in the [app repository](https://github.com/mataneorg/matane-anime) and the README of [`@matane-anime/extension-sdk`](https://www.npmjs.com/package/@matane-anime/extension-sdk).

## Setup

```sh
pnpm install
pnpm build                # ma-ext build in every extension
pnpm test                 # every extension, against saved pages of its site
pnpm repo:build:unsigned  # the whole repository into public/, as it would be published (never publish this one)
```

## A new extension

The full guide is [docs/new-extension.md](docs/new-extension.md): how to investigate a site, the layout, the pitfalls, the tests and a worked example (`src/id/sokuja`). AI assistants: start with [AGENTS.md](AGENTS.md). In short:

```sh
node scripts/new-extension.mjs --lang en --id my-site --name "My Site" --url https://my-site.example
pnpm install
```

It creates `src/en/my-site` (`src/<lang>/<id>`; multi-language sites go in `src/all`) with the manifest, a source to fill in, and test and live-test skeletons. The SDK version comes from the `catalog:` in `pnpm-workspace.yaml`.

Develop with the app: build it (`pnpm --filter ./src/en/my-site build`), then in Matane Anime turn on Developer mode (Settings → Advanced) and **Load from folder** → `src/en/my-site`. Check the whole reading flow against the real site with `pnpm exec ma-ext test src/en/my-site`.

Tests read **saved pages** of the real site: save the markup untouched under `test/fixtures/` and let the extension parse it, as the existing ones do (`test/harness.ts` answers requests from them). Do not commit a page that contains a login, a cookie or anything private.

## Checklist for a pull request

- [ ] `id` is new, lowercase, without a language, and will never change.
- [ ] `version` in `manifest.json` is higher than the published one for a change to an existing extension (CI checks this against the published repository).
- [ ] `nsfw` is `true` for adult sites.
- [ ] `rateLimit` follows the site's rules.
- [ ] `url` values are stable. If their form changes, `migrateUrl` handles every older version.
- [ ] `icon.png`: square, 96–256 px, at most 512 KB, and **not the site's logo**: make a neutral one with `node scripts/make-icons.mjs <id>`.
- [ ] `pnpm format:check && pnpm typecheck && pnpm build && pnpm test` pass, and `node scripts/readme-table.mjs` was run.
- [ ] Offline tests with saved pages, and `ma-ext test` passes against the real site.
- [ ] No paywall bypass, no account sharing, and nothing the site's terms forbid.

## Publishing

Merging to `main` publishes: CI builds every extension, signs the index with this repository's key (the `MA_REPO_KEY` secret) and deploys it with the site to GitHub Pages. Nobody signs anything by hand, and an unsigned or wrongly signed repository is never published. See the README for the one-time setup.
