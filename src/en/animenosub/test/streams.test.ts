import { afterEach, describe, expect, it } from 'vitest';
import { classifyEmbed, decodeServerOption, iframeSrc, parseVidara, parseVidmoly, serverName } from '../src/streams';
import { BASE, disposeAll, fixture, load, type Route } from './harness';

afterEach(disposeAll);

const EP = { url: '/a-certain-dark-item-episode-1/', name: 'Episode 1', number: 1 };

/** The episode page has SUB and RAW options on Moon (Byse), Omega (Vidmoly) and Nova (Vidara): 6 embeds. */
const site =
  (overrides: Route = () => undefined): Route =>
  (r) => {
    const own = overrides(r);
    if (own) return own;
    if (r.url.startsWith(`${BASE}/`)) return { status: 200, text: fixture('ep_dark_item_1.html.txt') };
    if (r.url.startsWith('https://bysesayeveum.com/api/videos/')) {
      return { status: 200, text: fixture('byse_video.json.txt') };
    }
    if (r.url.startsWith('https://vidmoly.biz/embed-')) return { status: 200, text: fixture('vidmoly_embed.html.txt') };
    if (r.url === 'https://vidaraa.cc/api/stream') return { status: 200, text: fixture('vidara_stream.json.txt') };
    return undefined;
  };

describe('parsers', () => {
  it('reads the src of an iframe (protocol-relative too)', () => {
    expect(iframeSrc('<iframe frameborder="0" src="//vidmoly.net/embed-sz8nr1wc2zj4.html" width="1"></iframe>')).toBe(
      'https://vidmoly.net/embed-sz8nr1wc2zj4.html',
    );
    expect(iframeSrc('<div>no frame</div>')).toBeUndefined();
  });

  it('an empty option value has no embed', () => {
    expect(decodeServerOption('')).toBeUndefined();
  });

  it('tells the hosts apart and skips the others', () => {
    expect(classifyEmbed('https://bysesayeveum.com/e/1mrt7v4xeguy')).toEqual({
      host: 'byse',
      origin: 'https://bysesayeveum.com',
      code: '1mrt7v4xeguy',
    });
    expect(classifyEmbed('https://vidmoly.net/embed-sz8nr1wc2zj4.html')).toMatchObject({
      host: 'vidmoly',
      code: 'sz8nr1wc2zj4',
    });
    expect(classifyEmbed('https://vidaraa.cc/e/mFACqdzS0qs3s')).toMatchObject({
      host: 'vidara',
      code: 'mFACqdzS0qs3s',
    });
    expect(classifyEmbed('https://nova.upn.one/#rcioqr')).toBeUndefined();
    expect(classifyEmbed('https://evil.example/e/abc')).toBeUndefined();
  });

  it('reads Vidmoly and Vidara answers', () => {
    expect(parseVidmoly(fixture('vidmoly_embed.html.txt'))).toMatch(
      /^https:\/\/[^/]+\/hls2\/04\/02984\/zvuyld3eb9bz_,n,l,\.urlset\/master\.m3u8\?t=/,
    );
    expect(parseVidmoly('<html>nothing</html>')).toBeUndefined();
    expect(parseVidara(fixture('vidara_stream.json.txt'))).toMatch(/^https:\/\/.*\/master\.m3u8\?token=/);
    expect(parseVidara('{"streaming_url":null}')).toBeUndefined();
    expect(() => parseVidara('<html>')).toThrow();
  });

  it('names a server by host and variant', () => {
    expect(serverName('byse', 'SUB - Moon')).toBe('Moon (SUB)');
    expect(serverName('vidmoly', 'RAW - Omega')).toBe('Omega (RAW)');
    expect(serverName('vidara', 'Nova')).toBe('Nova');
  });
});

describe('getStreams', () => {
  it('resolves Byse (decrypted), Vidmoly and Vidara as HLS and skips nothing it can read', async () => {
    const { client, requests } = await load(site());
    const streams = await client.getStreams(EP);

    const names = streams.map((s) => s.server);
    expect(names).toContain('Moon (SUB)');
    expect(names).toContain('Omega (SUB)');
    expect(names).toContain('Nova (SUB)');
    // The three hosts answer with the same fixture for every code: identical links are listed once.
    expect(streams.every((s) => s.kind === 'hls')).toBe(true);
    const moon = streams.find((s) => s.server === 'Moon (SUB)');
    expect(moon?.url).toMatch(
      /^https:\/\/edge1-madrid-sprintcdn\.r66nv9ed\.com\/hls2\/07\/12208\/1mrt7v4xeguy_x\/master\.m3u8\?/,
    );
    expect(moon?.quality).toBe(1080);
    expect(moon?.headers).toEqual({ Referer: 'https://bysesayeveum.com/' });
    const omega = streams.find((s) => s.server === 'Omega (SUB)');
    expect(omega?.url).toContain('zvuyld3eb9bz_,n,l,.urlset/master.m3u8');
    const nova = streams.find((s) => s.server === 'Nova (SUB)');
    expect(nova?.url).toContain('/master.m3u8?token=');
    expect(
      requests
        .filter((r) => !/\.m3u8(?:$|\?)/.test(r.url)) // the playlists that label HLS streams
        .every((r) => /^https:\/\/(animenosub\.to|bysesayeveum\.com|vidmoly\.biz|vidaraa\.cc)\//.test(r.url)),
    ).toBe(true);
    const post = requests.find((r) => r.url === 'https://vidaraa.cc/api/stream');
    expect(post?.method).toBe('POST');
    expect(JSON.parse(post?.body ?? '{}')).toMatchObject({ filecode: expect.any(String) });
  });

  it('survives a dead host as long as another one answers', async () => {
    const { client, logs } = await load(
      site((r) => (r.url.startsWith('https://bysesayeveum.com/') ? { status: 500, text: '' } : undefined)),
    );
    const streams = await client.getStreams(EP);
    expect(streams.length).toBeGreaterThan(0);
    expect(streams.some((s) => s.server.startsWith('Moon'))).toBe(false);
    expect(logs.some((l) => l.includes('failed'))).toBe(true);
  });

  it('a host with a removed video is skipped', async () => {
    const { client } = await load(
      site((r) =>
        r.url.startsWith('https://vidmoly.biz/') ? { status: 200, text: '<html>removed</html>' } : undefined,
      ),
    );
    const streams = await client.getStreams(EP);
    expect(streams.some((s) => s.server.startsWith('Omega'))).toBe(false);
    expect(streams.some((s) => s.server.startsWith('Nova'))).toBe(true);
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
