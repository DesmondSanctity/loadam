import type { IR } from "@loadam/core";
import { emitAuth } from "./auth.js";
import { type CurateOptions, type ToolDef, curateTools } from "./curate.js";
import {
  emitAuthJs,
  emitBinJs,
  emitClientJs,
  emitEnvExample,
  emitPackageJson,
  emitReadme,
  emitServerJs,
  emitToolsJs,
} from "./templates.js";

/** Pinned MCP SDK version. The roadmap explicitly requires this. */
export const MCP_SDK_VERSION = "^1.29.0";

export interface CompileMcpOptions extends CurateOptions {
  /** Override the base URL inferred from IR.servers[0]. */
  baseUrl?: string;
}

export interface CompileMcpResult {
  /** Map of relative file path → file contents. */
  files: Record<string, string>;
  /** The curated tool list (also embedded into files['tools.js']). */
  tools: ToolDef[];
  /** Required env vars surfaced from auth profiles. */
  envVars: string[];
}

/**
 * Compile an IR into a runnable MCP server project (plain ESM JS).
 * Pure: no filesystem writes — the CLI handles that.
 */
export function compileMcp(ir: IR, opts: CompileMcpOptions = {}): CompileMcpResult {
  const baseUrl = opts.baseUrl ?? ir.servers[0]?.url ?? "http://localhost:4010";
  const tools = curateTools(ir, opts);
  const auth = emitAuth(ir);

  const ctx = {
    ir,
    baseUrl,
    tools,
    auth,
    includeWrites: !!opts.includeWrites,
    sdkVersion: MCP_SDK_VERSION,
  };

  const files: Record<string, string> = {
    "package.json": emitPackageJson(ctx),
    "bin.js": emitBinJs(ctx),
    "server.js": emitServerJs(ctx),
    "tools.js": emitToolsJs(ctx),
    "client.js": emitClientJs(ctx),
    "auth.js": emitAuthJs(ctx),
    ".env.example": emitEnvExample(ctx),
    "README.md": emitReadme(ctx),
  };

  return { files, tools, envVars: auth.envVars };
}

export type { CurateOptions, ToolDef } from "./curate.js";
export { curateTools } from "./curate.js";
