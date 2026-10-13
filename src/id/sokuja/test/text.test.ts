import { describe, expect, it } from 'vitest';
import {
  cleanTitle,
  entityPath,
  episodeName,
  episodeNumber,
  imageUrl,
  parseStatus,
  parseType,
  parseYear,
  qualityOf,
  slugOf,
} from '../src/text';

const BASE = 'https://x6.sokuja.uk';

describe('text helpers', () => {
  it('drops the suffix the page adds to a title', () => {
    expect(cleanTitle('Overgeared   Subtitle Indonesia')).toBe('Overgeared');
    expect(cleanTitle('Overgeared ')).toBe('Overgeared');
  });

  it('keeps entity paths with a trailing slash and no host', () => {
    expect(entityPath('/anime/a-b/', BASE)).toBe('/anime/a-b/');
    expect(entityPath('https://sokuja.net/a-b-episode-1', BASE)).toBe('/a-b-episode-1/');
    expect(slugOf('/anime/a-b/')).toBe('a-b');
    expect(slugOf('/a-b-episode-1/')).toBe('a-b-episode-1');
  });

  it('reads the original address of an image behind the resizer', () => {
    expect(imageUrl('/_next/image/?url=%2Fuploads%2F2026%2Fa.webp&w=3840&q=75', BASE)).toBe(
      `${BASE}/uploads/2026/a.webp`,
    );
    expect(imageUrl('/_next/image/?url=https%3A%2F%2Fgbr.sokuja.uk%2Fa.jpg&w=3840&q=75', BASE)).toBe(
      'https://gbr.sokuja.uk/a.jpg',
    );
    expect(imageUrl('https://gbr.sokuja.uk/a.jpg', BASE)).toBe('https://gbr.sokuja.uk/a.jpg');
    expect(imageUrl('data:image/gif;base64,AAAA', BASE)).toBeUndefined();
    expect(imageUrl(undefined, BASE)).toBeUndefined();
  });

  it('reads episode numbers and names', () => {
    expect(episodeNumber('One Piece Episode 1180')).toBe(1180);
    expect(episodeNumber('Show Episode 12.5')).toBe(12.5);
    expect(episodeNumber('Blue Lock Movie: Episode Nagi')).toBeUndefined();
    // Some names end with the suffix of the page; then the number is still the one before it.
    expect(episodeNumber('Gaikotsu Season 2 Episode 12 Subtitle Indonesia')).toBe(12);
    expect(
      episodeNumber('Gaikotsu Season 2 Episode 12 Subtitle Indonesia', '/x-season-2-episode-12-subtitle-indonesia/'),
    ).toBe(12);
    expect(
      episodeNumber('Blue Lock Movie: Episode Nagi', '/blue-lock-episode-nagi-subtitle-indonesia/'),
    ).toBeUndefined();
    expect(episodeNumber('Special', '/show-episode-7-subtitle-indonesia/')).toBe(7);
    expect(episodeName('Gaikotsu Season 2 Episode 12 Subtitle Indonesia', 12)).toBe('Episode 12');
    expect(episodeName('One Piece Episode 1180', 1180)).toBe('Episode 1180');
    expect(episodeName('Golden Kamuy OVA S2 Episode 3', 3)).toBe('Episode 3');
    expect(episodeName('Ansatsu Kyoushitsu Movie: Minna no Jikan', undefined)).toBe(
      'Ansatsu Kyoushitsu Movie: Minna no Jikan',
    );
    expect(episodeName('', 7)).toBe('Episode 7');
  });

  it('reads status, type, year and quality labels', () => {
    expect(parseStatus('Ongoing')).toBe('ongoing');
    expect(parseStatus('Completed')).toBe('completed');
    expect(parseStatus('Upcoming')).toBe('unknown');
    expect(parseType('TV')).toBe('tv');
    expect(parseType('Movie')).toBe('movie');
    expect(parseType('Music')).toBeUndefined();
    expect(parseYear('2026')).toBe(2026);
    expect(parseYear('n/a')).toBeUndefined();
    expect(qualityOf('720p')).toBe(720);
    expect(qualityOf('1080')).toBe(1080);
    expect(qualityOf('Default')).toBeUndefined();
    expect(qualityOf(null)).toBeUndefined();
  });
});
