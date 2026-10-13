// Pure helpers: no host globals except `URL`, so they can be unit-tested directly.
import type { AnimeStatus, AnimeType } from '@matane-anime/extension-sdk';

/** The identity of a page: its path on the site, with a trailing slash and no host, query or fragment. */
export function entityPath(href: string, base: string): string {
  const { pathname } = new URL(href, `${base}/`);
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

export const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

export const STATUSES: [string, string][] = [
  ['ongoing', 'Ongoing'],
  ['completed', 'Completed'],
];

export const TYPES: [string, string][] = [
  ['TV', 'TV Series'],
  ['Movie', 'Movie'],
  ['OVA', 'OVA'],
  ['ONA', 'ONA'],
  ['Special', 'Special'],
  ['Live Action', 'Live Action'],
  ['Music', 'Music'],
];

export const ORDERS: [string, string][] = [
  ['popular', 'Popular'],
  ['update', 'Latest update'],
  ['latest', 'Latest added'],
  ['title', 'A-Z'],
  ['titlereverse', 'Z-A'],
];

/** The genres of the catalogue filter (slug, label), without the explicit ones and the duplicates. */
export const GENRES: [string, string][] = [
  ['action', 'Action'],
  ['adult-cast', 'Adult Cast'],
  ['adventure', 'Adventure'],
  ['animation', 'Animation'],
  ['avant-garde', 'Avant Garde'],
  ['award-winning', 'Award Winning'],
  ['boys-love', 'Boys Love'],
  ['cgdct', 'CGDCT'],
  ['childcare', 'Childcare'],
  ['combat-sports', 'Combat Sports'],
  ['comedy', 'Comedy'],
  ['crime', 'Crime'],
  ['crossdressing', 'Crossdressing'],
  ['cultivation', 'Cultivation'],
  ['delinquents', 'Delinquents'],
  ['demons', 'Demons'],
  ['detective', 'Detective'],
  ['donghua', 'Donghua'],
  ['drama', 'Drama'],
  ['ecchi', 'Ecchi'],
  ['educational', 'Educational'],
  ['family', 'Family'],
  ['fantasy', 'Fantasy'],
  ['fighting', 'Fighting'],
  ['gag-humor', 'Gag Humor'],
  ['game', 'Game'],
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
  ['magic', 'Magic'],
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
  ['police', 'Police'],
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
  ['shoujo-ai', 'Shoujo Ai'],
  ['shounen', 'Shounen'],
  ['shounen-ai', 'Shounen Ai'],
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
  ['thriller', 'Thriller'],
  ['time-travel', 'Time Travel'],
  ['tokusatsu', 'Tokusatsu'],
  ['urban-fantasy', 'Urban Fantasy'],
];

export function parseStatus(text: string): AnimeStatus {
  const value = text.toLowerCase();
  if (value.includes('ongoing')) return 'ongoing';
  if (value.includes('completed') || value.includes('tamat') || value.includes('finished')) return 'completed';
  return 'unknown';
}

export function parseType(text: string): AnimeType | undefined {
  const value = text.toLowerCase();
  if (value.includes('movie')) return 'movie';
  if (value.includes('ova')) return 'ova';
  if (value.includes('ona')) return 'ona';
  if (value.includes('special')) return 'special';
  if (value.includes('tv')) return 'tv';
  return undefined;
}

export function parseYear(text: string | undefined): number | undefined {
  const year = Number(/\b(\d{4})\b/.exec(text ?? '')?.[1]);
  return year >= 1900 && year <= 2200 ? year : undefined;
}

/** The poster without the image proxy's resize query (`?resize=145,207`), which asks for a thumbnail. */
export function posterUrl(src: string | undefined): string | undefined {
  if (!src || !/^https?:\/\//i.test(src)) return undefined;
  return src.replace(/\?resize=[\d,]+$/, '');
}

/** The number of an episode: "Episode 13 END" → 13, else the end of its path (`-episode-12-5/` is 12.5). */
export function episodeNumber(label: string, path: string): number | undefined {
  const fromLabel = /\bEpisode\s+(\d+(?:\.\d+)?)/i.exec(label)?.[1];
  if (fromLabel) return Number.parseFloat(fromLabel);
  const match = /-episode-(\d+)(?:-(\d+))?\/?$/.exec(path);
  if (!match) return undefined;
  return Number.parseFloat(match[2] ? `${match[1]}.${match[2]}` : (match[1] as string));
}

/** An episode page path: `/nonton-<slug>-episode-<n>/`. */
export const isEpisodePath = (path: string): boolean => /^\/nonton-[^/]+\/?$/.test(path);
