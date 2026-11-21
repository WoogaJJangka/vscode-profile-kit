// Bundles the extension (dist/extension.js) and the CLI (dist/cli.js) from src/.
// node esbuild.mjs [--production] [--watch]
// node esbuild.mjs --compat: only the compatibility check (out/compat.js, scripts/compat/check.ts; not in the VSIX)
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const compat = process.argv.includes('--compat');

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  platform: 'node',
  // VS Code 1.95 runs extensions on Node 20 (engines.vscode)
  target: 'node20',
  format: 'cjs',
  // jsonc-parser's UMD build (main) requires ./impl/* at run time, which esbuild cannot bundle; use its ESM build
  mainFields: ['module', 'main'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

const builds = compat
  ? [{ ...common, entryPoints: ['scripts/compat/check.ts'], outfile: 'out/compat.js' }]
  : [
      { ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', external: ['vscode'] },
      { ...common, entryPoints: ['src/cli/index.ts'], outfile: 'dist/cli.js', banner: { js: '#!/usr/bin/env node' } },
      // manager panel UI, runs inside the webview (browser)
      {
        ...common,
        entryPoints: ['src/ui/panel/webview.ts'],
        outfile: 'dist/webview.js',
        platform: 'browser',
        format: 'iife',
        target: 'es2022',
      },
    ];

if (watch) {
  for (const options of builds) await (await esbuild.context(options)).watch();
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
