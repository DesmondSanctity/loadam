import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fromOpenApiFile, parseIR } from "@loadam/core";
import { inferResourceGraph } from "@loadam/graph";
import { compileK6 } from "@loadam/test-k6";
import type { Command } from "commander";
import { withFriendlyErrors } from "../util/errors.js";
import { makeOutput } from "../util/output.js";

interface TestOptions {
  output: string;
  target?: string;
  fixtureSize?: string;
  seed?: string;
  json?: boolean;
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
  if (!out.json) {
    out.step("");
    out.step("Next steps:");
    out.step(`  cd ${opts.output}`);
    out.step("  cp .env.example .env  # fill in credentials");
    out.step("  k6 run smoke.js");
  }

  out.result({
    command: "test",
    outputDir: outDir,
    files: fileCount,
    operations: ir.operations.length,
    fixtureOps: fixtureCount,
    fixtureSize: result.fixtures.size,
  });
}
