import type { AuthProfile, IR } from "@loadam/core";

export interface AuthEmission {
  /** Header name → __ENV expression (or static). */
  headers: Record<string, string>;
  /** Query param name → __ENV expression. */
  query: Record<string, string>;
  /** Required env vars (for .env.example). */
  envVars: string[];
  /** Notes for the README. */
  notes: string[];
}

/**
 * Translate IR auth profiles into the runtime artifacts needed by k6 scripts.
 *
 * Multiple profiles are folded into a single header/query bag — fine for
 * petstore-class APIs where only one scheme is in play at a time. Per-op
 * scoping is V1.1 work (it requires the script to switch profiles per call).
 *
 * Secrets are *never* inlined. The emitted scripts read every credential
 * from environment variables.
 */
export function emitAuth(ir: IR): AuthEmission {
  const headers: Record<string, string> = {};
  const query: Record<string, string> = {};
  const envVars = new Set<string>();
  const notes: string[] = [];

  for (const profile of ir.auth) {
    applyProfile(profile, headers, query, envVars, notes);
  }

  return {
    headers,
    query,
    envVars: [...envVars].sort(),
    notes,
  };
}

function applyProfile(
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
      const env = p.valueEnv ?? `${p.name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
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
      notes.push(`Basic auth: scripts encode \`${u}:${pw}\` per request. Set both env vars.`);
      // Marker — runtime emits Authorization header itself for basic.
      headers.Authorization = `__BASIC__:${u}:${pw}`;
      return;
    }
    case "oauth2_cc": {
      notes.push(
        `OAuth2 client-credentials profile "${p.id}" detected — V1 emits stubs only; populate \`${p.clientIdEnv}\`/\`${p.clientSecretEnv}\` and supply your own token endpoint call.`,
      );
      envVars.add(p.clientIdEnv);
      envVars.add(p.clientSecretEnv);
      return;
    }
    case "custom":
      notes.push(`Custom auth signer "${p.signerRef}" — wire manually.`);
      return;
  }
}
