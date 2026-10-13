// Builds the documentation site (VitePress, docs/) from the repository that `build-repo.mjs` just wrote into public/,
// and copies it into public/ so that one Pages deploy serves the site, index.json and the archives together.
//
//   pnpm repo:build && node scripts/build-site.mjs
//
// docs/repository.md and docs/extensions.md are written here (git-ignored): the key and the list come from the
// built index and its signature, never from a copy that could go stale.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'public');
const DOCS = join(ROOT, 'docs');
const URL_ = process.env['MA_REPO_BASE_URL'] ?? 'https://sikocak221.github.io/anime-extension-source/';

if (!existsSync(join(PUBLIC, 'index.json')))
  throw new Error('public/index.json is missing: run `pnpm repo:build` first.');
const index = JSON.parse(readFileSync(join(PUBLIC, 'index.json'), 'utf8'));
const signature = existsSync(join(PUBLIC, 'index.json.sig'))
  ? JSON.parse(readFileSync(join(PUBLIC, 'index.json.sig'), 'utf8'))
  : null;
const key = signature?.key ?? null;
const fingerprint = key ? `${key.slice(0, 12)}…${key.slice(-4)}` : null;

writeFileSync(
  join(DOCS, 'repository.md'),
  `# Add the repository

In Matane Anime, open **Extensions → Repositories → Add repository** and paste:

\`\`\`
${URL_}
\`\`\`

${
  key
    ? `Compare the key the app shows with this one, then choose **Trust this key**:

\`\`\`
Signing key:  ${key}
Fingerprint:  ${fingerprint}
\`\`\``
    : '::: warning Unsigned build\nThis build of the site was made without a signing key and is not published.\n:::'
}

Serial ${index.serial}, built ${index.generatedAt}. ${index.extensions.length} extensions.

If the fingerprint is different, do not trust it: the address may not be this repository.
`,
);

const rows = index.extensions.map(
  (e) => `| ${e.name} | ${e.version} | ${e.langs.map((l) => l.toUpperCase()).join(', ')} | ${e.nsfw ? '18+' : ''} |`,
);
writeFileSync(
  join(DOCS, 'extensions.md'),
  `# Extensions

${index.extensions.length} extensions in this repository. They contain source code only. An extension may stop working for a while when what it reads changes: see the [FAQ](/faq).

| Extension | Version | Languages | 18+ |
| --- | --- | --- | --- |
${rows.join('\n')}
`,
);

const built = spawnSync('pnpm', ['exec', 'vitepress', 'build', 'docs'], { cwd: ROOT, stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);
// index.json, its signature, the archives and the icons are already in public/; the site adds its own files.
cpSync(join(DOCS, '.vitepress', 'dist'), PUBLIC, { recursive: true });
console.log(`✓ site and repository in ${PUBLIC}`);
