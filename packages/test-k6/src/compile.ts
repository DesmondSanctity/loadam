import type { IR } from "@loadam/core";
import { type AuthEmission, emitAuth } from "./auth.js";
import { type FixturePool, buildFixturePool } from "./fixtures.js";
import { defaultBaseUrl, sequenceForSmoke } from "./sequence.js";
import {
  emitConfigJs,
  emitEnvExample,
  emitFixturesJson,
  emitFlowJs,
  emitLoadJs,
  emitPackageJson,
  emitReadme,
  emitSmokeJs,
} from "./templates.js";

export interface CompileK6Options {
  /** Override the base URL inferred from IR.servers[0]. */
  baseUrl?: string;
  /** Number of fixtures pre-generated per slot. Default 10. */
  fixtureSize?: number;
  /** Deterministic seed for fixture generation. Default 1. */
  seed?: number;
}

export interface CompileK6Result {
  /** Map of relative file path → file contents. */
  files: Record<string, string>;
  /** The fixture pool (also serialised into files['fixtures.json']). */
  fixtures: FixturePool;
  /** Auth emission — names of env vars required at runtime + free-text notes. */
  auth: AuthEmission;
  /** Effective base URL written into the rig (for the CLI to surface). */
  baseUrl: string;
}

/**
 * Compile an IR into the set of files that make up a runnable k6 test rig.
 * Pure function: no filesystem writes — the CLI handles that.
 */
export function compileK6(ir: IR, opts: CompileK6Options = {}): CompileK6Result {
  const baseUrl = opts.baseUrl ?? defaultBaseUrl(ir);
  const sequencedOps = sequenceForSmoke(ir);
  const auth = emitAuth(ir);
  const fixtures = buildFixturePool(ir, {
    size: opts.fixtureSize,
    seed: opts.seed,
  });

  const ctx = { ir, baseUrl, sequencedOps, auth };

  const files: Record<string, string> = {
    "config.js": emitConfigJs(ctx),
    "flow.js": emitFlowJs(ctx),
    "smoke.js": emitSmokeJs(ctx),
    "load.js": emitLoadJs(ctx),
    "fixtures.json": emitFixturesJson(fixtures.byOperationId),
    "package.json": emitPackageJson(ctx),
    ".env.example": emitEnvExample(ctx),
    "README.md": emitReadme(ctx),
  };

  return { files, fixtures, auth, baseUrl };
}
