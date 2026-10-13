# Anime Extension Source

Extensions (sources) for a compatible app, built and tested with its published SDK packages from npm.

Every index of this repository is signed (Ed25519) with this repository's own key, and every archive must match the
SHA-256 in that signed index before the app installs it. Nothing is added to the app by default: add the repository
yourself, then choose to trust its key.

> [!IMPORTANT]
> This repository is independent of the app. The app ships no sources and does not suggest any. This repository
> contains source code only: the developers do not host, store, index or distribute any content, and have no
> affiliation with, or endorsement of, any third-party site. You are responsible for what you access; please respect
> the creators and the laws of your country. Rights holders: see [TAKEDOWN.md](TAKEDOWN.md).

## Add it to your app

**Repository URL:** `https://sikocak221.github.io/anime-extension-source/` (the [site](https://sikocak221.github.io/anime-extension-source/)
shows the signing key and the extension list).

In the app: Extensions → Repositories → Add repository, paste the URL, compare the key with the one below, and choose
_Trust this key_.

```
Signing key:  ed25519:77990b84d115bfe5a894e18c6259e8c13249dc44cb0f98de85fee91a57f5d2dc
Fingerprint:  ed25519:7799…d2dc
```

## Extensions

<!-- extensions:start -->

| Extension       | Languages | 18+ |
| --------------- | --------- | --- |
| Alqanime        | ID        |     |
| Animasu         | ID        |     |
| AnimeGG         | EN        |     |
| AnimeHeaven     | EN        |     |
| Animeindo       | ID        |     |
| AnimeKhor       | MULTI     |     |
| AnimeNoSub      | EN        | yes |
| AnimeParadise   | EN        |     |
| AnimeX          | EN        |     |
| AnimeXin        | MULTI     |     |
| AniSail         | ID        |     |
| AniZone         | EN        |     |
| Anoboy          | ID        |     |
| Donghive        | ID        |     |
| DonghuaStream   | MULTI     |     |
| Gogoanime       | EN        |     |
| Gomunime        | ID        |     |
| KickAssAnime    | EN        |     |
| Kuramanime      | ID        |     |
| Kuronime        | ID        |     |
| LMAnime         | EN        |     |
| Lucifer Donghua | EN        |     |
| Nimegami        | ID        |     |
| Oploverz        | ID        |     |
| Otakudesu       | ID        |     |
| Samehadaku      | ID        |     |
| Sokuja          | ID        |     |

<!-- extensions:end -->

## Develop

Node 24 and pnpm 12 (see `.node-version` and `packageManager`). The extensions are a pnpm workspace under
`src/<language>/<id>`; `src/all` is for sites in several languages.

```sh
pnpm install
pnpm build                 # ma-ext build in every extension: dist/ next to each manifest
pnpm typecheck
pnpm test                  # offline, against saved pages of the real sites (test/fixtures)
pnpm repo:build:unsigned   # the whole repository into public/, as it would be published (never publish this one)
```

Work on one extension: `pnpm --filter ./src/en/gogoanime test`. A new one:
`node scripts/new-extension.mjs --lang en --id my-site --name "My Site" --url https://my-site.example`. How to
write one, step by step: [docs/new-extension.md](docs/new-extension.md); the pull request checklist is in
[CONTRIBUTING.md](CONTRIBUTING.md); AI assistants start with [AGENTS.md](AGENTS.md).

The SDK version of every extension is set once, in the `catalog:` of `pnpm-workspace.yaml`.

### Live tests

`pnpm test:live` (or `scripts/live.sh`) reads what each extension is written for, over the network. A timeout, a 403 or a rate limit there is not
necessarily a bug in the extension. The **Smoke test** workflow runs it every day and opens an issue for each
extension that fails.

## Publish

Merging to `main` publishes: the **Publish** workflow builds every extension, signs the index with this repository's
key and deploys the result to GitHub Pages. Nobody signs anything by hand, and an unsigned or wrongly signed repository
is never published.

The SHA-256 and size of every archive and icon are written into `index.json` by `ma-ext repo build`. The signature
is an Ed25519 signature of the exact bytes of `index.json`, so it needs a key, made once:

1. **Make the key** on your own computer, never in CI: `pnpm exec ma-ext repo keygen --out keys`. It writes
   `keys/repo-key.pem` (private) and `keys/repo-key.pub` (public); `keys/` and `*.pem` are git-ignored. Back the private
   key up somewhere safe: if it is lost, every user has to remove the repository and add it again.
2. **GitHub, once.** Settings → Pages → Source: _GitHub Actions_. Settings → Secrets and variables → Actions:
   - secret `MA_REPO_KEY`: the contents of `repo-key.pem`
   - variable `MA_REPO_PUBLIC_KEY`: the contents of `repo-key.pub` (the build is checked against it, so a wrong secret
     cannot go live)
   - variable `REPO_URL`: `https://sikocak221.github.io/anime-extension-source/` (CI compares versions with it)

   Settings → Environments → `github-pages`: add a required reviewer, because whoever can change the workflow can read
   the key.

3. **Tell users the key** in the section above, so they can compare it with what the app shows.

The index `serial` is the build time in seconds, so it always goes up (apps refuse a lower one). A changed
extension needs a higher `version` in its `manifest.json`, or the app never offers the change; CI checks this against
the published repository.

## License

[MIT](LICENSE).
