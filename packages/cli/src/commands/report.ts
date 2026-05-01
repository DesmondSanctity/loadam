import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { renderReport } from "@loadam/report";
import type { Command } from "commander";
import { resolveSessionId } from "../session/index.js";
import { withFriendlyErrors } from "../util/errors.js";
import { makeOutput } from "../util/output.js";

declare const __LOADAM_VERSION__: string;
const VERSION = typeof __LOADAM_VERSION__ === "string" ? __LOADAM_VERSION__ : "0.0.0";

interface ReportOptions {
  root: string;
  open?: boolean;
  output?: string;
  json?: boolean;
}

export function registerReportCommand(program: Command): void {
  program
    .command("report")
    .description("Render a self-contained HTML report for an archived session.")
    .argument("[id]", 'session ID, prefix, or "latest" (default: latest)', "latest")
    .option("--root <dir>", "session archive root", "./loadam-out")
    .option("-o, --output <path>", "write to this path instead of <session>/report.html")
    .option("--open", "open the report in your default browser after writing", false)
    .option("--json", "emit a JSON summary on stdout (CI mode)", false)
    .action(withFriendlyErrors(runReport));
}

export async function runReport(id: string, opts: ReportOptions): Promise<void> {
  const out = makeOutput(!!opts.json);
  const root = resolve(opts.root);
  const meta = await resolveSessionId(root, id);
  const dir = join(root, "sessions", meta.id);

  // Pull artefacts we know how to surface — best-effort, missing ones are skipped.
  const k6Summaries: Record<string, unknown> = {};
  for (const a of meta.artefacts) {
    if (a.startsWith("k6-") && a.endsWith("-summary.json")) {
      const label = a.replace(/^k6-/, "").replace(/-summary\.json$/, "");
      try {
        k6Summaries[label] = JSON.parse(await readFile(join(dir, a), "utf8"));
      } catch {
        // ignore unparseable summaries
      }
    }
  }
  let driftMarkdown: string | undefined;
  if (meta.command === "diff") {
    try {
      driftMarkdown = await readFile(join(dir, "drift.md"), "utf8");
    } catch {
      // ignore
    }
  }

  const html = renderReport({
    meta,
    k6Summaries: Object.keys(k6Summaries).length > 0 ? (k6Summaries as never) : undefined,
    driftMarkdown,
    loadamVersion: VERSION,
  });

  const outPath = opts.output ? resolve(opts.output) : join(dir, "report.html");
  await writeFile(outPath, html, "utf8");
  const sizeKb = Math.round(Buffer.byteLength(html, "utf8") / 1024);

  if (!out.json) {
    out.success(`Wrote ${outPath} (${sizeKb} KB)`);
  }
  out.result({
    command: "report",
    sessionId: meta.id,
    path: outPath,
    sizeBytes: Buffer.byteLength(html, "utf8"),
    opened: false,
  });

  if (opts.open) {
    await openInBrowser(outPath);
    if (!out.json) out.info("Opened in default browser");
  }
}

/**
 * Best-effort cross-platform "open this file in the default browser/app".
 * Silently does nothing if the platform-specific opener isn't available.
 */
async function openInBrowser(path: string): Promise<void> {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  const args = platform === "win32" ? ["", path] : [path];
  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: "ignore",
      shell: platform === "win32",
    });
    child.unref();
  } catch {
    // platform missing the opener; don't crash the CLI for a UX nicety.
  }
}
