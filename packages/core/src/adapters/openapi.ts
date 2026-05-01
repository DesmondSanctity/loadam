import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import SwaggerParser from "@apidevtools/swagger-parser";
import type { OpenAPIV3, OpenAPIV3_1 } from "openapi-types";
import { parse as parseYaml } from "yaml";
import {
  type AuthProfile,
  type AuthRef,
  type HttpMethod,
  type IR,
  IR_VERSION,
  type Operation,
  type Param,
  type RequestBody,
  type ResponseDef,
  type Safety,
  type Schema,
  type SchemaRefOrInline,
  type Server,
} from "../ir/schema.js";

type AnyOpenAPI = OpenAPIV3.Document | OpenAPIV3_1.Document;
type SchemaObject = OpenAPIV3.SchemaObject | OpenAPIV3_1.SchemaObject;
type ReferenceObject = OpenAPIV3.ReferenceObject;
type ParameterObject = OpenAPIV3.ParameterObject | OpenAPIV3_1.ParameterObject;
type OperationObject = OpenAPIV3.OperationObject | OpenAPIV3_1.OperationObject;
type RequestBodyObject = OpenAPIV3.RequestBodyObject | OpenAPIV3_1.RequestBodyObject;
type ResponseObject = OpenAPIV3.ResponseObject | OpenAPIV3_1.ResponseObject;
type SecuritySchemeObject = OpenAPIV3.SecuritySchemeObject | OpenAPIV3_1.SecuritySchemeObject;

const HTTP_METHODS: readonly HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

export interface FromOpenApiOptions {
  /** Optional URI to record in IR meta. */
  sourceUri?: string;
}

/**
 * Load an OpenAPI document from a path (YAML or JSON), validate, and
 * convert to Loadam IR. $refs are resolved inline (bundled, not dereferenced
 * to value-equality) so the IR's schemas map keeps a single canonical entry
 * per component schema.
 */
export async function fromOpenApiFile(path: string, opts: FromOpenApiOptions = {}): Promise<IR> {
  const absolute = resolve(path);
  const raw = await readFile(absolute, "utf8");
  const doc = parseDocument(raw);

  // bundle: resolve external $refs but keep internal $refs as-is.
  // This is what we want — internal refs become our SchemaIds.
  const bundled = (await SwaggerParser.bundle(doc as never)) as unknown as AnyOpenAPI;

  return fromOpenApi(bundled, { sourceUri: opts.sourceUri ?? absolute });
}

/** Convert an already-loaded OpenAPI document object to IR. */
export function fromOpenApi(doc: AnyOpenAPI, opts: FromOpenApiOptions = {}): IR {
  const sourceVersion = doc.openapi ?? "3.0.0";

  const schemas: Record<string, Schema> = {};
  const componentSchemas =
    (doc.components?.schemas as Record<string, SchemaObject | ReferenceObject> | undefined) ?? {};
  for (const [name, s] of Object.entries(componentSchemas)) {
    const id = schemaIdFromComponentName(name);
    schemas[id] = {
      id,
      name,
      jsonSchema: rewriteRefs(s),
    };
  }

  const auth = extractAuthProfiles(doc);
  const servers = extractServers(doc);
  const operations = extractOperations(doc);

  return {
    version: IR_VERSION,
    meta: {
      title: doc.info?.title ?? "Untitled API",
      version: doc.info?.version ?? "0.0.0",
      description: doc.info?.description,
      source: {
        kind: "openapi",
        sourceVersion,
        ingestedAt: new Date().toISOString(),
        sourceUri: opts.sourceUri,
      },
    },
    servers,
    auth,
    schemas,
    operations,
    resources: { kinds: [], edges: [] },
    examples: { byOperation: {}, byEntity: {} },
    workflows: [],
    hints: {},
  };
}

// ─── helpers ───────────────────────────────────────────────────────────────

function parseDocument(raw: string): AnyOpenAPI {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("{")) {
    return JSON.parse(raw) as AnyOpenAPI;
  }
  return parseYaml(raw) as AnyOpenAPI;
}

function schemaIdFromComponentName(name: string): string {
  return `#/components/schemas/${name}`;
}

/**
 * Recursively rewrite $ref values from `#/components/schemas/Foo` to our
 * canonical SchemaId form. They happen to be the same string today; this
 * indirection lets us change the form without touching emitters.
 */
function rewriteRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewriteRefs);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.$ref === "string") {
      return { $ref: obj.$ref };
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = rewriteRefs(v);
    return out;
  }
  return value;
}

function extractServers(doc: AnyOpenAPI): Server[] {
  if (!doc.servers || doc.servers.length === 0) return [];
  return doc.servers.map((s) => ({
    url: s.url,
    description: s.description,
    variables: s.variables
      ? Object.fromEntries(
          Object.entries(s.variables).map(([k, v]) => [
            k,
            { default: v.default ?? "", enum: v.enum, description: v.description },
          ]),
        )
      : undefined,
  }));
}

function extractAuthProfiles(doc: AnyOpenAPI): AuthProfile[] {
  const schemes =
    (doc.components?.securitySchemes as
      | Record<string, SecuritySchemeObject | ReferenceObject>
      | undefined) ?? {};
  const out: AuthProfile[] = [];
  for (const [id, scheme] of Object.entries(schemes)) {
    if (isRef(scheme)) continue;
    const mapped = mapSecurityScheme(id, scheme);
    if (mapped) out.push(mapped);
  }
  if (out.length === 0) out.push({ id: "none", kind: "none" });
  return out;
}

function mapSecurityScheme(id: string, s: SecuritySchemeObject): AuthProfile | null {
  if (s.type === "http") {
    if (s.scheme === "bearer") return { id, kind: "bearer" };
    if (s.scheme === "basic") return { id, kind: "basic" };
    return null; // other http schemes deferred to V1.1
  }
  if (s.type === "apiKey") {
    return {
      id,
      kind: "apiKey",
      in: s.in as "header" | "query" | "cookie",
      name: s.name,
    };
  }
  if (s.type === "oauth2") {
    const cc = s.flows?.clientCredentials;
    if (cc) {
      return {
        id,
        kind: "oauth2_cc",
        tokenUrl: cc.tokenUrl,
        clientIdEnv: `${envify(id)}_CLIENT_ID`,
        clientSecretEnv: `${envify(id)}_CLIENT_SECRET`,
        scopes: cc.scopes ? Object.keys(cc.scopes) : undefined,
      };
    }
  }
  return null;
}

function envify(id: string): string {
  return id.replace(/[^A-Za-z0-9]/g, "_").toUpperCase();
}

function extractOperations(doc: AnyOpenAPI): Operation[] {
  const ops: Operation[] = [];
  const paths = (doc.paths ?? {}) as Record<string, Record<string, unknown> | undefined>;

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem) continue;
    const pathLevelParams =
      (pathItem.parameters as (ParameterObject | ReferenceObject)[] | undefined) ?? [];

    for (const method of HTTP_METHODS) {
      const opObj = pathItem[method.toLowerCase()] as OperationObject | undefined;
      if (!opObj) continue;

      const allParams = [...pathLevelParams, ...(opObj.parameters ?? [])].filter(
        (p): p is ParameterObject => !isRef(p),
      );

      const id = opObj.operationId ?? autoOperationId(method, path);
      const safety = inferSafety(method);

      ops.push({
        id,
        method,
        path,
        summary: opObj.summary,
        description: opObj.description,
        tags: opObj.tags,
        pathParams: paramsByLocation(allParams, "path"),
        queryParams: paramsByLocation(allParams, "query"),
        headerParams: paramsByLocation(allParams, "header"),
        cookieParams: paramsByLocation(allParams, "cookie"),
        body: extractRequestBody(opObj.requestBody),
        responses: extractResponses(opObj.responses ?? {}),
        security: extractSecurityRefs(opObj.security ?? doc.security),
        safety,
        idempotency: method === "GET" || method === "HEAD" ? "idempotent" : "unknown",
      });
    }
  }
  return ops;
}

function autoOperationId(method: HttpMethod, path: string): string {
  const cleaned = path
    .replace(/[{}]/g, "")
    .replace(/\//g, "_")
    .replace(/[^A-Za-z0-9_]/g, "")
    .replace(/^_+/, "");
  return `${method.toLowerCase()}_${cleaned || "root"}`;
}

function paramsByLocation(
  params: ParameterObject[],
  loc: "path" | "query" | "header" | "cookie",
): Param[] {
  return params
    .filter((p) => p.in === loc)
    .map((p) => ({
      name: p.name,
      schema: schemaFromAny(p.schema),
      required: p.required ?? loc === "path",
      description: p.description,
      examples: p.example !== undefined ? [p.example] : undefined,
    }));
}

function schemaFromAny(s: unknown): SchemaRefOrInline {
  if (
    s &&
    typeof s === "object" &&
    "$ref" in s &&
    typeof (s as { $ref: unknown }).$ref === "string"
  ) {
    return (s as { $ref: string }).$ref;
  }
  return { jsonSchema: rewriteRefs(s ?? {}) };
}

function extractRequestBody(
  rb: RequestBodyObject | ReferenceObject | undefined,
): RequestBody | undefined {
  if (!rb || isRef(rb)) return undefined;
  const contentTypes: RequestBody["contentTypes"] = {};
  for (const [ct, media] of Object.entries(rb.content ?? {})) {
    contentTypes[ct] = {
      schema: schemaFromAny(media.schema),
      examples: media.example !== undefined ? [media.example] : undefined,
    };
  }
  return {
    required: rb.required ?? false,
    contentTypes,
  };
}

function extractResponses(
  responses: Record<string, ResponseObject | ReferenceObject>,
): ResponseDef[] {
  const out: ResponseDef[] = [];
  for (const [status, resp] of Object.entries(responses)) {
    if (isRef(resp)) continue;
    const numericStatus = status === "default" ? "default" : Number.parseInt(status, 10);
    if (numericStatus !== "default" && Number.isNaN(numericStatus)) continue;

    const contentTypes: NonNullable<ResponseDef["contentTypes"]> = {};
    for (const [ct, media] of Object.entries(resp.content ?? {})) {
      contentTypes[ct] = {
        schema: schemaFromAny(media.schema),
        examples: media.example !== undefined ? [media.example] : undefined,
      };
    }
    out.push({
      status: numericStatus as number | "default",
      description: resp.description,
      contentTypes: Object.keys(contentTypes).length > 0 ? contentTypes : undefined,
    });
  }
  return out;
}

function extractSecurityRefs(security: Array<Record<string, string[]>> | undefined): AuthRef[] {
  if (!security) return [];
  const refs: AuthRef[] = [];
  for (const entry of security) {
    for (const [profileId, scopes] of Object.entries(entry)) {
      refs.push({ profileId, scopes: scopes.length > 0 ? scopes : undefined });
    }
  }
  return refs;
}

function inferSafety(method: HttpMethod): Safety {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return "safe";
  if (method === "DELETE") return "destructive";
  return "mutating";
}

function isRef(v: unknown): v is ReferenceObject {
  return !!v && typeof v === "object" && "$ref" in (v as object);
}
