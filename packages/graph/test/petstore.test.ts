import { fromOpenApiFile } from "@loadam/core";
import { describe, expect, it } from "vitest";
import { graphStats, inferResourceGraph, renderGraphTree } from "../src/index.js";

const PETSTORE = new URL("../../../fixtures/specs/petstore.openapi.yaml", import.meta.url).pathname;

describe("graph inference — petstore", () => {
  it("detects a single Pet resource kind", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    inferResourceGraph(ir);
    expect(ir.resources.kinds).toHaveLength(1);
    expect(ir.resources.kinds[0]?.name).toBe("Pet");
  });

  it("groups operations by action correctly", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    inferResourceGraph(ir);
    const pet = ir.resources.kinds.find((k) => k.name === "Pet");
    expect(pet?.createOps).toEqual(["createPet"]);
    expect(pet?.readOps).toEqual(["showPetById"]);
    expect(pet?.listOps).toEqual(["listPets"]);
    expect(pet?.deleteOps).toEqual(["deletePet"]);
    expect(pet?.updateOps).toEqual([]);
  });

  it('detects id field as "id"', async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    inferResourceGraph(ir);
    expect(ir.resources.kinds[0]?.idField).toBe("id");
  });

  it("annotates each operation with resourceKind + resourceAction", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    inferResourceGraph(ir);
    for (const op of ir.operations) {
      expect(op.resourceKind).toBe("Pet");
    }
    const create = ir.operations.find((o) => o.id === "createPet");
    expect(create?.resourceAction).toBe("create");
    const show = ir.operations.find((o) => o.id === "showPetById");
    expect(show?.resourceAction).toBe("read");
  });

  it("produces no edges for petstore (Pet has no parents)", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    inferResourceGraph(ir);
    expect(ir.resources.edges).toEqual([]);
  });

  it("renders a non-empty tree string", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    inferResourceGraph(ir);
    const tree = renderGraphTree(ir);
    expect(tree).toContain("Pet");
    expect(tree).toContain("createPet");
    expect(tree).toContain("listPets");
  });

  it("graphStats reports correct counts", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    inferResourceGraph(ir);
    const stats = graphStats(ir.resources);
    expect(stats.kinds).toBe(1);
    expect(stats.edges).toBe(0);
    expect(stats.orphanKinds).toEqual(["Pet"]);
  });
});
