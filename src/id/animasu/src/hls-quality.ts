import '@matane-anime/extension-sdk/globals';
import type { Stream } from '@matane-anime/extension-sdk';

// Gives the HLS streams that came without a quality the height of their own master playlist, so the player's server
// menu can say "1080p" and the quality preference can pick among them. The app reads a playlist's heights itself
// only after it has opened that stream; this makes the whole list labelled from the start. This module depends on
// nothing of the extension, so it is copied as is into the sibling extensions that need it.

const PLAYLIST_TIMEOUT_MS = 5000;
/** Each labelled stream costs one small request; more than this are left as they are. */
const MAX_LABELLED = 12;

/** The tallest `RESOLUTION` among the variants of a master playlist; undefined for a media playlist or a master that does not say. */
export function tallestHeight(playlist: string): number | undefined {
  let best = 0;
  for (const line of playlist.split(/\r?\n/)) {
    if (!line.trim().startsWith('#EXT-X-STREAM-INF:')) continue;
    const height = Number(/(?:^|[:,])RESOLUTION=\d+x(\d+)/i.exec(line)?.[1]);
    if (height > best) best = height;
  }
  return best > 0 ? best : undefined;
}

const isHls = (stream: Stream): boolean =>
  stream.kind === 'hls' || (stream.kind !== 'mp4' && /\.m3u8(?:$|[?#])/i.test(stream.url));

/**
 * The same streams, each unlabelled HLS one with the tallest height its playlist names. A playlist that cannot be
 * read now (slow, refused, not a master) leaves its stream as it was: the app probes every stream itself.
 */
export async function labelPlaylists(streams: Stream[]): Promise<Stream[]> {
  const pending = streams.filter((stream) => stream.quality === undefined && isHls(stream)).slice(0, MAX_LABELLED);
  if (pending.length === 0) return streams;
  const heights = new Map<Stream, number>();
  await Promise.all(
    pending.map(async (stream) => {
      try {
        const response = await http.get(stream.url, {
          ...(stream.headers && { headers: stream.headers }),
          timeoutMs: PLAYLIST_TIMEOUT_MS,
          throwOnError: false,
        });
        if (response.status >= 400 || !response.text.trimStart().startsWith('#EXTM3U')) return;
        const height = tallestHeight(response.text);
        if (height) heights.set(stream, height);
      } catch {
        // Left unlabelled.
      }
    }),
  );
  return streams.map((stream) => {
    const quality = heights.get(stream);
    return quality ? { ...stream, quality } : stream;
  });
}
