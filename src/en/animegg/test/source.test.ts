import { afterEach, describe, expect, it } from 'vitest';
import { BASE, disposeAll, fixture, load, type Route } from './harness';

afterEach(disposeAll);

const DBZ = { url: '/series/dragonball-z', title: 'Dragon Ball Z' };

const site: Route = (r) => {
  const u = new URL(r.url);
  const path = decodeURIComponent(u.pathname);
  const name =
    path === '/popular-series'
      ? 'popular.html.txt'
      : path === '/releases'
        ? 'latest.html.txt'
        : path === '/search'
          ? 'search.html.txt'
          : path.startsWith('/genre/')
            ? 'genre.html.txt'
            : path === '/series/dragonball-z'
              ? 'detail.html.txt'
              : path === '/dragonball-z-episode-291'
                ? 'episode.html.txt'
                : path === '/detectiveconan-episode-1215'
                  ? 'episode_sub_only.html.txt'
                  : path === '/embed/44653'
                    ? 'embed_dub.html.txt'
                    : path === '/embed/44654' || path === '/embed/147307'
                      ? 'embed_sub.html.txt'
                      : undefined;
  return name
    ? { status: 200, text: fixture(name) }
    : u.pathname.startsWith('/series/')
      ? { status: 404, text: 'no' }
      : undefined;
};

describe('listings', () => {
  it('popular reads the cards, with absolute covers, and pages by offset', async () => {
    const { client, requests } = await load(site);
    const result = await client.getPopular(1);
    expect(requests[0]?.url).toBe(`${BASE}/popular-series?start=0`);
    expect(result.items).toHaveLength(25);
    expect(result.hasNextPage).toBe(true);
    expect(result.items[0]).toMatchObject({
      url: '/series/one-piece',
      title: 'One Piece',
      thumbnailUrl: expect.stringMatching(/^https:\/\/vidcache\.net/),
    });
    expect(new Set(result.items.map((i) => i.url)).size).toBe(25);
    await client.getPopular(3);
    expect(requests[1]?.url).toBe(`${BASE}/popular-series?start=50`);
  });

  it('latest reads the recent releases, ten to a page', async () => {
    const { client, requests } = await load(site);
    const result = await client.getLatest(2);
    expect(requests[0]?.url).toBe(`${BASE}/releases?start=10`);
    expect(result.items.length).toBeGreaterThan(5);
    expect(result.items[0]).toMatchObject({ url: '/series/oriental-martial-academy' });
    expect(result.items.every((i) => i.title.length > 0 && i.url.startsWith('/series/'))).toBe(true);
    expect(result.hasNextPage).toBe(true);
  });

  it('search reads the result cards and has a single page', async () => {
    const { client, requests } = await load(site);
    const result = await client.search('naruto', 1, {});
    expect(requests[0]?.url).toBe(`${BASE}/search?q=naruto`);
    expect(result.items).toHaveLength(55);
    expect(result.items[0]).toMatchObject({ url: '/series/naruto', title: 'Naruto' });
    expect(result.hasNextPage).toBe(false);
    expect((await client.search('naruto', 2, {})).items).toEqual([]);
    expect(requests).toHaveLength(1);
  });

  it('filters build the genre, sort and status query', async () => {
    const { client, requests } = await load(site);
    const result = await client.search('', 2, { genre: 'Slice of Life', sort: 'createdAt', status: 'ongoing' });
    expect(requests[0]?.url).toBe(
      `${BASE}/genre/slice%20of%20life?sortBy=createdAt&sortDirection=DESC&ongoing=true&start=25`,
    );
    expect(result.items).toHaveLength(25);
    await client.search('', 1, { sort: 'sortLetter', status: 'completed' });
    expect(requests[1]?.url).toBe(`${BASE}/popular-series?sortBy=sortLetter&sortDirection=ASC&ongoing=false&start=0`);
    await client.search('', 1, { genre: 'not a genre' });
    expect(requests[2]?.url).toBe(`${BASE}/popular-series?start=0`);
  });

  it('offers sort, status and genre filters', async () => {
    const { client } = await load(site);
    const filters = await client.getFilters();
    expect(filters.map((f) => ('id' in f ? f.id : f.type))).toEqual(['header', 'sort', 'status', 'genre']);
  });

  it('a layout without cards or frame is a parse error', async () => {
    const { client } = await load(() => ({ status: 200, text: '<html><body>nothing</body></html>' }));
    await expect(client.getPopular(1)).rejects.toMatchObject({ typed: 'ParseError' });
  });
});

describe('details and episodes', () => {
  it('reads the details', async () => {
    const { client, requests } = await load(site);
    const details = await client.getAnimeDetails(DBZ);
    expect(requests[0]?.url).toBe(`${BASE}/series/dragonball-z`);
    expect(details).toMatchObject({ url: '/series/dragonball-z', title: 'Dragon Ball Z', status: 'completed' });
    expect(details.genres).toEqual(expect.arrayContaining(['Martial Arts', 'Shounen']));
    expect(details.altTitles).toEqual(expect.arrayContaining(['DBZ']));
    expect(details.description?.length).toBeGreaterThan(50);
    expect(details.thumbnailUrl).toMatch(/^https:\/\/vidcache\.net/);
  });

  it('lists the episodes newest first, a dubbed one as both Sub and Dub', async () => {
    const { client, requests } = await load(site);
    const episodes = await client.getEpisodes(DBZ);
    expect(episodes).toHaveLength(579);
    expect(episodes[0]).toMatchObject({
      url: '/dragonball-z-episode-291#subbed',
      number: 291,
      variant: 'Sub',
      name: 'Episode 291 - Goku`s Next Journey',
    });
    expect(episodes[1]).toMatchObject({ url: '/dragonball-z-episode-291#dubbed', number: 291, variant: 'Dub' });
    expect(new Set(episodes.map((e) => e.url)).size).toBe(episodes.length);
    expect(episodes[episodes.length - 1]?.number).toBe(1);
    // Details and episodes come from one fetch.
    await client.getAnimeDetails(DBZ);
    expect(requests).toHaveLength(1);
  });

  it('an unknown series is not found', async () => {
    const { client } = await load(site);
    await expect(client.getAnimeDetails({ url: '/series/zzz', title: 'x' })).rejects.toMatchObject({
      typed: 'NotFoundError',
    });
    await expect(client.getEpisodes({ url: '/popular-series', title: 'x' })).rejects.toMatchObject({
      typed: 'NotFoundError',
    });
  });
});

describe('streams', () => {
  it('returns the dub qualities with the embed as Referer', async () => {
    const { client, requests } = await load(site);
    const streams = await client.getStreams({
      url: '/dragonball-z-episode-291#dubbed',
      name: 'Episode 291',
      number: 291,
    });
    expect(requests.map((r) => r.url)).toEqual([`${BASE}/dragonball-z-episode-291`, `${BASE}/embed/44653`]);
    expect(streams).toEqual([
      {
        url: `${BASE}/play/86765/video.mp4?for=101791641740219`,
        server: 'Animegg Dub',
        quality: 360,
        kind: 'mp4',
        headers: { Referer: `${BASE}/embed/44653` },
      },
    ]);
  });

  it('a sub request reads the sub player only; no suffix reads both, best quality first', async () => {
    const { client, requests } = await load(site);
    const sub = await client.getStreams({ url: '/dragonball-z-episode-291#subbed', name: 'x' });
    expect(requests.some((r) => r.url.endsWith('/embed/44653'))).toBe(false);
    expect(sub.every((s) => s.server === 'Animegg Sub')).toBe(true);
    const both = await client.getStreams({ url: '/dragonball-z-episode-291', name: 'x' });
    expect(new Set(both.map((s) => s.server))).toEqual(new Set(['Animegg Sub', 'Animegg Dub']));
    const heights = both.map((s) => s.quality ?? 0);
    expect(heights).toEqual([...heights].sort((a, b) => b - a));
  });

  it('reads 480p, 720p and 1080p from a sub-only episode', async () => {
    const { client } = await load(site);
    const streams = await client.getStreams({ url: '/detectiveconan-episode-1215#subbed', name: 'x' });
    expect(streams.map((s) => s.quality)).toEqual([1080, 720, 480]);
    expect(streams[0]?.url).toBe(`${BASE}/play/551496/video.mp4?for=101791641631131`);
    expect(streams[0]?.headers).toEqual({ Referer: `${BASE}/embed/147307` });
  });

  it('a missing episode page is not found', async () => {
    const { client } = await load(() => ({ status: 404, text: 'Not found' }));
    await expect(client.getStreams({ url: '/nope-episode-1#subbed', name: 'x' })).rejects.toMatchObject({
      typed: 'NotFoundError',
    });
  });
});

describe('urls', () => {
  it('resolves a pasted series address and builds web urls', async () => {
    const { client } = await load(site);
    expect(await client.resolveUrl('https://www.animegg.org/series/naruto')).toEqual({
      url: '/series/naruto',
      title: 'naruto',
    });
    expect(await client.resolveUrl('https://example.com/series/naruto')).toBeNull();
    expect(await client.getWebUrl({ url: '/dragonball-z-episode-291#dubbed', name: 'x' })).toBe(
      `${BASE}/dragonball-z-episode-291`,
    );
  });
});
