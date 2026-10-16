import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { 'use-editable': 'src/index.ts' },
  // Types come from the CJS build only: without an `exports` map, `types` is
  // the only declaration consumers resolve, so an ESM copy would go unused.
  format: { esm: { dts: false }, cjs: { dts: true } },
  sourcemap: true,
  target: 'es2022',
  clean: true,
  deps: { neverBundle: ['react'] },
  // Keep the filenames 2.x published (dist/use-editable.js, use-editable.es.js)
  // so `main`/`module` resolve exactly as before.
  outExtensions: ({ format }) =>
    format === 'cjs' ? { js: '.js', dts: '.d.ts' } : { js: '.es.js' },
  // Validate the published surface on every build.
  publint: true,
  attw: true,
});
