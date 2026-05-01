import { consola } from "consola";
import { ZodError } from "zod";

/**
 * Wrap a command action to translate raw exceptions into friendly,
 * actionable error messages. Falls back to the original error if we
 * can't recognise it.
 *
 * Exits with code 1 on any failure, so commander never prints stack
 * traces for known error shapes.
 */
export function withFriendlyErrors<A extends unknown[]>(
  fn: (...args: A) => Promise<void>,
): (...args: A) => Promise<void> {
  return async (...args: A) => {
    try {
      await fn(...args);
    } catch (err) {
      reportError(err);
      process.exit(1);
    }
  };
}

function reportError(err: unknown): void {
  if (err instanceof ZodError) {
    consola.error("Invalid IR — the spec produced a structurally invalid model.");
    for (const issue of err.issues.slice(0, 5)) {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      consola.log(`  • ${path}: ${issue.message}`);
    }
    if (err.issues.length > 5) {
      consola.log(`  …and ${err.issues.length - 5} more.`);
    }
    consola.log("");
    consola.log("Hint: this usually means the spec uses a feature loadam does not yet model.");
    consola.log("      Open an issue with the spec attached.");
    return;
  }

  const e = err as NodeJS.ErrnoException & { message?: string };

  if (e?.code === "ENOENT") {
    consola.error(`File not found: ${e.path ?? "<unknown>"}`);
    consola.log("Hint: pass an absolute or workspace-relative path to the spec.");
    return;
  }

  const msg = e?.message ?? String(err);
  if (/^Cannot find module/i.test(msg) || /SyntaxError/.test(msg)) {
    consola.error(`Failed to parse spec: ${msg}`);
    consola.log("Hint: confirm the file is valid YAML or JSON.");
    return;
  }

  // Last resort: surface the raw message but never the stack.
  consola.error(msg);
}
