// Writes a neutral icon (a coloured tile with the extension's initial) to src/<lang>/<id>/icon.png, so that the
// repository never publishes a third-party site's logo:  node scripts/make-icons.mjs [id ...]
// Needs ImageMagick (`magick`). Run it once for a new extension in place of copying a site's favicon.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const only = new Set(process.argv.slice(2));

for (const lang of readdirSync(join(ROOT, 'src')).sort()) {
  for (const id of readdirSync(join(ROOT, 'src', lang)).sort()) {
    if (only.size > 0 && !only.has(id)) continue;
    const dir = join(ROOT, 'src', lang, id);
    const { name } = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    const hue = createHash('sha256').update(id).digest().readUInt16BE(0) % 360;
    const initial = name.trim().charAt(0).toUpperCase();
    const result = spawnSync(
      'magick',
      [
        ...['-size', '192x192', 'xc:none'],
        ...['-fill', `hsl(${hue},45%,38%)`, '-draw', 'roundrectangle 0,0 191,191 36,36'],
        ...['-fill', 'white', '-gravity', 'center', '-pointsize', '110', '-annotate', '0', initial],
        join(dir, 'icon.png'),
      ],
      { stdio: 'inherit' },
    );
    if (result.status !== 0) throw new Error(`magick failed for ${id}`);
  }
}
console.log('✓ icons written');
