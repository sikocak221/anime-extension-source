import { afterEach, describe, expect, it } from 'vitest';
import { dailymotionId, iframeSrc, okruId, parseDailymotionMetadata, serverName } from '../src/streams';
import { BASE, disposeAll, fixture, load, type Route } from './harness';

afterEach(disposeAll);

const EP = { url: '/beyond-times-gaze-episode-43-indonesia-english-sub/', name: 'Episode 43', number: 43 };

const site =
  (overrides: Route = () => undefined): Route =>
  (r) => {
    const own = overrides(r);
    if (own) return own;
    if (r.url.startsWith(BASE)) return { status: 200, text: fixture('ep_beyond_43.html.txt') };
    if (r.url.startsWith('https://www.dailymotion.com/player/metadata/video/')) {
      return { status: 200, text: fixture('dailymotion_metadata.json.txt') };
    }
    if (r.url.startsWith('https://ok.ru/videoembed/')) return { status: 200, text: fixture('okru_embed.html.txt') };
    return undefined;
  };

describe('parsers', () => {
  it('reads the src of an iframe (protocol-relative too)', () => {
    const tag = '<iframe frameborder="0" src="//ok.ru/videoembed/15997670328884?nochat=1" allowfullscreen></iframe>';
    expect(iframeSrc(tag)).toBe('https://ok.ru/videoembed/15997670328884?nochat=1');
  });

  it('finds the video ids', () => {
    expect(dailymotionId('https://geo.dailymotion.com/player/xhojl.html?video=kHphX2oNsHw12QLmmKi')).toBe(
      'kHphX2oNsHw12QLmmKi',
    );
    expect(dailymotionId('https://www.dailymotion.com/embed/video/x8abc12')).toBe('x8abc12');
    expect(dailymotionId('https://rumble.com/embed/v7eh13s/')).toBeUndefined();
    expect(okruId('https://ok.ru/videoembed/15997670328884?nochat=1')).toBe('15997670328884');
    expect(okruId('https://notok.ru/videoembed/1')).toBeUndefined();
  });

  it('reads the Dailymotion metadata (HLS master) and its errors', () => {
    const links = parseDailymotionMetadata(fixture('dailymotion_metadata.json.txt'));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ kind: 'hls' });
    expect(links[0]?.url).toMatch(/^https:\/\/cdndirector\.dailymotion\.com\/cdn\/manifest\/video\/\w+\.m3u8/);
    expect(() => parseDailymotionMetadata('{"error":{"message":"gone"}}')).toThrow(/gone/);
    expect(() => parseDailymotionMetadata('<html>')).toThrow();
  });

  it('names a server by host and variant', () => {
    expect(serverName('Ok.ru', 'Hardsub Indonesia Ok.ru AX')).toBe('Ok.ru (Hardsub Indonesia)');
    expect(serverName('Dailymotion', 'All Sub Player Dailymotion AX')).toBe('Dailymotion (All Sub)');
    expect(serverName('Ok.ru', 'Ok.ru')).toBe('Ok.ru');
  });
});

describe('serverName', () => {
  it('drops a label that is an announcement, not a variant', () => {
    expect(serverName('Dailymotion', '🔥Will be releasing this Saturday "17 OCT 2026" in the evening. 🔥')).toBe(
      'Dailymotion',
    );
    expect(serverName('Ok.ru', 'Hardsub Indonesia Ok.ru AX')).toBe('Ok.ru (Hardsub Indonesia)');
  });
});

describe('getStreams', () => {
  it('resolves ok.ru (mp4, best first) and Dailymotion (HLS) and skips the other hosts', async () => {
    const { client, requests } = await load(site());
    const streams = await client.getStreams(EP);

    const okru = streams.filter((s) => s.server.startsWith('Ok.ru'));
    const dm = streams.filter((s) => s.server.startsWith('Dailymotion'));
    // Both ok.ru embeds are answered with the same fixture, so their identical links collapse to one ladder.
    expect(okru.map((s) => s.quality)).toEqual([1080, 720, 480, 360, 240, 144]);
    expect(dm.length).toBeGreaterThan(0);
    expect(dm.every((s) => s.kind === 'hls' && s.headers?.['Referer'] === 'https://geo.dailymotion.com/')).toBe(true);
    expect(okru.every((s) => s.kind === 'mp4')).toBe(true);
    expect(okru[0]?.quality).toBe(1080);
    expect(streams.indexOf(okru[okru.length - 1] as never)).toBeLessThan(streams.indexOf(dm[0] as never));
    expect(new Set(streams.map((s) => s.server))).toContain('Ok.ru (Hardsub Indonesia)');
    expect(new Set(streams.map((s) => s.server))).toContain('Dailymotion (Hardsub English)');
    // Odysee, Mega, Rumble, d.tube, streamwish and dood are never requested.
    expect(
      requests
        .filter((r) => !/\.m3u8(?:$|\?)/.test(r.url)) // the playlists that label HLS streams
        .every((r) => /^https:\/\/(animexin\.dev|ok\.ru|www\.dailymotion\.com)\//.test(r.url)),
    ).toBe(true);
  });

  it('survives a dead host as long as another one answers', async () => {
    const { client, logs } = await load(
      site((r) => (r.url.startsWith('https://ok.ru/') ? { status: 500, text: '' } : undefined)),
    );
    const streams = await client.getStreams(EP);
    expect(streams.length).toBeGreaterThan(0);
    expect(streams.every((s) => s.server.startsWith('Dailymotion'))).toBe(true);
    expect(logs.some((l) => l.includes('failed'))).toBe(true);
  });

  it('ok.ru without a video (removed) is skipped', async () => {
    const { client } = await load(
      site((r) => (r.url.startsWith('https://ok.ru/') ? { status: 200, text: '<html>removed</html>' } : undefined)),
    );
    const streams = await client.getStreams(EP);
    expect(streams.every((s) => s.server.startsWith('Dailymotion'))).toBe(true);
  });

  it('is NotFoundError when no server can be read', async () => {
    const { client } = await load(site((r) => (r.url.startsWith(BASE) ? undefined : { status: 404, text: 'gone' })));
    await expect(client.getStreams(EP)).rejects.toMatchObject({ typed: 'NotFoundError' });
  });

  it('is NotFoundError for a page with no server at all', async () => {
    const { client } = await load(() => ({
      status: 200,
      text: '<html><body><h1 class="entry-title">x</h1></body></html>',
    }));
    await expect(client.getStreams(EP)).rejects.toMatchObject({ typed: 'NotFoundError' });
  });
});
