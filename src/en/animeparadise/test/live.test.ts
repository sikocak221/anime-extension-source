import { describe, expect, it } from 'vitest';
import { loadSource } from '@matane-anime/extension-cli/run';

// Talks to the real site, so it only runs on request: `pnpm test:live`. A timeout, a 403 or a rate limit here is not
// necessarily a bug of the extension.
const LIVE = process.env['LIVE'] === '1';

describe.skipIf(!LIVE)('animeparadise (live)', () => {
  it('browses, searches, reads details and episodes, and resolves a stream', { timeout: 180_000 }, async () => {
    const { client, runtime, call } = await loadSource('.', { prefs: [] });
    try {
      const popular = await client.getPopular(1, call);
      expect(popular.items.length).toBeGreaterThan(0);
      const latest = await client.getLatest(1, call);
      expect(latest.items.length).toBeGreaterThan(0);
      const page2 = await client.getPopular(2, call);
      expect(page2.items[0]?.url).not.toBe(popular.items[0]?.url);
      const hits = await client.search('naruto', 1, {}, call);
      expect(hits.items.length).toBeGreaterThan(0);
      const action = await client.search('', 1, { 'genre:Action': true }, call);
      expect(action.items.length).toBeGreaterThan(0);

      const boruto = { url: 'boruto-naruto-next-generations', title: 'Boruto' };
      const details = await client.getAnimeDetails(boruto, call);
      console.log('details', details.title, details.year, details.genres);
      const episodes = await client.getEpisodes(boruto, call);
      console.log('episodes', episodes.length, episodes[0]);
      expect(episodes.length).toBeGreaterThan(100);
      expect(episodes[0]!.number).toBeGreaterThan(episodes.at(-1)!.number!);

      const streams = await client.getStreams(episodes.at(-1)!, call);
      console.log(streams.map((s) => `${s.server}|${s.quality}|${s.kind}|${new URL(s.url).host}`));
      expect(streams.length).toBeGreaterThan(1);
      for (const stream of streams) {
        const playlist = await fetch(stream.url, { signal: AbortSignal.timeout(20_000) });
        expect(playlist.status).toBe(200);
        expect(await playlist.text()).toContain('#EXTM3U');
      }

      await expect(client.getAnimeDetails({ url: 'slug-yang-tidak-ada-xyz', title: 'x' }, call)).rejects.toMatchObject({
        typed: 'NotFoundError',
      });
    } finally {
      runtime.dispose();
    }
  });
});
