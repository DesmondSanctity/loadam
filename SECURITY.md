# Security policy

## Reporting a vulnerability

Please report security issues privately by emailing the maintainers (open an issue with no details, asking for a private contact, if you do not have one). Do **not** open public GitHub issues describing security problems.

We aim to acknowledge receipt within two business days and to ship a patch (or coordinate a disclosure timeline) within 14 days of confirmed reports.

## What loadam does and does not do with secrets

- **Generated code never inlines secrets.** Every emitted rig (k6, contract, MCP) reads credentials from environment variables. The `.env.example` files emitted next to the rigs are stubs only.
- **`auth import` does not echo the secret back into the inferred profile.** The raw curl is preserved alongside the profile for debugging, so you should never commit the raw output verbatim — it _will_ contain whatever you pasted in.
- **`loadam diff` is safe-only by default.** The live probe sends only GET / HEAD / OPTIONS unless `--mutating` is passed. Never run `--mutating` against a production database.
- **The MCP server is read-only by default.** Re-running with `--writes` opts in to mutating operations. Audit the generated `tools.js` before connecting it to a writable backend.
- **No telemetry.** loadam ships zero analytics, crash reporting, or phone-home. The CLI makes outbound network requests only when you explicitly run `loadam diff <spec> --target <url>`. Generated rigs make outbound requests to whatever target you configure. Nothing else.

## Scope

In scope: code in this repository, generated rigs, CLI behaviour. Out of scope: bugs in the upstream APIs you point loadam at, bugs in `@modelcontextprotocol/sdk` (please report those upstream).
