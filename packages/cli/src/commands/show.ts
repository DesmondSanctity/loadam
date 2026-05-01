import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { resolveSessionId } from "../session/index.js";
import { withFriendlyErrors } from "../util/errors.js";
import { digestK6Summary } from "../util/k6.js";
import { makeOutput } from "../util/output.js";

interface ShowOptions {
  root: string;
  json?: boolean;
}

export function registerShowCommand(program: Command): void {
  program
    .command("show")
    .description("Show details of an archived session.")
    .argument("<id>", 'session ID, prefix, or "latest"')
    .option("--root <dir>", "session archive root", "./loadam-out")
    .option("--json", "emit the meta.json payload on stdout", false)
    .action(withFriendlyErrors(runShow));
}

export async function runShow(id: string, opts: ShowOptions): Promise<void> {
  const out = makeOutput(!!opts.json);
  const root = resolve(opts.root);
  const meta = await resolveSessionId(root, id);
  const dir = join(root, "sessions", meta.id);

  if (out.json) {
    out.result({ ...meta });
    return;
  }

  out.info(`Session ${meta.id}`);
  out.info(`  Command:   ${meta.command}`);
  out.info(`  Started:   ${meta.startedAt}`);
  if (meta.endedAt) out.info(`  Ended:     ${meta.endedAt}`);
  if (typeof meta.durationMs === "number") {
    out.info(`  Duration:  ${(meta.durationMs / 1000).toFixed(2)}s`);
  }
  out.info(`  Exit code: ${meta.exitCode ?? "—"}`);
  out.info(`  Spec:      ${meta.spec.path} (${meta.spec.title ?? "?"} ${meta.spec.version ?? ""})`);
  out.info(`  Spec sha:  ${meta.spec.sha256.slice(0, 12)}…`);
  out.info(`  IR digest: ${meta.irDigest.slice(0, 12)}…`);
  if (meta.target) out.info(`  Target:    ${meta.target}`);
  if (meta.envVars.length > 0) out.info(`  Env vars:  ${meta.envVars.join(", ")}`);
  if (meta.thresholds && (meta.thresholds.passed.length || meta.thresholds.failed.length)) {
    out.info(
      `  Thresholds: ${meta.thresholds.passed.length} passed · ${meta.thresholds.failed.length} failed`,
    );
    for (const t of meta.thresholds.failed) out.info(`    ✗ ${t}`);
  }
  if (meta.summary && Object.keys(meta.summary).length > 0) {
    out.info("  Summary:");
    for (const [k, v] of Object.entries(meta.summary)) {
      out.info(`    ${k}: ${v}`);
    }
  }

  // List artefacts on disk.
  try {
    const entries = await readdir(dir);
    out.info(`  Artefacts (${entries.length}):`);
    for (const e of entries.sort()) out.info(`    ${e}`);
  } catch {
    // ignore
  }

  // Print drift.md inline when present (best UX for diff sessions).
  if (meta.command === "diff") {
    try {
      const drift = await readFile(join(dir, "drift.md"), "utf8");
      out.info("");
      out.info("──── drift.md ────");
      process.stdout.write(drift);
    } catch {
      // ignore
    }
  }

  // Print headline k6 metrics inline for test sessions.
  if (meta.command === "test") {
    try {
      const entries = await readdir(dir);
      const summaryFile = entries.find((e) => /^k6-.*-summary\.json$/.test(e));
      if (summaryFile) {
        const digest = await digestK6Summary(join(dir, summaryFile));
        if (digest) {
          out.info("");
          out.info(`──── ${summaryFile} ────`);
          const headline: Array<[string, string]> = [];
          const dur = digest.metrics["http_req_duration.p95"];
          const cnt = digest.metrics["http_reqs.count"];
          const rate = digest.metrics["http_reqs.rate"];
          const failRate = digest.metrics["http_req_failed.rate"];
          if (typeof dur === "number")
            headline.push(["http_req_duration p95", `${dur.toFixed(1)}ms`]);
          if (typeof cnt === "number") headline.push(["http_reqs count", `${cnt}`]);
          if (typeof rate === "number") headline.push(["http_reqs rate", `${rate.toFixed(2)}/s`]);
          if (typeof failRate === "number")
            headline.push(["http_req_failed rate", `${(failRate * 100).toFixed(2)}%`]);
          for (const [k, v] of headline) out.info(`  ${k}: ${v}`);
          if (digest.passed.length || digest.failed.length) {
            out.info(
              `  Thresholds: ${digest.passed.length} passed · ${digest.failed.length} failed`,
            );
            for (const t of digest.failed) out.info(`    ✗ ${t}`);
          }
        }
      }
    } catch {
      // ignore
    }
  }
}
