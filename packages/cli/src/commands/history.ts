import { resolve } from "node:path";
import type { Command } from "commander";
import { listSessions } from "../session/index.js";
import { withFriendlyErrors } from "../util/errors.js";
import { makeOutput } from "../util/output.js";

interface HistoryOptions {
  root: string;
  limit?: string;
  command?: string;
  json?: boolean;
}

export function registerHistoryCommand(program: Command): void {
  program
    .command("history")
    .description("List archived loadam sessions (newest first).")
    .option("--root <dir>", "session archive root", "./loadam-out")
    .option("--limit <n>", "show at most N sessions", "20")
    .option("--command <cmd>", "filter by command (test|contract|diff)")
    .option("--json", "emit a JSON array on stdout", false)
    .action(withFriendlyErrors(runHistory));
}

export async function runHistory(opts: HistoryOptions): Promise<void> {
  const out = makeOutput(!!opts.json);
  const root = resolve(opts.root);
  const limit = Number.parseInt(opts.limit ?? "20", 10);
  const all = await listSessions(root);
  const filtered = opts.command ? all.filter((s) => s.command === opts.command) : all;
  const shown = filtered.slice(0, Number.isFinite(limit) ? limit : 20);

  if (out.json) {
    out.result({ command: "history", root, total: filtered.length, sessions: shown });
    return;
  }

  if (shown.length === 0) {
    out.info("No sessions found. Run `loadam test`/`contract`/`diff` first.");
    return;
  }

  out.info("  ID                                                           CMD       EXIT   WHEN");
  for (const s of shown) {
    const idCol = s.id.padEnd(60).slice(0, 60);
    const cmdCol = s.command.padEnd(8);
    const exitCol = (s.exitCode ?? "—").toString().padEnd(6);
    const when = s.startedAt;
    out.info(`  ${idCol} ${cmdCol} ${exitCol} ${when}`);
  }
  if (filtered.length > shown.length) {
    out.info(`  … ${filtered.length - shown.length} more (raise --limit to see them)`);
  }
}
