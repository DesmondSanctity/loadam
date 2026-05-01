import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fromOpenApiFile, parseIR } from "@loadam/core";
import { graphStats, inferResourceGraph, renderGraphTree } from "@loadam/graph";
import type { Command } from "commander";
import { withFriendlyErrors } from "../util/errors.js";
import { makeOutput } from "../util/output.js";

interface InitOptions {
  output: string;
  tree: boolean;
  json?: boolean;
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Parse a spec and emit loadam.ir.json with inferred resource graph")
    .argument("<spec>", "path to OpenAPI 3.x spec (YAML or JSON)")
    .option("-o, --output <path>", "output path for IR JSON", "./loadam.ir.json")
    .option("--no-tree", "skip printing the resource-graph tree")
    .option("--json", "emit a single JSON summary on stdout (CI mode)", false)
    .action(withFriendlyErrors(runInit));
}

export async function runInit(spec: string, opts: InitOptions): Promise<void> {
  const out = makeOutput(!!opts.json);
  const specPath = resolve(spec);
  out.start(`Parsing OpenAPI spec: ${specPath}`);

  const ir = await fromOpenApiFile(specPath);
  inferResourceGraph(ir);
  parseIR(ir);

  const outPath = resolve(opts.output);
  await writeFile(outPath, `${JSON.stringify(ir, null, 2)}\n`, "utf8");

  const stats = graphStats(ir.resources);
  out.success(`Wrote ${outPath}`);
  out.info(
    `  ${ir.operations.length} operations  ·  ${
      Object.keys(ir.schemas).length
    } schemas  ·  ${ir.auth.length} auth profile(s)`,
  );
  out.info(`  ${stats.kinds} resource kind(s)  ·  ${stats.edges} edge(s)`);

  if (!out.json && opts.tree && ir.resources.kinds.length > 0) {
    out.step("");
    out.step(renderGraphTree(ir));
  }

  out.result({
    command: "init",
    outputPath: outPath,
    operations: ir.operations.length,
    schemas: Object.keys(ir.schemas).length,
    authProfiles: ir.auth.length,
    resourceKinds: stats.kinds,
    resourceEdges: stats.edges,
  });
}
