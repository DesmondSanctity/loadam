import type { AuthProfile, IR } from "@loadam/core";

export interface McpAuth {
  /** Header name → "${ENV_VAR}" template (literal allowed too). */
  headers: Record<string, string>;
  /** Query name → "${ENV_VAR}" template. */
  query: Record<string, string>;
  /** Required env vars. */
  envVars: string[];
  /** README notes. */
  notes: string[];
}

/**
 * Translate IR auth profiles into runtime artifacts for the emitted MCP server.
 * Mirrors @loadam/test-k6's emitAuth — single source of behaviour across rigs.
 */
export function emitAuth(ir: IR): McpAuth {
  const headers: Record<string, string> = {};
  const query: Record<string, string> = {};
  const envVars = new Set<string>();
  const notes: string[] = [];

  for (const profile of ir.auth) apply(profile, headers, query, envVars, notes);

  return {
    headers,
    query,
    envVars: [...envVars].sort(),
    notes,
  };
}

function apply(
  p: AuthProfile,
  headers: Record<string, string>,
  query: Record<string, string>,
  envVars: Set<string>,
  notes: string[],
): void {
  switch (p.kind) {
    case "none":
      return;
    case "bearer": {
      const env = p.tokenEnv ?? "API_TOKEN";
      headers.Authorization = `Bearer \${${env}}`;
      envVars.add(env);
      return;
    }
    case "apiKey": {
      const env = p.valueEnv ?? p.name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
      if (p.in === "header") headers[p.name] = `\${${env}}`;
      else if (p.in === "query") query[p.name] = `\${${env}}`;
      else notes.push(`Cookie-based apiKey "${p.name}" requires manual handling.`);
      envVars.add(env);
      return;
    }
    case "basic": {
      const u = p.userEnv ?? "API_USER";
      const pw = p.passEnv ?? "API_PASS";
      envVars.add(u);
      envVars.add(pw);
      headers.Authorization = `__BASIC__:${u}:${pw}`;
      notes.push("Basic auth: server encodes credentials per request.");
      return;
    }
    case "oauth2_cc":
      envVars.add(p.clientIdEnv);
      envVars.add(p.clientSecretEnv);
      notes.push(
        `OAuth2 client-credentials profile "${p.id}" — set ${p.clientIdEnv}/${p.clientSecretEnv}; V1 emits stubs only.`,
      );
      return;
    case "custom":
      notes.push(`Custom auth signer "${p.signerRef}" — wire manually.`);
      return;
  }
}
