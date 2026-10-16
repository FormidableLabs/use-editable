---
'use-editable': major
---

Require React 18 or newer, and ship modern JavaScript.

- **Breaking:** the `react` peer dependency is now `>=18.0.0` (was `>=16.8.0`).
- **Breaking:** `dist/` now targets ES2022 instead of ES5. Bundlers that transpile `node_modules` for older browsers are unaffected.
- Types now live at `dist/use-editable.d.ts` (was `dist/types/index.d.ts`); the `types` field points there, so normal imports are unaffected. The `main` and `module` filenames are unchanged.
- The build moved from rollup, Babel, buble, closure-compiler and terser to tsdown; releases are published from CI with npm provenance.
