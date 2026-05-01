import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BIN = resolve(__dirname, "../dist/bin.js");
const REPO_ROOT = resolve(__dirname, "../../..");
const PETSTORE = resolve(REPO_ROOT, "fixtures/specs/petstore.openapi.yaml");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], input?: string): Promise<RunResult> {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1", CONSOLA_LEVEL: "3" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => {
      stdout += c.toString();
    });
    child.stderr.on("data", (c) => {
      stderr += c.toString();
    });
    child.on("error", rej);
    child.on("close", (code) => res({ code: code ?? -1, stdout, stderr }));
    if (input !== undefined) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

describe("loadam CLI", () => {
  let workDir: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "loadam-cli-test-"));
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  describe("init", () => {
    it("parses petstore and writes IR JSON", async () => {
      const out = join(workDir, "petstore.ir.json");
      const r = await run(["init", PETSTORE, "-o", out]);
      expect(r.code).toBe(0);
      const ir = JSON.parse(await readFile(out, "utf8"));
      expect(ir.version).toBe("1");
      expect(ir.operations).toHaveLength(4);
      expect(ir.resources.kinds.map((k: { name: string }) => k.name)).toContain("Pet");
      const combined = r.stdout + r.stderr;
      expect(combined).toContain("Pet");
      expect(combined).toMatch(/operations/);
    });

    it("exits non-zero when spec path is missing", async () => {
      const r = await run(["init", "/nonexistent/spec.yaml", "-o", join(workDir, "x.json")]);
      expect(r.code).not.toBe(0);
    });

    it("--no-tree suppresses the tree output", async () => {
      const out = join(workDir, "petstore-notree.ir.json");
      const r = await run(["init", PETSTORE, "-o", out, "--no-tree"]);
      expect(r.code).toBe(0);
      // Tree lines start with the resource kind followed by 4-space indented op rows.
      expect(r.stdout).not.toMatch(/^\s{4}(create|read|list|delete):/m);
    });
  });

  describe("auth import", () => {
    it("detects bearer token from stdin curl and emits env binding (never the secret)", async () => {
      const curl = "curl https://api.example.com/v1/pets -H 'Authorization: Bearer sk_test_abc123'";
      const r = await run(["auth", "import", "--json"], curl);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.profile?.kind).toBe("bearer");
      expect(parsed.profile?.tokenEnv).toBeTruthy();
      // Hard guarantee: the inferred profile must never inline the literal secret.
      // (The `tokens` field intentionally echoes raw input for debugging.)
      expect(JSON.stringify(parsed.profile)).not.toContain("sk_test_abc123");
    });

    it("exits with code 2 when no curl input is provided", async () => {
      const r = await run(["auth", "import"], "");
      expect(r.code).toBe(2);
    });
  });

  describe("--json mode", () => {
    it("init --json prints exactly one JSON document on stdout", async () => {
      const out = join(workDir, "petstore-json.ir.json");
      const r = await run(["init", PETSTORE, "-o", out, "--json"]);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.command).toBe("init");
      expect(parsed.operations).toBe(4);
      expect(parsed.outputPath).toBe(out);
    });

    it("test --json emits a structured summary", async () => {
      const out = join(workDir, "k6-json");
      const r = await run(["test", PETSTORE, "-o", out, "--json"]);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.command).toBe("test");
      expect(parsed.files).toBeGreaterThan(0);
      expect(parsed.operations).toBe(4);
    });

    it("mcp --json emits the curated tool list", async () => {
      const out = join(workDir, "mcp-json");
      const r = await run(["mcp", PETSTORE, "-o", out, "--json"]);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.command).toBe("mcp");
      expect(parsed.toolNames.sort()).toEqual(["listPets", "showPetById"]);
      expect(parsed.writes).toBe(false);
    });

    it("contract --json emits a structured summary", async () => {
      const out = join(workDir, "contract-json");
      const r = await run(["contract", PETSTORE, "-o", out, "--json"]);
      expect(r.code).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.command).toBe("contract");
      expect(parsed.operations).toBe(4);
    });
  });

  describe("multi-spec smoke", () => {
    const SPECS = [
      {
        name: "httpbin-mini (no auth)",
        path: resolve(REPO_ROOT, "fixtures/specs/httpbin-mini.openapi.yaml"),
        expectAuthEnvVars: 0,
      },
      {
        name: "bookstore (bearer + multi-server)",
        path: resolve(REPO_ROOT, "fixtures/specs/bookstore.openapi.yaml"),
        expectAuthEnvVars: 1,
      },
    ];

    for (const spec of SPECS) {
      it(`test + mcp + contract all complete cleanly on ${spec.name}`, async () => {
        const tag = spec.name.replace(/[^a-z0-9]+/gi, "-");
        const k6Out = join(workDir, `${tag}-k6`);
        const mcpOut = join(workDir, `${tag}-mcp`);
        const contractOut = join(workDir, `${tag}-contract`);

        const t = await run(["test", spec.path, "-o", k6Out, "--json"]);
        expect(t.code).toBe(0);
        const tj = JSON.parse(t.stdout);
        expect(tj.files).toBeGreaterThanOrEqual(8);

        const m = await run(["mcp", spec.path, "-o", mcpOut, "--writes", "--json"]);
        expect(m.code).toBe(0);
        const mj = JSON.parse(m.stdout);
        expect(mj.envVars.length).toBe(spec.expectAuthEnvVars);
        expect(mj.tools).toBeGreaterThan(0);

        const c = await run(["contract", spec.path, "-o", contractOut, "--json"]);
        expect(c.code).toBe(0);
        const cj = JSON.parse(c.stdout);
        expect(cj.operations).toBeGreaterThan(0);
      }, 20_000);
    }
  });
});
