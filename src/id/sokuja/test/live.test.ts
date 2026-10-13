import { describe, expect, it } from 'vitest';
import { loadSource } from '@matane-anime/extension-cli/run';

// Talks to the real site, so it only runs on request: `pnpm test:live`. A timeout, a 403 or a rate limit here is not
// necessarily a bug of the extension.
const LIVE = process.env['LIVE'] === '1';

describe.skipIf(!LIVE)('sokuja (live)', () => {
  it(
    'browses, searches, reads details and episodes, and resolves files that answer',
    { timeout: 180_000 },
    async () => {
      const { client, runtime, call } = await loadSource('.', { prefs: [] });
      try {
        const popular = await client.getPopular(1, call);
        expect(popular.items.length).toBeGreaterThan(0);
        const latest = await client.getLatest(1, call);
        expect(latest.items.length).toBeGreaterThan(0);
        const hits = await client.search('one piece', 1, {}, call);
        expect(hits.items.map((i) => i.title)).toContain('One Piece');
        const genre = await client.search('', 1, { genre: 'action' }, call);
        expect(genre.items.length).toBeGreaterThan(0);

        // A long series: the page shows 50 and the rest comes from the playlist.
        const op = { url: '/anime/one-piece-subtitle-indonesia/', title: 'One Piece' };
        const details = await client.getAnimeDetails(op, call);
        expect(details.title).toBe('One Piece');
        const episodes = await client.getEpisodes(op, call);
        console.log('episodes', episodes.length, episodes[0]);
        expect(episodes.length).toBeGreaterThan(100);

        const streams = await client.getStreams(episodes[0]!, call);
        console.log(streams.map((s) => `${s.server}|${s.quality}|${s.kind}|${new URL(s.url).host}`));
        expect(streams.length).toBeGreaterThan(0);
        expect(streams.every((s) => s.quality)).toBe(true);
        for (const stream of streams) {
          const response = await fetch(stream.url, {
            headers: { Range: 'bytes=0-1023' },
            signal: AbortSignal.timeout(20_000),
          });
          expect(response.status).toBe(206);
          expect(response.headers.get('content-type')).toMatch(/video/);
        }

        await expect(
          client.getAnimeDetails({ url: '/anime/slug-yang-tidak-ada-xyz/', title: 'x' }, call),
        ).rejects.toMatchObject({
          typed: 'NotFoundError',
        });
      } finally {
        runtime.dispose();
      }
    },
  );
});
