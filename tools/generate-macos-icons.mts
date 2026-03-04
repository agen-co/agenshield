/**
 * generate-macos-icons.mts — Generate macOS app icon and menu bar icon assets
 *
 * Reads the AgenShield SVG logo and produces:
 *   1. Menu bar template images (pure black + alpha for macOS auto-tinting)
 *   2. App icon PNGs (full color) for the asset catalog
 *
 * Usage: node --experimental-strip-types tools/generate-macos-icons.mts
 */

import sharp from 'sharp';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SVG_PATH = join(ROOT, 'apps/shield-ui/public/logo.svg');
const ASSETS_DIR = join(ROOT, 'apps/shield-macos/AgenShield/Assets.xcassets');

const svgSource = readFileSync(SVG_PATH, 'utf-8');

// --- Menu bar template images (pure black, alpha-only for macOS tinting) ---

const MENUBAR_SIZES = [
  { name: 'icon_18x18.png', size: 18, scale: 1 },
  { name: 'icon_18x18@2x.png', size: 36, scale: 2 },
];

// Make SVG black-only (no fill color) so it works as a macOS template image
const templateSvg = svgSource
  .replace(/fill="#171717"/g, 'fill="#000000"')
  .replace(/fill: transparent/g, 'fill: transparent');

async function generateMenuBarIcons() {
  const dir = join(ASSETS_DIR, 'StatusBarIcon.imageset');
  mkdirSync(dir, { recursive: true });

  for (const entry of MENUBAR_SIZES) {
    await sharp(Buffer.from(templateSvg))
      .resize(entry.size, entry.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(join(dir, entry.name));
  }

  const contents = {
    images: [
      { filename: 'icon_18x18.png', idiom: 'universal', scale: '1x' },
      { filename: 'icon_18x18@2x.png', idiom: 'universal', scale: '2x' },
    ],
    info: { author: 'xcode', version: 1 },
    properties: { 'template-rendering-intent': 'template' },
  };
  writeFileSync(join(dir, 'Contents.json'), JSON.stringify(contents, null, 2) + '\n');
}

// --- App icon PNGs (full color with #171717 fill) ---

interface AppIconEntry {
  filename: string;
  size: number;
  scale: number;
  sizeLabel: string;
}

const APP_ICON_ENTRIES: AppIconEntry[] = [
  { filename: 'icon_16x16.png', size: 16, scale: 1, sizeLabel: '16x16' },
  { filename: 'icon_16x16@2x.png', size: 32, scale: 2, sizeLabel: '16x16' },
  { filename: 'icon_32x32.png', size: 32, scale: 1, sizeLabel: '32x32' },
  { filename: 'icon_32x32@2x.png', size: 64, scale: 2, sizeLabel: '32x32' },
  { filename: 'icon_128x128.png', size: 128, scale: 1, sizeLabel: '128x128' },
  { filename: 'icon_128x128@2x.png', size: 256, scale: 2, sizeLabel: '128x128' },
  { filename: 'icon_256x256.png', size: 256, scale: 1, sizeLabel: '256x256' },
  { filename: 'icon_256x256@2x.png', size: 512, scale: 2, sizeLabel: '256x256' },
  { filename: 'icon_512x512.png', size: 512, scale: 1, sizeLabel: '512x512' },
  { filename: 'icon_512x512@2x.png', size: 1024, scale: 2, sizeLabel: '512x512' },
];

async function generateAppIcons() {
  const dir = join(ASSETS_DIR, 'AppIcon.appiconset');
  mkdirSync(dir, { recursive: true });

  for (const entry of APP_ICON_ENTRIES) {
    await sharp(Buffer.from(svgSource))
      .resize(entry.size, entry.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(join(dir, entry.filename));
  }

  const contents = {
    images: APP_ICON_ENTRIES.map((e) => ({
      filename: e.filename,
      idiom: 'mac',
      scale: `${e.scale}x`,
      size: e.sizeLabel,
    })),
    info: { author: 'xcode', version: 1 },
  };
  writeFileSync(join(dir, 'Contents.json'), JSON.stringify(contents, null, 2) + '\n');
}

// --- Root asset catalog Contents.json ---

function writeRootContents() {
  mkdirSync(ASSETS_DIR, { recursive: true });
  const contents = {
    info: { author: 'xcode', version: 1 },
  };
  writeFileSync(join(ASSETS_DIR, 'Contents.json'), JSON.stringify(contents, null, 2) + '\n');
}

// --- Main ---

async function main() {
  console.log('Generating macOS icon assets...');
  writeRootContents();
  await generateMenuBarIcons();
  console.log('  Menu bar template images generated');
  await generateAppIcons();
  console.log('  App icon PNGs generated');
  console.log('Done! Assets written to:', ASSETS_DIR);
}

main().catch((err) => {
  console.error('Failed to generate icons:', err);
  process.exit(1);
});
