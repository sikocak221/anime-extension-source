import { describe, expect, it } from 'vitest';
import { loadSource } from '@matane-anime/extension-cli/run';

// Talks to the real site, so it only runs on request: `pnpm test:live`. A timeout, a 403 or a rate limit here is not
// necessarily a bug of the extension.
const LIVE = process.env['LIVE'] === '1';

describe.skipIf(!LIVE)('animegg (live)', () => {
  it('browses, reads a title and resolves streams', { timeout: 180_000 }, async () => {
    const { client, runtime, call } = await loadSource('.', { prefs: [] });
    try {
      const popular = await client.getPopular(1, call);
      expect(popular.items.length).toBe(25);
      expect(popular.hasNextPage).toBe(true);
      const latest = await client.getLatest(1, call);
      expect(latest.items.length).toBeGreaterThan(0);
      const hits = await client.search('naruto', 1, {}, call);
      expect(hits.items.some((i) => i.url === '/series/naruto')).toBe(true);
      const tagged = await client.search('', 1, { genre: 'Action' }, call);
      expect(tagged.items.length).toBe(25);

      const anime = hits.items.find((i) => i.url === '/series/naruto') ?? hits.items[0]!;
      const details = await client.getAnimeDetails(anime, call);
      expect(details.title.length).toBeGreaterThan(0);
      const episodes = await client.getEpisodes(anime, call);
      expect(episodes.length).toBeGreaterThan(100);
      expect(episodes[0]!.number!).toBeGreaterThan(episodes[episodes.length - 1]!.number!);

      const streams = await client.getStreams(episodes[episodes.length - 1]!, call);
      expect(streams.length).toBeGreaterThan(0);
      const stream = streams[0]!;
      const probe = await fetch(stream.url, { headers: { ...stream.headers, Range: 'bytes=0-99' } });
      expect([200, 206]).toContain(probe.status);
      expect(probe.headers.get('content-type')).toMatch(/video\/mp4/);
      await probe.body?.cancel();
    } finally {
      runtime.dispose();
    }
  });
});
