// Rewrites the extensions table of README.md from the manifests:  node scripts/readme-table.mjs
// (between the two markers; `--check` fails when the table is out of date, as CI does).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const START = '<!-- extensions:start -->';
const END = '<!-- extensions:end -->';

const rows = [];
for (const lang of readdirSync(join(ROOT, 'src')).sort()) {
  for (const id of readdirSync(join(ROOT, 'src', lang)).sort()) {
    const dir = join(ROOT, 'src', lang, id);
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    const langs = [...new Set(manifest.sources.map((s) => s.lang.toUpperCase()))].join(', ');
    rows.push([manifest.name, langs, manifest.nsfw ? 'yes' : '']);
  }
}
rows.sort((a, b) => a[0].localeCompare(b[0]));
const table = [
  '| Extension | Languages | 18+ |',
  '| --- | --- | --- |',
  ...rows.map((r) => `| ${r.join(' | ')} |`),
].join('\n');

const path = join(ROOT, 'README.md');
const readme = readFileSync(path, 'utf8');
const start = readme.indexOf(START);
const end = readme.indexOf(END);
if (start < 0 || end < start) throw new Error(`README.md needs ${START} and ${END} around the table`);
const next = `${readme.slice(0, start + START.length)}\n\n${table}\n\n${readme.slice(end)}`;
if (process.argv.includes('--check')) {
  // Prettier pads the columns and the dashes of the header row: compare without whitespace and dashes.
  const plain = (text) => text.replace(/[\s-]+/g, '');
  if (plain(next) !== plain(readme)) {
    console.error('✗ The README table is out of date: run `node scripts/readme-table.mjs`.');
    process.exit(1);
  }
  console.log('README table OK');
} else {
  writeFileSync(path, next);
  console.log(`✓ ${rows.length} extensions in the README`);
}
