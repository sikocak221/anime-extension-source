import { afterEach, describe, expect, it } from 'vitest';
import { BASE, disposeAll, fixture, load, type Route } from './harness';

afterEach(disposeAll);

const SERIES = { url: '/anime/solo-leveling-season-2/', title: 'Solo Leveling Season 2' };

const site: Route = (r) => {
  const u = r.url;
  const name = u.includes('title=solo')
    ? 'search.html.txt'
    : u.includes('order=update')
      ? 'latest.html.txt'
      : u.includes('order=popular')
        ? 'popular.html.txt'
        : u.includes('/anime/solo-leveling-season-2/')
          ? 'detail_solo_leveling_s2.html.txt'
          : undefined;
  return name ? { status: 200, text: fixture(name) } : undefined;
};

describe('catalogue', () => {
  it('popular is order=popular, cards are paths with full-size posters, and a next page exists', async () => {
    const { client, requests } = await load(site);
    const result = await client.getPopular(1);
    expect(requests[0]?.url).toBe(`${BASE}/anime/?order=popular`);
    expect(result.items.length).toBeGreaterThan(10);
    for (const item of result.items) {
      expect(item.url).toMatch(/^\/anime\/[^/]+\/$/);
      expect(item.title).not.toBe('');
      expect(item.thumbnailUrl ?? 'https://').not.toContain('resize=');
    }
    expect(result.hasNextPage).toBe(true);
  });

  it('latest is ordered by update and pages with /page/<n>/', async () => {
    const { client, requests } = await load(site);
    const result = await client.getLatest(2);
    expect(requests[0]?.url).toBe(`${BASE}/anime/page/2/?order=update`);
    expect(result.items.length).toBeGreaterThan(0);
  });

  it('searches by title and passes the filters along', async () => {
    const { client, requests } = await load(site);
    const result = await client.search('solo leveling', 1, {});
    expect(requests[0]?.url).toBe(`${BASE}/anime/?title=solo+leveling`);
    expect(result.items.some((i) => i.url === '/anime/solo-leveling-season-2/')).toBe(true);
    await client.search('', 3, { genre: 'action', status: 'ongoing', type: 'TV', order: 'popular', bogus: 'x' });
    const url = new URL(requests[1]?.url ?? '');
    expect(url.pathname).toBe('/anime/page/3/');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      'genre[]': 'action',
      status: 'ongoing',
      type: 'TV',
      order: 'popular',
    });
  });

  it('ignores values that are not in the filter lists', async () => {
    const { client, requests } = await load(site);
    await client.search('solo', 1, { genre: 'x&y=1', order: 'drop table' });
    expect(requests[0]?.url).toBe(`${BASE}/anime/?title=solo`);
  });

  it('describes its filters', async () => {
    const { client } = await load(site);
    const filters = await client.getFilters();
    expect(filters.map((f) => ('id' in f ? f.id : f.type))).toEqual(['genre', 'status', 'type', 'order']);
  });

  it('treats a missing page past the end as empty', async () => {
    const { client } = await load(() => ({ status: 404, text: 'nope' }));
    expect(await client.getPopular(9)).toEqual({ items: [], hasNextPage: false });
  });
});

describe('details and episodes', () => {
  it('reads the series page', async () => {
    const { client } = await load(site);
    const details = await client.getAnimeDetails(SERIES);
    expect(details).toMatchObject({
      url: '/anime/solo-leveling-season-2/',
      title: 'Solo Leveling Season 2',
      status: 'ongoing',
      type: 'tv',
      year: 2025,
      studio: 'A-1 Pictures',
    });
    expect(details.genres).toContain('Action');
    expect(details.description).toMatch(/Musim kedua/);
    expect(details.thumbnailUrl).toMatch(/145502l\.jpg$/);
    expect(details.altTitles).toContain('Solo Leveling Season 2: Arise from the Shadow');
  });

  it('lists the episodes newest first, with paths that survive a domain change', async () => {
    const { client } = await load(site);
    const episodes = await client.getEpisodes(SERIES);
    expect(episodes).toHaveLength(13);
    expect(episodes[0]).toEqual({
      url: '/nonton-solo-leveling-season-2-episode-13/',
      name: 'Episode 13 END',
      number: 13,
    });
    expect(episodes.at(-1)).toMatchObject({ url: '/nonton-solo-leveling-season-2-episode-1/', number: 1 });
  });

  it('shares one request between details and episodes asked together', async () => {
    const { client, requests } = await load(site);
    await Promise.all([client.getAnimeDetails(SERIES), client.getEpisodes(SERIES)]);
    expect(requests.filter((r) => r.url.includes('/anime/solo-leveling-season-2/'))).toHaveLength(1);
  });

  it('fails clearly when the layout changed', async () => {
    const { client } = await load(() => ({ status: 200, text: '<html><body>hi</body></html>' }));
    await expect(client.getAnimeDetails(SERIES)).rejects.toThrow(/layout changed/);
  });

  it('maps pasted urls of any domain, and builds web urls from the current base', async () => {
    const { client } = await load(site);
    expect(await client.resolveUrl('https://kuronime.moe/anime/one-piece-op/')).toMatchObject({
      url: '/anime/one-piece-op/',
    });
    expect(await client.resolveUrl('https://example.com/anime/x/')).toBeNull();
    expect(await client.getWebUrl({ url: '/nonton-x-episode-1/', name: 'Episode 1' })).toBe(
      `${BASE}/nonton-x-episode-1/`,
    );
  });
});
