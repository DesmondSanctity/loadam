import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * A loadam session — a timestamped record of one CLI invocation that runs
 * something (test / contract / diff). Sessions are append-only artifacts
 * stored under ./loadam-out/sessions/<id>/ for later inspection or reporting.
 */

export const SESSION_SCHEMA_VERSION = 1 as const;

export type SessionCommand = "test" | "contract" | "diff";

export interface SessionMeta {
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  id: string;
  command: SessionCommand;
  /** Sanitised flags — never store secrets. Boolean / number / string only. */
  flags: Record<string, string | number | boolean | null>;
  spec: { path: string; sha256: string; title?: string; version?: string };
  irDigest: string;
  target: string | null;
  envVars: string[];
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  exitCode?: number;
  /** Pass/fail breakdown when the run produces thresholds (k6). */
  thresholds?: { passed: string[]; failed: string[] };
  /** Free-form headline numbers surfaced by `loadam history`. */
  summary?: Record<string, number | string>;
  /** Relative paths within the session dir. */
  artefacts: string[];
}

export interface CreateSessionInput {
  command: SessionCommand;
  outRoot: string;
  specPath: string;
  specSource: string;
  ir: { meta: { title?: string; version?: string } };
  irJson: string;
  target?: string | null;
  envVars?: string[];
  flags?: Record<string, unknown>;
  /** Optional human-readable slug appended to the dir name. */
  slug?: string;
}

export interface ActiveSession {
  id: string;
  dir: string;
  meta: SessionMeta;
  /** Add an artefact file. Path is relative to the session dir. */
  addArtefact(relPath: string, contents: string | Uint8Array): Promise<void>;
  /** Mark complete and persist meta.json. */
  finalize(input: {
    exitCode: number;
    thresholds?: { passed: string[]; failed: string[] };
    summary?: Record<string, number | string>;
  }): Promise<SessionMeta>;
}

const SESSIONS_DIR = "sessions";

/**
 * Prepare a session directory and persist initial artefacts (ir.json, spec
 * digest, meta with startedAt). Returns an `ActiveSession` handle the caller
 * uses to add artefacts and finalize at the end of the run.
 */
export async function createSession(input: CreateSessionInput): Promise<ActiveSession> {
  const startedAt = new Date();
  const slug = input.slug ? sanitizeSlug(input.slug) : input.command;
  const id = `${formatTimestamp(startedAt)}-${slug}`;
  const root = resolve(input.outRoot, SESSIONS_DIR);
  const dir = resolve(root, id);
  await mkdir(dir, { recursive: true });

  // Drop a .gitignore inside the sessions root so users never accidentally
  // commit the archive (it can contain secrets in flags or summary blobs we
  // don't fully redact). Idempotent: only writes when missing.
  await ensureGitignore(root);

  const specHash = sha256(input.specSource);
  const irDigest = sha256(input.irJson);

  const meta: SessionMeta = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    id,
    command: input.command,
    flags: sanitizeFlags(input.flags ?? {}),
    spec: {
      path: input.specPath,
      sha256: specHash,
      title: input.ir.meta.title,
      version: input.ir.meta.version,
    },
    irDigest,
    target: input.target ?? null,
    envVars: input.envVars ?? [],
    startedAt: startedAt.toISOString(),
    artefacts: ["ir.json", "meta.json"],
  };

  await writeFile(join(dir, "ir.json"), input.irJson, "utf8");
  await writeFile(join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");

  return {
    id,
    dir,
    meta,
    async addArtefact(relPath, contents) {
      const full = join(dir, relPath);
      await mkdir(join(full, "..").replace(/\/+$/, ""), { recursive: true });
      await writeFile(full, contents);
      if (!meta.artefacts.includes(relPath)) meta.artefacts.push(relPath);
    },
    async finalize({ exitCode, thresholds, summary }) {
      const endedAt = new Date();
      meta.endedAt = endedAt.toISOString();
      meta.durationMs = endedAt.getTime() - startedAt.getTime();
      meta.exitCode = exitCode;
      if (thresholds) meta.thresholds = thresholds;
      if (summary) meta.summary = summary;
      await writeFile(join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
      return meta;
    },
  };
}

/**
 * List sessions newest-first. Loads meta.json from each session dir and
 * silently skips dirs that don't contain a valid meta.
 */
export async function listSessions(outRoot: string): Promise<SessionMeta[]> {
  const root = resolve(outRoot, SESSIONS_DIR);
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const metas: SessionMeta[] = [];
  for (const entry of entries) {
    const meta = await loadMeta(join(root, entry));
    if (meta) metas.push(meta);
  }
  return metas.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

/**
 * Resolve a partial session ID against the on-disk archive.
 *
 * Accepts either the full ID, an unambiguous prefix, or the literal string
 * "latest". Throws when zero or multiple matches are found.
 */
export async function resolveSessionId(outRoot: string, idOrPrefix: string): Promise<SessionMeta> {
  const all = await listSessions(outRoot);
  if (all.length === 0) {
    throw new Error("No sessions found. Run `loadam test`/`contract`/`diff` first.");
  }
  if (idOrPrefix === "latest") return all[0] as SessionMeta;
  const exact = all.find((m) => m.id === idOrPrefix);
  if (exact) return exact;
  const prefix = all.filter((m) => m.id.startsWith(idOrPrefix));
  if (prefix.length === 0) throw new Error(`No session matched "${idOrPrefix}".`);
  if (prefix.length > 1) {
    const ids = prefix.map((m) => m.id).join("\n  ");
    throw new Error(`Ambiguous session prefix "${idOrPrefix}", matches:\n  ${ids}`);
  }
  return prefix[0] as SessionMeta;
}

export interface CleanOptions {
  /** Delete sessions older than this many milliseconds. */
  olderThanMs?: number;
  /** Keep at most N most-recent sessions (regardless of age). */
  keep?: number;
  /** When true, actually delete; otherwise return a dry-run plan. Default false. */
  apply?: boolean;
}

export interface CleanResult {
  deleted: string[];
  kept: string[];
}

export async function cleanSessions(outRoot: string, opts: CleanOptions): Promise<CleanResult> {
  const all = await listSessions(outRoot);
  const root = resolve(outRoot, SESSIONS_DIR);
  const now = Date.now();
  const hasAge = typeof opts.olderThanMs === "number";
  const hasKeep = typeof opts.keep === "number";
  const ageCut = opts.olderThanMs ?? Number.POSITIVE_INFINITY;
  const keep = opts.keep ?? 0;

  // No criteria → nothing deleted.
  if (!hasAge && !hasKeep) {
    return { deleted: [], kept: all.map((m) => m.id) };
  }

  // Sessions are already newest-first. A session is deleted if EITHER:
  //   - it falls past the keep-count window, OR
  //   - it's older than the age cutoff
  // BUT the keep window always wins (acts as a floor).
  const deleted: string[] = [];
  const kept: string[] = [];
  all.forEach((m, index) => {
    if (hasKeep && index < keep) {
      kept.push(m.id);
      return;
    }
    const age = now - new Date(m.startedAt).getTime();
    const expired = hasAge && age >= ageCut;
    const excess = hasKeep && index >= keep;
    if (expired || excess) deleted.push(m.id);
    else kept.push(m.id);
  });

  if (opts.apply) {
    for (const id of deleted) {
      await rm(join(root, id), { recursive: true, force: true });
    }
  }
  return { deleted, kept };
}

async function loadMeta(dir: string): Promise<SessionMeta | null> {
  try {
    const stats = await stat(dir);
    if (!stats.isDirectory()) return null;
    const text = await readFile(join(dir, "meta.json"), "utf8");
    const parsed = JSON.parse(text);
    if (parsed?.schemaVersion === SESSION_SCHEMA_VERSION && typeof parsed.id === "string") {
      return parsed as SessionMeta;
    }
  } catch {
    // ignore
  }
  return null;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function formatTimestamp(d: Date): string {
  // 2026-05-01T12-34-56 — colon-free for filesystem safety.
  return d.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function ensureGitignore(root: string): Promise<void> {
  const path = join(root, ".gitignore");
  try {
    await readFile(path, "utf8");
  } catch {
    await writeFile(
      path,
      "# Auto-generated by loadam — sessions can contain secrets, do not commit.\n*\n!.gitignore\n",
      "utf8",
    );
  }
}

function sanitizeSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

const SECRET_LIKE = /(token|secret|password|pass|key|credential|auth)/i;

/**
 * Drop secret-shaped values, keep primitives only. Defensive in case future
 * commands forget and pass `auth: "Bearer xyz"` straight in.
 */
function sanitizeFlags(
  flags: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(flags)) {
    if (SECRET_LIKE.test(k)) {
      out[k] = "[redacted]";
      continue;
    }
    if (v === null || typeof v === "boolean" || typeof v === "number") {
      out[k] = v;
    } else if (typeof v === "string") {
      out[k] = v;
    }
    // arrays / objects intentionally skipped — meta.json stays flat.
  }
  return out;
}
