import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fromOpenApiFile } from "@loadam/core";
import { describe, expect, it } from "vitest";
import { compileContract } from "../src/index.js";

const PETSTORE = resolve(__dirname, "../../../fixtures/specs/petstore.openapi.yaml");

describe("compileContract — petstore", () => {
  it("emits the expected file set", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    const spec = await readFile(PETSTORE, "utf8");
    const { files } = compileContract(ir, spec);
    expect(Object.keys(files).sort()).toEqual(
      [
        ".env.example",
        "README.md",
        "conftest.py",
        "openapi.yaml",
        "pyproject.toml",
        "test_contract.py",
      ].sort(),
    );
  });

  it("pyproject pins schemathesis + pytest", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    const spec = await readFile(PETSTORE, "utf8");
    const { files } = compileContract(ir, spec);
    expect(files["pyproject.toml"]).toContain("schemathesis");
    expect(files["pyproject.toml"]).toContain("pytest");
  });

  it("conftest loads the schema from the embedded spec, with BASE_URL override", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    const spec = await readFile(PETSTORE, "utf8");
    const { files } = compileContract(ir, spec, {
      baseUrl: "http://localhost:4010",
    });
    expect(files["conftest.py"]).toContain("schemathesis.from_path");
    expect(files["conftest.py"]).toContain('"BASE_URL"');
    expect(files["conftest.py"]).toContain("http://localhost:4010");
  });

  it("builds an apiKey header in auth_kwargs() for petstore", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    const spec = await readFile(PETSTORE, "utf8");
    const { files, envVars } = compileContract(ir, spec);
    expect(files["conftest.py"]).toContain("X-API-Key");
    expect(envVars).toContain("X_API_KEY");
  });

  it("test_contract.py uses @schema.parametrize and validate_response", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    const spec = await readFile(PETSTORE, "utf8");
    const { files } = compileContract(ir, spec, { examples: 50 });
    expect(files["test_contract.py"]).toContain("@schema.parametrize()");
    expect(files["test_contract.py"]).toContain("max_examples=50");
    expect(files["test_contract.py"]).toContain("validate_response");
  });

  it("embeds a copy of the spec in the project", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    const spec = await readFile(PETSTORE, "utf8");
    const { files } = compileContract(ir, spec);
    expect(files["openapi.yaml"]).toContain("Petstore");
  });
});
