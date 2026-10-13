import '@matane-anime/extension-sdk/globals';
import {
  type AnimeDetails,
  type AnimePage,
  type AnimeSummary,
  type Episode,
  type Filter,
  type FilterState,
  type HtmlElement,
  NotFoundError,
  ParseError,
  defineExtension,
} from '@matane-anime/extension-sdk';
import { DEFAULT_BASE_URL, base, fetchPage, fetchPageShared } from './site';
import { labelPlaylists } from './hls-quality';
import { getStreams } from './streams';
import {
  CATEGORIES,
  GENRES,
  ORDERS,
  collapse,
  entityPath,
  episodeNumber,
  isSeriesPath,
  parseStatus,
  parseType,
  parseYear,
} from './text';

// kuramanime (v20.kuramanime.ing): a server-rendered Laravel site, Indonesian subtitles. The catalogue is
// `/anime?order_by=<o>&page=<n>` (`&search=<q>`), `/properties/genre/<slug>` and `/quick/<category>` take the same
// parameters. A series is `/anime/<id>/<slug>`, an episode `/anime/<id>/<slug>/episode/<n>`. The domain changes often
// (kuramanime.com, .tel, v17.kuramanime.ink…), so entity urls are paths only and the base is a preference.
// The streams need a small token dance, see streams.ts.

const EMPTY: AnimePage = { items: [], hasNextPage: false };
/** Episodes per page of the series page's episode list; used to guess how many pages there are. */
const EPISODE_PAGE_CAP = 150;

const pick = (value: unknown, allowed: readonly [string, string][]): string =>
  typeof value === 'string' && allowed.some(([v]) => v === value) ? value : '';

/** Reads the cards of a listing (`#animeList .product__item`). */
function readCards(doc: HtmlElement, baseUrl: string): AnimeSummary[] {
  const items: AnimeSummary[] = [];
  const seen = new Set<string>();
  for (const card of doc.select('#animeList .product__item')) {
    const link = card.selectFirst('h5 a[href]') ?? card.selectFirst('a[href]');
    const href = link?.attr('href');
    const title = collapse(card.selectFirst('h5')?.text() ?? '');
    if (!href || !title) throw new ParseError('A card has no link or title: the site layout changed');
    const url = entityPath(href, baseUrl);
    if (!isSeriesPath(url) || seen.has(url)) continue;
    seen.add(url);
    const thumbnailUrl = card.selectFirst('.product__item__pic')?.attr('data-setbg');
    items.push({ url, title, ...(thumbnailUrl && /^https?:\/\//i.test(thumbnailUrl) && { thumbnailUrl }) });
  }
  return items;
}

/** The next-page arrow of the pagination (`<a href><i class="fa fa-angle-right">`). */
function hasNext(doc: HtmlElement): boolean {
  return doc.select('.product__pagination a[href]').some((a) => a.selectFirst('i.fa-angle-right') !== null);
}

interface Query {
  search?: string;
  genre?: string;
  category?: string;
  order: string;
}

async function catalogue(query: Query, page: number): Promise<AnimePage> {
  const n = Math.max(1, Math.floor(page));
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  params.set('order_by', query.order);
  params.set('page', String(n));
  const path = query.search
    ? '/anime'
    : query.genre
      ? `/properties/genre/${query.genre}`
      : query.category
        ? `/quick/${query.category}`
        : '/anime';
  const url = `${base()}${path}?${params.toString()}`;
  let text: string;
  try {
    text = (await fetchPage(url)).text;
  } catch (error) {
    if (n > 1 && error instanceof NotFoundError) return EMPTY;
    throw error;
  }
  const doc = html.load(text, { baseUrl: url });
  if (!doc.selectFirst('#animeList')) {
    throw new ParseError('The catalogue has no list container (#animeList): the site layout changed');
  }
  return { items: readCards(doc, url), hasNextPage: hasNext(doc) };
}

async function fetchSeries(path: string, pageNumber = 1, shared = true): Promise<{ doc: HtmlElement; url: string }> {
  const url = `${base()}${path}${pageNumber > 1 ? `?page=${pageNumber}` : ''}`;
  const text = (await (shared ? fetchPageShared(url) : fetchPage(url))).text;
  return { doc: html.load(text, { baseUrl: url }), url };
}

async function seriesPage(anime: AnimeSummary): Promise<{ doc: HtmlElement; url: string }> {
  const path = entityPath(anime.url, base());
  const loaded = await fetchSeries(path);
  if (!loaded.doc.selectFirst('.anime__details__title h3'))
    throw new ParseError('The series page has no title: the site layout changed');
  return loaded;
}

/** The rows of the details widget (`<li><span>Label:</span> … <div class="col-9">value</div>`), by lowercase label. */
function readInfo(doc: HtmlElement): (label: string) => HtmlElement | undefined {
  const rows = new Map<string, HtmlElement>();
  for (const row of doc.select('.anime__details__widget li')) {
    const label = collapse(row.selectFirst('.col-3 span')?.text() ?? '')
      .replace(/:$/, '')
      .toLowerCase();
    const value = row.selectFirst('.col-9');
    if (label && value) rows.set(label, value);
  }
  return (label) => rows.get(label.toLowerCase());
}

const valueText = (row: HtmlElement | undefined): string | undefined => {
  const value = collapse(row?.text() ?? '');
  return value && value !== '?' && value !== '-' ? value : undefined;
};

const linkTexts = (row: HtmlElement | undefined): string[] =>
  (row?.select('a') ?? []).map((a) => collapse(a.text()).replace(/,$/, '').trim()).filter(Boolean);

/** The episodes of one page of the series page: the "Semua Episode" buttons (the "Pilihan Cepat" ones repeat them). */
function readEpisodeLinks(doc: HtmlElement, baseUrl: string): { paths: string[]; hasMore: boolean } {
  const content = doc.selectFirst('#episodeLists')?.attr('data-content');
  if (!content) return { paths: [], hasMore: false };
  const popover = html.load(content, { baseUrl });
  const paths: string[] = [];
  for (const a of popover.select('a[href*="/episode/"]')) {
    const path = entityPath(a.attr('href') ?? '', baseUrl);
    if (episodeNumber(path) !== undefined) paths.push(path);
  }
  return { paths, hasMore: popover.select('a.page__link__episode i.fa-forward').length > 0 };
}

export default defineExtension({
  preferences: () => [
    {
      type: 'text',
      key: 'baseUrl',
      label: 'Site address',
      description:
        'Kuramanime changes domain often (kuramanime.com, .tel, v20.kuramanime.ing…). Libraries store paths, so they survive it.',
      default: DEFAULT_BASE_URL,
    },
  ],

  createSource: () => ({
    get baseUrl() {
      return base();
    },

    getPopular: (page) => catalogue({ order: 'popular' }, page),

    getLatest: (page) => catalogue({ order: 'updated' }, page),

    search: (query: string, page: number, filters: FilterState): Promise<AnimePage> =>
      catalogue(
        {
          search: query.trim(),
          genre: pick(filters['genre'], GENRES),
          category: pick(filters['category'], CATEGORIES),
          order: pick(filters['order'], ORDERS) || (query.trim() ? 'popular' : 'updated'),
        },
        page,
      ),

    getFilters: (): Filter[] => [
      { type: 'header', label: 'Ignored when searching by title. A genre wins over a category.' },
      {
        type: 'select',
        id: 'genre',
        label: 'Genre',
        options: [{ value: '', label: 'Any' }, ...GENRES.map(([value, label]) => ({ value, label }))],
        default: '',
      },
      {
        type: 'select',
        id: 'category',
        label: 'Category',
        options: [{ value: '', label: 'All' }, ...CATEGORIES.map(([value, label]) => ({ value, label }))],
        default: '',
      },
      {
        type: 'select',
        id: 'order',
        label: 'Order by',
        options: [{ value: '', label: 'Default' }, ...ORDERS.map(([value, label]) => ({ value, label }))],
        default: '',
      },
    ],

    async getAnimeDetails(anime: AnimeSummary): Promise<AnimeDetails> {
      const { doc, url } = await seriesPage(anime);
      const info = readInfo(doc);
      const title = collapse(doc.selectFirst('.anime__details__title h3')?.text() ?? '');
      if (!title) throw new ParseError('The series page has no title');
      const alt = collapse(doc.selectFirst('.anime__details__title > span')?.text() ?? '')
        .split(/,\s*/)
        .map(collapse)
        .filter((name, i, all) => name && name.toLowerCase() !== title.toLowerCase() && all.indexOf(name) === i);
      const genres = [...linkTexts(info('genre')), ...linkTexts(info('tema'))].filter(
        (genre, i, all) => all.indexOf(genre) === i,
      );
      const description = collapse(doc.selectFirst('#synopsisField')?.text() ?? '');
      const cover = doc.selectFirst('.anime__details__pic')?.attr('data-setbg');
      return {
        url: entityPath(anime.url, url),
        title,
        thumbnailUrl: cover && /^https?:\/\//i.test(cover) ? cover : anime.thumbnailUrl,
        altTitles: alt.length > 0 ? alt : undefined,
        description: description || undefined,
        genres: genres.length > 0 ? genres : undefined,
        studio: linkTexts(info('studio')).join(', ') || undefined,
        year: parseYear(valueText(info('tayang'))) ?? parseYear(valueText(info('musim'))),
        status: parseStatus(valueText(info('status')) ?? ''),
        type: parseType(valueText(info('tipe')) ?? ''),
      };
    },

    /**
     * The "Semua Episode" list of the series page, which shows 13 episodes per page (`?page=<n>`); the quick picks
     * name the newest episode, which says how many pages to ask for. Newest first.
     */
    async getEpisodes(anime: AnimeSummary): Promise<Episode[]> {
      const path = entityPath(anime.url, base());
      const first = await seriesPage(anime);
      const found = new Map<string, number>();
      const take = (paths: string[]): void => {
        for (const p of paths) {
          const number = episodeNumber(p);
          if (number !== undefined) found.set(p, number);
        }
      };
      const firstRead = readEpisodeLinks(first.doc, first.url);
      take(firstRead.paths);
      if (firstRead.hasMore) {
        const numbers = firstRead.paths.map((p) => episodeNumber(p) ?? 0);
        const newest = Math.max(...numbers);
        const oldest = Math.min(...numbers);
        // Page 1 lists the quick picks (oldest, newest) and then the episodes of the page.
        const perPage = Math.max(1, new Set(firstRead.paths.filter((p) => (episodeNumber(p) ?? 0) !== newest)).size);
        const guess = Math.min(EPISODE_PAGE_CAP, Math.ceil((newest - oldest + 1) / perPage));
        const pages = await Promise.all(
          Array.from({ length: Math.max(0, guess - 1) }, (_, i) => fetchSeries(path, i + 2, false)),
        );
        let more = false;
        for (const page of pages) {
          const read = readEpisodeLinks(page.doc, page.url);
          take(read.paths);
          more = read.hasMore;
        }
        // The guess was short (gaps in the numbering): follow the forward arrow while it brings new episodes.
        for (let n = guess + 1; more && n <= EPISODE_PAGE_CAP; n++) {
          const before = found.size;
          const page = await fetchSeries(path, n, false);
          const read = readEpisodeLinks(page.doc, page.url);
          take(read.paths);
          more = read.hasMore && found.size > before;
        }
      }
      if (found.size === 0) throw new NotFoundError('This series has no episodes yet');
      return [...found.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([url, number]) => ({ url, name: `Episode ${number}`, number }));
    },

    getStreams: async (episode: Episode) => labelPlaylists(await getStreams(episode)),

    resolveUrl(url: string): AnimeSummary | null {
      const match = /^https?:\/\/[^/]*kuramanime[^/]*\/anime\/(\d+)\/([^/?#]+)/i.exec(url);
      return match ? { url: `/anime/${match[1]}/${match[2]}`, title: (match[2] as string).replace(/-/g, ' ') } : null;
    },

    getWebUrl: (item: AnimeSummary | Episode) => `${base()}${item.url.split(/[?#]/)[0]}`,
  }),
});
