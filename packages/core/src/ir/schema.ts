import { z } from "zod";

/**
 * Loadam Intermediate Representation (IR) — version 1.
 *
 * The canonical, normalized model of an API. Every adapter produces IR;
 * every compiler consumes IR.
 *
 * Stability rule: additive-only within `version: "1"`. Breaking changes bump.
 */

export const IR_VERSION = "1" as const;

// ─── primitives ────────────────────────────────────────────────────────────

export const HttpMethod = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
export type HttpMethod = z.infer<typeof HttpMethod>;

export const ResourceAction = z.enum([
  "create",
  "read",
  "list",
  "update",
  "delete",
  "search",
  "action",
]);
export type ResourceAction = z.infer<typeof ResourceAction>;

export const Safety = z.enum(["safe", "mutating", "destructive"]);
export type Safety = z.infer<typeof Safety>;

export const Idempotency = z.enum(["idempotent", "non-idempotent", "unknown"]);
export type Idempotency = z.infer<typeof Idempotency>;

// JSON Schema is unbounded; keep as `unknown` at the IR boundary,
// validated downstream by Ajv when needed.
export const JsonSchema = z.unknown();
export type JsonSchema = unknown;

// ─── meta + servers ────────────────────────────────────────────────────────

export const Meta = z.object({
  title: z.string(),
  version: z.string(),
  description: z.string().optional(),
  source: z.object({
    kind: z.enum(["openapi", "postman", "har", "grpc", "graphql"]),
    sourceVersion: z.string(),
    ingestedAt: z.string(),
    sourceUri: z.string().optional(),
  }),
});
export type Meta = z.infer<typeof Meta>;

export const ServerVariable = z.object({
  default: z.string(),
  enum: z.array(z.string()).optional(),
  description: z.string().optional(),
});

export const Server = z.object({
  url: z.string(),
  description: z.string().optional(),
  variables: z.record(ServerVariable).optional(),
});
export type Server = z.infer<typeof Server>;

// ─── auth ──────────────────────────────────────────────────────────────────

export const AuthProfile = z.discriminatedUnion("kind", [
  z.object({ id: z.string(), kind: z.literal("none") }),
  z.object({
    id: z.string(),
    kind: z.literal("bearer"),
    tokenEnv: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("apiKey"),
    in: z.enum(["header", "query", "cookie"]),
    name: z.string(),
    valueEnv: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("basic"),
    userEnv: z.string().optional(),
    passEnv: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("oauth2_cc"),
    tokenUrl: z.string(),
    clientIdEnv: z.string(),
    clientSecretEnv: z.string(),
    scopes: z.array(z.string()).optional(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal("custom"),
    signerRef: z.string(),
  }),
]);
export type AuthProfile = z.infer<typeof AuthProfile>;

export const AuthRef = z.object({
  profileId: z.string(),
  scopes: z.array(z.string()).optional(),
});
export type AuthRef = z.infer<typeof AuthRef>;

// ─── schemas ───────────────────────────────────────────────────────────────

export const SchemaIdSchema = z.string();
export type SchemaId = string;

export const Schema = z.object({
  id: SchemaIdSchema,
  name: z.string().optional(),
  jsonSchema: JsonSchema,
  examples: z.array(z.unknown()).optional(),
  _raw: z.unknown().optional(),
});
export type Schema = z.infer<typeof Schema>;

// Inline schema = a JSON Schema object embedded in a param/response without an id.
export const InlineSchema = z.object({
  jsonSchema: JsonSchema,
});
export type InlineSchema = z.infer<typeof InlineSchema>;

export const SchemaRefOrInline = z.union([SchemaIdSchema, InlineSchema]);
export type SchemaRefOrInline = z.infer<typeof SchemaRefOrInline>;

// ─── operations ────────────────────────────────────────────────────────────

export const Param = z.object({
  name: z.string(),
  schema: SchemaRefOrInline,
  required: z.boolean(),
  description: z.string().optional(),
  examples: z.array(z.unknown()).optional(),
  resourceKind: z.string().optional(),
  resourceField: z.string().optional(),
});
export type Param = z.infer<typeof Param>;

export const RequestBody = z.object({
  required: z.boolean(),
  contentTypes: z.record(
    z.object({
      schema: SchemaRefOrInline,
      examples: z.array(z.unknown()).optional(),
    }),
  ),
});
export type RequestBody = z.infer<typeof RequestBody>;

export const ResponseDef = z.object({
  status: z.union([z.number().int(), z.literal("default")]),
  description: z.string().optional(),
  headers: z.array(Param).optional(),
  contentTypes: z
    .record(
      z.object({
        schema: SchemaRefOrInline,
        examples: z.array(z.unknown()).optional(),
      }),
    )
    .optional(),
});
export type ResponseDef = z.infer<typeof ResponseDef>;

export const ResourceRef = z.object({
  kind: z.string(),
  field: z.string().optional(),
});
export type ResourceRef = z.infer<typeof ResourceRef>;

export const Operation = z.object({
  id: z.string(),
  method: HttpMethod,
  path: z.string(),
  summary: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),

  pathParams: z.array(Param).default([]),
  queryParams: z.array(Param).default([]),
  headerParams: z.array(Param).default([]),
  cookieParams: z.array(Param).default([]),
  body: RequestBody.optional(),
  responses: z.array(ResponseDef).default([]),

  security: z.array(AuthRef).default([]),
  servers: z.array(Server).optional(),

  // Inferred
  resourceKind: z.string().optional(),
  resourceAction: ResourceAction.optional(),
  produces: z.array(ResourceRef).optional(),
  consumes: z.array(ResourceRef).optional(),
  idempotency: Idempotency.optional(),
  safety: Safety.optional(),
  rateLimit: z
    .object({
      rps: z.number().optional(),
      burst: z.number().optional(),
    })
    .optional(),

  _raw: z.unknown().optional(),
});
export type Operation = z.infer<typeof Operation>;

// ─── resource graph ────────────────────────────────────────────────────────

export const ResourceKind = z.object({
  name: z.string(),
  schemaId: SchemaIdSchema.optional(),
  idField: z.string(),
  createOps: z.array(z.string()).default([]),
  readOps: z.array(z.string()).default([]),
  listOps: z.array(z.string()).default([]),
  updateOps: z.array(z.string()).default([]),
  deleteOps: z.array(z.string()).default([]),
});
export type ResourceKind = z.infer<typeof ResourceKind>;

export const ResourceEdge = z.object({
  from: z.string(),
  to: z.string(),
  via: z.object({ operationId: z.string(), param: z.string() }),
  cardinality: z.enum(["1:1", "1:N", "N:M"]),
  confidence: z.number().min(0).max(1).optional(),
});
export type ResourceEdge = z.infer<typeof ResourceEdge>;

export const ResourceGraph = z.object({
  kinds: z.array(ResourceKind).default([]),
  edges: z.array(ResourceEdge).default([]),
});
export type ResourceGraph = z.infer<typeof ResourceGraph>;

// ─── examples + workflows ──────────────────────────────────────────────────

export const OperationExample = z.object({
  source: z.enum(["spec", "har", "user"]),
  request: z.object({
    params: z.record(z.unknown()).optional(),
    headers: z.record(z.string()).optional(),
    body: z.unknown().optional(),
  }),
  response: z
    .object({
      status: z.number(),
      body: z.unknown().optional(),
    })
    .optional(),
});
export type OperationExample = z.infer<typeof OperationExample>;

export const ExampleSet = z.object({
  byOperation: z.record(z.array(OperationExample)).default({}),
  byEntity: z.record(z.array(z.unknown())).default({}),
});
export type ExampleSet = z.infer<typeof ExampleSet>;

export const ParamBinding = z.object({
  paramName: z.string(),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("literal"), value: z.unknown() }),
    z.object({
      kind: z.literal("fromStep"),
      stepIndex: z.number().int(),
      jsonPath: z.string(),
    }),
    z.object({ kind: z.literal("fromFixture"), name: z.string() }),
    z.object({ kind: z.literal("faker"), generator: z.string() }),
  ]),
});
export type ParamBinding = z.infer<typeof ParamBinding>;

export const WorkflowStep = z.object({
  operationId: z.string(),
  inputs: z.array(ParamBinding).optional(),
  expect: z
    .object({
      status: z.array(z.number()).optional(),
      schemaPath: z.string().optional(),
    })
    .optional(),
});
export type WorkflowStep = z.infer<typeof WorkflowStep>;

export const Workflow = z.object({
  id: z.string(),
  description: z.string().optional(),
  source: z.enum(["inferred", "declared", "har"]),
  steps: z.array(WorkflowStep),
});
export type Workflow = z.infer<typeof Workflow>;

// ─── hints ─────────────────────────────────────────────────────────────────

export const PaginationHint = z.object({
  operationId: z.string(),
  style: z.enum(["cursor", "offset", "page", "link-header", "unknown"]),
  cursorParam: z.string().optional(),
  pageParam: z.string().optional(),
  limitParam: z.string().optional(),
  responseCursorPath: z.string().optional(),
});
export type PaginationHint = z.infer<typeof PaginationHint>;

export const VersioningHint = z.object({
  style: z.enum(["url", "header", "media-type", "query", "none"]),
  detail: z.string().optional(),
});
export type VersioningHint = z.infer<typeof VersioningHint>;

export const Hints = z
  .object({
    pagination: z.array(PaginationHint).optional(),
    idempotencyKeys: z.array(z.string()).optional(),
    tenantHeaders: z.array(z.string()).optional(),
    rateLimitHeaders: z.array(z.string()).optional(),
    versioning: VersioningHint.optional(),
  })
  .catchall(z.unknown());
export type Hints = z.infer<typeof Hints>;

// ─── root IR ───────────────────────────────────────────────────────────────

export const IR = z.object({
  version: z.literal(IR_VERSION),
  meta: Meta,
  servers: z.array(Server).default([]),
  auth: z.array(AuthProfile).default([]),
  schemas: z.record(Schema).default({}),
  operations: z.array(Operation).default([]),
  resources: ResourceGraph.default({ kinds: [], edges: [] }),
  examples: ExampleSet.default({ byOperation: {}, byEntity: {} }),
  workflows: z.array(Workflow).default([]),
  hints: Hints.default({}),
  _raw: z.unknown().optional(),
});
export type IR = z.infer<typeof IR>;

/** Validate an unknown value as IR. Throws ZodError on mismatch. */
export function parseIR(input: unknown): IR {
  return IR.parse(input);
}

/** Safe variant: returns SafeParseReturnType. */
export function safeParseIR(input: unknown) {
  return IR.safeParse(input);
}
