import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fromOpenApiFile, parseIR } from "@loadam/core";
import { inferResourceGraph } from "@loadam/graph";
import {
  compareProbes,
  countBySeverity,
  probeOperations,
  renderMarkdownReport,
} from "@loadam/test-drift";
import type { Command } from "commander";
import { createSession } from "../session/index.js";
import { withFriendlyErrors } from "../util/errors.js";
import { makeOutput } from "../util/output.js";

interface DiffOptions {
  target: string;
  output?: string;
  timeoutMs?: string;
  mutating?: boolean;
  header?: string[];
  pathParam?: string[];
  failOn?: "error" | "warning" | "never";
  json?: boolean;
}

export function registerDiffCommand(program: Command): void {
  program
    .command("diff")
    .description("Probe a live API and report drift against the spec (Markdown).")
    .argument("<spec>", "path to OpenAPI 3.x spec (YAML or JSON)")
    .requiredOption("--target <url>", "base URL of the live API")
    .option("-o, --output <path>", "write report to this file (otherwise stdout)")
    .option("--timeout-ms <n>", "per-request timeout", "5000")
    .option("--mutating", "also probe mutating ops (DANGEROUS — not for prod)", false)
    .option("-H, --header <kv...>", 'additional headers, repeatable, "Name: value" form')
    .option("--path-param <kv...>", 'fallback path-param values, repeatable, "name=value" form')
    .option("--fail-on <severity>", "exit non-zero when findings of this severity exist", "error")
    .option("--json", "emit a single JSON summary on stdout (CI mode)", false)
    .action(withFriendlyErrors(runDiff));
}

export async function runDiff(spec: string, opts: DiffOptions): Promise<void> {
  const out = makeOutput(!!opts.json);
  const specPath = resolve(spec);
  out.start(`Parsing OpenAPI spec: ${specPath}`);
  const specSource = await readFile(specPath, "utf8");
  const ir = await fromOpenApiFile(specPath);
  inferResourceGraph(ir);
  parseIR(ir);

  const headers = parseKvPairs(opts.header ?? [], ":");
  const pathParams = parseKvPairs(opts.pathParam ?? [], "=");
  const timeoutMs = Number.parseInt(opts.timeoutMs ?? "5000", 10);

  out.start(`Probing ${ir.operations.length} operations on ${opts.target}…`);
  const { probes, skipped } = await probeOperations(ir, {
    baseUrl: opts.target,
    headers,
    pathParams,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 5000,
    safeOnly: !opts.mutating,
  });

  const findings = compareProbes({ ir, probes });
  const counts = countBySeverity(findings);

  // Archive the run.
  const session = await createSession({
    command: "diff",
    outRoot: resolve("./loadam-out"),
    specPath,
    specSource,
    ir,
    irJson: JSON.stringify(ir, null, 2),
    target: opts.target,
    envVars: [],
    flags: {
      target: opts.target,
      timeoutMs,
      mutating: !!opts.mutating,
      failOn: opts.failOn ?? "error",
      headers: Object.keys(headers),
      pathParams: Object.keys(pathParams),
    },
    slug: `diff-${ir.meta.title ?? "run"}`,
  });

  const report = renderMarkdownReport({
    ir,
    baseUrl: opts.target,
    findings,
    skipped,
  });
  await session.addArtefact("drift.md", report);
  await session.addArtefact(
    "findings.json",
    JSON.stringify({ findings, skipped, counts }, null, 2),
  );

  if (!out.json) {
    if (opts.output) {
      const outFile = resolve(opts.output);
      await writeFile(outFile, report, "utf8");
      out.success(`Wrote drift report to ${outFile}`);
    } else {
      process.stdout.write(report);
    }
    out.info(
      `  ${probes.length} probed  ·  ${skipped.length} skipped  ·  ${counts.error} error  ·  ${counts.warning} warning  ·  ${counts.info} info`,
    );
    out.info(`  Session: ${session.id}`);
  } else if (opts.output) {
    await writeFile(resolve(opts.output), report, "utf8");
  }

  const failOn = opts.failOn ?? "error";
  const failed =
    (failOn === "error" && counts.error > 0) ||
    (failOn === "warning" && counts.error + counts.warning > 0);

  await session.finalize({
    exitCode: failed ? 1 : 0,
    thresholds: { passed: [], failed: [] },
    summary: {
      probed: probes.length,
      skipped: skipped.length,
      findings: findings.length,
      error: counts.error,
      warning: counts.warning,
      info: counts.info,
    },
  });

  out.result({
    command: "diff",
    target: opts.target,
    probed: probes.length,
    skipped: skipped.length,
    findings: findings.length,
    counts,
    reportPath: opts.output ? resolve(opts.output) : null,
    failOn,
    failed,
    sessionId: session.id,
  });

  if (failOn !== "never" && failed) process.exit(1);
}

function parseKvPairs(values: string[], sep: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of values) {
    const idx = v.indexOf(sep);
    if (idx <= 0) continue;
    const k = v.slice(0, idx).trim();
    const val = v.slice(idx + 1).trim();
    if (k) out[k] = val;
  }
  return out;
}
