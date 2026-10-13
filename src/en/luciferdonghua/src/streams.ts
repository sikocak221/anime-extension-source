import '@matane-anime/extension-sdk/globals';
import { type HtmlElement, type Stream, HttpError, NotFoundError, ParseError } from '@matane-anime/extension-sdk';

// Server reading and host resolving for luciferdonghua.in, which shares the AnimeStream theme with animexin.dev but
// not its server list. An episode page has `<select class="mirror"><option value=".../v/4/">[4K] Eng [OK.RU -
// Server]</option>…`: every option is a page of its own (the same episode), whose `#pembed` holds that server's
// player, either an `<iframe src>` or a Dailymotion `<script data-video="ID">`. The episode page itself shows the
// default option. Only hosts that can be read down to a direct video are returned: Dailymotion (HLS from its public
// player metadata) and ok.ru (mp4 ladder from the embed's `data-options`). Everything else (rumble, vidhide, the
// misterdonghua ads page...) is skipped, never thrown on: the SDK wants direct video URLs, not embed pages. The
// resolving part below is the AnimeXin one and depends on nothing of the extension.

/** The longest variant label kept in a server name. */
const MAX_VARIANT = 32;
const EMBED_TIMEOUT_MS = 10_000;
/** More resolvable servers than this are never needed; each costs one request. */
const MAX_SERVERS = 8;

export interface Server {
  /** The option's text, e.g. "[4K] Eng [OK.RU - Server]". */
  label: string;
  /** The absolute address of the embed. */
  embed: string;
}

/** One `<option>` of the server select: its text and the address of the page that shows that server. */
export interface ServerOption {
  label: string;
  page: string;
  selected: boolean;
}

/** The src of the iframe inside some markup; protocol-relative addresses get https. */
export function iframeSrc(markup: string): string | undefined {
  const raw = /<iframe\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i.exec(markup)?.[1];
  if (!raw) return undefined;
  const src = raw.replace(/&amp;/g, '&').trim();
  const url = src.startsWith('//') ? `https:${src}` : src;
  return /^https?:\/\//i.test(url) ? url : undefined;
}

/** The options of the server select that point to a page. */
export function readOptions(doc: HtmlElement): ServerOption[] {
  const options: ServerOption[] = [];
  for (const option of doc.select('select.mirror option')) {
    const page = option.attr('value')?.trim();
    if (!page || !/^https?:\/\//i.test(page)) continue;
    options.push({
      label: option.text().replace(/\s+/g, ' ').trim(),
      page,
      selected: option.attr('selected') !== null,
    });
  }
  return options;
}

/** The embed address of the player a page shows (`#pembed`): an iframe, or the Dailymotion player script. */
export function readPlayer(doc: HtmlElement): string | undefined {
  const frame = doc.selectFirst('#pembed iframe')?.attr('src');
  if (frame) return iframeSrc(`<iframe src="${frame}">`);
  const video = doc.selectFirst('#pembed script[data-video]')?.attr('data-video');
  return video && /^[A-Za-z0-9]+$/.test(video) ? `https://www.dailymotion.com/embed/video/${video}` : undefined;
}

/** Hosts worth a request, judged by the option's text; the rest would only be read to be skipped. */
export const isReadableLabel = (label: string): boolean => /dailymotion|ok\.?ru/i.test(label);

// ---- Dailymotion --------------------------------------------------------------------------------------------

/** The video id in `geo.dailymotion.com/player/<p>.html?video=<id>`, `/embed/video/<id>`, `/video/<id>` or dai.ly. */
export function dailymotionId(embed: string): string | undefined {
  let url: URL;
  try {
    url = new URL(embed);
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase();
  if (host === 'dai.ly') return /^\/([A-Za-z0-9]+)/.exec(url.pathname)?.[1];
  if (!host.endsWith('dailymotion.com')) return undefined;
  return url.searchParams.get('video') ?? /\/(?:embed\/)?video\/([A-Za-z0-9]+)/.exec(url.pathname)?.[1] ?? undefined;
}

interface DailymotionQuality {
  type?: string;
  url?: string;
}

/** The playable links of a `player/metadata/video/<id>` answer: the HLS master ("auto") and any direct mp4. */
export function parseDailymotionMetadata(json: string): { url: string; kind: 'hls' | 'mp4'; quality?: number }[] {
  let data: { error?: { message?: string }; qualities?: Record<string, DailymotionQuality[]> };
  try {
    data = JSON.parse(json);
  } catch {
    throw new ParseError('Dailymotion answered something that is not JSON');
  }
  if (data.error) throw new NotFoundError(`Dailymotion: ${data.error.message ?? 'the video is not available'}`);
  const found: { url: string; kind: 'hls' | 'mp4'; quality?: number }[] = [];
  for (const [key, list] of Object.entries(data.qualities ?? {})) {
    for (const item of list ?? []) {
      if (!item.url) continue;
      const height = /^\d{3,4}$/.test(key) ? Number(key) : undefined;
      if (/mpegurl/i.test(item.type ?? '') || /\.m3u8/.test(item.url)) found.push({ url: item.url, kind: 'hls' });
      else if (/mp4/i.test(item.type ?? '') && height) found.push({ url: item.url, kind: 'mp4', quality: height });
    }
  }
  return found;
}

async function fromDailymotion(id: string, name: string): Promise<Stream[]> {
  const url = `https://www.dailymotion.com/player/metadata/video/${encodeURIComponent(id)}`;
  const response = await http.get(url, { timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false });
  if (response.status >= 400) throw new HttpError(response.status, `HTTP ${response.status} for ${url}`);
  const links = parseDailymotionMetadata(response.text);
  if (links.length === 0) throw new ParseError('Dailymotion gave no playable link');
  // The CDN checks that the request looks like the player's.
  const headers = { Referer: 'https://geo.dailymotion.com/', Origin: 'https://geo.dailymotion.com' };
  return links.map((link) => ({
    url: link.url,
    server: name,
    kind: link.kind,
    ...(link.quality && { quality: link.quality }),
    headers,
  }));
}

// ---- ok.ru --------------------------------------------------------------------------------------------------

/** The video id of `ok.ru/videoembed/<id>` and `ok.ru/video/<id>`. */
export function okruId(embed: string): string | undefined {
  try {
    const url = new URL(embed);
    if (!/(^|\.)ok\.ru$/i.test(url.hostname)) return undefined;
    return /\/video(?:embed)?\/(\d+)/.exec(url.pathname)?.[1];
  } catch {
    return undefined;
  }
}

/** Heights of ok.ru's named qualities. */
const OKRU_HEIGHT: Record<string, number> = {
  mobile: 144,
  lowest: 240,
  low: 360,
  sd: 480,
  hd: 720,
  full: 1080,
  quad: 1440,
  ultra: 2160,
};

/** The mp4 ladder in the `data-options` JSON of an ok.ru embed page (`flashvars.metadata` is a JSON string). */
export function parseOkruEmbed(page: string): { url: string; quality?: number }[] {
  const options = html.load(page).selectFirst('[data-options]')?.attr('data-options');
  if (!options) return [];
  try {
    const flashvars = (JSON.parse(options) as { flashvars?: { metadata?: unknown } }).flashvars;
    const raw = flashvars?.metadata;
    const metadata = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
      videos?: { name?: string; url?: string }[];
    };
    const found: { url: string; quality?: number }[] = [];
    for (const video of metadata?.videos ?? []) {
      if (!video.url || !/^https?:\/\//.test(video.url)) continue;
      const quality = OKRU_HEIGHT[video.name ?? ''];
      found.push({ url: video.url, ...(quality && { quality }) });
    }
    return found;
  } catch {
    return [];
  }
}

async function fromOkru(id: string, name: string): Promise<Stream[]> {
  const url = `https://ok.ru/videoembed/${id}`;
  const response = await http.get(url, { timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false });
  if (response.status >= 400) throw new HttpError(response.status, `HTTP ${response.status} for ${url}`);
  const links = parseOkruEmbed(response.text);
  if (links.length === 0) throw new NotFoundError('ok.ru has no video here (removed or blocked)');
  // The links are signed for the requester's address and expire; the app fetches them on the same device.
  return links.map((link) => ({
    url: link.url,
    server: name,
    kind: 'mp4' as const,
    ...(link.quality && { quality: link.quality }),
  }));
}

// ---- Resolving ----------------------------------------------------------------------------------------------

/** "[4K] Eng [OK.RU - Server]" and host "Ok.ru" to "Ok.ru (4K Eng)". */
export function serverName(host: string, label: string): string {
  const variant = label
    // The bracket that names the host and the server ("[Dailymotion Little Ads - Server]") is the host's part.
    .replace(/\[[^\]]*\b(?:ok\.ru|dailymotion)\b[^\]]*\]/gi, ' ')
    .replace(/\b(?:ok\.ru|dailymotion|player)\b/gi, ' ')
    .replace(/\bAX\b/g, ' ')
    .replace(/[[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // A real variant is a few words ("Hardsub Indonesia"); a long text is an announcement the site put in the menu.
  return variant && variant.length <= MAX_VARIANT ? `${host} (${variant})` : host;
}

async function resolveOne(server: Server): Promise<Stream[] | null> {
  const dailymotion = dailymotionId(server.embed);
  if (dailymotion) return fromDailymotion(dailymotion, serverName('Dailymotion', server.label));
  const okru = okruId(server.embed);
  if (okru) return fromOkru(okru, serverName('Ok.ru', server.label));
  return null;
}

/** ok.ru's links were verified to play; they come first, then Dailymotion's adaptive HLS. Best quality first. */
const rank = (stream: Stream): number => (stream.kind === 'hls' ? 1 : 0);

/**
 * Resolves the servers of an episode page into direct streams. A server that cannot be read is logged and skipped;
 * NotFoundError only when nothing at all could be read.
 */
export async function resolveServers(servers: Server[]): Promise<Stream[]> {
  let skipped = 0;
  let failures = 0;
  // The default player repeats one of the options with another address: the same video id is read once.
  const ids = new Set<string>();
  const known = servers.filter((s) => {
    const id = dailymotionId(s.embed) ?? okruId(s.embed);
    return id !== undefined && !ids.has(id) && !!ids.add(id);
  });
  skipped = servers.filter((s) => !dailymotionId(s.embed) && !okruId(s.embed)).length;
  const results = await Promise.all(
    known.slice(0, MAX_SERVERS).map(async (server) => {
      try {
        return (await resolveOne(server)) ?? [];
      } catch (error) {
        log.warn(`Server "${server.label}" failed:`, (error as Error).message);
        failures++;
        return [];
      }
    }),
  );
  const seen = new Set<string>();
  const streams = results
    .flat()
    .filter((stream) => !seen.has(stream.url) && !!seen.add(stream.url))
    .sort((a, b) => rank(a) - rank(b) || (b.quality ?? 0) - (a.quality ?? 0));
  if (streams.length > 0) return streams;
  throw new NotFoundError(
    failures > 0
      ? 'No server of this episode could be read'
      : skipped > 0
        ? 'This episode is only on servers the app cannot play yet (rumble, vidhide...)'
        : 'This episode has no server',
  );
}
