# Contributing to loadam

Thanks for considering a contribution. Loadam is OSS under Apache 2.0 — patches, bug reports, and design feedback are all welcome.

## Quick start

```bash
git clone https://github.com/your-org/loadam.git
cd loadam
pnpm install
pnpm -r build
pnpm -r test
```

Requires Node 20+, pnpm 9.15+.

## How the codebase is organised

The project is a pnpm monorepo, split by responsibility (see [README — Project layout](README.md#project-layout)). Anything an _adapter_ produces and any _compiler_ consumes is the **IR** (the Zod schema in `packages/core/src/ir/schema.ts`). Touching the IR is a breaking change within `version: '1'`; adopt additive-only changes wherever possible.

```
input adapters → IR → compilers
  openapi          test-k6, test-contract, test-drift, mcp
```

## Coding conventions

- TypeScript strict + ESM throughout. No CommonJS.
- [Biome](https://biomejs.dev/) for formatting and linting (1-space indent, single quotes). Run `pnpm fix` before pushing.
- Comments explain _why_, not _what_. Skip docstrings on self-evident code; do explain non-obvious tradeoffs.
- Keep emitted (generated) code human-readable. The output is going to be reviewed in PRs by users.
- Avoid defensive coding for impossible scenarios. Validate at boundaries (`parseIR()` after every adapter) and trust internal invariants.

## Tests

Every package ships goldens against [fixtures/specs/petstore.openapi.yaml](fixtures/specs/petstore.openapi.yaml). When adding behaviour:

1. Add a unit test in the package's `test/` directory.
2. If your change crosses package boundaries, add a CLI integration test in [packages/cli/test/cli.test.ts](packages/cli/test/cli.test.ts).
3. If your change affects emitted code, run a manual end-to-end against [Prism](https://stoplight.io/open-source/prism) (`npx @stoplight/prism-cli mock fixtures/specs/petstore.openapi.yaml`).

CI must stay green: `pnpm -r build && pnpm -r test`.

## Git hooks

`pnpm install` wires up [husky](https://typicode.github.io/husky):

- **pre-commit**: `lint-staged` runs `biome check --write` on staged files.
- **pre-push**: full `pnpm lint && pnpm -r build && pnpm -r test` guard. Do not push if it fails.

To bypass in an emergency: `git push --no-verify` (don't ship to `main` like this).

## Submitting changes

1. Open an issue first for non-trivial work — saves rework on direction.
2. Branch off `main`. Squash-merge friendly commits.
3. Add a `CHANGELOG.md` entry under `[Unreleased]`.
4. Confirm the new behaviour shows up in `--json` mode if it's user-facing — CI consumers depend on stable JSON shapes.

## Releases

Releases are automated. To cut one:

1. Bump the version in [packages/cli/package.json](packages/cli/package.json).
2. Move items from `[Unreleased]` to a new versioned section in [CHANGELOG.md](CHANGELOG.md).
3. Merge to `main`.

The [Release workflow](.github/workflows/release.yml) compares the local `loadam` version against npm. If different, it runs lint + build + test, publishes with provenance, tags `vX.Y.Z`, and creates a GitHub Release.

Authentication uses **npm Trusted Publishing** (OIDC) — no `NPM_TOKEN` secret is stored. To set up: on npmjs.com → `loadam` → Settings → Trusted Publisher, register this repo with workflow filename `release.yml`. Requires npm CLI ≥ 11.5.1 (the workflow installs it).

## Security

Don't open public issues for security reports. See [SECURITY.md](SECURITY.md) (or email the maintainers privately) for the disclosure process.

## Licensing

By submitting a pull request you agree your contribution is licensed under [Apache 2.0](LICENSE).
