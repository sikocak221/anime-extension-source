import { afterEach, describe, expect, it } from 'vitest';
import { labelQuality, parseBloggerResponse, parseMasterVariants, parseUpboltPlaylist } from '../src/streams';
import { BASE, disposeAll, fixture, load } from './harness';

afterEach(disposeAll);

const RPC =
  'https://www.blogger.com/_/BloggerVideoPlayerUi/data/batchexecute?rpcids=WcwnYd&source-path=%2Fvideo.g&rt=c';

describe('parseBloggerResponse', () => {
  it('reads the direct mp4 with its quality from the batchexecute answer', () => {
    const links = parseBloggerResponse(fixture('blogger_rpc.txt'));
    expect(links).toHaveLength(1);
    expect(links[0]?.quality).toBe(360);
    expect(links[0]?.url).toMatch(/^https:\/\/rr\d+---[^/]+\.googlevideo\.com\/videoplayback\?expire=\d+&/);
    expect(links[0]?.url).toContain('mime=video/mp4');
    expect(links[0]?.url).not.toContain('\\');
  });
});

describe('parseUpboltPlaylist', () => {
  it('reads the master playlist from the JW Player setup', () => {
    expect(parseUpboltPlaylist(fixture('upbolt_embed.html'))).toMatch(
      /^https:\/\/edge\d+\.upbolt\.to\/hls2\/.+\/master\.m3u8\?t=/,
    );
  });

  it('is undefined when the page has no player', () => {
    expect(parseUpboltPlaylist('<html>File not found</html>')).toBeUndefined();
  });
});

describe('parseMasterVariants', () => {
  const base = 'https://edge03.upbolt.to/hls2/01/00030/master.m3u8';

  it('lists one playlist per height, tallest first, and ignores the I-frame playlists', () => {
    const variants = parseMasterVariants(fixture('upbolt_master.m3u8'), base);
    expect(variants.map((v) => v.height)).toEqual([1080, 720, 480, 360]);
    expect(variants[0]?.url).toMatch(/^https:\/\/edge03\.upbolt\.to\/.+_x\/index-v1-a1\.m3u8\?t=/);
    expect(variants.some((v) => v.url.includes('iframes'))).toBe(false);
  });

  it('resolves a relative address against the master', () => {
    const text = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1280x720\n720/index.m3u8\n';
    expect(parseMasterVariants(text, base)).toEqual([
      { url: 'https://edge03.upbolt.to/hls2/01/00030/720/index.m3u8', height: 720 },
    ]);
  });

  it('has nothing for a media playlist or a rung without a resolution', () => {
    expect(parseMasterVariants('#EXTM3U\n#EXTINF:10,\nseg-1.ts\n', base)).toEqual([]);
    expect(parseMasterVariants('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\na.m3u8\n', base)).toEqual([]);
  });
});

describe('labelQuality', () => {
  it('takes the height a label names', () => {
    expect(labelQuality('STR 720p')).toBe(720);
    expect(labelQuality('Nonton Online 1080p')).toBe(1080);
    expect(labelQuality('HD')).toBeUndefined();
    expect(labelQuality(undefined)).toBeUndefined();
  });
});

describe('getStreams', () => {
  const old = { url: 'one-piece/1', name: 'Episode 1', number: 1 };
  const next = { url: 'one-piece/1180', name: 'Episode 1180', number: 1180 };

  it('resolves a Blogger embed through the RPC', async () => {
    const { client, requests } = await load((r) => {
      if (r.url === `${BASE}/series/one-piece/episodes/1`) return { status: 200, text: fixture('episode_detail.json') };
      if (r.url === RPC) return { status: 200, text: fixture('blogger_rpc.txt') };
      return undefined;
    });
    const streams = await client.getStreams(old);
    expect(streams).toHaveLength(1);
    expect(streams[0]).toMatchObject({ server: 'Blogger', kind: 'mp4', quality: 360 });
    const rpc = requests.find((r) => r.url === RPC);
    expect(rpc?.method).toBe('POST');
    expect(decodeURIComponent(String(rpc?.body))).toContain('WcwnYd');
  });

  const upbolt = (code: string) => `https://upbolt.to/e/${code}`;
  const DL = 'https://upbolt.to/dl';

  /** The upbolt player form, and the master playlist its page points at. */
  const upboltRoutes = (r: { url: string; body?: unknown }, onlyMasterFails = false) => {
    if (r.url === DL) {
      const code = /file_code=(\w+)/.exec(String(r.body))?.[1] ?? '';
      return { status: 200, text: fixture('upbolt_embed.html').replaceAll('gghhbx4iwj2v', code) };
    }
    if (r.url.includes('master.m3u8')) {
      return onlyMasterFails ? { status: 500, text: '' } : { status: 200, text: fixture('upbolt_master.m3u8') };
    }
    return undefined;
  };

  it('returns a stream for every height of the ladder, asking only the tallest embed', async () => {
    const { client, requests } = await load(
      (r) =>
        (r.url === `${BASE}/series/one-piece/episodes/1180`
          ? { status: 200, text: fixture('episode_new.json') }
          : undefined) ?? upboltRoutes(r),
    );
    const streams = await client.getStreams(next);
    expect(streams.map((s) => [s.server, s.kind, s.quality])).toEqual([
      ['Upbolt', 'hls', 1080],
      ['Upbolt', 'hls', 720],
      ['Upbolt', 'hls', 480],
      ['Upbolt', 'hls', 360],
    ]);
    expect(streams[0]?.url).toMatch(/_x\/index-v1-a1\.m3u8/);
    // The 1080p embed's ladder holds the other heights, so the 480p and 720p embeds are never asked.
    const forms = requests.filter((r) => r.url === DL);
    expect(forms.map((r) => String(r.body))).toEqual(['op=embed&file_code=org2vvml37ao&auto=1&referer=']);
    expect(requests.filter((r) => r.url.includes('master.m3u8'))).toHaveLength(1);
  });

  it('offers the heights of an "HD" embed, whose label names none', async () => {
    const detail = { data: { streamUrl: [{ source: 'HD', url: upbolt('bj8coujyflaa') }] } };
    const { client } = await load(
      (r) =>
        (r.url === `${BASE}/series/one-piece/episodes/1` ? { status: 200, text: JSON.stringify(detail) } : undefined) ??
        upboltRoutes(r),
    );
    const streams = await client.getStreams(old);
    expect(streams.map((s) => s.quality)).toEqual([1080, 720, 480, 360]);
  });

  it('falls back to the master playlist, with the height of the label, when the ladder cannot be read', async () => {
    const { client } = await load(
      (r) =>
        (r.url === `${BASE}/series/one-piece/episodes/1180`
          ? { status: 200, text: fixture('episode_new.json') }
          : undefined) ?? upboltRoutes(r, true),
    );
    const streams = await client.getStreams(next);
    expect(streams).toHaveLength(1);
    expect(streams[0]).toMatchObject({ server: 'Upbolt', kind: 'hls', quality: 1080 });
    expect(streams[0]?.url).toContain('master.m3u8');
  });

  it('tries the next embed when the tallest one is gone, and at most three of them', async () => {
    const detail = { data: { streamUrl: ['a', 'b', 'c', 'd', 'e'].map((c) => ({ source: 'HD', url: upbolt(c) })) } };
    const { client, requests } = await load((r) => {
      if (r.url === `${BASE}/series/one-piece/episodes/1`) return { status: 200, text: JSON.stringify(detail) };
      if (r.url === DL) return { status: 200, text: '<html>File not found</html>' };
      return undefined;
    });
    await expect(client.getStreams(old)).rejects.toThrow(/No server/);
    expect(requests.filter((r) => r.url === DL)).toHaveLength(3);
  });

  it('survives a removed upbolt file when another server answers', async () => {
    const detail = {
      data: {
        streamUrl: [
          { source: 'HD', url: upbolt('gone') },
          { source: 'HD', url: 'https://geo.dailymotion.com/player.html?video=k5ltbUFE062WDxKod6S&' },
        ],
      },
    };
    const { client } = await load((r) => {
      if (r.url === `${BASE}/series/one-piece/episodes/1`) return { status: 200, text: JSON.stringify(detail) };
      if (r.url === DL) return { status: 200, text: '<html>File not found</html>' };
      if (r.url.startsWith('https://www.dailymotion.com/player/metadata/video/'))
        return { status: 200, text: fixture('dailymotion_metadata.json') };
      return undefined;
    });
    expect((await client.getStreams(old)).map((s) => s.server)).toEqual(['Dailymotion']);
  });

  it('reports a Cloudflare challenge as one, not as "no server"', async () => {
    const detail = { data: { streamUrl: [{ source: 'HD', url: upbolt('abc') }] } };
    const { client } = await load((r) => {
      if (r.url === `${BASE}/series/one-piece/episodes/1`) return { status: 200, text: JSON.stringify(detail) };
      if (r.url === DL)
        return { status: 403, headers: { 'cf-mitigated': 'challenge' }, text: '<title>Just a moment...</title>' };
      return undefined;
    });
    await expect(client.getStreams(old)).rejects.toMatchObject({ typed: 'CloudflareError' });
  });

  it('fails with a clear message when only unreadable hosts exist', async () => {
    const detail = { data: { streamUrl: [{ source: 'HD', url: 'https://filedon.co/embed/abc' }] } };
    const { client, requests } = await load((r) =>
      r.url === `${BASE}/series/one-piece/episodes/1` ? { status: 200, text: JSON.stringify(detail) } : undefined,
    );
    await expect(client.getStreams(old)).rejects.toThrow(/only on servers/);
    expect(requests).toHaveLength(1);
  });

  it('puts Dailymotion HLS first and survives a failing server', async () => {
    const detail = {
      data: {
        streamUrl: [
          { source: 'sd', url: 'https://www.blogger.com/video.g?token=dead' },
          { source: 'HD', url: 'https://filedon.co/embed/abc' },
          { source: 'HD', url: 'https://geo.dailymotion.com/player.html?video=k5ltbUFE062WDxKod6S&' },
          { source: 'HD', url: 'not a url' },
        ],
      },
    };
    const { client } = await load((r) => {
      if (r.url === `${BASE}/series/one-piece/episodes/1`) return { status: 200, text: JSON.stringify(detail) };
      if (r.url.startsWith('https://www.dailymotion.com/player/metadata/video/k5ltbUFE062WDxKod6S'))
        return { status: 200, text: fixture('dailymotion_metadata.json') };
      if (r.url === RPC) return { status: 200, text: ')]}\'\n\n[["wrb.fr","WcwnYd",null]]' };
      return undefined;
    });
    const streams = await client.getStreams(old);
    expect(streams).toHaveLength(1);
    expect(streams[0]).toMatchObject({ server: 'Dailymotion', kind: 'hls' });
    expect(streams[0]?.url).toMatch(/\.m3u8/);
  });

  it('reads every server and returns all their streams, HLS first', async () => {
    const detail = {
      data: {
        streamUrl: [
          { source: 'sd', url: 'https://www.blogger.com/video.g?token=ok' },
          { source: 'HD', url: 'https://geo.dailymotion.com/player.html?video=k5ltbUFE062WDxKod6S&' },
        ],
      },
    };
    const { client, requests } = await load((r) => {
      if (r.url === `${BASE}/series/one-piece/episodes/1`) return { status: 200, text: JSON.stringify(detail) };
      if (r.url.startsWith('https://www.dailymotion.com/player/metadata/video/'))
        return { status: 200, text: fixture('dailymotion_metadata.json') };
      if (r.url === RPC) return { status: 200, text: fixture('blogger_rpc.txt') };
      return undefined;
    });
    const streams = await client.getStreams(old);
    expect(streams.map((s) => s.server)).toEqual(['Dailymotion', 'Blogger']);
    // The API, the Dailymotion metadata and the Blogger answer; a fourth asks the Dailymotion master for its height.
    expect(requests.filter((r) => !/\.m3u8(?:$|\?)/.test(r.url))).toHaveLength(3);
  });

  it('reports when the API has no such episode', async () => {
    const { client } = await load((r) => ({ status: 404, text: '{}', url: r.url }));
    await expect(client.getStreams(old)).rejects.toThrow();
  });
});
