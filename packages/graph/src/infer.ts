import type {
  IR,
  Operation,
  Param,
  ResourceAction,
  ResourceEdge,
  ResourceGraph,
  ResourceKind,
  Schema,
  SchemaRefOrInline,
} from "@loadam/core";
import { toEntityName } from "./singularize.js";

/**
 * Heuristic resource graph inference for an IR.
 *
 * Algorithm (no LLM):
 *
 *   1. For each operation, classify by path shape:
 *      - terminal `{id}` segment → single-resource action (read/update/delete)
 *      - no terminal `{id}`     → collection action (list/create/search)
 *      Resource name = singularized last collection segment.
 *
 *   2. Group operations by ResourceKind. The id field is taken from the
 *      response schema (preferring "id", then "uuid", then a *_id match).
 *
 *   3. For each operation that consumes path params with parent collections
 *      (e.g. /users/{userId}/posts), add an edge `currentResource → parent`.
 *      Also: body-field $refs that point to other ResourceKind schemas
 *      become edges (consumes).
 *
 *   4. Each operation gets `resourceKind`, `resourceAction`, `consumes`,
 *      `produces` set in-place on the IR.
 *
 * The IR is mutated and returned. Callers that want immutability should
 * deep-clone first.
 */
export function inferResourceGraph(ir: IR): IR {
  const opsByKind = new Map<string, Operation[]>();
  const kindIdField = new Map<string, string>();
  const kindSchemaId = new Map<string, string>();
  const edges: ResourceEdge[] = [];

  // Pass 1: classify each operation.
  for (const op of ir.operations) {
    const classification = classifyOperation(op, ir.schemas);
    if (!classification) continue;

    const { kind, action, idField, schemaId } = classification;
    op.resourceKind = kind;
    op.resourceAction = action;

    if (!opsByKind.has(kind)) opsByKind.set(kind, []);
    opsByKind.get(kind)!.push(op);

    if (idField && !kindIdField.has(kind)) kindIdField.set(kind, idField);
    if (schemaId && !kindSchemaId.has(kind)) kindSchemaId.set(kind, schemaId);

    // produces / consumes
    op.produces = action === "create" && schemaId ? [{ kind }] : op.produces;
  }

  // Pass 2: parent-collection edges from path nesting.
  for (const op of ir.operations) {
    if (!op.resourceKind) continue;
    const parents = parentResourcesFromPath(op.path, op.resourceKind);
    if (parents.length === 0) continue;

    op.consumes = [
      ...(op.consumes ?? []),
      ...parents.map((p) => ({ kind: p.kind, field: p.field })),
    ];

    for (const parent of parents) {
      edges.push({
        from: op.resourceKind,
        to: parent.kind,
        via: { operationId: op.id, param: parent.field },
        cardinality: "1:N",
        confidence: 0.9, // path-nesting is high signal
      });
    }
  }

  // Pass 3: body-field $ref edges.
  for (const op of ir.operations) {
    if (!op.resourceKind || !op.body) continue;
    for (const media of Object.values(op.body.contentTypes)) {
      const refs = collectRefs(media.schema, ir.schemas);
      for (const refKind of refs) {
        if (refKind === op.resourceKind) continue; // Only emit edges to refs that are themselves recognized resources.
        // Otherwise we'd create edges to DTO shapes (e.g. NewPet, OrderInput)
        // that don't represent real entities.
        if (!opsByKind.has(refKind)) continue;
        edges.push({
          from: op.resourceKind,
          to: refKind,
          via: { operationId: op.id, param: "body" },
          cardinality: "1:1",
          confidence: 0.7,
        });
      }
    }
  }

  const kinds: ResourceKind[] = [];
  for (const [name, ops] of opsByKind) {
    kinds.push({
      name,
      schemaId: kindSchemaId.get(name),
      idField: kindIdField.get(name) ?? "id",
      createOps: ops.filter((o) => o.resourceAction === "create").map((o) => o.id),
      readOps: ops.filter((o) => o.resourceAction === "read").map((o) => o.id),
      listOps: ops.filter((o) => o.resourceAction === "list").map((o) => o.id),
      updateOps: ops.filter((o) => o.resourceAction === "update").map((o) => o.id),
      deleteOps: ops.filter((o) => o.resourceAction === "delete").map((o) => o.id),
    });
  }

  // De-dupe edges by (from, to, via.operationId, via.param).
  const seen = new Set<string>();
  const dedupedEdges = edges.filter((e) => {
    const key = `${e.from}|${e.to}|${e.via.operationId}|${e.via.param}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  ir.resources = { kinds, edges: dedupedEdges } satisfies ResourceGraph;
  return ir;
}

// ─── classification ────────────────────────────────────────────────────────

interface Classification {
  kind: string;
  action: ResourceAction;
  idField?: string;
  schemaId?: string;
}

function classifyOperation(op: Operation, schemas: Record<string, Schema>): Classification | null {
  const segments = op.path.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const last = segments[segments.length - 1]!;
  const lastIsParam = isParamSegment(last);

  // Find the rightmost collection segment.
  let collectionSegment: string | undefined;
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i]!;
    if (!isParamSegment(s) && !isVersionSegment(s)) {
      collectionSegment = s;
      break;
    }
  }
  if (!collectionSegment) return null;

  const kind = toEntityName(collectionSegment);
  if (!kind) return null;

  // Determine action.
  let action: ResourceAction;
  if (lastIsParam) {
    if (op.method === "GET") action = "read";
    else if (op.method === "PUT" || op.method === "PATCH") action = "update";
    else if (op.method === "DELETE") action = "delete";
    else action = "action";
  } else {
    if (op.method === "GET") action = "list";
    else if (op.method === "POST") action = "create";
    else if (op.method === "DELETE")
      action = "delete"; // bulk delete
    else action = "action";
  }

  // Trailing non-param segments after the collection are sub-actions
  // ("/orders/{id}/cancel" → action, not delete).
  const collectionIdx = segments.lastIndexOf(collectionSegment);
  const tail = segments.slice(collectionIdx + 1);
  if (tail.length > 0 && !tail.every(isParamSegment)) {
    action = "action";
  }

  // Pick a representative response schema to extract id field + schemaId.
  const { schemaId, idField } = pickSuccessSchema(op, schemas);

  return { kind, action, idField, schemaId };
}

function isParamSegment(seg: string): boolean {
  return seg.startsWith("{") && seg.endsWith("}");
}

function isVersionSegment(seg: string): boolean {
  return /^v\d+$/i.test(seg);
}

function pickSuccessSchema(
  op: Operation,
  schemas: Record<string, Schema>,
): { schemaId?: string; idField?: string } {
  const success = op.responses
    .filter((r) => typeof r.status === "number" && r.status >= 200 && r.status < 300)
    .sort((a, b) => (a.status as number) - (b.status as number))[0];

  if (!success) return {};
  const json = success.contentTypes?.["application/json"];
  if (!json) return {};
  const sid = resolveTopRef(json.schema, schemas);
  if (!sid) return {};
  return { schemaId: sid, idField: pickIdField(schemas[sid]) };
}

function pickIdField(schema: Schema | undefined): string | undefined {
  const js = schema?.jsonSchema as { properties?: Record<string, unknown> } | undefined;
  const props = js?.properties;
  if (!props) return undefined;
  const keys = Object.keys(props);
  if (keys.includes("id")) return "id";
  if (keys.includes("uuid")) return "uuid";
  const idLike = keys.find((k) => /^id$|_id$/i.test(k));
  return idLike;
}

/**
 * If schema is a $ref or an array-of-$ref, resolve to the underlying schema id.
 * Used to find "the entity this endpoint deals with" even when wrapped in an array.
 */
function resolveTopRef(
  schema: SchemaRefOrInline,
  schemas: Record<string, Schema>,
): string | undefined {
  if (typeof schema === "string") {
    // could be array-shaped (e.g. Pets is `type: array, items: $ref Pet`)
    const target = schemas[schema];
    if (!target) return schema;
    const inner = unwrapArrayItem(target.jsonSchema);
    if (inner && typeof inner === "string") return inner;
    return schema;
  }
  // inline
  const inner = unwrapArrayItem(schema.jsonSchema);
  if (inner && typeof inner === "string") return inner;
  if (typeof schema.jsonSchema === "object" && schema.jsonSchema !== null) {
    const direct = (schema.jsonSchema as { $ref?: string }).$ref;
    if (direct) return direct;
  }
  return undefined;
}

function unwrapArrayItem(js: unknown): string | undefined {
  if (!js || typeof js !== "object") return undefined;
  const obj = js as { type?: string; items?: { $ref?: string } };
  if (obj.type === "array" && obj.items?.$ref) return obj.items.$ref;
  return undefined;
}

// ─── parent resources from path ────────────────────────────────────────────

interface ParentResource {
  kind: string;
  field: string; // path-param name, e.g. "userId"
}

/**
 * Walk path segments left→right, pairing each collection segment with the
 * immediately following `{paramId}` segment. The last such pair belongs to
 * `selfKind`; everything before it is a parent.
 *
 *   /users/{userId}/posts/{postId}  selfKind=Post
 *     pairs: [users:{userId}, posts:{postId}]  → parent: User via userId
 */
function parentResourcesFromPath(path: string, selfKind: string): ParentResource[] {
  const segments = path.split("/").filter(Boolean);
  const pairs: { collection: string; paramName: string }[] = [];
  for (let i = 0; i < segments.length - 1; i++) {
    const cur = segments[i]!;
    const next = segments[i + 1]!;
    if (!isParamSegment(cur) && !isVersionSegment(cur) && isParamSegment(next)) {
      pairs.push({
        collection: cur,
        paramName: next.slice(1, -1),
      });
    }
  }

  const parents: ParentResource[] = [];
  for (const pair of pairs) {
    const kind = toEntityName(pair.collection);
    if (kind === selfKind) continue;
    parents.push({ kind, field: pair.paramName });
  }
  return parents;
}

// ─── ref collection ────────────────────────────────────────────────────────

/**
 * Walk a schema (resolved or inline) and collect all $ref strings that point
 * to ResourceKind-eligible schemas. Used for body-field edge inference.
 */
function collectRefs(
  schema: SchemaRefOrInline,
  schemas: Record<string, Schema>,
  seen: Set<string> = new Set(),
): string[] {
  const out: string[] = [];
  if (typeof schema === "string") {
    if (seen.has(schema)) return out;
    seen.add(schema);
    const target = schemas[schema];
    if (target) {
      const refKind = entityNameForSchemaId(schema);
      if (refKind) out.push(refKind);
      walk(target.jsonSchema, out, schemas, seen);
    }
    return out;
  }
  walk(schema.jsonSchema, out, schemas, seen);
  return out;
}

function walk(
  js: unknown,
  out: string[],
  schemas: Record<string, Schema>,
  seen: Set<string>,
): void {
  if (!js) return;
  if (Array.isArray(js)) {
    for (const item of js) walk(item, out, schemas, seen);
    return;
  }
  if (typeof js !== "object") return;
  const obj = js as Record<string, unknown>;
  if (typeof obj.$ref === "string") {
    const ref = obj.$ref;
    if (seen.has(ref)) return;
    seen.add(ref);
    const refKind = entityNameForSchemaId(ref);
    if (refKind) out.push(refKind);
    const target = schemas[ref];
    if (target) walk(target.jsonSchema, out, schemas, seen);
    return;
  }
  for (const v of Object.values(obj)) walk(v, out, schemas, seen);
}

function entityNameForSchemaId(schemaId: string): string | undefined {
  // "#/components/schemas/Pet" → "Pet"
  const m = schemaId.match(/\/([^/]+)$/);
  return m ? m[1] : undefined;
}
