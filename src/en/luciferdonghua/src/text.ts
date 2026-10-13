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
  donghua: 'tv',
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
 * "Jade Dynasty Episode 10 English Sub" to "Episode 10". Falls back to "Episode <n>" from the number cell,
 * or to the cleaned title. Strips the "Subtitle" / "Indonesia, English Sub" tails the site appends.
 */
export function episodeName(title: string, num: string): string {
  const text = collapse(title)
    .replace(/\s*(?:(?:Indonesia,?\s*)?English\s*Sub(?:title)?|Subtitle(?:\s+(?:Indonesia|English))*|Sub)\s*$/i, '')
    .trim();
  const numbered = /\bEpisode\s+\d+(?:\.\d+)?.*$/i.exec(text);
  if (numbered) return numbered[0];
  if (/^\d+(?:\.\d+)?$/.test(num)) return `Episode ${num}`;
  // "Part-2" of a film, "Special", "OVA": the number cell says it better than the long title.
  if (/^(?:Part[- ]?\d+|Special|OVA|Movie)\b/i.test(num)) return num;
  return /\b(?:Special|OVA|Movie)\b.*$/i.exec(text)?.[0] ?? (text || num);
}

/** Episode number from the list's number cell ("43", "12.5", "10 [4K]"); "Movie" and the like have none. */
export function parseNumber(text: string): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(?:\[[^\]]*\]\s*)*$/.exec(text);
  return match ? Number.parseFloat(match[1] as string) : undefined;
}
