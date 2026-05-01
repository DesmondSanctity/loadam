import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { confirm, password, select } from "@inquirer/prompts";

/**
 * Detect whether we should run interactive prompts.
 *
 * Heuristics:
 *  - `--no-interactive` flag wins (force off).
 *  - `CI=true` or any non-TTY stdin disables.
 *  - Otherwise enabled.
 */
export function isInteractive(noInteractiveFlag: boolean): boolean {
  if (noInteractiveFlag) return false;
  if (process.env.CI && process.env.CI !== "false") return false;
  if (!process.stdin.isTTY) return false;
  if (!process.stdout.isTTY) return false;
  return true;
}

/**
 * For each env var, if not already set in `parentEnv`, prompt the user.
 *
 * Returns a record of name → value containing only the values that the user
 * supplied (vars already in the parent environment are NOT included so the
 * caller can decide whether to write them to .env).
 */
export async function promptForAuthEnv(
  envVarNames: string[],
  parentEnv: NodeJS.ProcessEnv,
): Promise<Record<string, string>> {
  const collected: Record<string, string> = {};
  for (const name of envVarNames) {
    if (parentEnv[name]) continue; // honour existing shell env
    const value = await password({
      message: `${name}:`,
      mask: "*",
    });
    if (value) collected[name] = value;
  }
  return collected;
}

export type RunMode = "smoke" | "load" | "both" | "skip";

export async function promptForMode(): Promise<RunMode> {
  return (await select<RunMode>({
    message: "What would you like to run?",
    choices: [
      { name: "Smoke test (1 VU, fast)", value: "smoke" },
      { name: "Load test (multiple VUs, longer)", value: "load" },
      { name: "Both (smoke first, then load)", value: "both" },
      { name: "Skip — I'll run it later", value: "skip" },
    ],
    default: "smoke",
  })) as RunMode;
}

export async function confirmContinue(message: string): Promise<boolean> {
  return await confirm({ message, default: true });
}

/**
 * Merge the supplied vars into the .env file inside `dir`. Existing keys are
 * preserved unless `overwrite` is true. Creates the file if it doesn't exist.
 *
 * The file is written with mode 0o600 (owner read/write only).
 */
export async function writeEnvFile(
  dir: string,
  baseUrl: string,
  vars: Record<string, string>,
  opts: { overwrite?: boolean } = {},
): Promise<{ path: string; written: string[]; preserved: string[] }> {
  const path = resolve(dir, ".env");
  const existing = await readEnvFile(path);
  const written: string[] = [];
  const preserved: string[] = [];

  // BASE_URL handling — only set if missing or overwrite requested.
  if (!existing.BASE_URL || opts.overwrite) {
    existing.BASE_URL = baseUrl;
    written.push("BASE_URL");
  } else {
    preserved.push("BASE_URL");
  }

  for (const [k, v] of Object.entries(vars)) {
    if (existing[k] && !opts.overwrite) {
      preserved.push(k);
    } else {
      existing[k] = v;
      written.push(k);
    }
  }

  const body = `${Object.entries(existing)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")}\n`;
  await writeFile(path, body, "utf8");
  await chmod(path, 0o600).catch(() => {
    // chmod can fail on Windows / non-POSIX FS; non-fatal.
  });

  return { path, written, preserved };
}

async function readEnvFile(path: string): Promise<Record<string, string>> {
  try {
    const text = await readFile(path, "utf8");
    const out: Record<string, string> = {};
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1);
      if (k) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}
