// Build script for the Fire plugin.
//
// Even Hub plugins are static web bundles loaded inside the Even App WebView.
// `entrypoint` in app.json must resolve to a real file inside the packed
// folder, so we emit a self-contained dist/ (index.html + inlined bundle)
// that `evenhub pack app.json dist` can consume directly.

import { build, context } from 'esbuild';
import { rm, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const outdir = resolve(root, 'dist');
const watch = process.argv.includes('--watch');

async function clean() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
}

/** Copy static assets (html shell, icons) into dist/. */
async function copyStatic() {
  await cp(resolve(root, 'src/index.html'), resolve(outdir, 'index.html'));
  if (existsSync(resolve(root, 'assets'))) {
    await cp(resolve(root, 'assets'), resolve(outdir, 'assets'), { recursive: true });
  }
}

const buildOptions = {
  entryPoints: [resolve(root, 'src/main.ts')],
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  outfile: resolve(outdir, 'app.js'),
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
};

async function run() {
  await clean();
  await copyStatic();
  if (watch) {
    const ctx = await context({
      ...buildOptions,
      plugins: [
        {
          name: 'copy-static-on-rebuild',
          setup(b) {
            b.onEnd(() => copyStatic());
          },
        },
      ],
    });
    await ctx.watch();
    console.log('watching for changes…');
  } else {
    await build(buildOptions);
    // Sanity: entrypoint must exist in the output folder.
    const html = await readFile(resolve(outdir, 'index.html'), 'utf8');
    if (!html.includes('app.js')) {
      await writeFile(resolve(outdir, 'index.html'), html); // no-op guard
      throw new Error('index.html does not reference app.js');
    }
    console.log('build complete → dist/');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
