import type { IR, InlineSchema, Operation, Param, SchemaRefOrInline } from "@loadam/core";

export interface CurateOptions {
  /** Include mutating operations (POST/PUT/PATCH/DELETE). Default false. */
  includeWrites?: boolean;
  /**
   * Always exclude these operation ids (deny-list). Useful for ops
   * that are destructive or operationally sensitive.
   */
  exclude?: string[];
}

export interface ToolDef {
  /** Tool name surfaced to the model — uses the operation id verbatim. */
  name: string;
  description: string;
  /** JSON Schema for the tool input — combines path/query/header/body params. */
  inputSchema: Record<string, unknown>;
  /** Original operation metadata for the runtime call layer. */
  operation: {
    id: string;
    method: string;
    path: string;
    pathParamNames: string[];
    queryParamNames: string[];
    headerParamNames: string[];
    hasBody: boolean;
  };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Build the curated MCP tool list from the IR.
 *
 * Curation rules:
 *  - Read-only by default — only safe HTTP methods (GET/HEAD/OPTIONS) or
 *    ops with `safety === 'safe'` are exposed.
 *  - With `includeWrites: true`, mutating *and* destructive ops are added.
 *    The README banner makes the destructive scope explicit; per-op opt-in
 *    is V1.1 work.
 *  - Deny-list `exclude` always wins, in either mode.
 */
export function curateTools(ir: IR, opts: CurateOptions = {}): ToolDef[] {
  const exclude = new Set(opts.exclude ?? []);
  const tools: ToolDef[] = [];

  for (const op of ir.operations) {
    if (exclude.has(op.id)) continue;
    const isSafe = op.safety === "safe" || SAFE_METHODS.has(op.method);
    if (!isSafe && !opts.includeWrites) continue;
    tools.push(buildTool(ir, op));
  }

  return tools;
}

function buildTool(ir: IR, op: Operation): ToolDef {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const p of op.pathParams) {
    properties[p.name] = annotate(resolveSchema(ir, p.schema), p);
    // Path params are always required by definition.
    required.push(p.name);
  }
  for (const p of op.queryParams) {
    properties[p.name] = annotate(resolveSchema(ir, p.schema), p);
    if (p.required) required.push(p.name);
  }
  for (const p of op.headerParams) {
    // Skip auth-related headers — handled by the runtime from env.
    if (isAuthHeader(p.name)) continue;
    properties[p.name] = annotate(resolveSchema(ir, p.schema), p);
    if (p.required) required.push(p.name);
  }

  let hasBody = false;
  if (op.body) {
    const json = op.body.contentTypes["application/json"];
    if (json) {
      properties.body = resolveSchema(ir, json.schema);
      if (op.body.required) required.push("body");
      hasBody = true;
    }
  }

  const inputSchema: Record<string, unknown> = {
    type: "object",
    properties,
    additionalProperties: false,
  };
  if (required.length > 0) inputSchema.required = required;

  return {
    name: op.id,
    description: buildDescription(op),
    inputSchema,
    operation: {
      id: op.id,
      method: op.method,
      path: op.path,
      pathParamNames: op.pathParams.map((p) => p.name),
      queryParamNames: op.queryParams.map((p) => p.name),
      headerParamNames: op.headerParams.filter((p) => !isAuthHeader(p.name)).map((p) => p.name),
      hasBody,
    },
  };
}

function resolveSchema(ir: IR, ref: SchemaRefOrInline): Record<string, unknown> {
  if (typeof ref === "string") {
    const found = ir.schemas[ref];
    if (found) return cloneJson(found.jsonSchema) as Record<string, unknown>;
    return {};
  }
  const inline = ref as InlineSchema;
  return cloneJson(inline.jsonSchema) as Record<string, unknown>;
}

function annotate(schema: Record<string, unknown>, p: Param): Record<string, unknown> {
  if (!p.description) return schema;
  // Don't clobber a schema-supplied description.
  if (typeof schema.description === "string") return schema;
  return { ...schema, description: p.description };
}

function buildDescription(op: Operation): string {
  const parts: string[] = [];
  if (op.summary) parts.push(op.summary);
  else if (op.description) parts.push(op.description.split("\n")[0]?.trim() ?? "");
  parts.push(`(${op.method} ${op.path})`);
  return parts.filter(Boolean).join(" ");
}

const AUTH_HEADER_NAMES = new Set(["authorization", "x-api-key", "api-key", "apikey"]);

function isAuthHeader(name: string): boolean {
  return AUTH_HEADER_NAMES.has(name.toLowerCase());
}

function cloneJson(value: unknown): unknown {
  // Schemas are JSON; structuredClone is fine and safe across Node 20+.
  return structuredClone(value);
}
