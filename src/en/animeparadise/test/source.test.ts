import { afterEach, describe, expect, it } from 'vitest';
import { BASE, disposeAll, fixture, load } from './harness';

afterEach(disposeAll);

const json = (name: string) => ({ status: 200, text: fixture(name) });
const STREAM = 'https://stream.animeparadise.moe';
const ORIGIN = '6ICnxe6m3XcIBf5E';
const UID = 'eba80124-4c48-4bb7-bbc1-ef1884ae9794';

describe('listings', () => {
  it('reads popular as the POPULARITY sort', async () => {
    const { client, requests } = await load((r) =>
      r.url.startsWith(`${BASE}/search?`) ? json('search_popular.json') : undefined,
    );
    const page = await client.getPopular(1);
    const url = new URL(requests[0]?.url ?? '');
    expect(url.searchParams.get('sort')).toBe('POPULARITY');
    expect(url.searchParams.get('page')).toBe('1');
    expect(page.items).toHaveLength(20);
    expect(page.items[0]).toEqual({
      url: expect.stringMatching(/^[A-Za-z0-9-]+$/) as string,
      title: expect.any(String) as string,
      thumbnailUrl: expect.stringContaining('https://') as string,
    });
    expect(new Set(page.items.map((i) => i.url)).size).toBe(page.items.length);
    expect(page.hasNextPage).toBe(true);
  });

  it('reads latest as the POST_DATE sort', async () => {
    const { client, requests } = await load((r) =>
      r.url.startsWith(`${BASE}/search?`) ? json('search_latest.json') : undefined,
    );
    const page = await client.getLatest(3);
    const url = new URL(requests[0]?.url ?? '');
    expect(url.searchParams.get('sort')).toBe('POST_DATE');
    expect(url.searchParams.get('page')).toBe('3');
    expect(page.items.length).toBeGreaterThan(0);
  });

  it('searches with q, genres, season, year and sort, and ends on the last page', async () => {
    const { client, requests } = await load((r) =>
      r.url.startsWith(`${BASE}/search?`) ? json('search_naruto.json') : undefined,
    );
    const page = await client.search('  naruto ', 2, {
      'genre:Action': true,
      'genre:Comedy': true,
      'genre:Comedy2': true,
      season: 'Fall',
      year: '2017',
      sort: 'RELEASE_DATE',
    });
    const url = new URL(requests[0]?.url ?? '');
    expect(url.searchParams.get('q')).toBe('naruto');
    expect(url.searchParams.getAll('genres')).toEqual(['Action', 'Comedy']);
    expect(url.searchParams.get('season')).toBe('Fall');
    expect(url.searchParams.get('year')).toBe('2017');
    expect(url.searchParams.get('sort')).toBe('RELEASE_DATE');
    expect(url.searchParams.get('page')).toBe('2');
    expect(page.items.map((i) => i.url)).toContain('boruto-naruto-next-generations');
    expect(page.hasNextPage).toBe(false);
  });

  it('omits empty q and ignores malformed filter values', async () => {
    const { client, requests } = await load((r) =>
      r.url.startsWith(`${BASE}/search?`) ? json('search_popular.json') : undefined,
    );
    await client.search('  ', 1, { season: 'Monsoon', year: '20x7', sort: 'DROP' });
    expect(requests[0]?.url).toBe(`${BASE}/search?page=1&limit=20`);
  });

  it('reports a body that is not a list', async () => {
    const { client } = await load(() => ({ status: 200, text: '{"success":true,"data":{"nope":1}}' }));
    await expect(client.getPopular(1)).rejects.toThrow(/site changed/);
  });

  it('exposes sort, season, year and genre filters', async () => {
    const { client } = await load(() => undefined);
    const filters = await client.getFilters();
    expect(filters.map((f) => f.type)).toEqual(['select', 'select', 'select', 'group']);
    const group = filters.find((f) => f.type === 'group');
    expect(group?.type === 'group' ? group.filters.length : 0).toBe(18);
  });
});

describe('details and episodes', () => {
  it('maps the anime object', async () => {
    const { client, requests } = await load((r) =>
      r.url === `${BASE}/anime/boruto-naruto-next-generations` ? json('anime_detail.json') : undefined,
    );
    const d = await client.getAnimeDetails({ url: 'boruto-naruto-next-generations', title: 'Boruto' });
    expect(requests[0]?.url).toBe(`${BASE}/anime/boruto-naruto-next-generations`);
    expect(d).toMatchObject({
      url: 'boruto-naruto-next-generations',
      title: 'Boruto: Naruto Next Generations',
      status: 'unknown',
      type: 'tv',
      year: 2017,
    });
    expect(d.genres).toEqual(['Action', 'Adventure', 'Fantasy']);
    expect(d.description).toContain('Naruto was a young shinobi');
  });

  it('reports a missing anime as not found', async () => {
    const { client } = await load(() => json('anime_missing.json'));
    await expect(client.getAnimeDetails({ url: 'nonexistent-xyz', title: 'x' })).rejects.toMatchObject({
      typed: 'NotFoundError',
    });
  });

  it('looks the anime _id up and lists episodes newest first', async () => {
    const { client, requests } = await load((r) => {
      if (r.url === `${BASE}/anime/boruto-naruto-next-generations`) return json('anime_detail.json');
      if (r.url === `${BASE}/anime/${ORIGIN}/episode`) return json('anime_episodes.json');
      return undefined;
    });
    const list = await client.getEpisodes({ url: 'boruto-naruto-next-generations', title: 'Boruto' });
    expect(requests.map((r) => r.url)).toEqual([
      `${BASE}/anime/boruto-naruto-next-generations`,
      `${BASE}/anime/${ORIGIN}/episode`,
    ]);
    expect(list).toHaveLength(293);
    expect(list[0]?.number).toBe(293);
    expect(list.at(-1)).toEqual({ url: `${ORIGIN}/${UID}`, name: 'Boruto Uzumaki!', number: 1 });
    const numbers = list.map((e) => e.number ?? 0);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
    expect(new Set(list.map((e) => e.url)).size).toBe(list.length);
  });

  it('survives untitled episodes, odd numbers and duplicates', async () => {
    const { client } = await load((r) =>
      r.url.endsWith('/episode')
        ? {
            status: 200,
            text: JSON.stringify({
              success: true,
              data: [
                { uid: 'a', title: '  ', number: '1' },
                { uid: 'b', title: null, number: '1.5' },
                { uid: 'a', title: 'dup', number: '1' },
                { title: 'no uid', number: '9' },
                { uid: 'c', title: 'Special', number: null },
              ],
            }),
          }
        : { status: 200, text: JSON.stringify({ success: true, data: { _id: 'X1', link: 's', title: 's' } }) },
    );
    const list = await client.getEpisodes({ url: 's', title: 's' });
    expect(list).toEqual([
      { url: 'X1/c', name: 'Special' },
      { url: 'X1/b', name: 'Episode 1.5', number: 1.5 },
      { url: 'X1/a', name: 'Episode 1', number: 1 },
    ]);
  });
});

describe('streams', () => {
  const routes = (r: { url: string }) => {
    if (r.url === `${BASE}/ep/${UID}?origin=${ORIGIN}`) return json('ep_1.json');
    if (r.url.startsWith(`${STREAM}/m3u8?url=`)) return json('master.m3u8');
    return undefined;
  };

  it('returns the master playlist and every height of its ladder', async () => {
    const { client, requests } = await load(routes);
    const streams = await client.getStreams({ url: `${ORIGIN}/${UID}`, name: 'Boruto Uzumaki!' });
    expect(requests).toHaveLength(2);
    expect(streams[0]).toMatchObject({ server: 'AnimeParadise (auto)', kind: 'hls', quality: 1080 });
    expect(streams[0]?.url.startsWith(`${STREAM}/m3u8?url=`)).toBe(true);
    expect(streams.slice(1).map((s) => s.quality)).toEqual([1080, 720, 480]);
    for (const rung of streams.slice(1)) {
      expect(rung.url.startsWith(`${STREAM}/m3u8?url=`)).toBe(true);
      expect(rung.url).not.toBe(streams[0]?.url);
    }
  });

  it('reports an episode without a stream as not found', async () => {
    const { client } = await load(() => json('ep_missing.json'));
    await expect(client.getStreams({ url: `${ORIGIN}/bad-uid`, name: 'x' })).rejects.toMatchObject({
      typed: 'NotFoundError',
    });
  });

  it('rejects an episode url it did not make', async () => {
    const { client } = await load(() => undefined);
    await expect(client.getStreams({ url: 'nope', name: 'x' })).rejects.toMatchObject({ typed: 'NotFoundError' });
  });

  it('reports a playlist that is not one', async () => {
    const { client } = await load((r) =>
      r.url.startsWith(`${BASE}/ep/`) ? json('ep_1.json') : { status: 200, text: '<html></html>' },
    );
    await expect(client.getStreams({ url: `${ORIGIN}/${UID}`, name: 'x' })).rejects.toThrow(/site changed/);
  });
});

describe('urls', () => {
  it('resolves site links and builds web urls', async () => {
    const { client } = await load(() => undefined);
    expect(await client.resolveUrl?.('https://www.animeparadise.moe/anime/one-piece')).toMatchObject({
      url: 'one-piece',
    });
    expect(await client.resolveUrl?.('https://example.com/x')).toBeNull();
    expect(await client.getWebUrl?.({ url: 'one-piece', title: 'x' })).toBe(
      'https://www.animeparadise.moe/anime/one-piece',
    );
    expect(await client.getWebUrl?.({ url: `${ORIGIN}/${UID}`, name: 'x' })).toBe(
      `https://www.animeparadise.moe/watch/${UID}?origin=${ORIGIN}`,
    );
  });
});
