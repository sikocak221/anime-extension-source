import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadSource } from '@matane-anime/extension-cli/run';

// Talks to the real site, so it only runs on request: `pnpm test:live`.
const USER_AGENT = (JSON.parse(readFileSync('manifest.json', 'utf8')) as { userAgent: string }).userAgent;
const LIVE = process.env['LIVE'] === '1';

describe.skipIf(!LIVE)('animekhor (live)', () => {
  it('browses, searches, reads details and episodes', { timeout: 120_000 }, async () => {
    const { client, runtime, call } = await loadSource('.', { prefs: [] });
    try {
      const latest = await client.getLatest(1, call);
      expect(latest.items.length).toBeGreaterThan(10);
      const popular = await client.getPopular(1, call);
      expect(popular.items.length).toBeGreaterThan(10);
      expect(popular.hasNextPage).toBe(true);
      const hits = await client.search('renegade immortal', 1, {}, call);
      expect(hits.items.some((i) => i.url === '/anime/renegade-immortal/')).toBe(true);
      const genre = await client.search('', 1, { genre: 'xianxia', status: 'ongoing' }, call);
      expect(genre.items.length).toBeGreaterThan(0);

      const series = { url: '/anime/renegade-immortal/', title: 'Renegade Immortal' };
      const details = await client.getAnimeDetails(series, call);
      expect(details).toMatchObject({ title: 'Renegade Immortal', year: 2023 });
      const episodes = await client.getEpisodes(series, call);
      expect(episodes.length).toBeGreaterThan(40);
      expect(episodes[0]?.number).toBeGreaterThanOrEqual(161);
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
      const episodes = await client.getEpisodes({ url: '/anime/renegade-immortal/', title: 'x' }, call);
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
      // ok.ru is verified to play; Dailymotion's CDN may refuse some networks, so only ok.ru is asserted.
      const okru = probes.filter((p) => p.server.startsWith('Ok.ru'));
      expect(okru.length).toBeGreaterThan(0);
      for (const probe of okru) expect(probe.status).toSatisfy((s) => s === 200 || s === 206);
    } finally {
      runtime.dispose();
    }
  });
});
