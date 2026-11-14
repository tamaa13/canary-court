// Bundles src/cli/keep-open.ts and ALL its dependencies into one ESM file (no install needed to run it):
//   node scripts/build-keeper.mjs → dist-keeper/keep-open.mjs   (run with Node 24: node keep-open.mjs --once)
import { build } from 'esbuild';
await build({
  entryPoints: ['src/cli/keep-open.ts'], outfile: 'dist-keeper/keep-open.mjs', bundle: true, platform: 'node', format: 'esm',
  target: 'node24', minify: false, legalComments: 'none', logLevel: 'warning',
  banner: { js: "import { createRequire as __ccRequire } from 'node:module'; const require = __ccRequire(import.meta.url);" },
});
console.error('built dist-keeper/keep-open.mjs');
