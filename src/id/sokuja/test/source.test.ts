import { afterEach, describe, expect, it } from 'vitest';
import { BASE, type Route, disposeAll, fixture, load } from './harness';

afterEach(disposeAll);

const ok = (name: string) => ({ status: 200, text: fixture(name) });
const SHORT = '/anime/katainaka-no-ossan-kensei-ni-naru-ii-subtitle-indonesia/';
const LONG = '/anime/one-piece-subtitle-indonesia/';

/** The site's pages by path, as the real site answers them (see test/fixtures). */
const site: Route = (request) => {
  const url = new URL(request.url);
  const path = `${url.pathname}${url.search}`;
  if (path === '/anime/?order=popular') return ok('popular.html.txt');
  if (path === '/anime/?page=34') return ok('last_page.html.txt');
  if (path === '/anime/?page=99') return ok('beyond.html.txt');
  if (path === '/?s=one+piece') return ok('search_results.html.txt');
  if (url.pathname === SHORT) return ok('detail_short.html.txt');
  if (url.pathname === LONG) return ok('detail_long.html.txt');
  if (url.pathname === '/api/playlist/') return ok('playlist.json');
  return undefined;
};

describe('listings', () => {
  it('reads the popular list, with direct cover addresses', async () => {
    const { client, requests } = await load(site);
    const page = await client.getPopular(1);
    expect(requests[0]?.url).toBe(`${BASE}/anime/?order=popular`);
    expect(page.items).toHaveLength(24);
    expect(new Set(page.items.map((i) => i.url)).size).toBe(24);
    expect(page.items[0]).toEqual({
      url: '/anime/one-piece-subtitle-indonesia/',
      title: expect.any(String) as string,
      thumbnailUrl: expect.stringMatching(/^https:\/\/.+\.(?:jpe?g|webp|png)$/) as string,
    });
    // The cover is the original, not the site's resizer.
    expect(page.items.every((i) => !i.thumbnailUrl?.includes('/_next/image'))).toBe(true);
    expect(page.hasNextPage).toBe(true);
  });

  it('asks the later pages with ?page=', async () => {
    const { client, requests } = await load(site);
    await client.getPopular(2).catch(() => undefined);
    expect(requests[0]?.url).toBe(`${BASE}/anime/?order=popular&page=2`);
  });

  it('knows the last page, and that a page past it is empty and not an error', async () => {
    const { client } = await load(site);
    const last = await client.search('', 34, {});
    expect(last.items.length).toBeGreaterThan(0);
    expect(last.hasNextPage).toBe(false);
    const beyond = await client.search('', 99, {});
    expect(beyond).toEqual({ items: [], hasNextPage: false });
  });

  it('searches with the results page of the site', async () => {
    const { client, requests } = await load(site);
    const page = await client.search('one piece', 1, {});
    expect(requests[0]?.url).toBe(`${BASE}/?s=one+piece`);
    expect(page.items.map((i) => i.title)).toContain('One Piece');
    expect(page.hasNextPage).toBe(false);
  });

  it('turns the filters into the query of /anime/ and leaves the default order out', async () => {
    const { client, requests } = await load(() => ok('popular.html.txt'));
    await client.search('', 1, { genre: 'isekai', type: 'tv', status: 'ongoing', order: 'update' });
    expect(requests[0]?.url).toBe(`${BASE}/anime/?genre=isekai&status=ongoing&type=tv`);
    await client.search('', 1, { genre: 'not-a-genre', order: 'score' });
    expect(requests[1]?.url).toBe(`${BASE}/anime/?order=score`);
  });

  it('says so when the layout changes', async () => {
    const { client } = await load(() => ({ status: 200, text: '<html><body><p>nothing</p></body></html>' }));
    await expect(client.getPopular(1)).rejects.toThrow(/site layout changed/);
  });

  it('declares the filters', async () => {
    const { client } = await load(site);
    const filters = await client.getFilters();
    expect(filters.map((f) => ('id' in f ? f.id : f.type))).toEqual(['header', 'genre', 'status', 'type', 'order']);
  });
});

describe('details', () => {
  it('reads the title, the other names, the plot and the information rows', async () => {
    const { client } = await load(site);
    const details = await client.getAnimeDetails({ url: SHORT, title: 'x' });
    expect(details).toMatchObject({
      url: SHORT,
      title: 'Katainaka no Ossan, Kensei ni Naru II',
      genres: ['Action', 'Fantasy'],
      studio: 'Passione, Hayabusa Film',
      year: 2026,
      status: 'completed',
      type: 'tv',
    });
    expect(details.altTitles?.[0]).toBe('Pendekar Desa yang Menjadi Ahli Pedang Season 2');
    expect(details.thumbnailUrl).toMatch(/^https:\/\/x6\.sokuja\.uk\/uploads\/.+\.webp$/);
    // The first paragraph of the page is a link to the other season.
    expect(details.description).not.toMatch(/^Series Lain/);
    expect(details.description).toMatch(/^Katainaka no Ossan, Kensei ni Naru II melanjutkan/);
  });
});

describe('episodes', () => {
  it('reads the list of a short series, newest first', async () => {
    const { client, requests } = await load(site);
    const episodes = await client.getEpisodes({ url: SHORT, title: 'x' });
    expect(episodes).toHaveLength(12);
    expect(episodes[0]).toEqual({
      url: '/katainaka-no-ossan-kensei-ni-naru-ii-episode-12-subtitle-indonesia/',
      name: 'Episode 12',
      number: 12,
    });
    expect(episodes.at(-1)?.number).toBe(1);
    // It is all on the page: no request for the playlist.
    expect(requests.some((r) => r.url.includes('/api/playlist/'))).toBe(false);
  });

  it('shares the page between the details and the episodes', async () => {
    const { client, requests } = await load(site);
    await Promise.all([
      client.getAnimeDetails({ url: SHORT, title: 'x' }),
      client.getEpisodes({ url: SHORT, title: 'x' }),
    ]);
    expect(requests.filter((r) => r.url === `${BASE}${SHORT}`)).toHaveLength(1);
  });

  it('gets the whole list of a long series from the playlist the site uses', async () => {
    const { client, requests } = await load(site);
    const episodes = await client.getEpisodes({ url: LONG, title: 'x' });
    // The page shows the newest 50 and "Muat Lebih Banyak"; it says 461, and one of them is the batch download.
    expect(episodes).toHaveLength(460);
    expect(episodes[0]).toMatchObject({ name: 'Episode 1180', number: 1180 });
    expect(episodes.at(-1)).toEqual({ url: '/one-piece-episode-1-subtitle-indonesia/', name: 'Episode 1', number: 1 });
    expect(episodes.some((e) => /batch/.test(e.url))).toBe(false);
    expect(new Set(episodes.map((e) => e.url)).size).toBe(460);
    expect(requests.find((r) => r.url.includes('/api/playlist/'))?.url).toMatch(
      /\/api\/playlist\/\?slug=one-piece-episode-1180-subtitle-indonesia$/,
    );
  });

  it('keeps the episodes of the page when the playlist cannot be read', async () => {
    const { client, logs } = await load((request) =>
      request.url.includes('/api/playlist/') ? { status: 500 } : site(request),
    );
    const episodes = await client.getEpisodes({ url: LONG, title: 'x' });
    expect(episodes).toHaveLength(50);
    expect(logs.some((line) => line.startsWith('warn:'))).toBe(true);
  });
});

describe('links', () => {
  it('turns a site address into an anime, on any mirror', async () => {
    const { client } = await load(site);
    for (const host of ['x6.sokuja.uk', 'sokuja.net', 'www.sokuja.id']) {
      expect(await client.resolveUrl(`https://${host}/anime/one-piece-subtitle-indonesia/`)).toEqual({
        url: LONG,
        title: 'one piece subtitle indonesia',
      });
    }
    expect(await client.resolveUrl('https://example.com/anime/one-piece/')).toBeNull();
  });

  it('opens pages on the site address', async () => {
    const { client } = await load(site);
    expect(await client.getWebUrl({ url: LONG, title: 'x' })).toBe(`${BASE}${LONG}`);
  });
});
