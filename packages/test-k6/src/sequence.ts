import type { IR, Operation, Param, ResourceKind } from "@loadam/core";

/**
 * Sequence operations into a sensible smoke-test order:
 *
 *   For each ResourceKind in graph order (parents before children):
 *     list  →  create  →  read  →  update  →  delete
 *
 *   Then anything orphan (no resourceKind) at the end.
 *
 * This ordering lets a single-iteration smoke create real entities and
 * reuse the returned IDs for subsequent ops — the cheapest way to make
 * a generated test actually exercise the API.
 */
export function sequenceForSmoke(ir: IR): Operation[] {
  const opsById = new Map(ir.operations.map((o) => [o.id, o]));
  const out: Operation[] = [];
  const seen = new Set<string>();

  const orderedKinds = topoSortKinds(ir.resources.kinds, ir.resources.edges);

  for (const kind of orderedKinds) {
    for (const bucket of ["listOps", "createOps", "readOps", "updateOps", "deleteOps"] as const) {
      for (const opId of kind[bucket]) {
        const op = opsById.get(opId);
        if (op && !seen.has(op.id)) {
          out.push(op);
          seen.add(op.id);
        }
      }
    }
  }

  // Append orphans (action ops, ungrouped) — preserve original spec order.
  for (const op of ir.operations) {
    if (!seen.has(op.id)) {
      out.push(op);
      seen.add(op.id);
    }
  }

  return out;
}

/** Toposort kinds so parents (e.g. User) come before children (e.g. Post). */
function topoSortKinds(
  kinds: ResourceKind[],
  edges: { from: string; to: string }[],
): ResourceKind[] {
  // Edge `from -> to` means "from references to" (post references user).
  // We want parents first, so children depend on parents → reverse the edges
  // for the toposort.
  const incoming = new Map<string, Set<string>>();
  for (const k of kinds) incoming.set(k.name, new Set());
  for (const e of edges) {
    // child = e.from, parent = e.to → child depends on parent
    if (incoming.has(e.from) && incoming.has(e.to) && e.from !== e.to) {
      incoming.get(e.from)?.add(e.to);
    }
  }

  const out: ResourceKind[] = [];
  const remaining = new Map(kinds.map((k) => [k.name, k]));
  while (remaining.size > 0) {
    // pick any kind with no remaining incoming deps
    let picked: string | undefined;
    for (const name of remaining.keys()) {
      if (incoming.get(name)?.size === 0) {
        picked = name;
        break;
      }
    }
    // cycle fallback: pick first remaining
    if (!picked) picked = remaining.keys().next().value;
    if (!picked) break;

    const kind = remaining.get(picked);
    if (kind) out.push(kind);
    remaining.delete(picked);
    for (const set of incoming.values()) set.delete(picked);
  }
  return out;
}

/** Pick the first declared content type on a body, preferring JSON. */
export function pickContentType(body: NonNullable<Operation["body"]>): string | undefined {
  const types = Object.keys(body.contentTypes);
  return types.find((t) => t.includes("json")) ?? types[0];
}

/** Choose a base URL from IR servers; safe fallback for local mocks. */
export function defaultBaseUrl(ir: IR): string {
  const first = ir.servers[0]?.url;
  if (!first) return "http://localhost:4010";
  // Resolve simple {variable} placeholders using their declared defaults.
  const vars = ir.servers[0]?.variables ?? {};
  return first.replace(/\{(\w+)\}/g, (_match, name) => vars[name]?.default ?? "");
}

/** Required path/query params, in declaration order. */
export function requiredParams(op: Operation, kind: "path" | "query"): Param[] {
  const list = kind === "path" ? op.pathParams : op.queryParams;
  return list.filter((p) => p.required);
}
