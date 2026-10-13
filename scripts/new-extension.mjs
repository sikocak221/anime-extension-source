// Scaffolds an extension under src/<lang>/<id> with the repository's conventions (catalog versions, tests, scripts).
//
//   node scripts/new-extension.mjs --lang en --id my-site --name "My Site" --url https://my-site.example [--nsfw]
//
// Multi-language sites go in src/all. Then: `pnpm install`, `pnpm --filter ./src/en/my-site build`, and write the
// source in src/index.ts. `ma-ext test` checks the whole flow against the real site.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const ROOT = resolve(import.meta.dirname, '..');
process.on('uncaughtException', (error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
const { values } = parseArgs({
  options: {
    lang: { type: 'string' },
    id: { type: 'string' },
    name: { type: 'string' },
    url: { type: 'string' },
    nsfw: { type: 'boolean', default: false },
  },
});
for (const key of ['lang', 'id', 'name', 'url']) {
  if (!values[key]) throw new Error(`--${key} is required`);
}
const { lang, id, name, nsfw } = values;
if (!/^[a-z][a-z0-9-]*$/.test(id))
  throw new Error('--id: lowercase letters, digits and dashes, starting with a letter');
if (!/^([a-z]{2,3}|all)$/.test(lang)) throw new Error('--lang: a language code such as en, or "all"');
const base = new URL(values.url);
if (base.protocol !== 'https:') throw new Error('--url must be an https address');
const baseUrl = base.origin;

const dir = join(ROOT, 'src', lang, id);
if (existsSync(dir)) throw new Error(`${dir} exists`);
const created = spawnSync(
  'pnpm',
  ['exec', 'ma-ext', 'create', id, '--name', name, '--lang', lang === 'all' ? 'en' : lang, '--dir', dir],
  { cwd: ROOT, stdio: 'inherit' },
);
if (created.status !== 0) process.exit(created.status ?? 1);

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
manifest.nsfw = nsfw;
await writeFile(join(dir, 'manifest.json'), json(manifest));
await writeFile(
  join(dir, 'package.json'),
  json({
    name: `@matane-anime/${id}-extension`,
    version: '0.1.0',
    private: true,
    description: `Extension for ${base.host}.`,
    license: 'MIT',
    type: 'module',
    scripts: {
      build: 'ma-ext build',
      typecheck: 'tsc -p tsconfig.json',
      test: 'vitest run',
      'test:live': 'LIVE=1 vitest run test/live.test.ts',
    },
    devDependencies: {
      '@matane-anime/extension-cli': 'catalog:',
      '@matane-anime/extension-runtime': 'catalog:',
      '@matane-anime/extension-sdk': 'catalog:',
    },
  }),
);
await writeFile(join(dir, 'tsconfig.json'), json({ extends: '../../../tsconfig.base.json', include: ['src'] }));
const source = await readFile(join(dir, 'src/index.ts'), 'utf8');
await writeFile(join(dir, 'src/index.ts'), source.replace('https://example.com', baseUrl));

await mkdir(join(dir, 'test', 'fixtures'), { recursive: true });
const fill = (text) =>
  text.replaceAll('__BASE__', baseUrl).replaceAll('__KEY__', manifest.sources[0].key).replaceAll('__ID__', id);
const templates = join(ROOT, 'scripts', 'templates');
for (const file of ['harness.ts', 'source.test.ts', 'live.test.ts']) {
  await writeFile(join(dir, 'test', file), fill(await readFile(join(templates, file), 'utf8')));
}
await writeFile(join(dir, 'test', 'fixtures', '.gitkeep'), '');
await copyFile(join(ROOT, 'LICENSE'), join(dir, 'LICENSE'));
// The scaffold's own README and .gitignore are not needed here: the repository has its own.
await rm(join(dir, 'README.md'), { force: true });
await rm(join(dir, '.gitignore'), { force: true });
spawnSync('pnpm', ['exec', 'prettier', '--write', dir], { cwd: ROOT, stdio: 'ignore' });
console.log(
  `\n✓ ${dir}\n  Next: pnpm install; pnpm --filter ./src/${lang}/${id} build; add an icon.png (square, 96-256 px, up to 512 KB).`,
);
