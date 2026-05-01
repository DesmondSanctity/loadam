import { faker } from "@faker-js/faker";
import jsf from "json-schema-faker";
import type { ResourceRegistry } from "./registry.js";

/**
 * Schema-driven value generator. Wraps json-schema-faker, biases toward
 * real-feeling data via @faker-js/faker, and integrates with the
 * ResourceRegistry so that fields named like `<kind>Id` reuse existing ids.
 */

let configured = false;

function configureJsf(): void {
  if (configured) return;
  configured = true;
  jsf.option({
    alwaysFakeOptionals: false,
    failOnInvalidTypes: false,
    failOnInvalidFormat: false,
    useExamplesValue: true,
    useDefaultValue: true,
    fillProperties: false,
  });
  // hook faker as a backing source for "format" and "faker" keywords
  // biome-ignore lint/suspicious/noExplicitAny: jsf typings are loose
  (jsf as any).extend("faker", () => faker);
}

export interface FakeOptions {
  /** Optional registry — if a property name looks like `<kind>Id`, we try it first. */
  registry?: ResourceRegistry;
  /** Resolve a $ref string to its inline JSON Schema. */
  resolveRef?: (ref: string) => unknown;
  /** Deterministic seed (per-call). */
  seed?: number;
}

/**
 * Generate a fake value matching a JSON Schema. Inputs may include `$ref`
 * strings; supply `resolveRef` so we can look them up.
 */
export function fakeFromSchema(schema: unknown, opts: FakeOptions = {}): unknown {
  configureJsf();
  if (opts.seed !== undefined) {
    faker.seed(opts.seed);
  }

  const expanded = expandRefs(schema, opts.resolveRef ?? (() => undefined), new Set());
  // We re-expand inside the registry-aware override below as well.

  const generated = jsf.generate(expanded as never);
  return overlayRegistry(generated, schema, opts);
}

/**
 * Walk a generated value side-by-side with its schema and replace fields whose
 * names look like `<kind>Id` with values pulled from the registry, when
 * available. This is what makes our faker "stateful".
 */
function overlayRegistry(value: unknown, schema: unknown, opts: FakeOptions): unknown {
  if (!opts.registry || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => overlayRegistry(v, undefined, opts));

  const obj = value as Record<string, unknown>;
  for (const [key, current] of Object.entries(obj)) {
    if (typeof current === "string" || typeof current === "number") {
      const candidateKind = inferKindFromFieldName(key);
      if (candidateKind && opts.registry.size(candidateKind) > 0) {
        const replacement = opts.registry.pickField(candidateKind, "id");
        if (replacement !== undefined) {
          obj[key] = replacement;
        }
      }
    } else if (current && typeof current === "object") {
      obj[key] = overlayRegistry(current, undefined, opts);
    }
  }
  return obj;
}

/** "userId" → "User", "customer_id" → "Customer", "petId" → "Pet". */
export function inferKindFromFieldName(field: string): string | undefined {
  // Match: <kind>Id, <kind>_id, <kind>_uuid
  const m =
    field.match(/^([a-zA-Z][a-zA-Z0-9]*?)(Id|_id|Uuid|_uuid)$/) ||
    field.match(/^([a-zA-Z][a-zA-Z0-9]*?)Ref$/);
  if (!m || !m[1]) return undefined;
  const root = m[1];
  return root.charAt(0).toUpperCase() + root.slice(1);
}

/**
 * Recursively replace `$ref` objects with their resolved schemas. Detects
 * cycles and breaks them by returning an empty object.
 */
function expandRefs(node: unknown, resolve: (ref: string) => unknown, seen: Set<string>): unknown {
  if (Array.isArray(node)) return node.map((n) => expandRefs(n, resolve, seen));
  if (!node || typeof node !== "object") return node;
  const obj = node as Record<string, unknown>;

  if (typeof obj.$ref === "string") {
    if (seen.has(obj.$ref)) return {};
    const target = resolve(obj.$ref);
    if (target === undefined) return obj;
    const next = new Set(seen);
    next.add(obj.$ref);
    return expandRefs(target, resolve, next);
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = expandRefs(v, resolve, seen);
  return out;
}
