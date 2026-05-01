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
  return await new Promise<number>((resolveExit, reject) => {
    const child = spawn(bin, ["run", ...(opts.args ?? []), opts.script], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => resolveExit(code ?? 0));
  });
}
