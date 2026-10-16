# Contributing to use-editable

Thanks for contributing! This guide covers the local dev workflow and how releases work.

## Setup

Node LTS -- `nvm use` picks it up from `.nvmrc`.

```sh
npm install
```

## Commands

```sh
npm run check     # format + types -- run this before opening a PR
npm run format    # auto-fix formatting (prettier)
npm run build     # build dist/ with tsdown (also runs publint + attw)
```

There are no git hooks; CI runs `npm run check` and `npm run build` on every PR, plus a
typecheck against React 18.0.0, the bottom of the `react` peer range.

## Changesets

Any PR that changes the published package needs a changeset:

```sh
npm run changeset
```

Pick the bump (`patch` / `minor` / `major`), write a one-line summary for the changelog, and
commit the generated `.changeset/*.md` file with your PR. The changelog entry links to the PR
and its author automatically. Docs-, CI-, or tooling-only PRs don't need one.

## Releasing

Automated. Merging PRs with changesets to `main` opens (or updates) a **"Version Packages"**
PR; merging that publishes to npm over GitHub OIDC
([trusted publishing](https://docs.npmjs.com/trusted-publishers/)), so no npm token is stored
and provenance is attached automatically. The publish job requires approval in the
`Production` environment.

To inspect the tarball locally, use `npm pack` — not `npm pack --dry-run`. The build runs
publint and attw, which pack the package themselves, and the nested pack inherits the
`--dry-run` flag and finds no tarball. The release path is unaffected.
