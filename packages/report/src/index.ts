/**
 * Loadam HTML report renderer.
 *
 * Pure function: takes session meta + the artefact files we know how to
 * surface, returns a single self-contained HTML string. No external
 * resources, no fetch, no JS frameworks. All data is inlined as JSON in
 * a `<script type="application/json">` tag so downstream tooling can
 * still extract structured data from the artefact.
 */

export interface ReportInput {
  meta: SessionMeta;
  /** Optional k6 summary JSON content (parsed). Key by display label, e.g. "smoke", "load". */
  k6Summaries?: Record<string, K6Summary>;
  /** Optional drift report markdown content (rendered verbatim inside <pre>). */
  driftMarkdown?: string;
  /** Optional contract findings — currently rendered as a bullet list of failures. */
  contractFailures?: ContractFailure[];
  /** Loadam version for the footer. */
  loadamVersion: string;
}

export interface SessionMeta {
  schemaVersion: number;
  id: string;
  command: "test" | "contract" | "diff";
  flags: Record<string, string | number | boolean | null>;
  spec: { path: string; sha256: string; title?: string; version?: string };
  irDigest: string;
  target: string | null;
  envVars: string[];
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  exitCode?: number;
  thresholds?: { passed: string[]; failed: string[] };
  summary?: Record<string, number | string>;
  artefacts: string[];
}

export interface K6Summary {
  // k6 emits a deeply nested summary; we only read the bits we surface.
  metrics?: Record<string, K6Metric>;
  root_group?: { groups?: unknown; checks?: unknown };
}

export interface K6Metric {
  type?: string;
  contains?: string;
  values?: Record<string, number>;
  thresholds?: Record<string, { ok: boolean }>;
}

export interface ContractFailure {
  test: string;
  message?: string;
}

/**
 * Render a self-contained HTML report. Output is deterministic except for
 * timestamps already encoded in `meta.startedAt` / `meta.endedAt` — those
 * reflect the actual run, not render time.
 */
export function renderReport(input: ReportInput): string {
  const { meta, loadamVersion } = input;
  const passed = meta.exitCode === 0 && (meta.thresholds?.failed.length ?? 0) === 0;

  const dataPayload = {
    meta,
    k6Summaries: input.k6Summaries ?? null,
    contractFailures: input.contractFailures ?? null,
    loadamVersion,
  };

  return [
    "<!doctype html>",
    `<html lang="en">`,
    "<head>",
    `<meta charset="utf-8" />`,
    `<meta name="viewport" content="width=device-width,initial-scale=1" />`,
    `<meta name="generator" content="loadam ${esc(loadamVersion)}" />`,
    `<title>${esc(reportTitle(meta))}</title>`,
    `<style>${STYLES}</style>`,
    "</head>",
    "<body>",
    renderHeader(meta, passed),
    renderSummary(meta, input.k6Summaries),
    renderThresholds(meta),
    renderK6Metrics(input.k6Summaries),
    input.driftMarkdown ? renderDrift(input.driftMarkdown) : "",
    input.contractFailures && input.contractFailures.length > 0
      ? renderContract(input.contractFailures)
      : "",
    renderRunDetails(meta),
    renderFooter(meta, loadamVersion),
    `<script type="application/json" id="loadam-data">${escScript(JSON.stringify(dataPayload))}</script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function renderHeader(meta: SessionMeta, passed: boolean): string {
  const status = passed ? "PASSED" : "FAILED";
  const cls = passed ? "ok" : "bad";
  return `
<header class="hdr">
  <div class="hdr-left">
    <div class="cmd">${esc(meta.command)}</div>
    <h1>${esc(meta.spec.title ?? "Untitled API")}</h1>
    <div class="sub">${esc(meta.spec.version ?? "")} · target <code>${esc(meta.target ?? "—")}</code></div>
  </div>
  <div class="hdr-right">
    <span class="badge ${cls}">${status}</span>
    <div class="when">${esc(meta.startedAt)}</div>
    ${
      typeof meta.durationMs === "number"
        ? `<div class="dur">${(meta.durationMs / 1000).toFixed(2)}s</div>`
        : ""
    }
  </div>
</header>`;
}

function renderSummary(meta: SessionMeta, k6: Record<string, K6Summary> | undefined): string {
  const cells: Array<{ label: string; value: string }> = [];
  if (meta.summary) {
    for (const [k, v] of Object.entries(meta.summary)) {
      cells.push({ label: k, value: String(v) });
    }
  }
  if (k6) {
    for (const [name, s] of Object.entries(k6)) {
      const dur = s.metrics?.http_req_duration?.values;
      if (dur && typeof dur["p(95)"] === "number") {
        cells.push({ label: `${name} p95`, value: `${dur["p(95)"].toFixed(0)} ms` });
      }
      const reqs = s.metrics?.http_reqs?.values;
      if (reqs && typeof reqs.count === "number") {
        cells.push({ label: `${name} reqs`, value: String(reqs.count) });
      }
      if (reqs && typeof reqs.rate === "number") {
        cells.push({ label: `${name} rps`, value: `${reqs.rate.toFixed(1)}/s` });
      }
      const failed = s.metrics?.http_req_failed?.values;
      if (failed && typeof failed.rate === "number") {
        cells.push({
          label: `${name} fail`,
          value: `${(failed.rate * 100).toFixed(2)}%`,
        });
      }
    }
  }
  if (cells.length === 0) return "";
  return `
<section class="cards">
  ${cells
    .map(
      (c) =>
        `<div class="card"><div class="card-v">${esc(c.value)}</div><div class="card-l">${esc(c.label)}</div></div>`,
    )
    .join("\n  ")}
</section>`;
}

function renderThresholds(meta: SessionMeta): string {
  const t = meta.thresholds;
  if (!t || (t.passed.length === 0 && t.failed.length === 0)) return "";
  return `
<section>
  <h2>Thresholds</h2>
  <ul class="thr">
    ${t.failed.map((x) => `<li class="bad">✗ ${esc(x)}</li>`).join("\n    ")}
    ${t.passed.map((x) => `<li class="ok">✓ ${esc(x)}</li>`).join("\n    ")}
  </ul>
</section>`;
}

function renderK6Metrics(k6: Record<string, K6Summary> | undefined): string {
  if (!k6 || Object.keys(k6).length === 0) return "";
  const blocks: string[] = [];
  for (const [name, s] of Object.entries(k6)) {
    const metrics = s.metrics ?? {};
    const dur = metrics.http_req_duration?.values;
    if (!dur) continue;
    const rows: Array<[string, string]> = [
      ["min", fmtMs(dur.min)],
      ["med", fmtMs(dur.med)],
      ["avg", fmtMs(dur.avg)],
      ["p(90)", fmtMs(dur["p(90)"])],
      ["p(95)", fmtMs(dur["p(95)"])],
      ["p(99)", fmtMs(dur["p(99)"])],
      ["max", fmtMs(dur.max)],
    ];
    blocks.push(`
  <div class="metric-block">
    <h3>${esc(name)} · http_req_duration</h3>
    <table class="kv">
      <tbody>
        ${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("\n        ")}
      </tbody>
    </table>
    ${renderPercentileBars(dur)}
  </div>`);
  }
  if (blocks.length === 0) return "";
  return `<section><h2>Latency</h2>${blocks.join("\n")}</section>`;
}

function renderPercentileBars(dur: Record<string, number>): string {
  const max = dur.max ?? Math.max(...Object.values(dur));
  if (!Number.isFinite(max) || max <= 0) return "";
  const bars: Array<[string, number]> = [
    ["med", dur.med ?? 0],
    ["p(90)", dur["p(90)"] ?? 0],
    ["p(95)", dur["p(95)"] ?? 0],
    ["p(99)", dur["p(99)"] ?? 0],
    ["max", max],
  ];
  return `
    <div class="bars">
      ${bars
        .map(([k, v]) => {
          const pct = Math.max(2, Math.round((v / max) * 100));
          return `<div class="bar-row"><span class="bar-l">${esc(k)}</span><div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div><span class="bar-v">${esc(fmtMs(v))}</span></div>`;
        })
        .join("\n      ")}
    </div>`;
}

function renderDrift(md: string): string {
  return `
<section>
  <h2>Drift findings</h2>
  <pre class="drift">${esc(md)}</pre>
</section>`;
}

function renderContract(failures: ContractFailure[]): string {
  return `
<section>
  <h2>Contract failures (${failures.length})</h2>
  <ul class="failures">
    ${failures
      .map(
        (f) =>
          `<li><div class="ftest">${esc(f.test)}</div>${f.message ? `<pre>${esc(f.message)}</pre>` : ""}</li>`,
      )
      .join("\n    ")}
  </ul>
</section>`;
}

function renderRunDetails(meta: SessionMeta): string {
  const flagRows = Object.entries(meta.flags).map(
    ([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(String(v))}</td></tr>`,
  );
  const envRow =
    meta.envVars.length > 0
      ? `<tr><th>env vars</th><td>${meta.envVars.map((e) => `<code>${esc(e)}</code>`).join(" ")}</td></tr>`
      : "";
  return `
<section>
  <h2>Run details</h2>
  <table class="kv">
    <tbody>
      <tr><th>session id</th><td><code>${esc(meta.id)}</code></td></tr>
      <tr><th>spec</th><td><code>${esc(meta.spec.path)}</code></td></tr>
      <tr><th>spec sha256</th><td><code>${esc(meta.spec.sha256.slice(0, 16))}…</code></td></tr>
      <tr><th>IR digest</th><td><code>${esc(meta.irDigest.slice(0, 16))}…</code></td></tr>
      <tr><th>started</th><td>${esc(meta.startedAt)}</td></tr>
      ${meta.endedAt ? `<tr><th>ended</th><td>${esc(meta.endedAt)}</td></tr>` : ""}
      ${typeof meta.exitCode === "number" ? `<tr><th>exit code</th><td>${meta.exitCode}</td></tr>` : ""}
      ${envRow}
      ${flagRows.join("\n      ")}
    </tbody>
  </table>
</section>`;
}

function renderFooter(meta: SessionMeta, version: string): string {
  return `
<footer>
  Generated by <a href="https://github.com/anonxhash/loadam">loadam ${esc(version)}</a> ·
  schema v${meta.schemaVersion} ·
  IR <code>${esc(meta.irDigest.slice(0, 12))}</code>
</footer>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function reportTitle(meta: SessionMeta): string {
  const t = meta.spec.title ?? "loadam";
  return `${t} · ${meta.command} · ${meta.id}`;
}

function fmtMs(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(2)} s`;
  return `${n.toFixed(0)} ms`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape `</script>` so an inline JSON payload can't break out of its tag. */
function escScript(s: string): string {
  return s.replace(/<\/script/gi, "<\\/script");
}

// ---------------------------------------------------------------------------
// Inline stylesheet
// ---------------------------------------------------------------------------

const STYLES = `
:root{
  --bg:#fafafa;--fg:#111;--mut:#666;--brd:#e5e5e5;--card:#fff;
  --ok:#15803d;--ok-bg:#dcfce7;--bad:#b91c1c;--bad-bg:#fee2e2;
  --acc:#2563eb;--bar:#3b82f6;--code:#f4f4f5;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#0a0a0a;--fg:#f5f5f5;--mut:#a1a1aa;--brd:#27272a;--card:#18181b;
    --ok:#86efac;--ok-bg:#14532d;--bad:#fca5a5;--bad-bg:#7f1d1d;
    --acc:#60a5fa;--bar:#3b82f6;--code:#27272a;
  }
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
body{max-width:960px;margin:0 auto;padding:24px 20px 60px}
h1{font-size:20px;margin:0 0 4px}
h2{font-size:15px;margin:24px 0 12px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}
h3{font-size:14px;margin:16px 0 8px;font-weight:600}
code{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--code);padding:1px 6px;border-radius:3px}
a{color:var(--acc);text-decoration:none}
a:hover{text-decoration:underline}
section{margin-top:8px}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:16px;border-bottom:1px solid var(--brd)}
.hdr-left .cmd{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);font-weight:600}
.hdr-left .sub{color:var(--mut);font-size:13px;margin-top:4px}
.hdr-right{text-align:right}
.hdr-right .when,.hdr-right .dur{font-size:12px;color:var(--mut);margin-top:4px;font-variant-numeric:tabular-nums}
.badge{display:inline-block;padding:4px 10px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:.06em}
.badge.ok{background:var(--ok-bg);color:var(--ok)}
.badge.bad{background:var(--bad-bg);color:var(--bad)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-top:20px}
.card{background:var(--card);border:1px solid var(--brd);border-radius:6px;padding:12px 14px}
.card-v{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
.card-l{font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:.04em;margin-top:2px}
.thr{list-style:none;padding:0;margin:0}
.thr li{padding:4px 8px;border-radius:3px;margin:2px 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.thr li.ok{color:var(--ok)}
.thr li.bad{background:var(--bad-bg);color:var(--bad);font-weight:600}
table.kv{border-collapse:collapse;width:100%;font-size:13px}
table.kv th,table.kv td{padding:6px 10px;text-align:left;border-bottom:1px solid var(--brd);vertical-align:top}
table.kv th{font-weight:500;color:var(--mut);width:160px;white-space:nowrap}
.metric-block{background:var(--card);border:1px solid var(--brd);border-radius:6px;padding:12px 16px;margin-bottom:12px}
.bars{margin-top:10px}
.bar-row{display:grid;grid-template-columns:60px 1fr 80px;gap:10px;align-items:center;font-size:12px;font-variant-numeric:tabular-nums;margin:3px 0}
.bar-l{color:var(--mut)}
.bar{background:var(--code);height:8px;border-radius:4px;overflow:hidden}
.bar-fill{background:var(--bar);height:100%}
.bar-v{text-align:right;color:var(--fg)}
.drift{background:var(--card);border:1px solid var(--brd);border-radius:6px;padding:12px 16px;overflow-x:auto;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap}
.failures{list-style:none;padding:0;margin:0}
.failures li{background:var(--bad-bg);border:1px solid var(--bad);border-radius:4px;padding:8px 12px;margin-bottom:6px}
.failures .ftest{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;font-weight:600}
.failures pre{margin:6px 0 0;font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap}
footer{margin-top:40px;padding-top:16px;border-top:1px solid var(--brd);color:var(--mut);font-size:12px;text-align:center}
`;
