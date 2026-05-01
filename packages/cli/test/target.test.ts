import { afterEach, describe, expect, it } from "vitest";
import { resolveTarget } from "../src/util/target.js";

const ORIGINAL = process.env.LOADAM_TARGET;
function unset(): void {
  // biome-ignore lint/performance/noDelete: env vars must be removed, not set to undefined string
  delete process.env.LOADAM_TARGET;
}
afterEach(() => {
  if (ORIGINAL === undefined) unset();
  else process.env.LOADAM_TARGET = ORIGINAL;
});

describe("resolveTarget", () => {
  it("prefers the CLI flag", () => {
    process.env.LOADAM_TARGET = "https://env.example";
    expect(resolveTarget("https://flag.example")).toBe("https://flag.example");
  });

  it("falls back to LOADAM_TARGET when flag is missing", () => {
    process.env.LOADAM_TARGET = "https://env.example";
    expect(resolveTarget(undefined)).toBe("https://env.example");
  });

  it("returns undefined when neither is set", () => {
    unset();
    expect(resolveTarget(undefined)).toBeUndefined();
  });

  it("ignores empty strings", () => {
    unset();
    expect(resolveTarget("")).toBeUndefined();
    process.env.LOADAM_TARGET = "";
    expect(resolveTarget(undefined)).toBeUndefined();
  });
});
