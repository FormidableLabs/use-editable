import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { 'use-editable': 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  target: 'es2022',
  clean: true,
  deps: { neverBundle: ['react'] },
  // Keep the filenames 2.x published (dist/use-editable.js, use-editable.es.js)
  // so `main`/`module` resolve exactly as before.
  outExtensions: ({ format }) =>
    format === 'cjs'
      ? { js: '.js', dts: '.d.ts' }
      : { js: '.es.js', dts: '.es.d.ts' },
  // Validate the published surface on every build.
  publint: true,
  attw: true,
});
