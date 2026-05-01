import { describe, expect, it } from "vitest";
import { ResourceRegistry, fakeFromSchema, inferKindFromFieldName } from "../src/index.js";

describe("inferKindFromFieldName", () => {
  it("matches <kind>Id", () => {
    expect(inferKindFromFieldName("userId")).toBe("User");
    expect(inferKindFromFieldName("petId")).toBe("Pet");
  });
  it("matches <kind>_id", () => {
    expect(inferKindFromFieldName("customer_id")).toBe("Customer");
  });
  it("matches <kind>Ref", () => {
    expect(inferKindFromFieldName("userRef")).toBe("User");
  });
  it("returns undefined for plain id", () => {
    expect(inferKindFromFieldName("id")).toBeUndefined();
    expect(inferKindFromFieldName("name")).toBeUndefined();
  });
});

describe("ResourceRegistry", () => {
  it("records and picks instances", () => {
    const r = new ResourceRegistry();
    r.record("User", { id: "u1", name: "a" });
    r.record("User", { id: "u2", name: "b" });
    expect(r.size("User")).toBe(2);
    expect(r.kinds()).toEqual(["User"]);
    const id = r.pickField("User", "id", () => 0);
    expect(id).toBe("u1");
  });

  it("returns undefined when picking from empty kind", () => {
    const r = new ResourceRegistry();
    expect(r.pick("Missing")).toBeUndefined();
    expect(r.pickField("Missing", "id")).toBeUndefined();
  });
});

describe("fakeFromSchema", () => {
  it("generates a value matching a simple object schema", () => {
    const schema = {
      type: "object",
      required: ["name", "count"],
      properties: {
        name: { type: "string" },
        count: { type: "integer", minimum: 1, maximum: 5 },
      },
    };
    const v = fakeFromSchema(schema, { seed: 1 }) as {
      name: string;
      count: number;
    };
    expect(typeof v.name).toBe("string");
    expect(Number.isInteger(v.count)).toBe(true);
    expect(v.count).toBeGreaterThanOrEqual(1);
    expect(v.count).toBeLessThanOrEqual(5);
  });

  it("substitutes a registered id when field name matches <kind>Id", () => {
    const registry = new ResourceRegistry();
    registry.record("User", { id: "real-user-1" });
    const schema = {
      type: "object",
      required: ["userId", "note"],
      properties: {
        userId: { type: "string" },
        note: { type: "string" },
      },
    };
    const v = fakeFromSchema(schema, { registry, seed: 2 }) as {
      userId: string;
      note: string;
    };
    expect(v.userId).toBe("real-user-1");
  });

  it("expands $refs via resolveRef", () => {
    const innerRef = "#/components/schemas/Inner";
    const inner = {
      type: "object",
      required: ["flag"],
      properties: { flag: { type: "boolean" } },
    };
    const outer = {
      type: "object",
      required: ["inner"],
      properties: { inner: { $ref: innerRef } },
    };
    const v = fakeFromSchema(outer, {
      resolveRef: (r) => (r === innerRef ? inner : undefined),
      seed: 3,
    }) as { inner: { flag: boolean } };
    expect(typeof v.inner.flag).toBe("boolean");
  });
});
