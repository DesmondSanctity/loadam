import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanSessions,
  createSession,
  listSessions,
  resolveSessionId,
} from "../src/session/index.js";

const FAKE_IR = { meta: { title: "Pet Store", version: "1.0.0" } } as const;
const FAKE_IR_JSON = JSON.stringify(FAKE_IR);
const FAKE_SPEC = "openapi: 3.0.0\ninfo:\n  title: Pet Store\n  version: 1.0.0\n";

async function makeSession(outRoot: string, command: "test" | "diff" | "contract" = "test") {
  return createSession({
    command,
    outRoot,
    specPath: "/tmp/spec.yaml",
    specSource: FAKE_SPEC,
    ir: FAKE_IR,
    irJson: FAKE_IR_JSON,
    target: "https://api.example.com",
    envVars: ["API_TOKEN"],
    flags: { mode: "smoke", token: "should-be-redacted", target: "https://api.example.com" },
    slug: `${command}-pet-store`,
  });
}

describe("session module", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "loadam-session-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("createSession", () => {
    it("creates dir, writes ir.json + meta.json, returns ActiveSession handle", async () => {
      const s = await makeSession(dir);
      expect(s.id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-test-pet-store$/);
      const irOnDisk = await readFile(join(s.dir, "ir.json"), "utf8");
      expect(irOnDisk).toBe(FAKE_IR_JSON);
      const meta = JSON.parse(await readFile(join(s.dir, "meta.json"), "utf8"));
      expect(meta.schemaVersion).toBe(1);
      expect(meta.command).toBe("test");
      expect(meta.target).toBe("https://api.example.com");
      expect(meta.envVars).toEqual(["API_TOKEN"]);
      expect(meta.spec.title).toBe("Pet Store");
      expect(typeof meta.spec.sha256).toBe("string");
      expect(typeof meta.irDigest).toBe("string");
      expect(meta.startedAt).toMatch(/^\d{4}-/);
    });

    it("redacts secret-shaped flag values", async () => {
      const s = await makeSession(dir);
      const meta = JSON.parse(await readFile(join(s.dir, "meta.json"), "utf8"));
      expect(meta.flags.token).toBe("[redacted]");
      expect(meta.flags.mode).toBe("smoke");
      expect(meta.flags.target).toBe("https://api.example.com");
    });

    it("writes a sentinel .gitignore inside sessions/ root once", async () => {
      const s = await makeSession(dir);
      const sessionsRoot = join(s.dir, "..");
      const gi = await readFile(join(sessionsRoot, ".gitignore"), "utf8");
      expect(gi).toContain("*");
      // Idempotent — second session does not blow it away.
      await makeSession(dir);
      const gi2 = await readFile(join(sessionsRoot, ".gitignore"), "utf8");
      expect(gi2).toBe(gi);
    });

    it("addArtefact + finalize roundtrip", async () => {
      const s = await makeSession(dir);
      await s.addArtefact("drift.md", "# drift\n");
      const final = await s.finalize({
        exitCode: 0,
        thresholds: { passed: ["http_req_duration"], failed: [] },
        summary: { p95: 142 },
      });
      expect(final.exitCode).toBe(0);
      expect(final.endedAt).toBeDefined();
      expect(final.durationMs).toBeGreaterThanOrEqual(0);
      expect(final.thresholds?.passed).toContain("http_req_duration");
      expect(final.summary?.p95).toBe(142);
      const onDisk = JSON.parse(await readFile(join(s.dir, "meta.json"), "utf8"));
      expect(onDisk.exitCode).toBe(0);
      expect(onDisk.summary.p95).toBe(142);
      const drift = await readFile(join(s.dir, "drift.md"), "utf8");
      expect(drift).toBe("# drift\n");
    });
  });

  describe("listSessions", () => {
    it("returns newest first", async () => {
      const a = await makeSession(dir);
      // ensure distinct timestamp
      await new Promise((r) => setTimeout(r, 1100));
      const b = await makeSession(dir, "diff");
      const all = await listSessions(dir);
      expect(all.length).toBe(2);
      expect(all[0]?.id).toBe(b.id);
      expect(all[1]?.id).toBe(a.id);
    });

    it("returns [] when no sessions dir exists", async () => {
      const empty = await mkdtemp(join(tmpdir(), "loadam-empty-"));
      try {
        expect(await listSessions(empty)).toEqual([]);
      } finally {
        await rm(empty, { recursive: true, force: true });
      }
    });
  });

  describe("resolveSessionId", () => {
    it("supports exact id, latest alias, and unambiguous prefix", async () => {
      const a = await makeSession(dir);
      await new Promise((r) => setTimeout(r, 1100));
      const b = await makeSession(dir, "diff");
      expect((await resolveSessionId(dir, a.id)).id).toBe(a.id);
      expect((await resolveSessionId(dir, "latest")).id).toBe(b.id);
      // unique prefix from a.id
      const prefix = a.id.slice(0, a.id.length - 4);
      expect((await resolveSessionId(dir, prefix)).id).toBe(a.id);
    });

    it("throws on no match and on ambiguous prefix", async () => {
      await makeSession(dir);
      await new Promise((r) => setTimeout(r, 1100));
      await makeSession(dir, "diff");
      await expect(resolveSessionId(dir, "nope-xyz")).rejects.toThrow(/No session/);
      // shared prefix "20" matches both sessions in any plausible year-2xxx run
      await expect(resolveSessionId(dir, "2")).rejects.toThrow(/Ambiguous/);
    });
  });

  describe("cleanSessions", () => {
    it("dry-run by default reports deletions but keeps directories", async () => {
      const a = await makeSession(dir);
      await new Promise((r) => setTimeout(r, 1100));
      const b = await makeSession(dir, "diff");
      const result = await cleanSessions(dir, { keep: 1 });
      expect(result.kept).toEqual([b.id]);
      expect(result.deleted).toEqual([a.id]);
      // directory still exists (dry run)
      const st = await stat(a.dir);
      expect(st.isDirectory()).toBe(true);
    });

    it("apply: true actually deletes", async () => {
      const a = await makeSession(dir);
      await new Promise((r) => setTimeout(r, 1100));
      const b = await makeSession(dir, "diff");
      await cleanSessions(dir, { keep: 1, apply: true });
      await expect(stat(a.dir)).rejects.toThrow();
      const stB = await stat(b.dir);
      expect(stB.isDirectory()).toBe(true);
    });

    it("olderThanMs deletes only sessions past cutoff", async () => {
      const a = await makeSession(dir);
      await new Promise((r) => setTimeout(r, 1500));
      const b = await makeSession(dir, "diff");
      // Cutoff 1s — only `a` should fall out.
      const result = await cleanSessions(dir, { olderThanMs: 1000, apply: true });
      expect(result.deleted).toEqual([a.id]);
      expect(result.kept).toEqual([b.id]);
    });
  });
});
