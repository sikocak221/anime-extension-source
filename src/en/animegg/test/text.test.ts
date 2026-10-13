import { describe, expect, it } from 'vitest';
import { episodeNumber, hasMore, readVideoSources, seriesPath, splitEpisodeUrl } from '../src/text';

describe('text helpers', () => {
  it('reads series paths only', () => {
    expect(seriesPath('/series/one-piece', 'https://www.animegg.org')).toBe('/series/one-piece');
    expect(seriesPath('https://www.animegg.org/series/naruto/', 'https://www.animegg.org')).toBe('/series/naruto');
    expect(seriesPath('/series/naruto/latest-episode', 'https://www.animegg.org')).toBeUndefined();
    expect(seriesPath('/detectiveconan-episode-1', 'https://www.animegg.org')).toBeUndefined();
  });

  it('splits the version off an episode url', () => {
    expect(splitEpisodeUrl('/a-episode-1#dubbed')).toEqual({ path: '/a-episode-1', version: 'dubbed' });
    expect(splitEpisodeUrl('/a-episode-1#subbed')).toEqual({ path: '/a-episode-1', version: 'subbed' });
    expect(splitEpisodeUrl('/a-episode-1')).toEqual({ path: '/a-episode-1' });
  });

  it('reads episode numbers', () => {
    expect(episodeNumber('/detectiveconan-episode-1215')).toBe(1215);
    expect(episodeNumber('/x-episode-12.5#subbed')).toBe(12.5);
    expect(episodeNumber('/all-out-episode-7-7951-4862')).toBe(7);
    expect(episodeNumber('/genre/action')).toBeUndefined();
  });

  it('reads video sources', () => {
    const page =
      'var videoSources = [{file: "/play/1/video.mp4?for=2", label: "720p", bk: "", isBk: false },{file: "/play/3/video.mp4", label: "SD"}];';
    expect(readVideoSources(page)).toEqual([
      { file: '/play/1/video.mp4?for=2', quality: 720 },
      { file: '/play/3/video.mp4' },
    ]);
    expect(readVideoSources('nothing')).toEqual([]);
  });

  it('knows when more pages follow', () => {
    expect(hasMore('1 - 25 of 11304 Shows')).toBe(true);
    expect(hasMore('2776 - 2791 of 2791 Shows')).toBe(false);
    expect(hasMore('1 - 10')).toBeUndefined();
  });
});
