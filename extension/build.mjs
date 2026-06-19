import * as esbuild from 'esbuild';
import { execSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = join(__dirname, 'dist');
const watch = process.argv.includes('--watch');

const extensionServerUrl = process.env.EXTENSION_SERVER_URL || 'http://localhost:3001';
const extensionWebOrigins = (process.env.EXTENSION_WEB_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const manifest = JSON.parse(readFileSync(join(__dirname, 'manifest.json'), 'utf8'));

const esbuildDefine = {
  __PW_DEFAULT_SERVER__: JSON.stringify(extensionServerUrl),
  __PW_BUILTIN_WEB_ORIGINS__: JSON.stringify(extensionWebOrigins),
  __PW_EXTENSION_VERSION__: JSON.stringify(manifest.version),
  __PW_GITHUB_REPO__: JSON.stringify(
    process.env.PW_GITHUB_REPO || 'LuckyValenok/parralell-watching'
  ),
};

mkdirSync(dist, { recursive: true });

const sharedBanner = {
  js: 'if (typeof globalThis.browser === "undefined") { globalThis.browser = chrome; }',
};

const builds = [
  { entry: 'src/background.ts', outfile: 'dist/background.js' },
  { entry: 'src/content.ts', outfile: 'dist/content.js' },
  { entry: 'src/web-bridge.ts', outfile: 'dist/web-bridge.js' },
  { entry: 'src/popup.ts', outfile: 'dist/popup.js' },
];

async function buildAll() {
  for (const b of builds) {
    const ctx = await esbuild.context({
      entryPoints: [join(__dirname, b.entry)],
      bundle: true,
      outfile: join(__dirname, b.outfile),
      format: 'esm',
      target: 'chrome110',
      banner: sharedBanner,
      define: esbuildDefine,
    });

    if (watch) {
      await ctx.watch();
    } else {
      await ctx.rebuild();
      await ctx.dispose();
    }
  }

  copyFileSync(join(__dirname, 'manifest.json'), join(dist, 'manifest.json'));
  copyFileSync(join(__dirname, 'src/popup.html'), join(dist, 'popup.html'));
  copyFileSync(join(__dirname, 'src/popup.css'), join(dist, 'popup.css'));

  const iconsDir = join(dist, 'icons');
  mkdirSync(iconsDir, { recursive: true });
  for (const size of [16, 48, 128]) {
    writeFileSync(join(iconsDir, `icon${size}.png`), minimalPng(size));
  }

  console.log(watch ? 'Watching extension...' : 'Extension built → extension/dist/');
  if (!watch) createArchive();
}

function createArchive() {
  const archiveName = `parallel-watching-extension-v${manifest.version}.zip`;
  const zipPath = join(__dirname, archiveName);

  for (const stray of [join(dist, archiveName), join(dist, 'dist.zip')]) {
    if (existsSync(stray)) rmSync(stray);
  }
  if (existsSync(zipPath)) rmSync(zipPath);

  execSync(`zip -r ${JSON.stringify(zipPath)} . -x '*.zip'`, { cwd: dist, stdio: 'inherit' });

  console.log(`Archive → extension/${archiveName}`);
}

function minimalPng(size) {
  void size;
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
}

buildAll().catch(console.error);
