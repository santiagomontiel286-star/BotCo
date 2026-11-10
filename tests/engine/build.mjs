// Empaqueta tradingLoop con el SDK de Base44 simulado y ejecuta los escenarios de run.mjs
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
await esbuild.build({
  entryPoints: [path.join(here, '../../base44/functions/tradingLoop/entry.ts')], bundle: true, format: 'esm', platform: 'node', outfile: path.join(here, '.loop.mjs'),
  plugins: [{ name: 'sdk', setup(b) { b.onResolve({ filter: /^npm:@base44/ }, () => ({ path: path.join(here, 'sdkmock.mjs') })); } }],
});
