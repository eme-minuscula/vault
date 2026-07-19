// Rasterize the app icon to the PNGs the PWA manifest references.
// Run with: node scripts/gen-icons.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'public/favicon.svg'));
const out = join(root, 'public');
const BG = '#0f0f0f';

async function render(size, file, padding = 0) {
  const inner = Math.round(size * (1 - padding * 2));
  const logo = await sharp(svg).resize(inner, inner).png().toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(join(out, file));
  console.log('wrote', file);
}

// Standard icons render the (already rounded) SVG edge-to-edge; the maskable
// icon pads the logo so it survives an OS-applied safe-zone mask.
await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(512, 'icon-512-maskable.png', 0.12);
