import '@matane-anime/extension-sdk/globals';
import { type HtmlElement, type Stream, HttpError, NotFoundError, ParseError } from '@matane-anime/extension-sdk';

// Server option reading and host resolving for animenosub.to (WordPress, AnimeStream theme). An episode page has
// `<select class="mirror"><option value="BASE64">SUB - Moon</option>…`, where the value is the base64 of an
// `<iframe src="…">` tag. The hosts seen on the site and what is done with them:
//   - Byse / FileMoon ("Moon", bysesayeveum.com/e/<code>): `/api/videos/<code>` answers JSON whose `playback` is
//     AES-256-GCM encrypted; the key is two of the `key_parts` (chosen by `version`). The plain text lists HLS sources.
//   - Vidmoly ("Omega", vidmoly.biz/embed-<code>.html): the HLS master is in the embed page's `sources: [{ file: …`.
//   - Vidara ("Nova", vidaraa.cc/e/<code>): `POST /api/stream` {filecode} answers `streaming_url` (HLS).
// Everything else (nova.upn.one and other players that need script execution) is skipped, never thrown on.

const EMBED_TIMEOUT_MS = 10_000;
/** The site's own address, sent as the Referer of the embeds the way a browser on the episode page would. */
const SITE_REFERER = 'https://animenosub.to/';

export interface Server {
  /** The option's text, e.g. "SUB - Moon". */
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
    add(option.text().replace(/\s+/g, ' ').trim(), decodeServerOption(option.attr('value') ?? ''));
  }
  const fallback = doc.selectFirst('#pembed iframe')?.attr('src');
  if (fallback) add('Default', iframeSrc(`<iframe src="${fallback}">`));
  return servers;
}

type Embed = { host: 'byse' | 'vidmoly' | 'vidara'; origin: string; code: string };

/** Which supported host an embed address belongs to, and its video code. */
export function classifyEmbed(embed: string): Embed | undefined {
  let url: URL;
  try {
    url = new URL(embed);
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const origin = `https://${host}`;
  if (/^(?:byse[a-z0-9]*\.[a-z]+|filemoon\.[a-z]+)$/.test(host)) {
    const code = /^\/(?:e|d|v)\/([A-Za-z0-9]+)/.exec(url.pathname)?.[1];
    return code ? { host: 'byse', origin, code } : undefined;
  }
  if (/^vidmoly\.[a-z]+$/.test(host)) {
    const code = /^\/(?:embed-)?([A-Za-z0-9]+)(?:\.html)?\/?$/.exec(url.pathname)?.[1];
    return code ? { host: 'vidmoly', origin, code } : undefined;
  }
  if (/^vidara[a-z]*\.[a-z]+$/.test(host)) {
    const code = /^\/e\/([A-Za-z0-9]+)/.exec(url.pathname)?.[1];
    return code ? { host: 'vidara', origin, code } : undefined;
  }
  return undefined;
}

async function getText(url: string, headers: Record<string, string>): Promise<string> {
  const response = await http.get(url, { headers, timeoutMs: EMBED_TIMEOUT_MS, throwOnError: false });
  if (response.status === 404) throw new NotFoundError('The video is gone from the host');
  if (response.status >= 400) throw new HttpError(response.status, `HTTP ${response.status} for ${url}`);
  return response.text;
}

/** HLS masters are adaptive: the player picks the height. */
function hls(url: string, server: string, headers: Record<string, string>, quality?: number): Stream {
  return { url, server, kind: 'hls', ...(quality && { quality }), headers };
}

// ---- Byse (FileMoon) ----------------------------------------------------------------------------------------

/** base64url (no padding) to bytes. */
function fromBase64Url(text: string): Uint8Array {
  const standard = text.replace(/-/g, '+').replace(/_/g, '/');
  return base64.decodeBytes(standard + '='.repeat((4 - (standard.length % 4)) % 4));
}

interface BysePlayback {
  iv?: string;
  payload?: string;
  key_parts?: string[];
  version?: string | number;
}

/**
 * Decrypts a Byse `playback` object. The player picks parts `version` and `31 - version` (1-based) of `key_parts`
 * and joins them into the 32-byte AES key. The cipher is AES-256-GCM with a 12-byte nonce and the 16-byte tag at the
 * end of the payload. GCM encrypts with CTR starting at nonce || 00000002, so CTR mode gives the plain text (the tag is
 * dropped, not checked).
 */
export function decryptByse(playback: BysePlayback): string {
  const version = Number(playback.version);
  const parts = playback.key_parts ?? [];
  if (!playback.iv || !playback.payload || !Number.isInteger(version) || version < 1 || version > 20) {
    throw new ParseError('Byse sent a playback block of an unknown shape');
  }
  const first = parts[version - 1];
  const second = parts[31 - version - 1];
  if (!first || !second) throw new ParseError('Byse sent a playback block without the key parts');
  const key = [...fromBase64Url(first), ...fromBase64Url(second)];
  const nonce = fromBase64Url(playback.iv);
  const payload = fromBase64Url(playback.payload);
  if (key.length !== 32 || nonce.length !== 12 || payload.length <= 16) {
    throw new ParseError('Byse sent a playback block of an unknown size');
  }
  const counter = [...nonce, 0, 0, 0, 2];
  const plain = crypto.aesDecrypt(payload.subarray(0, payload.length - 16), key, { mode: 'ctr', iv: counter });
  return utf8.decode(plain);
}

interface ByseSource {
  url?: string;
  mime_type?: string;
  height?: number;
}

/** The HLS sources in a Byse `/api/videos/<code>` answer. */
export function parseByse(json: string): { url: string; height?: number }[] {
  let data: { playback?: BysePlayback; error?: unknown };
  try {
    data = JSON.parse(json);
  } catch {
    throw new ParseError('Byse answered something that is not JSON');
  }
  if (!data.playback) throw new NotFoundError('Byse has no playback for this video');
  let plain: { sources?: ByseSource[] };
  try {
    plain = JSON.parse(decryptByse(data.playback));
  } catch (error) {
    if (error instanceof ParseError) throw error;
    throw new ParseError('Byse playback did not decrypt to JSON');
  }
  const found: { url: string; height?: number }[] = [];
  for (const source of plain.sources ?? []) {
    if (!source.url || !/^https?:\/\//.test(source.url)) continue;
    if (!/mpegurl/i.test(source.mime_type ?? '') && !/\.m3u8/.test(source.url)) continue;
    found.push({ url: source.url, ...(source.height && { height: source.height }) });
  }
  return found;
}

async function fromByse(embed: Embed, name: string): Promise<Stream[]> {
  const referer = `${embed.origin}/`;
  const text = await getText(`${embed.origin}/api/videos/${embed.code}`, { Referer: SITE_REFERER });
  const sources = parseByse(text);
  if (sources.length === 0) throw new NotFoundError('Byse gave no playable link');
  return sources.map((s) => hls(s.url, name, { Referer: referer }, s.height));
}

// ---- Vidmoly ------------------------------------------------------------------------------------------------

/** The HLS master in the `sources: [{ file: '…' }]` of a Vidmoly embed page. */
export function parseVidmoly(page: string): string | undefined {
  const url = /sources\s*:\s*\[\s*\{\s*file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i.exec(page)?.[1];
  return url?.replace(/&amp;/g, '&');
}

async function fromVidmoly(embed: Embed, name: string): Promise<Stream[]> {
  const page = await getText(`${embed.origin}/embed-${embed.code}.html`, { Referer: SITE_REFERER });
  const url = parseVidmoly(page);
  if (!url) throw new NotFoundError('Vidmoly has no video here (removed or blocked)');
  return [hls(url, name, { Referer: `${embed.origin}/` })];
}

// ---- Vidara -------------------------------------------------------------------------------------------------

/** The HLS master in a Vidara `/api/stream` answer. */
export function parseVidara(json: string): string | undefined {
  try {
    const url = (JSON.parse(json) as { streaming_url?: unknown }).streaming_url;
    return typeof url === 'string' && /^https?:\/\//.test(url) ? url : undefined;
  } catch {
    throw new ParseError('Vidara answered something that is not JSON');
  }
}

async function fromVidara(embed: Embed, name: string): Promise<Stream[]> {
  const url = `${embed.origin}/api/stream`;
  const response = await http.post(url, JSON.stringify({ filecode: embed.code, device: 'web', codecs: [] }), {
    headers: { 'Content-Type': 'application/json', Referer: `${embed.origin}/e/${embed.code}`, Origin: embed.origin },
    timeoutMs: EMBED_TIMEOUT_MS,
    throwOnError: false,
  });
  if (response.status >= 400) throw new HttpError(response.status, `HTTP ${response.status} for ${url}`);
  const stream = parseVidara(response.text);
  if (!stream) throw new NotFoundError('Vidara has no video here (removed or blocked)');
  return [hls(stream, name, { Referer: `${embed.origin}/` })];
}

// ---- Resolving ----------------------------------------------------------------------------------------------

const HOST_NAMES = { byse: 'Moon', vidmoly: 'Omega', vidara: 'Nova' } as const;

/** "SUB - Moon" on host byse to "Moon (SUB)"; the option's own text is kept as the variant. */
export function serverName(host: Embed['host'], label: string): string {
  const variant = label
    .replace(/\b(?:moon|omega|nova|filemoon|vidmoly|vidara)\b/gi, ' ')
    .replace(/[-–:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return variant ? `${HOST_NAMES[host]} (${variant})` : HOST_NAMES[host];
}

async function resolveOne(server: Server, embed: Embed): Promise<Stream[]> {
  const name = serverName(embed.host, server.label);
  if (embed.host === 'byse') return fromByse(embed, name);
  if (embed.host === 'vidmoly') return fromVidmoly(embed, name);
  return fromVidara(embed, name);
}

/**
 * Resolves the servers of an episode page into direct streams. A server that cannot be read is logged and skipped;
 * NotFoundError only when nothing at all could be read.
 */
export async function resolveServers(servers: Server[]): Promise<Stream[]> {
  const known = servers
    .map((server) => ({ server, embed: classifyEmbed(server.embed) }))
    .filter((s): s is { server: Server; embed: Embed } => s.embed !== undefined);
  const skipped = servers.length - known.length;
  let failures = 0;
  const results = await Promise.all(
    known.map(async ({ server, embed }) => {
      try {
        return await resolveOne(server, embed);
      } catch (error) {
        log.warn(`Server "${server.label}" failed:`, (error as Error).message);
        failures++;
        return [];
      }
    }),
  );
  const seen = new Set<string>();
  const streams = results.flat().filter((stream) => !seen.has(stream.url) && !!seen.add(stream.url));
  if (streams.length > 0) return streams;
  throw new NotFoundError(
    failures > 0
      ? 'No server of this episode could be read'
      : skipped > 0
        ? 'This episode is only on servers the app cannot play yet'
        : 'This episode has no server',
  );
}
