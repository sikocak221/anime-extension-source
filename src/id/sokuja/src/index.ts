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
import { DEFAULT_BASE_URL, base, fetchJson, fetchPage, fetchPageShared } from './site';
import { getStreams } from './streams';
import {
  animePath,
  cleanTitle,
  collapse,
  entityPath,
  episodeName,
  episodeNumber,
  episodePath,
  imageUrl,
  parseStatus,
  parseType,
  parseYear,
  slugOf,
} from './text';

// sokuja: a Next.js site with Indonesian subtitles, rendered on the server, so lists and details are read from
// HTML. Entity urls are paths: "/anime/<slug>/" for an anime and "/<slug>/" for an episode. Search is the site's
// own results page (`/?s=`), which has the markup of a listing. The streams are in streams.ts.

const EMPTY: AnimePage = { items: [], hasNextPage: false };

/** The site's genre select (`/anime/?genre=<slug>`). Adult genres and the duplicates of "Shōnen" are left out. */
const GENRES: [slug: string, label: string][] = [
  ['action', 'Action'],
  ['adult-cast', 'Adult Cast'],
  ['adventure', 'Adventure'],
  ['anthropomorphic', 'Anthropomorphic'],
  ['apocalyptic-battle', 'Apocalyptic Battle'],
  ['avant-garde', 'Avant Garde'],
  ['award-winning', 'Award Winning'],
  ['battle', 'Battle'],
  ['cgdct', 'CGDCT'],
  ['childcare', 'Childcare'],
  ['comedy', 'Comedy'],
  ['curse-exorcism', 'Curse Exorcism'],
  ['dark-fantasy', 'Dark Fantasy'],
  ['dark-humor', 'Dark Humor'],
  ['delinquents', 'Delinquents'],
  ['detective', 'Detective'],
  ['drama', 'Drama'],
  ['ecchi', 'Ecchi'],
  ['emotional-journey', 'Emotional Journey'],
  ['fantasy', 'Fantasy'],
  ['fire-brigade', 'Fire Brigade'],
  ['gag-humor', 'Gag Humor'],
  ['girls-love', 'Girls Love'],
  ['gore', 'Gore'],
  ['gourmet', 'Gourmet'],
  ['harem', 'Harem'],
  ['hero-unit', 'Hero Unit'],
  ['high-stakes-game', 'High Stakes Game'],
  ['historical', 'Historical'],
  ['horror', 'Horror'],
  ['idol', 'Idol'],
  ['idols-female', 'Idols (Female)'],
  ['isekai', 'Isekai'],
  ['iyashikei', 'Iyashikei'],
  ['josei', 'Josei'],
  ['kids', 'Kids'],
  ['love-polygon', 'Love Polygon'],
  ['love-status-quo', 'Love Status Quo'],
  ['magic', 'Magic'],
  ['magical-sex-shift', 'Magical Sex Shift'],
  ['mahou-shoujo', 'Mahou Shoujo'],
  ['martial-arts', 'Martial Arts'],
  ['mecha', 'Mecha'],
  ['medical', 'Medical'],
  ['military', 'Military'],
  ['music', 'Music'],
  ['mystery', 'Mystery'],
  ['mythology', 'Mythology'],
  ['organized-crime', 'Organized Crime'],
  ['otaku-culture', 'Otaku Culture'],
  ['parody', 'Parody'],
  ['performing-arts', 'Performing Arts'],
  ['pets', 'Pets'],
  ['prison', 'Prison'],
  ['psychological', 'Psychological'],
  ['psychological-thriller', 'Psychological Thriller'],
  ['racing', 'Racing'],
  ['reincarnation', 'Reincarnation'],
  ['romance', 'Romance'],
  ['romantic-subtext', 'Romantic Subtext'],
  ['samurai', 'Samurai'],
  ['school', 'School'],
  ['sci-fi', 'Sci-Fi'],
  ['seinen', 'Seinen'],
  ['shoujo', 'Shoujo'],
  ['shounen', 'Shounen'],
  ['showbiz', 'Showbiz'],
  ['slice-of-life', 'Slice of Life'],
  ['space', 'Space'],
  ['sports', 'Sports'],
  ['strategy-game', 'Strategy Game'],
  ['super-power', 'Super Power'],
  ['supernatural', 'Supernatural'],
  ['survival', 'Survival'],
  ['suspense', 'Suspense'],
  ['team-sports', 'Team Sports'],
  ['thriller-sosial', 'Thriller Sosial'],
  ['time-travel', 'Time Travel'],
  ['urban-fantasy', 'Urban Fantasy'],
  ['vampire', 'Vampire'],
  ['video-game', 'Video Game'],
  ['villainess', 'Villainess'],
  ['visual-arts', 'Visual Arts'],
  ['workplace', 'Workplace'],
];

const STATUS_OPTIONS = [
  ['', 'Any'],
  ['ongoing', 'Ongoing'],
  ['completed', 'Completed'],
  ['upcoming', 'Upcoming'],
] as const;

const TYPE_OPTIONS = [
  ['', 'Any'],
  ['tv', 'TV'],
  ['movie', 'Movie'],
  ['ova', 'OVA'],
  ['ona', 'ONA'],
  ['special', 'Special'],
] as const;

const ORDER_OPTIONS = [
  ['update', 'Latest update'],
  ['newest', 'Newest'],
  ['oldest', 'Oldest'],
  ['title_az', 'A-Z'],
  ['title_za', 'Z-A'],
  ['score', 'Score'],
  ['popular', 'Popular'],
] as const;

const pick = (filters: FilterState, id: string, allowed: readonly (readonly [string, string])[]): string => {
  const value = filters[id];
  return typeof value === 'string' && allowed.some(([v]) => v === value) ? value : '';
};

/** Reads the cards of a listing or of the search results (`a.group.block`, which link to the anime). */
function readCards(doc: HtmlElement, baseUrl: string): AnimeSummary[] {
  const items: AnimeSummary[] = [];
  const seen = new Set<string>();
  for (const card of doc.select('a.group.block[href^="/anime/"]')) {
    const href = card.attr('href');
    const title = collapse(card.selectFirst('h3')?.text() ?? card.selectFirst('img')?.attr('alt') ?? '');
    if (!href || !title) throw new ParseError('A card has no link or title: the site layout changed');
    const url = entityPath(href, baseUrl);
    if (seen.has(url)) continue;
    seen.add(url);
    const cover = imageUrl(card.selectFirst('img')?.attr('src'), baseUrl);
    items.push({ url, title: cleanTitle(title), ...(cover && { thumbnailUrl: cover }) });
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
  const items = readCards(doc, base());
  // Past the last page the site answers a page with no cards; that is the end of the list, not a layout change.
  if (items.length === 0 && !doc.selectFirst('section, main, h1, h2')) {
    throw new ParseError('The listing has no cards and no page frame: the site layout changed');
  }
  const next = doc.select('a').some((link) => collapse(link.text()) === 'Selanjutnya');
  return { items, hasNextPage: next && items.length > 0 };
}

function browse(params: Record<string, string>, page: number): Promise<AnimePage> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.append(key, value);
  if (page > 1) query.set('page', String(Math.floor(page)));
  const qs = query.toString();
  return listing(`/anime/${qs ? `?${qs}` : ''}`, page);
}

async function animeDoc(anime: AnimeSummary): Promise<HtmlElement> {
  const url = `${base()}${anime.url}`;
  const doc = html.load((await fetchPageShared(url)).text, { baseUrl: url });
  if (!doc.selectFirst('h1')) throw new ParseError('The anime page has no title: the site layout changed');
  return doc;
}

/** The `Informasi Anime` rows: `<dl><div><dt>Status</dt><dd>Completed</dd></div>…`. */
function readInfo(doc: HtmlElement): (label: string) => HtmlElement | undefined {
  const rows = new Map<string, HtmlElement>();
  for (const row of doc.select('dl > div')) {
    const label = collapse(row.selectFirst('dt')?.text() ?? '').toLowerCase();
    const value = row.selectFirst('dd');
    if (label && value) rows.set(label, value);
  }
  return (label) => rows.get(label.toLowerCase());
}

const textOf = (node: HtmlElement | undefined): string | undefined => {
  const value = collapse(node?.text() ?? '');
  return value && !/^(?:\?|-|n\/a)$/i.test(value) ? value : undefined;
};

/** How many episodes the page says the anime has: "Daftar Episode (461)". */
function declaredEpisodes(doc: HtmlElement): number | undefined {
  const heading = doc.select('h2').find((h) => /^Daftar Episode/i.test(collapse(h.text())));
  const count = Number(/\((\d+)\)/.exec(collapse(heading?.text() ?? ''))?.[1]);
  return Number.isFinite(count) && count > 0 ? count : undefined;
}

export default defineExtension({
  preferences: () => [
    {
      type: 'text',
      key: 'baseUrl',
      label: 'Site address',
      description:
        'The site is a numbered mirror (x6.sokuja.uk today); sokuja.net redirects to the current one. Libraries store paths, so they survive a change.',
      default: DEFAULT_BASE_URL,
    },
  ],

  createSource: () => ({
    get baseUrl() {
      return base();
    },

    getPopular: (page) => browse({ order: 'popular' }, page),

    /** The default order of the site: the series whose episode came out last first (24 a page). */
    getLatest: (page) => browse({ order: 'update' }, page),

    search(query: string, page: number, filters: FilterState): Promise<AnimePage> {
      const text = query.trim();
      if (text) {
        // The site's own search page ignores the filters; it has the markup of a listing.
        const params = new URLSearchParams({ s: text });
        if (page > 1) params.set('page', String(Math.floor(page)));
        return listing(`/?${params.toString()}`, page);
      }
      const genre = filters['genre'];
      return browse(
        {
          genre: typeof genre === 'string' && GENRES.some(([slug]) => slug === genre) ? genre : '',
          status: pick(filters, 'status', STATUS_OPTIONS),
          type: pick(filters, 'type', TYPE_OPTIONS),
          order: pick(filters, 'order', ORDER_OPTIONS) === 'update' ? '' : pick(filters, 'order', ORDER_OPTIONS),
        },
        page,
      );
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
        id: 'order',
        label: 'Order by',
        options: ORDER_OPTIONS.map(([value, label]) => ({ value, label })),
        default: 'update',
      },
    ],

    async getAnimeDetails(anime: AnimeSummary): Promise<AnimeDetails> {
      const doc = await animeDoc(anime);
      const info = readInfo(doc);
      const title = cleanTitle(doc.selectFirst('h1')?.text() ?? '');
      if (!title) throw new ParseError('The anime page has no title');
      const alt = collapse(doc.selectFirst('h1 + p')?.text() ?? '')
        .split(',')
        .map(collapse)
        .filter((name) => name && name.toLowerCase() !== title.toLowerCase());
      // The first paragraph is often a link to the other seasons ("Series Lain : …"), which is not the plot.
      const synopsis = doc
        .select('.prose p')
        .map((p) => collapse(p.text()))
        .filter((text) => text && !/^Series Lain\b/i.test(text))
        .join('\n\n');
      const genres = doc
        .select('a.rounded-full[href^="/genre/"]')
        .map((a) => collapse(a.text()))
        .filter(Boolean);
      const studios = (info('Studio')?.select('a') ?? []).map((a) => collapse(a.text())).filter(Boolean);
      const cover = imageUrl(doc.selectFirst('img[sizes="100vw"]')?.attr('src'), base());
      return {
        url: anime.url,
        title,
        thumbnailUrl: cover ?? anime.thumbnailUrl,
        altTitles: alt.length > 0 ? alt : undefined,
        description: synopsis || undefined,
        genres: genres.length > 0 ? genres : undefined,
        studio: studios.length > 0 ? studios.join(', ') : undefined,
        year: parseYear(textOf(info('Tahun'))),
        status: parseStatus(textOf(info('Status')) ?? ''),
        type: parseType(textOf(info('Tipe')) ?? ''),
      };
    },

    /**
     * The page lists the newest 50 episodes of a long series and loads the rest on a button, so when it says the
     * anime has more than it shows, the whole list comes from the API the episode page uses for its playlist.
     */
    async getEpisodes(anime: AnimeSummary): Promise<Episode[]> {
      const doc = await animeDoc(anime);
      const byUrl = new Map<string, Episode>();
      const add = (url: string, name: string, number: number | undefined): void => {
        if (!byUrl.has(url)) byUrl.set(url, { url, name, ...(number !== undefined && { number }) });
      };
      for (const link of doc.select('div.space-y-1 > a[href]')) {
        const href = link.attr('href');
        if (!href) continue;
        const label = collapse(link.selectFirst('span')?.text() ?? '');
        const number = episodeNumber(label, href);
        add(entityPath(href, base()), episodeName(label, number), number);
      }
      const shown = byUrl.size;
      if (shown === 0 && !doc.selectFirst('h2')) {
        throw new ParseError('The anime page has no episode list: the site layout changed');
      }

      const total = declaredEpisodes(doc);
      const seed = [...byUrl.keys()][0];
      if (seed && total !== undefined && total > shown) {
        try {
          const playlist = await fetchJson<{ episodes?: { slug?: unknown; episodeNumber?: unknown }[] }>(
            `${base()}/api/playlist/?slug=${encodeURIComponent(slugOf(seed))}`,
          );
          for (const entry of playlist.episodes ?? []) {
            if (typeof entry.slug !== 'string' || !entry.slug) continue;
            const number = Number.parseFloat(String(entry.episodeNumber));
            // The batch download of a series is listed as episode 0; it has no video.
            if (!(number > 0) && /batch/i.test(entry.slug)) continue;
            add(
              episodePath(entry.slug),
              Number.isFinite(number) ? `Episode ${number}` : 'Episode',
              Number.isFinite(number) ? number : undefined,
            );
          }
        } catch (error) {
          // The 50 that the page shows are still worth having.
          log.warn('The full episode list could not be read:', (error as Error).message);
        }
      }

      const episodes = [...byUrl.values()];
      // A film or a single OVA is "episode 1" of itself.
      const only = episodes.length === 1 ? episodes[0] : undefined;
      if (only && only.number === undefined) only.number = 1;
      // Newest first. Array.sort is stable, so unnumbered entries keep the page order, after the numbered ones.
      return episodes.sort((a, b) => (b.number ?? -Infinity) - (a.number ?? -Infinity) || 0);
    },

    getStreams,

    resolveUrl(url: string): AnimeSummary | null {
      const match = /^https?:\/\/(?:[a-z0-9-]+\.)*sokuja\.[a-z]+\/anime\/([^/?#]+)\/?/i.exec(url);
      const slug = match?.[1];
      return slug ? { url: animePath(slug), title: slug.replace(/-/g, ' ') } : null;
    },

    getWebUrl: (item: AnimeSummary | Episode) => `${base()}${item.url}`,
  }),
});
