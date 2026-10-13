import '@matane-anime/extension-sdk/globals';
import { type Episode, type Stream, NotFoundError, ParseError } from '@matane-anime/extension-sdk';
import { decryptPayload } from './cipher';
import { assertOk, base, fetchPage } from './site';
import { isEpisodePath } from './text';

// How an episode page plays (read from the theme scripts, `/js/pintar.js` and friends):
//  1. The page carries `var xenHash = "…"; var _0x… = "<long base64>";`, the id of the episode for the player API.
//  2. The id is POSTed as JSON to `https://animeku.org/api/v9/sources`, which answers
//     `{status, src, src_sd, mirror, blog…}`. `src`, `src_sd` and `mirror` are CryptoJS AesJson payloads
//     (see cipher.ts) under a passphrase that is spelled out in pintar.js.
//  3. `src` decrypts to `{src: <HLS master on kuroplayer.xyz>}` (240p to 1080p, adaptive), `src_sd` to a 480p
//     playlist; `mirror` to `{embed: {v360p…v1080p: {host: url|null}}, download…}`. The playlists answer 404
//     unless the Referer is the player's own site, so the streams carry it.

/** The player API. */
export const API_URL = 'https://animeku.org/api/v9/sources';
/** The site the playlists expect to be requested from. */
export const PLAYER_ORIGIN = 'https://player.animeku.org';
/** The passphrase of the payloads (a literal of the theme's pintar.js). */
export const PASSPHRASE = '3&!Z0M,VIZ;dZW==';

const HEADERS = { Referer: `${PLAYER_ORIGIN}/`, Origin: PLAYER_ORIGIN };

export interface SourcesResponse {
  status?: number;
  src?: string;
  src_sd?: string;
  mirror?: string;
}

/** The id the page gives the player API: the long base64 string assigned right after `xenHash`. */
export function playerId(page: string): string | undefined {
  const after = /\bxenHash\s*=\s*"[^"]*"\s*;[\s\S]{0,300}?\bvar\s+\w+\s*=\s*"([A-Za-z0-9+/=]{100,})"/.exec(page)?.[1];
  return after ?? /\bvar\s+_0x[0-9a-f]+\s*=\s*"([A-Za-z0-9+/=]{100,})"/.exec(page)?.[1];
}

function decryptJson<T>(payload: string | undefined): T | undefined {
  if (!payload) return undefined;
  try {
    return JSON.parse(decryptPayload(payload, PASSPHRASE)) as T;
  } catch {
    return undefined;
  }
}

interface Mirror {
  embed?: Record<string, Record<string, string | null> | undefined>;
}

/** The pixeldrain file behind a `https://pixeldrain.com/u/<id>` link. */
export function pixeldrainFile(url: string): string | undefined {
  const id = /^https:\/\/pixeldrain\.com\/u\/([A-Za-z0-9]+)/.exec(url)?.[1];
  return id ? `https://pixeldrain.com/api/file/${id}` : undefined;
}

/** The streams of a player API answer: the HLS ladder first, then its SD playlist, then the direct files. */
export function streamsOf(answer: SourcesResponse): Stream[] {
  const streams: Stream[] = [];
  const main = decryptJson<{ src?: string }>(answer.src)?.src;
  if (main) streams.push({ url: main, server: 'Kuronime', kind: 'hls', headers: HEADERS });
  const sd = decryptJson<{ src?: string }>(answer.src_sd)?.src;
  if (sd && sd !== main) streams.push({ url: sd, server: 'Kuronime SD', quality: 480, kind: 'hls', headers: HEADERS });
  const embed = decryptJson<Mirror>(answer.mirror)?.embed ?? {};
  const heights = Object.keys(embed)
    .map((key) => ({ key, height: Number(/^v(\d+)p$/.exec(key)?.[1]) }))
    .filter((entry) => entry.height > 0)
    .sort((a, b) => b.height - a.height);
  for (const { key, height } of heights) {
    const link = embed[key]?.['pixeldrain'];
    const file = link ? pixeldrainFile(link) : undefined;
    if (file) streams.push({ url: file, server: 'Pixeldrain', quality: height, kind: 'mp4' });
  }
  return streams;
}

export async function getStreams(episode: Episode): Promise<Stream[]> {
  const path = episode.url.split(/[?#]/)[0] as string;
  if (!isEpisodePath(path)) throw new NotFoundError(`Not an episode of this site: ${episode.url}`);
  const page = (await fetchPage(`${base()}${path}`)).text;
  const id = playerId(page);
  if (!id) throw new ParseError('The episode page has no player id: the site layout changed');
  const response = await http.post(API_URL, { id }, { throwOnError: false });
  assertOk(response, API_URL);
  let answer: SourcesResponse;
  try {
    answer = JSON.parse(response.text) as SourcesResponse;
  } catch {
    throw new ParseError('The player API did not answer with JSON');
  }
  if (answer.status !== 200) throw new NotFoundError('This episode is not ready yet (the video is still processing)');
  const streams = streamsOf(answer);
  if (streams.length === 0)
    throw new ParseError('The player API answer could not be decrypted: the key may have changed');
  return streams;
}
