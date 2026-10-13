import '@matane-anime/extension-sdk/globals';
import { CloudflareError, type Episode, type Stream, NotFoundError, ParseError } from '@matane-anime/extension-sdk';
import { assertOk, getJson } from './api';
import { splitEpisodeUrl } from './text';

// An episode carries `streamUrl`: a list of embed pages. Only hosts that can be read down to a direct video
// are returned: upbolt.to (HLS), Blogger (googlevideo mp4) and Dailymotion (HLS). filedon.co and 4meplayer have
// no readable API, so they are skipped (never thrown on).

const EMBED_TIMEOUT_MS = 10_000;
const BLOGGER_RPC =
  'https://www.blogger.com/_/BloggerVideoPlayerUi/data/batchexecute?rpcids=WcwnYd&source-path=%2Fvideo.g&rt=c';

/** Heights of the itags Blogger serves. */
const ITAG_HEIGHT: Record<number, number> = { 18: 360, 22: 720, 37: 1080, 59: 480, 43: 360, 34: 360, 35: 480 };

/** How many upbolt embeds are tried for one episode (the first that answers is enough). */
const MAX_UPBOLT = 3;

interface EmbedEntry {
  source?: unknown;
  url?: unknown;
}

interface EpisodeData {
  streamUrl?: EmbedEntry[] | null;
}

/** Undoes the `\u003d` / `\u0026` escapes (the answer is JSON inside JSON, so they can come with several slashes). */
const unescapeJson = (text: string): string =>
  text
    .replace(/\\+u([0-9a-fA-F]{4})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\+\//g, '/');

/** Direct googlevideo mp4 links in a `WcwnYd` answer, with the height their itag stands for. */
export function parseBloggerResponse(text: string): { url: string; quality?: number }[] {
  const found = new Map<string, { url: string; quality?: number }>();
  for (const match of unescapeJson(text).matchAll(/https:\/\/[^\s"\\]+?googlevideo\.com\/videoplayback[^\s"\\]*/g)) {
    const url = match[0];
    const params = new URL(url).searchParams;
    // The answer also holds a SABR-only link (`sabr=1`, no itag): the player needs a protocol, not a plain GET.
    if (params.has('sabr') || !params.has('itag')) continue;
    const itag = Number(params.get('itag'));
    const quality = ITAG_HEIGHT[itag];
    found.set(url, { url, ...(quality && { quality }) });
  }
  return [...found.values()];
}

async function fromBlogger(embed: URL): Promise<Stream[]> {
  const token = embed.searchParams.get('token');
  if (!token) return [];
  const payload = JSON.stringify([[['WcwnYd', JSON.stringify([token, '', 0]), null, 'generic']]]);
  const response = await http.post(BLOGGER_RPC, `f.req=${encodeURIComponent(payload)}`, {
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    timeoutMs: EMBED_TIMEOUT_MS,
    throwOnError: false,
  });
  assertOk(response, BLOGGER_RPC);
  const links = parseBloggerResponse(response.text);
  if (links.length === 0) throw new ParseError('Blogger gave no video: the token may have expired');
  return links.map((link) => ({
    url: link.url,
    server: 'Blogger',
    kind: 'mp4' as const,
    ...(link.quality && { quality: link.quality }),
  }));
}

async function fromDailymotion(embed: URL): Promise<Stream[]> {
  const id = embed.searchParams.get('video');
  if (!id || !/^[A-Za-z0-9]+$/.test(id)) return [];
  const url = `https://www.dailymotion.com/player/metadata/video/${id}`;
  const response = await http.get(url, { timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false });
  assertOk(response, url);
  const meta = response.json<{ qualities?: Record<string, { type?: string; url?: string }[]> }>();
  const hls = meta.qualities?.['auto']?.find((q) => typeof q.url === 'string' && /mpegurl/i.test(q.type ?? ''))?.url;
  if (!hls) throw new ParseError('Dailymotion gave no playlist');
  return [{ url: hls, server: 'Dailymotion', kind: 'hls' }];
}

/** The HLS master playlist in the player page upbolt answers with: a JW Player `sources: [{file: "…m3u8"}]`. */
export function parseUpboltPlaylist(page: string): string | undefined {
  return /sources\s*:\s*\[\s*\{\s*file\s*:\s*"(https?:[^"]+\.m3u8[^"]*)"/.exec(page)?.[1]?.replace(/\\\//g, '/');
}

/** The height a server label names ("STR 720p", "Nonton Online 1080p"); "HD" names none. */
export const labelQuality = (label: string | undefined): number | undefined => {
  const height = /(\d{3,4})p\b/i.exec(label ?? '')?.[1];
  return height ? Number(height) : undefined;
};

/** One entry of a master playlist: the media playlist of a single height. */
export interface MasterVariant {
  url: string;
  height: number;
}

/** The `#EXT-X-STREAM-INF` entries of a master playlist that name a resolution, tallest first, one per height. */
export function parseMasterVariants(master: string, baseUrl: string): MasterVariant[] {
  const lines = master.split(/\r?\n/).map((line) => line.trim());
  const byHeight = new Map<number, MasterVariant>();
  lines.forEach((line, index) => {
    if (!line.startsWith('#EXT-X-STREAM-INF:')) return;
    const height = Number(/RESOLUTION=\d+x(\d+)/i.exec(line)?.[1]);
    const next = lines.slice(index + 1).find((candidate) => candidate !== '' && !candidate.startsWith('#'));
    if (!height || !next) return;
    try {
      byHeight.set(height, { url: new URL(next, baseUrl).href, height });
    } catch {
      // A line that is not an address is not a variant.
    }
  });
  return [...byHeight.values()].sort((a, b) => b.height - a.height);
}

/**
 * `/e/<code>` is only a poster with a play button; the player (and the playlist) comes from the form it posts:
 * `POST /dl op=embed&file_code=<code>`. The playlist and its segments need no Referer and no particular User-Agent.
 *
 * The playlist is a ladder (360p up to what the file has). The app lets the user pick a resolution only among
 * streams that name one, so each rung is returned as a stream of its own; if the ladder cannot be read, the master
 * itself is returned with the height its label names.
 */
async function fromUpbolt(embed: URL, label: string | undefined): Promise<Stream[]> {
  const code = /^\/e\/([A-Za-z0-9]+)\/?$/.exec(embed.pathname)?.[1];
  if (!code) return [];
  const url = `${embed.origin}/dl`;
  const response = await http.post(url, `op=embed&file_code=${code}&auto=1&referer=`, {
    headers: { 'content-type': 'application/x-www-form-urlencoded', referer: embed.href },
    timeoutMs: EMBED_TIMEOUT_MS,
    throwOnError: false,
  });
  assertOk(response, url);
  const playlist = parseUpboltPlaylist(response.text);
  if (!playlist) throw new ParseError('upbolt gave no playlist: the file may have been removed');

  const master = await http.get(playlist, { timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false }).catch(() => null);
  const variants = master && master.status < 400 ? parseMasterVariants(master.text, playlist) : [];
  if (variants.length > 0) {
    return variants.map((variant) => ({
      url: variant.url,
      server: 'Upbolt',
      kind: 'hls' as const,
      quality: variant.height,
    }));
  }
  const quality = labelQuality(label);
  return [{ url: playlist, server: 'Upbolt', kind: 'hls', ...(quality && { quality }) }];
}

/**
 * An episode lists one upbolt embed per quality tier, and the biggest tier's ladder holds every height of the
 * smaller ones. So the tallest label is asked first and the others only when it fails; this keeps the number of
 * requests (two per embed) low. An embed without a height in its label ("HD") counts as the tallest.
 */
async function fromUpbolts(entries: { embed: URL; source: string }[]): Promise<Stream[]> {
  const ordered = [...entries]
    .sort((a, b) => (labelQuality(b.source) ?? Infinity) - (labelQuality(a.source) ?? Infinity))
    .slice(0, MAX_UPBOLT);
  let failure: unknown;
  for (const entry of ordered) {
    try {
      const found = await fromUpbolt(entry.embed, entry.source);
      if (found.length > 0) return found;
    } catch (error) {
      failure ??= error;
      if (error instanceof CloudflareError) break;
    }
  }
  if (failure) throw failure;
  return [];
}

/** HLS first (not tied to an IP, and adaptive); a googlevideo link expires and is bound to the IP that asked. Then by quality. */
const rank = (stream: Stream): number => (stream.kind === 'hls' ? 0 : 1);

export async function getStreams(episode: Episode): Promise<Stream[]> {
  const { slug, number } = splitEpisodeUrl(episode.url);
  const data = (
    await getJson<{ data?: EpisodeData }>(`/series/${encodeURIComponent(slug)}/episodes/${encodeURIComponent(number)}`)
  ).data;
  const embeds = (data?.streamUrl ?? []).filter((e): e is { source: string; url: string } => typeof e.url === 'string');

  let failures = 0;
  let skipped = 0;
  let challenge: CloudflareError | undefined;
  const failed = (host: string, error: unknown): Stream[] => {
    if (error instanceof CloudflareError) challenge ??= error;
    failures++;
    log.warn(`Server ${host} failed:`, (error as Error).message);
    return [];
  };

  const upbolt: { embed: URL; source: string }[] = [];
  const others: URL[] = [];
  for (const entry of embeds) {
    let embed: URL;
    try {
      embed = new URL(entry.url);
    } catch {
      skipped++;
      continue;
    }
    if (embed.hostname.toLowerCase().endsWith('upbolt.to')) upbolt.push({ embed, source: entry.source });
    else others.push(embed);
  }

  // Every server is read at once (a Blogger call and a Dailymotion call are independent); the answers are
  // collected in the order the site lists them, so the result does not depend on which came back first.
  const results = await Promise.all([
    ...(upbolt.length > 0 ? [fromUpbolts(upbolt).catch((error: unknown) => failed('upbolt.to', error))] : []),
    ...others.map(async (embed): Promise<Stream[]> => {
      const host = embed.hostname.toLowerCase();
      try {
        if (host.endsWith('blogger.com')) return await fromBlogger(embed);
        if (host.endsWith('dailymotion.com')) return await fromDailymotion(embed);
        skipped++;
        return [];
      } catch (error) {
        return failed(host, error);
      }
    }),
  ]);

  const streams: Stream[] = [];
  const seen = new Set<string>();
  for (const stream of results.flat()) {
    if (seen.has(stream.url)) continue;
    seen.add(stream.url);
    streams.push(stream);
  }

  if (streams.length === 0) {
    // A challenge is something the user can pass, so it is reported as one rather than as "no server".
    if (challenge) throw challenge;
    throw new NotFoundError(
      failures > 0
        ? 'No server of this episode could be read'
        : skipped > 0
          ? 'This episode is only on servers the app cannot play yet (filedon, 4meplayer…)'
          : 'This episode has no server',
    );
  }
  return streams.sort((a, b) => rank(a) - rank(b) || (b.quality ?? 0) - (a.quality ?? 0));
}
