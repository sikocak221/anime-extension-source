import '@matane-anime/extension-sdk/globals';
import { type HtmlElement, type Stream, HttpError, NotFoundError, ParseError } from '@matane-anime/extension-sdk';

// Server option reading and host resolving for the "mirror select" WordPress theme that lmanime.com shares with
// animexin.dev and its siblings. This module depends on nothing of the extension (no site.ts, no text.ts).
//
// An episode page has `<select class="mirror"><option value="BASE64">Hardsub English Dailymotion AX</option>…`,
// where the value is the base64 of an `<iframe src="…">` tag (some are `//host/…` without a scheme). lmanime.com
// instead puts the address of a page in the value (`…/episode-114/v/2/`), whose `#pembed` iframe is the embed:
// see `readServerPages`. Only hosts that
// can be read down to a direct video are returned: Dailymotion (HLS from its public player metadata) and ok.ru
// (mp4 ladder from the embed's `data-options`). Everything else (odysee, mega, rumble, d.tube, streamwish…) is
// skipped, never thrown on: the SDK wants direct video URLs, not embed pages.

/** The longest variant label kept in a server name. */
const MAX_VARIANT = 32;
const EMBED_TIMEOUT_MS = 10_000;
/** More resolvable servers than this are never needed; each costs one request. */
const MAX_SERVERS = 8;

export interface Server {
  /** The option's text, e.g. "Hardsub Indonesia Ok.ru AX". */
  label: string;
  /** The absolute address of the embed. */
  embed: string;
}

/** The src of the iframe inside a (decoded) option value; protocol-relative addresses get https. */
export function iframeSrc(markup: string): string | undefined {
  const raw = /<iframe\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i.exec(markup)?.[1];
  if (!raw) return undefined;
  const src = raw.replace(/&amp;/g, '&').trim();
  const url = src.startsWith('//') ? `https:${src}` : src;
  return /^https?:\/\//i.test(url) ? url : undefined;
}

/** The embed of one `<option value>`: base64 of an iframe tag (or of a bare address). */
export function decodeServerOption(value: string): string | undefined {
  const text = value.trim();
  if (!text) return undefined;
  let decoded: string;
  try {
    decoded = base64.decode(text);
  } catch {
    return undefined;
  }
  const fromIframe = iframeSrc(decoded);
  if (fromIframe) return fromIframe;
  const bare = decoded.trim();
  return /^https?:\/\/\S+$/i.test(bare) ? bare : undefined;
}

/** The servers of an episode page: the select's options, then the default player iframe if it is not among them. */
export function readServers(doc: HtmlElement): Server[] {
  const servers: Server[] = [];
  const add = (label: string, embed: string | undefined): void => {
    if (embed && !servers.some((s) => s.embed === embed)) servers.push({ label, embed });
  };
  for (const option of doc.select('select.mirror option')) {
    const embed = decodeServerOption(option.attr('value') ?? '');
    add(option.text().replace(/\s+/g, ' ').trim(), embed);
  }
  const fallback = doc.selectFirst('#pembed iframe')?.attr('src');
  if (fallback) add('Default', iframeSrc(`<iframe src="${fallback}">`));
  return servers;
}

/** A server whose option value is the address of a page (lmanime.com). */
export interface ServerPage {
  label: string;
  page: string;
}

/** The options of the select that point to a page of the site instead of carrying a base64 iframe. */
export function readServerPages(doc: HtmlElement): ServerPage[] {
  const pages: ServerPage[] = [];
  for (const option of doc.select('select.mirror option')) {
    const page = (option.attr('value') ?? '').trim();
    if (!/^https?:\/\/\S+$/i.test(page) || pages.some((p) => p.page === page)) continue;
    pages.push({ label: option.text().replace(/\s+/g, ' ').trim(), page });
  }
  return pages;
}

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

/** "Hardsub Indonesia Ok.ru AX" and host "Ok.ru" to "Ok.ru (Hardsub Indonesia)". */
export function serverName(host: string, label: string): string {
  const variant = label
    .replace(/\b(?:ok\.ru|dailymotion|player)\b/gi, ' ')
    .replace(/\bAX\b/g, ' ')
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
        ? 'This episode is only on servers the app cannot play yet (odysee, mega, rumble, streamwish...)'
        : 'This episode has no server',
  );
}
