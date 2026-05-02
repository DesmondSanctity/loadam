import { spawn } from "node:child_process";
import { constants, access } from "node:fs/promises";
import { delimiter, join } from "node:path";

/**
 * Resolve the `k6` binary on PATH. Returns null if not found.
 */
export async function findK6Binary(): Promise<string | null> {
  const path = process.env.PATH ?? "";
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, `k6${ext}`);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // not in this dir
      }
    }
  }
  return null;
}

export interface RunK6Options {
  /** Working directory containing smoke.js / load.js. */
  cwd: string;
  /** Script file name relative to cwd. */
  script: "smoke.js" | "load.js";
  /** Extra env merged on top of process.env. */
  env?: Record<string, string>;
  /** Extra k6 CLI flags appended after the script path. */
  args?: string[];
  /** Absolute path k6 should write a JSON summary to (--summary-export). */
  summaryPath?: string;
}

/**
 * Run k6 with stdio inherited so users see the live progress bar.
 * Resolves with the exit code (does not throw on non-zero).
 */
export async function runK6(opts: RunK6Options): Promise<number> {
  const bin = await findK6Binary();
  if (!bin) {
    throw new Error(
      "k6 not found on PATH. Install it from https://grafana.com/docs/k6/latest/set-up/install-k6/ and try again.",
    );
  }
  const args = ["run"];
  if (opts.summaryPath) args.push(`--summary-export=${opts.summaryPath}`);
  args.push(...(opts.args ?? []), opts.script);
  return await new Promise<number>((resolveExit, reject) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => resolveExit(code ?? 0));
  });
}

/**
 * Pull headline numbers + threshold pass/fail from a k6 --summary-export JSON.
 * Returns null if the file is unreadable or the shape isn't recognised.
 */
export interface K6SummaryDigest {
  passed: string[];
  failed: string[];
  metrics: Record<string, number>;
}

export async function digestK6Summary(path: string): Promise<K6SummaryDigest | null> {
  try {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(path, "utf8");
    const data = JSON.parse(text) as {
      metrics?: Record<
        string,
        {
          thresholds?: Record<string, { ok?: boolean }>;
          values?: Record<string, number>;
        }
      >;
    };
    const passed: string[] = [];
    const failed: string[] = [];
    const metrics: Record<string, number> = {};
    for (const [name, m] of Object.entries(data.metrics ?? {})) {
      // Skip sentinel sub-metrics emitted by the generated rig (per-op
      // latency + status-code distributions). They exist only so k6
      // surfaces the numbers in the summary export — adding them to the
      // visible threshold list would drown the user in noise.
      if (name.startsWith("loadam_op_latency") || name.startsWith("loadam_op_status")) {
        continue;
      }
      if (m.thresholds) {
        for (const [expr, info] of Object.entries(m.thresholds)) {
          (info.ok ? passed : failed).push(`${name}: ${expr}`);
        }
      }
      if (m.values) {
        if (typeof m.values["p(95)"] === "number") metrics[`${name}.p95`] = m.values["p(95)"];
        if (typeof m.values.rate === "number") metrics[`${name}.rate`] = m.values.rate;
        if (typeof m.values.count === "number") metrics[`${name}.count`] = m.values.count;
        if (typeof m.values.avg === "number") metrics[`${name}.avg`] = m.values.avg;
      }
    }
    return { passed, failed, metrics };
  } catch {
    return null;
  }
}
