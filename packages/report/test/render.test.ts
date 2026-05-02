import { describe, expect, it } from "vitest";
import type { K6Summary, SessionMeta } from "../src/index.js";
import { renderReport } from "../src/index.js";

const BASE_META: SessionMeta = {
  schemaVersion: 1,
  id: "2026-05-01T11-32-45-smoke-pet-store",
  command: "test",
  flags: { mode: "smoke", target: "https://api.example.com" },
  spec: {
    path: "/tmp/petstore.yaml",
    sha256: "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
    title: "Pet Store",
    version: "1.0.0",
  },
  irDigest: "deadbeefdeadbeefdeadbeefdeadbeef",
  target: "https://api.example.com",
  envVars: ["API_TOKEN"],
  startedAt: "2026-05-01T11:32:45.000Z",
  endedAt: "2026-05-01T11:32:50.000Z",
  durationMs: 5000,
  exitCode: 0,
  thresholds: {
    passed: ["http_req_duration: p(95)<500"],
    failed: [],
  },
  summary: { p95: 142, reqs: 100 },
  artefacts: ["meta.json", "ir.json", "k6-smoke-summary.json"],
};

describe("renderReport", () => {
  it("renders a complete passing report", () => {
    const html = renderReport({ meta: BASE_META, loadamVersion: "0.2.2" });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Pet Store · test · 2026-05-01T11-32-45-smoke-pet-store</title>");
    expect(html).toContain('class="status-chip ok">passed<');
    expect(html).toContain("Pet Store");
    expect(html).toContain("https://api.example.com");
    expect(html).toContain("API_TOKEN");
    expect(html).toContain("loadam 0.2.2");
    // Inlined data payload
    expect(html).toContain('id="loadam-data"');
  });

  it("renders FAILED badge when exit code non-zero", () => {
    const html = renderReport({
      meta: {
        ...BASE_META,
        exitCode: 1,
        thresholds: { passed: [], failed: ["http_req_duration"] },
      },
      loadamVersion: "0.2.2",
    });
    expect(html).toContain('class="status-chip bad">failed<');
    expect(html).toContain("✗ http_req_duration");
  });

  it("renders FAILED when thresholds failed even if exit code 0", () => {
    const html = renderReport({
      meta: { ...BASE_META, exitCode: 0, thresholds: { passed: [], failed: ["http_reqs.rate"] } },
      loadamVersion: "0.2.2",
    });
    expect(html).toContain('class="status-chip bad">failed<');
  });

  it("surfaces k6 metrics into latency section + summary cards", () => {
    const k6: K6Summary = {
      metrics: {
        http_req_duration: {
          type: "trend",
          values: {
            min: 12,
            med: 45,
            avg: 60,
            "p(90)": 100,
            "p(95)": 142,
            "p(99)": 280,
            max: 500,
          },
        },
        http_reqs: { values: { count: 1234, rate: 12.5 } },
        http_req_failed: { values: { rate: 0.012 } },
      },
    };
    const html = renderReport({
      meta: BASE_META,
      k6Summaries: { smoke: k6 },
      loadamVersion: "0.2.2",
    });
    expect(html).toContain(">k6 results<");
    expect(html).toContain("http_req_duration");
    expect(html).toContain("142 ms"); // p(95)
    expect(html).toContain("500 ms"); // max
    expect(html).toContain("smoke p95");
    expect(html).toContain("smoke reqs");
    expect(html).toContain("12.5/s");
    expect(html).toContain("1.20%"); // failure rate
  });

  it("includes drift markdown verbatim for diff sessions", () => {
    const html = renderReport({
      meta: { ...BASE_META, command: "diff" },
      driftMarkdown: "# Drift\n\n- Missing endpoint: GET /pets/{id}\n",
      loadamVersion: "0.2.2",
    });
    expect(html).toContain(">Drift findings<");
    expect(html).toContain("Missing endpoint");
  });

  it("renders contract failures section when provided", () => {
    const html = renderReport({
      meta: { ...BASE_META, command: "contract" },
      contractFailures: [
        { test: "test_get_pet_returns_200", message: "AssertionError: status was 500" },
      ],
      loadamVersion: "0.2.2",
    });
    expect(html).toContain("Contract failures (1)");
    expect(html).toContain("test_get_pet_returns_200");
    expect(html).toContain("status was 500");
  });

  it("escapes HTML in user-controlled fields (XSS guard)", () => {
    const html = renderReport({
      meta: {
        ...BASE_META,
        spec: { ...BASE_META.spec, title: "<script>alert(1)</script>" },
        target: "https://evil.com/<img onerror=x>",
      },
      loadamVersion: "0.2.2",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img onerror=x&gt;");
  });

  it("escapes </script> inside the inlined JSON payload", () => {
    const html = renderReport({
      meta: { ...BASE_META, flags: { malicious: "</script><img src=x>" } },
      loadamVersion: "0.2.2",
    });
    // The </script> sequence inside JSON must be escaped so it can't terminate the script tag.
    const dataIdx = html.indexOf('id="loadam-data"');
    const tail = html.slice(dataIdx);
    expect(tail.toLowerCase()).not.toContain("</script><img");
    expect(tail).toContain("<\\/script");
  });

  it("is fully self-contained — no external URLs except the GitHub footer link", () => {
    const html = renderReport({ meta: BASE_META, loadamVersion: "0.2.2" });
    // Strip the one allowlisted link.
    const stripped = html.replace(/https:\/\/github\.com\/DesmondSanctity\/loadam/g, "");
    expect(stripped).not.toMatch(/https?:\/\/(?!api\.example\.com)[^"\s]+/);
    expect(stripped).not.toContain("<script src");
    expect(stripped).not.toContain("<link rel");
  });

  it("handles missing optional fields gracefully", () => {
    const minimal: SessionMeta = {
      schemaVersion: 1,
      id: "2026-05-01T11-00-00-test-min",
      command: "test",
      flags: {},
      spec: { path: "/tmp/x.yaml", sha256: "0".repeat(64) },
      irDigest: "0".repeat(32),
      target: null,
      envVars: [],
      startedAt: "2026-05-01T11:00:00.000Z",
      artefacts: [],
    };
    const html = renderReport({ meta: minimal, loadamVersion: "0.2.2" });
    expect(html).toContain("Untitled API");
    expect(html).toContain("—"); // target placeholder
  });

  it("shows a 'Why this failed' panel that names the failure modes", () => {
    const k6: K6Summary = {
      metrics: { http_req_duration: { values: { "p(95)": 800, max: 1000 } } },
      root_group: {
        checks: {
          a: { name: "listPets 2xx", passes: 0, fails: 1 },
          b: { name: "getPet 2xx", passes: 1, fails: 0 },
        },
      },
    };
    const html = renderReport({
      meta: {
        ...BASE_META,
        exitCode: 99,
        thresholds: { passed: [], failed: ["http_req_failed: rate<0.05"] },
      },
      k6Summaries: { smoke: k6 },
      loadamVersion: "0.2.2",
    });
    expect(html).toContain('class="reason bad"');
    expect(html).toContain("Why this failed");
    expect(html).toContain("threshold");
    expect(html).toContain("http_req_failed: rate&lt;0.05");
    expect(html).toContain("1/2 operation check");
  });

  it("labels the run with which mode(s) executed (smoke + load)", () => {
    const empty: K6Summary = { metrics: { http_req_duration: { values: { "p(95)": 50 } } } };
    const html = renderReport({
      meta: { ...BASE_META, flags: { mode: "both" } },
      k6Summaries: { smoke: empty, load: empty },
      loadamVersion: "0.2.2",
    });
    expect(html).toContain("test · smoke + load");
  });

  it("renders CSS-only tabs when multiple k6 summaries are present", () => {
    const dur: K6Summary = { metrics: { http_req_duration: { values: { "p(95)": 50, max: 80 } } } };
    const html = renderReport({
      meta: { ...BASE_META, flags: { mode: "both" } },
      k6Summaries: { smoke: dur, load: dur },
      loadamVersion: "0.2.2",
    });
    expect(html).toContain('id="loadam-tab-smoke"');
    expect(html).toContain('id="loadam-tab-load"');
    expect(html).toContain('for="loadam-tab-smoke"');
    expect(html).toContain('data-tab="smoke"');
    expect(html).toContain('data-tab="load"');
    expect(html).toContain("(2 runs");
    // No JS — only HTML/CSS for tab switching.
    expect(html).not.toContain("<script src");
  });

  it("surfaces failed per-operation checks under each k6 run", () => {
    const k6: K6Summary = {
      metrics: { http_req_duration: { values: { "p(95)": 200, max: 300 } } },
      root_group: {
        checks: {
          a: { name: "createPet 2xx-3xx", passes: 0, fails: 1 },
          b: { name: "listPets 2xx-3xx", passes: 1, fails: 0 },
        },
      },
    };
    const html = renderReport({
      meta: { ...BASE_META, exitCode: 99, thresholds: { passed: [], failed: ["x"] } },
      k6Summaries: { smoke: k6 },
      loadamVersion: "0.2.2",
    });
    expect(html).toContain("Per-operation checks");
    expect(html).toContain("createPet 2xx-3xx");
    expect(html).toContain("listPets 2xx-3xx");
    expect(html).toContain("1/2 passed");
    expect(html).toContain("1 failed");
  });
});
