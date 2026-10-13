import '@matane-anime/extension-sdk/globals';
import { type Episode, type Stream, NotFoundError } from '@matane-anime/extension-sdk';
import { base, fetchPage } from './site';
import { readVideoSources, splitEpisodeUrl, type Version } from './text';

// An episode page lists one player per version and mirror (`#videos a[data-id][data-version]`), each an iframe on
// `/embed/<id>`. That page holds `videoSources = [{file: "/play/<n>/video.mp4?for=...", label: "480p"}, ...]`:
// the file answers with a redirect to the CDN's mp4 (Range supported), and the embed is sent as its Referer.

interface Player {
  id: string;
  version: Version;
  mirror: string;
}

export async function getStreams(episode: Episode): Promise<Stream[]> {
  const { path, version } = splitEpisodeUrl(episode.url);
  if (!path.startsWith('/')) throw new NotFoundError(`Not an episode address: ${episode.url}`);
  const pageUrl = `${base()}${path}`;
  const doc = html.load((await fetchPage(pageUrl)).text, { baseUrl: pageUrl });
  const all: Player[] = [];
  for (const tab of doc.select('#videos a[data-id]')) {
    const id = (tab.attr('data-id') ?? '').trim();
    const v = (tab.attr('data-version') ?? '').trim().toLowerCase();
    if (!/^\d+$/.test(id) || (v !== 'subbed' && v !== 'dubbed')) continue;
    all.push({ id, version: v, mirror: (tab.attr('data-mirror') ?? '').trim() || 'AnimeGG' });
  }
  if (all.length === 0) throw new NotFoundError('The episode page has no player');
  const wanted = version ? all.filter((p) => p.version === version) : all;
  const players = wanted.length > 0 ? wanted : all;

  const streams: Stream[] = [];
  let failure: unknown;
  for (const player of players) {
    const embed = `${base()}/embed/${player.id}`;
    try {
      const response = await fetchPage(embed);
      for (const source of readVideoSources(response.text)) {
        streams.push({
          url: new URL(source.file, embed).toString(),
          server: `${player.mirror} ${player.version === 'dubbed' ? 'Dub' : 'Sub'}`,
          ...(source.quality !== undefined && { quality: source.quality }),
          kind: 'mp4',
          headers: { Referer: embed },
        });
      }
    } catch (error) {
      failure = error;
    }
  }
  if (streams.length === 0) {
    if (failure) throw failure;
    throw new NotFoundError('The players list no video source');
  }
  return streams.sort((a, b) => (b.quality ?? 0) - (a.quality ?? 0));
}
