import { describe, expect, it } from "vitest";
import { fromOpenApiFile, parseIR } from "../src/index.js";

const PETSTORE = new URL("../../../fixtures/specs/petstore.openapi.yaml", import.meta.url).pathname;

describe("openapi adapter — petstore", () => {
  it("produces a valid IR", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    expect(() => parseIR(ir)).not.toThrow();
  });

  it("captures meta correctly", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    expect(ir.meta.title).toBe("Swagger Petstore");
    expect(ir.meta.version).toBe("1.0.0");
    expect(ir.meta.source.kind).toBe("openapi");
    expect(ir.meta.source.sourceVersion).toBe("3.0.3");
  });

  it("extracts servers", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    expect(ir.servers).toHaveLength(1);
    expect(ir.servers[0]?.url).toBe("https://petstore.example.com/v1");
  });

  it("extracts apiKey auth profile", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    const apiKey = ir.auth.find((a) => a.id === "apiKeyAuth");
    expect(apiKey).toBeDefined();
    expect(apiKey?.kind).toBe("apiKey");
    if (apiKey?.kind === "apiKey") {
      expect(apiKey.in).toBe("header");
      expect(apiKey.name).toBe("X-API-Key");
    }
  });

  it("extracts all 4 operations with correct ids and methods", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    const ids = ir.operations.map((o) => o.id).sort();
    expect(ids).toEqual(["createPet", "deletePet", "listPets", "showPetById"]);

    const list = ir.operations.find((o) => o.id === "listPets");
    expect(list?.method).toBe("GET");
    expect(list?.path).toBe("/pets");
    expect(list?.safety).toBe("safe");

    const create = ir.operations.find((o) => o.id === "createPet");
    expect(create?.method).toBe("POST");
    expect(create?.safety).toBe("mutating");
    expect(create?.body?.required).toBe(true);

    const del = ir.operations.find((o) => o.id === "deletePet");
    expect(del?.safety).toBe("destructive");
  });

  it("captures path params as required", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    const show = ir.operations.find((o) => o.id === "showPetById");
    expect(show?.pathParams).toHaveLength(1);
    expect(show?.pathParams[0]?.name).toBe("petId");
    expect(show?.pathParams[0]?.required).toBe(true);
  });

  it("captures query params as optional when not required", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    const list = ir.operations.find((o) => o.id === "listPets");
    expect(list?.queryParams).toHaveLength(1);
    expect(list?.queryParams[0]?.name).toBe("limit");
    expect(list?.queryParams[0]?.required).toBe(false);
  });

  it("registers component schemas under canonical ids", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    expect(ir.schemas["#/components/schemas/Pet"]).toBeDefined();
    expect(ir.schemas["#/components/schemas/NewPet"]).toBeDefined();
    expect(ir.schemas["#/components/schemas/Pets"]).toBeDefined();
    expect(ir.schemas["#/components/schemas/Error"]).toBeDefined();
  });

  it("preserves $refs in request bodies", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    const create = ir.operations.find((o) => o.id === "createPet");
    const jsonBody = create?.body?.contentTypes["application/json"];
    expect(jsonBody?.schema).toBe("#/components/schemas/NewPet");
  });

  it("captures global security as auth refs on operations", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    for (const op of ir.operations) {
      expect(op.security).toEqual([{ profileId: "apiKeyAuth" }]);
    }
  });
});
