import { describe, expect, it } from 'vitest';
import { tallestHeight } from '../src/hls-quality';
import { fixture } from './harness';

describe('tallestHeight', () => {
  it('takes the tallest RESOLUTION of a master playlist', () => {
    expect(tallestHeight(fixture('master.m3u8.txt'))).toBe(1080);
  });

  it('does not take AVERAGE-RESOLUTION for it, whatever the order of the variants', () => {
    const master = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=640x360',
      'a.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=2,AVERAGE-RESOLUTION=1920x1080,RESOLUTION=1280x720',
      'b.m3u8',
    ].join('\n');
    expect(tallestHeight(master)).toBe(720);
  });

  it('is undefined for a media playlist and for a master that names no resolution', () => {
    expect(tallestHeight('#EXTM3U\n#EXTINF:4,\nseg.ts\n')).toBeUndefined();
    expect(tallestHeight('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\na.m3u8\n')).toBeUndefined();
  });
});
