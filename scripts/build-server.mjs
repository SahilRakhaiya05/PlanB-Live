import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('dist-server', { recursive: true });
await build({ entryPoints: ['api/handler.ts', 'api/webhook-worker.ts'], outdir: 'dist-server', bundle: true, platform: 'node', target: 'node22', format: 'cjs', minify: true, sourcemap: false });
await writeFile('dist-server/package.json', JSON.stringify({ type: 'commonjs' }));
