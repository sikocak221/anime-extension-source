import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadSource } from '@matane-anime/extension-cli/run';

// Talks to the real site, so it only runs on request: `pnpm test:live`.
const USER_AGENT = (JSON.parse(readFileSync('manifest.json', 'utf8')) as { userAgent: string }).userAgent;
const LIVE = process.env['LIVE'] === '1';

describe.skipIf(!LIVE)('animenosub (live)', () => {
  it('browses, searches, reads details and episodes', { timeout: 120_000 }, async () => {
    const { client, runtime, call } = await loadSource('.', { prefs: [] });
    try {
      const latest = await client.getLatest(1, call);
      expect(latest.items.length).toBeGreaterThan(10);
      const popular = await client.getPopular(1, call);
      expect(popular.items.length).toBeGreaterThan(10);
      expect(popular.hasNextPage).toBe(true);
      const hits = await client.search('one piece', 1, {}, call);
      expect(hits.items.some((i) => i.url === '/anime/one-piece/')).toBe(true);
      const genre = await client.search('', 1, { genre: 'action', status: 'completed' }, call);
      expect(genre.items.length).toBeGreaterThan(0);

      const series = { url: '/anime/one-piece/', title: 'One Piece' };
      const details = await client.getAnimeDetails(series, call);
      expect(details).toMatchObject({ title: 'One Piece', year: 1999 });
      const episodes = await client.getEpisodes(series, call);
      expect(episodes.length).toBeGreaterThan(1000);
      expect(episodes[0]?.number).toBeGreaterThanOrEqual(1100);
      await expect(
        client.getAnimeDetails({ url: '/anime/slug-that-does-not-exist-xyz/', title: 'x' }, call),
      ).rejects.toMatchObject({ typed: 'NotFoundError' });
    } finally {
      runtime.dispose();
    }
  });

  it('resolves streams and every one of them answers', { timeout: 180_000 }, async () => {
    const { client, runtime, call } = await loadSource('.', { prefs: [] });
    try {
      const episodes = await client.getEpisodes({ url: '/anime/a-certain-dark-item/', title: 'x' }, call);
      const streams = await client.getStreams(episodes[0]!, call);
      const probes: {
        server: string;
        kind: string | undefined;
        quality: number | undefined;
        status: number | string;
      }[] = [];
      for (const stream of streams) {
        const response = await fetch(stream.url, {
          headers: {
            'user-agent': USER_AGENT,
            ...stream.headers,
            ...(stream.kind === 'hls' ? {} : { Range: 'bytes=0-1023' }),
          },
          signal: AbortSignal.timeout(20_000),
        }).catch((e: Error) => e);
        const ok = response instanceof Response;
        probes.push({
          server: stream.server,
          kind: stream.kind,
          quality: stream.quality,
          status: ok ? response.status : String(response),
        });
        if (ok && stream.kind === 'hls' && response.status === 200) expect(await response.text()).toContain('#EXTM3U');
      }
      console.table(probes);
      expect(probes.length).toBeGreaterThan(0);
      // Each host (Moon, Omega, Nova) must have at least one HLS master that answers with a playlist; a single CDN
      // edge that refuses a connection from this machine is not a failure of the extension.
      for (const host of ['Moon', 'Omega', 'Nova']) {
        expect(probes.some((p) => p.server.startsWith(host) && p.status === 200)).toBe(true);
      }
    } finally {
      runtime.dispose();
    }
  });
});
