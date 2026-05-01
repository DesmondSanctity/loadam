import type { IR } from "@loadam/core";
import type { DriftFinding, DriftSeverity } from "./diff.js";

export interface RenderReportOptions {
  ir: IR;
  baseUrl: string;
  findings: DriftFinding[];
  skipped?: { operationId: string; reason: string }[];
  generatedAt?: string;
}

const SEVERITY_ORDER: DriftSeverity[] = ["error", "warning", "info"];

/** Render a Markdown drift report. Self-contained — embed in CI artefacts. */
export function renderMarkdownReport(opts: RenderReportOptions): string {
  const ts = opts.generatedAt ?? new Date().toISOString();
  const counts = countBySeverity(opts.findings);
  const sections: string[] = [];

  sections.push(`# Drift report — ${opts.ir.meta.title}`);
  sections.push("");
  sections.push(`- Spec version: \`${opts.ir.meta.version}\``);
  sections.push(`- Target: \`${opts.baseUrl}\``);
  sections.push(`- Generated: ${ts}`);
  sections.push(
    `- Findings: **${opts.findings.length}** (${counts.error} error · ${counts.warning} warning · ${counts.info} info)`,
  );
  if (opts.skipped && opts.skipped.length > 0) {
    sections.push(`- Skipped: ${opts.skipped.length} operation(s)`);
  }
  sections.push("");

  if (opts.findings.length === 0) {
    sections.push("No drift detected — spec and live API agree on every probed operation.");
    sections.push("");
  } else {
    sections.push("## Findings");
    sections.push("");
    const sorted = [...opts.findings].sort(
      (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
    );
    for (const f of sorted) {
      sections.push(`### \`${f.method} ${f.path}\` — ${f.kind} (${severityBadge(f.severity)})`);
      sections.push("");
      sections.push(f.message);
      sections.push("");
      if (f.details !== undefined) {
        sections.push("```json");
        sections.push(JSON.stringify(f.details, null, 2));
        sections.push("```");
        sections.push("");
      }
    }
  }

  if (opts.skipped && opts.skipped.length > 0) {
    sections.push("## Skipped operations");
    sections.push("");
    for (const s of opts.skipped) {
      sections.push(`- \`${s.operationId}\` — ${s.reason}`);
    }
    sections.push("");
  }

  return `${sections.join("\n").trimEnd()}\n`;
}

export function countBySeverity(findings: DriftFinding[]): Record<DriftSeverity, number> {
  const c: Record<DriftSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const f of findings) c[f.severity]++;
  return c;
}

function severityBadge(s: DriftSeverity): string {
  if (s === "error") return "❌ error";
  if (s === "warning") return "⚠️ warning";
  return "ℹ️ info";
}
