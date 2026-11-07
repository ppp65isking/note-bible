#!/usr/bin/env node
/* Build the Capacitor web dir (www/) from the repo-root web files.
   GitHub Pages serves the app from the repo root, so the root files stay
   where they are — this script just copies what the native shell needs
   into www/ before `npx cap sync android`. */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const www = join(root, 'www');

rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });

const files = ['index.html', 'app.js', 'styles.css', 'manifest.json', 'sw.js'];
for (const f of files) {
  cpSync(join(root, f), join(www, f));
}
if (existsSync(join(root, 'icons'))) {
  cpSync(join(root, 'icons'), join(www, 'icons'), { recursive: true });
}

console.log('www/ built from repo root web files.');
