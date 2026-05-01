import type { IR, Operation, ResponseDef, SchemaRefOrInline } from "@loadam/core";
import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

/**
 * Drift differ — given a probed response, classify how it deviates from the
 * spec's contract. We deliberately keep "no spec response declared" as a
 * separate, lower-severity finding from "schema mismatch" because the former
 * is often a documentation gap rather than a real bug.
 */

export type DriftSeverity = "info" | "warning" | "error";

export interface DriftFinding {
  operationId: string;
  method: string;
  path: string;
  severity: DriftSeverity;
  kind:
    | "unreachable"
    | "undeclared-status"
    | "no-response-schema"
    | "schema-mismatch"
    | "content-type-mismatch";
  message: string;
  details?: unknown;
}

export interface ProbeResult {
  operationId: string;
  status: number;
  contentType?: string;
  body: unknown;
}

export interface CompareInput {
  ir: IR;
  probes: ProbeResult[];
}

export function compareProbes(input: CompareInput): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const opsById = new Map(input.ir.operations.map((o) => [o.id, o]));
  const ajv = buildAjv(input.ir);

  for (const probe of input.probes) {
    const op = opsById.get(probe.operationId);
    if (!op) continue;

    // Match the probed status against declared responses; fall back to default.
    const declared = pickResponseFor(op, probe.status);
    if (!declared) {
      findings.push({
        operationId: op.id,
        method: op.method,
        path: op.path,
        severity: "error",
        kind: "undeclared-status",
        message: `Got ${probe.status} but the spec declares only ${describeStatuses(op.responses)}.`,
      });
      continue;
    }

    // No content schema → can't validate body shape.
    if (!declared.contentTypes || Object.keys(declared.contentTypes).length === 0) {
      if (probe.body !== undefined && probe.body !== null && probe.body !== "") {
        findings.push({
          operationId: op.id,
          method: op.method,
          path: op.path,
          severity: "info",
          kind: "no-response-schema",
          message: `Response ${probe.status} has no schema in the spec; got a body.`,
        });
      }
      continue;
    }

    const ct = probe.contentType ?? Object.keys(declared.contentTypes)[0];
    const media = ct ? declared.contentTypes[ct] : undefined;
    if (!media) {
      findings.push({
        operationId: op.id,
        method: op.method,
        path: op.path,
        severity: "warning",
        kind: "content-type-mismatch",
        message: `Response content-type ${ct ?? "<none>"} not declared (spec declares ${Object.keys(declared.contentTypes).join(", ")}).`,
      });
      continue;
    }

    const errors = validateAgainstSchema(ajv, media.schema, probe.body, input.ir);
    if (errors.length > 0) {
      findings.push({
        operationId: op.id,
        method: op.method,
        path: op.path,
        severity: "error",
        kind: "schema-mismatch",
        message: `Response body does not match declared schema (${errors.length} violation(s)).`,
        details: errors.slice(0, 5).map(formatAjvError),
      });
    }
  }

  return findings;
}

function pickResponseFor(op: Operation, status: number): ResponseDef | undefined {
  const exact = op.responses.find((r) => r.status === status);
  if (exact) return exact;
  const def = op.responses.find((r) => r.status === "default");
  return def;
}

function describeStatuses(responses: ResponseDef[]): string {
  const codes = responses.map((r) => String(r.status));
  return codes.length === 0 ? "<none>" : codes.join(", ");
}

function buildAjv(ir: IR): Ajv {
  const ajv = new Ajv({
    strict: false,
    allErrors: true,
    validateFormats: true,
    // Resolve internal $refs against IR schemas.
    loadSchema: () => Promise.resolve({}),
  });
  addFormats(ajv);

  // Pre-register every schema by its canonical ref id so $ref resolution works.
  for (const [id, schema] of Object.entries(ir.schemas)) {
    try {
      ajv.addSchema(schema.jsonSchema as object, id);
    } catch {
      // Skip schemas Ajv refuses to compile — they'll be caught at validation time.
    }
  }
  return ajv;
}

function validateAgainstSchema(
  ajv: Ajv,
  schemaRef: SchemaRefOrInline,
  body: unknown,
  ir: IR,
): ErrorObject[] {
  const target = resolveRef(schemaRef, ir);
  if (!target) return [];
  let validate: ValidateFunction;
  try {
    validate = ajv.compile(target as object);
  } catch {
    return [];
  }
  const ok = validate(body);
  if (ok) return [];
  return validate.errors ?? [];
}

function resolveRef(schema: SchemaRefOrInline, ir: IR): unknown {
  if (typeof schema === "string") {
    return ir.schemas[schema]?.jsonSchema;
  }
  return schema.jsonSchema;
}

function formatAjvError(err: ErrorObject): {
  path: string;
  message: string;
  keyword: string;
} {
  return {
    path: err.instancePath || "/",
    message: err.message ?? "",
    keyword: err.keyword,
  };
}
