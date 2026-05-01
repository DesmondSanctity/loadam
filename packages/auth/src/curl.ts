import type { AuthProfile } from "@loadam/core";
import { tokenizeCurl } from "./tokenize.js";

export interface ImportedCurl {
  /** Inferred auth profile, or null if no recognizable auth was found. */
  profile: AuthProfile | null;
  /** All headers parsed from the curl, lower-cased keys. */
  headers: Record<string, string>;
  /** The request URL (first non-flag arg that looks like a URL). */
  url?: string;
  /** Method, if `-X` provided. */
  method?: string;
  /** Raw token list, useful for debugging. */
  tokens: string[];
  /** Notes/warnings the importer wants to surface. */
  notes: string[];
}

/**
 * Parse a curl command and extract an auth profile.
 *
 * Recognizes:
 *   - `-H "Authorization: Bearer <tok>"`     → bearer profile (env: API_TOKEN)
 *   - `-H "X-Api-Key: <key>"` (or similar)   → apiKey/header profile
 *   - `-u user:pass` / `--user user:pass`    → basic profile
 *   - `?api_key=...` or `?apikey=...` in URL → apiKey/query profile
 *
 * Profile values are NEVER inlined — only their names / env-var bindings are
 * recorded. The user supplies the actual secret via env at runtime.
 */
export function importCurl(input: string): ImportedCurl {
  const tokens = tokenizeCurl(input);
  const headers: Record<string, string> = {};
  const notes: string[] = [];
  let url: string | undefined;
  let method: string | undefined;
  let basicCred: string | undefined;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === "curl") continue;

    if ((t === "-H" || t === "--header") && tokens[i + 1] !== undefined) {
      const raw = tokens[++i]!;
      const idx = raw.indexOf(":");
      if (idx > 0) {
        const name = raw.slice(0, idx).trim();
        const value = raw.slice(idx + 1).trim();
        headers[name.toLowerCase()] = value;
      }
      continue;
    }

    if ((t === "-u" || t === "--user") && tokens[i + 1] !== undefined) {
      basicCred = tokens[++i];
      continue;
    }

    if ((t === "-X" || t === "--request") && tokens[i + 1] !== undefined) {
      method = tokens[++i]!.toUpperCase();
      continue;
    }

    // Skip flags that take a value but we don't care about here.
    if (
      t === "-d" ||
      t === "--data" ||
      t === "--data-raw" ||
      t === "--data-binary" ||
      t === "-b" ||
      t === "--cookie" ||
      t === "-A" ||
      t === "--user-agent" ||
      t === "-e" ||
      t === "--referer" ||
      t === "-o" ||
      t === "--output"
    ) {
      i++;
      continue;
    }

    // Boolean flags we ignore.
    if (t.startsWith("-") && t !== "--") continue;

    // Positional → URL (first one wins).
    if (!url && /^https?:\/\//i.test(t)) {
      url = t;
    }
  }

  const profile = inferProfile({ headers, basicCred, url, notes });
  return { profile, headers, url, method, tokens, notes };
}

function inferProfile(args: {
  headers: Record<string, string>;
  basicCred?: string;
  url?: string;
  notes: string[];
}): AuthProfile | null {
  const { headers, basicCred, url, notes } = args;

  // Bearer
  const authz = headers.authorization;
  if (authz) {
    const match = authz.match(/^Bearer\s+(.+)$/i);
    if (match) {
      notes.push("Detected Bearer token in Authorization header.");
      return { id: "bearer", kind: "bearer", tokenEnv: "API_TOKEN" };
    }
    const basicMatch = authz.match(/^Basic\s+/i);
    if (basicMatch) {
      notes.push("Detected Basic auth in Authorization header.");
      return {
        id: "basic",
        kind: "basic",
        userEnv: "API_USER",
        passEnv: "API_PASSWORD",
      };
    }
  }

  // API key in well-known header names
  const apiKeyHeader = findApiKeyHeader(headers);
  if (apiKeyHeader) {
    notes.push(`Detected API key header: ${apiKeyHeader}`);
    return {
      id: "apiKey",
      kind: "apiKey",
      in: "header",
      name: apiKeyHeader,
      valueEnv: "API_KEY",
    };
  }

  // Basic via -u
  if (basicCred) {
    notes.push("Detected -u credentials (Basic auth).");
    return {
      id: "basic",
      kind: "basic",
      userEnv: "API_USER",
      passEnv: "API_PASSWORD",
    };
  }

  // API key in query string
  if (url) {
    try {
      const u = new URL(url);
      const apiKeyParam = ["api_key", "apikey", "key", "access_token", "token"].find((k) =>
        u.searchParams.has(k),
      );
      if (apiKeyParam) {
        notes.push(`Detected API key in query parameter: ${apiKeyParam}`);
        return {
          id: "apiKey",
          kind: "apiKey",
          in: "query",
          name: apiKeyParam,
          valueEnv: "API_KEY",
        };
      }
    } catch {
      // ignore — URL was unparseable, leave to caller
    }
  }

  return null;
}

const API_KEY_HEADER_PATTERNS = [
  /^x-api-key$/i,
  /^api-key$/i,
  /^x-auth-token$/i,
  /^x-access-token$/i,
];

function findApiKeyHeader(headers: Record<string, string>): string | null {
  for (const name of Object.keys(headers)) {
    if (API_KEY_HEADER_PATTERNS.some((rx) => rx.test(name))) {
      // Return the canonical case: title-case each segment split on "-".
      return name
        .split("-")
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
        .join("-");
    }
  }
  return null;
}
