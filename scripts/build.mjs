import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/data', { recursive: true });
await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/app.js',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
});
await cp('data/myFocus.xlsx', 'dist/data/myFocus.xlsx');
await writeFile('dist/package.json', '{"type":"commonjs"}\n');
