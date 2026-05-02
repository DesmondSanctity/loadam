import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fromOpenApiFile, parseIR } from "@loadam/core";
import { inferResourceGraph } from "@loadam/graph";
import { compileK6 } from "@loadam/test-k6";
import type { Command } from "commander";
import { type ActiveSession, createSession } from "../session/index.js";
import { withFriendlyErrors } from "../util/errors.js";
import {
  type RunMode,
  confirmContinue,
  isInteractive,
  promptForAuthEnv,
  promptForMode,
  writeEnvFile,
} from "../util/interactive.js";
import { digestK6Summary, findK6Binary, runK6 } from "../util/k6.js";
import { makeOutput } from "../util/output.js";
import { resolveTarget } from "../util/target.js";

const VALID_MODES: RunMode[] = ["smoke", "load", "both", "skip"];

interface TestOptions {
  output: string;
  target?: string;
  fixtureSize?: string;
  seed?: string;
  json?: boolean;
  mode?: string;
  /** Commander binds `--no-interactive` to `opts.interactive = false` (default true). */
  interactive?: boolean;
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

  const specSource = await readFile(specPath, "utf8");
  const ir = await fromOpenApiFile(specPath);
  inferResourceGraph(ir);
  parseIR(ir);
  out.success(`Parsed ${ir.operations.length} operation${ir.operations.length === 1 ? "" : "s"}`);

  const fixtureSize = Number.parseInt(opts.fixtureSize ?? "10", 10);
  const seed = Number.parseInt(opts.seed ?? "1", 10);
  const target = resolveTarget(opts.target);

  out.start(
    `Generating k6 scripts for ${ir.operations.length} operation${ir.operations.length === 1 ? "" : "s"}…`,
  );
  const result = compileK6(ir, {
    baseUrl: target,
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
  // Commander sets `opts.interactive` to `false` when `--no-interactive` is
  // passed, and leaves it `undefined` otherwise (so default = enabled).
  const noInteractiveFlag = opts.interactive === false;
  const interactive = !opts.json && isInteractive(noInteractiveFlag);
  const requestedMode = parseModeFlag(opts.mode);

  let envAction: "wrote" | "skipped" | "not-needed" = "not-needed";
  let runResult: { mode: RunMode; smokeExit?: number; loadExit?: number } | null = null;

  // Resolve mode + env first so the session can record both before any run.
  let mode: RunMode;
  if (interactive) {
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
      const written = await writeEnvFile(outDir, result.baseUrl, {});
      out.success(`Wrote ${written.path}`);
      envAction = "wrote";
    }
    mode = requestedMode ?? (await promptForMode());
  } else {
    mode = requestedMode ?? "skip";
  }

  // Always archive the run, including skip — generation alone is a recordable event.
  const session: ActiveSession = await createSession({
    command: "test",
    outRoot: getSessionRoot(outDir),
    specPath,
    specSource,
    ir,
    irJson: JSON.stringify(ir, null, 2),
    target: target ?? result.baseUrl,
    envVars: result.auth.envVars,
    flags: {
      mode,
      target: target ?? null,
      fixtureSize,
      seed,
      noInteractive: noInteractiveFlag,
      json: !!opts.json,
    },
    slug: `${mode}-${ir.meta.title ?? "run"}`,
  });
  if (!out.json) out.info(`  Session: ${session.id}`);

  if (mode !== "skip") {
    runResult = await maybeRunWithSession({ mode, cwd: outDir, out, session, interactive });
  } else if (!interactive && !out.json) {
    out.step("");
    out.step("Next steps:");
    out.step(`  cd ${opts.output}`);
    out.step("  cp .env.example .env  # fill in credentials");
    out.step("  k6 run smoke.js");
  }

  // Finalize when we didn't run (maybeRunWithSession finalizes itself).
  if (mode === "skip") {
    await session.finalize({
      exitCode: 0,
      thresholds: { passed: [], failed: [] },
      summary: {
        operations: ir.operations.length,
        fixtureOps: fixtureCount,
        files: fileCount,
      },
    });
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
    sessionId: session.id,
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

/**
 * Resolve the directory used as the session-archive root. Sessions live next
 * to the rig output (./loadam-out/sessions/), regardless of where the rig was
 * written, so different rigs from the same workspace share a history.
 */
function getSessionRoot(outDir: string): string {
  // outDir typically ends with /loadam-out/k6 — climb to ./loadam-out
  return resolve(outDir, "..");
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

interface MaybeRunInput {
  mode: RunMode;
  cwd: string;
  out: ReturnType<typeof makeOutput>;
  session: ActiveSession;
  interactive: boolean;
}

async function maybeRunWithSession(
  input: MaybeRunInput,
): Promise<{ mode: RunMode; smokeExit?: number; loadExit?: number } | null> {
  const { mode, cwd, out, session, interactive } = input;
  if (mode === "skip") return { mode };

  const bin = await findK6Binary();
  if (!bin) {
    out.info("");
    out.info("k6 binary not found on PATH. Skipping run.");
    out.info("Install: https://grafana.com/docs/k6/latest/set-up/install-k6/");
    await session.finalize({
      exitCode: 0,
      thresholds: { passed: [], failed: [] },
      summary: { skipped: "k6 not installed" },
    });
    return { mode: "skip" };
  }

  const result: { mode: RunMode; smokeExit?: number; loadExit?: number } = { mode };
  const allPassed: string[] = [];
  const allFailed: string[] = [];
  const summary: Record<string, number | string> = {};

  if (mode === "smoke" || mode === "both") {
    if (!out.json) {
      out.step("");
      out.step("Running k6 smoke test...");
    }
    const summaryPath = join(session.dir, "k6-smoke-summary.json");
    result.smokeExit = await runK6({ cwd, script: "smoke.js", summaryPath });
    if (await fileExists(summaryPath)) session.registerArtefact("k6-smoke-summary.json");
    const digest = await digestK6Summary(summaryPath);
    if (digest) {
      allPassed.push(...digest.passed.map((t) => `smoke: ${t}`));
      allFailed.push(...digest.failed.map((t) => `smoke: ${t}`));
      if (typeof digest.metrics["http_req_duration.p95"] === "number") {
        summary.smokeP95 = Math.round(digest.metrics["http_req_duration.p95"]);
      }
      if (typeof digest.metrics["http_reqs.count"] === "number") {
        summary.smokeReqs = digest.metrics["http_reqs.count"];
      }
    }
  }
  if (mode === "load" || mode === "both") {
    if (mode === "both" && interactive) {
      const cont = await confirmContinue("Smoke complete. Continue with load test?");
      if (!cont) {
        await session.finalize({
          exitCode: result.smokeExit ?? 0,
          thresholds: { passed: allPassed, failed: allFailed },
          summary,
        });
        return result;
      }
    }
    if (!out.json) {
      out.step("");
      out.step("Running k6 load test...");
    }
    const summaryPath = join(session.dir, "k6-load-summary.json");
    result.loadExit = await runK6({ cwd, script: "load.js", summaryPath });
    if (await fileExists(summaryPath)) session.registerArtefact("k6-load-summary.json");
    const digest = await digestK6Summary(summaryPath);
    if (digest) {
      allPassed.push(...digest.passed.map((t) => `load: ${t}`));
      allFailed.push(...digest.failed.map((t) => `load: ${t}`));
      if (typeof digest.metrics["http_req_duration.p95"] === "number") {
        summary.loadP95 = Math.round(digest.metrics["http_req_duration.p95"]);
      }
      if (typeof digest.metrics["http_reqs.count"] === "number") {
        summary.loadReqs = digest.metrics["http_reqs.count"];
      }
    }
  }

  const finalExit = result.loadExit ?? result.smokeExit ?? 0;
  await session.finalize({
    exitCode: finalExit,
    thresholds: { passed: allPassed, failed: allFailed },
    summary,
  });
  return result;
}
