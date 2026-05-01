import { describe, expect, it } from "vitest";
import { tokenizeCurl } from "../src/tokenize.js";

describe("tokenizeCurl", () => {
  it("handles a simple flat command", () => {
    const tokens = tokenizeCurl("curl -X GET https://example.com");
    expect(tokens).toEqual(["curl", "-X", "GET", "https://example.com"]);
  });

  it("handles double-quoted args with spaces", () => {
    const tokens = tokenizeCurl(`curl -H "Content-Type: application/json" https://x`);
    expect(tokens).toEqual(["curl", "-H", "Content-Type: application/json", "https://x"]);
  });

  it("handles single-quoted args without escape interpretation", () => {
    const tokens = tokenizeCurl(`curl -H 'Authorization: Bearer abc\\xyz' https://x`);
    expect(tokens).toEqual(["curl", "-H", "Authorization: Bearer abc\\xyz", "https://x"]);
  });

  it("collapses backslash-newline continuations", () => {
    const cmd = `curl \\\n  -H "X-Api-Key: secret" \\\n  https://api.example.com`;
    const tokens = tokenizeCurl(cmd);
    expect(tokens).toEqual(["curl", "-H", "X-Api-Key: secret", "https://api.example.com"]);
  });

  it("throws on unterminated quote", () => {
    expect(() => tokenizeCurl(`curl -H "broken`)).toThrow();
  });
});
