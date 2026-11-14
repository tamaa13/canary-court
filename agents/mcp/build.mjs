// Bundles src/ (and the agents' shared crypto/screening modules it imports) into one ESM file; npm deps stay external.
import { readFileSync, chmodSync } from 'node:fs';
import { build } from 'esbuild';
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
await build({
  entryPoints: ['src/index.ts'], outfile: 'dist/index.js', bundle: true, platform: 'node', format: 'esm', target: 'node20',
  packages: 'external', banner: { js: '#!/usr/bin/env node' }, define: { __VERSION__: JSON.stringify(version) }, logLevel: 'warning',
});
chmodSync('dist/index.js', 0o755);
console.error(`built dist/index.js (canary-court-mcp ${version})`);
