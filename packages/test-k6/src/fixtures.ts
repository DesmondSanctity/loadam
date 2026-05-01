import type { IR, Operation, Param } from "@loadam/core";
import { fakeFromSchema } from "@loadam/data";
import { pickContentType } from "./sequence.js";

export interface OperationFixtures {
  /** N pre-generated request bodies (only present when op has a body). */
  bodies?: unknown[];
  /** N pre-generated path-param value sets, keyed by param name. */
  pathParams?: Record<string, unknown[]>;
  /** N pre-generated query-param value sets, keyed by param name. */
  queryParams?: Record<string, unknown[]>;
}

export interface FixturePool {
  /** Map from operationId → fixture set. */
  byOperationId: Record<string, OperationFixtures>;
  /** Number of fixtures pre-generated per slot. */
  size: number;
}

export interface BuildFixturesOptions {
  /** How many fixtures to pre-generate per slot. Default 10. */
  size?: number;
  /** Deterministic seed. Default 1. */
  seed?: number;
}

/**
 * Pre-generate a JSON fixture pool from the IR. k6 cannot run npm modules
 * (Goja runtime), so the strategy is:
 *
 *   1. At compile time, generate N samples per body / path-param / query-param
 *   2. Write the pool to fixtures.json next to the k6 scripts
 *   3. The k6 script reads the pool via SharedArray and picks per VU/iteration
 *
 * Path-param values are best-effort: real CRUD flows in smoke tests should
 * use IDs returned from a preceding `create` call. The pre-generated values
 * are the fallback for ops that have no upstream create.
 */
export function buildFixturePool(ir: IR, opts: BuildFixturesOptions = {}): FixturePool {
  const size = opts.size ?? 10;
  const seed = opts.seed ?? 1;
  const resolveRef = makeRefResolver(ir);
  const byOperationId: Record<string, OperationFixtures> = {};

  for (let i = 0; i < ir.operations.length; i++) {
    const op = ir.operations[i];
    if (!op) continue;
    const fix: OperationFixtures = {};

    if (op.body) {
      const ct = pickContentType(op.body);
      const media = ct ? op.body.contentTypes[ct] : undefined;
      if (media) {
        fix.bodies = generateMany(media.schema, size, seed + i, resolveRef);
      }
    }

    if (op.pathParams.length > 0) {
      fix.pathParams = generateParamPool(op.pathParams, size, seed + i, resolveRef);
    }
    if (op.queryParams.length > 0) {
      const required = op.queryParams.filter((p) => p.required);
      if (required.length > 0) {
        fix.queryParams = generateParamPool(required, size, seed + i, resolveRef);
      }
    }

    if (fix.bodies || fix.pathParams || fix.queryParams) {
      byOperationId[op.id] = fix;
    }
  }

  return { byOperationId, size };
}

function generateMany(
  schema: unknown,
  count: number,
  seed: number,
  resolveRef: (ref: string) => unknown,
): unknown[] {
  const out: unknown[] = [];
  // SchemaRefOrInline = string ($ref id) | { jsonSchema }
  const target = resolveSchemaRef(schema, resolveRef);
  for (let i = 0; i < count; i++) {
    try {
      out.push(fakeFromSchema(target, { resolveRef, seed: seed + i }));
    } catch {
      // Fall back to null for impossible/unsupported schemas — the script
      // can detect and skip rather than crashing test compilation.
      out.push(null);
    }
  }
  return out;
}

function generateParamPool(
  params: Param[],
  count: number,
  seed: number,
  resolveRef: (ref: string) => unknown,
): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    if (!p) continue;
    out[p.name] = generateMany(p.schema, count, seed + i, resolveRef);
  }
  return out;
}

function resolveSchemaRef(schema: unknown, resolveRef: (ref: string) => unknown): unknown {
  if (typeof schema === "string") {
    return resolveRef(schema) ?? {};
  }
  if (schema && typeof schema === "object" && "jsonSchema" in schema) {
    return (schema as { jsonSchema: unknown }).jsonSchema;
  }
  return schema;
}

function makeRefResolver(ir: IR): (ref: string) => unknown {
  return (ref: string) => {
    // SchemaId is the canonical $ref string (e.g. "#/components/schemas/Pet").
    const direct = ir.schemas[ref];
    if (direct) return direct.jsonSchema;
    // Loose fallback: match by short name suffix
    for (const [id, s] of Object.entries(ir.schemas)) {
      if (id.endsWith(ref) || s.name === ref) return s.jsonSchema;
    }
    return undefined;
  };
}

/** Convenience: also expose Operation type for downstream callers. */
export type { Operation };
