import { resolve } from "node:path";
import type { Command } from "commander";
import { cleanSessions } from "../session/index.js";
import { withFriendlyErrors } from "../util/errors.js";
import { makeOutput } from "../util/output.js";

interface CleanOptions {
  root: string;
  keep?: string;
  olderThan?: string;
  yes?: boolean;
  json?: boolean;
}

const DURATION_RE = /^(\d+)([smhd])$/;

function parseDuration(raw: string): number {
  const m = DURATION_RE.exec(raw.trim());
  if (!m) {
    throw new Error(`Invalid --older-than "${raw}". Use 30d, 12h, 45m, 90s.`);
  }
  const n = Number.parseInt(m[1] as string, 10);
  const unit = m[2] as "s" | "m" | "h" | "d";
  const factor =
    unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return n * factor;
}

export function registerCleanCommand(program: Command): void {
  program
    .command("clean")
    .description("Delete archived sessions older than a threshold or beyond a keep count.")
    .option("--root <dir>", "session archive root", "./loadam-out")
    .option("--keep <n>", "always keep at most N most-recent sessions")
    .option("--older-than <duration>", "delete sessions older than this (e.g. 30d, 12h)", "30d")
    .option("-y, --yes", "actually delete (default: dry-run)", false)
    .option("--json", "emit a JSON summary on stdout", false)
    .action(withFriendlyErrors(runClean));
}

export async function runClean(opts: CleanOptions): Promise<void> {
  const out = makeOutput(!!opts.json);
  const root = resolve(opts.root);
  const olderThanMs = opts.olderThan ? parseDuration(opts.olderThan) : undefined;
  const keep = opts.keep ? Number.parseInt(opts.keep, 10) : undefined;

  const result = await cleanSessions(root, {
    olderThanMs,
    keep: Number.isFinite(keep) ? keep : undefined,
    apply: !!opts.yes,
  });

  if (out.json) {
    out.result({
      command: "clean",
      root,
      apply: !!opts.yes,
      kept: result.kept.length,
      deleted: result.deleted.length,
      deletedIds: result.deleted,
    });
    return;
  }

  if (result.deleted.length === 0) {
    out.info(`Nothing to clean. ${result.kept.length} session(s) kept.`);
    return;
  }

  if (opts.yes) {
    out.success(`Deleted ${result.deleted.length} session(s); ${result.kept.length} kept.`);
  } else {
    out.info(
      `Dry-run: would delete ${result.deleted.length} session(s); ${result.kept.length} kept.`,
    );
    out.info("Pass --yes to actually delete.");
  }
  for (const id of result.deleted) out.info(`  - ${id}`);
}
