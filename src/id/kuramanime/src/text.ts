// Pure helpers: no host globals except `URL`, so they can be unit-tested directly.
import type { AnimeStatus, AnimeType } from '@matane-anime/extension-sdk';

/** The identity of a page: its path on the site, with no host, query, fragment or trailing slash. */
export function entityPath(href: string, base: string): string {
  const { pathname } = new URL(href, `${base}/`);
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

export const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** A series page path: `/anime/<numeric id>/<slug>`. */
export const isSeriesPath = (path: string): boolean => /^\/anime\/\d+\/[^/]+$/.test(path);

/** An episode page path: `/anime/<numeric id>/<slug>/episode/<n>`. */
export const isEpisodePath = (path: string): boolean => /^\/anime\/\d+\/[^/]+\/episode\/\d+(?:\.\d+)?$/.test(path);

/** The number at the end of an episode path (`.../episode/12` is 12). */
export function episodeNumber(path: string): number | undefined {
  const match = /\/episode\/(\d+(?:\.\d+)?)$/.exec(path);
  return match ? Number.parseFloat(match[1] as string) : undefined;
}

/** Sorting of the catalogue (`order_by`), site value and label. */
export const ORDERS: [string, string][] = [
  ['updated', 'Latest update'],
  ['latest', 'Newest'],
  ['popular', 'Top rated'],
  ['most_viewed', 'Most viewed'],
  ['ascending', 'A-Z'],
  ['descending', 'Z-A'],
  ['oldest', 'Oldest'],
];

/** The quick lists of the site (`/quick/<value>`). */
export const CATEGORIES: [string, string][] = [
  ['ongoing', 'Airing'],
  ['finished', 'Finished'],
  ['movie', 'Movies'],
  ['upcoming', 'Upcoming'],
  ['donghua', 'Donghua'],
];

/** The genres of `/properties/genre/<slug>`, without the adult-only ones. */
export const GENRES: [string, string][] = [
  ['action', 'Action'],
  ['adult-cast', 'Adult Cast'],
  ['adventure', 'Adventure'],
  ['anthropomorphic', 'Anthropomorphic'],
  ['avant-garde', 'Avant Garde'],
  ['award-winning', 'Award Winning'],
  ['boys-love', 'Boys Love'],
  ['cgdct', 'CGDCT'],
  ['childcare', 'Childcare'],
  ['combat-sports', 'Combat Sports'],
  ['comedy', 'Comedy'],
  ['crossdressing', 'Crossdressing'],
  ['delinquents', 'Delinquents'],
  ['detective', 'Detective'],
  ['drama', 'Drama'],
  ['ecchi', 'Ecchi'],
  ['educational', 'Educational'],
  ['fantasy', 'Fantasy'],
  ['gag-humor', 'Gag Humor'],
  ['girls-love', 'Girls Love'],
  ['gore', 'Gore'],
  ['gourmet', 'Gourmet'],
  ['harem', 'Harem'],
  ['high-stakes-game', 'High Stakes Game'],
  ['historical', 'Historical'],
  ['horror', 'Horror'],
  ['idols-female', 'Idols (Female)'],
  ['idols-male', 'Idols (Male)'],
  ['isekai', 'Isekai'],
  ['iyashikei', 'Iyashikei'],
  ['josei', 'Josei'],
  ['kids', 'Kids'],
  ['love-polygon', 'Love Polygon'],
  ['love-status-quo', 'Love Status Quo'],
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
  ['psychological', 'Psychological'],
  ['racing', 'Racing'],
  ['reincarnation', 'Reincarnation'],
  ['reverse-harem', 'Reverse Harem'],
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
  ['time-travel', 'Time Travel'],
  ['urban-fantasy', 'Urban Fantasy'],
  ['vampire', 'Vampire'],
  ['video-game', 'Video Game'],
  ['villainess', 'Villainess'],
  ['visual-arts', 'Visual Arts'],
  ['workplace', 'Workplace'],
];

export function parseStatus(text: string): AnimeStatus {
  const value = text.toLowerCase();
  if (value.includes('sedang') || value.includes('ongoing')) return 'ongoing';
  if (value.includes('selesai') || value.includes('completed') || value.includes('finished')) return 'completed';
  return 'unknown';
}

export function parseType(text: string): AnimeType | undefined {
  const value = text.toLowerCase().trim();
  if (value === 'movie') return 'movie';
  if (value === 'ova') return 'ova';
  if (value === 'ona') return 'ona';
  if (value === 'special') return 'special';
  if (value === 'tv') return 'tv';
  return undefined;
}

export function parseYear(text: string | undefined): number | undefined {
  const year = Number(/\b(\d{4})\b/.exec(text ?? '')?.[1]);
  return year >= 1900 && year <= 2200 ? year : undefined;
}

/** `Set-Cookie` header(s) as the host joins them (", ") → a `Cookie` header value (name=value pairs only). */
export function cookieHeader(setCookie: string | undefined): string {
  if (!setCookie) return '';
  const pairs: string[] = [];
  for (const part of setCookie.split(/,\s*(?=[^;,=\s]+=)/)) {
    const pair = part.split(';')[0]?.trim() ?? '';
    if (/^[^=\s]+=/.test(pair)) pairs.push(pair);
  }
  return pairs.join('; ');
}
