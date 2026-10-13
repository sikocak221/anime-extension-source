// Builds the extension repository that GitHub Pages serves, into ./public: index.json, its Ed25519 signature, one zip
// and one icon per extension (docs/repositories.md in the Matane Anime repository describes the format).
//
//   pnpm build && pnpm repo:build                 # signed: needs the private key (below)
//   pnpm build && pnpm repo:build:unsigned        # what CI checks on a pull request; never published
//
// Keys, the same way as in CI: the private key is the PEM text in MA_REPO_KEY (a secret), and the build is checked
// against the public key in MA_REPO_PUBLIC_KEY (a repository variable), so a wrong secret cannot go live. On your
// own computer both fall back to keys/repo-key.pem and keys/repo-key.pub (`pnpm exec ma-ext repo keygen --out keys`).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'public');
const NAME = 'Anime Extension Source';
const BASE_URL = process.env['MA_REPO_BASE_URL'] ?? 'https://sikocak221.github.io/anime-extension-source/';
// Extensions that are built and tested but not published (by folder name).
const EXCLUDE = new Set([]);

async function main() {
  const unsigned = process.argv.includes('--unsigned');
  // Throws, so that the `finally` below always removes the temporary key (process.exit would skip it).
  const fail = (message) => {
    throw new Error(message);
  };
  const flag = (name) => {
    const at = process.argv.indexOf(name);
    return at > 0 ? process.argv[at + 1] : undefined;
  };

  const folders = [];
  for (const lang of readdirSync(join(ROOT, 'src')).sort()) {
    for (const id of readdirSync(join(ROOT, 'src', lang)).sort()) {
      if (EXCLUDE.has(id)) continue;
      const folder = join('src', lang, id);
      if (!existsSync(join(ROOT, folder, 'dist', 'index.js')))
        fail(`${folder} is not built: run \`pnpm build\` first.`);
      folders.push(folder);
    }
  }

  const ma = (args) => {
    const result = spawnSync('pnpm', ['exec', 'ma-ext', ...args], { cwd: ROOT, stdio: 'inherit' });
    if (result.status !== 0) fail(`ma-ext ${args.slice(0, 2).join(' ')} failed (exit ${result.status}).`);
  };
  // A new build starts from an empty folder, so `--serial` cannot count up from the previous index. The time does:
  // apps refuse an index whose serial is lower than the one they accepted (rollback protection).
  const build = (...extra) =>
    ma([
      'repo',
      'build',
      ...folders,
      '--out',
      OUT,
      '--name',
      NAME,
      '--base-url',
      BASE_URL,
      '--serial',
      String(Math.floor(Date.now() / 1000)),
      ...extra,
    ]);

  rmSync(OUT, { recursive: true, force: true });
  if (unsigned) {
    build('--unsigned');
    ma(['repo', 'verify', OUT]);
    console.log(`✓ ${folders.length} extensions in ${OUT} (unsigned: do not publish)`);
    return;
  }

  const localKey = join(ROOT, 'keys', 'repo-key.pem');
  const keyText = process.env['MA_REPO_KEY'] ?? (flag('--key') || existsSync(localKey) ? undefined : '');
  if (keyText === '')
    fail('No signing key: set MA_REPO_KEY (the PEM text), pass --key <repo-key.pem>, or use --unsigned.');
  const localPub = join(ROOT, 'keys', 'repo-key.pub');
  const publicKey = (
    process.env['MA_REPO_PUBLIC_KEY'] ??
    flag('--public-key') ??
    (existsSync(localPub) ? readFileSync(localPub, 'utf8') : '')
  ).trim();
  if (!/^ed25519:[0-9a-f]{64}$/.test(publicKey)) {
    fail(
      'No public key to verify against: set MA_REPO_PUBLIC_KEY (`ed25519:<64 hex>`, printed by `ma-ext repo keygen`).',
    );
  }

  // ma-ext reads a file, so a key that came in as text is written to a private temp file for the build only.
  let keyFile = resolve(flag('--key') ?? localKey);
  const temp = keyText ? mkdtempSync(join(tmpdir(), 'ma-key-')) : undefined;
  try {
    if (temp) {
      keyFile = join(temp, 'repo-key.pem');
      writeFileSync(keyFile, `${keyText.trim()}\n`, { mode: 0o600 });
    }
    build('--key', keyFile);
    // Signature, size and SHA-256 of every archive and icon, and that the signer is the expected key.
    ma(['repo', 'verify', OUT, '--key', publicKey]);
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true });
  }
  console.log(`✓ ${folders.length} extensions in ${OUT}, signed by ${publicKey.slice(0, 12)}…${publicKey.slice(-4)}`);
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exitCode = 1;
});
