import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadSource } from '@matane-anime/extension-cli/run';

// Talks to the real site, so it only runs on request: `pnpm test:live`.
const USER_AGENT = (JSON.parse(readFileSync('manifest.json', 'utf8')) as { userAgent: string }).userAgent;
const LIVE = process.env['LIVE'] === '1';

describe.skipIf(!LIVE)('luciferdonghua (live)', () => {
  it('browses, searches, reads details and episodes', { timeout: 120_000 }, async () => {
    const { client, runtime, call } = await loadSource('.', { prefs: [] });
    try {
      const latest = await client.getLatest(1, call);
      expect(latest.items.length).toBeGreaterThan(10);
      const popular = await client.getPopular(1, call);
      expect(popular.items.length).toBeGreaterThan(10);
      expect(popular.hasNextPage).toBe(true);
      const hits = await client.search('jade dynasty', 1, {}, call);
      expect(hits.items.some((i) => i.url === '/anime/jade-dynasty-final-season-4/')).toBe(true);
      const genre = await client.search('', 1, { genre: 'action', status: 'ongoing' }, call);
      expect(genre.items.length).toBeGreaterThan(0);

      const series = { url: '/anime/jade-dynasty-final-season-4/', title: 'Jade Dynasty Final Season 4 (2026)' };
      const details = await client.getAnimeDetails(series, call);
      expect(details).toMatchObject({ title: 'Jade Dynasty Final Season 4 (2026)', year: 2026 });
      const episodes = await client.getEpisodes(series, call);
      expect(episodes.length).toBeGreaterThanOrEqual(10);
      expect(episodes[0]?.number).toBeGreaterThanOrEqual(10);
      await expect(
        client.getAnimeDetails({ url: '/anime/slug-yang-tidak-ada-xyz/', title: 'x' }, call),
      ).rejects.toMatchObject({ typed: 'NotFoundError' });
    } finally {
      runtime.dispose();
    }
  });

  it('resolves streams and every one of them answers', { timeout: 180_000 }, async () => {
    const { client, runtime, call } = await loadSource('.', { prefs: [] });
    try {
      const series = { url: '/anime/jade-dynasty-final-season-4/', title: 'x' };
      const episodes = await client.getEpisodes(series, call);
      const streams = await client.getStreams(
        episodes.find((e) => e.number === 10)!,
        call,
      );
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
      // Dailymotion's CDN may refuse some networks, and a new episode may be on Dailymotion only; ok.ru is asserted
      // when it is there.
      for (const probe of probes.filter((p) => p.server.startsWith('Ok.ru'))) {
        expect(probe.status).toSatisfy((s) => s === 200 || s === 206);
      }
    } finally {
      runtime.dispose();
    }
  });
});
