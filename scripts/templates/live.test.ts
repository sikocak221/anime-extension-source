import { describe, expect, it } from 'vitest';
import { loadSource } from '@matane-anime/extension-cli/run';

// Talks to the real site, so it only runs on request: `pnpm test:live`. A timeout, a 403 or a rate limit here is not
// necessarily a bug of the extension.
const LIVE = process.env['LIVE'] === '1';

describe.skipIf(!LIVE)('__ID__ (live)', () => {
  it('reads the popular list', { timeout: 120_000 }, async () => {
    const { client, runtime, call } = await loadSource('.', { prefs: [] });
    try {
      const popular = await client.getPopular(1, call);
      expect(popular.items.length).toBeGreaterThan(0);
    } finally {
      runtime.dispose();
    }
  });
});
