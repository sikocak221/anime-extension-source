import { afterEach, describe, expect, it } from 'vitest';
import { BASE, disposeAll, fixture, load } from './harness';
import { episodeName, parseEpisodeDate, parseNumber } from '../src/text';

afterEach(disposeAll);

const page = (name: string) => ({ status: 200, text: fixture(name) });
const SERIES = { url: '/anime/one-piece/', title: 'One Piece' };

describe('listings', () => {
  it('reads popular with covers and the next page', async () => {
    const { client, requests } = await load((r) =>
      r.url.includes('order=popular') ? page('list_popular.html.txt') : undefined,
    );
    const result = await client.getPopular(1);
    expect(requests[0]?.url).toBe(`${BASE}/anime/?order=popular`);
    expect(result.items.length).toBeGreaterThanOrEqual(15);
    expect(result.items[0]).toEqual({
      url: '/anime/nukitashi-the-animation-uncensored/',
      title: 'Nukitashi the Animation (Uncensored)',
      thumbnailUrl:
        'https://i3.wp.com/animenosub.to/wp-content/uploads/2025/07/Nukitashi-the-Animation-Uncensored.webp',
    });
    expect(result.items.some((i) => i.url === '/anime/one-piece/' && i.title === 'One Piece')).toBe(true);
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

  it('searches by text, pages with /page/N/ and sees the pagination of the results', async () => {
    const { client, requests } = await load((r) => (r.url.includes('s=') ? page('search.html.txt') : undefined));
    const result = await client.search('a', 2, { genre: 'action' });
    expect(requests[0]?.url).toBe(`${BASE}/page/2/?s=a`);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]?.url).toBe('/anime/dandivine/');
    expect(result.hasNextPage).toBe(true);
  });

  it('builds filter urls and drops unknown values', async () => {
    const { client, requests } = await load((r) =>
      r.url.includes('/anime/?') ? page('list_popular.html.txt') : undefined,
    );
    await client.search('', 2, { genre: 'isekai', status: 'ongoing', type: 'movie', order: 'popular' });
    await client.search('', 1, { genre: '../x', status: 'bogus' });
    const first = new URL(requests[0]?.url ?? '');
    expect(first.searchParams.getAll('genre[]')).toEqual(['isekai']);
    expect(first.searchParams.get('status')).toBe('ongoing');
    expect(first.searchParams.get('type')).toBe('movie');
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
    r.url === `${BASE}/anime/one-piece/` ? page('detail_one_piece.html.txt') : undefined;

  it('reads the details', async () => {
    const { client } = await load(route);
    const details = await client.getAnimeDetails(SERIES);
    expect(details).toMatchObject({
      url: '/anime/one-piece/',
      title: 'One Piece',
      altTitles: ['OP'],
      genres: ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Shounen', 'Super Power'],
      studio: 'Toei Animation',
      year: 1999,
      status: 'hiatus',
      type: 'tv',
    });
    expect(details.thumbnailUrl).toMatch(/^https:\/\/.*animenosub\.to\/wp-content\/uploads\//);
    expect(details.description).toContain('Barely surviving in a barrel');
    expect(details.description).not.toContain('Watch streaming');
  });

  it('lists the episodes newest first with number and date', async () => {
    const { client } = await load(route);
    const episodes = await client.getEpisodes(SERIES);
    expect(episodes.length).toBeGreaterThanOrEqual(1180);
    expect(episodes[0]).toEqual({
      url: '/one-piece-episode-1180/',
      name: 'Episode 1180',
      number: 1180,
      uploadedAt: Date.UTC(2026, 8, 27),
    });
    const numbers = episodes.map((e) => e.number ?? 0);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
    expect(episodes.at(-1)).toMatchObject({ number: 1, name: 'Episode 1' });
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
    expect(await client.resolveUrl?.('https://animenosub.to/anime/one-piece/')).toMatchObject({
      url: '/anime/one-piece/',
    });
    expect(await client.resolveUrl?.('https://animenosub.to/one-piece-episode-1180/')).toBeNull();
    expect(await client.resolveUrl?.('https://animenosub.to/anime/page/2/')).toBeNull();
    expect(await client.resolveUrl?.('https://example.com/anime/x/')).toBeNull();
  });
});

describe('text helpers', () => {
  it('names episodes', () => {
    expect(episodeName('One Piece Episode 1180', '1180')).toBe('Episode 1180');
    expect(episodeName('Name Movie', 'Movie')).toBe('Movie');
    expect(episodeName('Just A Title', 'x')).toBe('Just A Title');
    expect(parseNumber('12.5')).toBe(12.5);
    expect(parseNumber('1004.5 SP')).toBe(1004.5);
    expect(parseNumber('Movie')).toBeUndefined();
  });
  it('parses dates', () => {
    expect(parseEpisodeDate('October 10, 2026')).toBe(Date.UTC(2026, 9, 10));
    expect(parseEpisodeDate('soon')).toBeUndefined();
  });
});
