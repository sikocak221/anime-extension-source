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
  GENRES,
  ORDERS,
  STATUSES,
  TYPES,
  collapse,
  entityPath,
  episodeNumber,
  parseStatus,
  parseType,
  parseYear,
  posterUrl,
} from './text';

// kuronime.sbs: a WordPress theme (animenonton) behind Cloudflare, Indonesian subtitles. The catalogue is
// `/anime/page/<n>/?title=&genre[]=&status=&type=&order=` (`order`: popular, update, latest, title, titlereverse),
// a series is `/anime/<slug>/` with its episode list, an episode is `/nonton-<slug>-episode-<n>/`. The domain has
// changed several times (kuronime.net, .moe, .tv, .sbs), so entity urls are paths only and the base is a
// preference. The streams come from a player API, see streams.ts.

const EMPTY: AnimePage = { items: [], hasNextPage: false };

const pick = (value: unknown, allowed: readonly [string, string][]): string =>
  typeof value === 'string' && allowed.some(([v]) => v === value) ? value : '';

async function fetchDoc(path: string, fetch = fetchPage): Promise<{ doc: HtmlElement; url: string }> {
  const url = `${base()}${path}`;
  const text = (await fetch(url)).text;
  return { doc: html.load(text, { baseUrl: url }), url };
}

/** Reads the cards of a listing (`.listupd article.bs`). */
function readCards(doc: HtmlElement, baseUrl: string): AnimeSummary[] {
  const items: AnimeSummary[] = [];
  const seen = new Set<string>();
  for (const card of doc.select('.listupd article.bs')) {
    const link = card.selectFirst('a[href]');
    const href = link?.attr('href');
    const title = collapse(card.selectFirst('h2')?.text() ?? link?.attr('title') ?? '');
    if (!href || !title) throw new ParseError('A card has no link or title: the site layout changed');
    const url = entityPath(href, baseUrl);
    if (seen.has(url)) continue;
    seen.add(url);
    const thumbnailUrl = posterUrl(card.selectFirst('img[itemprop="image"]')?.attr('src'));
    items.push({ url, title, ...(thumbnailUrl && { thumbnailUrl }) });
  }
  return items;
}

async function catalogue(params: Record<string, string>, page: number): Promise<AnimePage> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.append(key, value);
  const qs = query.toString();
  const n = Math.max(1, Math.floor(page));
  let loaded;
  try {
    loaded = await fetchDoc(`/anime/${n > 1 ? `page/${n}/` : ''}${qs ? `?${qs}` : ''}`);
  } catch (error) {
    if (n > 1 && error instanceof NotFoundError) return EMPTY;
    throw error;
  }
  const items = readCards(loaded.doc, loaded.url);
  if (items.length === 0 && !loaded.doc.selectFirst('.listupd, footer')) {
    throw new ParseError('The catalogue has no cards and no page frame: the site layout changed');
  }
  return { items, hasNextPage: loaded.doc.selectFirst('a.next.page-numbers') !== null };
}

async function seriesPage(anime: AnimeSummary): Promise<{ doc: HtmlElement; url: string }> {
  const path = entityPath(anime.url, base());
  const loaded = await fetchDoc(path, fetchPageShared);
  if (!loaded.doc.selectFirst('h1.entry-title'))
    throw new ParseError('The series page has no title: the site layout changed');
  return loaded;
}

/** `<li><b>Label</b>: value</li>` rows of the info block, by lowercase label. */
function readInfo(doc: HtmlElement): (label: string) => HtmlElement | undefined {
  const rows = new Map<string, HtmlElement>();
  for (const row of doc.select('.infodetail li')) {
    const label = collapse(row.selectFirst('b')?.text() ?? '').toLowerCase();
    if (label) rows.set(label, row);
  }
  return (label) => rows.get(label.toLowerCase());
}

/** The text of an info row after its label ("Status: Ongoing" → "Ongoing"). */
const infoText = (row: HtmlElement | undefined): string | undefined => {
  const value = collapse((row?.text() ?? '').replace(/^[^:]*:/, ''));
  return value && !/^(?:\?|-|unknown)$/i.test(value) ? value : undefined;
};

export default defineExtension({
  preferences: () => [
    {
      type: 'text',
      key: 'baseUrl',
      label: 'Site address',
      description:
        'Kuronime changes domain often (kuronime.net, .moe, .tv, .sbs). Libraries store paths, so they survive it.',
      default: DEFAULT_BASE_URL,
    },
  ],

  createSource: () => ({
    get baseUrl() {
      return base();
    },

    getPopular: (page) => catalogue({ order: 'popular' }, page),

    getLatest: (page) => catalogue({ order: 'update' }, page),

    search: (query: string, page: number, filters: FilterState): Promise<AnimePage> =>
      catalogue(
        {
          title: query.trim(),
          'genre[]': pick(filters['genre'], GENRES),
          status: pick(filters['status'], STATUSES),
          type: pick(filters['type'], TYPES),
          order: pick(filters['order'], ORDERS),
        },
        page,
      ),

    getFilters: (): Filter[] => [
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
        options: [{ value: '', label: 'Any' }, ...STATUSES.map(([value, label]) => ({ value, label }))],
        default: '',
      },
      {
        type: 'select',
        id: 'type',
        label: 'Type',
        options: [{ value: '', label: 'Any' }, ...TYPES.map(([value, label]) => ({ value, label }))],
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
      const title = collapse(doc.selectFirst('h1.entry-title')?.text() ?? '');
      if (!title) throw new ParseError('The series page has no title');
      const alt = (infoText(info('judul')) ?? '')
        .split(/,\s*/)
        .map(collapse)
        .filter((name, i, all) => name && name.toLowerCase() !== title.toLowerCase() && all.indexOf(name) === i);
      const genres = (info('genre')?.select('a') ?? []).map((a) => collapse(a.text())).filter(Boolean);
      const description = collapse(doc.selectFirst('.conx .const')?.text() ?? '');
      return {
        url: entityPath(anime.url, url),
        title,
        thumbnailUrl: posterUrl(doc.selectFirst('.main-info .l img')?.attr('src')),
        altTitles: alt.length > 0 ? alt : undefined,
        description: description || undefined,
        genres: genres.length > 0 ? genres : undefined,
        studio: infoText(info('studio')),
        year: parseYear(infoText(info('tayang'))),
        status: parseStatus(infoText(info('status')) ?? ''),
        type: parseType(infoText(info('tipe')) ?? ''),
      };
    },

    /** The "Episode …" list of the series page, newest first as the site has it. */
    async getEpisodes(anime: AnimeSummary): Promise<Episode[]> {
      const { doc, url } = await seriesPage(anime);
      const episodes: Episode[] = [];
      const seen = new Set<string>();
      for (const a of doc.select('.bxcl .lchx a[href]')) {
        const path = entityPath(a.attr('href') ?? '', url);
        if (seen.has(path)) continue;
        seen.add(path);
        const name = collapse(a.text());
        const number = episodeNumber(name, path);
        episodes.push({
          url: path,
          name: name || `Episode ${number ?? ''}`.trim(),
          ...(number !== undefined && { number }),
        });
      }
      if (episodes.length === 0) throw new NotFoundError('This series has no episodes yet');
      return episodes.sort((a, b) => (b.number ?? 0) - (a.number ?? 0));
    },

    getStreams: async (episode: Episode) => labelPlaylists(await getStreams(episode)),

    resolveUrl(url: string): AnimeSummary | null {
      const match = /^https?:\/\/(?:www\.)?kuronime\.[a-z]+\/anime\/([^/?#]+)\/?/i.exec(url);
      const slug = match?.[1];
      return slug ? { url: `/anime/${slug}/`, title: slug.replace(/-/g, ' ') } : null;
    },

    getWebUrl: (item: AnimeSummary | Episode) => `${base()}${item.url.split(/[?#]/)[0]}`,
  }),
});
