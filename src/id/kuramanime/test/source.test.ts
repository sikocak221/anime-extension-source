import { afterEach, describe, expect, it } from 'vitest';
import { BASE, disposeAll, fixture, load, type Route } from './harness';

afterEach(disposeAll);

const APARIDA = {
  url: '/anime/3384/a-rank-party-wo-ridatsu-shita-ore-wa-moto-oshiego-tachi-to-meikyuu-shinbu-wo-mezasu',
  title: 'A-Rank Party',
};
const NARUTO = { url: '/anime/185/naruto', title: 'Naruto' };

const site: Route = (r) => {
  const u = new URL(r.url);
  let name: string | undefined;
  if (u.pathname === '/anime' || /^\/(properties|quick)\//.test(u.pathname)) {
    name = u.searchParams.has('search')
      ? 'search.html.txt'
      : u.searchParams.get('order_by') === 'popular'
        ? 'popular.html.txt'
        : 'latest.html.txt';
  } else if (u.pathname === APARIDA.url)
    name = u.searchParams.get('page') === '2' ? 'detail_aparida_p2.html.txt' : 'detail_aparida.html.txt';
  else if (u.pathname === NARUTO.url)
    name = u.searchParams.get('page') === '2' ? 'detail_naruto_p2.html.txt' : 'detail_naruto.html.txt';
  return name ? { status: 200, text: fixture(name) } : undefined;
};

describe('catalogue', () => {
  it('popular is order_by=popular, cards are paths, and a next page exists', async () => {
    const { client, requests } = await load(site);
    const result = await client.getPopular(1);
    expect(requests[0]?.url).toBe(`${BASE}/anime?order_by=popular&page=1`);
    expect(result.items).toHaveLength(18);
    for (const item of result.items) {
      expect(item.url).toMatch(/^\/anime\/\d+\/[^/]+$/);
      expect(item.title).not.toBe('');
      expect(item.thumbnailUrl).toMatch(/^https:\/\//);
    }
    expect(result.hasNextPage).toBe(true);
  });

  it('latest is ordered by update and carries the page number', async () => {
    const { client, requests } = await load(site);
    const result = await client.getLatest(2);
    expect(requests[0]?.url).toBe(`${BASE}/anime?order_by=updated&page=2`);
    expect(result.items[0]).toEqual({
      url: '/anime/5241/magicalexplorer',
      title: 'Magical★Explorer',
      thumbnailUrl: expect.stringMatching(/^https:\/\/r2\.nyomo\.my\.id\/images\/.+\.jpg$/),
    });
  });

  it('searches by title', async () => {
    const { client, requests } = await load(site);
    const result = await client.search('naruto', 1, {});
    expect(requests[0]?.url).toBe(`${BASE}/anime?search=naruto&order_by=popular&page=1`);
    expect(result.items.some((i) => i.url === '/anime/185/naruto')).toBe(true);
  });

  it('browses a genre, a category and an order from the filters', async () => {
    const { client, requests } = await load(site);
    await client.search('', 3, { genre: 'action', order: 'most_viewed', bogus: 'x' });
    await client.search('', 1, { category: 'ongoing' });
    await client.search('', 1, {});
    expect(requests.map((r) => r.url)).toEqual([
      `${BASE}/properties/genre/action?order_by=most_viewed&page=3`,
      `${BASE}/quick/ongoing?order_by=updated&page=1`,
      `${BASE}/anime?order_by=updated&page=1`,
    ]);
  });

  it('ignores values that are not in the filter lists', async () => {
    const { client, requests } = await load(site);
    await client.search('', 1, { genre: '../x?y=1', category: 'drop', order: 'drop table' });
    expect(requests[0]?.url).toBe(`${BASE}/anime?order_by=updated&page=1`);
  });

  it('describes its filters', async () => {
    const { client } = await load(site);
    const filters = await client.getFilters();
    expect(filters.map((f) => ('id' in f ? f.id : f.type))).toEqual(['header', 'genre', 'category', 'order']);
  });

  it('treats a missing page past the end as empty', async () => {
    const { client } = await load(() => ({ status: 404, text: 'nope' }));
    expect(await client.getPopular(9)).toEqual({ items: [], hasNextPage: false });
  });

  it('fails clearly when the layout changed', async () => {
    const { client } = await load(() => ({ status: 200, text: '<html><body>hi</body></html>' }));
    await expect(client.getPopular(1)).rejects.toThrow(/layout changed/);
  });
});

describe('details and episodes', () => {
  it('reads the series page', async () => {
    const { client } = await load(site);
    const details = await client.getAnimeDetails(APARIDA);
    expect(details).toMatchObject({
      url: APARIDA.url,
      title: 'A-Rank Party wo Ridatsu shita Ore wa, Moto Oshiego-tachi to Meikyuu Shinbu wo Mezasu.',
      status: 'completed',
      type: 'tv',
      year: 2025,
      studio: 'Bandai Namco Pictures',
    });
    expect(details.genres).toEqual(['Action', 'Adventure', 'Fantasy', 'Romance', 'Harem']);
    expect(details.description).toMatch(/^"Aku nggak bisa begini lagi!"/);
    expect(details.thumbnailUrl).toMatch(/^https:\/\/r2\.nyomo\.my\.id\/images\/.+\.jpg$/);
    expect(details.altTitles).toContain('Aparida');
  });

  it('lists the two pages of a short series, newest first, as paths', async () => {
    const { client, requests } = await load(site);
    const episodes = await client.getEpisodes(APARIDA);
    expect(requests.map((r) => r.url)).toEqual([`${BASE}${APARIDA.url}`, `${BASE}${APARIDA.url}?page=2`]);
    expect(episodes).toHaveLength(24);
    expect(episodes[0]).toEqual({ url: `${APARIDA.url}/episode/24`, name: 'Episode 24', number: 24 });
    expect(episodes.at(-1)).toMatchObject({ url: `${APARIDA.url}/episode/1`, number: 1 });
  });

  it('follows the paged episode list of a long series', async () => {
    const pageOf = (n: number): { status: number; text: string } => {
      // Real page 1 and page 2; every other page repeats page 2's shape with its own range.
      if (n === 1) return { status: 200, text: fixture('detail_naruto.html.txt') };
      const first = (n - 1) * 13 + 1;
      const rows = Array.from({ length: 13 }, (_, i) => first + i)
        .filter((k) => k <= 220)
        .map((k) => `<a class='btn btn-danger' href='${BASE}/anime/185/naruto/episode/${k}'>Ep ${k}</a>`)
        .join('');
      const more =
        n < 17
          ? `<a href='/anime/185/naruto?page=${n + 1}' class='page__link__episode'><i class='fa fa-forward'></i></a>`
          : '';
      const content = `<a href='${BASE}/anime/185/naruto/episode/1'>Ep 1</a><a href='${BASE}/anime/185/naruto/episode/220'>Ep 220</a>${rows}${more}`;
      return {
        status: 200,
        text: `<div class="anime__details__title"><h3>Naruto</h3></div><a id="episodeLists" data-content="${content.replace(/"/g, '&quot;')}"></a>`,
      };
    };
    const { client, requests } = await load((r) => {
      const page = Number(new URL(r.url).searchParams.get('page') ?? '1');
      return pageOf(page);
    });
    const episodes = await client.getEpisodes(NARUTO);
    expect(requests).toHaveLength(17);
    expect(episodes).toHaveLength(220);
    expect(episodes[0]).toMatchObject({ number: 220, url: '/anime/185/naruto/episode/220' });
    expect(episodes.at(-1)).toMatchObject({ number: 1 });
    expect(new Set(episodes.map((e) => e.number)).size).toBe(220);
  });

  it('reads the real first and second pages of a long series', async () => {
    // Every page past the first answers with the saved real page 2 (episodes 14 to 26).
    const { client, requests } = await load(site);
    const episodes = await client.getEpisodes(NARUTO);
    // 17 pages are guessed from the quick picks; the saved page 2 still shows an arrow, so one more is asked and
    // stops the walk because it brings nothing new.
    expect(requests).toHaveLength(18);
    expect(episodes.map((e) => e.number)).toEqual([220, ...Array.from({ length: 26 }, (_, i) => 26 - i)]);
  });

  it('fails when a page of the episode list cannot be read', async () => {
    const { client } = await load((r) => (r.url.includes('page=') ? { status: 500, text: '' } : site(r)));
    await expect(client.getEpisodes(NARUTO)).rejects.toThrow();
  });

  it('shares one request between details and episodes asked together', async () => {
    const { client, requests } = await load(site);
    await Promise.all([client.getAnimeDetails(APARIDA), client.getEpisodes(APARIDA)]);
    expect(requests.filter((r) => r.url.endsWith(APARIDA.url))).toHaveLength(1);
  });

  it('fails clearly when the layout changed', async () => {
    const { client } = await load(() => ({ status: 200, text: '<html><body>hi</body></html>' }));
    await expect(client.getAnimeDetails(APARIDA)).rejects.toThrow(/layout changed/);
  });

  it('maps pasted urls of any domain, and builds web urls from the current base', async () => {
    const { client } = await load(site);
    expect(await client.resolveUrl('https://kuramanime.tel/anime/185/naruto/episode/3')).toMatchObject({
      url: '/anime/185/naruto',
    });
    expect(await client.resolveUrl('https://example.com/anime/185/naruto')).toBeNull();
    expect(await client.getWebUrl({ url: '/anime/185/naruto/episode/3', name: 'Episode 3' })).toBe(
      `${BASE}/anime/185/naruto/episode/3`,
    );
  });
});
