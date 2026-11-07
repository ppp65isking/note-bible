#!/usr/bin/env node
/* Prepare the source images for `@capacitor/assets` (Easy Mode).
   The launcher icon + splash are generated from the app's own icon
   (icons/icon-512.png — the pastel open-book-with-heart) so the native
   app gets our icon instead of Capacitor's default.
   The `resources/` folder is created here at build time (and is NOT
   committed — the icon PNGs are binary and can't go through the text
   push path, so the source of truth stays icons/icon-512.png). */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const resources = join(root, 'resources');
mkdirSync(resources, { recursive: true });

const src = join(root, 'icons', 'icon-512.png');
if (!existsSync(src)) {
  console.error('prepare-assets: icons/icon-512.png not found — cannot generate app icons.');
  process.exit(1);
}
// Easy Mode uses a single logo for both the icon layers and the splash
// (centered on the background color passed to `generate`).
cpSync(src, join(resources, 'icon.png'));
cpSync(src, join(resources, 'splash.png'));
console.log('prepare-assets: resources/icon.png + resources/splash.png ready.');
