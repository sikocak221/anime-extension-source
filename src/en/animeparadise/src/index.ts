import '@matane-anime/extension-sdk/globals';
import {
  type AnimeDetails,
  type AnimePage,
  type AnimeSummary,
  type AnimeType,
  type Episode,
  type Filter,
  type FilterState,
  type HttpResponse,
  type Stream,
  CloudflareError,
  HttpError,
  NotFoundError,
  ParseError,
  RateLimitedError,
  defineExtension,
} from '@matane-anime/extension-sdk';

// animeparadise.moe is a Next.js front over a public JSON API (api.animeparadise.moe); the API is what is read.
//  - anime url:   the slug (`link`), e.g. "boruto-naruto-next-generations"
//  - episode url: "<anime _id>/<episode uid>" (the API lists episodes by _id and resolves a stream by uid + origin)
// A stream is an HLS master playlist served by stream.animeparadise.moe; it needs no Referer.

const WEB_URL = 'https://www.animeparadise.moe';
const API_URL = 'https://api.animeparadise.moe';
const STREAM_URL = 'https://stream.animeparadise.moe';

const PAGE_SIZE = 20;

const GENRES = [
  'Action',
  'Adventure',
  'Comedy',
  'Drama',
  'Ecchi',
  'Fantasy',
  'Horror',
  'Mahou Shojo',
  'Mecha',
  'Music',
  'Mystery',
  'Psychological',
  'Romance',
  'Sci-Fi',
  'Slice of Life',
  'Sports',
  'Supernatural',
  'Thriller',
];
const SEASONS = ['Winter', 'Spring', 'Summer', 'Fall'];
const SORTS: [value: string, label: string][] = [
  ['POPULARITY', 'Popularity'],
  ['POST_DATE', 'Recently updated'],
  ['RELEASE_DATE', 'Release date'],
];
const FIRST_YEAR = 1960;

const TYPES: Record<string, AnimeType> = { tv: 'tv', movie: 'movie', ova: 'ova', ona: 'ona', special: 'special' };

interface Images {
  large?: string;
  medium?: string;
  small?: string;
  original?: string;
}
interface AnimeItem {
  _id?: string;
  title?: string;
  link?: string;
  type?: string;
  synopsys?: string | null;
  genres?: string[] | null;
  animeSeason?: { season?: string; year?: number } | null;
  posterImage?: Images | null;
  alternativeTitle?: { english?: string | null; native?: string | null; romaji?: string | null } | null;
}
interface Envelope<T> {
  success?: boolean;
  error?: unknown;
  data?: T;
  pagination?: { hasNext?: boolean };
  message?: string;
}
interface EpisodeItem {
  uid?: string;
  title?: string | null;
  number?: string | number | null;
  streamLink?: string | null;
}
interface EpisodeAnswer {
  episode?: EpisodeItem | null;
}

function assertOk(response: HttpResponse, url: string): void {
  if (response.status < 400) return;
  const challenge =
    response.headers['cf-mitigated'] === 'challenge' ||
    ((response.status === 403 || response.status === 503) &&
      /Just a moment|cf-browser-verification/i.test(response.text));
  if (challenge) throw new CloudflareError('The site is behind a Cloudflare challenge');
  if (response.status === 404) throw new NotFoundError(`Not found: ${url}`);
  if (response.status === 429) throw new RateLimitedError('Rate limited by AnimeParadise');
  throw new HttpError(response.status, `HTTP ${response.status} for ${url}`);
}

/** GETs an API path and parses the envelope; a missing record (`error: true`, even with HTTP 200) is a NotFoundError. */
async function api<T>(path: string, params?: [string, string | number][]): Promise<Envelope<T>> {
  const query = new URLSearchParams();
  for (const [key, value] of params ?? []) query.append(key, String(value));
  const qs = query.toString();
  const url = `${API_URL}${path}${qs ? `?${qs}` : ''}`;
  const response = await http.get(url, { throwOnError: false });
  assertOk(response, url);
  let body: Envelope<T>;
  try {
    body = response.json<Envelope<T>>();
  } catch {
    throw new ParseError('The API did not answer JSON: the site changed');
  }
  if (body.success === false || body.error === true) throw new NotFoundError(body.message ?? `Not found: ${url}`);
  return body;
}

const poster = (item: AnimeItem): string | undefined =>
  item.posterImage?.large || item.posterImage?.medium || item.posterImage?.original || item.posterImage?.small;

function summary(item: AnimeItem | null | undefined): AnimeSummary {
  if (!item?.link || !item.title) throw new ParseError('An anime has no link or title: the site changed');
  const thumbnailUrl = poster(item);
  return { url: item.link, title: item.title.trim(), ...(thumbnailUrl && { thumbnailUrl }) };
}

async function listing(params: [string, string | number][], page: number): Promise<AnimePage> {
  const body = await api<AnimeItem[]>('/search', [...params, ['page', page], ['limit', PAGE_SIZE]]);
  if (!Array.isArray(body.data)) throw new ParseError('The API list has no "data": the site changed');
  const seen = new Set<string>();
  const items = body.data.map(summary).filter((item) => !seen.has(item.url) && !!seen.add(item.url));
  return { items, hasNextPage: body.pagination?.hasNext === true };
}

/** The synopsis arrives with the odd tag or entity; the player shows plain text. */
function cleanText(text: string | null | undefined): string | undefined {
  const clean = (text ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return clean || undefined;
}

interface MasterVariant {
  url: string;
  height: number;
}

/** The `#EXT-X-STREAM-INF` entries of a master playlist that name a resolution, tallest first, one per height. */
function parseMasterVariants(master: string, baseUrl: string): MasterVariant[] {
  const lines = master.split(/\r?\n/).map((line) => line.trim());
  const byHeight = new Map<number, MasterVariant>();
  lines.forEach((line, index) => {
    if (!line.startsWith('#EXT-X-STREAM-INF:')) return;
    const height = Number(/RESOLUTION=\d+x(\d+)/i.exec(line)?.[1]);
    const next = lines.slice(index + 1).find((candidate) => candidate !== '' && !candidate.startsWith('#'));
    if (!height || !next) return;
    try {
      byHeight.set(height, { url: new URL(next, baseUrl).href, height });
    } catch {
      // A line that is not an address is not a variant.
    }
  });
  return [...byHeight.values()].sort((a, b) => b.height - a.height);
}

function splitEpisodeUrl(url: string): { origin: string; uid: string } {
  const at = url.indexOf('/');
  const origin = at < 0 ? '' : url.slice(0, at);
  const uid = at < 0 ? '' : url.slice(at + 1);
  if (!origin || !uid) throw new NotFoundError(`Not an AnimeParadise episode: ${url}`);
  return { origin, uid };
}

export default defineExtension({
  createSource: () => ({
    baseUrl: WEB_URL,

    getPopular: (page: number) => listing([['sort', 'POPULARITY']], page),

    getLatest: (page: number) => listing([['sort', 'POST_DATE']], page),

    search(query: string, page: number, filters: FilterState): Promise<AnimePage> {
      const params: [string, string | number][] = [];
      const q = query.trim();
      if (q) params.push(['q', q]);
      for (const genre of GENRES) if (filters[`genre:${genre}`] === true) params.push(['genres', genre]);
      const season = filters['season'];
      if (typeof season === 'string' && SEASONS.includes(season)) params.push(['season', season]);
      const year = filters['year'];
      if (typeof year === 'string' && /^\d{4}$/.test(year)) params.push(['year', year]);
      const sort = filters['sort'];
      if (typeof sort === 'string' && SORTS.some(([value]) => value === sort)) params.push(['sort', sort]);
      return listing(params, page);
    },

    getFilters(): Filter[] {
      const thisYear = new Date().getFullYear();
      const years = [];
      for (let year = thisYear + 1; year >= FIRST_YEAR; year--)
        years.push({ value: String(year), label: String(year) });
      return [
        {
          type: 'select',
          id: 'sort',
          label: 'Sort by',
          options: SORTS.map(([value, label]) => ({ value, label })),
          default: 'POPULARITY',
        },
        {
          type: 'select',
          id: 'season',
          label: 'Season',
          options: [{ value: '', label: 'Any' }, ...SEASONS.map((s) => ({ value: s, label: s }))],
          default: '',
        },
        { type: 'select', id: 'year', label: 'Year', options: [{ value: '', label: 'Any' }, ...years], default: '' },
        {
          type: 'group',
          id: 'genres',
          label: 'Genres (all of them)',
          filters: GENRES.map((genre) => ({ type: 'checkbox' as const, id: `genre:${genre}`, label: genre })),
        },
      ];
    },

    async getAnimeDetails(anime: AnimeSummary): Promise<AnimeDetails> {
      const { data } = await api<AnimeItem>(`/anime/${encodeURIComponent(anime.url)}`);
      const { title, thumbnailUrl } = summary(data);
      const alt = data?.alternativeTitle;
      const altTitles = [alt?.english, alt?.romaji, alt?.native]
        .map((t) => t?.trim() ?? '')
        .filter((t, i, all) => t !== '' && t !== title && all.indexOf(t) === i);
      return {
        url: anime.url,
        title,
        thumbnailUrl,
        altTitles: altTitles.length > 0 ? altTitles : undefined,
        description: cleanText(data?.synopsys),
        genres: data?.genres?.length ? data.genres : undefined,
        year: data?.animeSeason?.year || undefined,
        // The API publishes no airing status.
        status: 'unknown',
        type: TYPES[(data?.type ?? '').toLowerCase()],
      };
    },

    /** The API lists oldest first; the contract is newest first. */
    async getEpisodes(anime: AnimeSummary): Promise<Episode[]> {
      // Episodes are listed by the anime _id, not by its slug.
      const details = await api<AnimeItem>(`/anime/${encodeURIComponent(anime.url)}`);
      const id = details.data?._id;
      if (!id) throw new ParseError('The anime has no _id: the site changed');
      const list = await api<EpisodeItem[]>(`/anime/${encodeURIComponent(id)}/episode`);
      if (!Array.isArray(list.data)) throw new ParseError('The episode list has no "data": the site changed');
      const seen = new Set<string>();
      const episodes: Episode[] = [];
      for (const item of list.data) {
        if (!item.uid || seen.has(item.uid)) continue;
        seen.add(item.uid);
        const label = String(item.number ?? '').trim();
        const number = parseFloat(label);
        episodes.push({
          url: `${id}/${item.uid}`,
          name: item.title?.trim() || (label ? `Episode ${label}` : 'Episode'),
          ...(Number.isFinite(number) && { number }),
        });
      }
      return episodes.reverse();
    },

    /**
     * `/ep/<uid>?origin=<id>` carries an opaque `streamLink`; `stream.animeparadise.moe/m3u8?url=<streamLink>` is an HLS
     * master playlist (1080p/720p/480p) that needs no Referer. The master is returned plus each height on its own, so
     * the player can offer a choice of resolution.
     */
    async getStreams(episode: Episode): Promise<Stream[]> {
      const { origin, uid } = splitEpisodeUrl(episode.url);
      const body = await api<EpisodeAnswer>(`/ep/${encodeURIComponent(uid)}`, [['origin', origin]]);
      const link = body.data?.episode?.streamLink;
      if (!link) throw new NotFoundError('The episode has no stream');
      const master = `${STREAM_URL}/m3u8?url=${link}`;
      const response = await http.get(master, { throwOnError: false });
      assertOk(response, master);
      const variants = parseMasterVariants(response.text, master);
      if (!response.text.includes('#EXTM3U')) throw new ParseError('The stream is not a playlist: the site changed');
      return [
        // The master adapts to the connection; it is named apart from the fixed heights below and labelled with the tallest.
        {
          url: master,
          server: 'AnimeParadise (auto)',
          kind: 'hls',
          ...(variants[0] && { quality: variants[0].height }),
        },
        ...variants.map((variant) => ({
          url: variant.url,
          server: 'AnimeParadise',
          kind: 'hls' as const,
          quality: variant.height,
        })),
      ];
    },

    resolveUrl(url: string): AnimeSummary | null {
      const match = /^https?:\/\/(?:www\.)?animeparadise\.moe\/anime\/([^/?#]+)/i.exec(url);
      const slug = match?.[1];
      return slug ? { url: slug, title: slug.replace(/-/g, ' ') } : null;
    },

    getWebUrl(item: AnimeSummary | Episode): string {
      const at = item.url.indexOf('/');
      return at < 0
        ? `${WEB_URL}/anime/${item.url}`
        : `${WEB_URL}/watch/${item.url.slice(at + 1)}?origin=${item.url.slice(0, at)}`;
    },
  }),
});
