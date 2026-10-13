import '@matane-anime/extension-sdk/globals';
import { type Episode, type Stream, NotFoundError, ParseError } from '@matane-anime/extension-sdk';
import { base, fetchJson, fetchPage } from './site';
import { qualityOf } from './text';

// An episode page carries the id of the episode in the data Next.js embeds in it (`"episodeId":10372`), and
// `/api/video-mirrors/?e=<id>` answers the mirrors of that id: direct files on the site's own storage, one per
// quality (`embedType: "mp4"`). The player of the site plays `mp4` and `raw` itself and puts anything else in an
// iframe; only the first two are returned here.

interface Mirror {
  serverName?: unknown;
  embedUrl?: unknown;
  embedType?: unknown;
  quality?: unknown;
}

/** The id the player asks the mirrors with. */
export function parseEpisodeId(page: string): string | undefined {
  // The data sits in a JavaScript string, so the quotes come escaped (`\"episodeId\":10372`).
  return /episodeId\\*"\s*:\s*(\d+)/.exec(page)?.[1];
}

/** The playable files in an answer of the mirrors API, and how many mirrors were left out. */
export function parseMirrors(answer: { mirrors?: unknown }): { streams: Stream[]; skipped: number } {
  const mirrors = Array.isArray(answer.mirrors) ? (answer.mirrors as Mirror[]) : [];
  const streams: Stream[] = [];
  let skipped = 0;
  for (const mirror of mirrors) {
    const url = typeof mirror.embedUrl === 'string' ? mirror.embedUrl.trim() : '';
    const direct = mirror.embedType === 'mp4' || mirror.embedType === 'raw';
    if (!direct || !/^https?:\/\//i.test(url)) {
      skipped++;
      continue;
    }
    const quality = qualityOf(typeof mirror.quality === 'string' ? mirror.quality : undefined);
    streams.push({
      url,
      server: typeof mirror.serverName === 'string' && mirror.serverName.trim() ? mirror.serverName.trim() : 'Sokuja',
      kind: /\.m3u8(?:[?#]|$)/i.test(url) ? 'hls' : 'mp4',
      ...(quality && { quality }),
    });
  }
  return { streams, skipped };
}

export async function getStreams(episode: Episode): Promise<Stream[]> {
  const page = (await fetchPage(`${base()}${episode.url}`)).text;
  const id = parseEpisodeId(page);
  if (!id) throw new ParseError('The episode page has no episode id: the site layout changed');

  const answer = await fetchJson<{ mirrors?: unknown }>(`${base()}/api/video-mirrors/?e=${id}`);
  const { streams, skipped } = parseMirrors(answer);
  if (streams.length === 0) {
    throw new NotFoundError(
      skipped > 0 ? 'This episode is only on servers the app cannot play yet' : 'This episode has no server',
    );
  }
  const seen = new Set<string>();
  return streams
    .filter((stream) => !seen.has(stream.url) && !!seen.add(stream.url))
    .sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0));
}
