## What and why

<!-- The extension and what changes (a new site, a fix for a broken one). Link the issue: "Closes #123". -->

## How it was tested

<!-- Offline tests with saved pages, and `pnpm exec ma-ext test src/<lang>/<id>` against the real site. -->

## Checklist

- [ ] `pnpm format:check && pnpm typecheck && pnpm build && pnpm test` pass
- [ ] `node scripts/readme-table.mjs` was run (the README table)
- [ ] `version` in `manifest.json` is higher than the published one, for a change to an existing extension
- [ ] `nsfw` is `true` for adult sites; `rateLimit` follows the site's rules
- [ ] Saved pages contain nothing private (no login, cookie or token)
- [ ] No paywall bypass, and nothing the site's terms forbid
