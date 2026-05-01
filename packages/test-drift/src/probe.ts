import type { IR, Operation } from "@loadam/core";
import type { ProbeResult } from "./diff.js";

export interface ProbeOptions {
  baseUrl: string;
  /** Authorization headers to send with every request. */
  headers?: Record<string, string>;
  /** Per-request timeout in ms. Default 5000. */
  timeoutMs?: number;
  /** When true, only probe GET/HEAD/OPTIONS operations. Default true. */
  safeOnly?: boolean;
  /** Optional path-param overrides keyed by param name (used as fallback). */
  pathParams?: Record<string, string | number>;
}

/**
 * Probe a live API. Single iteration per op, safe-only by default — drift is
 * about the *spec*, not load. Mutating ops are skipped unless explicitly
 * opted into via `safeOnly: false` because we don't want a doc-check tool
 * deleting data in a "staging" environment that turned out to be prod.
 *
 * Path params we don't have values for cause the op to be skipped with an
 * `unreachable` finding — emitted by `compareProbes` downstream, not here.
 */
export async function probeOperations(
  ir: IR,
  opts: ProbeOptions,
): Promise<{
  probes: ProbeResult[];
  skipped: { operationId: string; reason: string }[];
}> {
  const probes: ProbeResult[] = [];
  const skipped: { operationId: string; reason: string }[] = [];
  const safeOnly = opts.safeOnly ?? true;
  const timeout = opts.timeoutMs ?? 5000;

  for (const op of ir.operations) {
    if (safeOnly && !isSafeMethod(op.method)) {
      skipped.push({
        operationId: op.id,
        reason: `mutating ${op.method} skipped (safe-only)`,
      });
      continue;
    }
    const url = buildUrl(opts.baseUrl, op, opts.pathParams ?? {});
    if (!url) {
      skipped.push({ operationId: op.id, reason: "missing required path param" });
      continue;
    }

    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeout);
      const resp = await fetch(url, {
        method: op.method,
        headers: opts.headers ?? {},
        signal: ac.signal,
      });
      clearTimeout(timer);
      const ct = resp.headers.get("content-type") ?? undefined;
      const body = await readBody(resp, ct);
      probes.push({
        operationId: op.id,
        status: resp.status,
        contentType: ct ? ct.split(";")[0]!.trim() : undefined,
        body,
      });
    } catch (err) {
      skipped.push({
        operationId: op.id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { probes, skipped };
}

function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

function buildUrl(
  base: string,
  op: Operation,
  pathParams: Record<string, string | number>,
): string | undefined {
  let path = op.path;
  for (const p of op.pathParams) {
    const v = pathParams[p.name];
    if (v === undefined && p.required) return undefined;
    if (v !== undefined) {
      path = path.split(`{${p.name}}`).join(encodeURIComponent(String(v)));
    }
  }
  return base.replace(/\/$/, "") + path;
}

async function readBody(resp: Response, ct: string | undefined): Promise<unknown> {
  const text = await resp.text();
  if (!text) return undefined;
  if (ct?.includes("json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}
