// Pure helpers: no host globals except `URL`, so they can be unit-tested directly.
import type { AnimeStatus, AnimeType } from '@matane-anime/extension-sdk';

export const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** The identity of an anime or an episode: its path on the site, with a trailing slash and no host or query. */
export function entityPath(href: string, base: string): string {
  const { pathname } = new URL(href, `${base}/`);
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

/** The page of an anime is `/anime/<slug>/`; an episode is `/<slug>/`. */
export const animePath = (slug: string): string => `/anime/${slug}/`;
export const episodePath = (slug: string): string => `/${slug}/`;
export const slugOf = (path: string): string => path.replace(/^\/(?:anime\/)?|\/+$/g, '');

/** The page title is "<title> Subtitle Indonesia"; the title is what comes before. */
export const cleanTitle = (title: string): string => collapse(title).replace(/\s+Sub(?:title)?\s+Indo(?:nesia)?$/i, '');

export function parseStatus(text: string): AnimeStatus {
  const value = text.toLowerCase();
  if (value.includes('ongoing')) return 'ongoing';
  if (value.includes('completed')) return 'completed';
  return 'unknown';
}

export function parseType(text: string): AnimeType | undefined {
  const value = text.trim().toLowerCase();
  if (value === 'tv') return 'tv';
  if (value === 'movie') return 'movie';
  if (value === 'ova') return 'ova';
  if (value === 'ona') return 'ona';
  if (value === 'special') return 'special';
  return undefined;
}

export function parseYear(text: string | undefined): number | undefined {
  const year = Number(/\b(\d{4})\b/.exec(text ?? '')?.[1]);
  return year >= 1900 && year <= 2200 ? year : undefined;
}

/**
 * The number of an episode: the end of its name ("… Episode 12", with or without the " Subtitle Indonesia" the page
 * adds to some), or else the one in its address ("…-episode-12-subtitle-indonesia").
 */
export function episodeNumber(label: string, path?: string): number | undefined {
  const fromLabel = /(\d+(?:\.\d+)?)\s*$/.exec(cleanTitle(label))?.[1];
  const fromPath = /episode-(\d+)(?!.*episode-\d)/.exec(path ?? '')?.[1];
  const value = fromLabel ?? fromPath;
  return value === undefined ? undefined : Number.parseFloat(value);
}

/**
 * Images are served through `/_next/image/?url=<path>&w=…`, which resizes to the largest width (3840) when the
 * page asks for none. The original is on the site itself (or on its image host), so it is read from the `url` param.
 */
export function imageUrl(src: string | undefined, base: string): string | undefined {
  if (!src || src.startsWith('data:')) return undefined;
  try {
    const url = new URL(src, `${base}/`);
    if (url.pathname.startsWith('/_next/image')) {
      const original = url.searchParams.get('url');
      return original ? new URL(original, `${base}/`).href : undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

/** A mirror's label ("720p") as a height; anything else (a name, "Default") names none. */
export function qualityOf(label: string | null | undefined): number | undefined {
  const height = Number(/^(\d{3,4})p?$/i.exec((label ?? '').trim())?.[1]);
  return height >= 144 && height <= 4320 ? height : undefined;
}

/** "One Piece Episode 1180" → "Episode 1180": the anime's name is already on the page. Other labels are kept. */
export function episodeName(label: string, number: number | undefined): string {
  const clean = cleanTitle(label);
  const tail = /\bEpisode\s+(\d+(?:\.\d+)?)$/i.exec(clean)?.[1];
  if (tail) return `Episode ${tail}`;
  return clean || (number !== undefined ? `Episode ${number}` : 'Episode');
}
