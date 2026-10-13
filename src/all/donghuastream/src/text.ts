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

/** "October 10, 2026" or "Jul 31, 2022" to epoch ms (UTC midnight); undefined when it is not a date we know. */
export function parseEpisodeDate(text: string): number | undefined {
  const match = /^([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})$/.exec(collapse(text));
  const month = match ? MONTHS.indexOf((match[1] as string).slice(0, 3).toLowerCase()) : -1;
  if (!match || month < 0) return undefined;
  const time = Date.UTC(Number(match[3]), month, Number(match[2]));
  return Number.isFinite(time) && time >= 0 ? time : undefined;
}

/** The year of "Jul 31, 2022". */
export function releaseYear(text: string | undefined): number | undefined {
  const year = Number(/\b(\d{4})\b/.exec(text ?? '')?.[1]);
  return year >= 1900 && year <= 2200 ? year : undefined;
}

/**
 * The site's number cell is free text: "213 (Good Sub)(4K)+(Download Link)", "214-215 Preview", "Part 2 (Good Sub)".
 * "Episode 213" / "Part 2" (plus "(Preview)" when announced); anything else falls back to the cleaned title.
 */
export function episodeName(title: string, num: string): string {
  const label = collapse(num);
  const lead = /^(\d+(?:\.\d+)?)/.exec(label)?.[1];
  const part = /^Part\s+(\d+)/i.exec(label)?.[0];
  const preview = /\bPreview\b/i.test(label) ? ' (Preview)' : '';
  if (lead) return `Episode ${lead}${preview}`;
  if (part) return collapse(part);
  return (
    collapse(title)
      .replace(/\s*Multiple\s+Subtitles?.*$/i, '')
      .trim() || label
  );
}

/** Episode number from the number cell: its leading number ("213 (Good Sub)" is 213, "Part 2" is 2). */
export function parseNumber(text: string): number | undefined {
  const match = /^\s*(?:Part\s+)?(\d+(?:\.\d+)?)/i.exec(text);
  return match ? Number.parseFloat(match[1] as string) : undefined;
}
