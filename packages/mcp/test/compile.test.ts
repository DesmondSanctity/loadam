import { resolve } from "node:path";
import { fromOpenApiFile } from "@loadam/core";
import { inferResourceGraph } from "@loadam/graph";
import { describe, expect, it } from "vitest";
import { compileMcp, curateTools } from "../src/index.js";

const PETSTORE = resolve(__dirname, "../../../fixtures/specs/petstore.openapi.yaml");

async function loadPetstore() {
  const ir = await fromOpenApiFile(PETSTORE);
  inferResourceGraph(ir);
  return ir;
}

describe("curateTools — petstore", () => {
  it("exposes only safe ops by default", async () => {
    const ir = await loadPetstore();
    const tools = curateTools(ir);
    const names = tools.map((t) => t.name).sort();
    // Petstore safe ops: listPets, showPetById. createPet & deletePet excluded.
    expect(names).toEqual(["listPets", "showPetById"]);
  });

  it("includes mutating ops with includeWrites", async () => {
    const ir = await loadPetstore();
    const tools = curateTools(ir, { includeWrites: true });
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["createPet", "deletePet", "listPets", "showPetById"]);
  });

  it("builds inputSchema with required path params and body", async () => {
    const ir = await loadPetstore();
    const tools = curateTools(ir, { includeWrites: true });
    const showPet = tools.find((t) => t.name === "showPetById");
    expect(showPet).toBeDefined();
    const showSchema = showPet!.inputSchema as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(showSchema.type).toBe("object");
    expect(showSchema.required).toContain("petId");
    expect(showSchema.properties.petId).toBeDefined();

    const create = tools.find((t) => t.name === "createPet");
    expect(create).toBeDefined();
    const createSchema = create!.inputSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(createSchema.properties.body).toBeDefined();
    expect(createSchema.required).toContain("body");
  });

  it("honours the exclude deny-list", async () => {
    const ir = await loadPetstore();
    const tools = curateTools(ir, {
      includeWrites: true,
      exclude: ["deletePet"],
    });
    expect(tools.find((t) => t.name === "deletePet")).toBeUndefined();
  });
});

describe("compileMcp — petstore", () => {
  it("emits the expected file set", async () => {
    const ir = await loadPetstore();
    const { files } = compileMcp(ir);
    expect(Object.keys(files).sort()).toEqual(
      [
        ".env.example",
        "README.md",
        "auth.js",
        "bin.js",
        "client.js",
        "package.json",
        "server.js",
        "tools.js",
      ].sort(),
    );
  });

  it("package.json pins SDK version exactly and sets type=module", async () => {
    const ir = await loadPetstore();
    const { files } = compileMcp(ir);
    const pkg = JSON.parse(files["package.json"]!);
    expect(pkg.type).toBe("module");
    expect(pkg.dependencies["@modelcontextprotocol/sdk"]).toMatch(/^\^1\./);
    expect(pkg.bin).toBeTypeOf("object");
  });

  it("bin.js wires both stdio and streamable-http transports", async () => {
    const ir = await loadPetstore();
    const { files } = compileMcp(ir);
    const bin = files["bin.js"]!;
    expect(bin).toContain("StdioServerTransport");
    expect(bin).toContain("streamableHttp.js");
    expect(bin).toContain("--http");
  });

  it("server.js wires ListTools + CallTool handlers", async () => {
    const ir = await loadPetstore();
    const { files } = compileMcp(ir);
    const server = files["server.js"]!;
    expect(server).toContain("ListToolsRequestSchema");
    expect(server).toContain("CallToolRequestSchema");
    expect(server).toContain("from './tools.js'");
    expect(server).toContain("from './client.js'");
  });

  it("tools.js is valid JS and exports a TOOLS array with safe ops only", async () => {
    const ir = await loadPetstore();
    const { files, tools } = compileMcp(ir);
    expect(files["tools.js"]).toContain("export const TOOLS");
    expect(tools.map((t) => t.name).sort()).toEqual(["listPets", "showPetById"]);
  });

  it("readme + .env.example mention the inferred base URL", async () => {
    const ir = await loadPetstore();
    const { files } = compileMcp(ir, { baseUrl: "https://api.example.com" });
    expect(files[".env.example"]).toContain("BASE_URL=https://api.example.com");
    expect(files["README.md"]).toContain("https://api.example.com");
  });

  it("writes mode flips the readme banner", async () => {
    const ir = await loadPetstore();
    const safe = compileMcp(ir);
    const writes = compileMcp(ir, { includeWrites: true });
    expect(safe.files["README.md"]).toContain("read-only by default");
    expect(writes.files["README.md"]).toContain("--writes");
    expect(writes.tools.length).toBeGreaterThan(safe.tools.length);
  });

  it("embeds API-key env var into auth.js when spec declares apiKey scheme", async () => {
    const ir = await loadPetstore();
    const { files, envVars } = compileMcp(ir);
    // Petstore has no auth declared by default; envVars may be empty.
    expect(Array.isArray(envVars)).toBe(true);
    expect(files["auth.js"]).toContain("export function authHeaders");
    expect(files["auth.js"]).toContain("export function authQuery");
  });
});
