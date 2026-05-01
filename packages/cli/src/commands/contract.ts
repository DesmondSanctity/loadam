import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fromOpenApiFile, parseIR } from "@loadam/core";
import { inferResourceGraph } from "@loadam/graph";
import { compileContract } from "@loadam/test-contract";
import type { Command } from "commander";
import { createSession } from "../session/index.js";
import { withFriendlyErrors } from "../util/errors.js";
import { makeOutput } from "../util/output.js";
import { resolveTarget } from "../util/target.js";

interface ContractOptions {
  output: string;
  target?: string;
  examples?: string;
  json?: boolean;
}

export function registerContractCommand(program: Command): void {
  program
    .command("contract")
    .description("Compile an OpenAPI spec into a Schemathesis property-based contract suite.")
    .argument("<spec>", "path to OpenAPI 3.x spec (YAML or JSON)")
    .option(
      "-o, --output <dir>",
      "output directory for the generated suite",
      "./loadam-out/contract",
    )
    .option("--target <url>", "override base URL written to conftest.py")
    .option("--examples <n>", "Hypothesis examples per operation", "25")
    .option("--json", "emit a single JSON summary on stdout (CI mode)", false)
    .action(withFriendlyErrors(runContract));
}

export async function runContract(spec: string, opts: ContractOptions): Promise<void> {
  const out = makeOutput(!!opts.json);
  const specPath = resolve(spec);
  out.start(`Parsing OpenAPI spec: ${specPath}`);

  const ir = await fromOpenApiFile(specPath);
  inferResourceGraph(ir);
  parseIR(ir);

  const specSource = await readFile(specPath, "utf8");
  const examples = Number.parseInt(opts.examples ?? "25", 10);
  const target = resolveTarget(opts.target);
  const result = compileContract(ir, specSource, {
    baseUrl: target,
    examples: Number.isFinite(examples) ? examples : 25,
  });

  const outDir = resolve(opts.output);
  await mkdir(outDir, { recursive: true });
  for (const [rel, contents] of Object.entries(result.files)) {
    const full = resolve(outDir, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, contents, "utf8");
  }

  const fileCount = Object.keys(result.files).length;
  out.success(`Wrote ${fileCount} files to ${outDir}`);
  out.info(`  ${ir.operations.length} operations to fuzz`);

  // Archive the run (no execution; just record what was generated).
  const session = await createSession({
    command: "contract",
    outRoot: resolve(outDir, ".."),
    specPath,
    specSource,
    ir,
    irJson: JSON.stringify(ir, null, 2),
    target: target ?? null,
    envVars: result.envVars ?? [],
    flags: {
      target: target ?? null,
      examples,
    },
    slug: `contract-${ir.meta.title ?? "run"}`,
  });
  await session.finalize({
    exitCode: 0,
    thresholds: { passed: [], failed: [] },
    summary: {
      files: fileCount,
      operations: ir.operations.length,
    },
  });

  if (!out.json) {
    out.info(`  Session: ${session.id}`);
    out.step("");
    out.step("Next steps:");
    out.step(`  cd ${opts.output}`);
    out.step("  python -m venv .venv && source .venv/bin/activate");
    out.step("  pip install -e .");
    out.step("  pytest");
  }

  out.result({
    command: "contract",
    outputDir: outDir,
    files: fileCount,
    operations: ir.operations.length,
    envVars: result.envVars,
    sessionId: session.id,
  });
}
