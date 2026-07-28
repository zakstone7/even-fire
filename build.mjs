// Build script for the Fire plugin.
//
// Even Hub plugins are static web bundles loaded inside the Even App WebView.
// `entrypoint` in app.json must resolve to a real file inside the packed
// folder, so we emit a self-contained dist/ (index.html + inlined bundle)
// that `evenhub pack app.json dist` can consume directly.
//
// Flags:
//   --watch          rebuild on source changes (esbuild watch)
//   --serve          host dist/ over HTTP on the LAN (for `evenhub qr` sideload)
//   --port <n>       serve port (default 8080)
//
// `npm run dev` = --watch --serve: edit, save, re-open in the Even App to reload.

import { build, context } from 'esbuild';
import { rm, mkdir, cp, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { dirname, resolve, join, normalize, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const outdir = resolve(root, 'dist');
const argv = process.argv.slice(2);
const watch = argv.includes('--watch');
const serve = argv.includes('--serve');
const portArg = argv[argv.indexOf('--port') + 1];
const port = argv.includes('--port') && portArg ? Number(portArg) : 8080;

async function clean() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
}

/** Pick the hashed JS bundle name (e.g. app-XZ3K9Q2A.js) from the metafile. */
function bundleName(metafile) {
  const out = Object.keys(metafile?.outputs ?? {}).find((p) => p.endsWith('.js'));
  return out ? basename(out) : 'app.js';
}

/**
 * Emit index.html (pointing at the current hashed bundle) + copy assets, and
 * prune any stale app-*.js from previous builds. The content hash means every
 * change produces a new filename, so a CDN (GitHub Pages) can never serve a
 * stale bundle — reloads reflect the latest deploy immediately.
 */
async function emitHtmlAndAssets(jsFile) {
  for (const f of await readdir(outdir)) {
    if (/^app-.*\.js(\.map)?$/.test(f) && f !== jsFile && f !== `${jsFile}.map`) {
      await rm(join(outdir, f), { force: true });
    }
  }
  const template = await readFile(resolve(root, 'src/index.html'), 'utf8');
  const html = template.replace('./app.js', `./${jsFile}`);
  if (!html.includes(jsFile)) throw new Error('index.html has no ./app.js placeholder to hash');
  await writeFile(resolve(outdir, 'index.html'), html);
  if (existsSync(resolve(root, 'assets'))) {
    await cp(resolve(root, 'assets'), resolve(outdir, 'assets'), { recursive: true });
  }
}

const buildOptions = {
  // Object form fixes the output base name to `app` (→ app-[hash].js).
  entryPoints: { app: resolve(root, 'src/main.ts') },
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  outdir,
  entryNames: '[name]-[hash]',
  metafile: true,
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
};

/** List non-internal IPv4 addresses, so you can pick the one the phone sees. */
function lanAddresses() {
  const out = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

/** Minimal static file server for dist/. Binds 0.0.0.0 so the phone can reach it. */
function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      // Prevent path traversal; default to index.html.
      let rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
      if (rel === '/' || rel === '') rel = '/index.html';
      let filePath = join(outdir, rel);
      if (!filePath.startsWith(outdir)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      let s = await stat(filePath).catch(() => null);
      if (s?.isDirectory()) {
        filePath = join(filePath, 'index.html');
        s = await stat(filePath).catch(() => null);
      }
      if (!s) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      res.writeHead(200, {
        'content-type': MIME[extname(filePath)] || 'application/octet-stream',
        'cache-control': 'no-store',
        // The WebView loads same-origin; keep CORS open for the simulator too.
        'access-control-allow-origin': '*',
      });
      createReadStream(filePath).pipe(res);
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
  server.listen(port, '0.0.0.0', () => {
    const ips = lanAddresses();
    const ip = ips[0] || 'localhost';
    console.log(`\nServing dist/ on:`);
    console.log(`  http://localhost:${port}/`);
    for (const a of ips) console.log(`  http://${a}:${port}/   (LAN)`);
    console.log(`\nSideload on device — generate the QR for the LAN address:`);
    console.log(`  npx @evenrealities/evenhub-cli qr --ip ${ip} --port ${port}`);
    console.log(`\n(Phone + computer on the same Wi-Fi, no AP isolation. Ctrl-C to stop.)\n`);
  });
}

async function run() {
  await clean();

  if (watch) {
    const ctx = await context({
      ...buildOptions,
      plugins: [
        {
          name: 'emit-html-on-rebuild',
          setup: (b) =>
            b.onEnd((result) => {
              if (result.metafile) return emitHtmlAndAssets(bundleName(result.metafile));
            }),
        },
      ],
    });
    await ctx.watch();
    console.log('watching for changes…');
  } else {
    const result = await build(buildOptions);
    await emitHtmlAndAssets(bundleName(result.metafile));
    console.log('build complete → dist/');
  }

  if (serve) startServer();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
