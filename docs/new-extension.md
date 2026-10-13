# Writing a new extension

This page takes you from "I want a site in Matane Anime" to a merged extension. It is written for people and for AI
assistants alike: every step is a command or a rule you can check. The contract itself (every type and method) is in
the README of [`@matane-anime/extension-sdk`](https://www.npmjs.com/package/@matane-anime/extension-sdk) and in
[`docs/extensions.md`](https://github.com/mataneorg/matane-anime/blob/main/docs/extensions.md) of the app repository;
this page is about the work around it and what to watch for.

The short version:

```sh
node scripts/new-extension.mjs --lang id --id my-site --name "My Site" --url https://my-site.example
pnpm install
# write src/index.ts (+ site.ts, text.ts, streams.ts), save pages under test/fixtures/, write tests, add icon.png
pnpm --filter ./src/id/my-site test
pnpm exec ma-ext test src/id/my-site            # against the real site
pnpm format:check && node scripts/readme-table.mjs && pnpm typecheck && pnpm build && pnpm test
```

## 1. Decide whether the site can be an extension

An extension reads a site the way a visitor's browser does. Do not write one when:

- the video needs an account, a payment or a DRM licence (no paywall bypass, no account sharing);
- the site's terms forbid it;
- the only way to a video is a hoster that the app cannot play (see [Streams](#streams) below), unless the site also
  offers something else.

Everything else is worth looking at. Look **before** you write any code, with `curl` and a browser's network tab. The
questions below decide the design. Ask with a browser User-Agent
(`-A 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'`), the
way the extension will (it sets `userAgent` in its manifest), and try a file with and without `-e https://the-site/` to
learn whether the site checks the referer.

| Question                                    | How to find out                                                                                                                                                                                 | What it changes                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Is the content in the HTML or loaded by JS? | `curl` the home page and the page of one anime; search the text for a title you can see in the browser.                                                                                         | HTML: read with `html.load`. Not there: look for an API (next two rows).        |
| Is there a JSON API?                        | Browser network tab (XHR/Fetch) while you browse, search and open an episode. For a bundled site, download the JS files the page references and `grep -o -h -E '/api/[A-Za-z0-9_/.?=-]+' *.js`. | JSON is easier and sturdier than HTML: prefer it.                               |
| Does the page embed its data?               | Next.js sites put it in the HTML as `self.__next_f.push(...)` strings (quotes escaped as `\"`). Nuxt uses `__NUXT__`; others a `<script type="application/json">`.                              | A last resort for a value no API gives you (an id); a regex, not a parser.      |
| How does paging work?                       | Page 2, the last page, and one past it. Look for a "next" link, `?page=`, a total, or a "load more" button (its handler names the API).                                                         | `hasNextPage`; and whether a long list is complete on one page.                 |
| What does search take?                      | The site's own search box (an API or `?s=`), and whether it filters, pages and handles an empty or one-letter query.                                                                            | `search()` and the filters that apply to it.                                    |
| Where is the video?                         | Open an episode and list what loads: a direct `.mp4`/`.m3u8`, an API that returns mirrors, or an `<iframe>` of a hoster.                                                                        | The hardest part of any extension: see [Streams](#streams).                     |
| Does the file need a Referer or cookie?     | `curl -r 0-1023 -D - -o /dev/null <file>` with and without `-e`. Expect `206` and `Content-Type: video/…` or an HLS playlist (`#EXTM3U`).                                                       | `headers` of the stream.                                                        |
| Is it behind Cloudflare?                    | A `403`/`503` with "Just a moment…" or the header `cf-mitigated: challenge`.                                                                                                                    | Throw `CloudflareError` (the helper below does); the user passes it in the app. |
| Which domain is stable?                     | Mirrors, redirects (`curl -I`), numbered subdomains (`x6.`), a landing page that links to the current one.                                                                                      | The `baseUrl` preference ("Site address"), and urls that are paths.             |

Two traps from experience:

- **Node is not the app.** `ma-ext test` and the unit tests use Node's `fetch`, which a Cloudflare rule can challenge
  by its TLS fingerprint while the app (Chromium's network stack) is let through, or the other way round. A failure in
  Node is a reason to check in the app, not yet a bug (see [section 7](#7-check-it-in-the-app)).
- **A host that redirects everything.** If a hoster answers `301` for every address (even an id that does not exist),
  it is dead for you; do not write a resolver for it.

## 2. Create the project

```sh
node scripts/new-extension.mjs --lang id --id my-site --name "My Site" --url https://my-site.example [--nsfw]
pnpm install
```

- `--lang` is the language of the subtitles (`id`, `en`), or `all` for a site in several languages (`src/all`). It only
  decides the folder; the language of a source is set in the manifest.
- `--id` is lowercase letters, digits and dashes, starting with a letter. **It never changes** (libraries, history and
  downloads refer to it) and carries no language.
- `--url` must be `https`. `--nsfw` is for adult sites (the app hides them unless the user turns them on).

You get `src/<lang>/<id>/` with `manifest.json`, `package.json`, `tsconfig.json`, `src/index.ts` (a skeleton with TODOs),
`test/harness.ts`, `test/source.test.ts`, `test/live.test.ts` and `test/fixtures/`.

Then edit the generated `manifest.json` by hand:

```json
{
  "id": "my-site",
  "name": "My Site",
  "version": "0.1.0",
  "apiVersion": 1,
  "type": "anime",
  "nsfw": false,
  "rateLimit": { "perSecond": 3 },
  "userAgent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "sources": [{ "key": "id", "lang": "id", "name": "My Site (ID)" }]
}
```

- Name the source `"<Site> (<LANG>)"`, like the others. `key` is unique inside the extension.
- `rateLimit.perSecond`: what the site tolerates (2–3 is usual; the default is 10 and too much for most).
- `userAgent`: set a browser's, because many sites and CDNs refuse the default one.
- `version` starts at `0.1.0`. `apiVersion` stays `1`.

Add `icon.png` next to the manifest: **square, 96–256 px, at most 512 KB** (repositories refuse a build without it).
The site's own favicon works; pad it to a square with `magick favicon.png -background none -gravity center -extent 190x190 -resize 192x192 PNG32:icon.png` (here for a 170 × 190 favicon: the extent is its longer side).

## 3. How the code is laid out

Every extension here follows the same layout, so a reader can move between them. Keep to it unless the site is so small
that one file is clearer.

| File                 | What goes in it                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/site.ts`        | `DEFAULT_BASE_URL`, `base()` (reads the `baseUrl` preference), `assertOk()` (maps HTTP statuses to the typed errors), `fetchPage()`, `fetchPageShared()` (one request for the details and the episodes), `fetchJson()`. Copy it from a sibling (`src/id/sokuja/src/site.ts` is the smallest). For a site that is only a JSON API, this file is called `api.ts` (see `src/id/oploverz`). |
| `src/text.ts`        | **Pure** helpers (no host globals): urls and slugs, number and year parsing, status and type mapping, title cleaning, quality labels. Everything here is unit-tested directly.                                                                                                                                                                                                          |
| `src/index.ts`       | `defineExtension({ preferences, createSource })`: the listing, search, filters, details and episodes.                                                                                                                                                                                                                                                                                   |
| `src/streams.ts`     | Everything between an episode and playable urls. The part most likely to change when a site changes, so keep it apart.                                                                                                                                                                                                                                                                  |
| `src/hls-quality.ts` | Only when streams are HLS playlists. Copy it from `src/id/oploverz/src/` and wrap `getStreams` as `labelPlaylists(await getStreams(episode))`: it labels each playlist with its height so the quality menu works.                                                                                                                                                                       |
| `test/`              | `harness.ts` (from the generator), `source.test.ts`, `streams.test.ts`, `text.test.ts`, `live.test.ts`, and `fixtures/`.                                                                                                                                                                                                                                                                |

Rules for the code:

- **`url` is an identity, not an address.** Use a path (`/anime/<slug>/`) or a slug, never a full address: a domain
  change must not break anybody's library. `getWebUrl` builds the address for the browser from `base()`. If the form
  of a url ever changes, add `migrateUrl` so old ones keep working.
- **Episodes come newest first**, and `number` is the episode number (fractional allowed; `1` for a film). Two
  episodes with the same `number` count as one unless `variant` ("Sub", "Dub") tells them apart.
- **Throw the typed errors** (`NotFoundError`, `ParseError`, `CloudflareError`, `RateLimitedError`, `HttpError`,
  `NetworkError`) so the app can say the right thing. A page that no longer looks as expected is a `ParseError` with
  "the site layout changed" in the message, not an empty list: an empty list looks like a site with nothing on it.
  The one exception is a page past the last one, which is simply empty.
- **Fetch with `throwOnError: false` and pass the response to `assertOk()`**, so Cloudflare challenges, 404 and 429 get
  their own errors.
- **Every new anime/episode fact comes from the site.** Do not hard-code qualities, years or titles.
- Write comments that say **why** (a quirk of the site, a limit you hit), not what the line does.

## 4. The methods

| Method               | Returns                  | Notes                                                                                                                                                                                 |
| -------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getPopular(page)`   | `{ items, hasNextPage }` | `page` starts at 1. One request per page; never fetch a detail page per card.                                                                                                         |
| `getLatest(page)`    | same                     | Optional. The site's "recently updated" order.                                                                                                                                        |
| `search(q, page, f)` | same                     | With an empty `q`, use the filters. If the site's search ignores the filters, say so with a `header` filter.                                                                          |
| `getFilters()`       | `Filter[]`               | `select`, `checkbox`, `tristate`, `sort`, `group`, `header`, `separator`. A `default` is sent with every search. Take the option lists from the site's own form, with its own values. |
| `getAnimeDetails(a)` | `AnimeDetails`           | Title, alt titles, description, genres, studio, year, `status`, `type`, cover. Read one page.                                                                                         |
| `getEpisodes(a)`     | `Episode[]`              | Newest first. The app calls it together with `getAnimeDetails`: share the page with `fetchPageShared`. A long series may need an API (see [Pitfalls](#pitfalls)).                     |
| `getStreams(ep)`     | `Stream[]`               | See below. An empty result is a `NotFoundError` with a message that says why.                                                                                                         |
| `resolveUrl(url)`    | `AnimeSummary \| null`   | Turns an address the user pastes into an anime; accept every mirror of the domain.                                                                                                    |
| `getWebUrl(item)`    | address                  | For "open in browser".                                                                                                                                                                |

Add the **Site address** preference to every extension (`type: 'text'`, key `baseUrl`, default `DEFAULT_BASE_URL`), and
read the address only through `base()`.

### Streams

`getStreams` returns `{ url, server, quality?, kind?, headers? }`.

- `kind` is `mp4`, `hls`, or `auto`. Say `hls` for `.m3u8` and `mp4` for a file; the app probes before it plays.
- `quality` is the **height in pixels as a whole number** (`1080`, not `"1080p"` and not `"HD"`). Take it from what the
  site says (a label, a `RESOLUTION` in the playlist), never invent it. The server menu shows it and the user's quality
  preference chooses by it. An HLS master playlist without a `quality` is read by the app only for the stream it opens,
  so label the others yourself (`hls-quality.ts` does it).
- `headers`: what the site's CDN checks, usually `Referer` and `Origin`. Leave it out when the file plays without
  (check with `curl`), because a header forces the app to bridge the request.
- `server` is a name a person recognises ("Sokuja", "Dailymotion", "Blogger"). Keep it short.
- **Embeds.** If the site only gives an `<iframe>` of a hoster, the extension must resolve it down to a direct file
  itself. Resolvers exist in this repository for Blogger, Dailymotion, ok.ru, Pixeldrain, GDrive-style players, players
  hidden in packed JavaScript and more: search `src/*/*/src/streams.ts` for the host name and copy the closest one. A hoster nobody has written yet
  is a real job: study its player page, and say in the error message that the episode "is only on servers the app cannot
  play yet" while the resolver is missing.
- **Several mirrors:** start every resolver at once and return what you have when the first has answered plus a short
  grace period (2.5–3 s); do not make a user wait for the slowest. Keep the order stable (best quality, HLS before
  files that expire).
- A stream that breaks the contract (not an http(s) address, say) is dropped by the app with a warning in the log and
  the rest are kept, but do not rely on that.

## 5. The sandbox, and what it bites

The extension runs in QuickJS: no `fetch`, `require`, `process`, DOM or files. The globals are `http`, `html`,
`storage`, `prefs`, `log`, `crypto`, `base64`, `utf8`, `timers`, plus `URL` and `URLSearchParams`. The limits (per
runtime): 64 MB of memory, **2 s of uninterrupted synchronous code**, 30 s per call (60 s for `getEpisodes`), a bundle of at
most 2 MB, and a result of at most 32 MB.

### Pitfalls

- **The 2-second limit is the one that surprises.** QuickJS is about 50× slower than Node, and `html.load` of a very
  big page is cheap but a loop over thousands of nodes is not. If a page is huge (a series with hundreds of episodes),
  read the text with a regex or find a smaller source (an API) instead of walking a tree. A call that gets
  "interrupted" in the app but works in `ma-ext test` is this.
- **A "load more" list is not complete.** Find the request the button makes (read the page's JS) and use it. Compare the
  count the page declares with the number of items you found.
- **Trailing slashes.** Some sites redirect `/api/x?e=1` to `/api/x/?e=1`; a missing slash can mean a 308 and, from the
  sandbox, a failed request. Copy the address exactly as the site's own JS calls it.
- **Image resizers.** `/_next/image/?url=%2Fuploads%2Fa.webp&w=3840` is the site resizing; the original is the decoded
  `url` parameter. Return the original, not a 3840-pixel render.
- **Embedded Next.js data is escaped:** `\"episodeId\":10372`, so a regex must allow the backslashes
  (`/episodeId\\*"\s*:\s*(\d+)/`).
- **Do not trust one anime.** Try a short series, a very long one, a film, an old one and a brand-new one; hosts and
  layouts often differ by age and kind.
- **Rate limits are shared.** Parallel requests share `rateLimit`; more parallelism than that only queues.
- **Typed errors cross the boundary.** `error.typed` is `'NotFoundError'` etc. on the client side; the tests use it.

## 6. Tests

### Offline tests (run in CI)

They read **saved pages of the real site** and run the extension as the app does (the built bundle in the sandbox).

1. Save the real answers under `test/fixtures/`, **untouched** (`.prettierignore` skips this folder; do not reformat or
   hand-edit a page): `curl -s -A '<browser UA>' -e https://my-site/ '<url>' -o test/fixtures/popular.html.txt`.
   Use `.html.txt` for pages and `.json` for API answers. Cover: a listing page, the last page, a page past the last one,
   a search with results and one without, a short series, a long series, an episode page, and the stream answer. Do
   not commit a page that contains a login, a cookie or anything private.
2. `test/harness.ts` gives you `load(route)`: `route(request)` returns `{ status, text, headers }` for a request or
   `undefined` for an unknown one (which becomes a 500, so a missing mock shows up). Make **one `site` route** that maps
   paths to fixtures and use it in all tests (see `src/id/sokuja/test/source.test.ts`).
3. Test through the client (`client.getPopular(1)`), not by calling internals, and assert the **requests** too
   (`requests[0].url`), so a change of the address is noticed.

What to cover: every listing and its paging (first page, last page, past the end), search (text, filters), details
(every field you fill), episodes (count, order, names, numbers, the long-series path and its failure), streams
(the happy path, an episode with no server, only unsupported servers, a Cloudflare challenge, a page without the id),
`resolveUrl` on each mirror, and the pure helpers in `text.test.ts`. Add a test for every bug you fix, with a fixture
of the page that broke.

### Live tests (not in CI, daily smoke)

`test/live.test.ts` runs only with `LIVE=1` (`pnpm test:live` in the extension): popular, latest, search, a filter,
details, the episodes of a long series, streams, and a `Range` request to each file (expect `206` and a video content
type). A timeout, a 403 or a 429 there is not necessarily your bug. The **Smoke test** workflow runs `ma-ext test` for every
extension every day and opens an issue when one fails.

`pnpm exec ma-ext test src/<lang>/<id> --query "<word>" -v` runs the whole flow (popular → search → details →
episodes → streams) with the app's own result checks and prints your `log` lines.

## 7. Check it in the app

`ma-ext` runs in Node. The app runs the extension in its own sandbox with Chromium's network stack and then plays the
result, so always do this once before you call an extension done.

**By hand:** `pnpm --filter ./src/<lang>/<id> build`, then in Matane Anime turn on Settings → Advanced → Developer mode,
Extensions → **Load from folder** → `src/<lang>/<id>`. Rebuild and the app reloads it; the extension log panel shows
your `log` output.

**Scripted** (a checkout of the [app repository](https://github.com/mataneorg/matane-anime) next to this one):

```sh
cd ../matane-anime-apps
pnpm install
pnpm --filter @matane-anime/desktop verify:live --only my-site --anime 3 --all-streams --oldest   # builds the app first
```

It loads the extension in the real app, browses, searches, opens an episode, plays, and waits for real video frames.
Options: `--only a,b` (extension ids), `--anime N` (N different anime per source), `--all-streams` (open every stream
one by one and report which answer and their quality), `--oldest` (the oldest episode too), `--title "<text>"` (take the
first search hit instead of the first popular anime), `--episode N`, `--play-seconds N`, `--skip-build` (reuse the app build that is already there), `--out DIR`, `--ext-root DIR` (default `../matane-anime-extentions/src`). The report is `apps/desktop/test-results/OUT/live-report.md`.
Needs a display. "plays: yes" is the proof that counts; a single "operation was aborted" is usually a slow first
byte, so run it again before you blame the extension.

## 8. Before you commit

```sh
pnpm exec prettier --write src/<lang>/<id>     # formatting is checked in CI
node scripts/readme-table.mjs                  # regenerates the table in README.md (CI checks it)
pnpm format:check && pnpm typecheck && pnpm build && pnpm test
pnpm repo:build:unsigned                       # builds the whole repository as Publish would; never publish this output
```

- [ ] `id` is new, lowercase, no language, and will never change.
- [ ] `version`: `0.1.0` for a new extension. For **any** change to an existing one, raise it (`0.1.1`, …), or the app
      never offers the change; CI compares with the published repository (`scripts/check-versions.mjs`).
- [ ] `nsfw` is `true` for adult sites. `rateLimit` and `userAgent` are set.
- [ ] `icon.png` is square, 96–256 px, at most 512 KB.
- [ ] Offline tests with saved pages, the live test passes, and `verify:live` shows the episodes **playing** in the app.
- [ ] No secrets, cookies or accounts in the code or the fixtures.
- [ ] If you edit the docs: `docs/*.md` is compiled by Vue, so an `<id>`-style placeholder breaks the site build unless it is inside a code block or a short code span. Check with `node scripts/build-site.mjs`.
- [ ] The commit message is a Conventional Commit (`feat(my-site): add the extension`).

Merging to `main` publishes: CI builds and signs the repository and deploys it to GitHub Pages
([CONTRIBUTING](https://github.com/sikocak221/anime-extension-source/blob/main/CONTRIBUTING.md#publishing)). Do not
push or publish unless the maintainer asked you to.

## 9. When a site changes

1. Reproduce: `pnpm exec ma-ext test src/<lang>/<id> -v`, then `verify:live` for the app side.
2. Save the new page as a fixture and add a test that fails before the fix.
3. Fix it, **raise `version`**, run the checks of the section above.
4. If the domain moved, change `DEFAULT_BASE_URL` (users can also set "Site address" themselves); the urls are paths, so
   libraries survive.

## 10. Worked example: Sokuja

`src/id/sokuja` was written with exactly these steps; read it with this page open.

| Question (section 1) | Answer for `x6.sokuja.uk`                                                                                                                                                                                | Where it ended up                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| HTML or JS?          | A Next.js site rendered on the server: lists and details are in the HTML.                                                                                                                                | `html.load` in `src/index.ts`      |
| Paging               | `/anime/?page=N`; a "Selanjutnya" link exists when there is a next page; a page past the end answers `200` with no cards.                                                                                | `listing()`                        |
| Filters and order    | The selects of `/anime/` are `genre`, `status`, `type`, `order` (`update`, `popular`, …); their option values were copied from the form.                                                                 | `GENRES`, `*_OPTIONS`, `browse()`  |
| Search               | `/?s=<text>&page=N` is a results page with the same cards. (`/api/search/` exists but is a type-ahead of at most 20.)                                                                                    | `search()`                         |
| Details              | `<h1>` (with a " Subtitle Indonesia" suffix), the alt names right after it, `Informasi Anime` as `dl > div > dt/dd`, genres as `a.rounded-full[href^="/genre/"]`, the plot in `.prose`.                  | `getAnimeDetails()`, `readInfo()`  |
| Episodes             | The page lists the newest 50 and says the total ("Daftar Episode (461)"). A button loads the rest from `/api/playlist/?slug=<any episode slug>`, so that is used when the total is bigger.               | `getEpisodes()`                    |
| The video            | The episode page holds `"episodeId":10372`; `/api/video-mirrors/?e=10372` returns direct `.mp4` files on the site's storage, one per quality (`480p`, `720p`, `1080p`), and they play without a Referer. | `src/streams.ts`                   |
| Covers               | `/_next/image/?url=…` is a resizer; the original is the `url` parameter.                                                                                                                                 | `imageUrl()` in `src/text.ts`      |
| Domain               | `x6.` is a numbered mirror and `sokuja.net` redirects to it.                                                                                                                                             | `baseUrl` preference, `resolveUrl` |

The scaffold-to-merge path took: the investigation of section 1 (`curl` on the pages, the site's JS for `/api/`), the
fixtures of section 6 saved from real answers, the tests, `ma-ext test` against the live site, and `verify:live` in the
app, which found a bug the offline tests did not (episode names ending in "Subtitle Indonesia" had no number).

## 11. Troubleshooting

| Symptom                                                    | Likely cause and what to do                                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `ma-ext test` fails with a Cloudflare error, the app works | Node's TLS fingerprint was challenged. Check `verify:live`; do not "fix" the extension.                                                    |
| Works in `ma-ext test`, "interrupted" in the app           | The 2-second synchronous limit. Parse less (a regex or an API instead of walking a big page).                                              |
| A list is shorter than the site says                       | A "load more" or paged list. Find the API the button calls.                                                                                |
| `getStreams` returns urls but nothing plays                | The CDN wants a `Referer`/`Origin` or a cookie (`curl -r 0-1023 -D - -o /dev/null`), or the file expired. Add `headers`, or resolve later. |
| "Only on servers the app cannot play yet"                  | The episode only has a hoster without a resolver. Write one, or accept it and keep the message honest.                                     |
| The quality menu is empty                                  | `quality` is missing: read it from the label or the playlist (`hls-quality.ts`). The app labels only the stream it opens.                  |
| The app does not offer your fix                            | `version` was not raised.                                                                                                                  |
| `format:check` fails on a fixture                          | A fixture was reformatted. Restore it untouched; fixtures are in `.prettierignore`.                                                        |
| `readme-table` check fails                                 | Run `node scripts/readme-table.mjs` and `pnpm exec prettier --write README.md`.                                                            |
