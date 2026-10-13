import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadSource } from '@matane-anime/extension-cli/run';

// Talks to the real API, so it only runs on request: `pnpm test:live`.
const USER_AGENT = (JSON.parse(readFileSync('manifest.json', 'utf8')) as { userAgent: string }).userAgent;
const LIVE = process.env['LIVE'] === '1';

describe.skipIf(!LIVE)('oploverz (live)', () => {
  it('browses, searches, reads details and episodes, and resolves a stream', { timeout: 180_000 }, async () => {
    const { client, runtime, call } = await loadSource('.', { prefs: [] });
    try {
      const latest = await client.getLatest(1, call);
      expect(latest.items.length).toBeGreaterThan(0);
      const popular = await client.getPopular(1, call);
      expect(popular.items.length).toBeGreaterThan(0);
      const hits = await client.search('one piece', 1, {}, call);
      expect(hits.items.length).toBeGreaterThan(0);
      const genre = await client.search('', 1, { genre: 'action' }, call);
      expect(genre.items.length).toBeGreaterThan(0);

      const op = { url: 'one-piece', title: 'One Piece' };
      const details = await client.getAnimeDetails(op, call);
      console.log('details', details.title, details.status, details.year);
      const episodes = await client.getEpisodes(op, call);
      console.log('episodes', episodes.length, episodes[0]);
      expect(episodes.length).toBeGreaterThan(1000);

      // The oldest episode is on Blogger: a direct googlevideo mp4.
      const streams = await client.getStreams(episodes.at(-1)!, call);
      console.log(streams.map((s) => `${s.server}|${s.quality}|${s.kind}|${new URL(s.url).host}`));
      expect(streams.length).toBeGreaterThan(0);
      for (const stream of streams) {
        const response = await fetch(stream.url, {
          headers: {
            'user-agent': USER_AGENT,
            ...stream.headers,
            ...(stream.kind === 'hls' ? {} : { Range: 'bytes=0-1023' }),
          },
          signal: AbortSignal.timeout(20_000),
        }).catch((e: Error) => e);
        console.log('probe', stream.server, response instanceof Response ? response.status : String(response));
      }

      await expect(client.getAnimeDetails({ url: 'slug-yang-tidak-ada-xyz', title: 'x' }, call)).rejects.toMatchObject({
        typed: 'NotFoundError',
      });
    } finally {
      runtime.dispose();
    }
  });

  it('resolves the newest episode of a fresh series to a readable upbolt playlist', { timeout: 120_000 }, async () => {
    const { client, runtime, call } = await loadSource('.', { prefs: [] });
    try {
      const latest = await client.getLatest(1, call);
      const episodes = await client.getEpisodes(latest.items[0]!, call);
      const streams = await client.getStreams(episodes[0]!, call);
      console.log(streams.map((s) => `${s.server}|${s.quality}|${s.kind}|${new URL(s.url).host}`));
      expect(streams.length).toBeGreaterThan(0);
      const upbolt = streams.filter((s) => s.server === 'Upbolt');
      // Every rung names its height, so the player can offer a choice of resolution.
      for (const stream of upbolt) expect(stream.quality).toBeGreaterThan(0);
      expect(new Set(upbolt.map((s) => s.quality)).size).toBe(upbolt.length);
      for (const stream of upbolt) {
        const playlist = await fetch(stream.url, { signal: AbortSignal.timeout(20_000) });
        expect(playlist.status).toBe(200);
        expect(await playlist.text()).toContain('#EXTM3U');
      }
    } finally {
      runtime.dispose();
    }
  });
});
