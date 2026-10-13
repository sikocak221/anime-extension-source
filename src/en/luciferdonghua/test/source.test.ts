import { afterEach, describe, expect, it } from 'vitest';
import { BASE, disposeAll, fixture, load } from './harness';
import { episodeName, parseEpisodeDate, parseNumber } from '../src/text';

afterEach(disposeAll);

const page = (name: string) => ({ status: 200, text: fixture(name) });
const SERIES = { url: '/anime/jade-dynasty-final-season-4/', title: 'Jade Dynasty Final Season 4 (2026)' };

describe('listings', () => {
  it('reads popular with covers and the next page', async () => {
    const { client, requests } = await load((r) =>
      r.url.includes('order=popular') ? page('list_popular.html.txt') : undefined,
    );
    const result = await client.getPopular(1);
    expect(requests[0]?.url).toBe(`${BASE}/anime/?order=popular`);
    expect(result.items.length).toBeGreaterThan(10);
    expect(result.items[0]).toEqual({
      url: '/anime/battle-through-the-heavens-season-5-new/',
      title: 'Battle Through The Heavens Season 5',
      thumbnailUrl:
        'https://i2.wp.com/luciferdonghua.in/wp-content/uploads/2022/07/battle-through-the-heavens-season-5-new-2.webp?resize=247,350',
    });
    expect(result.items.every((i) => i.url.startsWith('/') && i.thumbnailUrl?.startsWith('https://'))).toBe(true);
    expect(result.hasNextPage).toBe(true);
  });

  it('latest is ordered by update and pages with ?page', async () => {
    const { client, requests } = await load((r) =>
      r.url.includes('order=update') ? page('list_popular.html.txt') : undefined,
    );
    await client.getLatest(3);
    expect(requests[0]?.url).toBe(`${BASE}/anime/?order=update&page=3`);
  });

  it('searches by text, pages with /page/N/ and sees the pagination of the results', async () => {
    const { client, requests } = await load((r) => (r.url.includes('s=') ? page('search.html.txt') : undefined));
    const result = await client.search('dragon', 2, { genre: 'action' });
    expect(requests[0]?.url).toBe(`${BASE}/page/2/?s=dragon`);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.hasNextPage).toBe(true);
  });

  it('builds filter urls and drops unknown values', async () => {
    const { client, requests } = await load((r) =>
      r.url.includes('/anime/?') ? page('list_popular.html.txt') : undefined,
    );
    await client.search('', 2, { genre: 'cultivation', status: 'ongoing', type: 'ona', order: 'popular' });
    await client.search('', 1, { genre: '../x', status: 'bogus' });
    const first = new URL(requests[0]?.url ?? '');
    expect(first.searchParams.getAll('genre[]')).toEqual(['cultivation']);
    expect(first.searchParams.get('status')).toBe('ongoing');
    expect(first.searchParams.get('type')).toBe('ona');
    expect(first.searchParams.get('page')).toBe('2');
    expect(requests[1]?.url).toBe(`${BASE}/anime/?order=update`);
  });

  it('a page past the end (404) is empty, a first-page 404 is an error', async () => {
    const { client } = await load((r) => ({ status: 404, url: r.url }));
    expect(await client.getPopular(9)).toEqual({ items: [], hasNextPage: false });
    await expect(client.getPopular(1)).rejects.toMatchObject({ typed: 'NotFoundError' });
  });

  it('reports a Cloudflare challenge', async () => {
    const { client } = await load((r) => ({ status: 403, url: r.url, text: 'Just a moment...' }));
    await expect(client.getPopular(1)).rejects.toMatchObject({ typed: 'CloudflareError' });
  });

  it('exposes the filters', async () => {
    const { client } = await load(() => undefined);
    const filters = await client.getFilters();
    expect(filters.map((f) => ('id' in f ? f.id : f.type))).toEqual([
      'header',
      'genre',
      'status',
      'type',
      'sub',
      'order',
    ]);
  });
});

describe('details and episodes', () => {
  const route = (r: { url: string }) =>
    r.url === `${BASE}/anime/jade-dynasty-final-season-4/` ? page('detail_jade.html.txt') : undefined;

  it('reads the details', async () => {
    const { client } = await load(route);
    const details = await client.getAnimeDetails(SERIES);
    expect(details).toMatchObject({
      url: '/anime/jade-dynasty-final-season-4/',
      title: 'Jade Dynasty Final Season 4 (2026)',
      thumbnailUrl:
        'https://i3.wp.com/luciferdonghua.in/wp-content/uploads/2026/08/jade-dynasty-final-season-4-lucifer-donghua-chinese-anime-2.webp?resize=247,350',
      altTitles: expect.arrayContaining(['诛仙 第四季', 'Jade Dynasty 4th Season']),
      genres: ['Action', 'Adventure', 'Fantasy', 'Historical', 'Martial Arts'],
      studio: 'Cloud Art',
      year: 2026,
      status: 'ongoing',
      type: 'tv',
    });
  });

  it('keeps the real synopsis paragraphs and not the keyword heading', async () => {
    const { client } = await load((r) =>
      r.url === `${BASE}/anime/battle-through-the-heavens-season-5-new/` ? page('detail_btth.html.txt') : undefined,
    );
    const details = await client.getAnimeDetails({
      url: '/anime/battle-through-the-heavens-season-5-new/',
      title: 'x',
    });
    expect(details.description).toMatch(/^After three years of not seeing each other, Xiao Yan/);
    expect(details.description).toContain('Qi Refining Pagoda');
    expect(details.description).not.toContain('Watch Online');
  });

  it('lists the episodes newest first with number and date', async () => {
    const { client } = await load(route);
    const episodes = await client.getEpisodes(SERIES);
    expect(episodes).toHaveLength(11);
    // The site lists "11 [4K]" (dated September 1) among the episodes of this series; it is sorted by number.
    expect(episodes.find((e) => e.number === 10)).toEqual({
      url: '/jade-dynasty-final-season-4-episode-10-lucifer-donghua/',
      name: 'Episode 10',
      number: 10,
      uploadedAt: Date.UTC(2026, 9, 8),
    });
    const numbers = episodes.map((e) => e.number ?? 0);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
  });

  it('sorts a list whose newest episode is not first', async () => {
    const { client } = await load((r) =>
      r.url.endsWith('/anime/battle-through-the-heavens-season-5-new/') ? page('detail_btth.html.txt') : undefined,
    );
    const episodes = await client.getEpisodes({ url: '/anime/battle-through-the-heavens-season-5-new/', title: 'x' });
    expect(episodes[0]).toMatchObject({ number: 215, name: 'Episode 215' });
    expect(episodes.length).toBeGreaterThan(200);
    const numbers = episodes.map((e) => e.number ?? 0);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
  });

  it('details and episodes of one anime share a single request', async () => {
    const { client, requests } = await load(route);
    await Promise.all([client.getAnimeDetails(SERIES), client.getEpisodes(SERIES)]);
    expect(requests).toHaveLength(1);
  });

  it('a series that does not exist is NotFoundError', async () => {
    const { client } = await load((r) => ({ status: 404, url: r.url }));
    await expect(client.getAnimeDetails(SERIES)).rejects.toMatchObject({ typed: 'NotFoundError' });
  });
});

describe('urls', () => {
  it('resolves series links and not episode links', async () => {
    const { client } = await load(() => undefined);
    expect(await client.resolveUrl?.('https://luciferdonghua.in/anime/jade-dynasty-final-season-4/')).toMatchObject({
      url: '/anime/jade-dynasty-final-season-4/',
    });
    expect(
      await client.resolveUrl?.('https://luciferdonghua.in/jade-dynasty-final-season-4-episode-10-lucifer-donghua/'),
    ).toBeNull();
    expect(await client.resolveUrl?.('https://example.com/anime/x/')).toBeNull();
  });
});

describe('text helpers', () => {
  it('names episodes', () => {
    expect(episodeName('Jade Dynasty Final Season 4 Episode 10 English Sub', '10')).toBe('Episode 10');
    expect(episodeName('Beyond Time’s Gaze Episode 43 Subtitle', '43')).toBe('Episode 43');
    expect(episodeName('Soul Land Episode 12 Indonesia, English Sub', '12')).toBe('Episode 12');
    expect(episodeName('Name Movie', 'Movie')).toBe('Movie');
    expect(episodeName('Swallowed Star [Movie]: The Decisive Battle [PART-2]', 'Part-2')).toBe('Part-2');
    expect(episodeName('Just A Title', 'x')).toBe('Just A Title');
    expect(parseNumber('12.5')).toBe(12.5);
    expect(parseNumber('10 [4K]')).toBe(10);
    expect(parseNumber('09 [4K]')).toBe(9);
    expect(parseNumber('Movie')).toBeUndefined();
  });
  it('parses dates', () => {
    expect(parseEpisodeDate('October 10, 2026')).toBe(Date.UTC(2026, 9, 10));
    expect(parseEpisodeDate('Dec 28, 2025')).toBe(Date.UTC(2025, 11, 28));
    expect(parseEpisodeDate('soon')).toBeUndefined();
  });
});
