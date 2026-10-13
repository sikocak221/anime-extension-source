import { afterEach, describe, expect, it } from 'vitest';
import { parseEpisodeId, parseMirrors } from '../src/streams';
import { BASE, disposeAll, fixture, load } from './harness';

afterEach(disposeAll);

const EPISODE = '/katainaka-no-ossan-kensei-ni-naru-ii-episode-1-subtitle-indonesia/';
const episode = { url: EPISODE, name: 'Episode 1', number: 1 };

describe('reading an episode page', () => {
  it('finds the id the player asks the mirrors with', () => {
    expect(parseEpisodeId(fixture('episode.html.txt'))).toBe('10372');
    expect(parseEpisodeId('<html>no player</html>')).toBeUndefined();
  });
});

describe('mirrors', () => {
  it('keeps the direct files, with the height of their label', () => {
    const { streams, skipped } = parseMirrors(JSON.parse(fixture('mirrors.json')) as { mirrors: unknown });
    expect(skipped).toBe(0);
    expect(streams.map((s) => [s.server, s.quality, s.kind])).toEqual([
      ['SOKUJA', 480, 'mp4'],
      ['SOKUJA', 720, 'mp4'],
      ['SOKUJA', 1080, 'mp4'],
    ]);
    expect(streams[0]?.url).toMatch(/^https:\/\/storages\.sokuja\.uk\/.+480p.+\.mp4$/);
  });

  it('plays what the site plays itself (mp4, raw), tells an HLS file by its address and leaves iframes out', () => {
    const { streams, skipped } = parseMirrors({
      mirrors: [
        { serverName: 'A', embedUrl: 'https://cdn.example/a.m3u8?x=1', embedType: 'raw', quality: 'Default' },
        { serverName: 'B', embedUrl: 'https://cdn.example/b.mp4', embedType: 'mp4', quality: '1080p' },
        { serverName: 'C', embedUrl: 'https://host.example/embed/c', embedType: 'iframe', quality: '720p' },
        { serverName: 'D', embedUrl: 'not an address', embedType: 'mp4' },
        { serverName: '', embedUrl: 'https://cdn.example/e.mp4', embedType: 'mp4' },
      ],
    });
    expect(skipped).toBe(2);
    expect(streams).toEqual([
      { url: 'https://cdn.example/a.m3u8?x=1', server: 'A', kind: 'hls' },
      { url: 'https://cdn.example/b.mp4', server: 'B', kind: 'mp4', quality: 1080 },
      { url: 'https://cdn.example/e.mp4', server: 'Sokuja', kind: 'mp4' },
    ]);
  });

  it('copes with an answer that is not a list', () => {
    expect(parseMirrors({})).toEqual({ streams: [], skipped: 0 });
    expect(parseMirrors({ mirrors: 'no' })).toEqual({ streams: [], skipped: 0 });
  });
});

describe('getStreams', () => {
  const answer = (mirrors: string) => (request: { url: string }) => {
    if (request.url === `${BASE}${EPISODE}`) return { status: 200, text: fixture('episode.html.txt') };
    if (request.url === `${BASE}/api/video-mirrors/?e=10372`) return { status: 200, text: mirrors };
    return undefined;
  };

  it('reads the page, asks the mirrors and returns the best quality first', async () => {
    const { client, requests } = await load(answer(fixture('mirrors.json')));
    const streams = await client.getStreams(episode);
    expect(streams.map((s) => s.quality)).toEqual([1080, 720, 480]);
    expect(streams.every((s) => s.kind === 'mp4' && s.server === 'SOKUJA')).toBe(true);
    expect(requests.map((r) => r.url)).toEqual([`${BASE}${EPISODE}`, `${BASE}/api/video-mirrors/?e=10372`]);
  });

  it('says so when the page has no episode id', async () => {
    const { client } = await load(() => ({ status: 200, text: '<html></html>' }));
    await expect(client.getStreams(episode)).rejects.toThrow(/site layout changed/);
  });

  it('says when an episode has no server, and when it has only servers the app cannot play', async () => {
    const none = await load(answer('{"mirrors":[]}'));
    await expect(none.client.getStreams(episode)).rejects.toThrow(/has no server/);
    const iframes = await load(
      answer('{"mirrors":[{"serverName":"X","embedUrl":"https://host.example/e/1","embedType":"iframe"}]}'),
    );
    await expect(iframes.client.getStreams(episode)).rejects.toThrow(/only on servers the app cannot play/);
  });

  it('reports a Cloudflare challenge as one', async () => {
    const { client } = await load(() => ({ status: 403, headers: { 'cf-mitigated': 'challenge' } }));
    await expect(client.getStreams(episode)).rejects.toMatchObject({ typed: 'CloudflareError' });
  });
});
