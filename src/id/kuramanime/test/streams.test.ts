import { afterEach, describe, expect, it } from 'vitest';
import { BASE, disposeAll, fixture, load, type Route } from './harness';
import { cookieHeader, entityPath } from '../src/text';

afterEach(disposeAll);

const SERIES = '/anime/3384/a-rank-party-wo-ridatsu-shita-ore-wa-moto-oshiego-tachi-to-meikyuu-shinbu-wo-mezasu';
const EPISODE = { url: `${SERIES}/episode/24`, name: 'Episode 24', number: 24 };
const SET_COOKIE =
  'XSRF-TOKEN=abc%3D; expires=Sat, 10 Oct 2026 21:18:57 GMT; Max-Age=7200; path=/; secure, kuramanime_session=sess%3D; path=/; httponly';

/** The site's flow: the page (with a session cookie), the env script, the token file and the protected POST. */
const player =
  (
    bySerer: Record<string, string>,
    seen: {
      token?: Record<string, string>;
      post?: { url: string; body?: string; headers?: Record<string, string> }[];
    } = {},
  ): Route =>
  (r) => {
    const url = new URL(r.url);
    if (url.pathname === EPISODE.url && r.method !== 'POST') {
      return { status: 200, text: fixture('episode_aparida_24.html.txt'), headers: { 'set-cookie': SET_COOKIE } };
    }
    if (url.pathname === '/assets/js/wzl3ClXO8shDECR.js') return { status: 200, text: fixture('auth_env.js.txt') };
    if (url.pathname === '/assets/Ks6sqSgloPTlHMl.txt') {
      seen.token = r.headers;
      return r.headers?.['Cookie']?.includes('kuramanime_session=sess%3D')
        ? { status: 200, text: 'tok123\n' }
        : { status: 419, text: '' };
    }
    if (url.pathname === EPISODE.url && r.method === 'POST') {
      (seen.post ??= []).push({
        url: r.url,
        ...(r.body !== undefined && { body: r.body }),
        ...(r.headers && { headers: r.headers }),
      });
      const server = url.searchParams.get('C2XAPerzX1BM7V9') ?? '';
      const ok =
        url.searchParams.get('Ub3BzhijicHXZdv') === 'tok123' &&
        r.body === 'authorization=kJuHHkaqcBFXiGMHQf6bJw8YAyDcwGD8Ur';
      return ok && bySerer[server]
        ? { status: 200, text: fixture(bySerer[server]) }
        : { status: 200, text: '<html><body>no player</body></html>' };
    }
    return undefined;
  };

describe('streams', () => {
  it('walks the token flow and returns the mp4 ladder, tallest first, with the session cookie on every call', async () => {
    const seen: Parameters<typeof player>[1] = {};
    const { client, requests } = await load(player({ kuramadrive: 'player_kuramadrive.html.txt' }, seen));
    const streams = await client.getStreams(EPISODE);
    expect(streams.map((s) => [s.server, s.quality, s.kind])).toEqual([
      ['Kuramadrive', 720, 'mp4'],
      ['Kuramadrive', 480, 'mp4'],
      ['Kuramadrive', 360, 'mp4'],
    ]);
    expect(streams[0]?.url).toMatch(
      /^https:\/\/asuna\.my\.id\/kdrive\/.+720p-KuramaBD\.mp4\?lud=\d+&pid=33596&sid=\d+&cce=1&upx=n$/,
    );
    expect(streams[0]?.headers).toEqual({ Referer: `${BASE}/` });
    // The episode page had `mega` and `kuramadrive` only: the one readable server is asked, once.
    expect(requests.map((r) => `${r.method ?? 'GET'} ${new URL(r.url).pathname}`)).toEqual([
      `GET ${EPISODE.url}`,
      'GET /assets/js/wzl3ClXO8shDECR.js',
      'GET /assets/Ks6sqSgloPTlHMl.txt',
      `POST ${EPISODE.url}`,
    ]);
    expect(seen.token).toMatchObject({
      'X-Fuck-ID': 'rFj8fp1nxMuNfKq:ijjAwj6Jze0kscx',
      'X-Request-Index': '0',
      Cookie: 'XSRF-TOKEN=abc%3D; kuramanime_session=sess%3D',
    });
    expect(seen.token?.['X-Request-ID']).toMatch(/^[A-Za-z0-9]{6}$/);
    expect(seen.post?.[0]?.headers).toMatchObject({
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: 'XSRF-TOKEN=abc%3D; kuramanime_session=sess%3D',
    });
    expect(new URL(seen.post?.[0]?.url ?? '').searchParams.get('C2XAPerzX1BM7V9')).toBe('kuramadrive');
  });

  it('reads the HLS source and the files of the first server, and the single file of the v2 server', async () => {
    // The saved episode page offers kuramadrive and mega; point it at both kuramadrive servers.
    const route = player({ kuramadrive: 'player_hls.html.txt', 'kuramadrive-v2': 'player_v2.html.txt' });
    const withV2: Route = (r) => {
      const answer = route(r);
      return answer && new URL(r.url).pathname === EPISODE.url && r.method !== 'POST'
        ? {
            ...answer,
            text: (answer.text ?? '').replace(
              '<option value="mega"',
              '<option value="kuramadrive-v2" >v2</option><option value="mega"',
            ),
          }
        : answer;
    };
    const { client } = await load(withV2);
    const streams = await client.getStreams(EPISODE);
    expect(streams[0]).toMatchObject({
      server: 'Kuramadrive',
      kind: 'hls',
      url: expect.stringMatching(/^https:\/\/d1\.yorudrive\.com\/.+\/master\.m3u8$/),
    });
    expect(streams.filter((s) => s.server === 'Kuramadrive' && s.kind === 'mp4').map((s) => s.quality)).toEqual([
      720, 480, 360,
    ]);
    const v2 = streams.filter((s) => s.server === 'Kuramadrive v2');
    expect(v2).toHaveLength(1);
    expect(v2[0]).toMatchObject({
      quality: 720,
      kind: 'mp4',
      url: expect.stringMatching(/^https:\/\/lh3\.googleusercontent\.com\//),
    });
  });

  it('skips servers that only offer a third-party embed', async () => {
    const { client } = await load(player({ kuramadrive: 'player_mega.html.txt' }));
    await expect(client.getStreams(EPISODE)).rejects.toThrow(/No playable Kuramadrive file/);
  });

  it('rejects things that are not episodes', async () => {
    const { client, requests } = await load(player({}));
    await expect(client.getStreams({ url: SERIES, name: 'x' })).rejects.toThrow(/Not an episode/);
    expect(requests).toHaveLength(0);
  });

  it('fails clearly when the page lost its script name or the env keys', async () => {
    const { client } = await load(() => ({ status: 200, text: '<html></html>' }));
    await expect(client.getStreams(EPISODE)).rejects.toThrow(/layout changed/);
    const noEnv: Route = (r) =>
      new URL(r.url).pathname.startsWith('/assets/js/')
        ? { status: 200, text: 'window.process = { env: {} };' }
        : player({})(r);
    const second = await load(noEnv);
    await expect(second.client.getStreams(EPISODE)).rejects.toThrow(/MIX_\*/);
  });
});

describe('helpers', () => {
  it('turns Set-Cookie headers (joined with ", ") into a Cookie header', () => {
    expect(cookieHeader(SET_COOKIE)).toBe('XSRF-TOKEN=abc%3D; kuramanime_session=sess%3D');
    expect(cookieHeader(undefined)).toBe('');
  });

  it('keeps only the path of a link', () => {
    expect(entityPath('https://v17.kuramanime.ink/anime/1/x/?page=2#a', BASE)).toBe('/anime/1/x');
    expect(entityPath('/anime/1/x', BASE)).toBe('/anime/1/x');
  });
});
