import { resolve } from "node:path";
import { fromOpenApiFile } from "@loadam/core";
import { describe, expect, it } from "vitest";
import { type ProbeResult, compareProbes, renderMarkdownReport } from "../src/index.js";

const PETSTORE = resolve(__dirname, "../../../fixtures/specs/petstore.openapi.yaml");

describe("drift — pure differ on petstore", () => {
  it("reports no findings when responses match the spec", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    const probes: ProbeResult[] = [
      {
        operationId: "listPets",
        status: 200,
        contentType: "application/json",
        body: [
          { id: 1, name: "fido" },
          { id: 2, name: "rex", tag: "good-boy" },
        ],
      },
      {
        operationId: "showPetById",
        status: 200,
        contentType: "application/json",
        body: { id: 7, name: "whiskers" },
      },
    ];
    const findings = compareProbes({ ir, probes });
    expect(findings).toHaveLength(0);
  });

  it("flags schema mismatch when required field is missing", async () => {
    // Pet requires `id` and `name`. Live API returns only `name` → drift.
    const ir = await fromOpenApiFile(PETSTORE);
    const probes: ProbeResult[] = [
      {
        operationId: "showPetById",
        status: 200,
        contentType: "application/json",
        body: { name: "no-id-here" },
      },
    ];
    const findings = compareProbes({ ir, probes });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("schema-mismatch");
    expect(findings[0]?.severity).toBe("error");
  });

  it("flags schema mismatch when field type drifted", async () => {
    // Pet.id is declared as integer; API returns a string.
    const ir = await fromOpenApiFile(PETSTORE);
    const probes: ProbeResult[] = [
      {
        operationId: "showPetById",
        status: 200,
        contentType: "application/json",
        body: { id: "not-a-number", name: "hmm" },
      },
    ];
    const findings = compareProbes({ ir, probes });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("schema-mismatch");
  });

  it("flags schema mismatch via the default response when body is wrong shape", async () => {
    // listPets declares a `default` response with the Error schema.
    // 418 matches default; the body is missing required `code` → mismatch.
    const ir = await fromOpenApiFile(PETSTORE);
    const probes: ProbeResult[] = [
      {
        operationId: "listPets",
        status: 418,
        contentType: "application/json",
        body: { message: "I am a teapot" }, // missing required `code`
      },
    ];
    const findings = compareProbes({ ir, probes });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("schema-mismatch");
  });

  it("falls back to the default response when status is not explicitly declared", async () => {
    // listPets declares 200 + default. 500 should match `default` and validate
    // against the Error schema → no finding.
    const ir = await fromOpenApiFile(PETSTORE);
    const probes: ProbeResult[] = [
      {
        operationId: "listPets",
        status: 500,
        contentType: "application/json",
        body: { code: 500, message: "boom" },
      },
    ];
    const findings = compareProbes({ ir, probes });
    expect(findings).toHaveLength(0);
  });

  it("renders a Markdown report with the right severity badges", async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    const probes: ProbeResult[] = [
      {
        operationId: "showPetById",
        status: 200,
        contentType: "application/json",
        body: { name: "no-id" },
      },
    ];
    const findings = compareProbes({ ir, probes });
    const md = renderMarkdownReport({
      ir,
      baseUrl: "http://localhost:4010",
      findings,
      skipped: [],
      generatedAt: "2026-04-30T00:00:00Z",
    });
    expect(md).toContain("# Drift report — Swagger Petstore");
    expect(md).toContain("schema-mismatch");
    expect(md).toContain("error");
    expect(md).toContain("http://localhost:4010");
  });

  it('produces a clean "no drift" report when findings is empty', async () => {
    const ir = await fromOpenApiFile(PETSTORE);
    const md = renderMarkdownReport({
      ir,
      baseUrl: "http://localhost:4010",
      findings: [],
      skipped: [{ operationId: "createPet", reason: "mutating POST skipped (safe-only)" }],
      generatedAt: "2026-04-30T00:00:00Z",
    });
    expect(md).toContain("No drift detected");
    expect(md).toContain("## Skipped operations");
    expect(md).toContain("mutating POST skipped");
  });
});
