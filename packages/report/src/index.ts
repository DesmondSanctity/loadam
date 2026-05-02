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
  /** Optional list of operations from ir.json — used to render the Swagger-like endpoints section. */
  operations?: Operation[];
  /** Loadam version for the footer. */
  loadamVersion: string;
}

export interface Operation {
  id: string;
  method: string;
  path: string;
  summary?: string;
  tags?: string[];
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
  root_group?: { groups?: unknown; checks?: Record<string, K6Check> };
}

export interface K6Check {
  name: string;
  path?: string;
  passes: number;
  fails: number;
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
  const overall = computeOverall(meta, input.k6Summaries, input.operations);

  const dataPayload = {
    meta,
    k6Summaries: input.k6Summaries ?? null,
    contractFailures: input.contractFailures ?? null,
    operations: input.operations ?? null,
    loadamVersion,
  };
  const hasEndpoints = (input.operations?.length ?? 0) > 0;

  const sideSections = [
    renderThresholds(meta),
    renderK6Section(input.k6Summaries, hasEndpoints),
    input.driftMarkdown ? renderDrift(input.driftMarkdown) : "",
    input.contractFailures && input.contractFailures.length > 0
      ? renderContract(input.contractFailures)
      : "",
    renderRunDetails(meta),
  ]
    .filter((s) => s !== "")
    .join("\n");
  const mainBlock = renderEndpoints(input.operations, input.k6Summaries);

  return [
    "<!doctype html>",
    `<html lang="en">`,
    "<head>",
    `<meta charset="utf-8" />`,
    `<meta name="viewport" content="width=device-width,initial-scale=1" />`,
    `<meta name="generator" content="loadam ${esc(loadamVersion)}" />`,
    `<title>${esc(reportTitle(meta))}</title>`,
    `<style>${STYLES}${dynamicTabStyles(input.k6Summaries)}${dynamicEndpointStyles(input.operations)}</style>`,
    "</head>",
    "<body>",
    renderHeader(meta, overall, input.k6Summaries),
    renderFailureReason(meta, overall, input.k6Summaries, input.contractFailures),
    renderSummary(meta, input.k6Summaries),
    // Two-column layout: endpoints fill the main column on the left, while
    // run-level data (thresholds, k6 results, drift, contract findings, run
    // details) lives in a sticky sidebar on the right so a reader never has
    // to scroll past a long endpoint list to see the overall numbers.
    mainBlock
      ? `<div class="page-grid"><div class="page-main">${mainBlock}</div><aside class="page-side">${sideSections}</aside></div>`
      : sideSections,
    renderFooter(meta, loadamVersion),
    `<script type="application/json" id="loadam-data">${escScript(JSON.stringify(dataPayload))}</script>`,
    DOWNLOAD_SCRIPT,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function renderHeader(
  meta: SessionMeta,
  overall: OverallStatus,
  k6: Record<string, K6Summary> | undefined,
): string {
  const modeLabel = describeModes(meta, k6);
  const chipText = overall.detail ? `${overall.detail} · ${overall.label}` : overall.label;
  return `
<div class="brand-row">
  <a class="brand" href="https://github.com/DesmondSanctity/loadam" target="_blank" rel="noopener" title="loadam on GitHub">
    <svg class="brand-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <defs><linearGradient id="loadam-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f59e0b"/><stop offset="1" stop-color="#ef4444"/></linearGradient></defs>
      <path d="M3 18 A 9 9 0 0 1 21 18" stroke="url(#loadam-g)" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M12 18 L17 10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="12" cy="18" r="1.6" fill="currentColor"/>
    </svg>
    <span class="brand-name">load<span class="brand-name-am">am</span></span>
  </a>
  <span class="brand-tag">load tests &amp; contract checks from OpenAPI</span>
</div>
<header class="hdr">
  <div class="hdr-left">
    <div class="cmd">${esc(meta.command)}${modeLabel ? ` · ${esc(modeLabel)}` : ""} <span class="status-chip ${overall.cls}">${esc(chipText)}</span></div>
    <h1>${esc(meta.spec.title ?? "Untitled API")}</h1>
    <div class="sub">${esc(meta.spec.version ?? "")} · target <code>${esc(meta.target ?? "—")}</code></div>
  </div>
  <div class="hdr-right">
    <div class="when">${esc(meta.startedAt)}</div>
    ${
      typeof meta.durationMs === "number"
        ? `<div class="dur">${(meta.durationMs / 1000).toFixed(2)}s</div>`
        : ""
    }
    <div class="actions">
      <button type="button" class="act" data-loadam-download="html" title="Download this HTML report">⬇ Report</button>
      <button type="button" class="act" data-loadam-download="json" title="Download raw run data as JSON">⬇ Data</button>
      <button type="button" class="act" data-loadam-print title="Print or save as PDF">⎙ Print</button>
    </div>
  </div>
</header>`;
}

/**
 * Synthesize a one-line label for what kind of test happened.
 * For `test` sessions, infer from the artefact-derived k6 summary keys
 * ("smoke", "load", or both). For other commands, fall back to the
 * recorded flag.
 */
function describeModes(
  meta: SessionMeta,
  k6: Record<string, K6Summary> | undefined,
): string | undefined {
  if (meta.command !== "test") return undefined;
  const labels = k6 ? Object.keys(k6) : [];
  if (labels.length > 0) return labels.join(" + ");
  const flagMode = meta.flags.mode;
  if (typeof flagMode === "string" && flagMode !== "skip") return flagMode;
  return "generated only";
}

/**
 * When the run failed, show a compact "why" panel up top so a reader
 * doesn't have to scan the whole report to learn what broke.
 */
function renderFailureReason(
  meta: SessionMeta,
  overall: OverallStatus,
  k6: Record<string, K6Summary> | undefined,
  contractFailures: ContractFailure[] | undefined,
): string {
  if (overall.cls === "ok" || overall.cls === "muted") return "";
  const reasons: string[] = [];
  const failedThresh = (meta.thresholds?.failed ?? []).filter((n) => !isSentinelThreshold(n));
  if (failedThresh.length > 0) {
    // Show a compact summary line + collapsible <details> for the full list.
    // Avoids drowning the page when many thresholds fail at once.
    const PREVIEW = 3;
    const head = failedThresh
      .slice(0, PREVIEW)
      .map((t) => `<code>${esc(t)}</code>`)
      .join(", ");
    const rest = failedThresh.slice(PREVIEW);
    const more =
      rest.length > 0
        ? ` <details class="more"><summary>+${rest.length} more</summary>${rest.map((t) => `<code>${esc(t)}</code>`).join(", ")}</details>`
        : "";
    reasons.push(
      `<strong>${failedThresh.length}</strong> threshold${failedThresh.length === 1 ? "" : "s"} failed: ${head}${more}`,
    );
  }
  if (k6) {
    for (const [name, s] of Object.entries(k6)) {
      const checks = s.root_group?.checks;
      if (!checks) continue;
      const entries = Object.values(checks);
      const failed = entries.filter((c) => c.fails > 0);
      const totalChecks = entries.length;
      if (failed.length > 0) {
        reasons.push(
          `<strong>${name}</strong>: ${failed.length}/${totalChecks} operation check${failed.length === 1 ? "" : "s"} failed`,
        );
      }
    }
  }
  if (contractFailures && contractFailures.length > 0) {
    reasons.push(
      `<strong>${contractFailures.length}</strong> contract test${contractFailures.length === 1 ? "" : "s"} failed`,
    );
  }
  if (reasons.length === 0 && typeof meta.exitCode === "number" && meta.exitCode !== 0) {
    reasons.push(`Process exited with code <code>${meta.exitCode}</code>`);
  }
  if (reasons.length === 0) return "";
  const heading = overall.cls === "bad" ? "Why this failed" : "Issues to investigate";
  return `
<section class="reason ${overall.cls}">
  <h2>${heading}</h2>
  <ul>${reasons.map((r) => `<li>${r}</li>`).join("")}</ul>
</section>`;
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
  if (!t) return "";
  const failed = t.failed.filter((n) => !isSentinelThreshold(n));
  const passed = t.passed.filter((n) => !isSentinelThreshold(n));
  if (failed.length === 0 && passed.length === 0) return "";
  // Sidebar threshold panel: show a tier summary + cap the visible list.
  // The full list is always available in the embedded JSON / endpoint pane.
  const PREVIEW = 4;
  const failedHead = failed.slice(0, PREVIEW);
  const failedRest = failed.slice(PREVIEW);
  const passedHead = passed.slice(0, PREVIEW);
  const passedRest = passed.slice(PREVIEW);
  const summary: string[] = [];
  if (failed.length > 0) summary.push(`<span class="bad">${failed.length} failed</span>`);
  if (passed.length > 0) summary.push(`<span class="ok">${passed.length} passed</span>`);
  return `
<section>
  <h2>Thresholds <span class="muted">(${summary.join(" · ")})</span></h2>
  <ul class="thr">
    ${failedHead.map((x) => `<li class="bad">✗ ${esc(x)}</li>`).join("\n    ")}
    ${failedRest.length > 0 ? `<li class="thr-more"><details><summary>+${failedRest.length} more failed</summary><ul class="thr">${failedRest.map((x) => `<li class="bad">✗ ${esc(x)}</li>`).join("")}</ul></details></li>` : ""}
    ${passedHead.map((x) => `<li class="ok">✓ ${esc(x)}</li>`).join("\n    ")}
    ${passedRest.length > 0 ? `<li class="thr-more"><details><summary>+${passedRest.length} more passed</summary><ul class="thr">${passedRest.map((x) => `<li class="ok">✓ ${esc(x)}</li>`).join("")}</ul></details></li>` : ""}
  </ul>
</section>`;
}

/**
 * Swagger-like endpoint browser with a sidebar layout: a scrollable
 * list of operations on the left, the selected operation's detail on
 * the right. Pure CSS — uses hidden radio inputs + `:checked ~` sibling
 * selectors so the experience scales to hundreds of endpoints with no
 * JavaScript and no layout fragility.
 *
 * On narrow screens the layout collapses: sidebar becomes a horizontal
 * strip and the detail pane stacks below.
 */
function renderEndpoints(
  ops: Operation[] | undefined,
  k6: Record<string, K6Summary> | undefined,
): string {
  if (!ops || ops.length === 0) return "";
  const runs = k6 ? Object.entries(k6) : [];

  // Map op-id → recorded check entries (one per run).
  const checkLookup = new Map<string, Array<{ run: string; check: K6Check }>>();
  for (const op of ops) checkLookup.set(op.id, []);
  for (const [run, summary] of runs) {
    const checks = summary.root_group?.checks;
    if (!checks) continue;
    for (const c of Object.values(checks)) {
      const opId = c.name.split(/\s+/)[0];
      if (opId && checkLookup.has(opId)) {
        checkLookup.get(opId)?.push({ run, check: c });
      }
    }
  }

  // Per-op latency p95 + status-code distribution per run, harvested from
  // sub-metrics surfaced by the sentinel thresholds in the generated rig.
  const opMetrics = collectOpMetrics(ops, k6);

  // Group by first tag for navigability when there are many endpoints.
  // Operations without tags fall under "default".
  const groups = new Map<string, Operation[]>();
  for (const op of ops) {
    const tag = op.tags?.[0] ?? "default";
    if (!groups.has(tag)) groups.set(tag, []);
    groups.get(tag)?.push(op);
  }

  const opSlug = (op: Operation): string => slug(`ep-${op.id}`);

  // Sidebar: grouped lists of <label>s pointing to hidden radios.
  const sidebar = Array.from(groups.entries())
    .map(([tag, list]) => {
      const items = list
        .map((op, _i) => {
          const status = endpointStatus(checkLookup.get(op.id) ?? []);
          const id = opSlug(op);
          const rateLabel = status.rate === null ? "" : fmtRate(status.rate);
          const p95 = opMetrics.get(op.id)?.p95;
          const p95Label = typeof p95 === "number" ? `${Math.round(p95)}ms` : "";
          return `<label for="${esc(id)}" class="ep-item ${status.cls}" data-state="${status.cls}" title="${esc(op.method.toUpperCase())} ${esc(op.path)}">
        <span class="ep-item-row">
          <span class="ep-method ${esc(op.method.toLowerCase())}">${esc(op.method.toUpperCase())}</span>
          <span class="ep-item-path">${esc(op.path)}</span>
          <span class="ep-item-dot ${status.cls}" aria-label="${esc(status.label)}"></span>
        </span>
        ${rateLabel || p95Label ? `<span class="ep-item-meta">${rateLabel ? `<span class="ep-item-rate ${status.cls}">${esc(rateLabel)}</span> <span class="ep-item-state ${status.cls}">${esc(status.label)}</span>` : ""}${p95Label ? ` <span class="ep-item-p95">p95 ${esc(p95Label)}</span>` : ""}</span>` : ""}
      </label>`;
        })
        .join("\n      ");
      return `<div class="ep-group">
      <div class="ep-group-h">${esc(tag)}</div>
      ${items}
    </div>`;
    })
    .join("\n    ");

  // Hidden radios — first one checked by default so the right pane is never blank.
  const radios = ops
    .map((op, i) => {
      const id = opSlug(op);
      return `<input type="radio" name="loadam-endpoint" id="${esc(id)}" class="ep-radio"${i === 0 ? " checked" : ""}>`;
    })
    .join("");

  // Headline + tier counts (also reused for filter chip labels).
  const totals = ops.map((op) => endpointStatus(checkLookup.get(op.id) ?? []));
  const failedCount = totals.filter((t) => t.cls === "bad").length;
  const flakyCount = totals.filter((t) => t.cls === "warn").length;
  const passedCount = totals.filter((t) => t.cls === "ok").length;
  const noDataCount = totals.length - failedCount - flakyCount - passedCount;
  const parts: string[] = [`${ops.length} endpoint${ops.length === 1 ? "" : "s"}`];
  if (runs.length > 0) {
    parts.push(`${passedCount} passed`);
    if (flakyCount > 0) parts.push(`${flakyCount} flaky`);
    if (failedCount > 0) parts.push(`${failedCount} failed`);
    if (noDataCount > 0) parts.push(`${noDataCount} no data`);
  }
  const headline = parts.join(" · ");

  // Filter chips: 4 hidden radios + 4 labels. CSS rules below hide items
  // whose `data-state` doesn't match the active filter.
  const filterRadios = [
    `<input type="radio" name="loadam-ep-filter" id="ep-filter-all" class="ep-filter-radio" checked>`,
    `<input type="radio" name="loadam-ep-filter" id="ep-filter-bad" class="ep-filter-radio">`,
    `<input type="radio" name="loadam-ep-filter" id="ep-filter-warn" class="ep-filter-radio">`,
    `<input type="radio" name="loadam-ep-filter" id="ep-filter-ok" class="ep-filter-radio">`,
  ].join("");
  const filterChips = `<div class="ep-filter">
    <label for="ep-filter-all" title="Show all endpoints">All ${ops.length}</label>
    <label for="ep-filter-bad" class="bad" title="Show failed endpoints only">Failed ${failedCount}</label>
    <label for="ep-filter-warn" class="warn" title="Show flaky endpoints only">Flaky ${flakyCount}</label>
    <label for="ep-filter-ok" class="ok" title="Show passed endpoints only">Passed ${passedCount}</label>
  </div>`;

  // Detail panes — one per op, only the matching one is displayed.
  const panes = ops
    .map((op) => {
      const opChecks = checkLookup.get(op.id) ?? [];
      const status = endpointStatus(opChecks);
      const id = opSlug(op);
      const rateLabel =
        status.rate === null
          ? ""
          : ` <span class="ep-pill-rate">${esc(fmtRate(status.rate))}</span>`;
      const pill = `<span class="ep-pill ${status.cls}">${esc(status.label)}${rateLabel}</span>`;
      const runStrip = opChecks
        .map(({ run, check }) => {
          const total = check.passes + check.fails;
          const rate = total > 0 ? check.passes / total : 0;
          const cls = rate >= PASS_RATE_OK ? "ok" : rate >= PASS_RATE_WARN ? "warn" : "bad";
          const pct = total > 0 ? fmtRate(rate) : "";
          return `<span class="ep-run ${cls}"><strong>${esc(run)}</strong> ${check.passes}/${total} passed${pct ? ` · ${pct}` : ""}</span>`;
        })
        .join("");
      const checkRows = opChecks
        .map(({ run, check }) => {
          const total = check.passes + check.fails;
          const rate = total > 0 ? check.passes / total : 0;
          const cls = rate >= PASS_RATE_OK ? "ok" : rate >= PASS_RATE_WARN ? "warn" : "bad";
          const pct = total > 0 ? ` <span class="muted">(${fmtRate(rate)})</span>` : "";
          return `<tr class="${cls}"><th>${esc(run)}</th><td>${esc(check.name)}</td><td>${check.passes}/${total} passed${pct}</td></tr>`;
        })
        .join("");
      const detail = checkRows
        ? `<table class="kv ep-detail"><thead><tr><th>run</th><th>check</th><th>result</th></tr></thead><tbody>${checkRows}</tbody></table>`
        : `<p class="hint">No k6 checks recorded for this operation.</p>`;
      const metricsBlock = renderOpMetricsBlock(opMetrics.get(op.id));
      const tags = (op.tags ?? []).map((t) => `<span class="ep-tag">${esc(t)}</span>`).join("");
      return `<div class="ep-pane" data-ep="${esc(id)}">
      <div class="ep-pane-h">
        <span class="ep-method ${esc(op.method.toLowerCase())}">${esc(op.method.toUpperCase())}</span>
        <span class="ep-path"><code>${esc(op.path)}</code></span>
        ${pill}
      </div>
      ${op.summary ? `<p class="ep-pane-sum">${esc(op.summary)}</p>` : ""}
      ${tags ? `<div class="ep-tags">${tags}</div>` : ""}
      ${runStrip ? `<div class="ep-runs">${runStrip}</div>` : ""}
      ${metricsBlock}
      ${detail}
    </div>`;
    })
    .join("\n    ");

  return `
<section class="endpoints">
  <h2>Endpoints <span class="muted">(${esc(headline)})</span></h2>
  <p class="hint">Status uses pass-rate tiers: <span class="tier ok">passed ≥ ${PASS_RATE_OK * 100}%</span> · <span class="tier warn">flaky ${PASS_RATE_WARN * 100}–${PASS_RATE_OK * 100}%</span> · <span class="tier bad">failed &lt; ${PASS_RATE_WARN * 100}%</span>.</p>
  <div class="ep-layout">
    ${filterRadios}
    ${radios}
    <aside class="ep-sidebar">
    ${filterChips}
    ${sidebar}
    </aside>
    <div class="ep-main">
    ${panes}
    </div>
  </div>
</section>`;
}

/**
 * Tiered SLO thresholds for endpoint check pass-rate.
 * Aligns with k6's standard threshold convention (e.g. `checks: rate>=0.95`).
 */
const PASS_RATE_OK = 0.99; // \u2265 99% \u2192 passed
const PASS_RATE_WARN = 0.95; // 95\u201399% \u2192 flaky / warn

function endpointStatus(opChecks: Array<{ run: string; check: K6Check }>): {
  cls: "ok" | "warn" | "bad" | "muted";
  label: string;
  rate: number | null;
} {
  if (opChecks.length === 0) return { cls: "muted", label: "no data", rate: null };
  let passes = 0;
  let total = 0;
  for (const { check } of opChecks) {
    passes += check.passes;
    total += check.passes + check.fails;
  }
  if (total === 0) return { cls: "muted", label: "no data", rate: null };
  const rate = passes / total;
  if (rate >= PASS_RATE_OK) return { cls: "ok", label: "passed", rate };
  if (rate >= PASS_RATE_WARN) return { cls: "warn", label: "flaky", rate };
  return { cls: "bad", label: "failed", rate };
}

function fmtRate(rate: number | null): string {
  if (rate === null) return "";
  // Show one decimal when it adds information (e.g. 99.3%), zero otherwise.
  const pct = rate * 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}

interface OverallStatus {
  cls: "ok" | "warn" | "bad" | "muted";
  label: string;
  /** Compact secondary text (e.g. "2/3 endpoints" or "97.8%"). Empty when none. */
  detail: string;
}

/**
 * Aggregate overall test status across endpoints (preferred) or k6 checks
 * (fallback) using the same 3-tier model as endpointStatus.
 *
 * The header chip shows this so a reader sees nuance ("flaky 67%") instead
 * of a binary "failed" when most endpoints actually passed.
 */
function computeOverall(
  meta: SessionMeta,
  k6: Record<string, K6Summary> | undefined,
  ops: Operation[] | undefined,
): OverallStatus {
  // Hard-fail signals win: explicit threshold failures or non-zero exit
  // without any check data → straight "failed".
  const thresholdsFailed = (meta.thresholds?.failed ?? []).some((n) => !isSentinelThreshold(n));

  // Per-endpoint aggregation when we have the operation map.
  if (ops && ops.length > 0 && k6) {
    const lookup = new Map<string, Array<K6Check>>();
    for (const op of ops) lookup.set(op.id, []);
    for (const summary of Object.values(k6)) {
      const checks = summary.root_group?.checks;
      if (!checks) continue;
      for (const c of Object.values(checks)) {
        const opId = c.name.split(/\s+/)[0];
        if (opId && lookup.has(opId)) lookup.get(opId)?.push(c);
      }
    }
    let okN = 0;
    let warnN = 0;
    let badN = 0;
    let withData = 0;
    for (const op of ops) {
      const opChecks = lookup.get(op.id) ?? [];
      const status = endpointStatus(opChecks.map((check) => ({ run: "", check })));
      if (status.cls === "ok") {
        okN++;
        withData++;
      } else if (status.cls === "warn") {
        warnN++;
        withData++;
      } else if (status.cls === "bad") {
        badN++;
        withData++;
      }
    }
    if (withData > 0) {
      const detail = `${okN}/${ops.length} endpoints`;
      if (badN === 0 && warnN === 0) {
        return { cls: "ok", label: "passed", detail };
      }
      // Tier the overall classification by ratio of passing endpoints.
      const passingRate = (okN + warnN * 0.5) / ops.length;
      if (badN === 0) return { cls: "warn", label: "flaky", detail };
      if (passingRate >= PASS_RATE_WARN) return { cls: "warn", label: "partial", detail };
      if (passingRate >= 0.5) return { cls: "warn", label: "partial", detail };
      return { cls: "bad", label: "failed", detail };
    }
  }

  // Fallback: aggregate raw k6 checks across all summaries.
  if (k6) {
    let passes = 0;
    let total = 0;
    for (const summary of Object.values(k6)) {
      const checks = summary.root_group?.checks;
      if (!checks) continue;
      for (const c of Object.values(checks)) {
        passes += c.passes;
        total += c.passes + c.fails;
      }
    }
    if (total > 0) {
      const rate = passes / total;
      const detail = fmtRate(rate);
      if (rate >= PASS_RATE_OK && !thresholdsFailed) {
        return { cls: "ok", label: "passed", detail };
      }
      if (rate >= PASS_RATE_WARN && !thresholdsFailed) {
        return { cls: "warn", label: "flaky", detail };
      }
      return { cls: "bad", label: "failed", detail };
    }
  }

  // No check data → fall back to exit-code/threshold signal.
  if (thresholdsFailed || (meta.exitCode !== undefined && meta.exitCode !== 0)) {
    return { cls: "bad", label: "failed", detail: "" };
  }
  return { cls: "ok", label: "passed", detail: "" };
}

interface OpRunMetric {
  /** Per-op p95 latency in ms (null when unknown). */
  p95: number | null;
  /** Status-code bucket counts: 1xx/2xx/3xx/4xx/5xx → request count. */
  buckets: Record<string, number>;
  /** Total observed requests for this op in this run. */
  total: number;
}

interface OpMetrics {
  perRun: Map<string, OpRunMetric>;
  /** Combined p95 across runs (if known) — load takes precedence. */
  p95: number | null;
}

/**
 * Pull `loadam_op_latency{name:opId}` and `loadam_op_status{name:opId,bucket:Nxx}`
 * sub-metrics out of each k6 summary. The sentinel thresholds emitted by the
 * generated rig force k6 to include these in summary export.
 */
function collectOpMetrics(
  ops: Operation[],
  k6: Record<string, K6Summary> | undefined,
): Map<string, OpMetrics> {
  const out = new Map<string, OpMetrics>();
  for (const op of ops) out.set(op.id, { perRun: new Map(), p95: null });
  if (!k6) return out;

  for (const [runName, summary] of Object.entries(k6)) {
    const metrics = summary.metrics;
    if (!metrics) continue;
    for (const op of ops) {
      // Match keys with k6's tag-syntax sub-metric (`metric{tag:value}`).
      // k6 normalises the brace contents, so we accept any whitespace.
      const latencyKey = Object.keys(metrics).find(
        (k) => k.startsWith("loadam_op_latency{") && k.includes(`name:${op.id}`),
      );
      const p95 =
        latencyKey && typeof metrics[latencyKey]?.values?.["p(95)"] === "number"
          ? (metrics[latencyKey].values["p(95)"] as number)
          : null;

      const buckets: Record<string, number> = {};
      let total = 0;
      for (const [k, m] of Object.entries(metrics)) {
        if (!k.startsWith("loadam_op_status{") || !k.includes(`name:${op.id}`)) continue;
        const bucket = (k.match(/bucket:([0-9]xx)/) ?? [])[1];
        if (!bucket) continue;
        const count = typeof m.values?.count === "number" ? (m.values.count as number) : 0;
        if (count > 0) {
          buckets[bucket] = count;
          total += count;
        }
      }

      const entry = out.get(op.id);
      if (entry) {
        entry.perRun.set(runName, { p95, buckets, total });
        // Prefer the load run's p95 (more representative); fall back to any.
        if (runName === "load" && p95 !== null) entry.p95 = p95;
        else if (entry.p95 === null && p95 !== null) entry.p95 = p95;
      }
    }
  }
  return out;
}

/**
 * Threshold names emitted as sentinels by the generated rig — filtered out
 * of the failure panel so users only see meaningful threshold breaches.
 * Names may arrive prefixed with the run label (e.g. `smoke: loadam_op_…`)
 * since `digestK6Summary` decorates entries with their run name.
 */
function isSentinelThreshold(name: string): boolean {
  // Strip optional `<run>: ` prefix (added by digestK6Summary).
  const stripped = name.replace(/^[a-zA-Z0-9_-]+:\s+/, "");
  return stripped.startsWith("loadam_op_latency") || stripped.startsWith("loadam_op_status");
}

const BUCKET_ORDER = ["1xx", "2xx", "3xx", "4xx", "5xx"];
const BUCKET_CLASS: Record<string, "ok" | "warn" | "bad" | "muted"> = {
  "1xx": "muted",
  "2xx": "ok",
  "3xx": "ok",
  "4xx": "bad",
  "5xx": "bad",
};

/**
 * Render the per-operation latency + status-code distribution block shown
 * inside an endpoint's detail pane. Returns "" when no metrics were
 * captured (e.g. older session without sentinel thresholds).
 */
function renderOpMetricsBlock(metrics: OpMetrics | undefined): string {
  if (!metrics || metrics.perRun.size === 0) return "";
  const rows: string[] = [];
  for (const [run, m] of metrics.perRun) {
    if (m.total === 0 && m.p95 === null) continue;
    const segments = BUCKET_ORDER.filter((b) => (m.buckets[b] ?? 0) > 0)
      .map((b) => {
        const count = m.buckets[b] ?? 0;
        const pct = m.total > 0 ? (count / m.total) * 100 : 0;
        return `<span class="bkt ${BUCKET_CLASS[b]}" style="width:${pct.toFixed(2)}%" title="${b} \u00b7 ${count} req \u00b7 ${pct.toFixed(1)}%">${b} ${count}</span>`;
      })
      .join("");
    const p95 = m.p95 !== null ? `${Math.round(m.p95)}ms` : "—";
    rows.push(`<tr>
      <th>${esc(run)}</th>
      <td class="num">${m.total}</td>
      <td class="num">${esc(p95)}</td>
      <td><div class="bkt-bar">${segments || `<span class="muted">no data</span>`}</div></td>
    </tr>`);
  }
  if (rows.length === 0) return "";
  return `<table class="kv ep-metrics">
  <thead><tr><th>run</th><th>requests</th><th>p95</th><th>status codes</th></tr></thead>
  <tbody>${rows.join("")}</tbody>
</table>`;
}

/**
 * Per-summary block: latency table, percentile bars, and any failed
 * per-operation checks. When more than one summary is present (e.g.
 * `--mode both` produced both a smoke and a load run), wrap the blocks
 * in CSS-only radio-button tabs so a reader can compare them.
 */
function renderK6Section(k6: Record<string, K6Summary> | undefined, hasEndpoints: boolean): string {
  if (!k6) return "";
  const entries = Object.entries(k6);
  if (entries.length === 0) return "";
  const blocks = entries
    .map(([name, summary]) => ({ name, html: renderK6Block(name, summary, hasEndpoints) }))
    .filter((b) => b.html !== "");
  if (blocks.length === 0) return "";
  if (blocks.length === 1) {
    return `<section><h2>k6 results</h2>${blocks[0]?.html ?? ""}</section>`;
  }
  // Tabbed: hidden radios + sibling labels + scoped panes. First tab default-checked.
  const tabs = blocks
    .map((b, i) => {
      const id = `loadam-tab-${slug(b.name)}`;
      return `
    <input type="radio" name="loadam-k6-tab" id="${esc(id)}" class="tab-input"${i === 0 ? " checked" : ""}>`;
    })
    .join("");
  const labels = blocks
    .map((b) => {
      const id = `loadam-tab-${slug(b.name)}`;
      return `<label for="${esc(id)}" class="tab-label">${esc(b.name)}</label>`;
    })
    .join("");
  const panes = blocks
    .map((b) => `<div class="tab-pane" data-tab="${esc(slug(b.name))}">${b.html}</div>`)
    .join("");
  return `
<section class="tabs">
  <h2>k6 results <span class="tab-hint">(${blocks.length} runs — click to switch)</span></h2>${tabs}
  <div class="tab-bar">${labels}</div>
  ${panes}
</section>`;
}

function renderK6Block(name: string, summary: K6Summary, hasEndpoints: boolean): string {
  const metrics = summary.metrics ?? {};
  const dur = metrics.http_req_duration?.values;
  const reqs = metrics.http_reqs?.values;
  const failed = metrics.http_req_failed?.values;
  const headlineCells: Array<{ label: string; value: string }> = [];
  if (dur && typeof dur["p(95)"] === "number")
    headlineCells.push({ label: "p95", value: fmtMs(dur["p(95)"]) });
  if (reqs && typeof reqs.count === "number")
    headlineCells.push({ label: "requests", value: String(reqs.count) });
  if (reqs && typeof reqs.rate === "number")
    headlineCells.push({ label: "rps", value: `${reqs.rate.toFixed(1)}/s` });
  if (failed && typeof failed.rate === "number")
    headlineCells.push({ label: "errors", value: `${(failed.rate * 100).toFixed(2)}%` });

  const headline =
    headlineCells.length > 0
      ? `<div class="cards inner">${headlineCells
          .map(
            (c) =>
              `<div class="card"><div class="card-v">${esc(c.value)}</div><div class="card-l">${esc(c.label)}</div></div>`,
          )
          .join("")}</div>`
      : "";

  const latency = dur
    ? `
    <h3>http_req_duration</h3>
    <table class="kv">
      <tbody>
        ${(
          [
            ["min", fmtMs(dur.min)],
            ["med", fmtMs(dur.med)],
            ["avg", fmtMs(dur.avg)],
            ["p(90)", fmtMs(dur["p(90)"])],
            ["p(95)", fmtMs(dur["p(95)"])],
            ["p(99)", fmtMs(dur["p(99)"])],
            ["max", fmtMs(dur.max)],
          ] as Array<[string, string]>
        )
          .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
          .join("")}
      </tbody>
    </table>
    ${renderPercentileBars(dur)}`
    : "";

  const checks = summary.root_group?.checks;
  // When the Endpoints section already exists in the main column, every
  // check appears on its parent endpoint card — so here we replace the
  // full per-operation list with a one-line summary to keep the sticky
  // sidebar short. With no endpoints (e.g. an older session that lacked
  // ir.json), we still render the full list so nothing is lost.
  const checkBlock = checks
    ? hasEndpoints
      ? renderChecksSummary(checks)
      : renderChecks(checks)
    : "";

  if (!headline && !latency && !checkBlock) return "";
  return `
  <div class="metric-block">
    ${headline}
    ${latency}
    ${checkBlock}
  </div>`;
}

/**
 * Compact one-liner used in the sidebar to avoid repeating the
 * per-operation breakdown that's already shown on each endpoint card.
 */
function renderChecksSummary(checks: Record<string, K6Check>): string {
  const entries = Object.values(checks);
  if (entries.length === 0) return "";
  // Tier each check by its individual pass-rate so the summary mirrors
  // the per-endpoint cards (a 99.3% pass-rate is "flaky", not "failed").
  let ok = 0;
  let warn = 0;
  let bad = 0;
  let totalPasses = 0;
  let totalInvocations = 0;
  for (const c of entries) {
    const t = c.passes + c.fails;
    totalPasses += c.passes;
    totalInvocations += t;
    const r = t > 0 ? c.passes / t : 0;
    if (r >= PASS_RATE_OK) ok++;
    else if (r >= PASS_RATE_WARN) warn++;
    else bad++;
  }
  const cls = bad > 0 ? "bad" : warn > 0 ? "warn" : "ok";
  const overallRate = totalInvocations > 0 ? totalPasses / totalInvocations : 0;
  const parts = [`<strong>${ok}</strong>/${entries.length} passed`];
  if (warn > 0) parts.push(`<span class="warn-text">${warn} flaky</span>`);
  if (bad > 0) parts.push(`<span class="bad-text">${bad} failed</span>`);
  return `
    <div class="chk-line"><span class="chk-tag ${cls}">checks</span> ${parts.join(" · ")} <span class="muted">· ${esc(fmtRate(overallRate))} overall</span></div>`;
}

function renderChecks(checks: Record<string, K6Check>): string {
  const entries = Object.values(checks);
  if (entries.length === 0) return "";
  const failed = entries.filter((c) => c.fails > 0);
  const passed = entries.length - failed.length;
  const summaryLine = `${passed}/${entries.length} passed${failed.length > 0 ? ` · ${failed.length} failed` : ""}`;
  const row = (c: K6Check, kind: "bad" | "ok"): string => {
    const total = c.passes + c.fails;
    return `<tr class="${kind}"><th>${esc(c.name)}</th><td><span class="chk-count">${c.passes}<span class="chk-sep">/</span>${total}</span> <span class="chk-word">passed</span></td></tr>`;
  };
  const failedRows = failed.map((c) => row(c, "bad")).join("");
  const passedRows = entries
    .filter((c) => c.fails === 0)
    .map((c) => row(c, "ok"))
    .join("");
  return `
    <h3>Per-operation checks <span class="muted">(${esc(summaryLine)})</span></h3>
    <p class="hint">Each row shows <em>passed / invoked</em>: how many times this assertion held vs. how many times it ran (one invocation per request).</p>
    <table class="kv checks">
      <tbody>${failedRows}${passedRows}</tbody>
    </table>`;
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "tab"
  );
}

/**
 * Generate scoped CSS that lights up the matching endpoint pane and
 * sidebar item when its hidden radio is `:checked`. Pure CSS, no JS.
 */
function dynamicEndpointStyles(ops: Operation[] | undefined): string {
  if (!ops || ops.length === 0) return "";
  return ops
    .map((op) => {
      const id = slug(`ep-${op.id}`);
      return `
.ep-layout > input#${id}:checked ~ .ep-main .ep-pane[data-ep="${id}"]{display:block}
.ep-layout > input#${id}:checked ~ .ep-sidebar label[for="${id}"]{background:var(--card);color:var(--fg);box-shadow:inset 2px 0 0 var(--acc)}`;
    })
    .join("");
}

/**
 * Generate scoped CSS that lights up the matching tab pane / label
 * when its sibling radio is `:checked`. Pure CSS, no JS.
 */
function dynamicTabStyles(k6: Record<string, K6Summary> | undefined): string {
  if (!k6) return "";
  const names = Object.keys(k6);
  if (names.length < 2) return "";
  const rules = names
    .map((n) => {
      const s = slug(n);
      const id = `loadam-tab-${s}`;
      return `
section.tabs > input#${id}:checked ~ .tab-bar label[for="${id}"]{background:var(--card);color:var(--fg);border-color:var(--brd);border-bottom-color:var(--card)}
section.tabs > input#${id}:checked ~ .tab-pane[data-tab="${s}"]{display:block}`;
    })
    .join("\n");
  return rules;
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
  Generated by <a href="https://github.com/DesmondSanctity/loadam" target="_blank" rel="noopener">loadam ${esc(version)}</a> ·
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
  --warn:#a16207;--warn-bg:#fef3c7;
  --acc:#2563eb;--bar:#3b82f6;--code:#f4f4f5;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#0a0a0a;--fg:#f5f5f5;--mut:#a1a1aa;--brd:#27272a;--card:#18181b;
    --ok:#86efac;--ok-bg:#14532d;--bad:#fca5a5;--bad-bg:#7f1d1d;
    --warn:#fcd34d;--warn-bg:#78350f;
    --acc:#60a5fa;--bar:#3b82f6;--code:#27272a;
  }
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
body{max-width:1200px;margin:0 auto;padding:24px 20px 60px}
h1{font-size:20px;margin:0 0 4px}
h2{font-size:15px;margin:24px 0 12px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}
h3{font-size:14px;margin:16px 0 8px;font-weight:600}
code{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--code);padding:1px 6px;border-radius:3px}
a{color:var(--acc);text-decoration:none}
a:hover{text-decoration:underline}
section{margin-top:8px}
.brand-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:14px;margin-bottom:16px;border-bottom:1px solid var(--brd)}
.brand{display:inline-flex;align-items:center;gap:8px;color:var(--fg);text-decoration:none;font-weight:700;font-size:16px;letter-spacing:-0.01em;line-height:1}
.brand:hover{text-decoration:none;opacity:.8}
.brand svg.brand-mark{width:22px;height:22px;display:block;color:var(--fg)}
.brand-name{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}
.brand-name-am{background:linear-gradient(135deg,#f59e0b,#ef4444);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}
.brand-tag{font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:.08em;font-weight:500}
@media (max-width:600px){.brand-tag{display:none}}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:16px;border-bottom:1px solid var(--brd)}
.hdr-left .cmd{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.hdr-left .sub{color:var(--mut);font-size:13px;margin-top:4px}
.hdr-right{text-align:right}
.hdr-right .when,.hdr-right .dur{font-size:12px;color:var(--mut);margin-top:2px;font-variant-numeric:tabular-nums}
.status-chip{display:inline-block;padding:2px 8px;border-radius:3px;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.status-chip.ok{background:var(--ok-bg);color:var(--ok)}
.status-chip.warn{background:var(--warn-bg);color:var(--warn)}
.status-chip.bad{background:var(--bad-bg);color:var(--bad)}
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
.reason{background:var(--bad-bg);border:1px solid var(--bad);border-radius:6px;padding:12px 16px;margin-top:20px}
.reason.warn{background:var(--warn-bg);border-color:var(--warn)}
.reason h2{margin:0 0 8px;color:var(--bad);text-transform:uppercase;letter-spacing:.04em;font-size:12px}
.reason.warn h2{color:var(--warn)}
.reason ul{margin:0;padding:0 0 0 18px}
.reason li{margin:4px 0;font-size:13px}
.reason details.more{display:inline;margin-left:6px}
.reason details.more summary{display:inline;cursor:pointer;color:var(--mut);font-size:12px;list-style:none}
.reason details.more summary::-webkit-details-marker{display:none}
.reason details.more summary:hover{color:var(--fg)}
.reason details.more[open] summary{display:block;margin-bottom:4px}
.thr li.thr-more{list-style:none;margin-left:-18px}
.thr li.thr-more details summary{cursor:pointer;font-size:11px;color:var(--mut);padding:2px 0}
.thr li.thr-more details summary:hover{color:var(--fg)}
.thr li.thr-more details ul.thr{margin-top:4px;padding-left:14px}
.reason code{background:rgba(0,0,0,.12)}
.muted{color:var(--mut);font-weight:400;font-size:11px}
table.checks tr.bad th,table.checks tr.bad td{color:var(--bad);background:var(--bad-bg)}
table.checks tr.warn th,table.checks tr.warn td{color:var(--warn);background:var(--warn-bg)}
table.checks tr.ok th{color:var(--mut)}
table.checks tr.ok td{color:var(--ok)}
.ep-detail tr.bad th,.ep-detail tr.bad td{color:var(--bad);background:var(--bad-bg)}
.ep-detail tr.warn th,.ep-detail tr.warn td{color:var(--warn);background:var(--warn-bg)}
.ep-detail tr.ok th{color:var(--mut)}
.ep-detail tr.ok td{color:var(--ok)}
.tier{display:inline-block;padding:1px 7px;border-radius:9px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.tier.ok{background:var(--ok-bg);color:var(--ok)}
.tier.warn{background:var(--warn-bg);color:var(--warn)}
.tier.bad{background:var(--bad-bg);color:var(--bad)}
.cards.inner{margin-top:0;margin-bottom:12px;grid-template-columns:repeat(auto-fit,minmax(110px,1fr))}
section.tabs > input.tab-input{position:absolute;opacity:0;pointer-events:none}
section.tabs > .tab-bar{display:flex;gap:0;border-bottom:1px solid var(--brd);margin-top:4px}
section.tabs > .tab-bar .tab-label{padding:8px 16px;cursor:pointer;font-size:13px;font-weight:500;color:var(--mut);border:1px solid transparent;border-bottom:none;border-radius:4px 4px 0 0;margin-bottom:-1px;user-select:none}
section.tabs > .tab-bar .tab-label:hover{color:var(--fg)}
section.tabs > .tab-pane{display:none;padding-top:14px}
section.tabs > h2 .tab-hint{font-size:11px;font-weight:400;color:var(--mut);text-transform:none;letter-spacing:0;margin-left:6px}
.actions{display:flex;gap:6px;margin-top:8px;justify-content:flex-end;flex-wrap:wrap}
.act{font:inherit;font-size:11px;padding:4px 9px;border:1px solid var(--brd);background:var(--card);color:var(--fg);border-radius:4px;cursor:pointer;letter-spacing:.02em}
.act:hover{background:var(--code);border-color:var(--mut)}
.hint{color:var(--mut);font-size:12px;margin:4px 0 8px}
.page-grid{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:24px;align-items:start;margin-top:20px}
.page-main{min-width:0}
.page-side{position:sticky;top:16px;max-height:calc(100vh - 32px);overflow-y:auto;font-size:13px;padding-right:4px}
.page-side h2{margin-top:8px;font-size:11px}
.page-side section{margin-top:16px}
.page-side section:first-child{margin-top:0}
.page-side .cards{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.page-side .card{padding:8px 10px}
.page-side .card-v{font-size:15px}
.page-side .metric-block{padding:10px 12px}
.page-side table.kv th{width:90px;font-size:12px}
.page-side table.kv td{font-size:12px}
.page-side section.tabs > .tab-bar .tab-label{padding:6px 10px;font-size:12px}
.page-side .bar-row{grid-template-columns:48px 1fr 64px}
.page-side .bars{margin-top:6px}
@media (max-width:900px){
  .page-grid{grid-template-columns:1fr;gap:0}
  .page-side{position:static;max-height:none;padding-right:0}
}
.chk-count{font-variant-numeric:tabular-nums;font-weight:600}
.chk-sep{opacity:.5;margin:0 1px}
.chk-word{color:var(--mut);font-size:12px;margin-left:2px}
.chk-line{font-size:12px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px;padding:6px 8px;background:var(--code);border-radius:4px}
.chk-tag{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);padding:2px 6px;border-radius:3px;background:var(--card)}
.chk-tag.ok{color:var(--ok)}
.chk-tag.warn{color:var(--warn);background:var(--warn-bg)}
.chk-tag.bad{color:var(--bad);background:var(--bad-bg)}
.bad-text{color:var(--bad);font-weight:600}
.warn-text{color:var(--warn);font-weight:600}
section.endpoints{margin-top:24px}
.ep-layout{display:grid;grid-template-columns:220px minmax(0,1fr);gap:0;border:1px solid var(--brd);border-radius:6px;background:var(--card);overflow:hidden;min-height:520px}
.ep-layout > .ep-radio{position:absolute;opacity:0;pointer-events:none}
.ep-sidebar{border-right:1px solid var(--brd);background:var(--bg);max-height:820px;overflow-y:auto;padding:6px 0}
.ep-group{padding:6px 0}
.ep-group + .ep-group{border-top:1px solid var(--brd)}
.ep-group-h{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);padding:4px 12px;font-weight:600}
.ep-item{display:flex;flex-direction:column;gap:2px;padding:7px 12px;cursor:pointer;font-size:12px;border-left:2px solid transparent;color:var(--mut);user-select:none}
.ep-item:hover{background:var(--code);color:var(--fg)}
.ep-item-row{display:flex;align-items:center;gap:8px;min-width:0}
.ep-item-path{font:12px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ep-item-meta{display:flex;align-items:center;gap:6px;padding-left:62px;font-size:10px}
.ep-item-state{text-transform:uppercase;letter-spacing:.04em;font-weight:600;font-size:9px;opacity:.85}
.ep-item-state.ok{color:var(--ok)}
.ep-item-state.warn{color:var(--warn)}
.ep-item-state.bad{color:var(--bad)}
.ep-item-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;background:var(--brd)}
.ep-item-dot.ok{background:var(--ok)}
.ep-item-dot.warn{background:var(--warn)}
.ep-item-dot.bad{background:var(--bad)}
.ep-item-dot.muted{background:var(--mut);opacity:.5}
.ep-item-rate{font:11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--mut);font-variant-numeric:tabular-nums;flex-shrink:0}
.ep-item-rate.ok{color:var(--ok)}
.ep-item-rate.warn{color:var(--warn)}
.ep-item-rate.bad{color:var(--bad)}
.ep-item-p95{font:10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--mut);font-variant-numeric:tabular-nums;margin-left:auto;flex-shrink:0;opacity:.85}
.ep-main{padding:18px 20px;overflow-x:auto}
.ep-pane{display:none}
.ep-pane-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}
.ep-pane-sum{margin:4px 0 12px;color:var(--mut);font-size:13px}
.ep-method{display:inline-block;min-width:54px;text-align:center;padding:3px 8px;border-radius:3px;font:11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;letter-spacing:.04em;color:#fff;background:#6b7280}
.ep-method.get{background:#2563eb}
.ep-method.post{background:#15803d}
.ep-method.put{background:#d97706}
.ep-method.patch{background:#7c3aed}
.ep-method.delete{background:#b91c1c}
.ep-path{font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:600}
.ep-path code{background:transparent;padding:0;font-size:13px}
.ep-pill{font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em}
.ep-pill.ok{background:var(--ok-bg);color:var(--ok)}
.ep-pill.warn{background:var(--warn-bg);color:var(--warn)}
.ep-pill.bad{background:var(--bad-bg);color:var(--bad)}
.ep-pill.muted{background:var(--code);color:var(--mut)}
.ep-pill-rate{font:11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:none;letter-spacing:0;font-weight:500;margin-left:4px;opacity:.85}
.ep-runs{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
.ep-run{font-size:12px;padding:3px 8px;border-radius:3px;background:var(--code);font-variant-numeric:tabular-nums}
.ep-run.bad{background:var(--bad-bg);color:var(--bad)}
.ep-run.warn{background:var(--warn-bg);color:var(--warn)}
.ep-run.ok{background:var(--ok-bg);color:var(--ok)}
.ep-run strong{font-weight:600;margin-right:4px;text-transform:uppercase;letter-spacing:.04em;font-size:11px}
.ep-tags{display:flex;gap:4px;flex-wrap:wrap;margin-top:4px}
.ep-tag{font-size:10px;padding:2px 6px;background:var(--code);color:var(--mut);border-radius:3px;text-transform:uppercase;letter-spacing:.04em}
.ep-detail{margin-top:10px}
.ep-detail th:first-child{width:60px;text-transform:uppercase;font-size:10px;letter-spacing:.04em}
.ep-metrics{margin:10px 0 4px;font-size:12px}
.ep-metrics th{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}
.ep-metrics td.num{font-variant-numeric:tabular-nums;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
.bkt-bar{display:flex;height:14px;border-radius:3px;overflow:hidden;background:var(--code);font-size:10px;line-height:14px;font-variant-numeric:tabular-nums;min-width:160px}
.bkt{display:inline-block;text-align:center;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:clip;padding:0 4px;letter-spacing:.02em;font-weight:600}
.bkt.ok{background:var(--ok)}
.bkt.warn{background:var(--warn)}
.bkt.bad{background:var(--bad)}
.bkt.muted{background:var(--mut);opacity:.6}
.ep-filter{display:flex;gap:4px;padding:8px 10px;border-bottom:1px solid var(--brd);background:var(--card)}
.ep-layout > .ep-filter-radio{position:absolute;opacity:0;pointer-events:none}
.ep-filter label{font-size:10px;text-transform:uppercase;letter-spacing:.05em;font-weight:600;padding:4px 8px;border-radius:3px;cursor:pointer;color:var(--mut);background:var(--code);user-select:none}
.ep-filter label:hover{color:var(--fg)}
.ep-filter label.ok{color:var(--ok)}
.ep-filter label.warn{color:var(--warn)}
.ep-filter label.bad{color:var(--bad)}
/* Active chip + matching item visibility — pure CSS via :checked ~ siblings. */
.ep-layout > input#ep-filter-all:checked ~ .ep-sidebar label[for="ep-filter-all"]{background:var(--acc);color:#fff}
.ep-layout > input#ep-filter-bad:checked ~ .ep-sidebar label[for="ep-filter-bad"]{background:var(--bad);color:#fff}
.ep-layout > input#ep-filter-warn:checked ~ .ep-sidebar label[for="ep-filter-warn"]{background:var(--warn);color:#fff}
.ep-layout > input#ep-filter-ok:checked ~ .ep-sidebar label[for="ep-filter-ok"]{background:var(--ok);color:#fff}
.ep-layout > input#ep-filter-bad:checked ~ .ep-sidebar .ep-item:not([data-state="bad"]){display:none}
.ep-layout > input#ep-filter-warn:checked ~ .ep-sidebar .ep-item:not([data-state="warn"]){display:none}
.ep-layout > input#ep-filter-ok:checked ~ .ep-sidebar .ep-item:not([data-state="ok"]){display:none}
/* Hide group headers whose children are all filtered out. Cheap heuristic:
   when a non-"All" filter is active and a group has no children matching
   its tier, we leave the header visible — minor visual noise but no JS. */
@media (max-width:720px){
  .ep-layout{grid-template-columns:1fr;min-height:0}
  .ep-sidebar{max-height:240px;border-right:none;border-bottom:1px solid var(--brd)}
}
@media print{
  .actions{display:none}
  .ep-layout{grid-template-columns:1fr;border:none}
  .ep-sidebar{display:none}
  .ep-pane{display:block!important;break-inside:avoid;border-bottom:1px solid var(--brd);padding-bottom:12px;margin-bottom:12px}
}
footer{margin-top:40px;padding-top:16px;border-top:1px solid var(--brd);color:var(--mut);font-size:12px;text-align:center}
`;

/**
 * Tiny inline script (~600 bytes) that wires the three header buttons.
 * Reads the inlined `<script id="loadam-data">` JSON payload — no fetch,
 * no external resources. The HTML download grabs the live document so
 * users get exactly what they're looking at, including any settings
 * the browser applied (selected tab, etc. — though our tabs are CSS).
 */
const DOWNLOAD_SCRIPT = `<script>(function(){
var d=document,el=d.getElementById('loadam-data');
if(!el)return;
var data;try{data=JSON.parse(el.textContent||'{}')}catch(e){return}
var name=(data&&data.meta&&data.meta.id)||'loadam-report';
function dl(blob,filename){
  var url=URL.createObjectURL(blob);
  var a=d.createElement('a');a.href=url;a.download=filename;
  d.body.appendChild(a);a.click();d.body.removeChild(a);
  setTimeout(function(){URL.revokeObjectURL(url)},1000);
}
var bH=d.querySelector('[data-loadam-download="html"]');
if(bH)bH.addEventListener('click',function(){
  var html='<!doctype html>\\n'+d.documentElement.outerHTML;
  dl(new Blob([html],{type:'text/html'}),name+'.html');
});
var bJ=d.querySelector('[data-loadam-download="json"]');
if(bJ)bJ.addEventListener('click',function(){
  dl(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),name+'.json');
});
var bP=d.querySelector('[data-loadam-print]');
if(bP)bP.addEventListener('click',function(){window.print()});
})();</script>`;
