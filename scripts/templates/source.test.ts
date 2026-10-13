import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { BASE, disposeAll, fixture, load } from './harness';

afterEach(disposeAll);

// Save a page of the real site (the markup untouched) as test/fixtures/<name> and the tests that use it start running.
const saved = (name: string): boolean => existsSync(new URL(`./fixtures/${name}`, import.meta.url));

describe.skipIf(!saved('popular.html.txt'))('listings', () => {
  it('reads the popular list', async () => {
    const { client, requests } = await load(() => ({ status: 200, text: fixture('popular.html.txt') }));
    const result = await client.getPopular(1);
    expect(requests[0]?.url.startsWith(BASE)).toBe(true);
    expect(result.items.length).toBeGreaterThan(0);
  });
});
