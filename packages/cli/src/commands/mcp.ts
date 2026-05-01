import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fromOpenApiFile, parseIR } from "@loadam/core";
import { inferResourceGraph } from "@loadam/graph";
import { compileMcp } from "@loadam/mcp";
import type { Command } from "commander";
import { withFriendlyErrors } from "../util/errors.js";
import { makeOutput } from "../util/output.js";

interface McpOptions {
  output: string;
  target?: string;
  writes?: boolean;
  exclude?: string[];
  json?: boolean;
}

export function registerMcpCommand(program: Command): void {
  program
    .command("mcp")
    .description("Compile an OpenAPI spec into a runnable MCP server (stdio + HTTP).")
    .argument("<spec>", "path to OpenAPI 3.x spec (YAML or JSON)")
    .option("-o, --output <dir>", "output directory for the generated server", "./loadam-out/mcp")
    .option(
      "--target <url>",
      "override base URL baked into client.js (env BASE_URL still wins at runtime)",
    )
    .option("--writes", "include mutating ops (POST/PUT/PATCH/DELETE) — off by default", false)
    .option("--exclude <opIds...>", "operation ids to exclude from the tool list, repeatable")
    .option("--json", "emit a single JSON summary on stdout (CI mode)", false)
    .action(withFriendlyErrors(runMcp));
}

export async function runMcp(spec: string, opts: McpOptions): Promise<void> {
  const out = makeOutput(!!opts.json);
  const specPath = resolve(spec);
  out.start(`Parsing OpenAPI spec: ${specPath}`);

  const ir = await fromOpenApiFile(specPath);
  inferResourceGraph(ir);
  parseIR(ir);

  const result = compileMcp(ir, {
    baseUrl: opts.target,
    includeWrites: !!opts.writes,
    exclude: opts.exclude,
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
  out.info(
    `  ${result.tools.length} tools  ·  ${opts.writes ? "writes enabled" : "read-only"}  ·  ${result.envVars.length} auth env vars`,
  );
  if (!out.json) {
    out.step("");
    out.step("Next steps:");
    out.step(`  cd ${opts.output}`);
    out.step("  npm install");
    out.step("  node bin.js          # stdio (Claude Desktop)");
    out.step("  node bin.js --http   # streamable HTTP on :3333");
  }

  out.result({
    command: "mcp",
    outputDir: outDir,
    files: fileCount,
    tools: result.tools.length,
    toolNames: result.tools.map((t) => t.name),
    writes: !!opts.writes,
    envVars: result.envVars,
  });
}
