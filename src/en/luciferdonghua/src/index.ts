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
import { DEFAULT_BASE_URL, base, fetchPage, sharedFetch } from './site';
import { type Server, isReadableLabel, readOptions, readPlayer, resolveServers } from './streams';
import { STATUSES, TYPES, collapse, entityPath, episodeName, parseEpisodeDate, parseNumber, releaseYear } from './text';
import { labelPlaylists } from './hls-quality';

// luciferdonghua.in: WordPress with the AnimeStream theme, donghua with English subtitles. Everything is read from
// HTML. Entity urls are paths: "/anime/<slug>/" for a series, "/<slug>-episode-<n>-lucifer-donghua/" for an episode.
// The series list lives at "/anime/" (filters and order), the text search at "/?s=".

/** Server pages read per episode; each is a full page of the site. */
const MAX_PAGES = 6;

const EMPTY: AnimePage = { items: [], hasNextPage: false };

/** The site's genre checkboxes (`/anime/` filter form). */
const GENRES: [slug: string, label: string][] = [
  ['2d-anime', '2D Anime'],
  ['action', 'Action'],
  ['adult-cast', 'Adult Cast'],
  ['adventure', 'Adventure'],
  ['comedy', 'Comedy'],
  ['crossdressing', 'Crossdressing'],
  ['cultivation', 'Cultivation'],
  ['delinquents', 'Delinquents'],
  ['demons', 'Demons'],
  ['drama', 'Drama'],
  ['emotional', 'Emotional'],
  ['fantasy', 'Fantasy'],
  ['gourmet', 'Gourmet'],
  ['harem', 'Harem'],
  ['historical', 'Historical'],
  ['horror', 'Horror'],
  ['isekai', 'Isekai'],
  ['magic', 'Magic'],
  ['martial-art', 'Martial Art'],
  ['martial-arts', 'Martial Arts'],
  ['medical', 'Medical'],
  ['mystery', 'Mystery'],
  ['mythology', 'Mythology'],
  ['organized-crime', 'Organized Crime'],
  ['post-apocalyptic', 'Post-Apocalyptic'],
  ['psychological', 'Psychological'],
  ['re-birth', 'Re-Birth'],
  ['reincarnation', 'Reincarnation'],
  ['romance', 'Romance'],
  ['school', 'School'],
  ['sci-fi', 'Sci-fi'],
  ['seinen', 'Seinen'],
  ['shounen', 'Shounen'],
  ['sports', 'Sports'],
  ['super-power', 'Super Power'],
  ['supernatural', 'Supernatural'],
  ['suspense', 'Suspense'],
  ['urban-fantasy', 'Urban Fantasy'],
  ['video-game', 'Video Game'],
];

const STATUS_OPTIONS = [
  ['', 'All'],
  ['ongoing', 'Ongoing'],
  ['completed', 'Completed'],
  ['new anime', 'New'],
  ['upcoming', 'Upcoming'],
  ['hiatus', 'Hiatus'],
] as const;

const TYPE_OPTIONS = [
  ['', 'All'],
  ['tv', 'TV Series'],
  ['ova', 'OVA'],
  ['movie', 'Movie'],
  ['live action', 'Live Action'],
  ['special', 'Special'],
  ['bd', 'BD'],
  ['ona', 'ONA'],
  ['music', 'Music'],
] as const;

const ORDER_OPTIONS = [
  ['update', 'Latest Update'],
  ['popular', 'Popular'],
  ['rating', 'Rating'],
  ['latest', 'Latest Added'],
  ['title', 'A-Z'],
  ['titlereverse', 'Z-A'],
] as const;

const SUB_OPTIONS = [
  ['', 'All'],
  ['sub', 'Sub'],
  ['dub', 'Dub'],
  ['raw', 'RAW'],
] as const;

const pick = (filters: FilterState, id: string, allowed: readonly (readonly [string, string])[]): string => {
  const value = filters[id];
  return typeof value === 'string' && allowed.some(([v]) => v === value) ? value : '';
};

/** Reads the cards of a listing. A page that is past the end answers 200 with no cards, or 404. */
function readCards(doc: HtmlElement, baseUrl: string): AnimeSummary[] {
  const items: AnimeSummary[] = [];
  const seen = new Set<string>();
  for (const card of doc.select('.listupd article.bs')) {
    const link = card.selectFirst('a[itemprop=url]') ?? card.selectFirst('a');
    const href = link?.attr('href');
    const title = collapse(card.selectFirst('.tt h2')?.text() ?? link?.attr('title') ?? '');
    if (!href || !title) throw new ParseError('A card has no link or title: the site layout changed');
    const url = entityPath(href, baseUrl);
    if (seen.has(url)) continue;
    seen.add(url);
    const img = card.selectFirst('img');
    const cover = img?.absUrl('src');
    items.push({ url, title, ...(cover && !cover.startsWith('data:') && { thumbnailUrl: cover }) });
  }
  return items;
}

async function listing(path: string, page: number): Promise<AnimePage> {
  const url = `${base()}${path}`;
  let text: string;
  try {
    text = (await fetchPage(url)).text;
  } catch (error) {
    if (page > 1 && error instanceof NotFoundError) return EMPTY;
    throw error;
  }
  const doc = html.load(text, { baseUrl: url });
  const items = readCards(doc, url);
  if (items.length === 0 && !doc.selectFirst('#sidebar, .listupd, .releases')) {
    throw new ParseError('The listing has no cards and no page frame: the site layout changed');
  }
  // The series list has a "Next" link in `.hpage`; the search results are paginated with `a.next.page-numbers`.
  const hasNextPage = doc.selectFirst('.hpage a.r') !== null || doc.selectFirst('a.next.page-numbers') !== null;
  return { items, hasNextPage };
}

function browse(params: Record<string, string>, page: number): Promise<AnimePage> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.append(key, value);
  if (page > 1) query.set('page', String(Math.floor(page)));
  const qs = query.toString();
  return listing(`/anime/${qs ? `?${qs}` : ''}`, page);
}

async function seriesPage(anime: AnimeSummary): Promise<HtmlElement> {
  const url = `${base()}${anime.url}`;
  // The app asks for the details and the episodes of an anime together; both read this page.
  const doc = html.load((await sharedFetch(url, fetchPage)).text, { baseUrl: url });
  if (!doc.selectFirst('h1.entry-title')) throw new ParseError('The series page has no title: the site layout changed');
  return doc;
}

/** `<span><b>Label:</b> value</span>` rows of the info block. */
function readInfo(doc: HtmlElement): (label: string) => string | undefined {
  const lines = doc.select('.info-content .spe span').map((span) => collapse(span.text()));
  return (label) => {
    const prefix = `${label.toLowerCase()}:`;
    const line = lines.find((l) => l.toLowerCase().startsWith(prefix));
    const value = line?.slice(prefix.length).trim();
    return value && !/^(?:\?|-|unknown)$/i.test(value) ? value : undefined;
  };
}

/** The synopsis paragraphs; the heading above them is only a list of titles and keywords for search engines. */
function readSynopsis(doc: HtmlElement): string {
  return doc
    .select('.synp .entry-content p')
    .map((p) => collapse(p.text()))
    .filter(Boolean)
    .join('\n\n');
}

/**
 * The servers of an episode page. The page shows the default option; every other readable option (Dailymotion,
 * ok.ru) is a page of its own, fetched here. A page that fails is logged and skipped.
 */
async function readServers(doc: HtmlElement): Promise<Server[]> {
  const options = readOptions(doc);
  const current = options.find((o) => o.selected) ?? options[0];
  const servers: Server[] = [];
  const own = readPlayer(doc);
  if (own) servers.push({ label: current?.label ?? 'Default', embed: own });
  const others = options.filter((o) => o !== current && isReadableLabel(o.label)).slice(0, MAX_PAGES);
  const pages = await Promise.all(
    others.map(async (option) => {
      try {
        const embed = readPlayer(html.load((await fetchPage(option.page)).text, { baseUrl: option.page }));
        return embed ? { label: option.label, embed } : undefined;
      } catch (error) {
        log.warn(`Server page "${option.label}" failed:`, (error as Error).message);
        return undefined;
      }
    }),
  );
  for (const page of pages) if (page) servers.push(page);
  return servers;
}

export default defineExtension({
  preferences: () => [
    {
      type: 'text',
      key: 'baseUrl',
      label: 'Site address',
      description: 'Use another address if the site moves. Libraries store paths, so they survive.',
      default: DEFAULT_BASE_URL,
    },
  ],

  createSource: () => ({
    get baseUrl() {
      return base();
    },

    getPopular: (page) => browse({ order: 'popular' }, page),

    /** Series ordered by their newest episode. */
    getLatest: (page) => browse({ order: 'update' }, page),

    search(query: string, page: number, filters: FilterState): Promise<AnimePage> {
      const text = query.trim();
      if (text) {
        // The site's own search ignores the filters.
        const path = page > 1 ? `/page/${Math.floor(page)}/` : '/';
        return listing(`${path}?${new URLSearchParams({ s: text }).toString()}`, page);
      }
      const genre = filters['genre'];
      const params: Record<string, string> = {
        status: pick(filters, 'status', STATUS_OPTIONS),
        type: pick(filters, 'type', TYPE_OPTIONS),
        sub: pick(filters, 'sub', SUB_OPTIONS),
        order: pick(filters, 'order', ORDER_OPTIONS) || 'update',
      };
      const query2 = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) if (value) query2.append(key, value);
      if (typeof genre === 'string' && GENRES.some(([slug]) => slug === genre)) query2.append('genre[]', genre);
      if (page > 1) query2.set('page', String(Math.floor(page)));
      return listing(`/anime/?${query2.toString()}`, page);
    },

    getFilters: (): Filter[] => [
      { type: 'header', label: 'These filters apply only when the search box is empty.' },
      {
        type: 'select',
        id: 'genre',
        label: 'Genre',
        options: [{ value: '', label: 'Any' }, ...GENRES.map(([value, label]) => ({ value, label }))],
        default: '',
      },
      {
        type: 'select',
        id: 'status',
        label: 'Status',
        options: STATUS_OPTIONS.map(([value, label]) => ({ value, label })),
        default: '',
      },
      {
        type: 'select',
        id: 'type',
        label: 'Type',
        options: TYPE_OPTIONS.map(([value, label]) => ({ value, label })),
        default: '',
      },
      {
        type: 'select',
        id: 'sub',
        label: 'Language',
        options: SUB_OPTIONS.map(([value, label]) => ({ value, label })),
        default: '',
      },
      {
        type: 'select',
        id: 'order',
        label: 'Order by',
        options: ORDER_OPTIONS.map(([value, label]) => ({ value, label })),
        default: 'update',
      },
    ],

    async getAnimeDetails(anime: AnimeSummary): Promise<AnimeDetails> {
      const doc = await seriesPage(anime);
      const info = readInfo(doc);
      const title = collapse(doc.selectFirst('h1.entry-title')?.text() ?? '');
      if (!title) throw new ParseError('The series page has no title');

      const alt = (doc.selectFirst('.alter')?.text() ?? '')
        .split(',')
        .map(collapse)
        .filter((name) => name && name.toLowerCase() !== title.toLowerCase());
      const genres = doc
        .select('.genxed a')
        .map((a) => collapse(a.text()))
        .filter(Boolean);
      const cover = doc.selectFirst('.thumbook .thumb img')?.absUrl('src');
      const synopsis = readSynopsis(doc);
      return {
        url: anime.url,
        title,
        thumbnailUrl: cover && !cover.startsWith('data:') ? cover : undefined,
        altTitles: alt.length > 0 ? alt : undefined,
        description: synopsis || undefined,
        genres: genres.length > 0 ? genres : undefined,
        studio: info('Studio') ?? info('Network'),
        year: releaseYear(info('Released')),
        status: STATUSES[(info('Status') ?? '').toLowerCase()] ?? 'unknown',
        type: TYPES[(info('Type') ?? '').toLowerCase()],
      };
    },

    /** The page lists newest first already; numbered episodes are sorted by number anyway. */
    async getEpisodes(anime: AnimeSummary): Promise<Episode[]> {
      const doc = await seriesPage(anime);
      const seen = new Set<string>();
      const episodes: Episode[] = [];
      for (const row of doc.select('.eplister ul li')) {
        const link = row.selectFirst('a');
        const href = link?.attr('href');
        if (!link || !href) continue;
        const url = entityPath(href, base());
        if (seen.has(url)) continue;
        seen.add(url);
        const label = collapse(row.selectFirst('.epl-num')?.text() ?? '');
        const number = parseNumber(label);
        const title = collapse(row.selectFirst('.epl-title')?.text() ?? '');
        episodes.push({
          url,
          name: episodeName(title || label, number === undefined ? label : String(number)),
          ...(number !== undefined && { number }),
          uploadedAt: parseEpisodeDate(row.selectFirst('.epl-date')?.text() ?? ''),
        });
      }
      // A film or a single special is "episode 1" of itself.
      const only = episodes.length === 1 ? episodes[0] : undefined;
      if (only && only.number === undefined) only.number = 1;
      // Array.sort is stable, so unnumbered entries keep the page order, after the numbered ones.
      return episodes.sort((a, b) => (b.number ?? -Infinity) - (a.number ?? -Infinity) || 0);
    },

    async getStreams(episode: Episode) {
      const url = `${base()}${episode.url}`;
      const doc = html.load((await fetchPage(url)).text, { baseUrl: url });
      return labelPlaylists(await resolveServers(await readServers(doc)));
    },

    resolveUrl(url: string): AnimeSummary | null {
      const slug = /^https?:\/\/(?:www\.)?luciferdonghua\.[a-z]+\/anime\/([^/?#]+)\/?$/i.exec(url)?.[1];
      return slug ? { url: `/anime/${slug}/`, title: slug.replace(/-/g, ' ') } : null;
    },

    getWebUrl: (item: AnimeSummary | Episode) => `${base()}${item.url}`,
  }),
});
