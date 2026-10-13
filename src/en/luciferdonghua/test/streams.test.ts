import { afterEach, describe, expect, it } from 'vitest';
import {
  dailymotionId,
  iframeSrc,
  isReadableLabel,
  okruId,
  parseDailymotionMetadata,
  serverName,
} from '../src/streams';
import { BASE, disposeAll, fixture, load, type Route } from './harness';

afterEach(disposeAll);

const EP_PATH = '/jade-dynasty-final-season-4-episode-10-lucifer-donghua/';
const EP = { url: EP_PATH, name: 'Episode 10', number: 10 };

const site =
  (overrides: Route = () => undefined): Route =>
  (r) => {
    const own = overrides(r);
    if (own) return own;
    if (r.url === `${BASE}${EP_PATH}`) return { status: 200, text: fixture('ep_jade_10.html.txt') };
    if (r.url === `${BASE}${EP_PATH}v/4/`) return { status: 200, text: fixture('ep_jade_10_v4.html.txt') };
    if (r.url.startsWith('https://www.dailymotion.com/player/metadata/video/')) {
      return { status: 200, text: fixture('dailymotion_metadata.json.txt') };
    }
    if (r.url.startsWith('https://ok.ru/videoembed/')) return { status: 200, text: fixture('okru_embed.html.txt') };
    return undefined;
  };

describe('parsers', () => {
  it('reads the src of an iframe (protocol-relative and upper case too)', () => {
    expect(iframeSrc('<iframe width="560" src="//ok.ru/videoembed/16927780571650?nochat=1"></iframe>')).toBe(
      'https://ok.ru/videoembed/16927780571650?nochat=1',
    );
    expect(iframeSrc('<IFRAME SRC="https://yurn.online/embed/16jhuw8dw3d3" WIDTH=640></IFRAME>')).toBe(
      'https://yurn.online/embed/16jhuw8dw3d3',
    );
    expect(iframeSrc('<iframe src="javascript:alert(1)"></iframe>')).toBeUndefined();
  });

  it('finds the video ids', () => {
    expect(dailymotionId('https://geo.dailymotion.com/player/xdcdz.html?video=k15a97GE1bQII4LgNkK')).toBe(
      'k15a97GE1bQII4LgNkK',
    );
    expect(dailymotionId('https://www.dailymotion.com/embed/video/k15a97GE1bQII4LgNkK')).toBe('k15a97GE1bQII4LgNkK');
    expect(dailymotionId('https://rumble.com/embed/v7ee3jg/?pub=4pc9ma')).toBeUndefined();
    expect(okruId('https://ok.ru/videoembed/16927780571650?nochat=1')).toBe('16927780571650');
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
    expect(serverName('Ok.ru', '[4K] Eng [OK.RU - Server]')).toBe('Ok.ru (4K Eng)');
    expect(serverName('Dailymotion', '[4K] Indo + Eng [Dailymotion Little Ads - Server]')).toBe(
      'Dailymotion (4K Indo + Eng)',
    );
    expect(serverName('Ok.ru', 'Ok.ru')).toBe('Ok.ru');
  });

  it('picks the options worth a request', () => {
    expect(isReadableLabel('[4K] Eng [OK.RU - Server]')).toBe(true);
    expect(isReadableLabel('[4K] Indo + Eng [Dailymotion Little Ads - Server]')).toBe(true);
    expect(isReadableLabel('[4K] Eng [RUMBEL- Server]')).toBe(false);
    expect(isReadableLabel('[4K] Eng [VID HIDE Server with ads]')).toBe(false);
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
  it('resolves the default Dailymotion player and the ok.ru option, and never opens the other hosts', async () => {
    const { client, requests } = await load(site());
    const streams = await client.getStreams(EP);

    const okru = streams.filter((s) => s.server.startsWith('Ok.ru'));
    const dm = streams.filter((s) => s.server.startsWith('Dailymotion'));
    expect(okru.length).toBeGreaterThan(3);
    expect(okru.every((s) => s.kind === 'mp4')).toBe(true);
    expect(okru.map((s) => s.quality)).toEqual([...okru.map((s) => s.quality)].sort((a, b) => (b ?? 0) - (a ?? 0)));
    expect(dm.length).toBeGreaterThan(0);
    expect(dm.every((s) => s.kind === 'hls' && s.headers?.['Referer'] === 'https://geo.dailymotion.com/')).toBe(true);
    // mp4 first, then the adaptive HLS.
    expect(streams.indexOf(okru[okru.length - 1] as never)).toBeLessThan(streams.indexOf(dm[0] as never));
    expect(new Set(streams.map((s) => s.server))).toContain('Ok.ru (4K Eng)');
    expect(new Set(streams.map((s) => s.server))).toContain('Dailymotion (4K Indo + Eng)');
    // The default option is the page itself; only the ok.ru option is fetched as another page.
    const urls = requests.map((r) => r.url);
    expect(urls).toContain(`${BASE}${EP_PATH}`);
    expect(urls).toContain(`${BASE}${EP_PATH}v/4/`);
    expect(urls).not.toContain(`${BASE}${EP_PATH}v/1/`);
    expect(urls).not.toContain(`${BASE}${EP_PATH}v/2/`);
    expect(urls).not.toContain(`${BASE}${EP_PATH}v/3/`);
    expect(urls).not.toContain(`${BASE}${EP_PATH}v/5/`);
    expect(
      requests
        .filter((r) => !/\.m3u8(?:$|\?)/.test(r.url)) // the playlists that label HLS streams
        .every((r) => /^https:\/\/(luciferdonghua\.in|ok\.ru|www\.dailymotion\.com)\//.test(r.url)),
    ).toBe(true);
  });

  it('survives a dead ok.ru as long as Dailymotion answers', async () => {
    const { client, logs } = await load(
      site((r) => (r.url.startsWith('https://ok.ru/') ? { status: 500, text: '' } : undefined)),
    );
    const streams = await client.getStreams(EP);
    expect(streams.length).toBeGreaterThan(0);
    expect(streams.every((s) => s.server.startsWith('Dailymotion'))).toBe(true);
    expect(logs.some((l) => l.includes('failed'))).toBe(true);
  });

  it('survives a server page that fails', async () => {
    const { client, logs } = await load(site((r) => (r.url.endsWith('/v/4/') ? { status: 500, text: '' } : undefined)));
    const streams = await client.getStreams(EP);
    expect(streams.every((s) => s.server.startsWith('Dailymotion'))).toBe(true);
    expect(logs.some((l) => l.includes('failed'))).toBe(true);
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
