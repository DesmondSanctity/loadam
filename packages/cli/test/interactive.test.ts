import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isInteractive, writeEnvFile } from "../src/util/interactive.js";

describe("interactive util", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "loadam-int-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("isInteractive()", () => {
    it("returns false when --no-interactive flag is true", () => {
      expect(isInteractive(true)).toBe(false);
    });

    it("returns false when CI is set (regardless of TTY)", () => {
      const prev = process.env.CI;
      process.env.CI = "true";
      try {
        expect(isInteractive(false)).toBe(false);
      } finally {
        if (prev === undefined) {
          process.env.CI = undefined;
        } else {
          process.env.CI = prev;
        }
      }
    });

    it("returns false when stdin is not a TTY (typical test runner case)", () => {
      // vitest runs without TTY; this is the dominant code path here.
      expect(isInteractive(false)).toBe(false);
    });
  });

  describe("writeEnvFile()", () => {
    it("creates .env with BASE_URL and supplied vars", async () => {
      const result = await writeEnvFile(dir, "https://api.example.com", {
        BEARER_TOKEN: "secret123",
      });
      expect(result.path).toBe(join(dir, ".env"));
      expect(result.written).toEqual(["BASE_URL", "BEARER_TOKEN"]);
      expect(result.preserved).toEqual([]);

      const text = await readFile(result.path, "utf8");
      expect(text).toContain("BASE_URL=https://api.example.com");
      expect(text).toContain("BEARER_TOKEN=secret123");
    });

    it("preserves existing keys by default and reports them", async () => {
      const path = join(dir, ".env");
      await writeFile(path, "BASE_URL=https://existing.example\nBEARER_TOKEN=keep-me\n", "utf8");

      const result = await writeEnvFile(dir, "https://new.example", {
        BEARER_TOKEN: "would-overwrite",
        API_KEY: "fresh",
      });

      expect(result.preserved.sort()).toEqual(["BASE_URL", "BEARER_TOKEN"]);
      expect(result.written).toEqual(["API_KEY"]);

      const text = await readFile(path, "utf8");
      expect(text).toContain("BASE_URL=https://existing.example");
      expect(text).toContain("BEARER_TOKEN=keep-me");
      expect(text).toContain("API_KEY=fresh");
    });

    it("overwrites when overwrite:true", async () => {
      const path = join(dir, ".env");
      await writeFile(path, "BASE_URL=https://old\nBEARER_TOKEN=old\n", "utf8");
      const result = await writeEnvFile(
        dir,
        "https://new",
        { BEARER_TOKEN: "new" },
        { overwrite: true },
      );
      expect(result.written.sort()).toEqual(["BASE_URL", "BEARER_TOKEN"]);
      const text = await readFile(path, "utf8");
      expect(text).toContain("BASE_URL=https://new");
      expect(text).toContain("BEARER_TOKEN=new");
    });

    it("ignores comments and blank lines when reading existing env", async () => {
      const path = join(dir, ".env");
      await writeFile(path, "# header\n\nBASE_URL=https://existing\n# trailing\n", "utf8");
      const result = await writeEnvFile(dir, "https://new", { API_KEY: "x" });
      expect(result.preserved).toEqual(["BASE_URL"]);
      expect(result.written).toEqual(["API_KEY"]);
    });

    it("writes file with mode 0600 on POSIX", async () => {
      if (process.platform === "win32") return;
      const result = await writeEnvFile(dir, "https://api", { BEARER_TOKEN: "x" });
      const st = await stat(result.path);
      const mode = st.mode & 0o777;
      expect(mode).toBe(0o600);
    });
  });
});
