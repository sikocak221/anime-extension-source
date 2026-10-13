import { afterEach, describe, expect, it } from 'vitest';
import { BASE, disposeAll, fixture, load } from './harness';
import { episodeName, parseEpisodeDate, parseNumber } from '../src/text';

afterEach(disposeAll);

const page = (name: string) => ({ status: 200, text: fixture(name) });
const SERIES = { url: '/anime/battle-through-the-heavens-season-5th/', title: 'Battle Through the Heavens Season 5' };
const MOVIE = { url: '/anime/renegade-immortal-movie-divine-descent/', title: 'Renegade Immortal Movie' };

describe('listings', () => {
  it('reads popular with covers and the next page', async () => {
    const { client, requests } = await load((r) =>
      r.url.includes('order=popular') ? page('list_popular.html.txt') : undefined,
    );
    const result = await client.getPopular(1);
    expect(requests[0]?.url).toBe(`${BASE}/anime/?order=popular`);
    expect(result.items).toHaveLength(20);
    expect(result.items[0]).toMatchObject({
      url: '/anime/battle-through-the-heavens-season-5th/',
      title: 'Battle Through the Heavens Season 5',
    });
    expect(result.items[0]?.thumbnailUrl).toMatch(
      /^https:\/\/donghuastream\.org\/wp-content\/uploads\/2023\/05\/Battle/,
    );
    expect(result.items.every((i) => i.url.startsWith('/anime/') && i.thumbnailUrl?.startsWith('https://'))).toBe(true);
    expect(result.hasNextPage).toBe(true);
  });

  it('latest is ordered by update and pages with ?page', async () => {
    const { client, requests } = await load((r) =>
      r.url.includes('order=update') ? page('list_popular.html.txt') : undefined,
    );
    await client.getLatest(3);
    expect(requests[0]?.url).toBe(`${BASE}/anime/?order=update&page=3`);
  });

  it('searches by text, pages with /pagg/N/ and sees the pagination of the results', async () => {
    const { client, requests } = await load((r) => (r.url.includes('s=') ? page('search.html.txt') : undefined));
    const result = await client.search('one piece', 2, { genre: 'action' });
    expect(requests[0]?.url).toBe(`${BASE}/pagg/2/?s=one+piece`);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.hasNextPage).toBe(true);
  });

  it('builds filter urls and drops unknown values', async () => {
    const { client, requests } = await load((r) =>
      r.url.includes('/anime/?') ? page('list_popular.html.txt') : undefined,
    );
    await client.search('', 2, { genre: 'martial-arts', status: 'ongoing', type: 'ona', order: 'popular' });
    await client.search('', 1, { genre: '../x', status: 'bogus' });
    const first = new URL(requests[0]?.url ?? '');
    expect(first.searchParams.getAll('genre[]')).toEqual(['martial-arts']);
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
  const route = (r: { url: string }) => {
    if (r.url === `${BASE}${SERIES.url}`) return page('detail_btth.html.txt');
    if (r.url === `${BASE}${MOVIE.url}`) return page('detail_movie.html.txt');
    return undefined;
  };

  it('reads the details', async () => {
    const { client } = await load(route);
    const details = await client.getAnimeDetails(SERIES);
    expect(details).toMatchObject({
      url: SERIES.url,
      title: 'Battle Through the Heavens Season 5',
      genres: [
        'Action',
        'Adventure',
        'Drama',
        'Fantasy',
        'funny',
        'Martial arts',
        'Monsters',
        'MY FAVOURITE',
        'Popular',
      ],
      studio: 'Motion Magic',
      year: 2022,
      status: 'ongoing',
      type: 'ona',
    });
    expect(details.thumbnailUrl).toMatch(/^https:\/\/donghuastream\.org\/wp-content\/uploads\/2023\/05\/Battle/);
    expect(details.altTitles).toContain('斗破苍穹 第5季');
    expect(details.description).toContain('The 5th season of Battle Through the Heavens');
  });

  it('lists the episodes newest first with number and date', async () => {
    const { client } = await load(route);
    const episodes = await client.getEpisodes(SERIES);
    expect(episodes.length).toBeGreaterThanOrEqual(160);
    expect(episodes[0]).toEqual({
      url: '/battle-through-the-heavens-season-5-episode-214-multiple-subtitles/',
      name: 'Episode 214 (Preview)',
      number: 214,
      uploadedAt: Date.UTC(2026, 9, 3),
    });
    expect(episodes[1]).toMatchObject({ name: 'Episode 213', number: 213 });
    const numbers = episodes.map((e) => e.number ?? 0);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
    // No two entries share an address (the site lists one episode twice).
    expect(new Set(episodes.map((e) => e.url)).size).toBe(episodes.length);
  });

  it('names the parts of a film', async () => {
    const { client } = await load(route);
    const parts = await client.getEpisodes(MOVIE);
    expect(parts.map((p) => p.name)).toEqual(['Part 3', 'Part 2', 'Part 1']);
    expect(parts.map((p) => p.number)).toEqual([3, 2, 1]);
    expect((await client.getAnimeDetails(MOVIE)).type).toBe('movie');
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
    expect(await client.resolveUrl?.('https://donghuastream.org/anime/soul-land-2nd/')).toMatchObject({
      url: '/anime/soul-land-2nd/',
    });
    expect(
      await client.resolveUrl?.(
        'https://donghuastream.org/battle-through-the-heavens-season-5-episode-214-multiple-subtitles/',
      ),
    ).toBeNull();
    expect(await client.resolveUrl?.('https://donghuastream.org/anime/')).toBeNull();
    expect(await client.resolveUrl?.('https://example.com/anime/x/')).toBeNull();
  });
});

describe('text helpers', () => {
  it('names episodes from the free-text number cell', () => {
    expect(episodeName('x', '213 (Good Sub)(4K)+(Download Link)')).toBe('Episode 213');
    expect(episodeName('x', '214-215 Preview')).toBe('Episode 214 (Preview)');
    expect(episodeName('x', '146(Good Sub)(4k)+Download Link')).toBe('Episode 146');
    expect(episodeName('x', 'Part 2 (Good Sub)(4K)')).toBe('Part 2');
    expect(episodeName('Name Movie Multiple Subtitles', 'Movie')).toBe('Name Movie');
    expect(parseNumber('12.5 (4k)')).toBe(12.5);
    expect(parseNumber('Part 3 (Good Sub)')).toBe(3);
    expect(parseNumber('Movie')).toBeUndefined();
  });
  it('parses dates', () => {
    expect(parseEpisodeDate('October 3, 2026')).toBe(Date.UTC(2026, 9, 3));
    expect(parseEpisodeDate('Jul 31, 2022')).toBe(Date.UTC(2022, 6, 31));
    expect(parseEpisodeDate('soon')).toBeUndefined();
  });
});
