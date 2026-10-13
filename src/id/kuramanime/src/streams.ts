import '@matane-anime/extension-sdk/globals';
import { type Episode, type HtmlElement, type Stream, NotFoundError, ParseError } from '@matane-anime/extension-sdk';
import { assertOk, base, fetchPage } from './site';
import { cookieHeader, isEpisodePath } from './text';

// How an episode plays (read from the site scripts `anime-episode.min.js`, `arc-signal.min.js`, `leviathan.js`):
//  1. The episode page holds no video, only `#changeServer` (the server list) and `data-kk="<name>"` on the
//     breadcrumb. The page sets a session cookie, which every later request must send (the CLI keeps no cookies,
//     hence the explicit `Cookie` header).
//  2. `/assets/js/<name>.js` is a plain script that sets `process.env` (`MIX_*` keys): the route of the token file,
//     a key and a token for the `X-Fuck-ID` header, and the names of the two query parameters of step 4. It is read
//     as text, never run.
//  3. `GET /assets/<route>.txt` with `X-Fuck-ID: <MIX_AUTH_KEY>:<MIX_AUTH_TOKEN>` answers a page token (plain text,
//     bound to the session).
//  4. `POST <episode page>?<MIX_PAGE_TOKEN_KEY>=<page token>&<MIX_STREAM_SERVER_KEY>=<server>` with the form field
//     `authorization=<AUTHORIZATION>` answers the page again, now with the player filled in: `<source src size>`
//     tags (mp4 ladder) for `kuramadrive` and `kuramadrive-v2`, an `<iframe>` for the third-party hosts (mega,
//     streamwish, filemoon, doodstream…). The field `authorization` is a literal of the obfuscated `leviathan.js`
//     (`jLoadSecure`); the site accepts nothing else.
// Only the kuramadrive servers are read: the third-party hosts need JavaScript, so they are skipped.

/** The `authorization` form field `jLoadSecure` of `leviathan.js` sends with every protected page load. */
export const AUTHORIZATION = 'kJuHHkaqcBFXiGMHQf6bJw8YAyDcwGD8Ur';

/** The servers that answer with direct files, in the order they are offered. */
export const SERVERS: [string, string][] = [
  ['kuramadrive', 'Kuramadrive'],
  ['kuramadrive-v2', 'Kuramadrive v2'],
];

export interface AuthEnv {
  prefix: string;
  route: string;
  key: string;
  token: string;
  pageTokenKey: string;
  serverKey: string;
}

/** The `process.env` of `/assets/js/<name>.js` (`MIX_X: 'value'` pairs). */
export function readAuthEnv(script: string): AuthEnv | undefined {
  const get = (name: string): string | undefined => new RegExp(`\\b${name}\\s*:\\s*['"]([^'"]*)['"]`).exec(script)?.[1];
  const env = {
    prefix: get('MIX_PREFIX_AUTH_ROUTE_PARAM'),
    route: get('MIX_AUTH_ROUTE_PARAM'),
    key: get('MIX_AUTH_KEY'),
    token: get('MIX_AUTH_TOKEN'),
    pageTokenKey: get('MIX_PAGE_TOKEN_KEY'),
    serverKey: get('MIX_STREAM_SERVER_KEY'),
  };
  return env.prefix !== undefined && env.route && env.key && env.token && env.pageTokenKey && env.serverKey
    ? (env as AuthEnv)
    : undefined;
}

/** The servers the episode page offers (`#changeServer` options), restricted to the ones this extension can read. */
export function readableServers(doc: HtmlElement): [string, string][] {
  const offered = new Set(doc.select('#changeServer option').map((o) => o.attr('value') ?? ''));
  if (offered.size === 0) return [SERVERS[0] as [string, string]];
  return SERVERS.filter(([value]) => offered.has(value));
}

/** The files of a filled player: `<source src size>` tags of `video#player`, tallest first, and its HLS source if any. */
export function playerStreams(page: string, server: string, referer: string): Stream[] {
  const doc = html.load(page);
  const streams: Stream[] = [];
  const headers = { Referer: referer };
  const hls = doc.selectFirst('video#player')?.attr('data-hls-src')?.trim();
  if (hls && /^https?:\/\//i.test(hls)) streams.push({ url: hls, server, kind: 'hls', headers });
  const files = doc
    .select('video#player source[src]')
    .map((source) => ({
      url: (source.attr('src') ?? '').trim(),
      height: Number.parseInt(source.attr('size') ?? '', 10),
    }))
    .filter((file) => /^https?:\/\//i.test(file.url))
    .sort((a, b) => (b.height || 0) - (a.height || 0));
  for (const file of files) {
    streams.push({
      url: file.url,
      server,
      ...(file.height > 0 && { quality: file.height }),
      kind: 'mp4',
      headers,
    });
  }
  return streams;
}

const randomId = (): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 6; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
  return id;
};

export async function getStreams(episode: Episode): Promise<Stream[]> {
  const path = episode.url.split(/[?#]/)[0] as string;
  if (!isEpisodePath(path)) throw new NotFoundError(`Not an episode of this site: ${episode.url}`);
  const origin = base();
  const pageUrl = `${origin}${path}`;

  const page = await fetchPage(pageUrl);
  const doc = html.load(page.text, { baseUrl: pageUrl });
  const name = doc.selectFirst('[data-kk]')?.attr('data-kk');
  if (!name) throw new ParseError('The episode page has no script name (data-kk): the site layout changed');
  const cookie = cookieHeader(page.headers['set-cookie']);
  const headers: Record<string, string> = { Referer: pageUrl, ...(cookie && { Cookie: cookie }) };

  const script = await fetchPage(`${origin}/assets/js/${encodeURIComponent(name)}.js`, headers);
  const env = readAuthEnv(script.text);
  if (!env) throw new ParseError('The auth script has no MIX_* keys: the site changed its player protocol');

  const streams: Stream[] = [];
  const failures: string[] = [];
  for (const [value, label] of readableServers(doc)) {
    try {
      const tokenResponse = await fetchPage(`${origin}/${env.prefix}${env.route}`, {
        ...headers,
        'X-Fuck-ID': `${env.key}:${env.token}`,
        'X-Request-ID': randomId(),
        'X-Request-Index': '0',
      });
      const token = tokenResponse.text.trim();
      if (!token) throw new ParseError('The token file answered empty');
      const url = `${pageUrl}?${encodeURIComponent(env.pageTokenKey)}=${encodeURIComponent(token)}&${encodeURIComponent(env.serverKey)}=${encodeURIComponent(value)}`;
      const response = await http.post(url, `authorization=${AUTHORIZATION}`, {
        throwOnError: false,
        headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin },
      });
      assertOk(response, url);
      streams.push(...playerStreams(response.text, label, `${origin}/`));
    } catch (error) {
      failures.push(`${value}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (streams.length === 0) {
    if (failures.length > 0) log.warn(`kuramanime streams failed: ${failures.join('; ')}`);
    throw new NotFoundError(
      'No playable Kuramadrive file for this episode (it may still be uploading, or the site changed its player protocol)',
    );
  }
  return streams;
}
