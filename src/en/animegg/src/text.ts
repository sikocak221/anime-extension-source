// Pure helpers: no host globals, so they can be unit-tested directly.

export const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** The identity of an anime: "/series/<slug>". Anything else (an episode page, a genre) is not one. */
export function seriesPath(href: string, base: string): string | undefined {
  const url = new URL(href, `${base}/`);
  const slug = /^\/series\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  return slug ? `/series/${slug}` : undefined;
}

export type Version = 'subbed' | 'dubbed';

/** "/dragonball-z-episode-291#dubbed" -> the page path and the version asked for. */
export function splitEpisodeUrl(url: string): { path: string; version?: Version } {
  const hash = url.indexOf('#');
  const path = hash < 0 ? url : url.slice(0, hash);
  const wanted = hash < 0 ? '' : url.slice(hash + 1);
  return wanted === 'subbed' || wanted === 'dubbed' ? { path, version: wanted } : { path };
}

/** An episode page is "/<slug>-episode-<n>"; the number is what follows "-episode-". */
export function episodeNumber(path: string): number | undefined {
  const match = /-episode-(\d+(?:\.\d+)?)(?:-\d+)*$/.exec(path.split('#')[0] ?? '');
  return match?.[1] === undefined ? undefined : Number.parseFloat(match[1]);
}

export interface VideoSource {
  /** Path or URL of the file, still relative to the site. */
  file: string;
  /** Height in pixels. */
  quality?: number;
}

/** The `videoSources = [{file: "...", label: "480p", ...}]` array of an embed page. */
export function readVideoSources(page: string): VideoSource[] {
  const start = page.indexOf('videoSources');
  if (start < 0) return [];
  const end = page.indexOf('];', start);
  const block = page.slice(start, end < 0 ? undefined : end);
  const sources: VideoSource[] = [];
  for (const m of block.matchAll(/\{\s*file:\s*"([^"]+)"(?:,\s*label:\s*"([^"]*)")?/g)) {
    const height = /(\d{3,4})p/i.exec(m[2] ?? '')?.[1];
    sources.push({ file: (m[1] as string).replace(/\\\//g, '/'), ...(height && { quality: Number(height) }) });
  }
  return sources;
}

/** "1 - 25 of 11304 Shows": whether more follow. Undefined when the text is not a range. */
export function hasMore(text: string): boolean | undefined {
  const m = /\d+\s*-\s*(\d+)\s+of\s+(\d+)/i.exec(text);
  return m ? Number(m[1]) < Number(m[2]) : undefined;
}
