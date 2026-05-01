import { describe, expect, it } from "vitest";
import { importCurl } from "../src/curl.js";

describe("importCurl", () => {
  it("detects Bearer tokens", () => {
    const result = importCurl(
      `curl -H "Authorization: Bearer eyJhbGc.foo.bar" https://api.example.com/v1/me`,
    );
    expect(result.profile?.kind).toBe("bearer");
    if (result.profile?.kind === "bearer") {
      expect(result.profile.tokenEnv).toBe("API_TOKEN");
    }
    expect(result.url).toBe("https://api.example.com/v1/me");
  });

  it("detects X-API-Key headers", () => {
    const result = importCurl(`curl -H "X-API-Key: sk_test_123" https://api.example.com/items`);
    expect(result.profile?.kind).toBe("apiKey");
    if (result.profile?.kind === "apiKey") {
      expect(result.profile.in).toBe("header");
      expect(result.profile.name).toBe("X-Api-Key");
      expect(result.profile.valueEnv).toBe("API_KEY");
    }
  });

  it("detects -u basic auth", () => {
    const result = importCurl("curl -u admin:secret https://api.example.com/admin");
    expect(result.profile?.kind).toBe("basic");
  });

  it("detects api_key in query string", () => {
    const result = importCurl("curl https://api.example.com/list?api_key=abc&page=1");
    expect(result.profile?.kind).toBe("apiKey");
    if (result.profile?.kind === "apiKey") {
      expect(result.profile.in).toBe("query");
      expect(result.profile.name).toBe("api_key");
    }
  });

  it("returns null profile when no auth signal", () => {
    const result = importCurl("curl https://api.example.com/public");
    expect(result.profile).toBeNull();
  });

  it('parses multi-line "Copy as curl" output', () => {
    const cmd = `curl 'https://api.example.com/v1/charges' \\
  -H 'authorization: Bearer sk_test_xyz' \\
  -H 'content-type: application/json' \\
  --data-raw '{"amount":100}'`;
    const result = importCurl(cmd);
    expect(result.profile?.kind).toBe("bearer");
    expect(result.url).toBe("https://api.example.com/v1/charges");
  });

  it("extracts -X method", () => {
    const result = importCurl(`curl -X POST -H "X-API-Key: k" https://x`);
    expect(result.method).toBe("POST");
  });

  it("never inlines the actual secret value", () => {
    const result = importCurl(`curl -H "Authorization: Bearer SECRET_VALUE_DO_NOT_LEAK" https://x`);
    const json = JSON.stringify(result.profile);
    expect(json).not.toContain("SECRET_VALUE_DO_NOT_LEAK");
  });
});
