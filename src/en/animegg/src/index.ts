import '@matane-anime/extension-sdk/globals';
import {
  type AnimeDetails,
  type AnimePage,
  type AnimeStatus,
  type AnimeSummary,
  type Episode,
  type Filter,
  type FilterState,
  type HtmlElement,
  NotFoundError,
  ParseError,
  defineExtension,
} from '@matane-anime/extension-sdk';
import { DEFAULT_BASE_URL, base, fetchPage, memo } from './site';
import { labelPlaylists } from './hls-quality';
import { getStreams } from './streams';
import { collapse, episodeNumber, hasMore, seriesPath } from './text';

// animegg.org: server-rendered HTML. An anime is "/series/<slug>"; an episode is "/<slug>-episode-<n>" with a
// "#subbed" or "#dubbed" suffix (the page holds both versions, the suffix tells which one the app plays).
// Lists page with `?start=<offset>` (25 per page; the recent releases 10), and the search answers in one page.

const PAGE_SIZE = 25;
const RELEASES_PAGE_SIZE = 10;
/** The details and the episodes of an anime come from one page, which is fetched once for both. */
const DETAIL_TTL_MS = 15_000;

/** Genres that have a page at `/genre/<name>`; the site has ~150, most of them stray title words. Adult ones are left out. */
const GENRES = [
  'Action',
  'Adventure',
  'Comedy',
  'Cars',
  'Cyberpunk',
  'Demons',
  'Detective',
  'Drama',
  'Ecchi',
  'Fantasy',
  'Game',
  'Gender Bender',
  'Harem',
  'Historical',
  'Horror',
  'Idols',
  'Isekai',
  'Josei',
  'Kids',
  'Magic',
  'Magical Girl',
  'Martial Arts',
  'Mecha',
  'Military',
  'Music',
  'Mystery',
  'Parody',
  'Police',
  'Psychological',
  'Romance',
  'Samurai',
  'School',
  'Sci-Fi',
  'Seinen',
  'Shoujo',
  'Shounen',
  'Slice of Life',
  'Space',
  'Sports',
  'Super Power',
  'Supernatural',
  'Thriller',
  'Vampire',
];

const SORTS: Record<string, string> = {
  hits: '',
  createdAt: 'sortBy=createdAt&sortDirection=DESC',
  sortLetter: 'sortBy=sortLetter&sortDirection=ASC',
};

/** Reads the cards of every kind of list: popular and genre (`li.fea`), releases (`li.fea.release`), search (`a.mse`). */
function readCards(doc: HtmlElement, baseUrl: string): AnimeSummary[] {
  const items: AnimeSummary[] = [];
  const seen = new Set<string>();
  const add = (href: string | undefined, title: string, cover: string | undefined): void => {
    if (!href) return;
    const url = seriesPath(href, baseUrl);
    if (!url || seen.has(url)) return;
    if (!title) throw new ParseError('A card has no title: the site layout changed');
    seen.add(url);
    items.push({ url, title, ...(cover && { thumbnailUrl: cover }) });
  };
  for (const card of doc.select('li.fea')) {
    const link = card.selectFirst('a.releaseLink') ?? card.selectFirst('.rightpop a') ?? card.selectFirst('a.fealink');
    add(link?.attr('href'), collapse(link?.text() ?? ''), card.selectFirst('img')?.absUrl('src'));
  }
  for (const card of doc.select('a.mse')) {
    add(card.attr('href'), collapse(card.selectFirst('h2')?.text() ?? ''), card.selectFirst('img')?.absUrl('src'));
  }
  return items;
}

async function listing(path: string, size: number, nextByCount: boolean): Promise<AnimePage> {
  const url = `${base()}${path}`;
  const doc = html.load((await fetchPage(url)).text, { baseUrl: url });
  const items = readCards(doc, url);
  if (items.length === 0 && !doc.selectFirst('.navbar')) {
    throw new ParseError('The listing has no cards and no page frame: the site layout changed');
  }
  const range = collapse(doc.selectFirst('ul.pagination li span')?.text() ?? '');
  return { items, hasNextPage: hasMore(range) ?? (nextByCount && items.length >= size) };
}

const startParam = (page: number, size: number): number => (Math.max(1, Math.floor(page)) - 1) * size;

function query(parts: Array<string | undefined>): string {
  const joined = parts.filter(Boolean).join('&');
  return joined ? `?${joined}` : '';
}

async function detailPage(anime: AnimeSummary): Promise<HtmlElement> {
  const path = seriesPath(anime.url, base());
  if (!path) throw new NotFoundError(`Not an anime address: ${anime.url}`);
  const url = `${base()}${path}`;
  const doc = html.load((await memo(url, DETAIL_TTL_MS, () => fetchPage(url))).text, { baseUrl: url });
  if (!doc.selectFirst('.media-body h1')) throw new NotFoundError(`Not found: ${anime.url}`);
  return doc;
}

function readStatus(text: string): AnimeStatus {
  if (/ongoing|airing/i.test(text)) return 'ongoing';
  if (/completed|finished/i.test(text)) return 'completed';
  return 'unknown';
}

export default defineExtension({
  preferences: () => [
    {
      type: 'text',
      key: 'baseUrl',
      label: 'Site address',
      description: 'Change it if the domain stops working.',
      default: DEFAULT_BASE_URL,
    },
  ],

  createSource: () => ({
    get baseUrl() {
      return base();
    },

    getPopular: (page) => listing(`/popular-series${query([`start=${startParam(page, PAGE_SIZE)}`])}`, PAGE_SIZE, true),

    getLatest: (page) =>
      listing(`/releases${query([`start=${startParam(page, RELEASES_PAGE_SIZE)}`])}`, RELEASES_PAGE_SIZE, true),

    async search(text: string, page: number, filters: FilterState): Promise<AnimePage> {
      const term = text.trim();
      if (term) {
        // One answer holds every match, so only the first page has anything.
        if (page > 1) return { items: [], hasNextPage: false };
        return listing(`/search${query([`q=${encodeURIComponent(term)}`])}`, PAGE_SIZE, false);
      }
      const genre = filters['genre'];
      const sortKey = typeof filters['sort'] === 'string' && filters['sort'] in SORTS ? filters['sort'] : 'hits';
      const status = filters['status'];
      const parts = [
        SORTS[sortKey],
        status === 'ongoing' || status === 'completed' ? `ongoing=${status === 'ongoing'}` : undefined,
        `start=${startParam(page, PAGE_SIZE)}`,
      ];
      const path =
        typeof genre === 'string' && GENRES.includes(genre)
          ? `/genre/${encodeURIComponent(genre.toLowerCase())}`
          : '/popular-series';
      return listing(`${path}${query(parts)}`, PAGE_SIZE, true);
    },

    getFilters: (): Filter[] => [
      { type: 'header', label: 'Filters apply only when the search box is empty.' },
      {
        type: 'select',
        id: 'sort',
        label: 'Sort by',
        options: [
          { value: 'hits', label: 'Popular' },
          { value: 'createdAt', label: 'Newest' },
          { value: 'sortLetter', label: 'Alphabetical' },
        ],
        default: 'hits',
      },
      {
        type: 'select',
        id: 'status',
        label: 'Status',
        options: [
          { value: '', label: 'Any' },
          { value: 'ongoing', label: 'Ongoing' },
          { value: 'completed', label: 'Completed' },
        ],
        default: '',
      },
      {
        type: 'select',
        id: 'genre',
        label: 'Genre',
        options: [{ value: '', label: 'Any' }, ...GENRES.map((value) => ({ value, label: value }))],
        default: '',
      },
    ],

    async getAnimeDetails(anime: AnimeSummary): Promise<AnimeDetails> {
      const doc = await detailPage(anime);
      const title = collapse(doc.selectFirst('.media-body h1')?.text() ?? '');
      if (!title) throw new ParseError('The detail page has no title');
      let status: AnimeStatus = 'unknown';
      let altTitles: string[] = [];
      for (const span of doc.select('.media-body p.infoami span')) {
        const text = collapse(span.text());
        if (/^Status:/i.test(text)) status = readStatus(text);
        else if (/^Alternate Titles:/i.test(text)) {
          altTitles = text
            .replace(/^Alternate Titles:/i, '')
            .split(/[,，]/)
            .map(collapse)
            .filter((t) => t && t !== title);
        }
      }
      const genres = doc
        .select('ul.tagscat a')
        .map((a) => collapse(a.text()))
        .filter(Boolean);
      const description = collapse(doc.selectFirst('p.ptext')?.text() ?? '');
      return {
        url: anime.url,
        title,
        thumbnailUrl: doc.selectFirst('.media img.media-object')?.absUrl('src') || undefined,
        description: description || undefined,
        genres: genres.length > 0 ? genres : undefined,
        altTitles: altTitles.length > 0 ? altTitles : undefined,
        status,
      };
    },

    /** Every episode the page lists, newest first; an episode that has a dub is listed twice (Sub and Dub). */
    async getEpisodes(anime: AnimeSummary): Promise<Episode[]> {
      const doc = await detailPage(anime);
      const seen = new Set<string>();
      const episodes: Episode[] = [];
      for (const row of doc.select('ul.newmanga li')) {
        const href = row.selectFirst('a.anm_det_pop')?.attr('href');
        if (!href) continue;
        const path = new URL(href, `${base()}/`).pathname;
        const number = episodeNumber(path);
        if (number === undefined) continue;
        const heading = collapse(row.selectFirst('i.anititle')?.text() ?? '');
        const name =
          heading && !/^Episode\s+[\d.]+$/i.test(heading) ? `Episode ${number} - ${heading}` : `Episode ${number}`;
        const dubbed = row.selectFirst('.btn-dubbed') !== null;
        const subbed = row.selectFirst('.btn-subbed') !== null || !dubbed;
        for (const [on, version, variant] of [
          [subbed, 'subbed', 'Sub'],
          [dubbed, 'dubbed', 'Dub'],
        ] as const) {
          const url = `${path}#${version}`;
          if (!on || seen.has(url)) continue;
          seen.add(url);
          episodes.push({ url, name, number, variant });
        }
      }
      return episodes.sort((a, b) => (b.number ?? 0) - (a.number ?? 0));
    },

    getStreams: async (episode: Episode) => labelPlaylists(await getStreams(episode)),

    resolveUrl(url: string): AnimeSummary | null {
      const match = /^https?:\/\/(?:www\.)?animegg\.[a-z]+\/series\/([^/?#]+)/i.exec(url);
      const slug = match?.[1];
      return slug ? { url: `/series/${slug}`, title: slug } : null;
    },

    getWebUrl: (item: AnimeSummary | Episode) => `${base()}${item.url.split('#')[0]}`,
  }),
});
