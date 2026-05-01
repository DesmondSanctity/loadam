import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fromOpenApiFile, parseIR } from "@loadam/core";
import { inferResourceGraph } from "@loadam/graph";
import { compileK6 } from "@loadam/test-k6";
import type { Command } from "commander";
import { withFriendlyErrors } from "../util/errors.js";
import {
  type RunMode,
  confirmContinue,
  isInteractive,
  promptForAuthEnv,
  promptForMode,
  writeEnvFile,
} from "../util/interactive.js";
import { findK6Binary, runK6 } from "../util/k6.js";
import { makeOutput } from "../util/output.js";

const VALID_MODES: RunMode[] = ["smoke", "load", "both", "skip"];

interface TestOptions {
  output: string;
  target?: string;
  fixtureSize?: string;
  seed?: string;
  json?: boolean;
  mode?: string;
  noInteractive?: boolean;
}

export function registerTestCommand(program: Command): void {
  program
    .command("test")
    .description("Compile an OpenAPI spec into a runnable k6 test rig (smoke + load).")
    .argument("<spec>", "path to OpenAPI 3.x spec (YAML or JSON)")
    .option("-o, --output <dir>", "output directory for the generated rig", "./loadam-out/k6")
    .option(
      "--target <url>",
      "override base URL baked into config.js (env BASE_URL still wins at runtime)",
    )
    .option("--fixture-size <n>", "number of fixtures per slot", "10")
    .option("--seed <n>", "deterministic seed for fixture generation", "1")
    .option(
      "--mode <mode>",
      "run after generating: smoke | load | both | skip (default: prompt if interactive, skip otherwise)",
    )
    .option("--no-interactive", "disable all prompts (CI mode)", false)
    .option("--json", "emit a single JSON summary on stdout (CI mode)", false)
    .action(withFriendlyErrors(runTest));
}

export async function runTest(spec: string, opts: TestOptions): Promise<void> {
  const out = makeOutput(!!opts.json);
  const specPath = resolve(spec);
  out.start(`Parsing OpenAPI spec: ${specPath}`);

  const ir = await fromOpenApiFile(specPath);
  inferResourceGraph(ir);
  parseIR(ir);

  const fixtureSize = Number.parseInt(opts.fixtureSize ?? "10", 10);
  const seed = Number.parseInt(opts.seed ?? "1", 10);

  const result = compileK6(ir, {
    baseUrl: opts.target,
    fixtureSize: Number.isFinite(fixtureSize) ? fixtureSize : 10,
    seed: Number.isFinite(seed) ? seed : 1,
  });

  const outDir = resolve(opts.output);
  await mkdir(outDir, { recursive: true });
  for (const [rel, contents] of Object.entries(result.files)) {
    const full = resolve(outDir, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, contents, "utf8");
  }

  const fileCount = Object.keys(result.files).length;
  const fixtureCount = Object.keys(result.fixtures.byOperationId).length;
  out.success(`Wrote ${fileCount} files to ${outDir}`);
  out.info(
    `  ${ir.operations.length} operations  ·  ${fixtureCount} ops with fixtures  ·  ${result.fixtures.size} samples each`,
  );

  // Decide interactive vs scripted.
  const interactive = !opts.json && isInteractive(!!opts.noInteractive);
  const requestedMode = parseModeFlag(opts.mode);

  let envAction: "wrote" | "skipped" | "not-needed" = "not-needed";
  let runResult: { mode: RunMode; smokeExit?: number; loadExit?: number } | null = null;

  if (interactive) {
    // Prompt for any missing auth env vars, then write a real .env.
    if (result.auth.envVars.length > 0) {
      out.step("");
      out.info(
        `Detected ${result.auth.envVars.length} required env var(s): ${result.auth.envVars.join(", ")}`,
      );
      for (const note of result.auth.notes) out.info(`  ${note}`);
      const collected = await promptForAuthEnv(result.auth.envVars, process.env);
      const usedFromShell = result.auth.envVars.filter((v) => process.env[v] && !(v in collected));
      const written = await writeEnvFile(outDir, result.baseUrl, collected);
      envAction = "wrote";
      out.success(`Wrote ${written.path} (mode 0600)`);
      if (usedFromShell.length > 0) {
        out.info(`  Using from shell: ${usedFromShell.join(", ")}`);
      }
      if (written.preserved.length > 0) {
        out.info(`  Preserved existing keys: ${written.preserved.join(", ")}`);
      }
    } else {
      // Still write BASE_URL so the user has a starting .env.
      const written = await writeEnvFile(outDir, result.baseUrl, {});
      out.success(`Wrote ${written.path}`);
      envAction = "wrote";
    }

    // Pick run mode.
    const mode = requestedMode ?? (await promptForMode());
    runResult = await maybeRun(mode, outDir, out);
  } else {
    // Non-interactive: respect --mode if passed, otherwise just generate (skip).
    const mode = requestedMode ?? "skip";
    if (mode !== "skip") {
      runResult = await maybeRun(mode, outDir, out);
    } else if (!out.json) {
      out.step("");
      out.step("Next steps:");
      out.step(`  cd ${opts.output}`);
      out.step("  cp .env.example .env  # fill in credentials");
      out.step("  k6 run smoke.js");
    }
  }

  out.result({
    command: "test",
    outputDir: outDir,
    files: fileCount,
    operations: ir.operations.length,
    fixtureOps: fixtureCount,
    fixtureSize: result.fixtures.size,
    envVars: result.auth.envVars,
    envAction,
    interactive,
    run: runResult,
  });

  if (runResult) {
    if (
      (runResult.smokeExit && runResult.smokeExit !== 0) ||
      (runResult.loadExit && runResult.loadExit !== 0)
    ) {
      process.exitCode = 1;
    }
  }
}

function parseModeFlag(raw: string | undefined): RunMode | null {
  if (!raw) return null;
  if (!VALID_MODES.includes(raw as RunMode)) {
    throw new Error(`Invalid --mode value "${raw}". Expected one of: ${VALID_MODES.join(", ")}.`);
  }
  return raw as RunMode;
}

async function maybeRun(
  mode: RunMode,
  cwd: string,
  out: ReturnType<typeof makeOutput>,
): Promise<{ mode: RunMode; smokeExit?: number; loadExit?: number } | null> {
  if (mode === "skip") return { mode };

  // Verify k6 is on PATH before we promise the user a run.
  const bin = await findK6Binary();
  if (!bin) {
    out.info("");
    out.info("k6 binary not found on PATH. Skipping run.");
    out.info("Install: https://grafana.com/docs/k6/latest/set-up/install-k6/");
    return { mode: "skip" };
  }

  const result: { mode: RunMode; smokeExit?: number; loadExit?: number } = { mode };

  if (mode === "smoke" || mode === "both") {
    if (!out.json) {
      out.step("");
      out.step("Running k6 smoke test...");
    }
    result.smokeExit = await runK6({ cwd, script: "smoke.js" });
  }
  if (mode === "load" || mode === "both") {
    if (mode === "both") {
      const cont = await confirmContinue("Smoke complete. Continue with load test?");
      if (!cont) return result;
    }
    if (!out.json) {
      out.step("");
      out.step("Running k6 load test...");
    }
    result.loadExit = await runK6({ cwd, script: "load.js" });
  }
  return result;
}
