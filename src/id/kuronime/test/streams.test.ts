import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { md5Bytes, evpBytesToKey } from '../src/cipher';
import { API_URL, PLAYER_ORIGIN, pixeldrainFile, playerId } from '../src/streams';
import { BASE, disposeAll, fixture, load, type Route } from './harness';

afterEach(disposeAll);

const EP = { url: '/nonton-solo-leveling-season-2-episode-12/', name: 'Episode 12', number: 12 };

const site =
  (overrides: Route = () => undefined): Route =>
  (r) => {
    const own = overrides(r);
    if (own) return own;
    if (r.url === `${BASE}${EP.url}`) return { status: 200, text: fixture('episode_solo_leveling_s2_12.html.txt') };
    if (r.url === API_URL) return { status: 200, text: fixture('animeku_sources.json.txt') };
    return undefined;
  };

describe('parsers', () => {
  it('finds the player id the page hands to the API', () => {
    const id = playerId(fixture('episode_solo_leveling_s2_12.html.txt'));
    expect(id).toMatch(/^[A-Za-z0-9+/=]{300,}$/);
    expect(playerId('<html></html>')).toBeUndefined();
  });

  it('computes MD5 and the OpenSSL key derivation like node does', () => {
    for (const text of ['', 'abc', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(64), 'w'.repeat(1000)]) {
      const mine = Buffer.from(md5Bytes(new TextEncoder().encode(text))).toString('hex');
      expect(mine).toBe(createHash('md5').update(text).digest('hex'));
    }
    const salt = Uint8Array.from([1, 2, 3, 250, 251, 252, 253, 254]);
    const d1 = createHash('md5')
      .update(Buffer.concat([Buffer.from('pw'), salt]))
      .digest();
    const d2 = createHash('md5')
      .update(Buffer.concat([d1, Buffer.from('pw'), salt]))
      .digest();
    expect(Buffer.from(evpBytesToKey('pw', salt, 32)).toString('hex')).toBe(Buffer.concat([d1, d2]).toString('hex'));
  });

  it('reads a pixeldrain link', () => {
    expect(pixeldrainFile('https://pixeldrain.com/u/LAw6ncmA?embed')).toBe('https://pixeldrain.com/api/file/LAw6ncmA');
    expect(pixeldrainFile('https://example.com/u/x')).toBeUndefined();
  });
});

describe('getStreams', () => {
  it('posts the page id to the player API and decrypts the playlists', async () => {
    const { client, requests } = await load(site());
    const streams = await client.getStreams(EP);
    expect(requests[0]?.url).toBe(`${BASE}${EP.url}`);
    const post = requests[1];
    expect(post?.url).toBe(API_URL);
    expect(post?.method).toBe('POST');
    expect(JSON.parse(String(post?.body))).toEqual({ id: playerId(fixture('episode_solo_leveling_s2_12.html.txt')) });

    expect(streams[0]).toMatchObject({ server: 'Kuronime', kind: 'hls' });
    expect(streams[0]?.url).toMatch(/^https:\/\/[^/]+\.kuroplayer\.xyz\/hls\/playlists\/.+\/1080p\/index\.m3u8$/);
    expect(streams[0]?.headers).toEqual({ Referer: `${PLAYER_ORIGIN}/`, Origin: PLAYER_ORIGIN });
    expect(streams[1]).toMatchObject({ server: 'Kuronime SD', quality: 480, kind: 'hls' });
    expect(streams.at(-1)).toEqual({
      url: 'https://pixeldrain.com/api/file/LAw6ncmA',
      server: 'Pixeldrain',
      quality: 1080,
      kind: 'mp4',
    });
  });

  it('says so when the video is still processing', async () => {
    const { client } = await load(
      site((r) => (r.url === API_URL ? { status: 200, text: '{"status":404}' } : undefined)),
    );
    await expect(client.getStreams(EP)).rejects.toThrow(/not ready/);
  });

  it('fails clearly when the answer cannot be decrypted (key rotated)', async () => {
    const { client } = await load(
      site((r) => (r.url === API_URL ? { status: 200, text: '{"status":200,"src":"AAAA"}' } : undefined)),
    );
    await expect(client.getStreams(EP)).rejects.toThrow(/decrypted/);
  });

  it('fails clearly when the page has no player id, and refuses other urls', async () => {
    const { client } = await load(
      site((r) => (r.url === `${BASE}${EP.url}` ? { status: 200, text: '<html></html>' } : undefined)),
    );
    await expect(client.getStreams(EP)).rejects.toThrow(/layout changed/);
    await expect(client.getStreams({ url: '/anime/x/', name: 'x' })).rejects.toThrow(/Not an episode/);
  });
});
