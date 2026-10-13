import { describe, expect, it } from 'vitest';
import {
  entityPath,
  episodeNumbers,
  episodeUrl,
  labelHeight,
  parseStatus,
  parseType,
  parseYear,
  posterUrl,
  splitEpisodeUrl,
} from '../src/text';

describe('episodeNumbers', () => {
  it('reads the numbers of the grid, once each, and nothing outside it', () => {
    const page =
      '<a href="#episode_9">9</a><div class="episode-grid"><a href="#episode_1">1</a><a href="#episode_2.5">2.5</a>' +
      '<a href="#episode_1">1</a></div><a href="#episode_3">3</a>';
    expect(episodeNumbers(page)).toEqual([1, 2.5]);
  });

  it('reads a grid of a thousand episodes inside a page of several megabytes', () => {
    const grid = Array.from({ length: 1200 }, (_, i) => `<a href="#episode_${i + 1}" title="x">${i + 1}</a>`).join('');
    const page = `<h1>One Piece</h1>${'x'.repeat(5_000_000)}<div class="episode-grid">${grid}</div>`;
    const numbers = episodeNumbers(page);
    expect(numbers).toHaveLength(1200);
    expect(numbers[1199]).toBe(1200);
  });

  it('is empty without a grid', () => {
    expect(episodeNumbers('<h1>X</h1>')).toEqual([]);
  });
});

describe('text helpers', () => {
  it('keeps series paths with a trailing slash and no fragment', () => {
    expect(entityPath('/dandadan-sub-indo/#episode-3', 'https://nimegami.id')).toBe('/dandadan-sub-indo/');
    expect(entityPath('https://nimegami.com/x-sub-indo', 'https://nimegami.id')).toBe('/x-sub-indo/');
  });
  it('builds and splits episode urls, fractions included', () => {
    expect(episodeUrl('/x-sub-indo/', 3)).toBe('/x-sub-indo/#episode-3');
    expect(splitEpisodeUrl('/x-sub-indo/#episode-12.5')).toEqual({ series: '/x-sub-indo/', number: 12.5 });
    expect(splitEpisodeUrl('/x-sub-indo/')).toBeUndefined();
  });
  it('unwraps the resizing proxy of posters', () => {
    const src = '/_next/image/?url=%2Fassets%2Fanime-data%2Fimages%2Fposters%2Fabc.jpg&w=3840&q=75';
    expect(posterUrl('https://nimegami.id', src)).toBe('https://nimegami.id/assets/anime-data/images/posters/abc.jpg');
    expect(posterUrl('https://nimegami.id', '/assets/x.jpg')).toBe('https://nimegami.id/assets/x.jpg');
    expect(posterUrl('https://nimegami.id', undefined)).toBeUndefined();
    expect(posterUrl('https://nimegami.id', 'data:image/gif;base64,x')).toBeUndefined();
  });
  it('maps status, type, year and quality words', () => {
    expect(parseStatus('Tamat')).toBe('completed');
    expect(parseStatus('Ongoing')).toBe('ongoing');
    expect(parseStatus('Segera tayang')).toBe('unknown');
    expect(parseType('TV Series')).toBe('tv');
    expect(parseType('Movie')).toBe('movie');
    expect(parseType('Music')).toBeUndefined();
    expect(parseYear('4 Oktober 2024')).toBe(2024);
    expect(labelHeight('720p')).toBe(720);
    expect(labelHeight(null)).toBeUndefined();
  });
});
