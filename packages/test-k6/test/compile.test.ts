import { resolve } from "node:path";
import { fromOpenApiFile } from "@loadam/core";
import { inferResourceGraph } from "@loadam/graph";
import { describe, expect, it } from "vitest";
import { compileK6 } from "../src/index.js";

const PETSTORE = resolve(__dirname, "../../../fixtures/specs/petstore.openapi.yaml");

describe("compileK6 — petstore", () => {
  it("emits the expected file set", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    inferResourceGraph(ir);
    const { files } = compileK6(ir);
    const names = Object.keys(files).sort();
    expect(names).toEqual(
      [
        ".env.example",
        "README.md",
        "config.js",
        "fixtures.json",
        "flow.js",
        "load.js",
        "package.json",
        "smoke.js",
      ].sort(),
    );
  });

  it("smoke.js + load.js import the shared flow and have valid options", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    inferResourceGraph(ir);
    const { files } = compileK6(ir);

    expect(files["smoke.js"]).toContain("import { runFlow } from './flow.js'");
    expect(files["smoke.js"]).toContain("vus: 1");
    expect(files["smoke.js"]).toContain("iterations: 1");

    expect(files["load.js"]).toContain("import { runFlow } from './flow.js'");
    expect(files["load.js"]).toContain("stages:");
    expect(files["load.js"]).toContain("runFlow(__ITER)");
  });

  it("flow.js orders ops sensibly: list → create → read → delete for Pet", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    inferResourceGraph(ir);
    const { files } = compileK6(ir);
    const flow = files["flow.js"]!;
    const idx = (s: string) => flow.indexOf(s);
    expect(idx("listPets")).toBeGreaterThan(-1);
    expect(idx("createPet")).toBeGreaterThan(-1);
    expect(idx("showPetById")).toBeGreaterThan(-1);
    expect(idx("deletePet")).toBeGreaterThan(-1);
    expect(idx("listPets")).toBeLessThan(idx("createPet"));
    expect(idx("createPet")).toBeLessThan(idx("showPetById"));
    expect(idx("showPetById")).toBeLessThan(idx("deletePet"));
  });

  it("captures created Pet id from createPet response and reuses it", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    inferResourceGraph(ir);
    const { files } = compileK6(ir);
    const flow = files["flow.js"]!;
    // After createPet success, push id under state['Pet']
    expect(flow).toMatch(/state\["Pet"\]\s*=\s*state\["Pet"\]\s*\|\|\s*\[\]/);
    // pickPathParam threads state into showPetById / deletePet
    expect(flow).toContain('pickPathParam("showPetById"');
    expect(flow).toContain('pickPathParam("deletePet"');
  });

  it("emits an apiKey header from petstore auth", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    inferResourceGraph(ir);
    const { files } = compileK6(ir);
    const config = files["config.js"]!;
    // petstore.yaml declares an apiKey scheme with header X-API-Key
    expect(config).toContain("X-API-Key");
    // never inline secrets
    expect(config).not.toMatch(/sk_test/);
  });

  it("fixtures.json contains pre-generated bodies for createPet", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    inferResourceGraph(ir);
    const { files, fixtures } = compileK6(ir, { fixtureSize: 5, seed: 42 });
    expect(fixtures.byOperationId.createPet?.bodies).toBeDefined();
    expect(fixtures.byOperationId.createPet!.bodies!.length).toBe(5);
    // body should match NewPet schema (name + tag) — name is required
    const first = fixtures.byOperationId.createPet!.bodies![0] as Record<string, unknown>;
    expect(first.name).toBeTypeOf("string");
  });

  it("honors --target via the baseUrl option", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    inferResourceGraph(ir);
    const { files } = compileK6(ir, { baseUrl: "http://localhost:4010" });
    expect(files["config.js"]).toContain("http://localhost:4010");
  });

  it("package.json + .env.example look sane", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    inferResourceGraph(ir);
    const { files } = compileK6(ir);
    const pkg = JSON.parse(files["package.json"]!);
    expect(pkg.scripts).toEqual({
      smoke: "k6 run smoke.js",
      load: "k6 run load.js",
    });
    expect(files[".env.example"]).toContain("BASE_URL=");
  });
});
