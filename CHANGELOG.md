# Changelog

All notable changes are documented here. The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to semantic versioning starting from `0.1.0`.

## [Unreleased]

## [0.2.0] - 2026-05-01

### Added

- **Interactive auth & run** — `loadam test` now detects required env vars from the spec's security schemes and prompts the user with masked password input, writes a real `.env` (mode 0600) instead of just `.env.example`, then offers to run smoke / load / both immediately.
- New `--mode <smoke|load|both|skip>` flag — selects what to run after generating the rig. Aliased shorthands considered for later (`--smoke` / `--load`).
- New `--no-interactive` flag — disables all prompts; CI mode also auto-detected via `CI` env var and non-TTY stdin.
- New `loadam test` JSON report fields: `envVars`, `envAction` (`wrote` / `skipped` / `not-needed`), `interactive`, `run` (with `mode`, `smokeExit`, `loadExit`).
- `k6` binary detection on PATH — friendly error with install link if missing instead of cryptic spawn failure.

### Changed

- `compileK6()` result now exposes `auth` and `baseUrl` so consumers can inspect required env vars without re-walking the IR.
- `.env` file written on interactive runs preserves existing keys by default; reports which keys were written vs preserved.
- Honours env vars already set in the parent shell — no prompt for vars that are already in scope.

## [0.1.2] - 2026-05-01

### Fixed

- `loadam --version` now reports the actual package version instead of a hardcoded `0.0.0`. Version is injected at build time from [packages/cli/package.json](packages/cli/package.json) via tsup `define`.

## [0.1.1] - 2026-05-01

### Changed

- Package metadata: added `keywords`, `homepage`, `repository`, `bugs`, `license` fields so the npm page shows GitHub link, issue tracker, and Apache-2.0 badge.
- README demo image switched to absolute `raw.githubusercontent.com` URL so it renders on the npm page (not just on GitHub).

### Released via

- First release published through the automated GitHub Actions workflow with npm Trusted Publishing (OIDC) — verifies the end-to-end release pipeline.

## [0.1.0] - 2026-05-01

### Added

- **`@loadam/core`** — IR Zod schemas (`IR_VERSION = '1'`) and OpenAPI 3.x adapter (`fromOpenApi`, `fromOpenApiFile`).
- **`@loadam/graph`** — heuristic resource-graph inference (Pet → Order → User), `renderGraphTree` for the CLI tree view.
- **`@loadam/data`** — stateful faker over `json-schema-faker` with deterministic seed and registry overlay.
- **`@loadam/auth`** — auth profile types + `importCurl` tokenizer (bearer / apiKey / basic).
- **`@loadam/test-k6`** — IR → 8-file k6 rig (`smoke.js`, `load.js`, `flow.js`, `config.js`, `fixtures.json`, `package.json`, `.env.example`, `README.md`); stateful ID threading via per-iteration `state` map.
- **`@loadam/test-contract`** — IR → Schemathesis pytest project (pyproject + conftest + property-based tests + embedded spec).
- **`@loadam/test-drift`** — live API probe + Markdown diff report; severity-aware (`error` / `warning` / `info`); shared `countBySeverity` helper.
- **`@loadam/mcp`** — IR → runnable MCP server emitter (8-file ESM JS project): `bin.js` (stdio + Streamable HTTP), `server.js` (low-level `Server` API w/ `ListTools` + `CallTool`), `tools.js`, `client.js`, `auth.js`. Pinned to `@modelcontextprotocol/sdk@^1.29.0`. Read-only by default; `--writes` opts in mutating ops.
- **`loadam`** — commands: `init`, `test`, `contract`, `mcp`, `diff`, `auth import`, `completion`, `update`. Every command supports `--json` for CI use. Friendly errors for `ZodError`, `ENOENT`, parse errors. ASCII banner on `--help` and bare invocation.

### Tooling & Distribution

- GitHub Actions CI matrix (Ubuntu/macOS × Node 20/22): lint + build + test.
- Single-package distribution: `tsup` bundles all `@loadam/*` workspace deps into `packages/cli` so `npm i -g loadam` (or `npx`) installs without exposing internal scopes.
- Husky pre-commit (lint-staged) + pre-push (full lint + build + test) hooks.
- `loadam update` self-check against the npm registry (3s timeout, no telemetry).
- Bash / zsh / fish shell completions via `loadam completion <shell>`.
- No-telemetry stance documented in [SECURITY.md](SECURITY.md) and README.
- Animated demo at [.github/assets/demo.svg](.github/assets/demo.svg), regenerable with `pnpm demo` (deterministic asciicast synthesized from real CLI output).
- Automated release workflow ([.github/workflows/release.yml](.github/workflows/release.yml)): on push to `main`, compares `loadam` version to npm and — if changed — publishes with provenance, tags `vX.Y.Z`, and creates a GitHub Release.

### Verified

- Petstore: end-to-end run for k6 (smoke 4/4 ops 2xx, p95 ≈ 12 ms vs Prism), MCP (Claude Desktop + custom MCP client driver list & call tools), drift (deliberately-stale fixture produces 2 errors with precise instance paths).
- Multi-spec smoke: `test` + `mcp` + `contract` complete cleanly on `httpbin-mini` (no auth) and `bookstore` (bearer + multi-server) without code changes.
- 101 tests passing across 9 packages.
