import { afterEach, describe, expect, it } from 'vitest';
import { BASE, disposeAll, fixture, load } from './harness';
import { episodeName, parseEpisodeDate, parseNumber } from '../src/text';

afterEach(disposeAll);

const page = (name: string) => ({ status: 200, text: fixture(name) });
const SERIES = { url: '/beyond-times-gaze/', title: 'Beyond Time’s Gaze' };

describe('listings', () => {
  it('reads popular with covers and the next page', async () => {
    const { client, requests } = await load((r) =>
      r.url.includes('order=popular') ? page('list_popular.html.txt') : undefined,
    );
    const result = await client.getPopular(1);
    expect(requests[0]?.url).toBe(`${BASE}/anime/?order=popular`);
    expect(result.items.length).toBeGreaterThan(10);
    expect(result.items[0]).toEqual({
      url: '/tales-of-herding-gods/',
      title: 'Tales of Herding Gods',
      thumbnailUrl: 'https://donghive.vip/wp-content/uploads/2025/02/herding-god-2025-768x1024.jpg',
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
    const result = await client.search('one piece', 2, { genre: 'action' });
    expect(requests[0]?.url).toBe(`${BASE}/page/2/?s=one+piece`);
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
    r.url === `${BASE}/beyond-times-gaze/` ? page('detail_beyond.html.txt') : undefined;

  it('reads the details', async () => {
    const { client } = await load(route);
    const details = await client.getAnimeDetails(SERIES);
    expect(details).toMatchObject({
      url: '/beyond-times-gaze/',
      title: 'Beyond Time’s Gaze',
      thumbnailUrl: 'https://donghive.vip/wp-content/uploads/2025/12/Beyond-Time-Gaze-S2-768x1024-1.webp',
      altTitles: ['光阴之外'],
      genres: ['Action', 'Adventure', 'Fantasy'],
      studio: 'Youku',
      year: 2025,
      status: 'ongoing',
      type: 'ona',
    });
    expect(details.description).toContain('Dunia adalah tempat sementara');
  });

  it('lists the episodes newest first with number and date', async () => {
    const { client } = await load(route);
    const episodes = await client.getEpisodes(SERIES);
    expect(episodes.length).toBeGreaterThanOrEqual(43);
    expect(episodes[0]).toEqual({
      url: '/beyond-times-gaze-episode-43-subtitle-indonesia/',
      name: 'Episode 43',
      number: 43,
      uploadedAt: Date.UTC(2026, 9, 10),
    });
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
    expect(await client.resolveUrl?.('https://donghub.vip/beyond-times-gaze/')).toMatchObject({
      url: '/beyond-times-gaze/',
    });
    expect(
      await client.resolveUrl?.('https://donghive.vip/beyond-times-gaze-episode-43-subtitle-indonesia/'),
    ).toBeNull();
    expect(await client.resolveUrl?.('https://example.com/x/')).toBeNull();
  });
});

describe('text helpers', () => {
  it('names episodes', () => {
    expect(episodeName('Beyond Time’s Gaze Episode 43 Subtitle Indonesia', '43')).toBe('Episode 43');
    expect(episodeName('Soul Land Episode 12 Subtitle Indonesia', '12')).toBe('Episode 12');
    expect(episodeName('Name Movie', 'Movie')).toBe('Movie');
    expect(episodeName('Just A Title', 'x')).toBe('Just A Title');
    expect(parseNumber('12.5')).toBe(12.5);
    expect(parseNumber('Movie')).toBeUndefined();
  });
  it('parses dates', () => {
    expect(parseEpisodeDate('October 10, 2026')).toBe(Date.UTC(2026, 9, 10));
    expect(parseEpisodeDate('Dec 28, 2025')).toBe(Date.UTC(2025, 11, 28));
    expect(parseEpisodeDate('Des 28, 2025')).toBe(Date.UTC(2025, 11, 28));
    expect(parseEpisodeDate('Agustus 29, 2026')).toBe(Date.UTC(2026, 7, 29));
    expect(parseEpisodeDate('Mei 1, 2026')).toBe(Date.UTC(2026, 4, 1));
    expect(parseEpisodeDate('soon')).toBeUndefined();
  });
});
