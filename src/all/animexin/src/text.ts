// Pure helpers: no host globals except `URL`, so they can be unit-tested directly.
import type { AnimeStatus, AnimeType } from '@matane-anime/extension-sdk';

/** The identity of an anime or an episode: its path on the site, with a trailing slash and no host or query. */
export function entityPath(href: string, base: string): string {
  const { pathname } = new URL(href, `${base}/`);
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

export const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

export const STATUSES: Record<string, AnimeStatus> = {
  ongoing: 'ongoing',
  completed: 'completed',
  hiatus: 'hiatus',
};

export const TYPES: Record<string, AnimeType> = {
  tv: 'tv',
  bd: 'tv',
  movie: 'movie',
  ova: 'ova',
  ona: 'ona',
  special: 'special',
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "October 10, 2026" or "Dec 28, 2025" to epoch ms (UTC midnight); undefined when it is not a date we know. */
export function parseEpisodeDate(text: string): number | undefined {
  const match = /^([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})$/.exec(collapse(text));
  const month = match ? MONTHS.indexOf((match[1] as string).slice(0, 3).toLowerCase()) : -1;
  if (!match || month < 0) return undefined;
  const time = Date.UTC(Number(match[3]), month, Number(match[2]));
  return Number.isFinite(time) && time >= 0 ? time : undefined;
}

/** The year of "Dec 28, 2025". */
export function releaseYear(text: string | undefined): number | undefined {
  const year = Number(/\b(\d{4})\b/.exec(text ?? '')?.[1]);
  return year >= 1900 && year <= 2200 ? year : undefined;
}

/**
 * "Beyond Time's Gaze Episode 43 Subtitle" to "Episode 43". Falls back to "Episode <n>" from the number cell,
 * or to the cleaned title. Strips the "Subtitle" / "Indonesia, English Sub" tails the site appends.
 */
export function episodeName(title: string, num: string): string {
  const text = collapse(title)
    .replace(/\s*(?:Indonesia,?\s*English\s*Sub(?:title)?|Subtitle(?:\s+(?:Indonesia|English))*|Sub)\s*$/i, '')
    .trim();
  const tail = /\b(?:Special|OVA|Movie)\b.*$|\bEpisode\s+\d+(?:\.\d+)?.*$/i.exec(text);
  return tail ? tail[0] : /^\d+(?:\.\d+)?$/.test(num) ? `Episode ${num}` : text || num;
}

/** Episode number from the list's number cell ("43", "12.5"); "Movie" and the like have none. */
export function parseNumber(text: string): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*$/.exec(text);
  return match ? Number.parseFloat(match[1] as string) : undefined;
}
