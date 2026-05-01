// Lightweight self-update check. Hits the npm registry once, no auth, no telemetry.
// Returns the latest version string or null on any failure (network, parse, etc.).

const PKG = "loadam";
const REGISTRY = "https://registry.npmjs.org";

export async function fetchLatestVersion(timeoutMs = 3000): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${REGISTRY}/${PKG}/latest`, {
      signal: ctrl.signal,
      headers: { accept: "application/json" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: unknown };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

// Semver-ish compare: returns -1 / 0 / 1. Handles only X.Y.Z and X.Y.Z-pre.
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .replace(/^v/, "")
      .split("-")[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const [aa, bb] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    const d = (aa[i] ?? 0) - (bb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}
